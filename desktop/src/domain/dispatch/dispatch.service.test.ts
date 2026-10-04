import { beforeEach, describe, expect, it } from 'vitest';
import { DISPATCH_UNSERVED_PENALTY_S, SEED_IDS, type AuditContext, type DomainError } from '@udm/shared';
import { all, get, openDatabase, run, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { seedDatabase } from '../../db/seed.js';
import type { CrudContext } from '../base/context.js';
import { createTask, operateTask } from '../task/task.service.js';
import { apply, listDispatchLogs, listStrategies, manualAssign, preview, recompute } from './dispatch.service.js';

/**
 * M4 调度服务的**行为**（`docs/api.md` §3.4、`docs/module-M4-dispatch.md` §10 / §14.2）。
 *
 * 算法本身（贪心排序、匈牙利整体指派、六步短路、占用半开区间）由
 * `shared/src/dispatch-*.test.ts` 的 49 个用例断言，这里**不重复**：内核与 DB 无关，
 * 拿真实库再跑一遍「谁该派给谁」只会把两处期望值绑在一起，改一处要改两处。
 *
 * 本文件要证明的是服务层独有的四件事：
 *
 *   1. **preview 是只读的**（Req-M4-3）：只多一条 `dispatch_logs`，不动任务 / 车辆 /
 *      计划 / 路线 —— 这是「先预览后生效」的地基，一旦它写了半个字，整条承诺失效；
 *   2. **apply 按存档输出落地**（§10.2）：任务 `pending→assigned`、车辆 `idle→reserved`、
 *      plan + route + log + audit 四件套齐，且**同一 requestId 只能应用一次**；
 *   3. **并发用条件更新兜底**（§10.2 保护 1）：预览后被别人抢单 / 取消，apply 必须整体
 *      回滚且**不留脏数据**（不是「部分派发」）；
 *   4. **重算是三步而不是一步**（§10.4）：回收 → 任务回 `pending` → 产出**新预览**，
 *      且回收日志与新预览**共用一个 requestId**（否则事后对不上「因为什么重算了哪张单」）。
 *
 * 权限（S8：dispatcher 可通过、monitor 被拒）**不在本层**：与其它模块一致，
 * 权限由 `ipc/router.ts` 在路由注册表上集中强制（见 `ipc/api.dispatch.test.ts`）。
 *
 * 用 seed 的**真实站点 / 车辆 / 校园路网**：期望值因此与界面、与手工走查对得上
 * （D-26 同类口径）。里程与耗时**不写死字面量** —— 它们由拥堵权重与占道封路共同决定，
 * 写死会让「换一份地图数据」变成 20 个用例同时变红（本轮实测）。
 */
const ACTOR: AuditContext = { actorId: 'seed-admin', actorName: 'admin', role: 'admin', traceId: 'trace-m4' };

function setup(): { db: Db; ctx: CrudContext } {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  return { db, ctx: { db, actor: ACTOR } };
}

function expectDomainError(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (error) {
    const domainError = error as DomainError;
    expect(domainError.code, `期望 ${code}，实际 ${domainError.code}`).toBe(code);
    return domainError;
  }
  throw new Error(`期望抛出 ${code}，但没有抛`);
}

function count(db: Db, sql: string, ...params: unknown[]): number {
  return Number(get<{ total: number }>(db, sql, params as never[])?.total ?? 0);
}

const n = (index: number) => `seed-n${String(index).padStart(2, '0')}`;

let seq = 0;
/** 造一条 `pending` 任务（走真实状态机：`draft → submit → pending`）。 */
function pendingTask(ctx: CrudContext, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return createTask(ctx, {
    title: `调度用例任务 ${seq}`,
    cargoKg: 100,
    fromSiteId: SEED_IDS.siteDepot,
    toSiteId: SEED_IDS.siteDorm,
    submit: true,
    ...overrides
  });
}

function taskRow(db: Db, id: string) {
  return get<{ status: string; assigned_vehicle_id: string | null; plan_id: string | null }>(
    db,
    'SELECT status, assigned_vehicle_id, plan_id FROM tasks WHERE id = ?',
    [id]
  );
}

function vehicleStatus(db: Db, id: string): string {
  return get<{ status: string }>(db, 'SELECT status FROM vehicles WHERE id = ?', [id])?.status ?? '';
}

let db: Db;
let ctx: CrudContext;

describe('M4 调度服务 · preview', () => {
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('S1 预览只读：任务仍 pending、车辆仍 idle，只多一条 dispatch_logs（Req-M4-3）', () => {
    const task = pendingTask(ctx);
    const plansBefore = count(db, 'SELECT COUNT(*) AS total FROM dispatch_plans');
    const routesBefore = count(db, 'SELECT COUNT(*) AS total FROM routes');
    const logsBefore = count(db, "SELECT COUNT(*) AS total FROM dispatch_logs WHERE action = 'preview'");

    const result = preview(ctx, { taskIds: [task.id], strategy: 'greedy' });

    expect(result.requestId).toMatch(/^req_/);
    expect(result.strategies).toHaveLength(1);
    const outcome = result.strategies[0]!;
    // seed 状态：AGV-01 busy、DRN-01 载重 50kg 装不下 100kg，唯一可行的是 CAR-01
    expect(outcome.plans).toHaveLength(1);
    expect(outcome.plans[0]).toMatchObject({ vehicleCode: 'CAR-01', taskId: task.id });
    expect(outcome.summary).toMatchObject({ totalTasks: 1, assigned: 1, rejectedCount: 0 });

    // 只读：任务 / 车辆 / 计划 / 路线一律没动
    expect(taskRow(db, task.id)?.status).toBe('pending');
    expect(vehicleStatus(db, SEED_IDS.vehicleCarrier)).toBe('idle');
    expect(count(db, 'SELECT COUNT(*) AS total FROM dispatch_plans')).toBe(plansBefore);
    expect(count(db, 'SELECT COUNT(*) AS total FROM routes')).toBe(routesBefore);
    // 只有日志 +1（预览本身要留痕，Req-M4-6）
    expect(count(db, "SELECT COUNT(*) AS total FROM dispatch_logs WHERE action = 'preview'")).toBe(logsBefore + 1);
  });

  it('未派发惩罚大于本演示数据里任何一条可行计划的代价（「能派就派」的数据护栏）', () => {
    // 口径护栏：惩罚必须盖过「单条最贵计划」，否则拒绝一单会让总分变低。
    // 用真实 seed 数据穷举（所有待派任务 × 所有候选车辆），改地图或调小惩罚时先红。
    const result = preview(ctx, { taskIds: [...SEED_IDS.pendingTasks], strategy: 'all' });
    const costs = result.strategies.flatMap((outcome) => outcome.plans.map((plan) => plan.cost));
    expect(costs.length).toBeGreaterThan(0);
    expect(DISPATCH_UNSERVED_PENALTY_S).toBeGreaterThan(Math.max(...costs));
    // 反例形态：拒一单的分数增量必须为正（曾出现「拒得多反而分低」）
    expect(DISPATCH_UNSERVED_PENALTY_S).toBeGreaterThan(0);
  });

  it('预览落库的 output_snapshot 就是回执：apply 靠它做到「所见即所得」', () => {
    const task = pendingTask(ctx);
    const result = preview(ctx, { taskIds: [task.id], strategy: 'greedy' });
    const stored = get<{ output_snapshot: string }>(
      db,
      'SELECT output_snapshot FROM dispatch_logs WHERE request_id = ?',
      [result.requestId]
    );
    const parsed = JSON.parse(stored!.output_snapshot) as Array<{ plans: unknown[]; explanation: unknown }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.plans).toHaveLength(1);
  });

  it("strategy='all' 按固定顺序返回两个策略（顺序稳定，界面才能逐列对比）", () => {
    const task = pendingTask(ctx);
    const result = preview(ctx, { taskIds: [task.id], strategy: 'all' });
    expect(result.strategies.map((item) => item.strategy)).toEqual(['greedy', 'hungarian']);
    // 只有一个任务、一辆可用车时，两策略结论必须一致（否则是内核不一致，不是策略差异）
    for (const outcome of result.strategies) {
      expect(outcome.plans.map((plan) => plan.vehicleCode)).toEqual(['CAR-01']);
    }
  });

  it('U11 explain：每条派发 / 拒绝都有可读文案（含具体秒数与金额外的上下文）', () => {
    const task = pendingTask(ctx);
    const outcome = preview(ctx, { taskIds: [task.id], strategy: 'greedy' }).strategies[0]!;
    const lines = outcome.explain;
    expect(lines).toHaveLength(outcome.plans.length + outcome.rejected.length + 1);
    expect(lines[0]).toContain('CAR-01');
    expect(lines[0]).toContain('空驶');
    expect(lines.at(-1)).toContain('贪心');
  });

  it('超高载重任务被拒：reason 与 detail 都带具体数字（Req-M4-2）', () => {
    // 把演示车 AGV-01 放开，否则它会以 VEHICLE_NOT_AVAILABLE 抢先成为「第一个失败原因」
    run(db, "UPDATE vehicles SET status = 'idle' WHERE id = ?", [SEED_IDS.vehicleAgv]);
    // 载重必须**超过全部车辆**的上限（当前最大是 CAR-02 的 1200 kg），
    // 否则「没有车能装」会变成「另一台车能装」——那测的就不是拒绝原因了
    const task = pendingTask(ctx, { cargoKg: 2000 });

    const outcome = preview(ctx, { taskIds: [task.id], strategy: 'greedy' }).strategies[0]!;
    expect(outcome.plans).toHaveLength(0);
    expect(outcome.rejected).toHaveLength(1);
    // 第一个被评估的车（按 code 升序）给出「载重超限」这一条原因
    expect(outcome.rejected[0]).toMatchObject({
      taskId: task.id,
      reason: 'LOAD_EXCEEDED',
      detail: { cargoKg: 2000, vehicleCode: 'AGV-01' }
    });
    expect(outcome.explain.some((line) => line.includes('载重超限'))).toBe(true);
    expect(count(db, 'SELECT COUNT(*) AS total FROM dispatch_plans')).toBe(0);
  });

  it('非 pending 任务进不了预览：TASK.STATE_CONFLICT 且指出是哪些任务', () => {
    const task = pendingTask(ctx);
    operateTask(ctx, task.id, 'cancel', { reason: '用例取消' });
    const error = expectDomainError(() => preview(ctx, { taskIds: [task.id], strategy: 'greedy' }), 'TASK.STATE_CONFLICT');
    expect(error.detail).toMatchObject({ hint: expect.stringContaining('待派') });
  });

  it('不存在的任务报 TASK.NOT_FOUND（不是「没有可用车辆」）', () => {
    expectDomainError(() => preview(ctx, { taskIds: ['no-such-task'], strategy: 'greedy' }), 'TASK.NOT_FOUND');
  });

  it('站点未绑定路网节点是配置问题：VALIDATION.FAILED 且字段级指向 fromSiteId', () => {
    const task = pendingTask(ctx);
    run(db, 'UPDATE sites SET node_id = NULL WHERE id = ?', [SEED_IDS.siteDepot]);
    const error = expectDomainError(() => preview(ctx, { taskIds: [task.id], strategy: 'greedy' }), 'VALIDATION.FAILED');
    expect(Object.keys((error.detail['fields'] ?? {}) as object)).toEqual(['fromSiteId']);
  });

  it('未实现策略 / 空任务列表一律 VALIDATION.FAILED（不静默回落到贪心）', () => {
    const task = pendingTask(ctx);
    expectDomainError(() => preview(ctx, { taskIds: [task.id], strategy: 'genetic' }), 'VALIDATION.FAILED');
    expectDomainError(() => preview(ctx, { taskIds: [], strategy: 'greedy' }), 'VALIDATION.FAILED');
  });
});

