import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { login } from '../services/auth.js';
import { ExecutionRunner } from '../domain/execution/executor.js';
import { EventBus } from '../services/event-bus.js';
import { SessionStore } from '../services/session.js';
import { createApiRoutes } from './api.js';
import { createRouter } from './router.js';

function setup() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  const sessions = new SessionStore();
  const bus = new EventBus(db, sessions);
  // 执行器按依赖注入传入（M7）：这些用例不点执行接口，但构造签名必须与主进程一致
  const executor = new ExecutionRunner(db, bus);
  const router = createRouter(createApiRoutes({ db, sessions, bus, executor }), { db, sessions });
  return { db, sessions, router };
}

describe('ipc router', () => {
  it('serves public health', async () => {
    const { db, router } = setup();
    const result = await router.invoke({ path: '/api/health' });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      expect(result.data).toMatchObject({ status: 'ok', db: true });
    }
    db.close();
  });

  it('rejects unknown routes with API.ROUTE_NOT_FOUND', async () => {
    const { db, router } = setup();
    const result = await router.invoke({ path: '/api/nope' });
    expect(result).toMatchObject({ code: 'API.ROUTE_NOT_FOUND', source: 'validation' });
    db.close();
  });

  it('requires a session for protected routes', async () => {
    const { db, router } = setup();
    const result = await router.invoke({ path: '/api/users' });
    expect(result).toMatchObject({ code: 'AUTH.REQUIRED' });
    db.close();
  });

  it('enforces permissions server-side', async () => {
    const { db, sessions, router } = setup();
    const monitor = login(db, sessions, { username: 'monitor', password: 'monitor123' }, 't-1');
    const denied = await router.invoke({ path: '/api/users', token: monitor.token });
    expect(denied).toMatchObject({ code: 'AUTH.FORBIDDEN' });

    const admin = login(db, sessions, { username: 'admin', password: 'admin123' }, 't-2');
    const allowed = await router.invoke({ path: '/api/users', token: admin.token });
    expect(allowed.code).toBe(0);
    db.close();
  });

  it('serves /api/map/overview to all three roles (map:read is granted to each)', async () => {
    const { db, sessions, router } = setup();
    for (const [username, password] of [
      ['admin', 'admin123'],
      ['dispatcher', 'dispatcher123'],
      ['monitor', 'monitor123']
    ] as Array<[string, string]>) {
      const session = login(db, sessions, { username, password }, `t-map-${username}`);
      const result = await router.invoke({ path: '/api/map/overview', token: session.token });
      expect(result.code, `${username} 应能读取地图`).toBe(0);
      if (result.code === 0) {
        expect(result.data).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array), eventSeq: 0 });
      }
    }
    db.close();
  });

  it('requires a session for /api/map/overview (not public)', async () => {
    const { db, router } = setup();
    const result = await router.invoke({ path: '/api/map/overview' });
    expect(result).toMatchObject({ code: 'AUTH.REQUIRED' });
    db.close();
  });

  it('returns the seed snapshot with the same shape the renderer consumes', async () => {
    const { db, sessions, router } = setup();
    const admin = login(db, sessions, { username: 'admin', password: 'admin123' }, 't-shape');
    const result = await router.invoke({ path: '/api/map/overview', token: admin.token });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      const data = result.data as { nodes: unknown[]; edges: unknown[]; sites: unknown[]; vehicles: unknown[] };
      expect(data.nodes).toHaveLength(12);
      expect(data.edges).toHaveLength(34);
      expect(data.sites).toHaveLength(3);
      expect(data.vehicles).toHaveLength(3);
    }
    db.close();
  });

  it('returns settings for dispatcher but blocks writes-less roles from schema? (settings:read allowed)', async () => {
    const { db, sessions, router } = setup();
    const dispatcher = login(db, sessions, { username: 'dispatcher', password: 'dispatcher123' }, 't-3');
    const settings = await router.invoke({ path: '/api/settings', token: dispatcher.token });
    expect(settings.code).toBe(0);
    if (settings.code === 0) {
      expect(settings.data).toMatchObject({ 'dispatch.defaultStrategy': 'greedy' });
    }
    db.close();
  });

  it('基础数据四个列表接口对三个角色都开放（base:read 三角色均有），未登录一律 AUTH.REQUIRED', async () => {
    const { db, sessions, router } = setup();
    const paths = ['/api/sites', '/api/vehicles', '/api/nodes', '/api/edges'];

    for (const path of paths) {
      const anonymous = await router.invoke({ path });
      expect(anonymous, `${path} 不应是公开接口`).toMatchObject({ code: 'AUTH.REQUIRED' });
    }

    for (const [username, password] of [
      ['admin', 'admin123'],
      ['dispatcher', 'dispatcher123'],
      ['monitor', 'monitor123']
    ] as Array<[string, string]>) {
      const session = login(db, sessions, { username, password }, `t-base-${username}`);
      for (const path of paths) {
        const result = await router.invoke({ path, token: session.token });
        expect(result.code, `${username} 应能读取 ${path}`).toBe(0);
        if (result.code === 0) {
          const data = result.data as { records: unknown[]; total: number; page: number; pageSize: number };
          expect(data.records.length).toBeGreaterThan(0);
          expect(data.total).toBeGreaterThanOrEqual(data.records.length);
          expect(data.page).toBe(1);
        }
      }
    }
    db.close();
  });

  it('列表接口的分页与筛选走统一口径：分页宽进、筛选项严出', async () => {
    const { db, sessions, router } = setup();
    const admin = login(db, sessions, { username: 'admin', password: 'admin123' }, 't-base-page');

    // 宽进：非法分页值回落默认，不报错（`parsePagination` 的口径）
    const weird = await router.invoke({
      path: '/api/edges',
      token: admin.token,
      payload: { page: 'abc', pageSize: -3 }
    });
    expect(weird.code).toBe(0);
    if (weird.code === 0) {
      expect(weird.data).toMatchObject({ page: 1, pageSize: 20 });
    }

    // 严出：筛选值不在枚举里必须报错 —— 静默忽略会让页面显示全量数据，
    // 而使用者以为自己在看「已停用的车」（`optionalEnumFilter` 注释里的判据）
    const bad = await router.invoke({ path: '/api/vehicles', token: admin.token, payload: { status: 'foo' } });
    expect(bad).toMatchObject({ code: 'VALIDATION.FAILED' });
    if (bad.code === 0) {
      throw new Error('unreachable');
    } else {
      expect(bad.detail?.fields).toHaveProperty('status');
    }

    // 过滤真的生效：只按 code 查一条边
    const first = await router.invoke({ path: '/api/edges', token: admin.token, payload: { pageSize: 1 } });
    expect(first.code).toBe(0);
    if (first.code === 0) {
      const edge = (first.data as { records: Array<{ code: string }> }).records[0]!;
      const byCode = await router.invoke({ path: '/api/edges', token: admin.token, payload: { code: edge.code } });
      expect(byCode.code).toBe(0);
      if (byCode.code === 0) {
        expect((byCode.data as { records: Array<{ code: string }> }).records).toHaveLength(1);
      }
    }
    db.close();
  });
});
