/**
 * 占用区间模型（`docs/module-M4-dispatch.md` §6）。
 *
 * 一条指派生效后，车辆在 `[occupiedFrom, occupiedTo)` 内不可再被派 ——
 * 因此「时间窗是否冲突」在这里被简化成一个纯粹的**区间相交**问题。
 *
 * **半开区间**是刻意的：任务的 `occupiedTo` 正好是下一个任务的 `occupiedFrom` 时，
 * 「上一单刚做完就接下一单」是合法的（车辆不需要休息）。若用闭区间，
 * 这种首尾相接的排班会被判成冲突，调度员会发现「明明接得上却派不出去」。
 */

/** ISO 字符串 → epoch 毫秒。解析失败返回 `NaN`，由调用方决定怎么报。 */
export function toEpochMs(iso: string): number {
  return Date.parse(iso);
}

/** epoch 毫秒 → ISO 字符串（`Date#toISOString`，与库内其它时间列同口径）。 */
export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * 半开区间 `[aFrom, aTo)` 与 `[bFrom, bTo)` 是否相交。
 *
 * 前置 `aFrom < aTo && bFrom < bTo` 不是多余的：区间为空（`from === to`）时
 * `aFrom < bTo && bFrom < aTo` 会返回 `true`（只要空区间落在对方内部），
 * 而空区间在集合论上不含任何时刻、不该和谁冲突。当前调用方不会产生空占用
 * （`done > t2` 恒成立），但把这条语义写在函数里，比留给调用方记住更可靠。
 */
export function intervalsOverlap(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return aFrom < aTo && bFrom < bTo && aFrom < bTo && bFrom < aTo;
}

/** 某个时间槽是否与该车任一既有占用槽相交。 */
export function overlapsAny(slot: { from: number; to: number }, existing: readonly { from: number; to: number }[]): boolean {
  return existing.some((item) => intervalsOverlap(slot.from, slot.to, item.from, item.to));
}

/** 取最晚的一个时刻（`null` 表示「不限」，直接让位给另一个）。 */
export function latest(a: number, b: number): number {
  return a >= b ? a : b;
}

/**
 * 单车 × 单任务评估（`docs/module-M4-dispatch.md` §5）与代价函数（§7.3）。
 *
 * ## 短路顺序就是优先顺序
 *
 * 六步按固定顺序判断，命中即返回。顺序不是随意的：它把**车辆能力**（可用 / 载重 /
 * 电量）排在**路线**之前、把**路线**排在**时间窗**之前，于是同一对 (任务, 车辆)
 * 只会报一个「最根本」的拒绝原因。若顺序反过来，一辆没电的车会因为「顺路」而报
 * `TIMEWINDOW_CONFLICT`，调度员照着这个原因调时间窗，永远调不出结果。
 *
 * ## 路线复用
 *
 * 空驶段与执行段都走 M5 的 `searchRoute`。同一批调度里会出现大量重复的
 * (车种, 起点, 终点) 组合（同一辆车评估多个任务、同一车种的多辆车评估同一任务），
 * 因此结果按 key 缓存 —— 这是**性能**优化，不影响正确性：同 key 的输入完全一致。
 */
import { MIN_BATTERY_PERCENT } from './constants.js';
import type { RejectReason, VehicleType } from './enums.js';
import { buildRouteGraph, type RouteNodeInput } from './route-graph.js';
import { searchRoute, type RouteGraph, type RouteSearchResult } from './route-search.js';
import type { CostDetail, PlanPreview, RejectItem } from './types.js';
import {
  DISPATCH_BATTERY_PERCENT_PER_KM,
  DISPATCH_CHARGE_COMFORT_PERCENT,
  DISPATCH_LATE_TOLERANCE_S,
  type DispatchSnapshot,
  type DispatchTaskView,
  type DispatchVehicleView
} from './dispatch-types.js';

/** 一次调度的共享上下文：一次构造、多策略复用（图与路线缓存在此）。 */
export interface RunContext {
  snapshot: DispatchSnapshot;
  nowMs: number;
  graphs: Map<VehicleType, RouteGraph>;
  routeCache: Map<string, RouteSearchResult>;
  /** 本批预览内已占用的槽（内存，不落库）；随策略推进而增长。 */
  occupied: Array<{ vehicleId: string; from: number; to: number }>;
}

export function createRunContext(snapshot: DispatchSnapshot): RunContext {
  return { snapshot, nowMs: toEpochMs(snapshot.now), graphs: new Map(), routeCache: new Map(), occupied: [] };
}

/** 按车种构图（缓存）：禁行规则与车种速度都由 M5 的 `buildRouteGraph` 统一处理（D-49）。 */
export function graphFor(ctx: RunContext, vehicleType: VehicleType): RouteGraph {
  const cached = ctx.graphs.get(vehicleType);
  if (cached) return cached;
  const graph = buildRouteGraph({
    nodes: ctx.snapshot.nodes,
    edges: ctx.snapshot.edges,
    restrictions: ctx.snapshot.restrictions,
    vehicleType,
    at: ctx.snapshot.now
  });
  ctx.graphs.set(vehicleType, graph);
  return graph;
}

