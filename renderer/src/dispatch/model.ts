/**
 * 调度中心的**展示模型**（纯函数，无 IO、无 React）。
 *
 * ## 为什么单独一份而不是写在组件里
 *
 * 这一页要回答的问题不是「按钮点了有没有反应」，而是三个需要**算**的判断：
 *
 *   1. 两个策略跑完，**哪个更值得用**（指派更多？总代价更低？）；
 *   2. 一次派发**具体派了谁**（界面上的表格、二次确认里的清单、日志里的小结，
 *      必须是同一份数据算出来的三处展示）；
 *   3. 拒绝**为什么拒**（内核给的是枚举 + 结构化 detail，人读的说法要在这里拼）。
 *
 * 这些都能脱离 React 直接测（见 `model.test.ts`），而写进组件里就只能靠点界面验证。
 *
 * ## 不重算业务
 *
 * 本文件**不含**任何可行性判断（谁能派、代价多少、是否超载）：那些是内核
 * （`shared/src/dispatch-*.ts`）与主进程服务的事。这里只做「把已有结果翻译成人读的形状」——
 * 一旦在这里补一条「其实也可以派给 X」的规则，界面与日志就会开始给出不同的答案（D-21 的同类）。
 */
import {
  DISPATCH_LOG_ACTION_LABELS,
  DISPATCH_STRATEGY_LABELS,
  PRIORITY_WEIGHT,
  REJECT_REASON_LABELS
} from '@udm/shared';
import type {
  DispatchLogListItem,
  DispatchStrategyInfo,
  DispatchStrategySelection,
  PlanPreview,
  PreviewResult,
  RejectItem,
  StrategyResult,
  TaskListItem
} from '@udm/shared';
import { formatDateTime } from '../domain/format';
import { TASK_PRIORITY_LABEL } from '../domain/labels';

/**
 * 预览里的策略选择：已实现的两个 + `all`（一次跑全部，用于对比）。
 *
 * 直接复用服务端的 `DispatchStrategySelection`，不在渲染层另起一个联合类型 ——
 * 多一个类型就多一处「界面能选、接口不认」的机会。
 */
export type PreviewSelection = DispatchStrategySelection;

export const ALL_STRATEGIES_VALUE = 'all' as const;

/**
 * 预览可选项（策略下拉 / 单选组）。
 *
 * `all` **不是** `DispatchStrategy`（它只对预览有意义），因此它不在服务端清单里 ——
 * 这里补一项。服务端清单拿不到时（请求失败）只剩 `all` 一项，界面也不会空白，
 * 但「全部（对比）」在没有任何已实现策略时是禁用的，避免出现一个点了必然报错的入口。
 */
export function strategyOptions(infos: DispatchStrategyInfo[] | null | undefined): DispatchStrategyInfo[] {
  const list = infos ?? [];
  const options: DispatchStrategyInfo[] = [...list];
  if (!list.some((item) => (item.key as string) === ALL_STRATEGIES_VALUE)) {
    options.push({
      // `all` 不是 `DispatchStrategy`：接口把它作为**取值**接受，类型上用一次断言表达这件事
      key: ALL_STRATEGIES_VALUE as unknown as DispatchStrategyInfo['key'],
      label: '全部（对比）',
      description: '一次跑全部已实现策略，便于逐列对比后再选一个应用',
      enabled: list.some((item) => item.enabled)
    });
  }
  return options;
}

/**
 * 策略值的展示名。
 *
 * `all` 不走 `DISPATCH_STRATEGY_LABELS`（那是按 `DispatchStrategy` 建的），
 * 单独给一句 —— 否则日志表里会出现「all」这种机器值。
 */
export function strategyLabel(strategy: string): string {
  if (strategy === ALL_STRATEGIES_VALUE) {
    return '全部（对比）';
  }
  return (DISPATCH_STRATEGY_LABELS as Record<string, string>)[strategy] ?? strategy;
}

export function logActionLabel(action: DispatchLogListItem['action']): string {
  return DISPATCH_LOG_ACTION_LABELS[action] ?? action;
}

