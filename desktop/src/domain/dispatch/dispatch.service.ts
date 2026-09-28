/**
 * 调度领域服务（M4，`docs/api.md` §3.4 / `docs/module-M4-dispatch.md` §10）。
 *
 * ## 五个方法的边界
 *
 *   - `preview`：只读 + 写一条 `dispatch_logs`。**不碰 `dispatch_plans` / `routes` / 任务 / 车辆**；
 *   - `apply`：把**某次预览的存档输出**落地（§10.2），全程一个事务 + 条件更新当乐观锁；
 *   - `manualAssign`：单任务指定车辆，复用同一套事务模板；
 *   - `recompute`：先把原计划作废、车辆回收、任务回 `pending`，再产出一份新预览；
 *   - `listLogs` / `listStrategies`：查询。
 *
 * ## 为什么 apply 不重跑算法（这是本文件最重要的一个判断）
 *
 * 使用者点「应用」时，他确认的是**屏幕上那份预览**里的具体派发。重跑算法会得到一个
 * 可能不同的结果（`now` 往后走了、别的车在这几秒里被占用了），于是「我确认的方案」
 * 与「实际落库的方案」不是同一个 —— 而事后无法分辨是算法变了还是数据变了。
 * 因此 apply 读的是 `dispatch_logs.output_snapshot`（预览当场留下的存档），
 * 只在**重新推导路线**时才回到内核（`routes` 表需要 `edge_ids`，而预览的回执里只有节点）。
 * 并发安全由条件 UPDATE 负责（`assignTaskIfPending` / `reserveVehicleIfIdle`），
 * 因此「存档的输出」不会变成一条绕过并发检查的捷径。
 *
 * ## 错误码只在这里产生，文案不覆写
 *
 * 面向使用者的文案由 `ERROR_CODES[code].message` 唯一作者产出（渲染层按 code 映射同一句话）；
 * 本文件只在 `detail` 里放「这次为什么」的具体上下文。
 */
import { randomUUID } from 'node:crypto';
import {
  DISPATCH_LOG_ACTIONS,
  DISPATCH_MAX_TASKS,
  DISPATCH_MAX_VEHICLES,
  DISPATCH_STRATEGIES,
  DISPATCH_STRATEGY_SELECTIONS,
  DomainError,
  SUPPORTED_DISPATCH_STRATEGIES,
  buildRouteGraph,
  createRunContext,
  evaluatePair,
  runDispatch,
  searchRoute,
  type ApplyResult,
  type AppliedPlan,
  type DispatchLogListItem,
  type DispatchStrategy,
  type DispatchStrategyInfo,
  type DispatchStrategySelection,
  type PlanPreview,
  type PreviewResult,
  type RouteAlgorithm,
  type StrategyOutcome,
  type StrategyResult,
  type PageResult,
  type StrategySummary
} from '@udm/shared';
import { nowIso, tx, type Db } from '../../db/index.js';
import {
  assignTaskIfPending,
  hasOtherActivePlanForVehicle,
  insertPlan,
  listAppliedPlans,
  releaseVehicleIfBusy,
  reserveVehicleIfIdle,
  setPlansStatus
} from '../../db/repositories/dispatch-plan.repo.js';
import { findPreviewOutput, hasApplied, insertLog, listLogs, type LogListQuery } from '../../db/repositories/dispatch-log.repo.js';
import { findRouteById, insertRoute } from '../../db/repositories/route.repo.js';
import { getSettings, parseSettingsValues } from '../../db/repositories/settings.repo.js';
import { writeAudit } from '../../services/audit.js';
import { toAuditActor, type CrudContext } from '../base/context.js';
import { invalid } from '../base/validate.js';
import { STRATEGY_LABEL, explainOutcome, summarizeOutcomes } from './explain.js';
import { SnapshotProblem, buildSnapshot, loadGraphInputs, loadTaskStatuses, snapshotFingerprint } from './snapshot.js';

