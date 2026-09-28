import { describe, expect, it } from 'vitest';
import { DISPATCH_COST_WEIGHTS } from './constants.js';
import { isSupportedStrategy, runDispatch, runDispatchAll, SUPPORTED_DISPATCH_STRATEGIES } from './dispatch.js';
import type { DispatchSnapshot } from './dispatch-types.js';

const snapshot: DispatchSnapshot = {
  tasks: [],
  vehicles: [],
  nodes: [],
  edges: [],
  restrictions: [],
  occupiedSlots: [],
  weights: { ...DISPATCH_COST_WEIGHTS },
  now: '2026-09-26T08:00:00.000Z'
};

describe('runDispatch 分派', () => {
  it('已实现策略：greedy / hungarian', () => {
    expect([...SUPPORTED_DISPATCH_STRATEGIES]).toEqual(['greedy', 'hungarian']);
    expect(runDispatch(snapshot, 'greedy').strategy).toBe('greedy');
    expect(runDispatch(snapshot, 'hungarian').strategy).toBe('hungarian');
    expect(isSupportedStrategy('genetic')).toBe(false);
  });

  it('strategy=all：按固定顺序返回全部已实现策略（顺序稳定，便于对比展示）', () => {
    expect(runDispatchAll(snapshot).map((outcome) => outcome.strategy)).toEqual(['greedy', 'hungarian']);
  });

  it('未实现的策略显式报错，不静默回退成贪心', () => {
    expect(() => runDispatch(snapshot, 'genetic')).toThrowError(/STRATEGY_NOT_SUPPORTED/);
  });

  it('空快照：两个策略都返回空计划而不是抛错', () => {
    for (const outcome of runDispatchAll(snapshot)) {
      expect(outcome.plans).toEqual([]);
      expect(outcome.rejected).toEqual([]);
      expect(outcome.summary.totalTasks).toBe(0);
    }
  });
});
