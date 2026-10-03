import { describe, expect, it } from 'vitest';
import { SEED_IDS } from '@udm/shared';
import { openDatabase } from '../../../desktop/src/db/index';
import { applyMigrations } from '../../../desktop/src/db/migrate';
import { seedDatabase } from '../../../desktop/src/db/seed';
import { login } from '../../../desktop/src/services/auth';
import { EventBus } from '../../../desktop/src/services/event-bus';
import { SessionStore } from '../../../desktop/src/services/session';
import { ExecutionRunner } from '../../../desktop/src/domain/execution/executor';
import { createApiRoutes } from '../../../desktop/src/ipc/api';
import { createRouter, type Router } from '../../../desktop/src/ipc/router';
import { createMockAdapter } from './mock';
import type { ApiClient } from './client';

/**
 * M4 调度在 Mock 与主进程之间的**行为一致性**。
 *
 * 两边的算法是同一份（`@udm/shared` 的 `runDispatch`），因此本文件不重复算法用例
 * （那些在 `shared/src/dispatch-*.test.ts`）。这里要证明的是**两份存储实现给出的结论相同**：
 * 同一批待派任务、同一个策略，浏览器与 Electron 必须派出**同一辆车、同一个代价、
 * 同一组拒绝原因与 detail** —— 否则「浏览器里试好的方案，切到桌面端就变成另一套」。
 *
 * 显式排除的东西（与 `mock-parity.test.ts` 同一套纪律，写在测试里而不是用 `anything()`）：
 *   - `occupiedFrom` / `occupiedTo` / `createdAt`：以「现在」为基准，两边调用时刻必然不同；
 *   - `elapsedMs`：计算耗时；
 *   - `explain`：唯一作者是主进程 `explain.ts`，Mock 侧为空数组（见 `mock-dispatch.ts` 文件头）。
 *
 * ⚠️ 两个适配器的 `invoke` 签名**不同**（这是设计如此，不是笔误）：
 * `ApiClient` 是 `invoke(path, payload, token, options)`，而主进程 `Router` 是
 * `invoke({ path, method, token, payload })`。因此下面的辅助函数各写一份 ——
 * 实测把它们合成一个 `Function` 类型会得到 `Cannot read properties of undefined (reading 'split')`。
 */
const TASK_INPUT = {
  title: '一致性用例：A 仓 → B 仓',
  cargoKg: 100,
  fromSiteId: SEED_IDS.siteDepot,
  toSiteId: SEED_IDS.siteDorm,
  submit: true,
  priority: 'normal'
};

interface PreviewLike {
  requestId: string;
  strategies: Array<{
    strategy: string;
    plans: Array<{ vehicleCode: string; cost: number; costDetail: Record<string, number>; occupiedFrom: string }>;
    rejected: Array<{ reason: string; detail: Record<string, unknown> }>;
    summary: { totalTasks: number; assigned: number; rejectedCount: number };
  }>;
}

/** 与「现在」相关或属实现细节的字段在这里被剔除；其余逐项比较。 */
function normalized(preview: PreviewLike) {
  return preview.strategies.map((outcome) => ({
    strategy: outcome.strategy,
    plans: outcome.plans.map((plan) => ({
      vehicleCode: plan.vehicleCode,
      cost: plan.cost,
      costDetail: plan.costDetail
    })),
    rejected: outcome.rejected.map((item) => ({ reason: item.reason, detail: item.detail })),
    // `elapsedMs` 是计算耗时，两边必然不同（见文件头排除项）
    summary: {
      totalTasks: outcome.summary.totalTasks,
      assigned: outcome.summary.assigned,
      rejectedCount: outcome.summary.rejectedCount
    }
  }));
}

function setupReal(): { db: ReturnType<typeof openDatabase>; router: Router; token: string } {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  const sessions = new SessionStore();
  const bus = new EventBus(db, sessions);
  // 与主进程同构：执行器按依赖注入（M7）。这些用例不点执行接口，但签名必须一致
  const executor = new ExecutionRunner(db, bus);
  const router = createRouter(createApiRoutes({ db, sessions, bus, executor }), { db, sessions });
  const admin = login(db, sessions, { username: 'admin', password: 'admin123' }, 't-m4-parity');
  return { db, router, token: admin.token };
}

