/**
 * M4 调度算法层的**纯类型**（`docs/module-M4-dispatch.md` §4）。
 *
 * 为什么和对外契约（`PlanPreview` / `RejectItem` / `StrategyResult`，在 `./types.ts`）
 * 分开：契约是**接口的输入输出**，这里描述的是**算法函数的入参形状**。两者共用同一份
 * 结果类型（`PlanPreview` 等直接 import 过来），只有「算法要吃的那份输入快照」是本文件独有的。
 *
 * 边界：本文件**不得 import 任何 db / domain 实现**，只消费传入的快照。
 * 因此 `nodes` / `edges` / `restrictions` 用的是 M5 构图的中立输入
 * （`RouteNodeInput` …），算法层自己按车种调用纯函数 `buildRouteGraph` 构图 ——
 * 见 [`evaluate.ts`](./evaluate.ts) 的 `graphFor`。
 */
import type { DispatchStrategy, TaskPriority, VehicleStatus, VehicleType } from './enums.js';
import type { RouteEdgeInput, RouteNodeInput, RouteRestrictionInput } from './route-graph.js';
import type { CostDetail, PlanPreview, RejectItem, StrategySummary } from './types.js';

/** 代价权重（`docs/module-M4-dispatch.md` §7.3）。缺省值由 `DISPATCH_COST_WEIGHTS` 提供。 */
export interface DispatchCostWeights {
  deadhead: number;
  execute: number;
  wait: number;
  late: number;
  chargeRisk: number;
}

/** 算法要看的任务视图：**已把站点解析成路网节点**，算法不再碰站点表。 */
export interface DispatchTaskView {
  id: string;
  code: string;
  priority: TaskPriority;
  cargoKg: number;
  /** 任务起点 / 终点对应的路网节点（由快照组装阶段从站点解析而来）。 */
  fromNodeId: string;
  toNodeId: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
}

/** 算法要看的车辆视图。运行态字段（`status` / `loadKg` / `battery`）是评估的输入。 */
export interface DispatchVehicleView {
  id: string;
  code: string;
  type: VehicleType;
  status: VehicleStatus;
  capacityKg: number;
  loadKg: number;
  /** 电量百分比（0-100），与 `vehicles.battery` 同口径。 */
  battery: number;
  maxSpeedMps: number;
  x: number;
  y: number;
  /**
   * 车辆当前所在的路网节点（`vehicles.current_node_id`）。
   *
   * 可空：车辆可以停在两节点之间（`current_node_id` 为 NULL），此时算法按 `x`/`y`
   * 就近取点。把它做成快照里的显式字段而不是让算法去猜，是因为「车在哪」是**运行态事实**，
   * 只应该有一个来源。
   */
  startNodeId: string | null;
  /** 该车**已落库**占用的最晚结束时刻（ISO）；没有占用时由快照填成 `now`。 */
  freeAt: string;
  /**
   * 每公里耗电百分点（0-100 口径）。
   *
   * 缺省时引擎用 `DISPATCH_BATTERY_PERCENT_PER_KM` 兜底。真实值来自车辆参数文件
   * （`energy_consumption_kwh_per_km` × 电池容量，见 D-31），但那些列尚未进 DDL；
   * 在补齐之前用常量，避免让「电量风险评估」在数据缺失时静默退化成永远 0。
   */
  batteryPercentPerKm?: number;
}

/** 车辆未来已占用的时间槽（apply 后产生；预览阶段只在内存里累积）。 */
export interface OccupiedSlot {
  taskId: string | null;
  vehicleId: string;
  from: string;
  to: string;
}

/** 一次调度的完整输入快照（`docs/module-M4-dispatch.md` §2.2：每次调用实时取，不跨周期缓存）。 */
export interface DispatchSnapshot {
  tasks: DispatchTaskView[];
  vehicles: DispatchVehicleView[];
  nodes: RouteNodeInput[];
  edges: RouteEdgeInput[];
  restrictions: RouteRestrictionInput[];
  occupiedSlots: OccupiedSlot[];
  weights: DispatchCostWeights;
  /** 服务端时钟（ISO）；同一批里所有策略与车辆共用同一个时刻（§6 第 1 条）。 */
  now: string;
}