export function rejectReasonLabel(reason: RejectItem['reason']): string {
  return REJECT_REASON_LABELS[reason] ?? reason;
}

/** 任务 id → 任务编码（表格里要显示 `T20260926-0001` 而不是内部 uuid）。 */
export function taskCodesOf(tasks: readonly TaskListItem[]): Map<string, string> {
  return new Map(tasks.map((task) => [task.id, task.code]));
}

function codeOf(taskCodes: Map<string, string>, taskId: string): string {
  return taskCodes.get(taskId) ?? taskId;
}

/** 秒数：整数化，避免 `66.66666666666667s` 这种读不出来的数字。 */
function seconds(value: number): string {
  return `${Math.round(value)}s`;
}

/** 只取 `HH:mm:ss`：日期在同一次预览里必然相同，带上它只是噪音。 */
function clockOf(iso: string): string {
  return iso.length >= 19 ? iso.slice(11, 19) : iso;
}

/* ==================== 候选池 ==================== */

export interface CandidateOption {
  value: string;
  label: string;
  detail: string;
}

/**
 * 待派任务选项。
 *
 * 排序与内核的 `compareTasks` **同口径**（优先级降序 → 时间窗升序 → id）：
 * 下拉里的顺序应该与预览结果里出现的顺序一致，否则使用者会以为系统跳过了某个任务。
 * 没有时间窗的排最后（与内核一致：`\uffff` 兜底）。
 */
