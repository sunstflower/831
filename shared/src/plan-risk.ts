/**
 * 任务风险预检（`docs/api.md` §3.8.3）。
 *
 * ## 它回答的问题与「告警」不同
 *
 * 告警是**已经发生**的事（车辆离线了、任务失败了）。本模块回答的是**接下来会撞上什么**：
 * 按现在这份派发清单，哪些任务会超时、哪些车会撞单、哪台车跑不完。
 * 因此它是**纯推导**：同样的输入永远得到同样的输出，不读时钟、不写库、不发事件
 * （`nowMs` 由调用方注入 —— 与 `renderer/src/ops/model.ts` 的 `alertAgeOf` 同口径）。
 *
 * ## 为什么放在 `shared` 而不是渲染层
 *
 * 「这条计划会不会超时」是**业务判断**，不是展示格式。放在渲染层会立刻产生第二个裁判：
 * 界面算出「会超时 5 分钟」，而调度内核按同一份数据放行（或反之），
 * 使用者只能靠猜哪个算得对（D-21 / D-33 的同一教训）。放在 `shared` 后，
 * 主进程与浏览器 Mock 调的是**同一个函数**，两边不可能分叉。
 *
 * ## 与调度内核的关系
 *
 * 内核（`dispatch-evaluate.ts`）判的是「**能不能**派」——在派之前把不可行的组合拒掉。
 * 本模块判的是「**已经派了**，现在会怎样」——覆盖内核管不到的三类事实：
 *   1. 计划落库之后**世界变了**（时间窗被改、车掉线、电量掉到下限）；
 *   2. 内核按「容忍 300 s」放行的**轻微晚点**（`LATE_FINISH`）；
 *   3. 内核**根本没经手**的东西（演示数据 / 手工入库的计划、没有路线的计划）。
 * 两者的口径必须一致的地方只有一处：半开区间的重叠判定，直接复用
 * `intervalsOverlap` —— 否则「内核说接得上、预检说撞了」会是一句无法解释的话。
 */
import { MIN_BATTERY_PERCENT } from './constants.js';
import { DISPATCH_LATE_TOLERANCE_S } from './dispatch-types.js';
import { intervalsOverlap, toEpochMs, toIso } from './dispatch-evaluate.js';
import type { AlertLevel, TaskStatus, VehicleStatus } from './enums.js';
import {
  PLAN_RISK_KINDS,
  type PlanAssignment,
  type PlanRiskItem,
  type PlanRiskKind,
  type PlanRiskReport
} from './types.js';

/** 参与预检的任务（只要能在周期内出问题的那几个字段）。 */
export interface PlanRiskTaskInput {
  id: string;
  code: string;
  status: TaskStatus;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  cargoKg: number;
}

/** 参与预检的已生效计划（`dispatch_plans` 中 `status='applied'` 的行）。 */
export interface PlanRiskPlanInput {
  taskId: string;
  vehicleId: string;
  vehicleCode: string;
  /** 落库的路线 id；`null` 表示「有计划但没路线」，这本身就是一条风险。 */
  routeId: string | null;
  occupiedFrom: string;
  occupiedTo: string;
}

/** 参与预检的车辆运行态。 */
export interface PlanRiskVehicleInput {
  id: string;
  code: string;
  status: VehicleStatus;
  battery: number;
}

export interface PlanRiskOptions {
  /** 服务端「现在」（毫秒）。逾期类判断只用它，不用客户端时钟。 */
  nowMs: number;
  /** 晚点容忍（秒）；与内核同一个常量来源。 */
  toleranceS?: number;
  /** 电量下限（%）；低于它且还有未完成任务 → `BATTERY_RISK`。 */
  minBatteryPercent?: number;
}

/**
 * **占用着车辆**的状态（与 `listActiveOccupiedSlots` 同口径）。
 *
 * 用于两处：报告里 `assignments` 的过滤、以及「两单撞车」只在两条计划都还占用时才有意义。
 */
const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = ['assigned', 'running', 'paused'];

/**
 * **还没结束**的状态 —— 比上一条多一个 `pending`。
 *
 * 为什么必须分开（曾写错一次）：超时判断问的是「这单还来不来得及」，
 * 而 `pending`（待派发）恰恰是最容易超时的那一类 —— 它连车都还没排上。
 * 若拿 `ACTIVE_TASK_STATUSES` 去过超时循环，`pending` 任务的时间窗过期就**永远不报**，
 * 而界面上那些任务明明白白写着时间窗已经过去了。
 */