/**
 * 单个策略的结果。
 *
 * 与对外契约 `StrategyResult` 的差别只有一处：**没有 `explain`**。
 * 原因见 `docs/module-M4-dispatch.md` §8 —— 解释文案面向人、含中文，
 * 属于表现层；算法层只产出结构化结果，由 `domain/dispatch/explain.ts` 翻译。
 */
export interface StrategyOutcome {
  strategy: DispatchStrategy;
  plans: PlanPreview[];
  rejected: RejectItem[];
  summary: StrategySummary;
}

/**
 * M4 算法层的常量（`docs/module-M4-dispatch.md` §7.3 / §16）。
 *
 * 权重不在这里 —— 它在 `shared/src/constants.ts` 的 `DISPATCH_COST_WEIGHTS`（唯一作者）。
 * 本文件只放**算法内部**的阈值：它们不对外承诺、也不进系统设置表。
 */

/** 预计完成时刻超过任务时间窗末端这么多秒以内，仍算可行（计入 `penaltyLateS`）。 */
export const DISPATCH_LATE_TOLERANCE_S = 300;

/** 电量高于此值时不产生「续航风险」代价分；低于它按缺口比例给分。 */
export const DISPATCH_CHARGE_COMFORT_PERCENT = 40;

/** 车辆没有给出 `batteryPercentPerKm` 时的兜底耗电率（每公里耗电百分点）。 */
export const DISPATCH_BATTERY_PERCENT_PER_KM = 5;

/** 单次预览的任务上限；超过提示分批（§16 第 1 条）。 */
export const DISPATCH_MAX_TASKS = 50;

/** 参与匈牙利指派的车辆上限；更多车辆只参与贪心（§16 第 1 条）。 */
export const DISPATCH_MAX_VEHICLES = 30;

/**
 * 匈牙利矩阵里表示「不可行」的有限大数。
 *
 * 为什么不用 `Infinity`：标准匈牙利算法的势差迭代要反复做 `minv[j] -= delta`，
 * 一旦出现 `Infinity - Infinity` 就得到 `NaN`，而 `NaN` 会让「取最小」的比较
 * 静默失效（`NaN < x` 恒为 false），矩阵看起来正常、结果却是任意的。
 * 用一个有限大数把「不可行」压到无穷贵，算法结束后再按 ≥ 该值反查哪些派发是无效的。
 */
export const DISPATCH_FORBIDDEN_COST = 1e12;

/**
 * 「一单没派出去」折算成的加权秒数（`docs/module-M4-dispatch.md` §7.3）。
 *
 * 为什么批次分数需要这一项：`summary.totalCost`（界面上的「加权综合分」）要能**跨策略比较**，
 * 而两个策略的指派数往往不同（贪心靠接力能多派，匈牙利一车一单必然少派）。
 * 若只把已派发计划的 `cost` 相加，被拒任务贡献 0 —— 于是「派得越少分数越低」，
 * 匈牙利看着永远更优，指标与「指派数优先」的推荐口径自相矛盾（实测：12 单时
 * 贪心 9 单却 2442 分、匈牙利 4 单却 1406 分）。
 *
 * 取值必须**大于任何单条计划的代价**，否则会出现反向激励（故意拒掉贵单反而分更低）。
 * 本演示路网单条计划代价的实测最大值为数百加权秒，理论最坏值（空驶+执行时长上限
 * + 晚点容忍 ×w4 + 续航风险上限 ×w5）约 2600；取 3600（一小时加权秒）留出约 1.4 倍余量。
 * 这是一个**口径常量**，不是物理量 —— 二期接入真实成本模型（违约赔付 / SLA）时改为可配置。
 */
export const DISPATCH_UNSERVED_PENALTY_S = 3600;