/** 两点间的最短路（按 `(车种, 起点, 终点)` 缓存）。算法固定 `aStar`（§7）。 */
export function routeFor(ctx: RunContext, vehicleType: VehicleType, fromNodeId: string, toNodeId: string): RouteSearchResult {
  const key = `${vehicleType}|${fromNodeId}|${toNodeId}`;
  const cached = ctx.routeCache.get(key);
  if (cached) return cached;
  const result = searchRoute(graphFor(ctx, vehicleType), {
    fromNodeId,
    toNodeId,
    algorithm: 'aStar',
    vehicleType
  });
  ctx.routeCache.set(key, result);
  return result;
}

/** 就近节点（车辆没有 `current_node_id` 时按欧氏距离取最近的一个可用节点）。 */
export function nearestNodeId(nodes: readonly RouteNodeInput[], x: number, y: number): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const distance = (node.x - x) ** 2 + (node.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node.id;
    }
  }
  return best;
}

/** 车辆的出发节点：优先「当前所在节点」，否则按坐标就近取点。 */
export function startNodeOf(vehicle: DispatchVehicleView, nodes: readonly RouteNodeInput[]): string | null {
  if (vehicle.startNodeId) return vehicle.startNodeId;
  return nearestNodeId(nodes, vehicle.x, vehicle.y);
}

export interface EvaluateOptions {
  /** 该车既有占用槽（含本批已派给它的槽）。 */
  occupied: ReadonlyArray<{ vehicleId: string; from: number; to: number }>;
  lateToleranceS?: number;
}

export interface PairPlan {
  ok: true;
  plan: PlanPreview;
  /** 供调用方累积占用槽用（避免二次解析 `occupiedFrom/To`）。 */
  slot: { vehicleId: string; from: number; to: number };
}

export interface PairFail {
  ok: false;
  reject: RejectItem;
}

function reject(task: DispatchTaskView, reason: RejectReason, message: string, detail: Record<string, unknown>): PairFail {
  return { ok: false, reject: { taskId: task.id, reason, message, detail } };
}

/** 路线失败原因 → 拒绝原因：只有「被规则封住」与「本来就到不了」两种引导。 */
function routeFailureReason(failure: Extract<RouteSearchResult, { ok: false }>): RejectReason {
  return failure.reason === 'BLOCKED' ? 'RESTRICTION_VIOLATED' : 'UNREACHABLE';
}

/**
 * 评估一对 (任务, 车辆)。六步短路，详见模块文档 §5。
 *
 * 注意：本函数**不改** `options.occupied`；累积占用由调用方（策略）负责 ——
 * 评估是纯函数，同样的入参永远得到同样的结论（Req-M4-6 可复核）。
 */
