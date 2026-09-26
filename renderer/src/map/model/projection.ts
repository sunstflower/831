/**
 * 业务坐标 ⇄ 画布坐标。
 *
 * 业务坐标是平面 `{x, y}` 米制，x 向右、**y 向上**（数学坐标系，D-05 / `design.md` §3.2）；
 * 而 React Flow / DOM 的 y 轴**向下**。因此必须翻转 y，否则整张路网会上下颠倒。
 *
 * 这里的换算纯属**展示变换**：禁止写回业务数据，也不进设置表、不进接口（D-21）。
 */

/**
 * 每米对应的画布像素数。
 *
 * 取 6 的依据（2026-09-25 实测，Electron 内截图）：
 * - seed 路网步长为 20 m → 相邻节点相距 120 px，足以容纳带文字标签的站点/车辆卡片；
 * - 早期取 3 时相邻节点只有 60 px，而「仓库」卡片本身约 96 px 宽 ——
 *   实测结果是卡片盖住相邻节点与路线，路网看起来是断的；
 * - 同时 4×3 网格总跨度变为 360×240 px，在典型窗口下无需缩到 55% 以下，
 *   画布内的文字标签（按 0.55 倍收起）能保持可见。
 *
 * 这是**纯展示比例**，改它不影响任何业务坐标与接口（D-21 / `design.md` §3.2）。
 */
export const PIXELS_PER_METER = 6;

export interface PlanePoint {
  x: number;
  y: number;
}

/** 业务米制坐标 → 画布坐标（翻转 y）。 */
export function toFlowXY(point: PlanePoint): PlanePoint {
  return { x: point.x * PIXELS_PER_METER, y: -point.y * PIXELS_PER_METER };
}

/** 画布坐标 → 业务米制坐标（仅用于提示，勿写回业务）。 */
export function fromFlowXY(point: PlanePoint): PlanePoint {
  return { x: point.x / PIXELS_PER_METER, y: -point.y / PIXELS_PER_METER };
}
