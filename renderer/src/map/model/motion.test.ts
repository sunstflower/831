import { describe, expect, it } from 'vitest';
import { EASE_MS, STALE_MS, computeFrame, lerpXY, registerTrip, sameXY, type MotionTrips } from './motion';

describe('lerpXY', () => {
  it('t=0/0.5/1 分别取起点、中点、终点', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 50 };
    expect(lerpXY(from, to, 0)).toEqual({ x: 0, y: 0 });
    expect(lerpXY(from, to, 0.5)).toEqual({ x: 50, y: 25 });
    expect(lerpXY(from, to, 1)).toEqual({ x: 100, y: 50 });
  });

  it('t 超出 0–1 时被夹住（不越界）', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 10, y: 10 };
    expect(lerpXY(from, to, -5)).toEqual({ x: 0, y: 0 });
    expect(lerpXY(from, to, 5)).toEqual({ x: 10, y: 10 });
  });
});

describe('registerTrip', () => {
  it('目标未变化时不重建缓动（避免每帧重启动画）', () => {
    const target = { x: 10, y: 0 };
    const first = registerTrip({}, 'v1', target, 1000, undefined);
    const second = registerTrip(first, 'v1', target, 1016, undefined);
    expect(second).toBe(first);
  });

  it('首次登记且无历史位置时直接落在目标点（不做无意义的「从目标到目标」动画）', () => {
    const trips = registerTrip({}, 'v1', { x: 100, y: 0 }, 0, undefined);
    expect(trips.v1!.from).toEqual({ x: 100, y: 0 });
    expect(trips.v1!.to).toEqual({ x: 100, y: 0 });
  });

  it('有当前可见位置时，从该位置缓动到新目标', () => {
    const trips = registerTrip({}, 'v1', { x: 100, y: 0 }, 0, { x: 40, y: 0 });
    expect(trips.v1!.from).toEqual({ x: 40, y: 0 });
    expect(trips.v1!.to).toEqual({ x: 100, y: 0 });
  });

  it('目标变化时以上一段的当前插值点为新起点（位置不跳变）', () => {
    let trips: MotionTrips = registerTrip({}, 'v1', { x: 100, y: 0 }, 0, { x: 0, y: 0 });
    // 半程时改目标：新起点应约为 (50, 0)，既不是起点也不是旧目标
    trips = registerTrip(trips, 'v1', { x: 200, y: 0 }, EASE_MS / 2, undefined);
    expect(trips.v1!.from.x).toBeCloseTo(50, 5);
    expect(trips.v1!.to.x).toBe(200);
  });
});

describe('computeFrame', () => {
  it('在缓动窗口内按时间插值', () => {
    // 从画布位置 (0,0) 缓动到业务 100m（画布 300px）
    const trips = registerTrip({}, 'v1', { x: 300, y: 0 }, 0, { x: 0, y: 0 });
    const half = computeFrame(trips, { v1: 0 }, EASE_MS / 2);
    expect(half.positions.v1!.x).toBeCloseTo(150, 5);
    expect(half.animating).toBe(true);
  });

  it('缓动结束后停在目标点且不再算作动画中', () => {
    const trips = registerTrip({}, 'v1', { x: 300, y: 0 }, 0, { x: 0, y: 0 });
    const done = computeFrame(trips, { v1: EASE_MS }, EASE_MS);
    expect(done.positions.v1).toEqual({ x: 300, y: 0 });
    expect(done.animating).toBe(false);
  });

  it('超过 STALE_MS 没有新事件则冻结在最后位置，不外推', () => {
    const trips = registerTrip({}, 'v1', { x: 300, y: 0 }, 0, { x: 0, y: 0 });
    // 已静默很久：既不应继续插值前进，也不应预测出更远的位置
    const frozen = computeFrame(trips, { v1: 0 }, STALE_MS + 10_000);
    expect(frozen.positions.v1).toEqual({ x: 300, y: 0 });
    expect(frozen.animating).toBe(false);
  });
});

describe('sameXY', () => {
  it('浮点误差在阈值内视为同一点', () => {
    expect(sameXY({ x: 1, y: 1 }, { x: 1.0001, y: 1 })).toBe(true);
    expect(sameXY({ x: 1, y: 1 }, { x: 1.5, y: 1 })).toBe(false);
  });

  it('undefined 与有值视为不同', () => {
    expect(sameXY(undefined, { x: 0, y: 0 })).toBe(false);
    expect(sameXY(undefined, undefined)).toBe(true);
  });
});
