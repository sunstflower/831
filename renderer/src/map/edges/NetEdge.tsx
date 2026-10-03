/**
 * 基础路网边：直线段（用 `straight` 而非默认贝塞尔 —— 路网边的几何语义是直线，
 * 曲线会让路网看起来是弯的）。禁行边用虚线，慢边（`weight > 1`）用橙色点线。
 *
 * 方向：路网边是**有向**的（`fromNodeId → toNodeId`），但给 34 条底板全部画箭头会变成
 * 一团噪声。因此箭头的显示条件是「该边正被悬停或相邻节点被选中」——由 CSS 的
 * `.is-dimmed` / hover 规则控制，默认不产生视觉负担。
 *
 * ## 为什么视觉标志类在这里拼、而不是只写进 `edges[].className`
 *
 * React Flow 把边的 `className` 拼到**外层 `<g>`**（`react-flow__edge …`），
 * 而 CSS 选择的是 `<path>`（`react-flow__edge-path.udm-edge-net.is-slow`）。
 * 两边各写一份判断就会漂移 —— **实测正是如此**：`is-muted` / `is-slow` 长期只落在
 * `<g>` 上，CSS 里那两条规则一条都没生效，橙色「慢边」在画布上从未出现过，
 * 而页面、控制台与单测全绿（单测断的是模型里的 `className`，不是渲染出的 path）。
 *
 * 所以模型层的 `className` 只留 `is-dimmed`（CSS 确实作用在 `<g>` 上），
 * 真正作用于 `<path>` 的三个标志由这里从 `data` 派生。新增一个 CSS 标志类时，
 * 必须同时改这里与 `NetEdge.test.tsx` 的「类名落在 path 上」断言。
 */
import { memo } from 'react';
import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';
import type { NetEdgeData } from '../nodes/types';

function NetEdgeImpl({ id, sourceX, sourceY, targetX, targetY, markerEnd, data }: EdgeProps) {
  const [path] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const typed = data as NetEdgeData | undefined;
  const className = [
    'udm-edge-net',
    typed?.disabled ? 'is-disabled' : '',
    typed?.muted ? 'is-muted' : '',
    (typed?.weight ?? 1) > 1 ? 'is-slow' : ''
  ]
    .filter(Boolean)
    .join(' ');
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} className={className} />;
}

export const NetEdge = memo(NetEdgeImpl);
