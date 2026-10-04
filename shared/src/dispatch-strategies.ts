/**
 * 贪心策略（`docs/module-M4-dispatch.md` §7.1，默认策略）。
 *
 * 任务按「优先级降序 → 时间窗升序」排序，逐个挑当前**代价最小**的可用车辆；
 * 选中即把占用槽写进本批的内存占用，后续任务立刻看得到（同一辆车不会被排两次重叠的活）。
 */
import { PRIORITY_WEIGHT, type RejectReason } from './enums.js';
import type { RejectItem } from './types.js';
import { compositeScoreOf, createRunContext, evaluatePair, type PairFail, type PairPlan } from './dispatch-evaluate.js';
import type { DispatchSnapshot, DispatchTaskView, StrategyOutcome } from './dispatch-types.js';

/**
 * 任务排序：优先级降序，其次时间窗开始升序（**没有时间窗的排最后**）。
 *
 * `id` 作为最后一级比较键是刻意的：排序必须**全序**，否则相同优先级 + 相同时间窗的两个任务
 * 在两次运行里可能换位，输出（`plans` 顺序）就不一致，Req-M4-6 的「可复核」不成立。
 */
export function compareTasks(a: DispatchTaskView, b: DispatchTaskView): number {
  const byPriority = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  if (byPriority !== 0) return byPriority;
  const aStart = a.timeWindowStart ?? '\uffff';
  const bStart = b.timeWindowStart ?? '\uffff';
  if (aStart !== bStart) return aStart < bStart ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 没有任何候选车辆时的兜底拒绝（§11：无可用车辆 → `DISPATCH.NO_CANDIDATE` 的前置信号）。 */
function noCandidate(task: DispatchTaskView, vehicleCount: number): RejectItem {
  return {
    taskId: task.id,
    reason: 'NO_AVAILABLE_VEHICLE',
    message: `任务 ${task.code} 没有可用车辆（候选 ${vehicleCount} 台）`,
    detail: { taskCode: task.code, candidateCount: vehicleCount }
  };
}

/**
 * 拒绝原因的**信息量**排序（`ISS-093` 的修法）。
 *
 * 六步短路是按「车辆级 → 任务级」排的，但**不能直接按步号取最大** ——
 * 第 1 步的 `VEHICLE_NOT_AVAILABLE` 只是「这台车现在没空」，可能换一台车就能跑，
 * 而第 2 步的 `LOAD_EXCEEDED` 是这台车**根本装不下**。判据应该是
 * 「**离能跑还差多少**」：越接近可行（或限制越临时），这条原因越可操作。
 *
 * 起因是演示数据里的一个反例：`AGV-01` 恒 `busy` 且恒在 `snapshot.vehicles` 首位，
 * 「取第一个失败原因」于是把 11 条占用区间冲突全报成同一句「AGV-01 不可用」，
 * 解释表看着像坏了，而真相是「四台可用车的班次都排满了」。
 *
 * 另一个方向的反例（同样必须成立）：900 kg 任务在 `CAR-02` 被预留后，
 * 其余车都是 `LOAD_EXCEEDED`（装不下）。此时若优先报 `LOAD_EXCEEDED`，
 * 就变成「没有车装得下 900 kg」—— **事实是有的，只是它现在不可用**。
 *
 * 于是顺序为：班次冲突 / 电量（只差资源，任务本身可做）→ 车辆不可用（临时状态）
 * → 载重 / 不可达 / 禁行（这台车对这条任务的**固有**限制）。
 * `NO_AVAILABLE_VEHICLE` 是「一台候选都没有」的兜底，恒排最后（正常不会参与比较）。
 * 并列时保留先遇到的那条（`snapshot.vehicles` 顺序稳定 → 结果可复核）。
 */
const REJECT_STEP_ORDER: Record<RejectReason, number> = {
  NO_AVAILABLE_VEHICLE: 0,
  UNREACHABLE: 1,
  RESTRICTION_VIOLATED: 2,
  LOAD_EXCEEDED: 3,
  VEHICLE_NOT_AVAILABLE: 4,
  BATTERY_INSUFFICIENT: 5,
  TIMEWINDOW_CONFLICT: 6
};

/** 从一组失败里挑一条最有信息量的（空数组返回 `null`，由调用方兜底）。 */
export function mostInformativeReject(fails: readonly RejectItem[]): RejectItem | null {
  let best: RejectItem | null = null;
  for (const item of fails) {
    if (!best || REJECT_STEP_ORDER[item.reason] > REJECT_STEP_ORDER[best.reason]) best = item;
  }
  return best;
}

export function runGreedy(snapshot: DispatchSnapshot): StrategyOutcome {
  const ctx = createRunContext(snapshot);
  const tasks = [...snapshot.tasks].sort(compareTasks);

  const plans: PairPlan['plan'][] = [];
  const rejected: RejectItem[] = [];

  for (const task of tasks) {
    let best: PairPlan | null = null;
    const fails: PairFail['reject'][] = [];

    for (const vehicle of snapshot.vehicles) {
      const result = evaluatePair(ctx, task, vehicle, { occupied: ctx.occupied });
      if (result.ok) {
        if (!best || result.plan.cost < best.plan.cost) best = result;
      } else {
        fails.push(result.reject);
      }
    }

    if (best) {
      plans.push(best.plan);
      ctx.occupied.push(best.slot);
    } else {
      rejected.push(mostInformativeReject(fails) ?? noCandidate(task, snapshot.vehicles.length));
    }
  }

  return {
    strategy: 'greedy',
    plans,
    rejected,
    summary: {
      totalTasks: snapshot.tasks.length,
      assigned: plans.length,
      rejectedCount: rejected.length,
      totalCost: compositeScoreOf(plans, rejected.length),
      elapsedMs: 0
    }
  };
}

/**
 * 匈牙利整体指派（`docs/module-M4-dispatch.md` §7.2）。
 *
 * 与贪心的区别：贪心是「逐个任务挑最优车」，会为了排在前面的任务占用掉一辆
 * 更适合后面任务的车；匈牙利在**整批**上最小化总代价。
 *
 * ## 三个不得不做的妥协，都在这里写明
 *
 * 1. **矩阵是静态的**，因此它只用**已落库的占用**判可行性。求解后仍按任务顺序
 *    重新评估一次再落计划 —— 这是一道**防御性复核**：匈牙利求的是匹配，
 *    每个车最多只接一单，所以「本批内同车重叠」理论上不会出现（`n > m` 的溢出
 *    已在步骤 2 预拒绝）；复核存在的意义是「万一矩阵与真实评估不一致，
 *    宁可拒绝，也不写一条自相矛盾的指派」。
 * 2. **`∞` 用有限大数**（`DISPATCH_FORBIDDEN_COST`）：标准匈牙利的势差迭代里
 *    `Infinity - Infinity = NaN`，会让「取最小」的比较静默失效（见 `constants.ts` 注释）。
 * 3. **`n > m` 时先预拒绝**：矩阵必须 `行 ≤ 列` 才能整体指派。先拒「一辆车都匹配不上」
 *    的任务（原因取该行的首个真实失败原因），若仍超编再按「优先级最低 → 时间窗最晚」
 *    的顺序拒到 `n ≤ m`（原因 `NO_AVAILABLE_VEHICLE`）—— 与模型文档 §7.2 一致。
 */
import { DISPATCH_FORBIDDEN_COST, DISPATCH_MAX_TASKS, DISPATCH_MAX_VEHICLES } from './dispatch-types.js';

/**
 * 标准匈牙利算法（Jonker-Volgenant 风格的势差迭代，`O(n^2 * m)`）。
 *
 * 入参 `cost` 是 `n × m`（`n ≤ m`）的有限数矩阵，返回 `row → col` 的指派（1 基下标）。
 * 调用方负责把不可行格填成有限大数并在结果里反查。
 */
export function solveAssignment(cost: readonly (readonly number[])[], n: number, m: number): number[] {
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(m + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0] ?? 0;
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const row = cost[i0 - 1];
        const cur = (row?.[j - 1] ?? DISPATCH_FORBIDDEN_COST) - (u[i0] ?? 0) - (v[j] ?? 0);
        if (cur < (minv[j] ?? Number.POSITIVE_INFINITY)) {
          minv[j] = cur;
          way[j] = j0;
        }
        if ((minv[j] ?? Number.POSITIVE_INFINITY) < delta) {
          delta = minv[j] ?? Number.POSITIVE_INFINITY;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          u[p[j] ?? 0] = (u[p[j] ?? 0] ?? 0) + delta;
          v[j] = (v[j] ?? 0) - delta;
        } else {
          minv[j] = (minv[j] ?? Number.POSITIVE_INFINITY) - delta;
        }
      }
      j0 = j1;
    } while ((p[j0] ?? 0) !== 0);

    do {
      const j1 = way[j0] ?? 0;
      p[j0] = p[j1] ?? 0;
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j += 1) {
    const row = (p[j] ?? 0) - 1;
    if (row >= 0 && row < n) assignment[row] = j - 1;
  }
  return assignment;
}

