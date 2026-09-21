/**
 * 车辆位置补帧的**纯计算**部分（无 React、无副作用，可单测）。
 *
 * 权威位置来自事件推送；这里只在「上一次位置 → 最新位置」之间线性插值补帧。
 *
 * **绝不外推**（D-21）：模拟执行器可能暂停、失败或被接管，按速度预测位置会让
 * 车辆显示在不存在的地方。超过 `STALE_MS` 没有新事件即冻结在最后已知位置。
 */

export interface XY {
  x: number;
  y: number;
}

export interface MotionTrip {
  from: XY;
  to: XY;
  startedAt: number;
}

export type MotionTrips = Record<string, MotionTrip | undefined>;

/** 单段缓动时长（ms）：设小一些让位置尽快追上真实值，避免视觉滞后。 */
export const EASE_MS = 400;
/** 超过该时长没有新事件则冻结（ms）。 */
export const STALE_MS = 1500;

/** 线性插值；`t` 会被夹在 0–1。 */
export function lerpXY(from: XY, to: XY, t: number): XY {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: from.x + (to.x - from.x) * clamped, y: from.y + (to.y - from.y) * clamped };
}

/**
 * 为某个车辆登记一段新的缓动。
 * 起点取「当前可见位置」（即上一段插值到此刻的位置），避免位置跳变。
 */
export function registerTrip(
  trips: MotionTrips,
  vehicleId: string,
  target: XY,
  now: number,
  currentVisible: XY | undefined
): MotionTrips {
  const existing = trips[vehicleId];
  if (existing && existing.to.x === target.x && existing.to.y === target.y) {
    return trips;
  }
  const from = existing ? lerpXY(existing.from, existing.to, (now - existing.startedAt) / EASE_MS) : (currentVisible ?? target);
  return { ...trips, [vehicleId]: { from, to: target, startedAt: now } };
}

export interface MotionFrame {
  positions: Record<string, XY>;
  /** 该帧是否仍有车辆在缓动中（用于判断是否值得继续跑 rAF）。 */
  animating: boolean;
}

/**
 * 计算某一时刻各车辆应绘制的位置。
 * `lastSeen[vehicleId]` 为该车辆最后一次收到真实坐标的时间戳。
 */
export function computeFrame(trips: MotionTrips, lastSeen: Record<string, number>, now: number): MotionFrame {
  const positions: Record<string, XY> = {};
  let animating = false;

  for (const [vehicleId, trip] of Object.entries(trips)) {
    if (!trip) {
      continue;
    }
    const seenAt = lastSeen[vehicleId] ?? 0;
    if (now - seenAt > STALE_MS) {
      // 冻结：保持最后已知位置，不外推
      positions[vehicleId] = trip.to;
      continue;
    }
    const t = (now - trip.startedAt) / EASE_MS;
    positions[vehicleId] = lerpXY(trip.from, trip.to, t);
    if (t < 1) {
      animating = true;
    }
  }

  return { positions, animating };
}

/** 两个坐标在视觉上是否可视为同一个点（避免无意义地更新画布）。 */
export function sameXY(a: XY | undefined, b: XY | undefined, epsilon = 0.01): boolean {
  if (!a || !b) {
    return a === b;
  }
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}
