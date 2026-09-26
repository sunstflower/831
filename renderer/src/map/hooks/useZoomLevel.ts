/**
 * 当前视口缩放级别（供状态条显示与「低缩放时隐藏标签」这类自适应用）。
 *
 * 为什么用 React Flow 的 `onMove` 而不是自己监听 wheel：
 * 视口还会被 `fitView` / `setCenter` / 双指缩放 / `Controls` 按钮改变，
 * 自己监听 wheel 只能覆盖其中一种，缩放数字会与实际不一致。
 */
import { useCallback, useState } from 'react';
import type { Viewport } from '@xyflow/react';

export interface ZoomState {
  zoom: number;
  onViewportChange: (viewport: Viewport) => void;
  /** 低于该缩放时，画布上的文字标签应当收起（否则会糊成一团）。 */
  isCompact: boolean;
}

/** 标签收起阈值：低于 0.55 时 10px 文字已经不可读，不如让位给图形。 */
export const COMPACT_ZOOM = 0.55;

export function useZoomLevel(initial = 1): ZoomState {
  const [zoom, setZoom] = useState(initial);

  const onViewportChange = useCallback((viewport: Viewport) => {
    // 只在「显示出来的百分比」真的变化时 setState，避免每帧都触发重渲染
    setZoom((previous) => (Math.round(previous * 100) === Math.round(viewport.zoom * 100) ? previous : viewport.zoom));
  }, []);

  return { zoom, onViewportChange, isCompact: zoom < COMPACT_ZOOM };
}