/** 可用策略清单（`GET /api/dispatch/strategies`，§3.4.1）。 */
export function listStrategies(): DispatchStrategyInfo[] {
  const descriptions: Record<DispatchStrategy, { label: string; description: string }> = {
    greedy: { label: STRATEGY_LABEL['greedy'] ?? '贪心', description: '按优先级与时间窗逐个任务挑当前代价最小的车辆' },
    hungarian: { label: STRATEGY_LABEL['hungarian'] ?? '匈牙利', description: '在整批任务上求总代价最小的指派' },
    genetic: { label: STRATEGY_LABEL['genetic'] ?? '遗传', description: '预留，二期实现' }
  };
  return DISPATCH_STRATEGIES.map((key) => ({
    key,
    label: descriptions[key].label,
    description: descriptions[key].description,
    enabled: SUPPORTED_DISPATCH_STRATEGIES.includes(key)
  }));
}

/** 读请求里的 `strategy`（严出：非法取值直接报错，不静默回落到贪心）。 */
function readStrategy(raw: Record<string, unknown>, field = 'strategy'): DispatchStrategySelection {
  const value = raw[field];
  if (typeof value !== 'string' || !(DISPATCH_STRATEGY_SELECTIONS as readonly string[]).includes(value)) {
    throw invalid({ [field]: `必须是 ${DISPATCH_STRATEGY_SELECTIONS.join(' / ')} 之一` });
  }
  return value as DispatchStrategySelection;
}

function readTaskIds(raw: Record<string, unknown>): string[] {
  const value = raw['taskIds'];
  if (!Array.isArray(value) || value.length === 0) {
    throw invalid({ taskIds: '至少选择一个任务' });
  }
  if (value.some((item) => typeof item !== 'string' || item === '')) {
    throw invalid({ taskIds: '必须是任务 id 数组' });
  }
  const unique = [...new Set(value as string[])];
  if (unique.length > DISPATCH_MAX_TASKS) {
    throw invalid({ taskIds: `单次最多 ${DISPATCH_MAX_TASKS} 个任务，请分批调度` });
  }
  return unique;
}

/** 原因（手动指派 / 重算必填）：与任务侧同口径，空串视为没填。 */
function readRequiredReason(raw: Record<string, unknown>, action: string): string {
  const value = raw['reason'];
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid({ reason: `${action} 必须给出原因` });
  }
  return value.trim();
}

/** `SnapshotProblem` → 错误码：任务不存在与站点配置问题要分开。 */
function toSnapshotError(problem: SnapshotProblem): DomainError {
  const detail = problem.detail;
  if (detail['missingTaskIds']) {
    return new DomainError('TASK.NOT_FOUND', undefined, { ids: detail['missingTaskIds'] });
  }
  if (detail['siteCode']) {
    // 站点没绑节点是**配置问题**：报 VALIDATION 并指到具体字段，让界面能高亮到那一栏
    return invalid({ [String(detail['field'] ?? 'fromSiteId')]: problem.message });
  }
  return new DomainError('SITE.NOT_FOUND', undefined, detail);
}

/** 预览的任务必须全部处于 `pending`（§10.1 第 1 步）。 */
function ensurePending(db: Db, taskIds: readonly string[]): void {
  const statuses = loadTaskStatuses(db, taskIds);
  const notPending = taskIds
    .map((id) => ({ id, status: statuses.get(id) }))
    .filter((item) => item.status !== undefined && item.status !== 'pending');
  if (notPending.length > 0) {
    throw new DomainError('TASK.STATE_CONFLICT', undefined, {
      tasks: notPending,
      hint: '只有「待派」状态的任务可以进入调度预览'
    });
  }
}

interface PreviewCommand {
  taskIds: string[];
  strategy: DispatchStrategySelection;
}

/** 跑算法：`all` = 全部已实现策略（顺序稳定），否则单个。 */
function runStrategies(snapshot: Parameters<typeof runDispatch>[0], selection: DispatchStrategySelection): StrategyOutcome[] {
  if (selection === 'all') {
    return SUPPORTED_DISPATCH_STRATEGIES.map((strategy) => runDispatch(snapshot, strategy));
  }
  if (!SUPPORTED_DISPATCH_STRATEGIES.includes(selection)) {
    throw invalid({ strategy: `${selection} 尚未实现（当前可用：${SUPPORTED_DISPATCH_STRATEGIES.join(' / ')}）` });
  }
  return [runDispatch(snapshot, selection)];
}

