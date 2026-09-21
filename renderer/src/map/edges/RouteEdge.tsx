/**
 * 路线高亮边：比基础边粗，带箭头表示行进方向，带距离标签。
 *
 * 两个实测要点（`docs/module-M6-map.md` §4.4）：
 * 1. 与基础边同源同目标时路径**完全重合**，靠样式与「排在数组后面」压住基础边，不存在自动错线；
 * 2. 标签必须用 `EdgeLabelRenderer` 渲染到独立层，否则会被边的 SVG 裁剪。
 */
import { BaseEdge, EdgeLabelRenderer, getStraightPath, type EdgeProps } from '@xyflow/react';
import type { RouteEdgeData } from '../nodes/types';

export function RouteEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, data }: EdgeProps) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const typed = data as RouteEdgeData | undefined;
  const superseded = Boolean(typed?.superseded);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={superseded ? undefined : markerEnd}
        className={superseded ? 'udm-edge-route is-superseded' : 'udm-edge-route is-active'}
      />
      {superseded ? null : (
        <EdgeLabelRenderer>
          <div
            className="udm-edge-route__label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {Math.round(Math.hypot(targetX - sourceX, targetY - sourceY))}px
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
