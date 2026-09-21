import '../../test/dom-stubs';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useVehicleMotion } from './useVehicleMotion';

function makeRef<T>(value: T): { current: T } {
  return { current: value };
}

describe('useVehicleMotion', () => {
  it('位置变化时通过 onFrame 回调输出画布坐标（y 已翻转）', async () => {
    const source = makeRef<Record<string, { x: number; y: number }>>({ v1: { x: 20, y: 0 } });
    const onFrame = vi.fn();

    renderHook(() => useVehicleMotion({ onFrame, sourceRef: source as never }));

    await vi.waitFor(() => {
      expect(onFrame).toHaveBeenCalled();
    });

    const positions = onFrame.mock.calls.at(-1)![0] as Record<string, { x: number; y: number }>;
    // 业务 20 m → 画布 60 px（PIXELS_PER_METER = 3），y 取负
    expect(positions.v1!.x).toBeCloseTo(60, 3);
    expect(positions.v1!.y).toBeCloseTo(0, 3);
  });

  it('位置源为空时不产生回调（不伪造坐标）', async () => {
    const source = makeRef<Record<string, { x: number; y: number }>>({});
    const onFrame = vi.fn();
    renderHook(() => useVehicleMotion({ onFrame, sourceRef: source as never }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(onFrame).not.toHaveBeenCalled();
  });
});