/** 给每个策略补 `elapsedMs` 并算出可读解释（内核不产出文案，§8）。 */
function toStrategyResults(
  outcomes: StrategyOutcome[],
  elapsedMs: number,
  taskCodes: Map<string, string>
): StrategyResult[] {
  const perStrategy = Math.round(elapsedMs / Math.max(1, outcomes.length));
  return outcomes.map((outcome) => {
    const stamped: StrategyOutcome = { ...outcome, summary: { ...outcome.summary, elapsedMs: perStrategy } };
    return { ...stamped, explain: explainOutcome(stamped, taskCodes) };
  });
}

/** 任务编码表（解释文案要用 `T20260926-0001` 而不是内部 id）。 */
function taskCodesOf(db: Db, taskIds: readonly string[]): Map<string, string> {
  const rows = db
    .prepare(`SELECT id, code FROM tasks WHERE id IN (${taskIds.map(() => '?').join(',')})`)
    .all(...taskIds) as Array<{ id: string; code: string }>;
  return new Map(rows.map((row) => [row.id, row.code]));
}

/**
 * 调度预览（§3.4.2 / §10.1）。
 *
 * 落一条 `dispatch_logs(action='preview')`，`output_snapshot` 存**完整结果** ——
 * apply 就靠它做到「所见即所得」。因此这一列不是调试信息，是业务数据。
 */
export function preview(ctx: CrudContext, raw: Record<string, unknown>): PreviewResult {
  return runPreview(ctx, { taskIds: readTaskIds(raw), strategy: readStrategy(raw) });
}

/**
 * 预览的实现体。
 *
 * `requestId` 可由调用方给：`recompute` 需要「回收日志」与「新预览」共用同一个 id，
 * 否则日志里会出现两条互不相关、但描述同一件事的记录（事后无法把
 * 「因为封路重算了哪张单」与「重算后建议怎么派」对上）。
 */
function runPreview(ctx: CrudContext, cmd: PreviewCommand, requestId = `req_${randomUUID()}`): PreviewResult {
  const now = nowIso();
  const startedAt = Date.now();

  try {
    ensurePending(ctx.db, cmd.taskIds);
  } catch (error) {
    if (error instanceof DomainError) {
      writeAudit(ctx.db, toAuditActor(ctx.actor), {
        module: 'dispatch',
        action: 'preview',
        result: 'failure',
        errorCode: error.code,
        message: '预览前校验失败'
      });
    }
    throw error;
  }

  let snapshot;
  try {
    snapshot = buildSnapshot(ctx.db, { taskIds: cmd.taskIds, now });
  } catch (error) {
    if (error instanceof SnapshotProblem) {
      writeAudit(ctx.db, toAuditActor(ctx.actor), {
        module: 'dispatch',
        action: 'preview',
        result: 'failure',
        errorCode: 'VALIDATION.FAILED',
        message: error.message
      });
      throw toSnapshotError(error);
    }
    throw error;
  }

  const outcomes = runStrategies(snapshot, cmd.strategy);
  const elapsedMs = Date.now() - startedAt;
  const taskCodes = taskCodesOf(ctx.db, cmd.taskIds);
  const strategies = toStrategyResults(outcomes, elapsedMs, taskCodes);
  const summary = { ...summarizeOutcomes(outcomes), elapsedMs };

  insertLog(ctx.db, {
    id: randomUUID(),
    requestId,
    action: 'preview',
    strategy: cmd.strategy,
    taskIds: cmd.taskIds,
    inputSnapshot: { fingerprint: snapshotFingerprint(ctx.db, cmd.taskIds), now },
    outputSnapshot: strategies,
    summary,
    rejected: outcomes[0]?.rejected ?? [],
    reason: null,
    elapsedMs,
    operatorId: ctx.actor?.actorId ?? null,
    createdAt: now
  });
  writeAudit(ctx.db, toAuditActor(ctx.actor), {
    module: 'dispatch',
    action: 'preview',
    objectType: 'task',
    before: null,
    after: { requestId, strategy: cmd.strategy, taskIds: cmd.taskIds, summary },
    costMs: elapsedMs
  });

  return { requestId, strategies };
}