const UNFINISHED_TASK_STATUSES: readonly TaskStatus[] = ['pending', 'assigned', 'running', 'paused'];

/** 车辆此刻**跑不了**的状态：派出去了但执行不了。 */
const UNAVAILABLE_VEHICLE_STATUSES: readonly VehicleStatus[] = ['offline', 'fault', 'charging', 'disabled'];

/** 级别排序权重（`critical` 在最前）。 */
const LEVEL_RANK: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };

function seconds(value: number): number {
  return Math.round(value);
}

/** 一条风险的消息拼接：任务 / 车辆的展示名统一带 code，与列表页一致。 */
function labelOf(task: PlanRiskTaskInput): string {
  return task.code;
}

/**
 * 扫描一份派发（`docs/api.md` §3.8.3）。
 *
 * 输入是**已经装配好**的三张表，不是 SQL：调用方（主进程 / Mock / 测试）
 * 各自负责取数，本函数只做判断。
 */
export function scanPlanRisks(
  tasks: readonly PlanRiskTaskInput[],
  plans: readonly PlanRiskPlanInput[],
  vehicles: readonly PlanRiskVehicleInput[],
  options: PlanRiskOptions
): PlanRiskItem[] {
  const toleranceS = options.toleranceS ?? DISPATCH_LATE_TOLERANCE_S;
  const minBattery = options.minBatteryPercent ?? MIN_BATTERY_PERCENT;
  const nowMs = options.nowMs;

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const items: PlanRiskItem[] = [];

  /* ---- 1. 占位冲突：同一辆车两单时间区间相交 ---- */
  const byVehicle = new Map<string, PlanRiskPlanInput[]>();
  for (const plan of plans) {
    const list = byVehicle.get(plan.vehicleId);
    if (list) {
      list.push(plan);
    } else {
      byVehicle.set(plan.vehicleId, [plan]);
    }
  }
  for (const [vehicleId, list] of byVehicle) {
    // 只有「还没跑完的单」之间才谈得上撞车：已完成的两单先后发生，不会重叠
    const active = list.filter((plan) => {
      const task = taskById.get(plan.taskId);
      return task ? ACTIVE_TASK_STATUSES.includes(task.status) : false;
    });
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i]!;
        const b = active[j]!;
        const aFrom = toEpochMs(a.occupiedFrom);
        const aTo = toEpochMs(a.occupiedTo);
        const bFrom = toEpochMs(b.occupiedFrom);
        const bTo = toEpochMs(b.occupiedTo);
        if (!intervalsOverlap(aFrom, aTo, bFrom, bTo)) {
          continue;
        }
        const overlapS = seconds((Math.min(aTo, bTo) - Math.max(aFrom, bFrom)) / 1000);
        const aTask = taskById.get(a.taskId);
        const bTask = taskById.get(b.taskId);
        items.push({
          kind: 'VEHICLE_OVERLAP',
          level: 'critical',
          message: `${a.vehicleCode} 的两单时间重叠 ${overlapS} 秒：${aTask ? aTask.code : a.taskId} 与 ${
            bTask ? bTask.code : b.taskId
          } 抢同一台车`,
          suggestion: '把其中一单改派给别的车，或改时间窗；重叠不消除，两单必有一单执行不了。',
          taskIds: [a.taskId, b.taskId],
          taskCodes: [aTask ? aTask.code : a.taskId, bTask ? bTask.code : b.taskId],
          vehicleIds: [vehicleId],
          vehicleCodes: [a.vehicleCode],
          detail: {
            vehicleId,
            vehicleCode: a.vehicleCode,
            overlapS,
            first: { taskId: a.taskId, taskCode: aTask?.code ?? null, from: a.occupiedFrom, to: a.occupiedTo },
            second: { taskId: b.taskId, taskCode: bTask?.code ?? null, from: b.occupiedFrom, to: b.occupiedTo }
          }
        });
      }
    }
  }

  /* ---- 2. 逐条计划：车不可用 / 电量 / 无路线 / 预计超时 ---- */
  for (const plan of plans) {
    const task = taskById.get(plan.taskId);
    if (!task || !ACTIVE_TASK_STATUSES.includes(task.status)) {
      continue;
    }
    const vehicle = vehicleById.get(plan.vehicleId);
    if (!vehicle) {
      continue;
    }
    if (UNAVAILABLE_VEHICLE_STATUSES.includes(vehicle.status)) {
      items.push({
        kind: 'VEHICLE_UNAVAILABLE',
        level: 'critical',
        message: `${task.code} 派给了 ${vehicle.code}，但该车当前状态为 ${vehicle.status}，跑不了`,
        suggestion: '先把车恢复可用（上线 / 修好 / 充完电），或把这单改派给空闲车辆。',
        taskIds: [task.id],
        taskCodes: [labelOf(task)],
        vehicleIds: [vehicle.id],
        vehicleCodes: [vehicle.code],
        detail: { taskId: task.id, taskCode: task.code, vehicleId: vehicle.id, vehicleCode: vehicle.code, vehicleStatus: vehicle.status }
      });
    }
    if (vehicle.battery < minBattery) {
      items.push({
        kind: 'BATTERY_RISK',
        level: 'critical',
        message: `${vehicle.code} 剩余电量 ${vehicle.battery.toFixed(1)}%（低于 ${minBattery}%）却还挂着 ${task.code}`,
        suggestion: '先充电或换车 —— 电量低于下限时这单大概率跑不完。',
        taskIds: [task.id],
        taskCodes: [labelOf(task)],
        vehicleIds: [vehicle.id],
        vehicleCodes: [vehicle.code],
        detail: {
          taskId: task.id,
          taskCode: task.code,
          vehicleId: vehicle.id,
          vehicleCode: vehicle.code,
          battery: vehicle.battery,
          minBatteryPercent: minBattery
        }
      });
    }
    if (!plan.routeId) {
      items.push({
        kind: 'PLAN_WITHOUT_ROUTE',
        level: 'critical',
        message: `${task.code} 有派发计划但没有路线，地图上画不出这条线`,
        suggestion: '重算这条任务的派发（会同时补回路线），不要直接开始执行。',
        taskIds: [task.id],
        taskCodes: [labelOf(task)],
        vehicleIds: [vehicle.id],
        vehicleCodes: [vehicle.code],
        detail: { taskId: task.id, taskCode: task.code, vehicleId: vehicle.id, vehicleCode: vehicle.code }
      });
    }

    const doneMs = toEpochMs(plan.occupiedTo);
    const windowEndMs = task.timeWindowEnd ? toEpochMs(task.timeWindowEnd) : null;
    if (windowEndMs !== null && !Number.isNaN(windowEndMs) && !Number.isNaN(doneMs) && doneMs > windowEndMs) {
      const lateS = seconds((doneMs - windowEndMs) / 1000);
      items.push({
        kind: 'LATE_FINISH',
        level: lateS > toleranceS ? 'critical' : 'warning',
        message: `${task.code} 预计完成时间比时间窗末端晚 ${lateS} 秒`,
        suggestion:
          lateS > toleranceS
            ? '晚点已超出算法容忍范围，必须改派或改时间窗 —— 否则这单不该被派出。'
            : `晚点在容忍范围内（${toleranceS} 秒），但仍会迟到：可调整时间窗或换更快的车。`,
        taskIds: [task.id],
        taskCodes: [labelOf(task)],
        vehicleIds: [vehicle.id],
        vehicleCodes: [vehicle.code],
        detail: { taskId: task.id, taskCode: task.code, lateS, toleranceS, expectedDoneAt: plan.occupiedTo, timeWindowEnd: task.timeWindowEnd }
      });
    }
  }

  /* ---- 3. 超时：时间窗已过但任务还没结束（含还没派上车的那一类） ---- */
  for (const task of tasks) {
    if (!UNFINISHED_TASK_STATUSES.includes(task.status)) {
      continue;
    }
    const windowEndMs = task.timeWindowEnd ? toEpochMs(task.timeWindowEnd) : null;
    if (windowEndMs === null || Number.isNaN(windowEndMs) || nowMs <= windowEndMs) {
      continue;
    }
    const overdueS = seconds((nowMs - windowEndMs) / 1000);
    items.push({
      kind: 'WINDOW_EXPIRED',
      level: overdueS > toleranceS ? 'critical' : 'warning',
      message: `${task.code} 的时间窗已经过去 ${overdueS} 秒，任务仍处于 ${task.status}`,
      suggestion:
        task.status === 'running' || task.status === 'paused'
          ? '已在执行就别改了：让它跑完，事后补一条超时说明。'
          : '还没开始就已超时 —— 要么重新排窗口，要么取消这单。',
      taskIds: [task.id],
      taskCodes: [labelOf(task)],
      vehicleIds: [],
      vehicleCodes: [],
      detail: { taskId: task.id, taskCode: task.code, overdueS, timeWindowEnd: task.timeWindowEnd, status: task.status }
    });
  }

  /* ---- 4. 缺口：待派发任务还没有任何计划 ---- */
  const plannedTaskIds = new Set(plans.map((plan) => plan.taskId));
  for (const task of tasks) {
    if (task.status !== 'pending' || plannedTaskIds.has(task.id)) {
      continue;
    }
    const windowEndMs = task.timeWindowEnd ? toEpochMs(task.timeWindowEnd) : null;
    const overdueS =
      windowEndMs !== null && !Number.isNaN(windowEndMs) && nowMs > windowEndMs ? seconds((nowMs - windowEndMs) / 1000) : null;
    items.push({
      kind: 'UNASSIGNED_TASK',
      level: overdueS !== null ? 'critical' : 'warning',
      message:
        overdueS !== null
          ? `${task.code} 还没派发，而它的时间窗已经过去 ${overdueS} 秒`
          : `${task.code} 仍是待派发，没有安排车辆`,
      suggestion:
        overdueS !== null
          ? '已经赶不上原时间窗了：重新排一个窗口，或走取消流程（不要让它一直挂在待派发里）。'
          : '在调度中心勾选它做一次派发预览。',
      taskIds: [task.id],
      taskCodes: [labelOf(task)],
      vehicleIds: [],
      vehicleCodes: [],
      detail: { taskId: task.id, taskCode: task.code, timeWindowEnd: task.timeWindowEnd, overdueS }
    });
  }

  const order = new Map(PLAN_RISK_KINDS.map((kind, index) => [kind, index]));
  return items.sort((a, b) => {
    const levelDiff = LEVEL_RANK[a.level] - LEVEL_RANK[b.level];
    if (levelDiff !== 0) {
      return levelDiff;
    }
    const kindDiff = (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0);
    if (kindDiff !== 0) {
      return kindDiff;
    }
    // 同一类内按任务编码排，保证「同样的数据两次扫描顺序相同」
    return (a.taskCodes[0] ?? '').localeCompare(b.taskCodes[0] ?? '');
  });
}