export function runHungarian(snapshot: DispatchSnapshot): StrategyOutcome {
  const ctx = createRunContext(snapshot);
  const allTasks = [...snapshot.tasks].sort(compareTasks).slice(0, DISPATCH_MAX_TASKS);
  const vehicles = snapshot.vehicles.slice(0, DISPATCH_MAX_VEHICLES);

  const plans: PairPlan['plan'][] = [];
  const rejected: RejectItem[] = [];

  // 逐对评估：既得到代价，也得到「不可行时该报什么原因」。
  const evaluated = allTasks.map((task: DispatchTaskView) =>
    vehicles.map((vehicle) => evaluatePair(ctx, task, vehicle, { occupied: ctx.occupied }))
  );

  // 步骤 1：一辆车都匹配不上的任务先拒（原因取该行第一个真实失败原因）。
  const remaining: number[] = [];
  evaluated.forEach((row, index) => {
    const feasible = row.some((cell) => cell.ok);
    if (!feasible) {
      const fails = row.filter((cell): cell is PairFail => !cell.ok).map((cell) => cell.reject);
      const task = allTasks[index];
      if (task) rejected.push(mostInformativeReject(fails) ?? fallbackReject(task));
    } else {
      remaining.push(index);
    }
  });

  // 步骤 2：仍超编（任务多于车辆）时，按「优先级最低 → 时间窗最晚」再拒到 n ≤ m。
  const maxAssignable = Math.min(vehicles.length, remaining.length);
  const extra = remaining.length - maxAssignable;
  const dropped = new Set<number>();
  if (extra > 0) {
    const byLeastUrgent = [...remaining].sort((a, b) => compareTasks(allTasks[b]!, allTasks[a]!));
    for (const index of byLeastUrgent.slice(0, extra)) {
      dropped.add(index);
      const task = allTasks[index];
      if (task) rejected.push(fallbackReject(task));
    }
  }

  const rows = remaining.filter((index) => !dropped.has(index));
  if (rows.length > 0 && vehicles.length > 0) {
    const matrix = rows.map((index) =>
      vehicles.map((_, column) => {
        const cell = evaluated[index]?.[column];
        if (!cell || !cell.ok) return DISPATCH_FORBIDDEN_COST;
        return cell.plan.cost;
      })
    );
    const assignment = solveAssignment(matrix, rows.length, vehicles.length);

    rows.forEach((taskIndex, rowIndex) => {
      const task = allTasks[taskIndex];
      const column = assignment[rowIndex] ?? -1;
      const vehicle = column >= 0 ? vehicles[column] : undefined;
      if (!task || !vehicle) {
        if (task) rejected.push(fallbackReject(task));
        return;
      }
      const cost = matrix[rowIndex]?.[column] ?? DISPATCH_FORBIDDEN_COST;
      if (cost >= DISPATCH_FORBIDDEN_COST) {
        const cell = evaluated[taskIndex]?.[column];
        rejected.push(cell && !cell.ok ? cell.reject : fallbackReject(task));
        return;
      }
      // 复核：本批内更早的指派可能已经占掉了这辆车 —— 这时必须改口，不能硬落库。
      const recheck = evaluatePair(ctx, task, vehicle, { occupied: ctx.occupied });
      if (recheck.ok) {
        plans.push(recheck.plan);
        ctx.occupied.push(recheck.slot);
      } else {
        rejected.push(recheck.reject);
      }
    });
  }

  const ordered = allTasks
    .map((task, index) => ({ task, index }))
    .filter(({ index }) => rows.includes(index))
    .map(({ task }) => task);
  plans.sort((a, b) => ordered.findIndex((t) => t.id === a.taskId) - ordered.findIndex((t) => t.id === b.taskId));

  return {
    strategy: 'hungarian',
    plans,
    rejected,
    summary: {
      totalTasks: snapshot.tasks.length,
      assigned: plans.length,
      rejectedCount: rejected.length,
      totalCost: compositeScoreOf(plans, rejected.length),
      elapsedMs: 0
    }
  };
}

function fallbackReject(task: DispatchTaskView): RejectItem {
  return {
    taskId: task.id,
    reason: 'NO_AVAILABLE_VEHICLE',
    message: `任务 ${task.code} 没有可用车辆`,
    detail: { taskCode: task.code }
  };
}
