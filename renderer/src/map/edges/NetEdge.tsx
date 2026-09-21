/**
 * 基础路网边：直线段（用 `straight` 而非默认贝塞尔——路网边的几何语义是直线，
 * 曲线会让路网看起来是弯的）。禁用边用虚线。
 */
import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';
import type { NetEdgeData } from '../nodes/types';

export function NetEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, data }: EdgeProps) {
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