/**
 * 「这条任务此刻派给了谁、走哪条路、占了哪段时间」的**原始素材**。
 *
 * 两个调用方（主进程查 SQLite、Mock 读内存）各自把它拼出来，**判断留给下面那个函数** ——
 * 因为这里藏着一条真正的业务规则，见 `planInputsOf`。
 */
export interface PlanRiskAssignmentSource {
  taskId: string;
  taskStatus: TaskStatus;
  /** 没有指派车辆时为 `null`（待派发）—— 这种素材会被丢掉，它不该出现在派发区块里。 */
  vehicleId: string | null;
  vehicleCode: string | null;
  /** 生效计划（`dispatch_plans.status='applied'`）；没有则为 `null`。 */
  plan: { routeId: string | null; occupiedFrom: string; occupiedTo: string } | null;
  /** 任务名下**最新的**路线（回退用）；没有则为 `null`。 */
  fallbackRoute: { id: string; durationS: number } | null;
  /** 回退区间的起点：开始执行 → 指派 → 创建，取第一个有值的。 */
  fallbackFrom: string;
}

/**
 * 素材 → 算法要的计划输入。
 *
 * ## 唯一的业务规则：**计划优先，其次按路线回退**
 *
 * `dispatch_plans` 是「此刻有效的计划」的真身（D-25），有它就用它落库的占用区间。
 * 但**演示数据不走调度流程**（D-26）：seed 写的是「任务 running + 一条 `routes` 行」，
 * 没有计划行 —— 执行器 / 任务详情因此都留了「按 `routes.task_id` 回退」的第二级查法
 * （`execution.repo.ts` 的注释写明了原因）。
 *
 * 预检必须用**同一套两级判据**，否则会出现最尴尬的一类不一致：车真的在按演示路线跑，
 * 而告警中心为这条任务报「有派发计划但没有路线」。回退行没有落库的占用区间，
 * 就按「开始那一刻 + 路线时长」推导 —— 与执行器推进任务的时间轴同口径。
 *
 * 这条规则放在 `shared` 而不是各写一遍：它是业务判断（哪些数据算「有派发」），
 * 两边各写一份必然在某个分支上分叉，而分叉只表现为「浏览器与桌面端结论不同」。
 */