async function loginMock(mock: ApiClient, username = 'admin', password = 'admin123'): Promise<string> {
  const result = await mock.invoke<{ token: string }>('/api/auth/login', { username, password }, null, { method: 'POST' });
  expect(result.code, JSON.stringify(result)).toBe(0);
  return (result as unknown as { data: { token: string } }).data.token;
}

async function createTaskViaRouter(router: Router, token: string, payload: Record<string, unknown> = {}): Promise<string> {
  const created = await router.invoke({ path: '/api/tasks', method: 'POST', token, payload: { ...TASK_INPUT, ...payload } });
  expect(created.code, JSON.stringify(created)).toBe(0);
  return (created as unknown as { data: { id: string } }).data.id;
}

async function createTaskViaMock(mock: ApiClient, token: string, payload: Record<string, unknown> = {}): Promise<string> {
  const created = await mock.invoke<{ id: string }>('/api/tasks', { ...TASK_INPUT, ...payload }, token, { method: 'POST' });
  expect(created.code, JSON.stringify(created)).toBe(0);
  return (created as unknown as { data: { id: string } }).data.id;
}

describe('mock 适配器 · M4 调度与主进程一致', () => {
  it('同一批待派任务：两层派给同一辆车、同一代价、同一拒绝原因与 detail（strategy=all）', async () => {
    const { db, router, token } = setupReal();
    const mock = createMockAdapter();
    const mockToken = await loginMock(mock);

    const realTaskId = await createTaskViaRouter(router, token);
    const mockTaskId = await createTaskViaMock(mock, mockToken);

    const real = await router.invoke({ path: '/api/dispatch/preview', method: 'POST', token, payload: { taskIds: [realTaskId], strategy: 'all' } });
    const mocked = await mock.invoke<PreviewLike>('/api/dispatch/preview', { taskIds: [mockTaskId], strategy: 'all' }, mockToken, { method: 'POST' });
    expect(real.code).toBe(0);
    expect(mocked.code).toBe(0);

    const realData = (real as unknown as { data: PreviewLike }).data;
    const mockData = (mocked as unknown as { data: PreviewLike }).data;
    expect(realData.strategies.map((item) => item.strategy)).toEqual(['greedy', 'hungarian']);
    expect(mockData.strategies.map((item) => item.strategy)).toEqual(['greedy', 'hungarian']);
    expect(normalized(mockData)).toEqual(normalized(realData));
    // 护栏自检：两边都不是空结果（否则上面那条「相等」只是在比较两个空数组）
    expect(realData.strategies[0]!.plans.length + realData.strategies[0]!.rejected.length).toBeGreaterThan(0);
    db.close();
  });

  it('超编 / 超高载重：两层的拒绝原因与 detail 逐项相同（Req-M4-2）', async () => {
    const { db, router, token } = setupReal();
    const mock = createMockAdapter();
    const mockToken = await loginMock(mock);

    // 载重必须超过**全部车辆**的上限（当前最大是 CAR-02 的 1200 kg）：
    // 900 kg 时 CAR-02 能装，两层的「拒绝」就变成了「成功派给另一台车」
    const realTaskId = await createTaskViaRouter(router, token, { cargoKg: 2000 });
    const mockTaskId = await createTaskViaMock(mock, mockToken, { cargoKg: 2000 });

    const real = await router.invoke({ path: '/api/dispatch/preview', method: 'POST', token, payload: { taskIds: [realTaskId], strategy: 'greedy' } });
    const mocked = await mock.invoke<PreviewLike>('/api/dispatch/preview', { taskIds: [mockTaskId], strategy: 'greedy' }, mockToken, { method: 'POST' });
    const realOutcome = (real as unknown as { data: PreviewLike }).data.strategies[0]!;
    const mockOutcome = (mocked as unknown as { data: PreviewLike }).data.strategies[0]!;

    expect(mockOutcome.plans).toHaveLength(0);
    expect(mockOutcome.rejected.map((item) => ({ reason: item.reason, detail: item.detail }))).toEqual(
      realOutcome.rejected.map((item) => ({ reason: item.reason, detail: item.detail }))
    );
    // seed 里 AGV-01 被演示任务占着 → 首个失败原因是「车辆不可用」，detail 带车号与状态
    expect(realOutcome.rejected[0]).toMatchObject({ reason: 'VEHICLE_NOT_AVAILABLE', detail: { vehicleCode: 'AGV-01', status: 'busy' } });
    db.close();
  });

  it('Mock 侧的完整链路：预览 → 应用 → 日志 → 重算（任务与车辆状态逐步可查）', async () => {
    const mock = createMockAdapter();
    const mockToken = await loginMock(mock);
    const taskId = await createTaskViaMock(mock, mockToken);

    const preview = await mock.invoke<PreviewLike>('/api/dispatch/preview', { taskIds: [taskId], strategy: 'greedy' }, mockToken, { method: 'POST' });
    const previewData = (preview as unknown as { data: PreviewLike }).data;
    expect((preview as unknown as { data: { strategies: Array<{ plans: unknown[] }> } }).data.strategies[0]!.plans).toHaveLength(1);

    const applied = await mock.invoke<{ appliedPlans: Array<{ vehicleCode: string }> }>(
      '/api/dispatch/apply',
      { requestId: previewData.requestId, strategy: 'greedy' },
      mockToken,
      { method: 'POST' }
    );
    expect(applied.code).toBe(0);
    expect((applied as unknown as { data: { appliedPlans: Array<{ vehicleCode: string }> } }).data.appliedPlans[0]!.vehicleCode).toBe('CAR-01');

    // 任务与车辆状态必须跟着变（这是「应用」与「预览」唯一的可见差别）
    const detail = await mock.invoke<{ status: string; assignedVehicleId: string | null; route: unknown }>(
      `/api/tasks/${taskId}`,
      {},
      mockToken
    );
    expect(detail.code === 0 && (detail.data as { status: string }).status).toBe('assigned');
    expect((detail as unknown as { data: { assignedVehicleId: string } }).data.assignedVehicleId).toBe(SEED_IDS.vehicleCarrier);
    expect((detail as unknown as { data: { route: unknown } }).data.route).not.toBeNull();

    // 二次应用同一 requestId → 幂等拒绝（与主进程同一个错误码）
    const again = await mock.invoke('/api/dispatch/apply', { requestId: previewData.requestId, strategy: 'greedy' }, mockToken, { method: 'POST' });
    expect(again).toMatchObject({ code: 'DISPATCH.ALREADY_APPLIED' });

    // 日志按「新的在前」列出：先 apply，再 preview
    const logs = (await mock.invoke('/api/dispatch/logs', { page: 1, pageSize: 10 }, mockToken)) as unknown as {
      code: number;
      data: { total: number; records: Array<{ action: string }> };
    };
    expect(logs.data.total).toBe(2);
    expect(logs.data.records.map((row) => row.action)).toEqual(['apply', 'preview']);

    const recomputed = await mock.invoke<PreviewLike>('/api/dispatch/recompute', { taskId, reason: 'A 仓封路', strategy: 'greedy' }, mockToken, { method: 'POST' });
    expect(recomputed.code).toBe(0);
    const afterRecompute = await mock.invoke<{ status: string }>(`/api/tasks/${taskId}`, {}, mockToken);
    expect((afterRecompute as { data: { status: string } }).data.status).toBe('pending');
    // 重算 = 回收日志 + 新预览日志 → 共 4 条（§10.4 的「成对」）
    const logs2 = await mock.invoke<{ total: number }>('/api/dispatch/logs', { page: 1, pageSize: 10 }, mockToken);
    expect((logs2 as unknown as { data: { total: number } }).data.total).toBe(4);
  });

  it('同一车串行拉两单：两面都能一次派成（而不是「车辆状态不允许该操作」）', async () => {
    /*
     * 回归（本轮实测发现）：内核允许一辆车在一批里串行拉多单（占用区间不重叠），
     * 但「预留」在两侧都是 `idle → reserved` 的单次跃迁 —— 第二条计划再预留同一辆车时，
     * 主进程条件 UPDATE 返回 0 行、Mock 判「状态不是 idle」，两边都会整批失败，
     * 报出一句与事实无关的「车辆状态不允许该操作」。
     *
     * 载荷选 120kg + 400kg：DRN-01 载重 50kg 装不下、AGV-01 在 seed 里是 busy，
     * 于是两单只能由 CAR-01 串行完成 —— 正是走查时碰到的那个组合。
     */
    const { db, router, token } = setupReal();
    const mock = createMockAdapter();
    const mockToken = await loginMock(mock);

    const cargo = { first: { cargoKg: 120, priority: 'high' }, second: { cargoKg: 400, priority: 'normal', fromSiteId: SEED_IDS.siteDorm, toSiteId: SEED_IDS.siteDepot } };
    const realIds = [await createTaskViaRouter(router, token, cargo.first), await createTaskViaRouter(router, token, cargo.second)];
    const mockIds = [await createTaskViaMock(mock, mockToken, cargo.first), await createTaskViaMock(mock, mockToken, cargo.second)];

    const realPreview = (await router.invoke({ path: '/api/dispatch/preview', method: 'POST', token, payload: { taskIds: realIds, strategy: 'greedy' } })) as unknown as { data: PreviewLike };
    const mockPreview = (await mock.invoke<PreviewLike>('/api/dispatch/preview', { taskIds: mockIds, strategy: 'greedy' }, mockToken, { method: 'POST' })) as unknown as { data: PreviewLike };
    // 两面都必须认为这两单可派给同一辆车（否则本用例的前提不成立）
    expect(realPreview.data.strategies[0]!.plans.map((plan) => plan.vehicleCode)).toEqual(['CAR-01', 'CAR-01']);
    expect(mockPreview.data.strategies[0]!.plans.map((plan) => plan.vehicleCode)).toEqual(['CAR-01', 'CAR-01']);

    const realApplied = await router.invoke({ path: '/api/dispatch/apply', method: 'POST', token, payload: { requestId: realPreview.data.requestId, strategy: 'greedy' } });
    const mockApplied = await mock.invoke<{ appliedPlans: unknown[] }>('/api/dispatch/apply', { requestId: mockPreview.data.requestId, strategy: 'greedy' }, mockToken, { method: 'POST' });
    expect(realApplied.code, JSON.stringify(realApplied)).toBe(0);
    expect(mockApplied.code, JSON.stringify(mockApplied)).toBe(0);
    expect((realApplied as unknown as { data: { appliedPlans: unknown[] } }).data.appliedPlans).toHaveLength(2);
    expect((mockApplied as unknown as { data: { appliedPlans: unknown[] } }).data.appliedPlans).toHaveLength(2);

    // 两侧车辆都停在 reserved（同车两单 → 回收任意一单都不能把它置 idle）
    // 车辆没有「按 id 读」的路由，按列表过滤（契约如此）
    const statusOf = async (side: 'real' | 'mock', t: string) => {
      const rows =
        side === 'real'
          ? ((await router.invoke({ path: '/api/vehicles', token: t, payload: { page: 1, pageSize: 20 } })) as unknown as {
              data: { records: Array<{ id: string; status: string }> };
            }).data.records
          : ((await mock.invoke<{ records: Array<{ id: string; status: string }> }>('/api/vehicles', { page: 1, pageSize: 20 }, t)) as unknown as {
              data: { records: Array<{ id: string; status: string }> };
            }).data.records;
      return rows.find((row) => row.id === SEED_IDS.vehicleCarrier)?.status;
    };
    expect(await statusOf('real', token)).toBe('reserved');
    expect(await statusOf('mock', mockToken)).toBe('reserved');

    // 回收第一单：另一单还挂着 → 车辆不得被置 idle（两侧同判据）
    await router.invoke({ path: '/api/dispatch/recompute', method: 'POST', token, payload: { taskId: realIds[0], reason: '回归：回收第一单', strategy: 'greedy' } });
    await mock.invoke('/api/dispatch/recompute', { taskId: mockIds[0], reason: '回归：回收第一单', strategy: 'greedy' }, mockToken, { method: 'POST' });
    expect(await statusOf('real', token)).toBe('reserved');
    expect(await statusOf('mock', mockToken)).toBe('reserved');
    db.close();
  });

  it('Mock 侧的候选不合法时返回与主进程相同的错误码', async () => {
    const mock = createMockAdapter();
    const mockToken = await loginMock(mock);
    const taskId = await createTaskViaMock(mock, mockToken);

    const cases: Array<{ label: string; path: string; payload: Record<string, unknown>; code: string }> = [
      { label: '任务不存在', path: '/api/dispatch/preview', payload: { taskIds: ['ghost'], strategy: 'greedy' }, code: 'TASK.NOT_FOUND' },
      { label: '未实现策略', path: '/api/dispatch/preview', payload: { taskIds: [taskId], strategy: 'genetic' }, code: 'VALIDATION.FAILED' },
      { label: '空任务列表', path: '/api/dispatch/preview', payload: { taskIds: [], strategy: 'greedy' }, code: 'VALIDATION.FAILED' },
      { label: 'apply 传 all', path: '/api/dispatch/apply', payload: { requestId: 'req-x', strategy: 'all' }, code: 'VALIDATION.FAILED' },
      { label: '请求不存在', path: '/api/dispatch/apply', payload: { requestId: 'req-x', strategy: 'greedy' }, code: 'DISPATCH.REQUEST_NOT_FOUND' },
      { label: '手动指派缺原因', path: '/api/dispatch/manual-assign', payload: { taskId, vehicleId: SEED_IDS.vehicleCarrier }, code: 'VALIDATION.FAILED' },
      { label: '手动指派车辆不存在', path: '/api/dispatch/manual-assign', payload: { taskId, vehicleId: 'ghost', reason: 'r' }, code: 'VEHICLE.NOT_FOUND' },
      { label: '手动指派给忙碌的车', path: '/api/dispatch/manual-assign', payload: { taskId, vehicleId: SEED_IDS.vehicleAgv, reason: 'r' }, code: 'DISPATCH.NO_CANDIDATE' },
      { label: '重算任务不存在', path: '/api/dispatch/recompute', payload: { taskId: 'ghost', reason: 'r', strategy: 'greedy' }, code: 'TASK.NOT_FOUND' },
      { label: '重算未派发任务', path: '/api/dispatch/recompute', payload: { taskId, reason: 'r', strategy: 'greedy' }, code: 'TASK.STATE_CONFLICT' },
      { label: '日志筛选非法', path: '/api/dispatch/logs', payload: { action: 'aply' }, code: 'VALIDATION.FAILED' }
    ];
    for (const item of cases) {
      const result =
        item.path === '/api/dispatch/logs'
          ? await mock.invoke(item.path, item.payload, mockToken)
          : await mock.invoke(item.path, item.payload, mockToken, { method: 'POST' });
      expect(result.code, item.label).toBe(item.code);
    }
  });

  it('Mock 侧的权限服务端式强制：监控员调预览被拒，调度员可以（与主进程同一错误码）', async () => {
    const mock = createMockAdapter();
    const monitorToken = await loginMock(mock, 'monitor', 'monitor123');
    const forbidden = await mock.invoke('/api/dispatch/preview', { taskIds: ['x'], strategy: 'greedy' }, monitorToken, { method: 'POST' });
    expect(forbidden).toMatchObject({ code: 'AUTH.FORBIDDEN' });

    const dispatcherToken = await loginMock(mock, 'dispatcher', 'dispatcher123');
    const asDispatcher = await mock.invoke('/api/dispatch/preview', { taskIds: ['ghost'], strategy: 'greedy' }, dispatcherToken, { method: 'POST' });
    // 权限过了之后才会因「任务不存在」失败 —— 这正好证明「不是被权限拦下的」
    expect(asDispatcher).toMatchObject({ code: 'TASK.NOT_FOUND' });
  });
});
