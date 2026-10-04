/**
 * Mock 适配器的 **M4 调度**（浏览器形态）。
 *
 * ## 与主进程的分工（与 `mock-route.ts` 同口径）
 *
 *   - **算法共享**：六步评估、贪心、匈牙利、占用区间、路线搜索全部来自 `@udm/shared` ——
 *     与 `desktop/src/domain/dispatch/*` 读的是**同一份内核**，因此
 *     「谁能派给谁」「代价多少」不可能分叉；
 *   - **存储各自**：主进程查 SQLite 并逐条落库（`dispatch_plans` / `routes` / `dispatch_logs`），
 *     这里改内存数组。这一段必然有两份实现，口径由 `mock-parity.test.ts` 用同一批请求打两边来锁死。
 *
 * ## 三处**有意的**差异（都写在明处，不靠「看起来一样」）
 *
 *   1. `explain`（人读解释文案）在 Mock 侧返回**空数组**：它的唯一作者是主进程的
 *      `domain/dispatch/explain.ts`。渲染层不依赖它 —— 调度台用 `plans` / `rejected`
 *      的**结构化字段**自己渲染表格（D-48：展示口径由函数产出），因此浏览器与 Electron
 *      的界面逐行相同。把同一段中文在 Mock 里再拼一遍才是真风险（两处各改一半）。
 *   2. **不写审计**（`audit_logs`）：Mock 没有审计存储，与 M2/M3 的 Mock 写路径一致。
 *   3. `input_snapshot.fingerprint` 这类**排查用留痕**不产出（没有库可查，也没有意义）。
 *
 * ## 幂等与并发
 *
 * 主进程用「条件 UPDATE 当乐观锁」（`assignTaskIfPending` 等，§10.2 保护 1）。
 * 这里是单线程内存表，条件判断在同一个同步函数里完成 —— 步骤与主进程**逐条对应**，
 * 因此「预览后任务被取消」这类用例在两种形态下给出同一个错误码。
 */
import {
  DEFAULT_PAGE_SIZE,
  DISPATCH_LOG_ACTIONS,
  DISPATCH_STRATEGY_LABELS,
  DISPATCH_MAX_TASKS,
  DISPATCH_STRATEGY_SELECTIONS,
  ERROR_CODES,
  MAX_PAGE_SIZE,
  SUPPORTED_DISPATCH_STRATEGIES,
  buildRouteGraph,
  compositeScoreOf,
  createRunContext,
  evaluatePair,
  runDispatch,
  runDispatchAll,
  searchRoute,
  type ApiResult,
  type DispatchLogAction,
  type DispatchLogListItem,
  type DispatchSnapshot,
  type DispatchStrategySelection,
  type DispatchTaskView,
  type DispatchVehicleView,
  type ErrorCode,
  type OccupiedSlot,
  type PlanPreview,
  type RejectItem,
  type StrategyOutcome,
  type StrategyResult,
  type StrategySummary
} from '@udm/shared';
import type { HttpMethod } from './client';
import type { MockBaseData, MockRouteStore, MockTaskStore } from './mock-data';

export interface MockDispatchRequest {
  method: HttpMethod;
  /** 去掉前导空段后的路径片段：`['api','dispatch','preview']`。 */
  segments: string[];
  payload: Record<string, unknown>;
}

/**
 * 已生效的调度计划行（Mock 侧只保留占用推导需要的字段）。
 *
 * 与 `dispatch_plans` 的列一一对应（`status` 也要有：重算把原计划置 `superseded` 后，
 * 它的占用**必须立刻消失**，否则重算出来的新预览会把自己挡住）。
 */
interface MockPlanRow {
  id: string;
  requestId: string;
  taskId: string;
  vehicleId: string;
  strategy: string;
  status: 'applied' | 'superseded' | 'cancelled';
  cost: number;
  routeId: string;
  occupiedFrom: string;
  occupiedTo: string;
}

export interface MockDispatchStore {
  logs: DispatchLogListItem[];
  /** `requestId → 存档输出`：apply 靠它做到「所见即所得」（§10.2），与主进程同一口径。 */
  outputs: Map<string, StrategyResult[]>;
  /** 已应用的 requestId（幂等判据，§11）。 */
  applied: Set<string>;
  plans: MockPlanRow[];
  seq: number;
}

export function buildMockDispatchStore(): MockDispatchStore {
  return { logs: [], outputs: new Map(), applied: new Set(), plans: [], seq: 0 };
}

