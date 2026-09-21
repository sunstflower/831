/**
 * 列表 / 地图 / 详情三方联动（Req-M6-2）。
 *
 * 唯一来源是全局 `selection`（对象类型 + ID，见 `design.md` §7.2）。
 * 地图只**读写选中态**，不改任何业务状态。
 *
 * 注意：联动定位必须在 `useEffect` 里做，不能在渲染期调用 `setCenter`，
 * 否则会触发 React Flow 的重复渲染循环。
 */
import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useSelectionStore } from '../../store/selection';

export function useSelectionSync(): void {
  const selected = useSelectionStore((state) => state.selected);
  const { setCenter, getNode } = useReactFlow();

  useEffect(() => {
    if (!selected) {
      return;
    }
    const node = getNode(selected.flowId);
    if (!node) {
      return;
    }
    const width = node.measured?.width ?? 24;
    const height = node.measured?.height ?? 24;
    void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: 1.4,
      duration: 400
    });
  }, [selected, setCenter, getNode]);
}