describe('M4 调度服务 · apply', () => {
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('S2 应用派发：任务 assigned + 车辆 reserved + plan/route/log/audit 四件套齐', () => {
    const task = pendingTask(ctx);
    const previewResult = preview(ctx, { taskIds: [task.id], strategy: 'greedy' });

    const applied = apply(ctx, { requestId: previewResult.requestId, strategy: 'greedy' });

    expect(applied.requestId).toBe(previewResult.requestId);
    expect(applied.strategy).toBe('greedy');
    expect(applied.appliedPlans).toHaveLength(1);
    const plan = applied.appliedPlans[0]!;
    expect(plan).toMatchObject({ taskId: task.id, taskCode: task.code, vehicleCode: 'CAR-01' });

    // 任务：assigned + 指向车辆与计划
    const row = taskRow(db, task.id)!;
    expect(row).toMatchObject({ status: 'assigned', assigned_vehicle_id: SEED_IDS.vehicleCarrier, plan_id: plan.planId });
    // 车辆：reserved
    expect(vehicleStatus(db, SEED_IDS.vehicleCarrier)).toBe('reserved');
    // 计划行：applied，且 strategy 落的是用户选的那个
    expect(
      get(db, 'SELECT status, strategy, route_id FROM dispatch_plans WHERE id = ?', [plan.planId])
    ).toMatchObject({ status: 'applied', strategy: 'greedy', route_id: plan.routeId });
    // 路线：真的写进了 routes，且带上真实边（渲染层要高亮）
    const route = get<{ task_id: string; edge_ids: string; distance_m: number }>(
      db,
      'SELECT task_id, edge_ids, distance_m FROM routes WHERE id = ?',
      [plan.routeId]
    )!;
    expect(route.task_id).toBe(task.id);
    expect((JSON.parse(route.edge_ids) as string[]).length).toBeGreaterThan(0);
    // 落库的路线与预览里那条**逐字段一致**（「所见即所得」，Req-M4-3）。
    // 不写死具体里程：里程由校园路网与拥堵权重决定，写死只会每次换数据都变红
    const previewRoute = previewResult.strategies[0]!.plans[0]!.route!;
    expect(route.distance_m).toBe(previewRoute.distanceM);
    expect(route.distance_m).toBeGreaterThan(0);
    // 日志与审计
    expect(count(db, "SELECT COUNT(*) AS total FROM dispatch_logs WHERE request_id = ? AND action = 'apply'", previewResult.requestId)).toBe(1);
    const auditActions = all<{ action: string }>(
      db,
      "SELECT action FROM audit_logs WHERE module = 'dispatch' ORDER BY ts, rowid"
    ).map((row) => row.action);
    expect(auditActions).toEqual(['preview', 'apply']);
  });

  it('同一车串行拉两单：apply 一次派成两条，而不是「车辆状态不允许该操作」', () => {
    /*
     * 这条用例是一次**实测缺陷**的回归（本轮走查发现）：
     *
     * 算法允许一辆车在一批里串行拉多单（`evaluatePair` 按 `freeAt` 往后排，占用区间不重叠），
     * 但落库时「预留」是 `idle → reserved` 的单向跃迁 —— 第二条计划再预留同一辆车，
     * 条件更新返回 0 行，被当成「车被别人抢走了」，整批回滚。
     * 使用者看到的是「车辆状态不允许该操作」，而实际情况是**两单都能派**。
     *
     * 两单各 400/500 kg：DRN-01 载重 50 kg 拉不动、AGV-01 在 seed 里是 busy，
     * 于是 CAR-01 是唯一可行车，必须由它串行完成两单。
     */
    const first = pendingTask(ctx, { cargoKg: 120, priority: 'high' });
    const second = pendingTask(ctx, {
      cargoKg: 400,
      priority: 'normal',
      fromSiteId: SEED_IDS.siteDorm,
      toSiteId: SEED_IDS.siteDepot
    });
    const previewResult = preview(ctx, { taskIds: [first.id, second.id], strategy: 'greedy' });
    const outcome = previewResult.strategies[0]!;
    expect(outcome.plans).toHaveLength(2);
    expect(outcome.plans.every((plan) => plan.vehicleId === SEED_IDS.vehicleCarrier)).toBe(true);
    // 同车两次占用必须不重叠（半开区间：[from, to)）
    const [a, b] = [...outcome.plans].sort((left, right) => left.occupiedFrom.localeCompare(right.occupiedFrom));
    expect(a!.occupiedTo <= b!.occupiedFrom).toBe(true);

    const applied = apply(ctx, { requestId: previewResult.requestId, strategy: 'greedy' });
    expect(applied.appliedPlans).toHaveLength(2);
    expect(vehicleStatus(db, SEED_IDS.vehicleCarrier)).toBe('reserved');
    // 两条计划都落库，且指向同一辆车
    const rows = all<{ task_id: string; vehicle_id: string }>(
      db,
      "SELECT task_id, vehicle_id FROM dispatch_plans WHERE request_id = ? AND status = 'applied'",
      [previewResult.requestId]
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.vehicle_id))).toEqual(new Set([SEED_IDS.vehicleCarrier]));
    // 两条任务都进入 assigned（不是「派了一条、回滚一条」）
    expect(taskRow(db, first.id)?.status).toBe('assigned');
    expect(taskRow(db, second.id)?.status).toBe('assigned');
  });

  it('跨批次：车辆已是 reserved 时不再接新单（有意的保守边界，见 §3.4.3）', () => {
    // 900 kg 只有 CAR-02（1200 kg）装得下 —— 用「唯一的可行车」把这条边界钉死，
    // 否则一辆车被预留后，另一辆空闲车会顶上，用例就测不到「跨批次不接单」
    const first = pendingTask(ctx, { cargoKg: 900 });
    const firstPreview = preview(ctx, { taskIds: [first.id], strategy: 'greedy' });
    apply(ctx, { requestId: firstPreview.requestId, strategy: 'greedy' });
    expect(vehicleStatus(db, SEED_IDS.vehicleCarrier2)).toBe('reserved');

    // 第二单**另起一次预览**：这时 CAR-02 已 reserved，不参与候选
    const second = pendingTask(ctx, { cargoKg: 900 });
    const secondPreview = preview(ctx, { taskIds: [second.id], strategy: 'greedy' });
    const outcome = secondPreview.strategies[0]!;
    expect(outcome.plans).toHaveLength(0);
    expect(outcome.rejected[0]?.reason).toBe('VEHICLE_NOT_AVAILABLE');
  });

  it('重算回收一单时，同一辆车上仍挂着的另一单不受影响（车辆不置 idle）', () => {
    /*
     * 同车串行的连带条件：回收其中一单**不等于**释放这辆车。
     * 若无条件置 `idle`，下一次调度就会把车派给新单，而旧单还在占用 ——
     * 两条计划的占用区间真重叠，且库里查不出是哪一步错了。
     */
    const first = pendingTask(ctx, { cargoKg: 120, priority: 'high' });
    const second = pendingTask(ctx, {
      cargoKg: 400,
      priority: 'normal',
      fromSiteId: SEED_IDS.siteDorm,
      toSiteId: SEED_IDS.siteDepot
    });
    const previewResult = preview(ctx, { taskIds: [first.id, second.id], strategy: 'greedy' });
    apply(ctx, { requestId: previewResult.requestId, strategy: 'greedy' });

    recompute(ctx, { taskId: first.id, reason: '走查：回收第一单', strategy: 'greedy' });
    // 第二单还挂在 CAR-01 上 → 车辆不得被置 idle
    expect(taskRow(db, second.id)?.status).toBe('assigned');
    expect(vehicleStatus(db, SEED_IDS.vehicleCarrier)).toBe('reserved');

    // 两单都回收后，车才回到 idle
    recompute(ctx, { taskId: second.id, reason: '走查：回收第二单', strategy: 'greedy' });
    expect(vehicleStatus(db, SEED_IDS.vehicleCarrier)).toBe('idle');
  });

  it('S3 同一 requestId 应用两次：第二次 DISPATCH.ALREADY_APPLIED，且不产生第二条 apply 日志', () => {
    const task = pendingTask(ctx);
    const previewResult = preview(ctx, { taskIds: [task.id], strategy: 'greedy' });
    apply(ctx, { requestId: previewResult.requestId, strategy: 'greedy' });

    expectDomainError(() => apply(ctx, { requestId: previewResult.requestId, strategy: 'greedy' }), 'DISPATCH.ALREADY_APPLIED');
    expect(count(db, "SELECT COUNT(*) AS total FROM dispatch_logs WHERE action = 'apply'")).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS total FROM dispatch_plans')).toBe(1);
  });

  it('S4 预览后任务被取消：apply 整体回滚，不留半条计划 / 半台 reserved 车', () => {
    const task = pendingTask(ctx);
    const previewResult = preview(ctx, { taskIds: [task.id], strategy: 'greedy' });
    operateTask(ctx, task.id, 'cancel', { reason: '用例取消' });

    expectDomainError(() => apply(ctx, { requestId: previewResult.requestId, strategy: 'greedy' }), 'TASK.STATE_CONFLICT');

    expect(taskRow(db, task.id)).toMatchObject({ status: 'cancelled', assigned_vehicle_id: null });
    expect(vehicleStatus(db, SEED_IDS.vehicleCarrier)).toBe('idle');
    expect(count(db, 'SELECT COUNT(*) AS total FROM dispatch_plans')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS total FROM routes')).toBe(1); // 只剩 seed 的演示路线
    expect(count(db, "SELECT COUNT(*) AS total FROM dispatch_logs WHERE action = 'apply'")).toBe(0);
    expect(count(db, "SELECT COUNT(*) AS total FROM audit_logs WHERE module = 'dispatch' AND action = 'apply'")).toBe(0);
  });

  it('apply 只接受单一策略 / 只接受存在的 requestId', () => {
    const task = pendingTask(ctx);
    const previewResult = preview(ctx, { taskIds: [task.id], strategy: 'greedy' });
    const error = expectDomainError(
      () => apply(ctx, { requestId: previewResult.requestId, strategy: 'all' }),
      'VALIDATION.FAILED'
    );
    expect(Object.keys((error.detail['fields'] ?? {}) as object)).toEqual(['strategy']);
    expectDomainError(() => apply(ctx, { requestId: 'req-nope', strategy: 'greedy' }), 'DISPATCH.REQUEST_NOT_FOUND');
    expectDomainError(() => apply(ctx, { strategy: 'greedy' }), 'VALIDATION.FAILED');
  });

  it('已落库的占用对下一次预览可见：派给 AGV-01 后，第二单只能改派 CAR-01', () => {
    run(db, "UPDATE vehicles SET status = 'idle' WHERE id = ?", [SEED_IDS.vehicleAgv]);
    const first = pendingTask(ctx);
    manualAssign(ctx, { taskId: first.id, vehicleId: SEED_IDS.vehicleAgv, reason: '演示指派' });

    const second = pendingTask(ctx);
    const outcome = preview(ctx, { taskIds: [second.id], strategy: 'greedy' }).strategies[0]!;
    expect(outcome.plans.map((plan) => plan.vehicleCode)).toEqual(['CAR-01']);
  });

  it('apply 的路线与预览一致：重推的是同一份内核、同一份输入（§10.2）', () => {
    const task = pendingTask(ctx);
    const previewResult = preview(ctx, { taskIds: [task.id], strategy: 'greedy' });
    const previewed = previewResult.strategies[0]!.plans[0]!;
    const applied = apply(ctx, { requestId: previewResult.requestId, strategy: 'greedy' }).appliedPlans[0]!;

    const route = get<{ node_ids: string; distance_m: number; duration_s: number }>(
      db,
      'SELECT node_ids, distance_m, duration_s FROM routes WHERE id = ?',
      [applied.routeId]
    )!;
    expect(JSON.parse(route.node_ids)).toEqual(previewed.route!.nodeIds);
    expect(route.distance_m).toBe(previewed.route!.distanceM);
    expect(route.duration_s).toBeCloseTo(previewed.route!.durationS, 6);
    expect(applied.occupiedFrom).toBe(previewed.occupiedFrom);
    expect(applied.occupiedTo).toBe(previewed.occupiedTo);
  });
});

