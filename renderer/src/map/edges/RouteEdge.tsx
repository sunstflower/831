/**
 * 路线高亮边：比基础边粗、带方向箭头、可选中，并在**悬停或选中时**显示分段距离。
 *
 * 三个实测要点（`docs/module-M6-map.md` §4.4 / §11.5.2）：
 * 1. 与基础边同源同目标时路径**完全重合**，靠样式与「排在数组后面」压住基础边，不存在自动错线；
 * 2. 标签必须用 `EdgeLabelRenderer` 渲染到独立层，否则会被边的 SVG 裁剪；
 * 3. `BaseEdge` 会把传入的 `className` 拼到 `<path>` **自身**，所以 CSS 不能写成 `.udm-edge-route path`。
 *
 * 为什么标签默认隐藏：seed 路线有 5 段，全部常显会盖住路网节点。
 * 官方示例（「Edges / Edge label renderer」）同样把标签作为**按需信息**而非底噪。
 */
import { memo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getStraightPath, type EdgeProps } from '@xyflow/react';
import type { RouteEdgeData } from '../nodes/types';

function RouteEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  data,
  selected,
  interactionWidth
}: EdgeProps) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const [hovered, setHovered] = useState(false);
  const typed = data as RouteEdgeData | undefined;
  const superseded = Boolean(typed?.superseded);
  const showLabel = !superseded && (hovered || Boolean(selected));

  const distance = typed?.lengthM;
  const distanceText = Number.isFinite(distance) ? `${Math.round(distance as number)} m` : '距离未知';
  const segmentText = typed ? `第 ${typed.seq + 1}/${typed.total} 段` : '';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={superseded ? undefined : markerEnd}
        interactionWidth={interactionWidth ?? 24}
        className={superseded ? 'udm-edge-route is-superseded' : 'udm-edge-route is-active'}
      />
      {/* 一个不可见的加宽热区：让 1.5px 的细线也能被稳定地悬停到 */}
      <path
        d={path}
        className="udm-edge-route__hit"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className="udm-edge-route__label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <strong>{segmentText}</strong>
            <span>{distanceText}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const RouteEdge = memo(RouteEdgeImpl);
