import { beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS, type AuditContext, type DomainEvent } from '@udm/shared';
import { get, openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { createTask } from '../domain/task/task.service.js';
import { login } from '../services/auth.js';
import { ExecutionRunner } from '../domain/execution/executor.js';
import { EventBus } from '../services/event-bus.js';
import { SessionStore } from '../services/session.js';
import { createApiRoutes } from './api.js';
import { createRouter, type Router } from './router.js';

/**
 * M4 调度的**传输层**行为（`docs/api.md` §3.4）。
 *
 * 服务层的行为（预览只读、应用落库、并发回滚、重算三步）已经由
 * `domain/dispatch/dispatch.service.test.ts` 的 23 个用例断言，这里**不重复**：
 * 本文件只证明传输层独有的四件事。
 *
 *   1. **六条路由真的接上了**，且三条写路由**必须是 POST** —— 这是 ISS-066 的回归护栏：
 *      当时契约写 POST、代码里漏了 `method`，Router 按 GET 注册，
 *      前端调 `POST` 得到 `API.ROUTE_NOT_FOUND`，而**从代码上看不出任何异常**；
 *   2. **权限分层**：`dispatch:read`（清单 / 日志）、`dispatch:preview`（预览）、
 *      `dispatch:apply`（应用 / 手动指派 / 重算）；monitor 一个都没有 → 六条全 `AUTH.FORBIDDEN`；
 *   3. **事件只在真正改变了数据时才发**：apply / manual-assign / recompute 三条写路由
 *      发 `task.changed` + `vehicle.changed` + `map.updated`；preview 与 strategies / logs
 *      一律不发（预览没有改变任何被展示的业务事实，发事件只会让地图白重拉一次）；
 *   4. **领域错误原样透出为信封**（`DISPATCH.ALREADY_APPLIED` / `TASK.STATE_CONFLICT`
 *      不会变成 500），且筛选取值非法时报 `VALIDATION.FAILED` 而不是静默返回全部。
 */
const ACTOR: AuditContext = { actorId: 'seed-admin', actorName: 'admin', role: 'admin', traceId: 'trace-ipc-m4' };

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

let seq = 0;
/** 造一条 `pending` 任务（服务层落库，这里只关心路由；创建路径由 M3 的用例覆盖）。 */
function pendingTask(db: Db) {
  seq += 1;
  return createTask(
    { db, actor: ACTOR },
    {
      title: `路由用例任务 ${seq}`,
      cargoKg: 100,
      fromSiteId: SEED_IDS.siteDepotA,
      toSiteId: SEED_IDS.siteDepotB,
      submit: true
    }
  );
}

function captureEvents(bus: EventBus, token: string): DomainEvent[] {
  const sent: DomainEvent[] = [];
  bus.attach({ send: (_channel: string, payload: unknown) => sent.push(payload as DomainEvent) }, token);
  return sent;
}

async function previewVia(router: Router, token: string, taskIds: string[], strategy = 'greedy') {
  const result = await router.invoke({ path: '/api/dispatch/preview', method: 'POST', token, payload: { taskIds, strategy } });
  expect(result.code, JSON.stringify(result)).toBe(0);
  return (result as unknown as { data: { requestId: string; strategies: Array<{ strategy: string; plans: Array<{ vehicleCode: string }> }> } }).data;
}

describe('ipc · M4 调度', () => {
  let db: Db;
  let router: Router;
  let bus: EventBus;
  let admin: { token: string };
  let dispatcher: { token: string };
  let monitor: { token: string };

  beforeEach(() => {
    ({ db, router, bus, admin, dispatcher, monitor } = setup());
  });

  it('GET /api/dispatch/strategies：三条策略，字段与契约一致（dispatcher 可读）', async () => {
    const result = await router.invoke({ path: '/api/dispatch/strategies', token: dispatcher.token });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      const data = result.data as Array<{ key: string; label: string; description: string; enabled: boolean }>;
      expect(data.map((item) => item.key)).toEqual(['greedy', 'hungarian', 'genetic']);
      expect(Object.keys(data[0]!).sort()).toEqual(['description', 'enabled', 'key', 'label']);
      expect(data.filter((item) => item.enabled).map((item) => item.key)).toEqual(['greedy', 'hungarian']);
    }
  });

  it('POST /api/dispatch/preview：返回预览回执，但**不改业务数据**、也**不发事件**', async () => {
    const task = pendingTask(db);
    const sent = captureEvents(bus, dispatcher.token);

    const data = await previewVia(router, dispatcher.token, [task.id]);

    expect(data.requestId).toMatch(/^req_/);
    expect(data.strategies.map((item) => item.strategy)).toEqual(['greedy']);
    expect(data.strategies[0]!.plans.map((plan) => plan.vehicleCode)).toEqual(['CAR-01']);
    expect(get(db, 'SELECT status FROM tasks WHERE id = ?', [task.id])).toMatchObject({ status: 'pending' });
    // 预览不是「世界变了」，因此一条事件都不该发（否则地图会为一个没有变化的世界重拉快照）
    expect(sent).toEqual([]);
  });

  it('POST /api/dispatch/apply：落地并广播 task.changed / vehicle.changed / map.updated（S7）', async () => {
    const task = pendingTask(db);
    const preview = await previewVia(router, dispatcher.token, [task.id]);
    const sent = captureEvents(bus, dispatcher.token);

    const result = await router.invoke({
      path: '/api/dispatch/apply',
      method: 'POST',
      token: dispatcher.token,
      payload: { requestId: preview.requestId, strategy: 'greedy' }
    });

    expect(result.code).toBe(0);
    if (result.code === 0) {
      const data = result.data as { requestId: string; strategy: string; appliedPlans: Array<{ taskId: string; vehicleCode: string }> };
      expect(data).toMatchObject({ requestId: preview.requestId, strategy: 'greedy' });
      expect(data.appliedPlans).toHaveLength(1);
      expect(data.appliedPlans[0]).toMatchObject({ taskId: task.id, vehicleCode: 'CAR-01' });
    }
    // 三条事件按顺序发出，载荷带 requestId（界面据此把刷新与那次派发对上）
    expect(sent.map((event) => event.type)).toEqual(['task.changed', 'vehicle.changed', 'map.updated']);
    expect(sent[0]!.payload).toMatchObject({ requestId: preview.requestId, taskIds: [task.id] });
    expect(sent[1]!.payload).toMatchObject({ requestId: preview.requestId, vehicleIds: [SEED_IDS.vehicleCarrier] });
    // 事件是「提交后」发的：收到事件时数据已经能查到
    expect(get(db, 'SELECT status FROM tasks WHERE id = ?', [task.id])).toMatchObject({ status: 'assigned' });
  });

  it('apply 的幂等由服务层判：第二次同一 requestId → DISPATCH.ALREADY_APPLIED（不是 500）', async () => {
    const task = pendingTask(db);
    const preview = await previewVia(router, admin.token, [task.id]);
    await router.invoke({ path: '/api/dispatch/apply', method: 'POST', token: admin.token, payload: { requestId: preview.requestId, strategy: 'greedy' } });
    const again = await router.invoke({ path: '/api/dispatch/apply', method: 'POST', token: admin.token, payload: { requestId: preview.requestId, strategy: 'greedy' } });
    expect(again).toMatchObject({ code: 'DISPATCH.ALREADY_APPLIED', source: 'business' });
  });

  it('POST /api/dispatch/manual-assign：成功留痕；缺原因 / 约束不满足分别报 VALIDATION 与 DISPATCH.NO_CANDIDATE', async () => {
    const task = pendingTask(db);
    const ok = await router.invoke({
      path: '/api/dispatch/manual-assign',
      method: 'POST',
      token: dispatcher.token,
      payload: { taskId: task.id, vehicleId: SEED_IDS.vehicleCarrier, reason: '客户指定' }
    });
    expect(ok.code).toBe(0);
    if (ok.code === 0) {
      const data = ok.data as { requestId: string; appliedPlans: Array<{ vehicleCode: string }> };
      expect(data.requestId).toMatch(/^manual_/);
      expect(data.appliedPlans[0]!.vehicleCode).toBe('CAR-01');
    }

    const another = pendingTask(db);
    const noReason = await router.invoke({
      path: '/api/dispatch/manual-assign',
      method: 'POST',
      token: dispatcher.token,
      payload: { taskId: another.id, vehicleId: SEED_IDS.vehicleCarrier }
    });
    expect(noReason).toMatchObject({ code: 'VALIDATION.FAILED', source: 'validation' });

    // AGV-01 此刻被 seed 的演示任务占着（busy）→ 约束不满足，且原因来自内核的结构化拒绝
    const busy = await router.invoke({
      path: '/api/dispatch/manual-assign',
      method: 'POST',
      token: dispatcher.token,
      payload: { taskId: another.id, vehicleId: SEED_IDS.vehicleAgv, reason: '试试' }
    });
    expect(busy).toMatchObject({ code: 'DISPATCH.NO_CANDIDATE', source: 'business' });
    expect(((busy as { detail: { rejection: { reason: string } } }).detail.rejection).reason).toBe('VEHICLE_NOT_AVAILABLE');
  });

  it('POST /api/dispatch/recompute：回收后返回新预览，并广播三条事件', async () => {
    const task = pendingTask(db);
    const preview = await previewVia(router, dispatcher.token, [task.id]);
    await router.invoke({ path: '/api/dispatch/apply', method: 'POST', token: dispatcher.token, payload: { requestId: preview.requestId, strategy: 'greedy' } });

    const sent = captureEvents(bus, dispatcher.token);
    const result = await router.invoke({
      path: '/api/dispatch/recompute',
      method: 'POST',
      token: dispatcher.token,
      payload: { taskId: task.id, reason: 'A 仓封路', strategy: 'greedy' }
    });

    expect(result.code).toBe(0);
    if (result.code === 0) {
      const data = result.data as { requestId: string; strategies: unknown[] };
      expect(data.requestId).toMatch(/^req_/);
      expect(data.strategies).toHaveLength(1);
    }
    expect(sent.map((event) => event.type)).toEqual(['task.changed', 'vehicle.changed', 'map.updated']);
    expect(get(db, 'SELECT status FROM tasks WHERE id = ?', [task.id])).toMatchObject({ status: 'pending' });
    expect(get(db, 'SELECT status FROM vehicles WHERE id = ?', [SEED_IDS.vehicleCarrier])).toMatchObject({ status: 'idle' });
  });

  it('GET /api/dispatch/logs：分页信封 + 筛选；取值非法严格报错（不静默返回全部）', async () => {
    const task = pendingTask(db);
    await previewVia(router, dispatcher.token, [task.id]);

    const list = await router.invoke({ path: '/api/dispatch/logs', token: dispatcher.token, payload: { page: 1, pageSize: 10 } });
    expect(list.code).toBe(0);
    if (list.code === 0) {
      const data = list.data as { total: number; page: number; pageSize: number; records: Array<Record<string, unknown>> };
      expect(data.total).toBe(1);
      expect(data.page).toBe(1);
      expect(data.pageSize).toBe(10);
      // operatorName 来自**会话身份**（不是请求体），因此必须是这次调用者「调度员」
      expect(data.records[0]).toMatchObject({ action: 'preview', strategy: 'greedy', operatorName: '调度员' });
      expect(Object.keys(data.records[0]!)).not.toContain('outputSnapshot');
    }

    const filtered = await router.invoke({ path: '/api/dispatch/logs', token: dispatcher.token, payload: { taskId: task.id } });
    expect(filtered.code === 0 && (filtered.data as { total: number }).total).toBe(1);

    const bad = await router.invoke({ path: '/api/dispatch/logs', token: dispatcher.token, payload: { action: 'aply' } });
    expect(bad).toMatchObject({ code: 'VALIDATION.FAILED', source: 'validation' });
  });

  it('三条写路由必须是 POST：用 GET 调一律 API.ROUTE_NOT_FOUND（ISS-066 的回归护栏）', async () => {
    const task = pendingTask(db);
    const preview = await previewVia(router, admin.token, [task.id]);
    const writes: Array<{ path: string; payload: Record<string, unknown> }> = [
      { path: '/api/dispatch/preview', payload: { taskIds: [task.id], strategy: 'greedy' } },
      { path: '/api/dispatch/apply', payload: { requestId: preview.requestId, strategy: 'greedy' } },
      { path: '/api/dispatch/manual-assign', payload: { taskId: task.id, vehicleId: SEED_IDS.vehicleAgv, reason: 'x' } },
      { path: '/api/dispatch/recompute', payload: { taskId: task.id, reason: 'x' } }
    ];
    for (const call of writes) {
      const asGet = await router.invoke({ path: call.path, token: admin.token, payload: call.payload });
      expect(asGet, call.path).toMatchObject({ code: 'API.ROUTE_NOT_FOUND' });
      const asPost = await router.invoke({ ...call, method: 'POST', token: admin.token });
      expect(asPost.code, call.path).not.toBe('API.ROUTE_NOT_FOUND');
    }
  });

  it('S8 权限：monitor 六条全 AUTH.FORBIDDEN，未登录 AUTH.REQUIRED', async () => {
    const task = pendingTask(db);
    const calls: Array<{ path: string; method?: 'GET' | 'POST'; payload?: Record<string, unknown> }> = [
      { path: '/api/dispatch/strategies' },
      { path: '/api/dispatch/logs' },
      { path: '/api/dispatch/preview', method: 'POST', payload: { taskIds: [task.id], strategy: 'greedy' } },
      { path: '/api/dispatch/apply', method: 'POST', payload: { requestId: 'req-x', strategy: 'greedy' } },
      { path: '/api/dispatch/manual-assign', method: 'POST', payload: { taskId: task.id, vehicleId: SEED_IDS.vehicleAgv, reason: 'x' } },
      { path: '/api/dispatch/recompute', method: 'POST', payload: { taskId: task.id, reason: 'x' } }
    ];
    for (const call of calls) {
      const forbidden = await router.invoke({ ...call, token: monitor.token });
      expect(forbidden, call.path).toMatchObject({ code: 'AUTH.FORBIDDEN' });
      const anonymous = await router.invoke({ ...call });
      expect(anonymous, call.path).toMatchObject({ code: 'AUTH.REQUIRED' });
    }
    // 权限被拦下的请求不能留下任何痕迹（没写日志、没建计划）
    expect(get(db, 'SELECT COUNT(*) AS total FROM dispatch_logs')).toMatchObject({ total: 0 });
  });
});
