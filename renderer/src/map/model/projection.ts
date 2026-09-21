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
 * seed 路网步长为 20 m，取 3 px/m 时相邻节点相距 60 px，足以容纳 24–28 px 的节点标记
 * 且不互相压盖；再配合 `fitView` 适配视口。
 */
export const PIXELS_PER_METER = 3;

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
