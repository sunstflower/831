/**
 * 图层定义、分组与渲染顺序（自下而上）。
 *
 * 顺序**固定**，且路线高亮边必须排在基础路网边之后 —— 实测证实：
 * 同源同目标的两条边路径完全重合，React Flow 按数组顺序绘制，**后者在上**。
 * 因此靠「排在后面」压住基础边，不要指望自动错线。
 *
 * 本文件同时承载**展示元数据**（分组 / 图标名 / 配色 tone / 提示语），
 * 让图层面板与详情面板从同一份定义渲染 —— 避免「面板里列了 6 项、代码里支持 7 项」这类漂移。
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

/** 图层面板的三个可折叠分组（车辆层单列，见下）。 */
export const LAYER_GROUPS = [
  { key: 'network', label: '路网' },
  { key: 'dispatch', label: '配送' },
  { key: 'facility', label: '设施' }
] as const;

export type LayerGroupKey = (typeof LAYER_GROUPS)[number]['key'];

export interface LayerMeta {
  key: LayerKey;
  label: string;
  /** 用户是否可关闭；车辆层必须始终可见，否则「地图上看不到车」等于失效。 */
  toggleable: boolean;
  group: LayerGroupKey;
  /** 图例色块的配色键：对应 `map.css` 的 `.udm-swatch--<tone>`，颜色只在 CSS 里定义一次。 */
  tone: 'net' | 'route' | 'site' | 'task' | 'order' | 'vehicle';
  /** 一句话说明这一层是什么，供图层面板与详情面板展示（不用图标猜）。 */
  hint: string;
}

export const LAYERS: LayerMeta[] = [
  {
    key: 'netEdges',
    label: '路网边',
    toggleable: true,
    group: 'network',
    tone: 'net',
    hint: '可行驶路段（含方向）；禁行边为灰色虚线，拥堵慢行边为橙色点线'
  },
  {
    key: 'netNodes',
    label: '路网节点',
    toggleable: true,
    group: 'network',
    tone: 'net',
    hint: '路口/停靠点，路线由这些节点串联而成'
  },
  {
    key: 'sites',
    label: '站点',
    toggleable: true,
    group: 'facility',
    tone: 'site',
    hint: '仓库 / 月台 / 充电桩 / 道口'
  },
  {
    key: 'routeEdges',
    label: '配送路线',
    toggleable: true,
    group: 'dispatch',
    tone: 'route',
    hint: '当前生效的路线，带行进方向箭头'
  },
  {
    key: 'taskEndpoints',
    label: '任务起终点',
    toggleable: true,
    group: 'dispatch',
    tone: 'task',
    hint: '任务的取货点与送货点'
  },
  {
    key: 'orderEndpoints',
    label: '订单起终点',
    toggleable: true,
    group: 'dispatch',
    tone: 'order',
    hint: '导入订单解析出的点位（未匹配地区的订单不上图）'
  },
  {
    key: 'vehicles',
    label: '车辆',
    toggleable: false,
    group: 'dispatch',
    tone: 'vehicle',
    hint: '车辆实时位置与运行状态（常显）'
  }
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

/** 取某一分组的图层键（分组开关与面板渲染共用）。 */
export function layersOfGroup(group: LayerGroupKey): LayerMeta[] {
  return LAYERS.filter((layer) => layer.group === group);
}

/**
 * 图层预设：把常见的看视图组合变成一键操作。
 *
 * 为什么需要：7 个开关有 2^6 种组合，但实际只有三种意图 ——
 * 「看全貌」「只关心配送执行」「只核对路网」。让用户逐个点开关去凑，
 * 是把组合成本推给了使用者。
 */
export const LAYER_PRESETS: Array<{ key: string; label: string; visibility: Record<LayerKey, boolean> }> = [
  {
    key: 'all',
    label: '全部',
    visibility: { ...DEFAULT_VISIBILITY }
  },
  {
    key: 'dispatch',
    label: '只看配送',
    // 保留站点作为参照物，关掉纯路网几何
    visibility: {
      netEdges: false,
      netNodes: false,
      sites: true,
      routeEdges: true,
      taskEndpoints: true,
      orderEndpoints: true,
      vehicles: true
    }
  },
  {
    key: 'network',
    label: '只看路网',
    visibility: {
      netEdges: true,
      netNodes: true,
      sites: true,
      routeEdges: false,
      taskEndpoints: false,
      orderEndpoints: false,
      vehicles: true
    }
  }
];
