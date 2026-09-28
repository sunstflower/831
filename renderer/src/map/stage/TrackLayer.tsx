/**
 * 轨迹折线图层（画布坐标系里的 SVG 装饰）。
 *
 * ## 为什么用 `ViewportPortal`
 *
 * 轨迹点的坐标与节点位置处在**同一个坐标系**（业务米制经 `toFlowXY` 换算，见 `model/track.ts`）,
 * 因此它必须跟着视口一起平移缩放。`ViewportPortal` 正是官方为此提供的出口：
 * 把子元素挂进视口受变换的那一层，于是这里可以直接用**画布坐标**画折线，
 * 不需要手工算 `transform`（手算的那套在缩放/拖拽时会与 React Flow 不同步）。
 *
 * ## 为什么不用一条「边」
 *
 * 折线有几十上百段，做成边意味着几百个元素进入 React Flow 的命中/渲染管线，
 * 且它们不可选中、不该参与布局；一条 `<polyline>` 是纯粹的装饰，
 * `pointer-events: none` 让它完全不参与命中。
 */
import { ViewportPortal } from '@xyflow/react';
import type { VehicleTrackPoint } from '@udm/shared';
import { polylinePoints, trackPointXY } from '../model/track';

export interface TrackLayerProps {
  points: VehicleTrackPoint[];
  /** 回放到的采样点下标（含）；缺省画完整条。 */
  uptoIndex?: number;
  /** 是否显示游标（回放时给出「现在回看到哪」的位置标记）。 */
  showCursor?: boolean;
}

export function TrackLayer({ points, uptoIndex, showCursor = false }: TrackLayerProps) {
  if (points.length < 2) {
    // 单点画不出线：一个孤立的采样点会被误读成「这条轨迹只有一段」
    return null;
  }
  const cursorPoint = showCursor && typeof uptoIndex === 'number' ? points[uptoIndex] : undefined;
  const cursor = cursorPoint ? trackPointXY(cursorPoint) : null;

  return (
    <ViewportPortal>
      {/* 零尺寸 + `overflow: visible`：坐标系原点在画布左上，轨迹可能落在负半轴 */}
      <svg className="udm-track-layer" aria-hidden="true">
        <polyline className="udm-track-layer__line" points={polylinePoints(points, uptoIndex)} />
        {cursor ? <circle className="udm-track-layer__cursor" cx={cursor.x} cy={cursor.y} r={7} /> : null}
      </svg>
    </ViewportPortal>
  );
}
