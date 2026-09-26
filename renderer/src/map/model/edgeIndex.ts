/**
 * 路网边长索引：`"<fromId>-><toId>"` → 米。
 *
 * 为什么单独一个模块：地图的**两处**都要按「相邻节点对」查边长 ——
 * 边组件（画分段距离）与详情面板（算路线总长）。
 * 各写一份就会各自决定「取不到时怎么办」（一个显示 0、一个显示空），
 * 于是同一条路线在两处显示不同的总长。这里只提供一种口径。
 *
 * 边长取自 `overview.edges` 的 `lengthM`（业务属性，可含绕行/单行线），
 * **不是**用两端坐标算欧氏距离 —— 坐标是平面展示坐标，两者不是一回事。
 * 索引里没有的键返回 `null`，**不猜**。
 */
import type { MapOverview } from '../../api/types';

export type EdgeLengthIndex = Map<string, number>;

export function buildEdgeLengthIndex(overview: MapOverview): EdgeLengthIndex {
  const index: EdgeLengthIndex = new Map();
  for (const edge of overview.edges) {
    if (Number.isFinite(edge.lengthM)) {
      index.set(`${edge.fromNodeId}->${edge.toNodeId}`, edge.lengthM as number);
    }
  }
  return index;
}

/** 单段边长；缺失返回 `null`。 */
export function segmentLength(index: EdgeLengthIndex, from: string, to: string): number | null {
  return index.get(`${from}->${to}`) ?? null;
}

/**
 * 一条路线的总长（米）与**可计算段数**。
 *
 * `knownSegments < segments` 时说明有段缺边长（数据不完整）——
 * 调用方必须把这个事实显示出来，而不是把总长当成完整值。
 */
export function routeLength(
  index: EdgeLengthIndex,
  nodeIds: string[]
): { totalM: number; knownSegments: number; segments: number } {
  let totalM = 0;
  let knownSegments = 0;
  const segments = Math.max(0, nodeIds.length - 1);
  for (let i = 0; i < segments; i += 1) {
    const value = segmentLength(index, nodeIds[i] as string, nodeIds[i + 1] as string);
    if (value !== null) {
      totalM += value;
      knownSegments += 1;
    }
  }
  return { totalM, knownSegments, segments };
}