function fail(code: ErrorCode, detail?: Record<string, unknown>): ApiResult<never> {
  const definition = ERROR_CODES[code];
  return { code, message: definition.message, source: definition.source, ...(detail ? { detail } : {}) };
}

function ok<T>(data: T): ApiResult<T> {
  return { code: 0, message: 'success', data };
}

function invalid(fields: Record<string, string>): ApiResult<never> {
  return fail('VALIDATION.FAILED', { fields });
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
}

/** 任务仍占用车辆的状态（与主进程 `listActiveOccupiedSlots` 的 `OPEN` 集合一致）。 */
const OPEN_TASK_STATUSES = new Set(['assigned', 'running', 'paused']);

/* ==================== 快照组装（对应 `domain/dispatch/snapshot.ts`） ==================== */

/**
 * 组装一份 `DispatchSnapshot`。
 *
 * 站点 → 节点的解析失败**必须报出来**而不是让算法拿到 `undefined`：
 * 后者会变成「路网不可达」，于是使用者去查路网，而真正的问题在站点配置
 * （与主进程 `SnapshotProblem` 的三种 detail 同一判据）。
 */
function buildSnapshot(
  store: MockDispatchStore,
  baseData: MockBaseData,
  taskStore: MockTaskStore,
  taskIds: readonly string[],
  now: string,
  excludeOccupiedTaskIds: readonly string[] = []
): { ok: true; snapshot: DispatchSnapshot } | { ok: false; result: ApiResult<never> } {
  const found = taskIds
    .map((id) => taskStore.rows.find((row) => row.id === id))
    .filter((row): row is MockTaskStore['rows'][number] => row !== undefined);
  const missing = taskIds.filter((id) => !taskStore.rows.some((row) => row.id === id));
  if (missing.length > 0) {
    return { ok: false, result: fail('TASK.NOT_FOUND', { ids: missing }) };
  }

  const tasks: DispatchTaskView[] = [];
  for (const row of found) {
    const from = baseData.sites.find((site) => site.id === row.fromSiteId);
    const to = baseData.sites.find((site) => site.id === row.toSiteId);
    if (!from || !to) {
      return { ok: false, result: fail('SITE.NOT_FOUND', { taskId: row.id, code: row.code }) };
    }
    if (!from.nodeId || !to.nodeId) {
      // 站点未绑定节点是**配置问题**：报 VALIDATION 并指到具体字段，让界面能高亮到那一栏
      const field = !from.nodeId ? 'fromSiteId' : 'toSiteId';
      return {
        ok: false,
        result: invalid({ [field]: `站点 ${(from.nodeId ? to : from).code} 未绑定路网节点，无法规划路线` })
      };
    }
    tasks.push({
      id: row.id,
      code: row.code,
      priority: row.priority,
      cargoKg: row.cargoKg,
      fromNodeId: from.nodeId,
      toNodeId: to.nodeId,
      timeWindowStart: row.timeWindowStart,
      timeWindowEnd: row.timeWindowEnd
    });
  }

  const excluded = new Set(excludeOccupiedTaskIds);
  const occupiedSlots: OccupiedSlot[] = store.plans
    .filter(
      (plan) =>
        plan.status === 'applied' &&
        !excluded.has(plan.taskId) &&
        OPEN_TASK_STATUSES.has(taskStore.rows.find((row) => row.id === plan.taskId)?.status ?? '')
    )
    .map((plan) => ({ taskId: plan.taskId, vehicleId: plan.vehicleId, from: plan.occupiedFrom, to: plan.occupiedTo }));

  const freeAt = new Map<string, string>();
  for (const slot of occupiedSlots) {
    const current = freeAt.get(slot.vehicleId);
    if (!current || slot.to > current) {
      freeAt.set(slot.vehicleId, slot.to);
    }
  }

  const vehicles: DispatchVehicleView[] = baseData.vehicles.map((row) => ({
    id: row.id,
    code: row.code,
    type: row.type,
    status: row.status,
    capacityKg: row.capacityKg,
    loadKg: row.loadKg,
    battery: row.battery,
    maxSpeedMps: row.maxSpeedMps,
    x: row.x,
    y: row.y,
    startNodeId: row.currentNodeId,
    freeAt: freeAt.get(row.id) ?? now
  }));

  return {
    ok: true,
    snapshot: {
      tasks,
      vehicles,
      nodes: baseData.nodes.map((row) => ({ id: row.id, x: row.x, y: row.y, status: row.status })),
      edges: baseData.edges.map((row) => ({
        id: row.id,
        fromNodeId: row.fromNodeId,
        toNodeId: row.toNodeId,
        lengthM: row.lengthM,
        speedLimitMps: row.speedLimitMps,
        weight: row.weight,
        status: row.status
      })),
      restrictions: baseData.restrictions.map((row) => ({
        type: row.type,
        targetId: row.targetId,
        startAt: row.startAt,
        endAt: row.endAt,
        vehicleType: row.vehicleType,
        status: row.status
      })),
      occupiedSlots,
      weights: { deadhead: 1, execute: 1, wait: 0.8, late: 2, chargeRisk: 1000 },
      now
    }
  };
}

