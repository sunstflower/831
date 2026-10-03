import { beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS, TASK_ACTIONS, TASK_API_ACTIONS, type TaskDetail, type TaskListItem } from '@udm/shared';
import { all, openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { seedFixture } from '../db/seed-fixture.js';
import { login } from '../services/auth.js';
import { ExecutionRunner } from '../domain/execution/executor.js';
import { EventBus } from '../services/event-bus.js';
import { SessionStore } from '../services/session.js';
import { createApiRoutes } from './api.js';
import { createRouter, type Router } from './router.js';

/**
 * M3 **任务接口**的传输层行为（`docs/api.md` §3.3）。
 *
 * 与 M2 的写接口用例同一套判据（方法 / 路径参数 / 权限 / 信封 / 事件时机），
 * 另加三件 M3 特有的事：
 *   1. **`?status=` 逗号多值**（契约要求），取值非法必须报错而不是静默忽略；
 *   2. **状态操作的暴露面**：`POST /api/tasks/{id}/{action}` 只认 `TASK_API_ACTIONS`
 *      —— `assign` / `start` / `complete` / `fail` 这些内部迁移必须像「没有这条路径」一样；
 *   3. **删除走 `DELETE`**，用 POST 调 `delete` 也必须是 404，而不是「成功删了」。
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
  return { db, router, admin, dispatcher, monitor };
}

const DRAFT = {
  title: '接口用例任务',
  cargoKg: 50,
  fromSiteId: SEED_IDS.siteDepot,
  toSiteId: SEED_IDS.siteDorm
};

describe('ipc · 任务接口（M3）', () => {
  let db: Db;
  let router: Router;
  let admin: { token: string };
  let dispatcher: { token: string };
  let monitor: { token: string };

  beforeEach(() => {
    ({ db, router, admin, dispatcher, monitor } = setup());
  });

  async function createTask(token: string, payload: Record<string, unknown> = {}): Promise<TaskDetail> {
    const result = await router.invoke({ path: '/api/tasks', method: 'POST', token, payload: { ...DRAFT, ...payload } });
    expect(result.code, JSON.stringify(result)).toBe(0);
    return (result as { data: TaskDetail }).data;
  }

  it('GET /api/tasks：返回派生字段（站点名 / 车辆编码），并支持整页信封', async () => {
    const result = await router.invoke({ path: '/api/tasks', token: monitor.token, payload: {} });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      const page = result.data as { records: TaskListItem[]; total: number; page: number; pageSize: number };
      const fixture = seedFixture();
      // seed 的 7 条任务都会出现在列表里（1 演示 + 6 待派发）
      expect(page).toMatchObject({ page: 1, total: fixture.tasks.length });
      const demo = page.records.find((row) => row.code === 'T-DEMO-0001')!;
      expect(demo).toMatchObject({
        status: 'running',
        fromSiteName: fixture.sites.find((site) => site.id === SEED_IDS.siteDepot)!.name,
        vehicleCode: 'AGV-01'
      });
    }
  });

  it('读取权限 task:read：monitor 能读；未登录 AUTH.REQUIRED', async () => {
    expect((await router.invoke({ path: '/api/tasks', token: monitor.token })).code).toBe(0);
    expect(await router.invoke({ path: '/api/tasks' })).toMatchObject({ code: 'AUTH.REQUIRED' });
  });

  it('?status= 支持逗号多值；取值非法一律报错（不静默放全量）', async () => {
    await createTask(admin.token, { title: '草稿一' });
    const multi = await router.invoke({ path: '/api/tasks', token: admin.token, payload: { status: 'draft, running' } });
    expect(multi.code).toBe(0);
    if (multi.code === 0) {
      const statuses = (multi.data as { records: TaskListItem[] }).records.map((row) => row.status).sort();
      expect(statuses).toEqual(['draft', 'running']);
    }
    expect(await router.invoke({ path: '/api/tasks', token: admin.token, payload: { status: 'draft,paused' } })).toMatchObject({
      code: 0
    });
    const bad = await router.invoke({ path: '/api/tasks', token: admin.token, payload: { status: 'draft,nope' } });
    expect(bad).toMatchObject({ code: 'VALIDATION.FAILED' });
    expect(await router.invoke({ path: '/api/tasks', token: admin.token, payload: { priority: 'urgent!' } })).toMatchObject({
      code: 'VALIDATION.FAILED'
    });
  });

  it('GET /api/tasks/{id}：详情带路线摘要与最近操作；不存在 → TASK.NOT_FOUND', async () => {
    const result = await router.invoke({ path: '/api/tasks/seed-task-demo', token: admin.token });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      const detail = result.data as TaskDetail;
      const demoRoute = seedFixture().demoRoute;
      expect(detail.route).toMatchObject({
        nodeCount: demoRoute.nodeIds.length,
        edgeCount: demoRoute.nodeIds.length - 1
      });
      expect(detail.currentPlan).toBeNull();
      expect(detail.pauseReason).toBeNull();
      expect(detail.auditSummaries).toEqual([]);
    }
    expect(await router.invoke({ path: '/api/tasks/nope', token: admin.token })).toMatchObject({ code: 'TASK.NOT_FOUND' });
  });

  it('POST /api/tasks：dispatcher 可写（这是调度员的日常），monitor 一律 AUTH.FORBIDDEN', async () => {
    const created = await createTask(dispatcher.token);
    expect(created.status).toBe('draft');
    expect(created.code).toMatch(/^T\d{8}-\d{4}$/);
    expect(
      await router.invoke({ path: '/api/tasks', method: 'POST', token: monitor.token, payload: DRAFT })
    ).toMatchObject({ code: 'AUTH.FORBIDDEN' });
    expect(await router.invoke({ path: '/api/tasks', method: 'POST', payload: DRAFT })).toMatchObject({
      code: 'AUTH.REQUIRED'
    });
  });

  it('状态操作：POST /api/tasks/{id}/submit 返回 transition，并发出 task.changed 事件', async () => {
    const task = await createTask(admin.token);
    const result = await router.invoke({
      path: `/api/tasks/${task.id}/submit`,
      method: 'POST',
      token: admin.token,
      payload: {}
    });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      expect(result.data).toMatchObject({ status: 'pending', transition: { from: 'draft', to: 'pending' } });
    }
    // 事件在事务提交之后发：订阅者收到时新数据已经能查到
    const events = all<{ type: string; payload: string }>(db, 'SELECT type, payload FROM event_log ORDER BY seq');
    expect(events.map((row) => row.type)).toEqual(['task.changed', 'task.changed']);
    expect(events[1]?.payload).toContain('task.submit');
    const reread = await router.invoke({ path: `/api/tasks/${task.id}`, token: admin.token });
    expect(reread.code === 0 && (reread.data as TaskDetail).status).toBe('pending');
  });

  it('必填原因缺失 → VALIDATION.FAILED；非法迁移 → TASK.STATE_CONFLICT（不是 500）', async () => {
    const task = await createTask(admin.token);
    // 先提交进候选池：`pending` 才是可取消的状态。**顺序说明** —— 非法迁移优先于缺原因，
    // 因为对一条草稿说「你没给取消原因」是误导（它压根不能被取消）
    await router.invoke({ path: `/api/tasks/${task.id}/submit`, method: 'POST', token: admin.token, payload: {} });
    const noReason = await router.invoke({
      path: `/api/tasks/${task.id}/cancel`,
      method: 'POST',
      token: admin.token,
      payload: {}
    });
    expect(noReason).toMatchObject({ code: 'VALIDATION.FAILED' });
    const conflict = await router.invoke({
      path: `/api/tasks/${task.id}/pause`,
      method: 'POST',
      token: admin.token,
      payload: { reason: '想暂停' }
    });
    expect(conflict).toMatchObject({ code: 'TASK.STATE_CONFLICT' });
    if (conflict.code !== 0) {
      // 任务此刻是 pending（上面提交过），而「暂停」只允许在 running 上执行
      expect(conflict.detail).toMatchObject({ from: 'pending', expected: ['running'] });
    }
  });

  it('暴露面由状态机决定：只有 TASK_API_ACTIONS（去掉 delete）能在 POST 路径上命中', async () => {
    const task = await createTask(admin.token);
    const exposed = new Set(TASK_API_ACTIONS.filter((action) => action !== 'delete'));
    for (const action of TASK_ACTIONS) {
      const result = await router.invoke({
        path: `/api/tasks/${task.id}/${action}`,
        method: 'POST',
        token: admin.token,
        payload: { reason: '用例原因' }
      });
      if (exposed.has(action)) {
        // 暴露的动作不该是「没有这条路径」；它可能是状态冲突或成功
        expect(result.code, `${action} 应当被暴露`).not.toBe('API.ROUTE_NOT_FOUND');
      } else {
        expect(result.code, `${action} 不应当被暴露`).toBe('API.ROUTE_NOT_FOUND');
      }
    }
    // delete 走 DELETE 而不是 POST
    expect(
      (await router.invoke({ path: `/api/tasks/${task.id}/delete`, method: 'POST', token: admin.token })).code
    ).toBe('API.ROUTE_NOT_FOUND');
  });

  it('DELETE /api/tasks/{id}：草稿可删；其余状态 TASK.STATE_CONFLICT；monitor 无权', async () => {
    const task = await createTask(admin.token);
    const deleted = await router.invoke({ path: `/api/tasks/${task.id}`, method: 'DELETE', token: admin.token });
    expect(deleted.code).toBe(0);
    expect(await router.invoke({ path: `/api/tasks/${task.id}`, token: admin.token })).toMatchObject({
      code: 'TASK.NOT_FOUND'
    });
    expect(
      await router.invoke({ path: '/api/tasks/seed-task-demo', method: 'DELETE', token: admin.token })
    ).toMatchObject({ code: 'TASK.STATE_CONFLICT' });
    expect(
      await router.invoke({ path: '/api/tasks/seed-task-demo', method: 'DELETE', token: monitor.token })
    ).toMatchObject({ code: 'AUTH.FORBIDDEN' });
  });

  it('PUT /api/tasks/{id}：只发改动字段；已派发任务的编辑被拒', async () => {
    const task = await createTask(admin.token, {
      timeWindowStart: '2026-09-27T08:00:00.000Z',
      timeWindowEnd: '2026-09-27T09:00:00.000Z'
    });
    const updated = await router.invoke({
      path: `/api/tasks/${task.id}`,
      method: 'PUT',
      token: admin.token,
      payload: { title: '改过的标题' }
    });
    expect(updated.code).toBe(0);
    if (updated.code === 0) {
      expect(updated.data).toMatchObject({ title: '改过的标题', timeWindowStart: '2026-09-27T08:00:00.000Z' });
    }
    expect(
      await router.invoke({
        path: '/api/tasks/seed-task-demo',
        method: 'PUT',
        token: admin.token,
        payload: { title: '偷偷改' }
      })
    ).toMatchObject({ code: 'TASK.STATE_CONFLICT' });
  });
});
