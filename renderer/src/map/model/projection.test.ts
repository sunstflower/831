import { describe, expect, it } from 'vitest';
import { PIXELS_PER_METER, fromFlowXY, toFlowXY } from './projection';

describe('projection', () => {
  it('翻转 y 轴并乘以比例（业务 y 向上、画布 y 向下）', () => {
    const origin = toFlowXY({ x: 20, y: 0 });
    expect(origin.x).toBe(20 * PIXELS_PER_METER);
    // 注意用 toBeCloseTo 而非 toEqual：`-0 !== 0`（Object.is），会误报
    expect(origin.y).toBeCloseTo(0, 10);
    // y 向上为正 → 画布上应变负（往上）
    expect(toFlowXY({ x: 0, y: 40 }).y).toBe(-40 * PIXELS_PER_METER);
  });

  it('支持负坐标（业务允许坐标为负）', () => {
    expect(toFlowXY({ x: -10, y: -20 })).toEqual({ x: -10 * PIXELS_PER_METER, y: 20 * PIXELS_PER_METER });
  });

  it('fromFlowXY 为逆变换', () => {
    const original = { x: 37.5, y: -12.25 };
    const roundTrip = fromFlowXY(toFlowXY(original));
    expect(roundTrip.x).toBeCloseTo(original.x, 6);
    expect(roundTrip.y).toBeCloseTo(original.y, 6);
  });
});