export function planInputsOf(sources: readonly PlanRiskAssignmentSource[]): PlanRiskPlanInput[] {
  const inputs: PlanRiskPlanInput[] = [];
  for (const source of sources) {
    if (!source.vehicleId || !source.vehicleCode) {
      continue;
    }
    if (source.plan) {
      inputs.push({
        taskId: source.taskId,
        vehicleId: source.vehicleId,
        vehicleCode: source.vehicleCode,
        routeId: source.plan.routeId,
        occupiedFrom: source.plan.occupiedFrom,
        occupiedTo: source.plan.occupiedTo
      });
      continue;
    }
    const fromMs = Date.parse(source.fallbackFrom);
    if (!source.fallbackRoute || Number.isNaN(fromMs)) {
      // 指派了车但查不到路线：仍然算一条计划（`routeId: null` → 报「缺路线」）。
      // 用零长度区间表达「这条任务挂在这台车上」这个事实 —— 时间判断不归这里管。
      inputs.push({
        taskId: source.taskId,
        vehicleId: source.vehicleId,
        vehicleCode: source.vehicleCode,
        routeId: null,
        occupiedFrom: source.fallbackFrom,
        occupiedTo: source.fallbackFrom
      });
      continue;
    }
    inputs.push({
      taskId: source.taskId,
      vehicleId: source.vehicleId,
      vehicleCode: source.vehicleCode,
      routeId: source.fallbackRoute.id,
      occupiedFrom: source.fallbackFrom,
      occupiedTo: toIso(fromMs + source.fallbackRoute.durationS * 1000)
    });
  }
  return inputs;
}