export function candidateOptions(tasks: readonly TaskListItem[]): CandidateOption[] {
  return [...tasks]
    .sort((a, b) => {
      const byPriority = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
      if (byPriority !== 0) return byPriority;
      const aStart = a.timeWindowStart ?? '\uffff';
      const bStart = b.timeWindowStart ?? '\uffff';
      if (aStart !== bStart) return aStart < bStart ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((task) => ({
      value: task.id,
      label: task.code,
      detail: `${task.title} · ${TASK_PRIORITY_LABEL[task.priority]} · ${task.cargoKg}kg${
        task.timeWindowStart ? ` · 时间窗至 ${clockOf(task.timeWindowEnd ?? task.timeWindowStart)}` : ''
      }`
    }));
}

/** 全选 / 清空之间的勾选状态（按钮文案用它决定显示「全选」还是「清空」）。 */
export function selectionState(
  selected: readonly string[],
  candidates: readonly CandidateOption[]
): 'none' | 'some' | 'all' {
  if (candidates.length === 0 || selected.length === 0) {
    return 'none';
  }
  return selected.length >= candidates.length ? 'all' : 'some';
}

/* ==================== 预览结果 ==================== */

export interface PlanRow {
  taskId: string;
  taskCode: string;
  vehicleId: string;
  vehicleCode: string;
  deadheadS: string;
  executeS: string;
  waitS: string;
  lateS: string;
  chargeRisk: string;
  cost: string;
  doneAt: string;
  /**
   * 这条计划**分配到的路线**：`起点 → 终点 · N 段 · M m`。
   *
   * 为什么在主表里单独给一列（对比表已有合计里程）：合计里程回答「哪个策略少跑路」，
   * 但回答不了「**这一单**为什么走了 300 m 而不是 150 m」—— 那是路线分配的差别，
   * 而使用者要的正是「同一批任务交给不同策略，路线分配哪里不一样」。
   */
  route: string;
  /** 途经段数（`route.nodeIds.length - 1`）；没有路线时为 0。 */
  routeSegments: number;
  /** 执行段里程（m，取整）；没有路线时为 0。 */
  routeDistanceM: number;
}

/** 一条派发计划 → 表格行。 */
export function planRowOf(plan: PlanPreview, taskCodes: Map<string, string>): PlanRow {
  return {
    taskId: plan.taskId,
    taskCode: codeOf(taskCodes, plan.taskId),
    vehicleId: plan.vehicleId,
    vehicleCode: plan.vehicleCode,
    deadheadS: seconds(plan.costDetail.deadheadTimeS),
    executeS: seconds(plan.costDetail.executeTimeS),
    waitS: seconds(plan.costDetail.waitTimeS),
    lateS: seconds(plan.costDetail.penaltyLateS),
    chargeRisk: plan.costDetail.chargeRisk.toFixed(2),
    cost: plan.cost.toFixed(1),
    doneAt: clockOf(plan.occupiedTo),
    route: routeTextOf(plan),
    routeSegments: plan.route ? Math.max(0, plan.route.nodeIds.length - 1) : 0,
    routeDistanceM: plan.route ? Math.round(plan.route.distanceM) : 0
  };
}

/**
 * 一条计划的路线摘要（`载货段 N 段 / M m`）。
 *
 * 没有路线时说「无路线」而不是留空：空单元格读起来像「界面没做完」，
 * 而「有一单没算出路线」是一条要立刻看到的事实（风险预检也会为它报一条）。
 */
function routeTextOf(plan: PlanPreview): string {
  if (!plan.route) {
    return '无路线';
  }
  const segments = Math.max(0, plan.route.nodeIds.length - 1);
  return `${segments} 段 · ${Math.round(plan.route.distanceM)} m`;
}

export interface RejectRow {
  taskId: string;
  taskCode: string;
  reason: string;
  /** 结构化 detail 里那句「这次为什么」（例如「任务 900kg 超过 AGV-01 剩余 500kg」）。 */
  detail: string;
}

/**
 * `detail` 只挑已知键拼一句人读的摘要。
 *
 * 与主进程 `explain.ts` 同口径（那边是权威版本）：整段 JSON 塞进中文提示
 * 比没有摘要更糟 —— `{"vehicleId":"…","cargoKg":2000}` 对使用者不是信息。
 * 两边只保留「已知键」的另一个好处：`detail` 增加键时，这里不会静默泄漏内部字段。
 */
export function rejectDetailOf(item: RejectItem): string {
  const detail = item.detail as Record<string, unknown>;
  switch (item.reason) {
    case 'LOAD_EXCEEDED':
      return `任务 ${detail['cargoKg']}kg 超过 ${detail['vehicleCode'] ?? ''} 剩余 ${detail['remainKg']}kg`;
    case 'VEHICLE_NOT_AVAILABLE':
      return `${detail['vehicleCode'] ?? ''} 当前状态 ${detail['status'] ?? ''}`;
    case 'TIMEWINDOW_CONFLICT':
      return `预计晚点 ${seconds(Number(detail['lateS'] ?? 0))}，超出容忍 ${seconds(Number(detail['toleranceS'] ?? 0))}`;
    case 'BATTERY_INSUFFICIENT':
      return `完成后剩余 ${Number(detail['remainBattery'] ?? 0).toFixed(1)}%（下限 ${detail['minBattery']}%）`;
    case 'RESTRICTION_VIOLATED':
      return '必经路段被禁行规则封住';
    case 'UNREACHABLE':
      return '当前路网下无法到达';
    case 'NO_AVAILABLE_VEHICLE':
      return `候选 ${detail['candidateCount'] ?? 0} 台`;
    default:
      return '';
  }
}

export function rejectRowOf(item: RejectItem, taskCodes: Map<string, string>): RejectRow {
  return {
    taskId: item.taskId,
    taskCode: codeOf(taskCodes, item.taskId),
    reason: rejectReasonLabel(item.reason),
    detail: rejectDetailOf(item)
  };
}

/* ==================== 批量指标（「哪个更快、快多少」的数据来源） ==================== */

/** 秒数 → 人读时长（`95s` 读不出「快了多少」，`1 分 35 秒` 可以）。 */
export function durationText(value: number): string {
  const total = Math.round(value);
  if (total < 60) {
    return `${total} 秒`;
  }
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

/**
 * 一批计划的**可比指标**：对比表里的「执行里程 / 行驶耗时 / 完成时刻 / 用车」。
 *
 * 口径必须定在这里而不是散在组件里，否则「哪个策略更快」这句话会随渲染点变化：
 *   - `distanceM` 只累加**执行段**（任务起点 → 终点）。空驶段没有路线摘要
 *     （`PlanPreview.route` 是执行段，见 `shared/src/dispatch-evaluate.ts`），
 *     因此它不是「总里程」—— 列名也必须照实写「执行里程」；
 *   - `driveS` 是空驶 + 执行，即**车真正在动的时间**；等待与晚点不算行驶；
 *   - `finishAt` 取**最后一条计划**的完成时刻（整批做完的时刻）；
 *   - `relayTasks` 是「同一辆车接了第 2 单起」的单数 —— 它正是贪心比匈牙利多派的那部分。
 */
export interface OutcomeMetrics {
  distanceM: number;
  driveS: number;
  finishAt: string | null;
  vehicleCount: number;
  relayTasks: number;
}

export function outcomeMetricsOf(outcome: StrategyResult): OutcomeMetrics {
  const vehicles = new Set<string>();
  const perVehicle = new Map<string, number>();
  let distanceM = 0;
  let driveS = 0;
  let lastDone = Number.NEGATIVE_INFINITY;
  let finishAt: string | null = null;

  for (const plan of outcome.plans) {
    vehicles.add(plan.vehicleId);
    perVehicle.set(plan.vehicleId, (perVehicle.get(plan.vehicleId) ?? 0) + 1);
    distanceM += plan.route?.distanceM ?? 0;
    driveS += plan.costDetail.deadheadTimeS + plan.costDetail.executeTimeS;
    const done = Date.parse(plan.occupiedTo);
    if (!Number.isNaN(done) && done > lastDone) {
      lastDone = done;
      finishAt = plan.occupiedTo;
    }
  }

  let relayTasks = 0;
  for (const count of perVehicle.values()) {
    relayTasks += Math.max(0, count - 1);
  }

  return { distanceM, driveS, finishAt, vehicleCount: vehicles.size, relayTasks };
}

export interface OutcomeRow {
  strategy: string;
  label: string;
  assigned: number;
  totalTasks: number;
  rejectedCount: number;
  totalCost: string;
  elapsedMs: number;
  recommended: boolean;
  /** 执行里程合计（m，取整展示）——「哪个策略少跑路」的直接依据。 */
  distance: string;
  /** 行驶耗时合计（空驶 + 执行）——「哪个策略更快」的直接依据。 */
  drive: string;
  /** 整批完成时刻（`HH:mm:ss`）；没有计划时为 `—`。 */
  finishAt: string;
  /** 用车数与其中的接力单数（`4 台（含接力 1 单）`）。 */
  fleet: string;
}

/** 单条策略的小结（对比表的一行）。 */
export function outcomeRowOf(outcome: StrategyResult, recommendedStrategy: string | null): OutcomeRow {
  const metrics = outcomeMetricsOf(outcome);
  return {
    strategy: outcome.strategy,
    label: strategyLabel(outcome.strategy),
    assigned: outcome.summary.assigned,
    totalTasks: outcome.summary.totalTasks,
    rejectedCount: outcome.summary.rejectedCount,
    totalCost: outcome.summary.totalCost.toFixed(1),
    elapsedMs: Math.round(outcome.summary.elapsedMs),
    recommended: outcome.strategy === recommendedStrategy,
    distance: `${Math.round(metrics.distanceM)} m`,
    drive: durationText(metrics.driveS),
    finishAt: metrics.finishAt ? clockOf(metrics.finishAt) : '—',
    fleet:
      metrics.relayTasks > 0
        ? `${metrics.vehicleCount} 台（含接力 ${metrics.relayTasks} 单）`
        : `${metrics.vehicleCount} 台`
  };
}

export interface DifferenceLine {
  /** 被比较的策略（与被推荐的策略相对）。 */
  strategy: string;
  label: string;
  /** 一句话列出「它在哪里更好」；一条都没有时说明它全面落后。 */
  text: string;
}

/**
 * 「推荐的那个 vs 其它」的**逐项差异**。
 *
 * 推荐语只回答「选哪个」，回答不了「差在哪」—— 使用者要知道的是
 * 「另一个少跑 450 m、早 2 分 20 秒完成，但少派 1 单」这种可核对的话。
 * 因此这里逐项比指派数、执行里程、行驶耗时、完成时刻，**每一项都给出差值**。
 *
 * 只说「另一个更好的项」：把它落后的项也一并列出，读起来像在同时推荐两个策略。
 */
export function differenceLinesOf(
  outcomes: readonly StrategyResult[],
  recommendedStrategy: string | null
): DifferenceLine[] {
  if (!recommendedStrategy || outcomes.length < 2) {
    return [];
  }
  const recommended = outcomes.find((item) => item.strategy === recommendedStrategy);
  if (!recommended) {
    return [];
  }
  const base = outcomeMetricsOf(recommended);
  return outcomes
    .filter((item) => item.strategy !== recommendedStrategy)
    .map((item) => {
      const other = outcomeMetricsOf(item);
      const parts: string[] = [];
      const assigned = item.summary.assigned - recommended.summary.assigned;
      if (assigned > 0) parts.push(`多派 ${assigned} 单`);
      const savedM = Math.round(base.distanceM - other.distanceM);
      if (savedM > 0) parts.push(`少跑 ${savedM} m`);
      const savedS = base.driveS - other.driveS;
      if (savedS > 0.5) parts.push(`少行驶 ${durationText(savedS)}`);
      // 完成时刻：两边都有计划时才能比「谁先做完」
      const baseDone = base.finishAt ? Date.parse(base.finishAt) : Number.NaN;
      const otherDone = other.finishAt ? Date.parse(other.finishAt) : Number.NaN;
      if (!Number.isNaN(baseDone) && !Number.isNaN(otherDone)) {
        const earlierS = (baseDone - otherDone) / 1000;
        // `durationText` 自带「59 秒」里的空格，这里不再补一个 —— 「早 59 秒 完成」多了一处断句
        if (earlierS > 0.5) parts.push(`早 ${durationText(earlierS)}完成`);
      }
      const label = strategyLabel(item.strategy);
      return {
        strategy: item.strategy,
        label,
        text:
          parts.length > 0
            ? `「${label}」更优的地方：${parts.join('、')}`
            : `「${label}」在指派数、里程、耗时、完成时刻上没有一项优于「${strategyLabel(recommendedStrategy)}」`
      };
    });
}

/**
 * 派发明细的**按车辆分组视图**：一辆车一块，块内按时间排序列出它接的单。
 *
 * 为什么必须有这一屏：平铺的「任务 → 车辆」表看不出**接力**。一辆车接了 2 单时，
 * 表里只是两行同名的车，使用者读不出「先 A 后 B、B 用的是 A 做完之后的同一台车」——
 * 而这正是「贪心比匈牙利多派 1 单」的全部原因。
 *
 * `relay` 为真即「这台车在一批里接了不止一单」，`seq` 是它的接单顺序。
 */
export interface VehiclePlanStep {
  seq: number;
  taskId: string;
  taskCode: string;
  beginsAt: string;
  doneAt: string;
  deadheadS: string;
  executeS: string;
  distanceM: number;
  cost: string;
}

export interface VehiclePlanGroup {
  vehicleId: string;
  vehicleCode: string;
  relay: boolean;
  steps: VehiclePlanStep[];
}

export function vehiclePlanGroupsOf(
  outcome: StrategyResult,
  taskCodes: Map<string, string>
): VehiclePlanGroup[] {
  const groups = new Map<string, VehiclePlanGroup>();
  for (const plan of outcome.plans) {
    let group = groups.get(plan.vehicleId);
    if (!group) {
      group = { vehicleId: plan.vehicleId, vehicleCode: plan.vehicleCode, relay: false, steps: [] };
      groups.set(plan.vehicleId, group);
    }
    group.steps.push({
      seq: 0,
      taskId: plan.taskId,
      taskCode: codeOf(taskCodes, plan.taskId),
      beginsAt: clockOf(plan.occupiedFrom),
      doneAt: clockOf(plan.occupiedTo),
      deadheadS: seconds(plan.costDetail.deadheadTimeS),
      executeS: seconds(plan.costDetail.executeTimeS),
      distanceM: plan.route?.distanceM ?? 0,
      cost: plan.cost.toFixed(1)
    });
  }

  const list = [...groups.values()];
  for (const group of list) {
    // 组内按开始时刻升序：接力看的就是「先跑哪一单」
    group.steps.sort((a, b) => (a.beginsAt < b.beginsAt ? -1 : a.beginsAt > b.beginsAt ? 1 : 0));
    group.steps.forEach((step, index) => {
      step.seq = index + 1;
    });
    group.relay = group.steps.length > 1;
  }
  // 车辆之间也按「第一单的开始时刻」排：界面顺序与时间轴一致
  const firstAt = (group: VehiclePlanGroup) => (group.steps[0] ? group.steps[0].beginsAt : '');
  list.sort((a, b) => (firstAt(a) < firstAt(b) ? -1 : firstAt(a) > firstAt(b) ? 1 : 0));
  return list;
}

export interface Recommendation {
  strategy: string | null;
  text: string;
  tone: 'ok' | 'info' | 'warn';
}

/**
 * 推荐哪个策略。
 *
 * 判据只有两条，且**顺序不能反**：先比「指派了几个」（派不出去再便宜也没用），
 * 再比「总代价」（都派得出去时选更省的）。同分时保持列表原有顺序 ——
 * 与内核的策略顺序一致（`greedy` 在前），推荐因此不会在两次运行之间跳来跳去。
 *
 * 当两个策略的结论**完全相同**时明说「一致」而不是硬挑一个：那说明这批任务没有
 * 「为整体让路」的余地，使用者据此知道「选哪个都一样」，不必怀疑自己选错了。
 */
export function recommendationOf(outcomes: readonly StrategyResult[]): Recommendation {
  if (outcomes.length === 0) {
    return { strategy: null, text: '还没有预览结果', tone: 'info' };
  }
  if (outcomes.length === 1) {
    const only = outcomes[0]!;
    return {
      strategy: only.strategy,
      text:
        only.summary.assigned === 0
          ? '没有任何任务能派出，请看下面的拒绝原因'
          : `本次只跑了「${strategyLabel(only.strategy)}」：指派 ${only.summary.assigned}/${only.summary.totalTasks}`,
      tone: only.summary.assigned === 0 ? 'warn' : 'ok'
    };
  }
  const ranked = [...outcomes].sort((a, b) => {
    if (b.summary.assigned !== a.summary.assigned) return b.summary.assigned - a.summary.assigned;
    if (a.summary.totalCost !== b.summary.totalCost) return a.summary.totalCost - b.summary.totalCost;
    return 0;
  });
  const best = ranked[0]!;
  const second = ranked[1]!;
  if (best.summary.assigned === second.summary.assigned && best.summary.totalCost === second.summary.totalCost) {
    return {
      strategy: best.strategy,
      text: `两个策略结论一致（指派 ${best.summary.assigned}/${best.summary.totalTasks}，总代价 ${best.summary.totalCost.toFixed(1)}），选哪个都一样`,
      tone: 'info'
    };
  }
  const saved = second.summary.totalCost - best.summary.totalCost;
  const parts = [
    `推荐「${strategyLabel(best.strategy)}」：指派 ${best.summary.assigned}/${best.summary.totalTasks}，总代价 ${best.summary.totalCost.toFixed(1)}`
  ];
  if (best.summary.assigned > second.summary.assigned) {
    parts.push(`比「${strategyLabel(second.strategy)}」多派 ${best.summary.assigned - second.summary.assigned} 单`);
  } else if (saved > 0) {
    parts.push(`比「${strategyLabel(second.strategy)}」省 ${saved.toFixed(1)}`);
  }
  return { strategy: best.strategy, text: parts.join('，'), tone: 'ok' };
}

/** 二次确认清单：逐条列出「任务 → 车辆」，并给出预计完成时刻（`08:12:33`）。 */
export function confirmLinesOf(outcome: StrategyResult, taskCodes: Map<string, string>): string[] {
  return outcome.plans.map((plan) => {
    const row = planRowOf(plan, taskCodes);
    return `${row.taskCode} → ${row.vehicleCode}（空驶 ${row.deadheadS} + 执行 ${row.executeS}，预计 ${row.doneAt} 完成）`;
  });
}

/** 二次确认里「没派出去的那几单」：应用派发不会管它们，必须在确认框里说清。 */
export function confirmRejectLinesOf(outcome: StrategyResult, taskCodes: Map<string, string>): string[] {
  return outcome.rejected.map((item) => `${codeOf(taskCodes, item.taskId)}：${rejectReasonLabel(item.reason)}`);
}

/* ==================== 日志 ==================== */

export interface LogRow {
  id: string;
  time: string;
  action: string;
  strategy: string;
  taskCount: number;
  summary: string;
  reason: string;
  operator: string;
  requestId: string;
}

/**
 * 日志行。
 *
 * `summary` 拼成「派 2/3 · 拒 1 · 代价 120.4 · 12ms」：四件事都在这行里，
 * 因为「这条日志是成功还是失败、值不值得点开看」靠的正是这四者的组合。
 *
 * ## 为什么「重算」不能套同一个模板（实测踩到）
 *
 * 重算日志记录的是**回收动作**（`dispatch.service.ts` 的 `recompute`）：它先把
 * 原计划置 `superseded`、车辆回收、任务回 `pending`，随后才另做一次只读预览。
 * 因此那行日志的 `summary` 恒为「0 派 / 0 拒」——套用模板会显示成
 * 「派 0/1 · 拒 0」，读起来像「1 单里一单都没派、也没被拒，那这单去哪了」，
 * 而实际上它的产出是「回收了 1 条计划，新建议在同一 `requestId` 的预览里、尚未应用」。
 * 所以这一行动作单独给一句话，不给一个会被误读的数字组合。
 */
export function logRowOf(record: DispatchLogListItem): LogRow {
  return {
    id: record.id,
    time: formatDateTime(record.createdAt),
    action: logActionLabel(record.action),
    strategy: strategyLabel(record.strategy),
    taskCount: record.taskIds.length,
    summary:
      record.action === 'recompute'
        ? `回收 ${record.taskIds.length} 条计划 · 新建议待确认`
        : `派 ${record.summary.assigned}/${record.summary.totalTasks} · 拒 ${record.summary.rejectedCount} · 代价 ${record.summary.totalCost.toFixed(1)} · ${Math.round(record.elapsedMs)}ms`,
    reason: record.reason ?? '—',
    operator: record.operatorName ?? '—',
    requestId: record.requestId
  };
}

/* ==================== 请求体 ==================== */

/**
 * 预览请求体。
 *
 * `strategy` 一律显式带上：不传时服务端会回落默认值，而「我选的那个策略」
 * 与「实际算的那个」一旦不一致，界面上没有任何地方能发现（结果看起来同样合理）。
 */
export function previewPayload(taskIds: readonly string[], strategy: PreviewSelection): Record<string, unknown> {
  return { taskIds: [...taskIds], strategy };
}

/** 应用请求体（`strategy` 必须单一 —— `all` 只用于预览对比）。 */
export function applyPayload(requestId: string, strategy: string): Record<string, unknown> {
  return { requestId, strategy };
}

export function manualAssignPayload(taskId: string, vehicleId: string, reason: string): Record<string, unknown> {
  return { taskId, vehicleId, reason };
}

export function recomputePayload(taskId: string, strategy: string, reason: string): Record<string, unknown> {
  return { taskId, reason, strategy };
}

/** 从预览结果里取出某个策略的结果（对比表切换列时用；取不到返回 null 而不是抛错）。 */
export function outcomeOf(result: PreviewResult | null, strategy: string): StrategyResult | null {
  if (!result) {
    return null;
  }
  return result.strategies.find((item) => item.strategy === strategy) ?? null;
}

/** 可应用且尚未应用的 requestId 是否已就绪（应用按钮的启用条件）。 */
export function canApply(outcome: StrategyResult | null, busy: boolean): boolean {
  return !busy && outcome !== null && outcome.plans.length > 0;
}