/**
 * 重推一条路线并落库（apply / manualAssign 共用）。
 *
 * 为什么 apply 要**重新算路线**而不是存下来：预览回执里的 `route` 只有节点序列
 * （`PlanRouteSummary`），而 `routes` 表要求 `edge_ids`（渲染层要按真实边画高亮）。
 * 重新跑一次 M5 用的是**同一份内核**，输入（图 + 车种 + 端点）在快照未变时完全相同，
 * 因此结果与预览一致；图变了就会在这里失败并报 `DISPATCH.PLAN_EXPIRED`（§11）。
 */
function insertRouteFor(
  db: Db,
  input: { taskId: string; vehicleType: string; fromNodeId: string; toNodeId: string; algorithm: RouteAlgorithm; at: string; actorName: string | null }
): { routeId: string; distanceM: number; durationS: number } {
  const { nodes, edges } = loadGraphInputs(db);
  const restrictions = db
    .prepare(
      `SELECT type, target_id AS targetId, start_at AS startAt, end_at AS endAt, vehicle_type AS vehicleType, status
         FROM restrictions WHERE status = 'active'`
    )
    .all() as Array<{ type: 'node' | 'edge'; targetId: string; startAt: string | null; endAt: string | null; vehicleType: string | null; status: 'active' }>;
  const graph = buildRouteGraph({
    nodes,
    edges,
    restrictions: restrictions.map((row) => ({ ...row, vehicleType: row.vehicleType as never })),
    vehicleType: input.vehicleType as never,
    at: input.at
  });
  const result = searchRoute(graph, {
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    algorithm: input.algorithm,
    vehicleType: input.vehicleType as never
  });
  if (!result.ok) {
    throw new DomainError('DISPATCH.PLAN_EXPIRED', undefined, {
      taskId: input.taskId,
      routeReason: result.reason,
      message: result.message
    });
  }
  const routeId = randomUUID();
  insertRoute(db, {
    id: routeId,
    taskId: input.taskId,
    algorithm: input.algorithm,
    fromNodeId: result.nodeIds[0] ?? input.fromNodeId,
    toNodeId: result.nodeIds[result.nodeIds.length - 1] ?? input.toNodeId,
    viaNodeIds: [],
    nodeIds: result.nodeIds,
    edgeIds: result.edgeIds,
    distanceM: result.distanceM,
    durationS: result.durationS,
    costDetail: {},
    // 与 M5 的 `toRoutePlan` 同口径：落库的警告只留文案（契约里 `RoutePlan.warnings` 是 string[]）
    warnings: result.warnings.map((warning) => warning.message),
    createdAt: input.at,
    createdBy: input.actorName
  });
  return { routeId, distanceM: result.distanceM, durationS: result.durationS };
}

/**
 * 车辆类型（落路线要用车种判默认速度）。
 *
 * `.get()` 返回的是**行对象** `{ type }` 而不是标量：直接 `as string` 会让
 * `ROUTE_DEFAULT_SPEED_MPS[row]` 拿一个对象当键，运行时抛
 * `TypeError: Cannot convert object to primitive value`（实测踩坑，见工作日志）。
 * 类型断言在这里恰好是「把错误藏得最深」的写法 —— 所以取列时显式解构。
 */
function vehicleTypeOf(db: Db, vehicleId: string): string | undefined {
  const row = db.prepare('SELECT type FROM vehicles WHERE id = ?').get(vehicleId) as { type: string } | undefined;
  return row?.type;
}

/** 路线算法：沿用系统的 `settings.route.defaultAlgorithm`（与 M5 同一来源）。 */
function defaultAlgorithm(db: Db): RouteAlgorithm {
  const settings = parseSettingsValues(getSettings(db)) as Record<string, unknown>;
  const configured = settings['route.defaultAlgorithm'];
  return configured === 'dijkstra' ? 'dijkstra' : 'aStar';
}

interface ApplyInput {
  requestId: string;
  strategy: DispatchStrategySelection;
}

/** 校验 requestId 可应用（存在 / 未应用），返回它的存档输出（§11 的四行前置）。 */
function loadApplicableOutput(db: Db, requestId: string, selection: DispatchStrategySelection) {
  if (hasApplied(db, requestId)) {
    throw new DomainError('DISPATCH.ALREADY_APPLIED', undefined, { requestId });
  }
  const output = findPreviewOutput(db, requestId, selection);
  if (!output) {
    throw new DomainError('DISPATCH.REQUEST_NOT_FOUND', undefined, { requestId });
  }
  return output;
}