/**
 * 报告形状的**唯一作者**（`GET /api/alerts/risks` 的回执）。
 *
 * 除了风险本身，还把「这次扫描看到的那份世界」一并给出：
 *   - `assignments`：**已生效的派发**（任务 → 车辆 → 占用区间），界面据此渲染「任务分配派发」区块；
 *   - `unassignedTasks`：没有任何计划的待派发任务，界面据此渲染「还没安排」的缺口。
 *
 * 为什么合在一个回执里而不是各开一个接口：三者是同一次读取的三个视图，
 * 分成三次请求就会出现「风险说某车撞单，而派发区块里那两单已经不在」这种自相矛盾的画面。
 */
export function buildPlanRiskReport(
  items: readonly PlanRiskItem[],
  scannedAt: string,
  context: {
    tasks?: readonly PlanRiskTaskInput[];
    plans?: readonly PlanRiskPlanInput[];
  } = {}
): PlanRiskReport {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const item of items) {
    counts[item.level] += 1;
  }

  const tasks = context.tasks ?? [];
  const plans = context.plans ?? [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const assignments: PlanAssignment[] = plans
    .filter((plan) => {
      const task = taskById.get(plan.taskId);
      return task ? ACTIVE_TASK_STATUSES.includes(task.status) : false;
    })
    .map((plan) => {
      const task = taskById.get(plan.taskId)!;
      return {
        taskId: plan.taskId,
        taskCode: task.code,
        taskStatus: task.status,
        vehicleId: plan.vehicleId,
        vehicleCode: plan.vehicleCode,
        routeId: plan.routeId,
        occupiedFrom: plan.occupiedFrom,
        occupiedTo: plan.occupiedTo
      };
    })
    // 排序在服务端定死：界面按「车辆 → 开始时刻」分组时不必再排一次（两边排序会分叉）
    .sort((a, b) => {
      const byVehicle = a.vehicleCode.localeCompare(b.vehicleCode);
      return byVehicle !== 0 ? byVehicle : a.occupiedFrom.localeCompare(b.occupiedFrom);
    });

  const plannedTaskIds = new Set(plans.map((plan) => plan.taskId));
  const unassignedTasks = tasks
    .filter((task) => task.status === 'pending' && !plannedTaskIds.has(task.id))
    .map((task) => ({ taskId: task.id, taskCode: task.code, timeWindowEnd: task.timeWindowEnd }))
    .sort((a, b) => a.taskCode.localeCompare(b.taskCode));

  return { records: [...items], total: items.length, counts, scannedAt, assignments, unassignedTasks };
}

/** 风险类型的中文名（界面与日志共用；避免两个地方各写一份）。 */
export const PLAN_RISK_LABELS: Record<PlanRiskKind, string> = {
  VEHICLE_OVERLAP: '车辆撞单',
  VEHICLE_UNAVAILABLE: '车辆不可用',
  BATTERY_RISK: '电量不足',
  PLAN_WITHOUT_ROUTE: '缺路线',
  LATE_FINISH: '预计超时',
  WINDOW_EXPIRED: '已超时',
  UNASSIGNED_TASK: '未派发'
};