describe('M4 调度服务 · manualAssign', () => {
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('S5 手动指派成功：约束复用内核评估，留痕含原因（Req-M4-4）', () => {
    run(db, "UPDATE vehicles SET status = 'idle' WHERE id = ?", [SEED_IDS.vehicleAgv]);
    const task = pendingTask(ctx);

    const result = manualAssign(ctx, { taskId: task.id, vehicleId: SEED_IDS.vehicleAgv, reason: '客户指定 AGV' });

    expect(result.requestId).toMatch(/^manual_/);
    expect(result.appliedPlans).toHaveLength(1);
    expect(taskRow(db, task.id)).toMatchObject({ status: 'assigned', assigned_vehicle_id: SEED_IDS.vehicleAgv });
    expect(vehicleStatus(db, SEED_IDS.vehicleAgv)).toBe('reserved');
    const log = get<{ action: string; reason: string; task_ids: string }>(
      db,
      'SELECT action, reason, task_ids FROM dispatch_logs WHERE request_id = ?',
      [result.requestId]
    )!;
    expect(log.action).toBe('manual_assign');
    expect(log.reason).toBe('客户指定 AGV');
    expect(JSON.parse(log.task_ids)).toEqual([task.id]);
    expect(count(db, "SELECT COUNT(*) AS total FROM audit_logs WHERE module = 'dispatch' AND action = 'manual_assign'")).toBe(1);
  });

  it('原因与车辆必填（手动指派是「为什么不让系统挑」的唯一线索）', () => {
    const task = pendingTask(ctx);
    expectDomainError(() => manualAssign(ctx, { taskId: task.id, vehicleId: SEED_IDS.vehicleAgv, reason: '  ' }), 'VALIDATION.FAILED');
    expectDomainError(() => manualAssign(ctx, { taskId: task.id, reason: '理由' }), 'VALIDATION.FAILED');
    expectDomainError(() => manualAssign(ctx, { vehicleId: SEED_IDS.vehicleAgv, reason: '理由' }), 'VALIDATION.FAILED');
  });

  it('手动指派不是绕过约束的通道：指派给 busy 车 → DISPATCH.NO_CANDIDATE + 结构化原因', () => {
    const task = pendingTask(ctx); // AGV-01 此刻是 busy（seed 演示任务）
    const error = expectDomainError(
      () => manualAssign(ctx, { taskId: task.id, vehicleId: SEED_IDS.vehicleAgv, reason: '试试' }),
      'DISPATCH.NO_CANDIDATE'
    );
    expect(error.detail['rejection']).toMatchObject({ taskId: task.id, reason: 'VEHICLE_NOT_AVAILABLE' });
    expect(taskRow(db, task.id)?.status).toBe('pending');
    expect(vehicleStatus(db, SEED_IDS.vehicleAgv)).toBe('busy');
  });

  it('车辆不存在报 VEHICLE.NOT_FOUND（与「约束不满足」分开）', () => {
    const task = pendingTask(ctx);
    expectDomainError(() => manualAssign(ctx, { taskId: task.id, vehicleId: 'no-such-veh', reason: '理由' }), 'VEHICLE.NOT_FOUND');
  });
});