/**
 * 应用派发（§3.4.3 / §10.2）：把预览里的每条计划落库。
 *
 * 整个循环在**一个事务**里：任何一条失败（任务已被抢、车辆已非 idle）就整体回滚，
 * 不会留下「派了三台、第四台没派上」的半成品。§10.2 保护 2 明确了这个口径。
 */
export function apply(ctx: CrudContext, raw: Record<string, unknown>): ApplyResult {
  const requestId = typeof raw['requestId'] === 'string' ? raw['requestId'] : '';
  if (!requestId) {
    throw invalid({ requestId: '必填' });
  }
  const strategy = readStrategy(raw);
  if (strategy === 'all') {
    // `all` 是**预览专用**的取值：它一次跑多个策略，而落库只能落一份。
    // 让 `all` 悄悄取第一个策略，会出现「我对比后选了匈牙利、应用时系统落了贪心」这种事。
    throw invalid({ strategy: 'apply 必须指定单一策略（all 仅用于预览对比）' });
  }
  const stored = loadApplicableOutput(ctx.db, requestId, strategy);
  const strategyOfPlan = strategy as DispatchStrategy;
  const startedAt = Date.now();

  const applied = tx(ctx.db, () => {
    const at = nowIso();
    const actorName = ctx.actor?.actorName ?? null;
    const algorithm = defaultAlgorithm(ctx.db);
    const plans: AppliedPlan[] = [];
    /*
     * 本批次已经预留过的车辆。
     *
     * **同一辆车在一批里可以出现多条计划**：内核给每条计划维护半开占用区间
     * （`docs/module-M4-dispatch.md` §6），后一个任务只要自然落在前一个区间之外就同样可行。
     * 实测最直观的一例是「车已在 B 仓时同时接 B→A 与 A→B 两单」：两单区间首尾相接，
     * `runDispatch` 输出 **两条都挂在 CAR-01 上**的计划。
     *
     * 但「预留」这个动作在库里是 `idle → reserved` 的单向跃迁：第二条计划再预留同一辆车时
     * `rowCount` 为 0，会被误判成「车被别人抢走了」，整批回滚 ——
     * 使用者看到的是一句和实际情况完全无关的「车辆状态不允许该操作」（实测踩到）。
     * 因此「本批次内已由我们预留」是**已知且合法**的情形，不重复调预留、也不再判一次。
     * 跨批次仍不允许（车处于 `reserved` 就不再接新批次），这条边界写在 §3.4.3。
     */
    const reservedInBatch = new Set<string>();
    /**
     * 同车多条计划必须**时间不重叠**；重叠说明这份存档自相矛盾，不能当作可应用的计划。
     *
     * 这条守卫不是多余的：`apply` 读的是预览存档，而存档是**过去某一刻**算出来的。
     * 内核保证当时的区间不重叠，但存档本身可能被人为改动或来自旧版本实现 ——
     * 与其把两条互相重叠的占用写进库（之后谁也说不清哪一条才是对的），不如拒绝并要求重新预览。
     */
    const occupiedByVehicle = new Map<string, Array<{ from: string; to: string; taskId: string }>>();

    for (const plan of stored.plans) {
      const occupied = occupiedByVehicle.get(plan.vehicleId) ?? [];
      const overlapping = occupied.find(
        (slot) => plan.occupiedFrom < slot.to && slot.from < plan.occupiedTo
      );
      if (overlapping) {
        throw new DomainError('DISPATCH.PLAN_EXPIRED', undefined, {
          taskId: plan.taskId,
          conflictTaskId: overlapping.taskId,
          vehicleId: plan.vehicleId,
          hint: '同一车辆的两次占用时间重叠，请重新预览'
        });
      }
      occupied.push({ from: plan.occupiedFrom, to: plan.occupiedTo, taskId: plan.taskId });
      occupiedByVehicle.set(plan.vehicleId, occupied);
      const vehicleType = vehicleTypeOf(ctx.db, plan.vehicleId);
      if (!vehicleType) {
        throw new DomainError('VEHICLE.NOT_FOUND', undefined, { vehicleId: plan.vehicleId });
      }
      const route = insertRouteFor(ctx.db, {
        taskId: plan.taskId,
        vehicleType,
        fromNodeId: plan.route?.fromNodeId ?? '',
        toNodeId: plan.route?.toNodeId ?? '',
        algorithm,
        at,
        actorName
      });
      const planId = randomUUID();
      insertPlan(ctx.db, {
        id: planId,
        requestId,
        taskId: plan.taskId,
        vehicleId: plan.vehicleId,
        strategy: strategyOfPlan,
        cost: plan.cost,
        costDetail: plan.costDetail,
        routeId: route.routeId,
        occupiedFrom: plan.occupiedFrom,
        occupiedTo: plan.occupiedTo,
        snapshotId: requestId,
        appliedAt: at,
        appliedBy: actorName
      });
      // 条件更新（乐观锁）：`rowCount === 0` 说明任务不再是 pending —— 别人先动了
      if (assignTaskIfPending(ctx.db, { taskId: plan.taskId, vehicleId: plan.vehicleId, planId, at, actorName }) === 0) {
        throw new DomainError('TASK.STATE_CONFLICT', undefined, { taskId: plan.taskId, expected: 'pending' });
      }
      // 本批次内重复用同一辆车：跳过（上面已确认时间不重叠），只在**首次**使用时抢一次
      if (!reservedInBatch.has(plan.vehicleId)) {
        if (reserveVehicleIfIdle(ctx.db, plan.vehicleId, at) === 0) {
          throw new DomainError('VEHICLE.STATE_CONFLICT', undefined, { vehicleId: plan.vehicleId, expected: 'idle' });
        }
        reservedInBatch.add(plan.vehicleId);
      }
      const taskCode = taskCodesOf(ctx.db, [plan.taskId]).get(plan.taskId) ?? plan.taskId;
      plans.push({
        planId,
        taskId: plan.taskId,
        taskCode,
        vehicleId: plan.vehicleId,
        vehicleCode: plan.vehicleCode,
        routeId: route.routeId,
        cost: plan.cost,
        occupiedFrom: plan.occupiedFrom,
        occupiedTo: plan.occupiedTo
      });
    }

    const summary = {
      totalTasks: stored.summary.totalTasks,
      assigned: plans.length,
      rejectedCount: stored.summary.rejectedCount,
      totalCost: plans.reduce((sum, plan) => sum + plan.cost, 0),
      elapsedMs: Date.now() - startedAt
    };
    insertLog(ctx.db, {
      id: randomUUID(),
      requestId,
      action: 'apply',
      strategy,
      taskIds: plans.map((plan) => plan.taskId),
      inputSnapshot: { previewRequestId: requestId },
      outputSnapshot: plans,
      summary,
      rejected: stored.rejected,
      reason: null,
      elapsedMs: summary.elapsedMs,
      operatorId: ctx.actor?.actorId ?? null,
      createdAt: at
    });
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'dispatch',
      action: 'apply',
      objectType: 'task',
      after: { requestId, strategy, appliedPlans: plans.map((plan) => ({ taskId: plan.taskId, vehicleId: plan.vehicleId, planId: plan.planId })) },
      costMs: summary.elapsedMs
    });
    return { requestId, strategy: strategyOfPlan, appliedPlans: plans, summary };
  });

  return applied;
}