/** 路段重推（apply / 手动指派共用）：与主进程 `insertRouteFor` 同一份内核、同一套输入。 */
function planRoute(
  baseData: MockBaseData,
  input: { taskId: string; vehicleType: MockBaseData['vehicles'][number]['type']; fromNodeId: string; toNodeId: string; at: string }
) {
  const graph = buildRouteGraph({
    nodes: baseData.nodes.map((row) => ({ id: row.id, x: row.x, y: row.y, status: row.status })),
    edges: baseData.edges.map((row) => ({
      id: row.id,
      fromNodeId: row.fromNodeId,
      toNodeId: row.toNodeId,
      lengthM: row.lengthM,
      speedLimitMps: row.speedLimitMps,
      weight: row.weight,
      status: row.status
    })),
    restrictions: baseData.restrictions.map((row) => ({
      type: row.type,
      targetId: row.targetId,
      startAt: row.startAt,
      endAt: row.endAt,
      vehicleType: row.vehicleType,
      status: row.status
    })),
    vehicleType: input.vehicleType,
    at: input.at
  });
  const result = searchRoute(graph, {
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    algorithm: 'aStar',
    vehicleType: input.vehicleType
  });
  if (!result.ok) {
    return null;
  }
  return result;
}

/** 车辆类型 → 落路线用的车种（与主进程一样取库里那一行，而不是从请求里猜）。 */
function vehicleTypeOf(baseData: MockBaseData, vehicleId: string) {
  return baseData.vehicles.find((row) => row.id === vehicleId)?.type;
}

/* ==================== 日志 ==================== */

function appendLog(
  store: MockDispatchStore,
  row: {
    requestId: string;
    action: DispatchLogAction;
    strategy: DispatchStrategySelection;
    taskIds: string[];
    summary: StrategySummary;
    rejected: RejectItem[];
    reason: string | null;
    elapsedMs: number;
    operatorId: string | null;
    operatorName: string | null;
  }
): void {
  store.seq += 1;
  store.logs.unshift({
    id: `mock-log-${store.seq}`,
    requestId: row.requestId,
    action: row.action,
    strategy: row.strategy,
    taskIds: row.taskIds,
    summary: row.summary,
    rejected: row.rejected,
    reason: row.reason,
    elapsedMs: row.elapsedMs,
    operatorName: row.operatorName,
    createdAt: new Date().toISOString()
  });
}

const EMPTY_SUMMARY: StrategySummary = { totalTasks: 0, assigned: 0, rejectedCount: 0, totalCost: 0, elapsedMs: 0 };

/* ==================== 读接口 ==================== */