describe('M4 调度服务 · recompute', () => {
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('S6 重算三步：superseded → 车辆回收 → 任务回 pending → 产出新预览（Req-M4-5）', () => {
    const task = pendingTask(ctx);
    const previewResult = preview(ctx, { taskIds: [task.id], strategy: 'greedy' });
    const applied = apply(ctx, { requestId: previewResult.requestId, strategy: 'greedy' }).appliedPlans[0]!;
    expect(vehicleStatus(db, SEED_IDS.vehicleCarrier)).toBe('reserved');

    const re = recompute(ctx, { taskId: task.id, reason: 'A 仓封路，重算', strategy: 'greedy' });

    // 回收：旧计划 superseded、车辆 idle、任务 pending 且清掉派发痕迹
    expect(get(db, 'SELECT status FROM dispatch_plans WHERE id = ?', [applied.planId])).toMatchObject({ status: 'superseded' });
    expect(vehicleStatus(db, SEED_IDS.vehicleCarrier)).toBe('idle');
    expect(taskRow(db, task.id)).toMatchObject({ status: 'pending', assigned_vehicle_id: null, plan_id: null });
    // 新预览：同一 requestId、可应用
    expect(re.requestId).toBeTruthy();
    const logs = all<{ action: string; request_id: string; reason: string | null }>(
      db,
      /*
       * 排序必须带 `rowid`：`dispatch_logs.id` 是随机 uuid，而 `created_at` 只到毫秒 ——
       * 同一次测试里连续写入的几行几乎必然落在同一毫秒，此时 `ORDER BY created_at, id`
       * 的先后由 id 的字典序决定，与插入顺序无关。
       * 实测（2026-09-28，`npm test` 并行负载下）：本用例偶发报
       * `previewAfter.request_id` 与 `recomputeLog.request_id` 不等，
       * 单跑该文件却始终通过 —— 就是这条排序在作祟（ISS-068）。
       */
      'SELECT action, request_id, reason FROM dispatch_logs ORDER BY created_at, rowid'
    );
    const recomputeLog = logs.find((row) => row.action === 'recompute')!;
    const previewAfter = logs.filter((row) => row.action === 'preview').at(-1)!;
    expect(recomputeLog.reason).toBe('A 仓封路，重算');
    expect(previewAfter.request_id).toBe(recomputeLog.request_id); // 成对：同一 requestId
    expect(re.requestId).toBe(recomputeLog.request_id);

    const reapplied = apply(ctx, { requestId: re.requestId, strategy: 'greedy' });
    expect(reapplied.appliedPlans).toHaveLength(1);
    expect(vehicleStatus(db, SEED_IDS.vehicleCarrier)).toBe('reserved');
  });

  it('重算要求原因必填 / 任务必须已派发', () => {
    const task = pendingTask(ctx);
    expectDomainError(() => recompute(ctx, { taskId: task.id, reason: '', strategy: 'greedy' }), 'VALIDATION.FAILED');
    expectDomainError(() => recompute(ctx, { taskId: task.id, reason: '还没派就重算', strategy: 'greedy' }), 'TASK.STATE_CONFLICT');
  });
});

