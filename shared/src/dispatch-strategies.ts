/**
 * 贪心策略（`docs/module-M4-dispatch.md` §7.1，默认策略）。
 *
 * 任务按「优先级降序 → 时间窗升序」排序，逐个挑当前**代价最小**的可用车辆；
 * 选中即把占用槽写进本批的内存占用，后续任务立刻看得到（同一辆车不会被排两次重叠的活）。
 */
import { PRIORITY_WEIGHT } from './enums.js';
import type { RejectItem } from './types.js';
import { createRunContext, evaluatePair, type PairFail, type PairPlan } from './dispatch-evaluate.js';
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

export function runGreedy(snapshot: DispatchSnapshot): StrategyOutcome {
  const ctx = createRunContext(snapshot);
  const tasks = [...snapshot.tasks].sort(compareTasks);

  const plans: PairPlan['plan'][] = [];
  const rejected: RejectItem[] = [];

  for (const task of tasks) {
    let best: PairPlan | null = null;
    let firstFail: PairFail['reject'] | null = null;

    for (const vehicle of snapshot.vehicles) {
      const result = evaluatePair(ctx, task, vehicle, { occupied: ctx.occupied });
      if (result.ok) {
        if (!best || result.plan.cost < best.plan.cost) best = result;
      } else if (!firstFail) {
        firstFail = result.reject;
      }
    }

    if (best) {
      plans.push(best.plan);
      ctx.occupied.push(best.slot);
    } else {
      rejected.push(firstFail ?? noCandidate(task, snapshot.vehicles.length));
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
      totalCost: plans.reduce((sum, plan) => sum + plan.cost, 0),
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
      const firstFail = row.find((cell): cell is PairFail => !cell.ok);
      const task = allTasks[index];
      if (task) rejected.push(firstFail ? firstFail.reject : fallbackReject(task));
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
      totalCost: plans.reduce((sum, plan) => sum + plan.cost, 0),
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