export function mockDispatchRead(
  store: MockDispatchStore,
  path: string,
  payload: Record<string, unknown>
): ApiResult<unknown> | null {
  if (path === '/api/dispatch/strategies') {
    const descriptions: Record<string, string> = {
      greedy: '按优先级与时间窗逐个任务挑当前加权综合分最小的车辆',
      hungarian: '在整批任务上求加权综合分总和最小的指派',
      genetic: '预留，二期实现'
    };
    // 与主进程 `listStrategies()` 同一份形状：`enabled` 由**已实现集合**决定
    return ok(
      (['greedy', 'hungarian', 'genetic'] as const).map((key) => ({
        key,
        label: DISPATCH_STRATEGY_LABELS[key],
        description: descriptions[key] ?? '',
        enabled: SUPPORTED_DISPATCH_STRATEGIES.includes(key)
      }))
    );
  }

  if (path === '/api/dispatch/logs') {
    const rawPage = Number(payload.page ?? 1);
    const rawSize = Number(payload.pageSize ?? DEFAULT_PAGE_SIZE);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const pageSize =
      Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    // 筛选项严出：写错一个字母必须报错，否则一份「看起来是全部」的日志会让人
    // 得出「这段时间没有调度」的错误结论（与主进程 `optionalEnumFilter` 同解）
    const action = payload.action;
    if (action !== undefined && action !== null && action !== '') {
      if (typeof action !== 'string' || !(DISPATCH_LOG_ACTIONS as readonly string[]).includes(action)) {
        return invalid({ action: `取值必须是 ${DISPATCH_LOG_ACTIONS.join(' / ')} 之一` });
      }
    }
    const strategy = payload.strategy;
    if (strategy !== undefined && strategy !== null && strategy !== '') {
      if (typeof strategy !== 'string' || !(DISPATCH_STRATEGY_SELECTIONS as readonly string[]).includes(strategy)) {
        return invalid({ strategy: `取值必须是 ${DISPATCH_STRATEGY_SELECTIONS.join(' / ')} 之一` });
      }
    }
    const rows = store.logs.filter((row) => {
      if (typeof payload.requestId === 'string' && payload.requestId && row.requestId !== payload.requestId) return false;
      if (typeof action === 'string' && action && row.action !== action) return false;
      if (typeof strategy === 'string' && strategy && row.strategy !== strategy) return false;
      if (typeof payload.taskId === 'string' && payload.taskId && !row.taskIds.includes(payload.taskId)) return false;
      if (typeof payload.from === 'string' && payload.from && row.createdAt < payload.from) return false;
      if (typeof payload.to === 'string' && payload.to && row.createdAt > payload.to) return false;
      return true;
    });
    const start = (page - 1) * pageSize;
    return ok({ records: rows.slice(start, start + pageSize), total: rows.length, page, pageSize });
  }

  return null;
}

/* ==================== 写接口 ==================== */

