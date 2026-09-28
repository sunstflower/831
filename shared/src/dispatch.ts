/**
 * 调度算法入口（`docs/module-M4-dispatch.md` §3 与 §15 Step 2）。
 *
 * 只做「策略名 → 实现」的分派，不含任何 IO。策略的范围与二期规划见模块文档 §2.1：
 * `greedy` 与 `hungarian` 已实现，`genetic` 是二期的预留取值（枚举里已有，
 * 因此调用方拿到未知策略时要**显式报错**而不是静默回退到贪心 —— 静默回退会让
 * 「我选了遗传算法」与「系统跑了贪心」在界面上无法分辨）。
 */
import { DISPATCH_STRATEGIES, type DispatchStrategy } from './enums.js';
import { runGreedy, runHungarian } from './dispatch-strategies.js';
import type { DispatchSnapshot, StrategyOutcome } from './dispatch-types.js';

/** P4 已实现的策略集合（唯一作者）：接口层与界面据此给出「可选项」。 */
export const SUPPORTED_DISPATCH_STRATEGIES: readonly DispatchStrategy[] = ['greedy', 'hungarian'] as const;

export function isSupportedStrategy(strategy: DispatchStrategy): boolean {
  return SUPPORTED_DISPATCH_STRATEGIES.includes(strategy);
}

/** 全部已登记的策略（含未实现的），用于「非法策略」的提示文案。 */
export function allStrategyNames(): readonly DispatchStrategy[] {
  return DISPATCH_STRATEGIES;
}

export function runDispatch(snapshot: DispatchSnapshot, strategy: DispatchStrategy): StrategyOutcome {
  switch (strategy) {
    case 'greedy':
      return runGreedy(snapshot);
    case 'hungarian':
      return runHungarian(snapshot);
    default:
      throw new Error(`DISPATCH.STRATEGY_NOT_SUPPORTED: ${strategy}`);
  }
}

/** `strategy=all` 的语义：按固定顺序跑**全部已实现**策略（顺序稳定，便于对比展示）。 */
export function runDispatchAll(snapshot: DispatchSnapshot): StrategyOutcome[] {
  return SUPPORTED_DISPATCH_STRATEGIES.map((strategy) => runDispatch(snapshot, strategy));
}

export { runGreedy, runHungarian };
export * from './dispatch-types.js';
export {
  createRunContext,
  evaluatePair,
  graphFor,
  nearestNodeId,
  routeFor,
  startNodeOf,
  chargeRiskOf,
  costOf,
  type RunContext,
  type PairPlan,
  type PairFail,
  type EvaluateOptions
} from './dispatch-evaluate.js';
export { compareTasks, solveAssignment } from './dispatch-strategies.js';