describe('M4 调度服务 · 查询', () => {
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('策略清单：三条都列出、genetic 标为未启用（界面据此画禁用态）', () => {
    const strategies = listStrategies();
    expect(strategies.map((item) => item.key)).toEqual(['greedy', 'hungarian', 'genetic']);
    expect(strategies.filter((item) => item.enabled).map((item) => item.key)).toEqual(['greedy', 'hungarian']);
    expect(strategies.every((item) => item.label && item.description)).toBe(true);
  });

  it('日志列表：按动作 / 任务过滤、分页与全序（created_at DESC, id DESC）', () => {
    const a = pendingTask(ctx);
    const b = pendingTask(ctx);
    preview(ctx, { taskIds: [a.id], strategy: 'greedy' });
    preview(ctx, { taskIds: [b.id], strategy: 'hungarian' });

    const page1 = listDispatchLogs(ctx, { page: 1, pageSize: 1 });
    expect(page1.total).toBe(2);
    expect(page1.records).toHaveLength(1);
    expect(page1.records[0]).toMatchObject({ action: 'preview' });
    expect(page1.records[0]!.summary.totalTasks).toBe(1);
    expect(page1.records[0]!.operatorName).toBe('系统管理员');

    // 同毫秒内 `created_at` 相同，顺序由 `id DESC` 定 —— 因此这里断言的是
    // 「两页正好覆盖两条且不重不漏」，而不是某一条必然排在前（那会是一条随机失败的用例）
    const page2 = listDispatchLogs(ctx, { page: 2, pageSize: 1 });
    expect(page2.records).toHaveLength(1);
    expect(new Set([page1.records[0]!.id, page2.records[0]!.id]).size).toBe(2);

    const byTask = listDispatchLogs(ctx, { taskId: a.id, page: 1, pageSize: 10 });
    expect(byTask.total).toBe(1);
    expect(byTask.records[0]!.taskIds).toEqual([a.id]);
    expect(byTask.records[0]!.strategy).toBe('greedy');

    const filtered = listDispatchLogs(ctx, { strategy: 'hungarian', page: 1, pageSize: 10 });
    expect(filtered.total).toBe(1);
    expect(filtered.records[0]!.taskIds).toEqual([b.id]);
    // 列表不返回快照：列表项里根本没有这两个字段（§3.4.6）
    expect(Object.keys(filtered.records[0]!)).not.toContain('outputSnapshot');
  });
});
