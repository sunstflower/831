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

/**
 * 画布/列表可选择的实体类型。
 *
 * = 全局 `ObjectType` **+ 地图特有的 `'order'`**。
 *
 * 为什么需要这个联合类型：地图上有「订单起终点」节点（`MapSnapshotOrderEndpoint`），
 * 选中它时 `entityType` 只能是 `'order'` —— 但 `OBJECT_TYPES`（`shared/src/enums.ts`）
 * 里**没有** `'order'`。此前靠类型断言把它塞进 `ObjectType`，
 * 等于用 `as` 掩盖了「枚举缺一项」这个事实。
 *
 * 正确处理是二选一，都属**契约变更**，需评审后再动：
 * - 把 `'order'` 加进 `OBJECT_TYPES`（并同步 `alerts.object_type` 的 CHECK 约束与 `docs/api.md`）；
 * - 或不把订单作为可选中实体（去掉订单端点图层）。
 *
 * 在评审前，这里如实表达「它可能超出全局枚举」，而**不修改** `shared` 与数据库 ——
 * 见 `docs/issues.md` 的 ISS-039（已并入 OBJECT_TYPES 扩枚举的评审批次）。
 */
export type SelectableEntityType = ObjectType | 'order';

export interface Selection {
  entityType: SelectableEntityType;
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
