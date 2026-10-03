/**
 * 节点/边 `data` 的形状（与 `model/toFlow.ts` 的产出**必须**一一对应）。
 *
 * 约定：
 * - `entityType` / `entityId` 是**业务标识**，用于联动与详情；`code`/`name` 只用于展示；
 * - `data` 里只放「已经算好的展示事实」（如 `lowBattery`），不让组件自己再推导一遍 ——
 *   否则同一个判断会在节点组件与详情面板里各写一次，两边迟早不一致。
 */
import type { SiteType, TaskStatus, VehicleStatus } from '@udm/shared';
import type { MapAlert } from '../../api/types';
import type { SelectableEntityType } from '../../store/selection';

export interface EntityRef {
  entityType: SelectableEntityType;
  entityId: string;
}

export interface MapNodeData extends Record<string, unknown> {
  entityType: SelectableEntityType;
  entityId: string;
  code?: string;
  name?: string;
  status?: string;
  alerts?: MapAlert[];
}

export interface SiteNodeData extends MapNodeData {
  siteType: SiteType;
  /** 站点挂靠的路网节点编码（可能没有绑定）。 */
  nodeCode?: string;
  alerts?: MapAlert[];
}

export interface VehicleNodeData extends MapNodeData {
  status: VehicleStatus;
  battery: number;
  taskId: string | null;
  /** 低电标记（阈值见 `model/metrics.ts`），由 `toFlow` 统一判定。 */
  lowBattery: boolean;
  alerts?: MapAlert[];
}

export interface TaskEndpointData extends MapNodeData {
  role: 'from' | 'to';
  status: TaskStatus;
  progress: number;
  vehicleId: string | null;
  /** 对端站点编码，用于详情面板显示「A-01 → B-01」。 */
  peerCode?: string;
}

export interface OrderEndpointData extends MapNodeData {
  role: 'from' | 'to';
  confidence: number | null;
  matchType: string | null;
  pathStatus: 'ok' | 'route_unavailable';
}

export interface NetEdgeData extends Record<string, unknown> {
  lengthM: number | null;
  speedLimitMps: number | null;
  disabled: boolean;
  /** 通行耗时（s）；缺少长度或限速时为 null。 */
  travelSeconds: number | null;
  /** 通行权重（≥ 1）：> 1 即「慢边」，画布上用橙色点线标出。 */
  weight: number;
  /**
   * 有生效路线且路线图层可见时为 true：路网底板要变细变淡。
   *
   * 为什么这个布尔要进 `data` 而不是只留在边的 `className` 上：
   * React Flow 把边的 `className` 拼到**外层 `<g>`**，而样式要作用在 `<path>` 上
   * （`NetEdge.tsx` 的 `BaseEdge` 才是 path 的作者）。两处各写一份判断迟早会漂移 ——
   * 实测就是这么坏掉的：`is-muted` / `is-slow` 从来只落到 `<g>`，
   * CSS 里的 `.react-flow__edge-path.…` 规则一条都没生效，且页面不报任何错。
   */
  muted: boolean;
  /** 「可通行 / 禁行」的展示文案。 */
  kind: string;
  fromCode: string;
  toCode: string;
}

export interface RouteEdgeData extends Record<string, unknown> {
  routeId: string;
  taskId: string | null;
  vehicleId: string | null;
  superseded: boolean;
  /** 第几段（0 基）与总段数，用于「3/5 段」提示。 */
  seq: number;
  total: number;
  /** 该段路网边长（米）；取不到为 null。 */
  lengthM: number | null;
}
