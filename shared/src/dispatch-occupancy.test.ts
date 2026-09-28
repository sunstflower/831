import { describe, expect, it } from 'vitest';
import { intervalsOverlap, overlapsAny, toEpochMs, toIso } from './dispatch-evaluate.js';

const at = (iso: string) => toEpochMs(iso);

describe('occupancy · 半开区间', () => {
  it('首尾相接不算冲突（上一单刚做完就能接下一单）', () => {
    const a = at('2026-09-26T08:00:00.000Z');
    const b = at('2026-09-26T08:01:00.000Z');
    expect(intervalsOverlap(a, b, b, at('2026-09-26T08:02:00.000Z'))).toBe(false);
  });

  it('有真实重叠 → 冲突（哪怕只重叠 1 秒）', () => {
    const a = at('2026-09-26T08:00:00.000Z');
    const b = at('2026-09-26T08:01:00.000Z');
    expect(intervalsOverlap(a, b, at('2026-09-26T08:00:59.000Z'), at('2026-09-26T08:05:00.000Z'))).toBe(true);
  });

  it('完全包含 / 被包含都算冲突', () => {
    const outer = [at('2026-09-26T08:00:00.000Z'), at('2026-09-26T09:00:00.000Z')] as const;
    const inner = [at('2026-09-26T08:10:00.000Z'), at('2026-09-26T08:20:00.000Z')] as const;
    expect(intervalsOverlap(...outer, ...inner)).toBe(true);
    expect(intervalsOverlap(...inner, ...outer)).toBe(true);
  });

  it('零长度区间（from === to）不与他人冲突', () => {
    const t = at('2026-09-26T08:00:00.000Z');
    expect(intervalsOverlap(t, t, at('2026-09-26T07:00:00.000Z'), at('2026-09-26T09:00:00.000Z'))).toBe(false);
  });

  it('overlapsAny 只看给定的那组槽', () => {
    const slots = [{ from: at('2026-09-26T08:00:00.000Z'), to: at('2026-09-26T08:10:00.000Z') }];
    expect(overlapsAny({ from: at('2026-09-26T08:05:00.000Z'), to: at('2026-09-26T08:06:00.000Z') }, slots)).toBe(true);
    expect(overlapsAny({ from: at('2026-09-26T09:00:00.000Z'), to: at('2026-09-26T09:10:00.000Z') }, slots)).toBe(false);
    expect(overlapsAny({ from: 0, to: 1 }, [])).toBe(false);
  });

  it('toIso / toEpochMs 往返一致', () => {
    const iso = '2026-09-26T08:00:00.000Z';
    expect(toIso(toEpochMs(iso))).toBe(iso);
  });

  it('无法解析的时间返回 NaN（调用方必须自己兜底，而不是当成 0）', () => {
    expect(Number.isNaN(toEpochMs('不是时间'))).toBe(true);
  });
});