export function mockDispatchWrite(
  store: MockDispatchStore,
  baseData: MockBaseData,
  taskStore: MockTaskStore,
  routeStore: MockRouteStore,
  request: MockDispatchRequest,
  operator: { id: string; name: string }
): ApiResult<unknown> | null {
  const action = request.segments[2] ?? '';
  const payload = request.payload;

  if (action === 'preview') {
    const taskIds = payload.taskIds;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return invalid({ taskIds: '至少选择一个任务' });
    }
    if (taskIds.some((id) => typeof id !== 'string' || id === '')) {
      return invalid({ taskIds: '必须是任务 id 数组' });
    }
    const unique = [...new Set(taskIds as string[])];
    if (unique.length > DISPATCH_MAX_TASKS) {
      return invalid({ taskIds: `单次最多 ${DISPATCH_MAX_TASKS} 个任务，请分批调度` });
    }
    const strategy = payload.strategy;
    if (typeof strategy !== 'string' || !(DISPATCH_STRATEGY_SELECTIONS as readonly string[]).includes(strategy)) {
      return invalid({ strategy: `必须是 ${DISPATCH_STRATEGY_SELECTIONS.join(' / ')} 之一` });
    }
    const requestId = runPreview(store, baseData, taskStore, unique, strategy as DispatchStrategySelection, operator);
    if (typeof requestId !== 'string') {
      return requestId;
    }
    return ok(buildPreviewResult(store, requestId));
  }

  if (action === 'apply') {
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    if (!requestId) {
      return invalid({ requestId: '必填' });
    }
    const strategy = payload.strategy;
    if (typeof strategy !== 'string' || !(DISPATCH_STRATEGY_SELECTIONS as readonly string[]).includes(strategy)) {
      return invalid({ strategy: `必须是 ${DISPATCH_STRATEGY_SELECTIONS.join(' / ')} 之一` });
    }
    // `all` 是预览专用的取值：落库只能落一份（主进程同一口径）
    if (strategy === 'all') {
      return invalid({ strategy: 'apply 必须指定单一策略（all 仅用于预览对比）' });
    }
    const stored = loadApplicableOutput(store, requestId, strategy as DispatchStrategySelection);
    if ('code' in stored) {
      return stored;
    }
    return applyStored(store, baseData, taskStore, routeStore, requestId, strategy, stored.outcomes, operator, null);
  }

  if (action === 'manual-assign') {
    const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
    const vehicleId = typeof payload.vehicleId === 'string' ? payload.vehicleId : '';
    if (!taskId) return invalid({ taskId: '必填' });
    if (!vehicleId) return invalid({ vehicleId: '必填' });
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (!reason) return invalid({ reason: '手动指派 必须给出原因' });

    const at = new Date().toISOString();
    const built = buildSnapshot(store, baseData, taskStore, [taskId], at);
    if (!built.ok) return built.result;
    const task = built.snapshot.tasks[0];
    if (!task) return fail('TASK.NOT_FOUND', { id: taskId });
    const taskRow = taskStore.rows.find((row) => row.id === taskId);
    if (taskRow && taskRow.status !== 'pending') {
      return fail('TASK.STATE_CONFLICT', { tasks: [{ id: taskId, status: taskRow.status }], hint: '只有「待派」状态的任务可以进入调度预览' });
    }
    const vehicle = built.snapshot.vehicles.find((item) => item.id === vehicleId);
    if (!vehicle) return fail('VEHICLE.NOT_FOUND', { vehicleId });
    const runCtx = createRunContext(built.snapshot);
    const outcome = evaluatePair(runCtx, task, vehicle, { occupied: runCtx.occupied });
    if (!outcome.ok) {
      return fail('DISPATCH.NO_CANDIDATE', { rejection: outcome.reject });
    }
    const requestId = `manual_${randomId('x')}`;
    const applied = commitPlan(store, baseData, taskStore, routeStore, {
      requestId,
      taskId,
      vehicleId,
      strategy: 'greedy',
      plan: outcome.plan,
      at,
      operator
    });
    if ('code' in applied) return applied;
    appendLog(store, {
      requestId,
      action: 'manual_assign',
      strategy: 'greedy',
      taskIds: [taskId],
      summary: { totalTasks: 1, assigned: 1, rejectedCount: 0, totalCost: compositeScoreOf([outcome.plan], 0), elapsedMs: 0 },
      rejected: [],
      reason,
      elapsedMs: 0,
      operatorId: operator.id,
      operatorName: operator.name
    });
    return ok(applied.result);
  }

  if (action === 'recompute') {
    const taskId = typeof payload.taskId === 'string' ? payload.taskId : '';
    if (!taskId) return invalid({ taskId: '必填' });
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
    if (!reason) return invalid({ reason: '重算 必须给出原因' });
    const strategy = payload.strategy;
    if (typeof strategy !== 'string' || !(DISPATCH_STRATEGY_SELECTIONS as readonly string[]).includes(strategy)) {
      return invalid({ strategy: `必须是 ${DISPATCH_STRATEGY_SELECTIONS.join(' / ')} 之一` });
    }
    const row = taskStore.rows.find((item) => item.id === taskId);
    if (!row) return fail('TASK.NOT_FOUND', { id: taskId });
    if (!['assigned', 'running', 'paused'].includes(row.status)) {
      return fail('TASK.STATE_CONFLICT', {
        id: taskId,
        from: row.status,
        expected: ['assigned', 'running', 'paused'],
        hint: '只有已派发 / 执行中 / 已暂停的任务需要重算'
      });
    }
    const at = new Date().toISOString();
    const released = store.plans.filter((plan) => plan.taskId === taskId && plan.status === 'applied');
    for (const plan of released) {
      plan.status = 'superseded';
      // 这辆车可能还挂着**其它**生效计划（同车串行）：那它没被真正释放。
      // 无条件置 `idle` 会让下一次调度把车派出去，而旧单还在占用（主进程同一条判据）。
      const stillOccupied = store.plans.some(
        (other) => other.vehicleId === plan.vehicleId && other.status === 'applied' && other.taskId !== taskId
      );
      const vehicle = baseData.vehicles.find((item) => item.id === plan.vehicleId);
      if (!stillOccupied && vehicle && (vehicle.status === 'busy' || vehicle.status === 'reserved')) {
        vehicle.status = 'idle';
      }
    }
    row.status = 'pending';
    row.assignedVehicleId = null;
    row.vehicleCode = null;
    row.currentPlan = null;
    row.route = null;

    // 回收与随后那份新预览**共用同一个 requestId**（§10.4：事后要能对上「因为什么重算了哪张单」）
    const requestId = `req_${randomId('x')}`;
    appendLog(store, {
      requestId,
      action: 'recompute',
      strategy: strategy as DispatchStrategySelection,
      taskIds: [taskId],
      summary: { ...EMPTY_SUMMARY, totalTasks: 1 },
      rejected: [],
      reason,
      elapsedMs: 0,
      operatorId: operator.id,
      operatorName: operator.name
    });
    const previewed = runPreview(
      store,
      baseData,
      taskStore,
      [taskId],
      strategy as DispatchStrategySelection,
      operator,
      requestId
    );
    if (typeof previewed !== 'string') {
      return previewed;
    }
    return ok(buildPreviewResult(store, previewed));
  }

  return null;
}

