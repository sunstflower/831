/**
 * 基础路网边：直线段（用 `straight` 而非默认贝塞尔 —— 路网边的几何语义是直线，
 * 曲线会让路网看起来是弯的）。禁行边用虚线。
 *
 * 方向：路网边是**有向**的（`fromNodeId → toNodeId`），但给 34 条底板全部画箭头会变成
 * 一团噪声。因此箭头的显示条件是「该边正被悬停或相邻节点被选中」——由 CSS 的
 * `.is-dimmed` / hover 规则控制，默认不产生视觉负担。
 */
import { memo } from 'react';
import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';
import type { NetEdgeData } from '../nodes/types';

function NetEdgeImpl({ id, sourceX, sourceY, targetX, targetY, markerEnd, data }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const typed = data as NetEdgeData | undefined;
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      className={typed?.disabled ? 'udm-edge-net is-disabled' : 'udm-edge-net'}
    />
  );
}

export const NetEdge = memo(NetEdgeImpl);