/**
 * 手动指派（§3.4.4 / §10.3）：单任务指定车辆。
 *
 * 与 apply 的差别只有两点：**车辆由人指定**（因此错误要指向那个车辆），
 * 以及 `reason` 必填（它是「为什么不让系统自己挑」的唯一线索）。
 * 约束评估**复用内核的 `evaluatePair`** —— 手动指派不是绕过约束的通道，
 * 而是「在可行解里指定一个」。
 */
export function manualAssign(ctx: CrudContext, raw: Record<string, unknown>): ApplyResult {
  const taskId = typeof raw['taskId'] === 'string' ? raw['taskId'] : '';
  const vehicleId = typeof raw['vehicleId'] === 'string' ? raw['vehicleId'] : '';
  if (!taskId) {
    throw invalid({ taskId: '必填' });
  }
  if (!vehicleId) {
    throw invalid({ vehicleId: '必填' });
  }
  const reason = readRequiredReason(raw, '手动指派');
  const now = nowIso();
  const startedAt = Date.now();
  // 同一个 requestId 贯穿「计划 / 日志」：手动指派不是预览的产物，因此它自己就是一个请求
  const requestId = `manual_${randomUUID()}`;

  const result = tx(ctx.db, () => {
    ensurePending(ctx.db, [taskId]);
    let snapshot;
    try {
      snapshot = buildSnapshot(ctx.db, { taskIds: [taskId], now });
    } catch (error) {
      if (error instanceof SnapshotProblem) {
        throw toSnapshotError(error);
      }
      throw error;
    }
    const vehicle = snapshot.vehicles.find((item) => item.id === vehicleId);
    if (!vehicle) {
      throw new DomainError('VEHICLE.NOT_FOUND', undefined, { vehicleId });
    }
    const runCtx = createRunContext(snapshot);
    const outcome = evaluatePair(runCtx, snapshot.tasks[0]!, vehicle, { occupied: runCtx.occupied });
    if (!outcome.ok) {
      // 约束不满足：把内核给的结构化原因原样透出（`reason` 是那个枚举，不是错误码）
      throw new DomainError('DISPATCH.NO_CANDIDATE', outcome.reject.message, {
        rejection: outcome.reject
      });
    }
    const at = nowIso();
    const actorName = ctx.actor?.actorName ?? null;
    const route = insertRouteFor(ctx.db, {
      taskId,
      vehicleType: vehicle.type,
      fromNodeId: snapshot.tasks[0]!.fromNodeId,
      toNodeId: snapshot.tasks[0]!.toNodeId,
      algorithm: defaultAlgorithm(ctx.db),
      at,
      actorName
    });
    const planId = randomUUID();
    insertPlan(ctx.db, {
      id: planId,
      requestId,
      taskId,
      vehicleId,
      strategy: SUPPORTED_DISPATCH_STRATEGIES[0] as DispatchStrategy,
      cost: outcome.plan.cost,
      costDetail: outcome.plan.costDetail,
      routeId: route.routeId,
      occupiedFrom: outcome.plan.occupiedFrom,
      occupiedTo: outcome.plan.occupiedTo,
      snapshotId: null,
      appliedAt: at,
      appliedBy: actorName
    });
    if (assignTaskIfPending(ctx.db, { taskId, vehicleId, planId, at, actorName }) === 0) {
      throw new DomainError('TASK.STATE_CONFLICT', undefined, { taskId, expected: 'pending' });
    }
    if (reserveVehicleIfIdle(ctx.db, vehicleId, at) === 0) {
      throw new DomainError('VEHICLE.STATE_CONFLICT', undefined, { vehicleId, expected: 'idle' });
    }
    const taskCode = taskCodesOf(ctx.db, [taskId]).get(taskId) ?? taskId;
    const summary: StrategySummary = {
      totalTasks: 1,
      assigned: 1,
      rejectedCount: 0,
      totalCost: outcome.plan.cost,
      elapsedMs: Date.now() - startedAt
    };
    insertLog(ctx.db, {
      id: randomUUID(),
      requestId,
      action: 'manual_assign',
      strategy: SUPPORTED_DISPATCH_STRATEGIES[0] as DispatchStrategy,
      taskIds: [taskId],
      inputSnapshot: { taskId, vehicleId, reason },
      outputSnapshot: { taskId, vehicleId, planId, routeId: route.routeId },
      summary,
      rejected: [],
      reason,
      elapsedMs: summary.elapsedMs,
      operatorId: ctx.actor?.actorId ?? null,
      createdAt: at
    });
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'dispatch',
      action: 'manual_assign',
      objectType: 'task',
      after: { taskId, vehicleId, planId, reason },
      costMs: summary.elapsedMs
    });
    const appliedPlans: AppliedPlan[] = [
      {
        planId,
        taskId,
        taskCode,
        vehicleId,
        vehicleCode: vehicle.code,
        routeId: route.routeId,
        cost: outcome.plan.cost,
        occupiedFrom: outcome.plan.occupiedFrom,
        occupiedTo: outcome.plan.occupiedTo
      }
    ];
    return { requestId, strategy: SUPPORTED_DISPATCH_STRATEGIES[0] as DispatchStrategy, appliedPlans, summary };
  });

  return result;
}