/** 存档输出 → 预览回执（`explain` 在 Mock 侧为空，见文件头第 1 条）。 */
function buildPreviewResult(store: MockDispatchStore, requestId: string): { requestId: string; strategies: StrategyResult[] } {
  return { requestId, strategies: store.outputs.get(requestId) ?? [] };
}

function loadApplicableOutput(
  store: MockDispatchStore,
  requestId: string,
  strategy: DispatchStrategySelection
): { outcomes: StrategyResult[] } | ApiResult<never> {
  if (store.applied.has(requestId)) {
    return fail('DISPATCH.ALREADY_APPLIED', { requestId });
  }
  const outcomes = store.outputs.get(requestId);
  if (!outcomes) {
    return fail('DISPATCH.REQUEST_NOT_FOUND', { requestId });
  }
  const picked = strategy === 'all' ? outcomes : outcomes.find((item) => item.strategy === strategy);
  if (!picked) {
    return fail('DISPATCH.REQUEST_NOT_FOUND', { requestId });
  }
  return { outcomes };
}

/** 预览：只写一条日志、只改 `outputs`，不碰任务 / 车辆（`runPreview` 的 return 是 requestId 或失败信封）。 */
function runPreview(
  store: MockDispatchStore,
  baseData: MockBaseData,
  taskStore: MockTaskStore,
  taskIds: readonly string[],
  strategy: DispatchStrategySelection,
  operator: { id: string; name: string },
  requestId = `req_${randomId('x')}`
): string | ApiResult<never> {
  const notPending = taskIds
    .map((id) => ({ id, status: taskStore.rows.find((row) => row.id === id)?.status }))
    .filter((item) => item.status !== undefined && item.status !== 'pending');
  if (notPending.length > 0) {
    return fail('TASK.STATE_CONFLICT', { tasks: notPending, hint: '只有「待派」状态的任务可以进入调度预览' });
  }
  const now = new Date().toISOString();
  const built = buildSnapshot(store, baseData, taskStore, taskIds, now);
  if (!built.ok) {
    return built.result;
  }
  if (strategy !== 'all' && !SUPPORTED_DISPATCH_STRATEGIES.includes(strategy)) {
    return invalid({ strategy: `${strategy} 尚未实现（当前可用：${SUPPORTED_DISPATCH_STRATEGIES.join(' / ')}）` });
  }
  const outcomes: StrategyOutcome[] =
    strategy === 'all'
      ? runDispatchAll(built.snapshot)
      : [runDispatch(built.snapshot, strategy as (typeof SUPPORTED_DISPATCH_STRATEGIES)[number])];
  // `explain` 留空数组：它的唯一作者是主进程的 `explain.ts`（见文件头第 1 条边界）
  const results: StrategyResult[] = outcomes.map((outcome) => ({ ...outcome, explain: [] }));
  store.outputs.set(requestId, results);
  appendLog(store, {
    requestId,
    action: 'preview',
    strategy,
    taskIds: [...taskIds],
    summary: results[0]?.summary ?? EMPTY_SUMMARY,
    rejected: results[0]?.rejected ?? [],
    reason: null,
    elapsedMs: results[0]?.summary.elapsedMs ?? 0,
    operatorId: operator.id,
    operatorName: operator.name
  });
  return requestId;
}