export function evaluatePair(
  ctx: RunContext,
  task: DispatchTaskView,
  vehicle: DispatchVehicleView,
  options: EvaluateOptions
): PairPlan | PairFail {
  const { snapshot, nowMs } = ctx;

  // 1) 车辆可用性：只有 idle 能接新任务
  if (vehicle.status !== 'idle') {
    return reject(task, 'VEHICLE_NOT_AVAILABLE', `车辆 ${vehicle.code} 当前不可用（状态 ${vehicle.status}）`, {
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      status: vehicle.status
    });
  }

  // 2) 载重
  const remainKg = vehicle.capacityKg - vehicle.loadKg;
  if (remainKg < task.cargoKg) {
    return reject(task, 'LOAD_EXCEEDED', `任务载重 ${task.cargoKg}kg 超过 ${vehicle.code} 剩余载重 ${remainKg}kg`, {
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      cargoKg: task.cargoKg,
      remainKg
    });
  }

  // 3) 出发节点可知
  const startNodeId = startNodeOf(vehicle, snapshot.nodes);
  if (!startNodeId) {
    return reject(task, 'UNREACHABLE', `${vehicle.code} 无法确定出发位置`, { vehicleId: vehicle.id, vehicleCode: vehicle.code });
  }

  // 4) 路线：空驶（车 → 任务起点）+ 执行（任务起点 → 终点）
  const deadhead = routeFor(ctx, vehicle.type, startNodeId, task.fromNodeId);
  if (!deadhead.ok) {
    return reject(task, routeFailureReason(deadhead), `${vehicle.code} 无法到达任务起点：${deadhead.message}`, {
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      leg: 'deadhead',
      routeReason: deadhead.reason
    });
  }
  const execute = routeFor(ctx, vehicle.type, task.fromNodeId, task.toNodeId);
  if (!execute.ok) {
    return reject(task, routeFailureReason(execute), `任务 ${task.code} 起点到终点无可行路径：${execute.message}`, {
      taskCode: task.code,
      leg: 'execute',
      routeReason: execute.reason
    });
  }

  // 5) 时间窗与占用
  const freeAtMs = toEpochMs(vehicle.freeAt);
  const t1 = Math.max(nowMs, Number.isNaN(freeAtMs) ? nowMs : freeAtMs);
  const arriveMs = t1 + deadhead.durationS * 1000;
  const windowStartMs = task.timeWindowStart ? toEpochMs(task.timeWindowStart) : null;
  const t2 = windowStartMs !== null && !Number.isNaN(windowStartMs) ? Math.max(arriveMs, windowStartMs) : arriveMs;
  const doneMs = t2 + execute.durationS * 1000;
  const lateToleranceS = options.lateToleranceS ?? DISPATCH_LATE_TOLERANCE_S;

  const windowEndMs = task.timeWindowEnd ? toEpochMs(task.timeWindowEnd) : null;
  const lateS = windowEndMs !== null && !Number.isNaN(windowEndMs) ? Math.max(0, (doneMs - windowEndMs) / 1000) : 0;
  if (lateS > lateToleranceS) {
    return reject(
      task,
      'TIMEWINDOW_CONFLICT',
      `任务 ${task.code} 预计晚点 ${Math.round(lateS)}s，超出容忍 ${lateToleranceS}s`,
      { taskCode: task.code, lateS: Math.round(lateS), toleranceS: lateToleranceS, expectedDoneAt: toIso(doneMs) }
    );
  }

  const own = options.occupied.filter((slot) => slot.vehicleId === vehicle.id);
  const conflict = own.find((slot) => slot.from < doneMs && t2 < slot.to);
  if (conflict) {
    return reject(task, 'TIMEWINDOW_CONFLICT', `${vehicle.code} 在 ${toIso(t2)} ~ ${toIso(doneMs)} 已被占用`, {
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      from: toIso(t2),
      to: toIso(doneMs),
      conflictWith: { from: toIso(conflict.from), to: toIso(conflict.to) }
    });
  }

  // 6) 电量
  const totalKm = (deadhead.distanceM + execute.distanceM) / 1000;
  const perKm = vehicle.batteryPercentPerKm ?? DISPATCH_BATTERY_PERCENT_PER_KM;
  const drainPercent = totalKm * perKm;
  const remainBattery = vehicle.battery - drainPercent;
  if (remainBattery < MIN_BATTERY_PERCENT) {
    return reject(
      task,
      'BATTERY_INSUFFICIENT',
      `${vehicle.code} 预计耗电 ${drainPercent.toFixed(1)}%，完成后剩余 ${remainBattery.toFixed(1)}%（低于 ${MIN_BATTERY_PERCENT}%）`,
      { vehicleId: vehicle.id, vehicleCode: vehicle.code, drainPercent, remainBattery, minBattery: MIN_BATTERY_PERCENT }
    );
  }

  const costDetail: CostDetail = {
    deadheadTimeS: deadhead.durationS,
    executeTimeS: execute.durationS,
    waitTimeS: Math.max(0, (t2 - arriveMs) / 1000),
    penaltyLateS: lateS,
    chargeRisk: chargeRiskOf(remainBattery)
  };

  return {
    ok: true,
    plan: {
      taskId: task.id,
      vehicleId: vehicle.id,
      vehicleCode: vehicle.code,
      route: {
        fromNodeId: task.fromNodeId,
        toNodeId: task.toNodeId,
        nodeIds: execute.nodeIds,
        distanceM: execute.distanceM,
        durationS: execute.durationS
      },
      cost: costOf(costDetail, snapshot.weights),
      costDetail,
      occupiedFrom: toIso(t2),
      occupiedTo: toIso(doneMs)
    },
    slot: { vehicleId: vehicle.id, from: t2, to: doneMs }
  };
}

/** 续航风险系数：低于「舒适电量」后按缺口比例给分，0-1（§7.3）。 */
export function chargeRiskOf(remainBattery: number): number {
  if (remainBattery >= DISPATCH_CHARGE_COMFORT_PERCENT) return 0;
  const gap = DISPATCH_CHARGE_COMFORT_PERCENT - Math.max(0, remainBattery);
  return gap / DISPATCH_CHARGE_COMFORT_PERCENT;
}

/** 代价函数（§7.3）：`w1*空驶 + w2*执行 + w3*等待 + w4*晚点 + w5*续航风险`。 */
export function costOf(detail: CostDetail, weights: DispatchSnapshot['weights']): number {
  return (
    weights.deadhead * detail.deadheadTimeS +
    weights.execute * detail.executeTimeS +
    weights.wait * detail.waitTimeS +
    weights.late * detail.penaltyLateS +
    weights.chargeRisk * detail.chargeRisk
  );
}
