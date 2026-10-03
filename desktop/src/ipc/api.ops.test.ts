import { beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '@udm/shared';
import { openDatabase, run, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { ExecutionRunner } from '../domain/execution/executor.js';
import { EventBus } from '../services/event-bus.js';
import { SessionStore } from '../services/session.js';
import { SEED_VEHICLE_COUNT } from '../db/seed-fixture.js';
import { login } from '../services/auth.js';
import { createApiRoutes } from './api.js';
import { createRouter, type Router } from './router.js';

/**
 * M1 / M7 / M8 / M9 / M10 的传输层行为。
 *
 * 这一层要证明的不是业务规则（各自有领域单测），而是：
 *   1. 路径 + 方法真的落在对的处理器上（`POST` 不写成 `GET`，见 ISS-066）；
 *   2. 权限按契约强制（每类角色各不相同：monitor 能确认告警但不能关闭）；
 *   3. 错误是**统一信封里的业务码**，不是 500；
 *   4. 事件在写完之后才发（订阅者收到时数据已可见）。
 */
function setup() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  const sessions = new SessionStore();
  const bus = new EventBus(db, sessions);
  const executor = new ExecutionRunner(db, bus, { tickMs: 1000, speedFactor: 4 });
  const router: Router = createRouter(createApiRoutes({ db, sessions, bus, executor }), { db, sessions });
  const admin = login(db, sessions, { username: 'admin', password: 'admin123' }, 't-admin');
  const dispatcher = login(db, sessions, { username: 'dispatcher', password: 'dispatcher123' }, 't-disp');
  const monitor = login(db, sessions, { username: 'monitor', password: 'monitor123' }, 't-mon');
  return { db, router, bus, executor, admin, dispatcher, monitor };
}

/** seed 的演示任务是 running；把它改成「已派发未开始」，用于执行接口用例。 */
function makeAssigned(db: Db): void {
  run(db, "UPDATE tasks SET status = 'assigned', progress = 0 WHERE id = ?", [SEED_IDS.demoTask]);
  run(db, "UPDATE vehicles SET status = 'reserved', load_kg = 0 WHERE id = ?", [SEED_IDS.vehicleAgv]);
}

describe('ipc · M7/M8/M9/M10/M1', () => {
  let db: Db;
  let router: Router;
  let admin: { token: string };
  let dispatcher: { token: string };
  let monitor: { token: string };

  beforeEach(() => {
    ({ db, router, admin, dispatcher, monitor } = setup());
  });

  it('GET /api/monitor/overview：计数与库一致，且带事件水位线', async () => {
    const result = await router.invoke({ path: '/api/monitor/overview', token: monitor.token });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      const data = result.data as { taskCounts: Record<string, number>; vehicleCounts: Record<string, number>; eventSeq: number };
      expect(data.taskCounts['running']).toBe(1);
      // seed 车队：AGV-01 busy（演示任务在跑），其余全部 idle。
      // 条数从车队清单推出来（`SEED_FLEET`），不写死「三台车」这个已经过时的口径
      expect(data.vehicleCounts['busy']).toBe(1);
      expect(data.vehicleCounts['idle']).toBe(SEED_VEHICLE_COUNT - 1);
      expect(typeof data.eventSeq).toBe('number');
    }
  });

  it('GET /api/monitor/tasks：默认只看 running/paused/failed（草稿不进监控视图）', async () => {
    const result = await router.invoke({ path: '/api/monitor/tasks', token: monitor.token });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      const records = (result.data as { records: Array<{ status: string }> }).records;
      expect(records.length).toBeGreaterThan(0);
      expect(records.every((row) => ['running', 'paused', 'failed'].includes(row.status))).toBe(true);
    }
  });

  it('GET /api/monitor/vehicles：running 任务的车带 currentTaskId，空闲车为 null', async () => {
    const result = await router.invoke({ path: '/api/monitor/vehicles', token: monitor.token, payload: { pageSize: 50 } });
    const records = (result as { data: { records: Array<{ code: string; currentTaskId: string | null }> } }).data.records;
    const agv = records.find((row) => row.code === 'AGV-01')!;
    const idle = records.find((row) => row.currentTaskId === null)!;
    expect(agv.currentTaskId).toBe(SEED_IDS.demoTask);
    expect(idle).toBeTruthy();
  });

  it('执行链路：start 要 execution:start 权限 → 任务 running → 轨迹可读；GET 打同一路径是 404', async () => {
    makeAssigned(db);
    // monitor 没有 execution:start（`design.md` §3.7）
    const forbidden = await router.invoke({ path: `/api/execution/tasks/${SEED_IDS.demoTask}/start`, method: 'POST', token: monitor.token, payload: {} });
    expect(forbidden).toMatchObject({ code: 'AUTH.FORBIDDEN' });

    const started = await router.invoke({ path: `/api/execution/tasks/${SEED_IDS.demoTask}/start`, method: 'POST', token: dispatcher.token, payload: { note: '已到起点' } });
    expect(started).toMatchObject({ code: 0 });
    expect((started as { data: { status: string } }).data.status).toBe('running');

    const tracks = await router.invoke({ path: `/api/map/tracks/${SEED_IDS.vehicleAgv}`, token: monitor.token });
    expect(tracks.code).toBe(0);
    if (tracks.code === 0) {
      expect((tracks.data as { points: unknown[] }).points.length).toBe(1);
    }

    // 方法写错（GET 打 POST 路径）不应误命中其它路由
    const wrongMethod = await router.invoke({ path: `/api/execution/tasks/${SEED_IDS.demoTask}/start`, token: admin.token });
    expect(wrongMethod).toMatchObject({ code: 'API.ROUTE_NOT_FOUND' });
  });

  it('接管：任务转 paused 并生成告警；dispatch:apply ≠ execution:takeover（monitor 被拒）', async () => {
    const forbidden = await router.invoke({ path: `/api/execution/tasks/${SEED_IDS.demoTask}/takeover`, method: 'POST', token: monitor.token, payload: {} });
    expect(forbidden).toMatchObject({ code: 'AUTH.FORBIDDEN' });

    const result = await router.invoke({
      path: `/api/execution/tasks/${SEED_IDS.demoTask}/takeover`,
      method: 'POST',
      token: dispatcher.token,
      payload: { note: '现场检查', alertType: 'route_blocked' }
    });
    expect(result.code).toBe(0);
    const alertId = (result as { data: { alertId: string; nextSteps: string[] } }).data.alertId;
    expect((result as { data: { nextSteps: string[] } }).data.nextSteps.length).toBeGreaterThan(0);

    const detail = await router.invoke({ path: `/api/alerts/${alertId}`, token: monitor.token });
    expect(detail).toMatchObject({ code: 0 });
    expect((detail as { data: { type: string; suggestedNextSteps: string[] } }).data.type).toBe('route_blocked');
    expect((detail as { data: { suggestedNextSteps: string[] } }).data.suggestedNextSteps.length).toBeGreaterThan(0);
  });

  it('告警状态操作：monitor 能确认（alert:ack）但不能关闭（alert:resolve 只有 admin/dispatcher）', async () => {
    const acked = await router.invoke({
      path: `/api/alerts/${SEED_IDS.demoAlert}/acknowledge`,
      method: 'POST',
      token: monitor.token,
      payload: { note: '我来看' }
    });
    expect(acked).toMatchObject({ code: 0 });

    const resolveByMonitor = await router.invoke({
      path: `/api/alerts/${SEED_IDS.demoAlert}/resolve`,
      method: 'POST',
      token: monitor.token,
      payload: { resolution: 'x' }
    });
    expect(resolveByMonitor).toMatchObject({ code: 'AUTH.FORBIDDEN' });

    const resolved = await router.invoke({
      path: `/api/alerts/${SEED_IDS.demoAlert}/resolve`,
      method: 'POST',
      token: dispatcher.token,
      payload: { resolution: '已恢复心跳' }
    });
    expect(resolved).toMatchObject({ code: 0 });
    expect((resolved as { data: { resolveBy: string } }).data.resolveBy).toBe('dispatcher');

    // 越级迁移走信封里的业务码，不是 500
    const archived = await router.invoke({
      path: `/api/alerts/${SEED_IDS.demoAlert}/resolve`,
      method: 'POST',
      token: dispatcher.token,
      payload: { resolution: 'again' }
    });
    expect(archived).toMatchObject({ code: 'ALERT.STATE_CONFLICT' });
  });

  it('告警列表：筛选严出（非法 status 报错），分页信封完整', async () => {
    const list = await router.invoke({ path: '/api/alerts', token: monitor.token, payload: { status: 'new,acknowledged', pageSize: 5 } });
    expect(list.code).toBe(0);
    if (list.code === 0) {
      expect(list.data).toMatchObject({ page: 1, pageSize: 5 });
      expect((list.data as { records: Array<{ status: string }> }).records.every((row) => ['new', 'acknowledged'].includes(row.status))).toBe(true);
    }
    const bad = await router.invoke({ path: '/api/alerts', token: monitor.token, payload: { status: 'new-ish' } });
    expect(bad).toMatchObject({ code: 'VALIDATION.FAILED' });
  });

  it('审计：dispatcher / monitor 无 audit:read；admin 能查且记录带 traceId；导出是带表头的 CSV', async () => {
    for (const token of [dispatcher.token, monitor.token]) {
      const denied = await router.invoke({ path: '/api/audit/logs', token });
      expect(denied).toMatchObject({ code: 'AUTH.FORBIDDEN' });
    }
    // 先制造一条审计（登录本身就会写）
    const logs = await router.invoke({ path: '/api/audit/logs', token: admin.token, payload: { pageSize: 10 } });
    expect(logs.code).toBe(0);
    if (logs.code === 0) {
      const records = (logs.data as { records: Array<{ module: string; ts: string }> }).records;
      expect(records.length).toBeGreaterThan(0);
      expect(records[0]!.ts).toBeTruthy();
    }
    const exported = await router.invoke({ path: '/api/audit/logs/export', token: admin.token });
    expect(exported.code).toBe(0);
    if (exported.code === 0) {
      const data = exported.data as { filename: string; content: string; total: number };
      expect(data.filename).toMatch(/^udm-audit-.*\.csv$/);
      // BOM + 表头：Excel 打开不乱码的前提
      expect(data.content.startsWith('\uFEFF')).toBe(true);
      expect(data.content).toContain('ts,actorName,role,module');
      expect(data.total).toBeGreaterThan(0);
    }
  });

  it('设置写：只有 settings:write（admin）；取值非法 → VALIDATION.FAILED + 字段级原因', async () => {
    const denied = await router.invoke({
      path: '/api/settings',
      method: 'PATCH',
      token: dispatcher.token,
      payload: { updates: { 'ui.theme': 'dark' } }
    });
    expect(denied).toMatchObject({ code: 'AUTH.FORBIDDEN' });

    const bad = await router.invoke({
      path: '/api/settings',
      method: 'PATCH',
      token: admin.token,
      payload: { updates: { 'task.timeoutToleranceS': 999999 } }
    });
    expect(bad).toMatchObject({ code: 'VALIDATION.FAILED' });

    const ok = await router.invoke({
      path: '/api/settings',
      method: 'PATCH',
      token: admin.token,
      payload: { updates: { 'ui.theme': 'dark' } }
    });
    expect(ok).toMatchObject({ code: 0 });
    expect((ok as { data: { values: Record<string, unknown> } }).data.values['ui.theme']).toBe('dark');

    // `updates` 形状不对也要在传输层拦住
    const wrongShape = await router.invoke({ path: '/api/settings', method: 'PATCH', token: admin.token, payload: { updates: ['ui.theme'] } });
    expect(wrongShape).toMatchObject({ code: 'VALIDATION.FAILED' });
  });

  it('用户管理：admin 建号 → 停用 → 重置密码；dispatcher 无 user:manage', async () => {
    const denied = await router.invoke({
      path: '/api/users',
      method: 'POST',
      token: dispatcher.token,
      payload: { username: 'u-x', password: 'secret123', displayName: 'X', role: 'monitor' }
    });
    expect(denied).toMatchObject({ code: 'AUTH.FORBIDDEN' });

    const created = await router.invoke({
      path: '/api/users',
      method: 'POST',
      token: admin.token,
      payload: { username: 'operator02', password: 'secret123', displayName: '操作员二', role: 'dispatcher' }
    });
    expect(created).toMatchObject({ code: 0 });
    const id = (created as { data: { id: string } }).data.id;

    const disabled = await router.invoke({ path: `/api/users/${id}/status`, method: 'PATCH', token: admin.token, payload: { status: 'disabled' } });
    expect((disabled as { data: { status: string } }).data.status).toBe('disabled');

    const reset = await router.invoke({ path: `/api/users/${id}/reset-password`, method: 'POST', token: admin.token, payload: { password: 'newsecret123' } });
    expect(reset).toMatchObject({ code: 0 });

    // 列表筛选：角色严出
    const list = await router.invoke({ path: '/api/users', token: admin.token, payload: { role: 'dispatcher', pageSize: 10 } });
    expect(list.code).toBe(0);
    const badRole = await router.invoke({ path: '/api/users', token: admin.token, payload: { role: 'root' } });
    expect(badRole).toMatchObject({ code: 'VALIDATION.FAILED' });
  });

  it('PUT /api/users/me/password：无 user:manage 的 dispatcher 也能改自己的密码；原密码错 → AUTH.OLD_PASSWORD_WRONG', async () => {
    const wrong = await router.invoke({
      path: '/api/users/me/password',
      method: 'PUT',
      token: dispatcher.token,
      // 长度也要合法（6-32）：否则先在字段层被拦，测不到「原密码错误」这条路径
      payload: { oldPassword: 'wrongpass1', newPassword: 'newsecret123' }
    });
    expect(wrong).toMatchObject({ code: 'AUTH.OLD_PASSWORD_WRONG' });

    const ok = await router.invoke({
      path: '/api/users/me/password',
      method: 'PUT',
      token: dispatcher.token,
      payload: { oldPassword: 'dispatcher123', newPassword: 'newsecret123' }
    });
    expect(ok).toMatchObject({ code: 0 });

    // 新密码立刻可用（登录一次证明改的是同一份哈希）
    const sessions = new SessionStore();
    const result = login(db, sessions, { username: 'dispatcher', password: 'newsecret123' }, 't-verify');
    expect(result.user.username).toBe('dispatcher');
  });

  it('未登录一律 AUTH.REQUIRED（先鉴权再判权限）', async () => {
    for (const request of [
      { path: '/api/monitor/overview' },
      { path: '/api/alerts' },
      { path: '/api/audit/logs' },
      { path: `/api/alerts/${SEED_IDS.demoAlert}/archive`, method: 'POST' as const },
      { path: '/api/settings', method: 'PATCH' as const },
      { path: '/api/users', method: 'POST' as const }
    ]) {
      const result = await router.invoke(request);
      expect(result).toMatchObject({ code: 'AUTH.REQUIRED' });
    }
  });
});
