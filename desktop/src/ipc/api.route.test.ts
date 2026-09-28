import { beforeEach, describe, expect, it } from 'vitest';
import type { DomainEvent } from '@udm/shared';
import { openDatabase, run, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { login } from '../services/auth.js';
import { ExecutionRunner } from '../domain/execution/executor.js';
import { EventBus } from '../services/event-bus.js';
import { SessionStore } from '../services/session.js';
import { createApiRoutes } from './api.js';
import { createRouter, type Router } from './router.js';

/**
 * M5 路径规划的**传输层**行为（`docs/api.md` §3.5）。
 *
 * 服务层的行为由 `domain/route/route.service.test.ts` 断言，这里只证明四件事：
 *   1. **三条路由真的接上了**（`POST plan` / `POST compare` / `GET {id}`），
 *      且路径参数送到了对的读取方法；
 *   2. **权限是 `route:plan`**：dispatcher 与 admin 可以，monitor 一律 `AUTH.FORBIDDEN`；
 *   3. **领域错误原样透出为信封**（`GRAPH.BLOCKED` 不会变成 500），且 detail 保留；
 *   4. **不发事件**：规划是预览，没有数据变化，发 `map.updated` 只会让地图白重拉一次。
 *
 * 最后一条是本文件存在的主要理由：路由「顺手」emit 一个事件看不成问题，
 * 但地图收到事件后会重拉快照、重建 nodes/edges —— 在 `D-23` 里已经证明那是
 * 「边间歇性渲染不出来」的成因。把「不发」写成断言，比指望后来者记得更靠谱。
 */
function setup() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  const sessions = new SessionStore();
  const bus = new EventBus(db, sessions);
  // 执行器按依赖注入传入（M7）：这些用例不点执行接口，但构造签名必须与主进程一致
  const executor = new ExecutionRunner(db, bus);
  const router: Router = createRouter(createApiRoutes({ db, sessions, bus, executor }), { db, sessions });
  const admin = login(db, sessions, { username: 'admin', password: 'admin123' }, 't-admin');
  const dispatcher = login(db, sessions, { username: 'dispatcher', password: 'dispatcher123' }, 't-disp');
  const monitor = login(db, sessions, { username: 'monitor', password: 'monitor123' }, 't-mon');
  return { db, router, bus, admin, dispatcher, monitor };
}

const n = (index: number) => `seed-n${String(index).padStart(2, '0')}`;

