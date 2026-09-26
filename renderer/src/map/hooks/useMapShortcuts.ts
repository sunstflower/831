/**
 * 画布键盘快捷键。
 *
 * 为什么需要：地图上可点选的元素有几十个，全靠鼠标在小圆点上命中，
 * 对高频使用者不友好。官方示例（如「Interaction / Keyboard」）也把
 * `Esc` 取消选中、`f` 适配视图当作基本操作。
 *
 * 实现说明：React Flow 的 `useKeyPress` 返回的是**按键是否按下的状态**，
 * 不是事件 —— 因此必须用「上一次值 → 这一次值」的跳变来触发一次性动作，
 * 否则按住键会每帧都触发。
 */
import { useEffect, useRef } from 'react';
import { useKeyPress } from '@xyflow/react';

export interface MapShortcutsOptions {
  onFitView: () => void;
  onClearSelection: () => void;
  onToggleLayers: () => void;
}

export function useMapShortcuts({ onFitView, onClearSelection, onToggleLayers }: MapShortcutsOptions): void {
  const escapePressed = useKeyPress('Escape');
  const fitPressed = useKeyPress('f');
  const layersPressed = useKeyPress('l');
  const handlersRef = useRef({ onFitView, onClearSelection, onToggleLayers });
  handlersRef.current = { onFitView, onClearSelection, onToggleLayers };

  // 跳变检测：只在「false → true」时执行一次
  const edges = [
    [escapePressed, 'escape'],
    [fitPressed, 'fit'],
    [layersPressed, 'layers']
  ] as const;
  const previousRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    for (const [pressed, key] of edges) {
      const was = previousRef.current[key] ?? false;
      if (pressed && !was) {
        if (key === 'escape') {
          handlersRef.current.onClearSelection();
        } else if (key === 'fit') {
          handlersRef.current.onFitView();
        } else {
          handlersRef.current.onToggleLayers();
        }
      }
      previousRef.current[key] = pressed;
    }
  });
}