/**
 * 重算（§3.4.5 / §10.4）。
 *
 * 三步：**先回收**（原计划 `superseded`、车辆回 `idle`、任务回 `pending`），
 * 落一条 `recompute` 日志，然后立刻产出一份新预览返回（**不自动应用**）。
 * 「不自动应用」是刻意的：重算往往是因为封路或车辆故障，这时更需要人再看一眼。
 */
export function recompute(ctx: CrudContext, raw: Record<string, unknown>): PreviewResult {
  const taskId = typeof raw['taskId'] === 'string' ? raw['taskId'] : '';
  if (!taskId) {
    throw invalid({ taskId: '必填' });
  }
  const reason = readRequiredReason(raw, '重算');
  const strategy = readStrategy(raw);
  // 回收与随后那份新预览**共用同一个 requestId**（见 `runPreview` 的说明）
  const requestId = `req_${randomUUID()}`;

  tx(ctx.db, () => {
    const at = nowIso();
    const statuses = loadTaskStatuses(ctx.db, [taskId]);
    const status = statuses.get(taskId);
    if (!status) {
      throw new DomainError('TASK.NOT_FOUND', undefined, { id: taskId });
    }
    if (!['assigned', 'running', 'paused'].includes(status)) {
      throw new DomainError('TASK.STATE_CONFLICT', undefined, {
        id: taskId,
        from: status,
        expected: ['assigned', 'running', 'paused'],
        hint: '只有已派发 / 执行中 / 已暂停的任务需要重算'
      });
    }
    const plans = listAppliedPlans(ctx.db, [taskId]);
    setPlansStatus(ctx.db, [taskId], 'applied', 'superseded');
    for (const plan of plans) {
      // 这辆车可能还挂着**其它**生效计划（同车串行）：那它就没被真正释放，
      // 置 `idle` 会让下一次调度把车派给新单，而旧单还在占用（详见仓库函数的说明）。
      if (!hasOtherActivePlanForVehicle(ctx.db, plan.vehicleId, [taskId])) {
        releaseVehicleIfBusy(ctx.db, plan.vehicleId, at);
      }
    }
    // 任务回候选池：清掉派发痕迹（否则详情页会显示「待派 + 车辆 AGV-01」这种矛盾组合）
    ctx.db
      .prepare("UPDATE tasks SET status = 'pending', assigned_vehicle_id = NULL, plan_id = NULL, updated_at = ? WHERE id = ?")
      .run(at, taskId);
    const summary: StrategySummary = {
      totalTasks: 1,
      assigned: 0,
      rejectedCount: 0,
      totalCost: 0,
      elapsedMs: 0
    };
    insertLog(ctx.db, {
      id: randomUUID(),
      requestId,
      action: 'recompute',
      strategy,
      taskIds: [taskId],
      inputSnapshot: { taskId, reason, releasedPlans: plans.map((plan) => plan.id) },
      outputSnapshot: null,
      summary,
      rejected: [],
      reason,
      elapsedMs: 0,
      operatorId: ctx.actor?.actorId ?? null,
      createdAt: at
    });
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'dispatch',
      action: 'recompute',
      objectType: 'task',
      before: { status, plans },
      after: { status: 'pending', reason },
      message: reason
    });
  });

  // 回收已提交：随后做一次普通预览（预览本身仍然只读），并沿用同一个 requestId ——
  // 于是 apply 既可用「重算」的 id、也可用返回结果里的 id，两者是同一个值
  return runPreview(ctx, { taskIds: [taskId], strategy }, requestId);
}

/** `GET /api/dispatch/logs`（§3.4.6）。 */
export function listDispatchLogs(
  ctx: CrudContext,
  query: Omit<LogListQuery, 'offset' | 'limit'> & { page: number; pageSize: number }
): PageResult<DispatchLogListItem> {
  const { records, total } = listLogs(ctx.db, {
    ...query,
    offset: (query.page - 1) * query.pageSize,
    limit: query.pageSize
  });
  return { records, total, page: query.page, pageSize: query.pageSize };
}