describe('ipc · M5 路径规划', () => {
  let db: Db;
  let router: Router;
  let bus: EventBus;
  let admin: { token: string };
  let dispatcher: { token: string };
  let monitor: { token: string };

  beforeEach(() => {
    ({ db, router, bus, admin, dispatcher, monitor } = setup());
  });

  it('POST /api/routes/plan 返回完整回执，字段与契约一致', async () => {
    const result = await router.invoke({
      path: '/api/routes/plan',
      method: 'POST',
      token: dispatcher.token,
      payload: { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv', algorithm: 'aStar' }
    });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      const route = (result.data as { route: Record<string, unknown> }).route;
      expect(Object.keys(route).sort()).toEqual(
        [
          'algorithm',
          'costDetail',
          'distanceM',
          'durationS',
          'edgeIds',
          'fromNodeId',
          'nodeIds',
          'toNodeId',
          'viaNodeIds',
          'warnings'
        ].sort()
      );
      expect(route['distanceM']).toBe(100);
      expect(route['warnings']).toEqual([]);
    }
  });

  it('POST /api/routes/compare 两个算法都算，consistent=true', async () => {
    const result = await router.invoke({
      path: '/api/routes/compare',
      method: 'POST',
      token: admin.token,
      payload: { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' }
    });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      const data = result.data as { results: Array<{ algorithm: string }>; consistent: boolean; difference: unknown };
      expect(data.results.map((item) => item.algorithm)).toEqual(['aStar', 'dijkstra']);
      expect(data.consistent).toBe(true);
      expect(data.difference).toEqual({ distanceM: 0, durationS: 0 });
    }
  });

  it('GET /api/routes/{id} 走路径参数读种子路线', async () => {
    const result = await router.invoke({
      path: '/api/routes/seed-route-demo',
      token: admin.token
    });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      expect(result.data).toMatchObject({ id: 'seed-route-demo', taskId: 'seed-task-demo', distanceM: 100 });
    }
  });

  it('GET /api/routes/{id} 不存在 → ROUTE.NOT_FOUND（404 语义，不是 500）', async () => {
    const result = await router.invoke({ path: '/api/routes/seed-route-nope', token: admin.token });
    expect(result).toMatchObject({ code: 'ROUTE.NOT_FOUND', source: 'business' });
  });

  it('权限为 route:plan：monitor 一律 AUTH.FORBIDDEN，三条接口都拦', async () => {
    const calls: Array<{ path: string; method?: string; payload?: Record<string, unknown> }> = [
      { path: '/api/routes/plan', method: 'POST', payload: { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' } },
      { path: '/api/routes/compare', method: 'POST', payload: { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' } },
      { path: '/api/routes/seed-route-demo' }
    ];
    for (const call of calls) {
      const result = await router.invoke({ ...call, token: monitor.token });
      expect(result, call.path).toMatchObject({ code: 'AUTH.FORBIDDEN' });
    }
  });

  it('未登录 → AUTH.REQUIRED（先鉴权再判权限）', async () => {
    const result = await router.invoke({
      path: '/api/routes/plan',
      method: 'POST',
      payload: { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' }
    });
    expect(result).toMatchObject({ code: 'AUTH.REQUIRED' });
  });

  it('领域错误透出：被禁行封住的端点 → GRAPH.BLOCKED + detail', async () => {
    run(
      db,
      `INSERT INTO restrictions (id, type, target_id, reason, status, created_at, created_by)
       VALUES ('rule-1', 'node', ?, '测试', 'active', '2026-09-26T00:00:00.000Z', 'seed')`,
      [n(2)]
    );
    const result = await router.invoke({
      path: '/api/routes/plan',
      method: 'POST',
      token: admin.token,
      payload: { fromNodeId: n(2), toNodeId: n(5), vehicleType: 'agv' }
    });
    expect(result).toMatchObject({ code: 'GRAPH.BLOCKED', source: 'business' });
    expect((result as { detail: Record<string, unknown> }).detail).toMatchObject({ reason: 'BLOCKED', reachedNodeId: n(2) });
  });

  it('参数校验失败 → VALIDATION.FAILED + detail.fields', async () => {
    const result = await router.invoke({
      path: '/api/routes/plan',
      method: 'POST',
      token: admin.token,
      payload: { fromNodeId: n(1), toNodeId: n(12) }
    });
    expect(result).toMatchObject({ code: 'VALIDATION.FAILED', source: 'validation' });
    expect(Object.keys(((result as { detail: { fields: object } }).detail.fields) as object)).toEqual(['vehicleType']);
  });

  it('规划是预览：三条接口都不发领域事件（否则地图会为一个没有变化的世界重拉快照）', async () => {
    // 用真窗口替身观察推送：`attach` 后若发出任何事件，`sent` 里就会出现内容。
    // 比对 `event_log` 只能证明「没落库」，证明不了「没推送」—— 而地图是被推送驱动的
    const sent: DomainEvent[] = [];
    const window = {
      send: (_channel: string, payload: unknown) => {
        sent.push(payload as DomainEvent);
      }
    };
    bus.attach(window, admin.token);

    await router.invoke({
      path: '/api/routes/plan',
      method: 'POST',
      token: admin.token,
      payload: { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' }
    });
    await router.invoke({
      path: '/api/routes/compare',
      method: 'POST',
      token: admin.token,
      payload: { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' }
    });
    await router.invoke({ path: '/api/routes/seed-route-demo', token: admin.token });
    expect(sent).toEqual([]);
  });
});