/** 落一条计划（apply 与手动指派共用）：任务 / 车辆 / 计划三者必须一起成功。 */
function commitPlan(
  store: MockDispatchStore,
  baseData: MockBaseData,
  taskStore: MockTaskStore,
  routeStore: MockRouteStore,
  input: {
    requestId: string;
    taskId: string;
    vehicleId: string;
    strategy: string;
    plan: PlanPreview;
    at: string;
    operator: { id: string; name: string };
    /**
     * 本批次已经预留过的车辆（主进程 apply 里那个 `reservedInBatch` 的等价物）。
     *
     * 同一辆车在一批里**串行拉多单**是算法允许的（占用区间不重叠）。若第二条计划
     * 还按「车辆必须是 idle」判一次，就会得到一句与事实无关的「车辆状态不允许该操作」，
     * 整批回滚 —— 主进程与这里必须同口径（`mock-parity.test.ts` 守着）。
     */
    reservedInBatch?: ReadonlySet<string>;
  }
): { result: { requestId: string; strategy: string; appliedPlans: unknown[]; summary: StrategySummary } } | ApiResult<never> {
  const taskRow = taskStore.rows.find((row) => row.id === input.taskId);
  const vehicleRow = baseData.vehicles.find((row) => row.id === input.vehicleId);
  if (!taskRow) return fail('TASK.NOT_FOUND', { id: input.taskId });
  if (!vehicleRow) return fail('VEHICLE.NOT_FOUND', { vehicleId: input.vehicleId });
  // 条件更新（乐观锁）的等价物：先判后写，且判定用的是**当前**状态而不是预览时的
  if (taskRow.status !== 'pending') {
    return fail('TASK.STATE_CONFLICT', { taskId: input.taskId, expected: 'pending' });
  }
  if (vehicleRow.status !== 'idle' && input.reservedInBatch?.has(input.vehicleId) !== true) {
    return fail('VEHICLE.STATE_CONFLICT', { vehicleId: input.vehicleId, expected: 'idle' });
  }
  const from = baseData.sites.find((site) => site.id === taskRow.fromSiteId);
  const to = baseData.sites.find((site) => site.id === taskRow.toSiteId);
  const vehicleType = vehicleTypeOf(baseData, input.vehicleId);
  if (!from?.nodeId || !to?.nodeId || !vehicleType) {
    return fail('DISPATCH.PLAN_EXPIRED', { taskId: input.taskId });
  }
  const route = planRoute(baseData, {
    taskId: input.taskId,
    vehicleType,
    fromNodeId: from.nodeId,
    toNodeId: to.nodeId,
    at: input.at
  });
  if (!route) {
    return fail('DISPATCH.PLAN_EXPIRED', { taskId: input.taskId, message: '路线重推失败' });
  }

  store.seq += 1;
  const planId = `mock-plan-${store.seq}`;
  const routeId = `mock-route-${store.seq}`;
  taskRow.status = 'assigned';
  taskRow.assignedVehicleId = input.vehicleId;
  taskRow.vehicleCode = vehicleRow.code;
  taskRow.assignedAt = input.at;
  taskRow.updatedAt = input.at;
  // 任务详情里的「当前计划 + 当前路线」必须与计划行同步，否则详情页会显示「已派发但没有路线」
  taskRow.currentPlan = {
    id: planId,
    vehicleId: input.vehicleId,
    vehicleCode: vehicleRow.code,
    strategy: input.strategy,
    cost: input.plan.cost,
    routeId,
    appliedAt: input.at
  };
  taskRow.route = {
    id: routeId,
    distanceM: route.distanceM,
    durationS: route.durationS,
    algorithm: 'aStar',
    nodeCount: route.nodeIds.length,
    edgeCount: route.edgeIds.length
  };
  vehicleRow.status = 'reserved';
  store.plans.push({
    id: planId,
    requestId: input.requestId,
    taskId: input.taskId,
    vehicleId: input.vehicleId,
    strategy: input.strategy,
    status: 'applied',
    cost: input.plan.cost,
    routeId,
    occupiedFrom: input.plan.occupiedFrom,
    occupiedTo: input.plan.occupiedTo
  });
  routeStore.rows.push({
    id: routeId,
    taskId: input.taskId,
    fromNodeId: route.nodeIds[0] ?? '',
    toNodeId: route.nodeIds[route.nodeIds.length - 1] ?? '',
    viaNodeIds: [],
    nodeIds: route.nodeIds,
    edgeIds: route.edgeIds,
    distanceM: route.distanceM,
    durationS: route.durationS,
    algorithm: 'aStar',
    costDetail: {},
    warnings: route.warnings.map((warning) => warning.message),
    createdAt: input.at,
    createdBy: input.operator.name
  });

  return {
    result: {
      requestId: input.requestId,
      strategy: input.strategy,
      appliedPlans: [
        {
          planId,
          taskId: input.taskId,
          taskCode: taskRow.code,
          vehicleId: input.vehicleId,
          vehicleCode: vehicleRow.code,
          routeId,
          cost: input.plan.cost,
          occupiedFrom: input.plan.occupiedFrom,
          occupiedTo: input.plan.occupiedTo
        }
      ],
      summary: { totalTasks: 1, assigned: 1, rejectedCount: 0, totalCost: compositeScoreOf([input.plan], 0), elapsedMs: 0 }
    }
  };
}

