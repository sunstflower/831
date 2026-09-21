/**
 * 图层定义与渲染顺序（自下而上）。
 *
 * 顺序**固定**，且路线高亮边必须排在基础路网边之后 —— 实测证实：
 * 同源同目标的两条边路径完全重合，React Flow 按数组顺序绘制，**后者在上**。
 * 因此靠「排在后面」压住基础边，不要指望自动错线。
 */
export const LAYER_KEYS = [
  'netEdges',
  'routeEdges',
  'netNodes',
  'sites',
  'taskEndpoints',
  'orderEndpoints',
  'vehicles'
] as const;

export type LayerKey = (typeof LAYER_KEYS)[number];

export interface LayerMeta {
  key: LayerKey;
  label: string;
  /** 用户是否可关闭；车辆层必须始终可见，否则「地图上看不到车」等于失效。 */
  toggleable: boolean;
}

export const LAYERS: LayerMeta[] = [
  { key: 'netEdges', label: '路网边', toggleable: true },
  { key: 'routeEdges', label: '配送路线', toggleable: true },
  { key: 'netNodes', label: '路网节点', toggleable: true },
  { key: 'sites', label: '站点', toggleable: true },
  { key: 'taskEndpoints', label: '任务起终点', toggleable: true },
  { key: 'orderEndpoints', label: '订单起终点', toggleable: true },
  { key: 'vehicles', label: '车辆', toggleable: false }
];

export const DEFAULT_VISIBILITY: Record<LayerKey, boolean> = {
  netEdges: true,
  routeEdges: true,
  netNodes: true,
  sites: true,
  taskEndpoints: true,
  orderEndpoints: true,
  vehicles: true
};
