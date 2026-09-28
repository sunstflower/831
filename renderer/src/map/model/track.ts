/**
 * 车辆轨迹（`GET /api/map/tracks/{vehicleId}`）的**纯计算层**。
 *
 * 轨迹是执行器（M7）按固定周期采样的结果：一串「什么时候、在哪、多快、什么状态」。
 * 本文件只做三件不依赖 DOM 的事，因此可以完整单测：
 *   1. 把采样点换算到画布坐标（复用 `projection.ts`，与节点/边同一套变换）；
 *   2. 汇总时间跨度 / 折线里程 / 速度极值（回放面板要报告的指标）；
 *   3. 把「回放进度 0–1」映射到某一条采样点的下标。
 *
 * ## 为什么这里不做插值
 *
 * 采样点之间**不能**像实时车辆那样补帧（D-21 / `motion.ts` 的 `registerTrip`）：
 * 实时补帧是在两个已知位置之间按时间缓动，而回放要展示的恰恰是「执行器实际记下了什么」。
 * 在采样点之间画插值曲线，等于把「没有观测到的时间段」画成「观测到了」——
 * 轨迹一旦被当作证据（事故复盘），这是不能接受的失真。因此折线只连采样点本身。
 */
import type { VehicleTrackPoint } from '@udm/shared';
import { toFlowXY } from './projection';

/** 轨迹汇总指标。空轨迹一律给 0，不返回 `NaN`（面板会直接显示这些数）。 */
export interface TrackSummary {
  /** 采样点数。 */
  count: number;
  /** 首末采样的时间跨度（毫秒）；单点或空轨迹为 0。 */
  durationMs: number;
  /** 折线里程（米）：相邻采样点的直线距离之和，**不是**行驶里程表读数。 */
  distanceM: number;
  /** 采样点里的最高速度（米/秒）。 */
  maxSpeedMps: number;
  /** 平均速度（米/秒）= 折线里程 / 时间跨度；跨度为 0 时取 0 而不是无穷。 */
  avgSpeedMps: number;
}

export function trackSummary(points: VehicleTrackPoint[]): TrackSummary {
  if (points.length === 0) {
    return { count: 0, durationMs: 0, distanceM: 0, maxSpeedMps: 0, avgSpeedMps: 0 };
  }
  const first = Date.parse(points[0]!.ts);
  const last = Date.parse(points[points.length - 1]!.ts);
  // 库里可能有手工写入的坏时间戳：`NaN` 会让后续计算全变 `NaN`，这里收敛成 0
  const durationMs = Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, last - first) : 0;
  const distanceM = trackDistanceM(points);
  const maxSpeedMps = points.reduce((max, point) => Math.max(max, point.speedMps), 0);
  return {
    count: points.length,
    durationMs,
    distanceM,
    maxSpeedMps,
    avgSpeedMps: durationMs > 0 ? distanceM / (durationMs / 1000) : 0
  };
}

/** 折线里程（米）：相邻采样点的直线距离之和。 */
export function trackDistanceM(points: VehicleTrackPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    total += Math.hypot(current.x - previous.x, current.y - previous.y);
  }
  return total;
}

/**
 * 折线的 SVG `points` 字符串（画布坐标，可直接给 `<polyline>`）。
 *
 * `upto` 是**包含**的末点下标（回放进度用），缺省画完整条。
 * 只在 0 与 `length-1` 之间夹取：越界不抛错、不画错位 —— 面板的滑块与数据长度
 * 各自独立更新，中间态一定会出现「下标超出当前点数」。
 */
export function polylinePoints(points: VehicleTrackPoint[], upto?: number): string {
  if (points.length === 0) {
    return '';
  }
  const last = clampIndex(points.length, upto ?? points.length - 1);
  return points
    .slice(0, last + 1)
    .map((point) => {
      const xy = toFlowXY(point);
      return `${round(xy.x)},${round(xy.y)}`;
    })
    .join(' ');
}

/** 单个采样点的画布坐标（回放游标画在这里）。 */
export function trackPointXY(point: VehicleTrackPoint): { x: number; y: number } {
  return toFlowXY(point);
}

/** 回放进度 `0–1` → 采样点下标（四舍五入，落在 0 与 `length-1` 之间）。 */
export function scrubIndex(count: number, fraction: number): number {
  if (count <= 0) {
    return -1;
  }
  if (!Number.isFinite(fraction)) {
    return 0;
  }
  return clampIndex(count, Math.round(fraction * (count - 1)));
}

/** 下标取整并夹到 `0..count-1`；`count <= 0` 时返回 -1（调用方据此判断「没有点」）。 */
export function clampIndex(count: number, index: number): number {
  if (count <= 0) {
    return -1;
  }
  if (!Number.isFinite(index)) {
    return 0;
  }
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

/** 时间跨度 → 「1 分 20 秒」这样的可读文案（列表里不出现 `80000ms`）。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '0 秒';
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds} 秒`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours === 0) {
    return `${minutes} 分 ${seconds} 秒`;
  }
  return `${hours} 小时 ${minutes % 60} 分`;
}

/**
 * 速度 → km/h 文案。
 *
 * 契约里 `speedMps` 是米/秒（与车辆参数、调度代价同一口径），
 * 而人读速度的习惯是 km/h —— 换算只发生在展示层，不写回任何数据。
 */
export function formatSpeedKph(mps: number): string {
  if (!Number.isFinite(mps)) {
    return '—';
  }
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

/** 保留一位小数：SVG 的 `points` 里堆 15 位浮点数会让属性体积翻倍且毫无意义。 */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}