/** 应用派发：把存档输出里的每条计划逐条落库（主进程在一个事务里，这里在同一段同步代码里）。 */
function applyStored(
  store: MockDispatchStore,
  baseData: MockBaseData,
  taskStore: MockTaskStore,
  routeStore: MockRouteStore,
  requestId: string,
  strategy: string,
  outcomes: StrategyResult[],
  operator: { id: string; name: string },
  reason: string | null
): ApiResult<unknown> {
  const stored = outcomes.find((item) => item.strategy === strategy) ?? outcomes[0];
  if (!stored) {
    return fail('DISPATCH.REQUEST_NOT_FOUND', { requestId });
  }
  const at = new Date().toISOString();
  const appliedPlans: unknown[] = [];
  const appliedTaskIds: string[] = [];
  /** 本批次已预留过的车辆（同车串行时不再重复判「必须 idle」，与主进程逐条对应）。 */
  const reservedInBatch = new Set<string>();
  const occupiedByVehicle = new Map<string, Array<{ from: string; to: string; taskId: string }>>();
  for (const plan of stored.plans) {
    // 同车串行必须时间不重叠；重叠说明这份存档自相矛盾（主进程抛同一个 code）
    const occupied = occupiedByVehicle.get(plan.vehicleId) ?? [];
    const overlapping = occupied.find((slot) => plan.occupiedFrom < slot.to && slot.from < plan.occupiedTo);
    if (overlapping) {
      for (const appliedTaskId of appliedTaskIds) {
        rollbackPlan(store, baseData, taskStore, appliedTaskId);
      }
      return fail('DISPATCH.PLAN_EXPIRED', {
        taskId: plan.taskId,
        conflictTaskId: overlapping.taskId,
        vehicleId: plan.vehicleId,
        hint: '同一车辆的两次占用时间重叠，请重新预览'
      });
    }
    occupied.push({ from: plan.occupiedFrom, to: plan.occupiedTo, taskId: plan.taskId });
    occupiedByVehicle.set(plan.vehicleId, occupied);
    const committed = commitPlan(store, baseData, taskStore, routeStore, {
      requestId,
      taskId: plan.taskId,
      vehicleId: plan.vehicleId,
      strategy,
      plan,
      at,
      operator,
      reservedInBatch
    });
    if ('code' in committed) {
      // 任何一条失败就整体回滚（主进程是单事务；这里手动撤销已提交的几条）
      for (const appliedTaskId of appliedTaskIds) {
        rollbackPlan(store, baseData, taskStore, appliedTaskId);
      }
      return committed;
    }
    appliedTaskIds.push(plan.taskId);
    reservedInBatch.add(plan.vehicleId);
    appliedPlans.push(...committed.result.appliedPlans);
  }
  store.applied.add(requestId);
  const summary: StrategySummary = {
    totalTasks: stored.summary.totalTasks,
    assigned: appliedPlans.length,
    rejectedCount: stored.summary.rejectedCount,
    totalCost: compositeScoreOf(stored.plans, stored.summary.rejectedCount),
    elapsedMs: stored.summary.elapsedMs
  };
  appendLog(store, {
    requestId,
    action: 'apply',
    strategy: strategy as DispatchStrategySelection,
    taskIds: appliedTaskIds,
    summary,
    rejected: stored.rejected,
    reason,
    elapsedMs: summary.elapsedMs,
    operatorId: operator.id,
    operatorName: operator.name
  });
  return ok({ requestId, strategy, appliedPlans, summary });
}

/** 回滚一条已提交的计划（仅 Mock 需要：主进程用 SQLite 事务，一次 ROLLBACK 就够）。 */
function rollbackPlan(
  store: MockDispatchStore,
  baseData: MockBaseData,
  taskStore: MockTaskStore,
  taskId: string
): void {
  const plan = [...store.plans].reverse().find((row) => row.taskId === taskId && row.status === 'applied');
  if (!plan) {
    return;
  }
  plan.status = 'cancelled';
  const taskRow = taskStore.rows.find((row) => row.id === taskId);
  if (taskRow) {
    taskRow.status = 'pending';
    taskRow.assignedVehicleId = null;
    taskRow.vehicleCode = null;
    taskRow.currentPlan = null;
    taskRow.route = null;
  }
  const vehicleRow = baseData.vehicles.find((row) => row.id === plan.vehicleId);
  if (vehicleRow) {
    vehicleRow.status = 'idle';
  }
}
