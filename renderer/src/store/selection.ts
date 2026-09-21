/**
 * 全局选中态（`design.md` §7.2 第 2 条）。
 *
 * 列表、地图、详情三方共享同一份 `selection`，点任意一处高亮其余两处。
 * 这是**页面态**：不进数据库、不进接口（`design.md` §3.3 第 2 条）。
 *
 * `flowId` 是地图层的 React Flow 节点 id（带命名空间前缀）；
 * `entityType`/`entityId` 是业务标识，供列表与详情使用。
 */
import { create } from 'zustand';
import type { ObjectType } from '@udm/shared';

export interface Selection {
  entityType: ObjectType;
  entityId: string;
  /** React Flow 节点 id（如 `veh:seed-veh-agv01`）。 */
  flowId: string;
  /** 展示用短标签。 */
  label: string;
}

interface SelectionState {
  selected: Selection | null;
  select: (selection: Selection) => void;
  clear: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selected: null,
  select: (selection) => set({ selected: selection }),
  clear: () => set({ selected: null })
}));
