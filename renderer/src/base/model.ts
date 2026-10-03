/**
 * 基础数据页（M2）的**表格模型**：列定义、页签、查询状态。
 *
 * 为什么从组件里搬出来：每一列都对应一个字段的口径（显示成什么、数字怎么格式化、
 * 枚举怎么翻译），而「字段该显示什么」是评审时要逐条看的；写在 JSX 里就只能靠肉眼读。
 * 拆出来之后它**可以完整单测**（本目录的 `model.test.ts`），组件只负责排版与交互。
 *
 * **边界**：本文件不定义数据、不发请求、不做权限判断。行数据的形状由
 * `@udm/shared` 的 DTO 决定（唯一来源），这里只决定「怎么显示」。
 */
import type {
  EdgeListItem,
  NodeListItem,
  RestrictionListItem,
  SiteListItem,
  TaskTemplateListItem,
  VehicleListItem
} from '@udm/shared';
import { column, text, type Column as TableColumn } from '../domain/table';
import { formatNumber, timeWindowText } from '../domain/format';
import {
  ENABLED_STATUS_LABEL,
  RESTRICTION_STATUS_LABEL,
  RESTRICTION_TYPE_LABEL,
  SITE_TYPE_LABEL,
  TASK_PRIORITY_LABEL,
  VEHICLE_STATUS_LABEL,
  VEHICLE_TYPE_LABEL,
  labelOf
} from '../domain/labels';

/** 本模块的列类型 = 公共列类型绑定到本模块的行联合类型。 */
export type Column = TableColumn<BaseDataRow>;

/** 六张表任意一行的联合类型（页签决定当前是哪一种）。 */
export type BaseDataRow =
  | SiteListItem
  | VehicleListItem
  | NodeListItem
  | EdgeListItem
  | RestrictionListItem
  | TaskTemplateListItem;

export type BaseDataTabKey = 'sites' | 'vehicles' | 'nodes' | 'edges' | 'restrictions' | 'templates';


export interface TabDef {
  key: BaseDataTabKey;
  label: string;
  /** 接口路径（`docs/api.md` §3.2）。 */
  path: string;
  /**
   * 搜索框。
   *
   * `field` 是**发给主进程的参数名**，不是显示名 —— 站点/车辆/节点用 `keyword`
   * （按 code + name 模糊匹配），边用 `code`（精确匹配业务键，它没有名称可搜）。
   */
  search: { field: 'keyword' | 'code'; placeholder: string; hint: string } | null;
  /** 状态筛选下拉的取值（空值 = 不筛选）。**空数组 = 该表没有状态维度，不渲染这个下拉**。 */
  statusOptions: Array<{ value: string; label: string }>;
  /**
   * 第二组筛选下拉（`type`）。
   *
   * 只有禁行规则用它：那一页的「类型」（节点 / 边）比状态更能决定使用者要找哪条规则，
   * 而两个下拉并列显示不会让人误以为它们互相冲突。缺席 = 该表没有类型维度。
   */
  typeOptions?: Array<{ value: string; label: string }>;
  columns: Column[];
  /** 表为空时的解释：说清「为什么空」，而不是只显示「暂无数据」。 */
  emptyHint: string;
  /** 是否有「停用 / 启用」行内动作。缺席视为 `true`（四类主数据都有 status 列）。 */
  statusToggle?: boolean;
  /** 是否允许**物理删除**行内动作。目前只有禁行规则（`design.md` D-07 的唯一例外）。 */
  removable?: boolean;
}

/** 坐标统一显示为「x, y」米制（D-05）：两个数字分开两列太占宽度，且它们总是一起看。 */
function point(x: number, y: number): string {
  return `${formatNumber(x)}, ${formatNumber(y)}`;
}

const SITE_COLUMNS: Column[] = [
  column<SiteListItem>('code', '编码'),
  column<SiteListItem>('name', '名称'),
  column<SiteListItem>('type', '类型', { cell: (row) => labelOf(SITE_TYPE_LABEL, row.type) }),
  column<SiteListItem>('status', '状态', { cell: (row) => labelOf(ENABLED_STATUS_LABEL, row.status) }),
  column<SiteListItem>('nodeId', '绑定节点', { cell: (row) => text(row.nodeId) }),
  column<SiteListItem>('x', '坐标 (m)', { cell: (row) => point(row.x, row.y) })
];

const VEHICLE_COLUMNS: Column[] = [
  column<VehicleListItem>('code', '编码'),
  column<VehicleListItem>('name', '名称'),
  column<VehicleListItem>('type', '类型', { cell: (row) => labelOf(VEHICLE_TYPE_LABEL, row.type) }),
  column<VehicleListItem>('status', '状态', { cell: (row) => labelOf(VEHICLE_STATUS_LABEL, row.status) }),
  column<VehicleListItem>('capacityKg', '额定载重 (kg)', { align: 'right' }),
  column<VehicleListItem>('loadKg', '当前载重 (kg)', { align: 'right' }),
  column<VehicleListItem>('maxSpeedMps', '最高速度 (m/s)', { align: 'right' }),
  column<VehicleListItem>('battery', '电量 (%)', { align: 'right' }),
  // 心跳是「车还在不在」的唯一线索，故显示成「在线 / 离线」而不是原始布尔
  column<VehicleListItem>('online', '心跳', { cell: (row) => (row.online ? '在线' : '离线') }),
  column<VehicleListItem>('currentNodeId', '所在节点', { cell: (row) => text(row.currentNodeId) })
];

const NODE_COLUMNS: Column[] = [
  column<NodeListItem>('code', '编码'),
  column<NodeListItem>('name', '名称'),
  column<NodeListItem>('status', '状态', { cell: (row) => labelOf(ENABLED_STATUS_LABEL, row.status) }),
  column<NodeListItem>('x', '坐标 (m)', { cell: (row) => point(row.x, row.y) })
];

const EDGE_COLUMNS: Column[] = [
  // code 是推导值（D-35 待落地），因此旁边必须给出两端节点 —— 否则使用者无法核对它指向哪条边
  column<EdgeListItem>('code', '业务编码'),
  column<EdgeListItem>('fromNodeCode', '起点'),
  column<EdgeListItem>('toNodeCode', '终点'),
  column<EdgeListItem>('lengthM', '长度 (m)', { align: 'right' }),
  column<EdgeListItem>('speedLimitMps', '限速 (m/s)', { align: 'right', cell: (row) => text(row.speedLimitMps) }),
  // 权重与限速相邻：两者都影响通行时间，分开放会让人以为它们是无关的两个数。
  // 1 显式写成「1×」而不是留空 —— 空格看起来像「没填」，而 1 是一个明确的取值（畅通）
  column<EdgeListItem>('weight', '通行权重', { align: 'right', cell: (row) => `${row.weight}×` }),
  column<EdgeListItem>('status', '状态', { cell: (row) => labelOf(ENABLED_STATUS_LABEL, row.status) })
];

const RESTRICTION_COLUMNS: Column[] = [
  // 类型与目标编码相邻：只看「路网节点」四个字不知道它封的是哪一处，两列必须一起读
  column<RestrictionListItem>('type', '目标类型', { cell: (row) => labelOf(RESTRICTION_TYPE_LABEL, row.type) }),
  column<RestrictionListItem>('targetCode', '目标编码', {
    // 目标被删掉后 `targetCode` 为 null（多态引用没有外键保护）：显式说明「目标已不存在」，
    // 而不是显示一个破折号 —— 后者看起来像没填，实际是这条规则已经失控了
    cell: (row) => (row.targetCode ? row.targetCode : '⚠ 目标已不存在')
  }),
  column<RestrictionListItem>('startAt', '时间窗', {
    cell: (row) => timeWindowText(row.startAt, row.endAt)
  }),
  column<RestrictionListItem>('vehicleType', '适用车辆', {
    cell: (row) => (row.vehicleType ? labelOf(VEHICLE_TYPE_LABEL, row.vehicleType) : '全部车辆')
  }),
  column<RestrictionListItem>('reason', '原因'),
  column<RestrictionListItem>('status', '状态', { cell: (row) => labelOf(RESTRICTION_STATUS_LABEL, row.status) })
];

const TEMPLATE_COLUMNS: Column[] = [
  column<TaskTemplateListItem>('code', '编码'),
  column<TaskTemplateListItem>('name', '名称'),
  column<TaskTemplateListItem>('priority', '默认优先级', { cell: (row) => labelOf(TASK_PRIORITY_LABEL, row.priority) }),
  column<TaskTemplateListItem>('defaultCargoKg', '默认载重 (kg)', { align: 'right', cell: (row) => text(row.defaultCargoKg) }),
  column<TaskTemplateListItem>('timeWindowMinutes', '时间窗 (分钟)', { align: 'right', cell: (row) => text(row.timeWindowMinutes) }),
  // 起终点类型用 `→` 连成一列：它们总是一起读（「仓库 → 充电桩」），拆两列反而要来回看
  column<TaskTemplateListItem>('fromSiteType', '起终点类型', {
    cell: (row) => `${row.fromSiteType ? labelOf(SITE_TYPE_LABEL, row.fromSiteType) : '不限'} → ${row.toSiteType ? labelOf(SITE_TYPE_LABEL, row.toSiteType) : '不限'}`
  }),
  column<TaskTemplateListItem>('remark', '备注')
];

/**
 * 六个页签。
 *
 * 顺序按「使用者找东西的习惯」：站点 → 车辆 → 路网 → 边；
 * 边放最后是因为它的数量最多（双向成对），一进来先看到它会淹没前两类。
 */
export const BASE_DATA_TABS: TabDef[] = [
  {
    key: 'sites',
    label: '站点',
    path: '/api/sites',
    search: { field: 'keyword', placeholder: '按编码或名称搜索', hint: '编码与名称都参与匹配' },
    statusOptions: [
      { value: 'enabled', label: ENABLED_STATUS_LABEL.enabled },
      { value: 'disabled', label: ENABLED_STATUS_LABEL.disabled }
    ],
    columns: SITE_COLUMNS,
    emptyHint: '还没有站点，或当前筛选条件没有匹配项。'
  },
  {
    key: 'vehicles',
    label: '车辆',
    path: '/api/vehicles',
    search: { field: 'keyword', placeholder: '按编码或名称搜索', hint: '编码与名称都参与匹配' },
    // 车辆域没有 `enabled`（ISS-036）：下拉里出现它会让使用者按一个不存在的状态筛选
    statusOptions: [
      { value: 'idle', label: VEHICLE_STATUS_LABEL.idle },
      { value: 'reserved', label: VEHICLE_STATUS_LABEL.reserved },
      { value: 'busy', label: VEHICLE_STATUS_LABEL.busy },
      { value: 'charging', label: VEHICLE_STATUS_LABEL.charging },
      { value: 'offline', label: VEHICLE_STATUS_LABEL.offline },
      { value: 'fault', label: VEHICLE_STATUS_LABEL.fault },
      { value: 'disabled', label: VEHICLE_STATUS_LABEL.disabled }
    ],
    columns: VEHICLE_COLUMNS,
    emptyHint: '还没有车辆，或当前筛选条件没有匹配项。'
  },
  {
    key: 'nodes',
    label: '路网节点',
    path: '/api/nodes',
    search: { field: 'keyword', placeholder: '按编码或名称搜索', hint: '节点是路网的基本单元，边必须连在两个节点之间' },
    statusOptions: [
      { value: 'enabled', label: ENABLED_STATUS_LABEL.enabled },
      { value: 'disabled', label: ENABLED_STATUS_LABEL.disabled }
    ],
    columns: NODE_COLUMNS,
    emptyHint: '还没有路网节点；没有节点就无法建边，也无法给车辆定位。'
  },
  {
    key: 'edges',
    label: '有向边',
    path: '/api/edges',
    search: {
      field: 'code',
      placeholder: '按业务编码精确查找，如 E_N01_N02',
      hint: '精确匹配；反向边是另一个编码（后缀 _R）'
    },
    statusOptions: [
      { value: 'enabled', label: ENABLED_STATUS_LABEL.enabled },
      { value: 'disabled', label: ENABLED_STATUS_LABEL.disabled }
    ],
    columns: EDGE_COLUMNS,
    emptyHint: '还没有边，或当前筛选条件没有匹配项。'
  },
  {
    key: 'restrictions',
    label: '禁行规则',
    path: '/api/restrictions',
    // 没有搜索框：规则的可读标识是**派生出来的目标编码**，而它分散在两张表里
    // （节点 code 与边的两端），按它模糊搜在语义上不成立（与边的「没有 keyword」同理）。
    // 找一条规则的实际方式是「按类型 + 状态缩小范围，再看目标编码这一列」。
    search: null,
    typeOptions: [
      { value: 'node', label: RESTRICTION_TYPE_LABEL.node },
      { value: 'edge', label: RESTRICTION_TYPE_LABEL.edge }
    ],
    statusOptions: [
      { value: 'active', label: RESTRICTION_STATUS_LABEL.active },
      { value: 'expired', label: RESTRICTION_STATUS_LABEL.expired }
    ],
    columns: RESTRICTION_COLUMNS,
    emptyHint: '还没有禁行规则。规则建立后，调度算法在选路时会绕开它。',
    // 没有「停用 / 启用」行内动作：失效是要说明理由的编辑动作（改 status 字段），
    // 不是一个可以随手点的按钮。删除则是**物理删除**（唯一允许的一类）
    statusToggle: false,
    removable: true
  },
  {
    key: 'templates',
    label: '任务模板',
    path: '/api/task-templates',
    search: { field: 'keyword', placeholder: '按编码或名称搜索', hint: '编码与名称都参与匹配' },
    // 模板没有状态列（契约里也没有启停接口），因此不渲染状态下拉 ——
    // 一个永远筛不出东西的下拉比没有下拉更糟
    statusOptions: [],
    columns: TEMPLATE_COLUMNS,
    emptyHint: '还没有任务模板。模板用于在创建任务时预填优先级、载重与时间窗。',
    statusToggle: false
  }
];

export function tabOf(key: BaseDataTabKey): TabDef {
  const tab = BASE_DATA_TABS.find((item) => item.key === key);
  if (!tab) {
    // 页签来自本文件的常量、key 由类型约束，因此这里不可能发生；
    // 显式抛出好过返回 undefined 后在组件里崩在更难读的地方
    throw new Error(`未登记的基础数据页签: ${key}`);
  }
  return tab;
}

/** 页面上的查询状态。 */
export interface ListQuery {
  page: number;
  pageSize: number;
  keyword: string;
  status: string;
  /** 第二组筛选（禁行规则的 `type`）；其它页签恒为空串。 */
  type: string;
}

export const EMPTY_QUERY: ListQuery = { page: 1, pageSize: 20, keyword: '', status: '', type: '' };

/** 把查询状态翻译成接口载荷：空值一律**不发**（主进程把它当「未给筛选」，见 D-40）。 */
export function buildPayload(tab: TabDef, query: ListQuery): Record<string, unknown> {
  const payload: Record<string, unknown> = { page: query.page, pageSize: query.pageSize };
  if (tab.search && query.keyword.trim()) {
    payload[tab.search.field] = query.keyword.trim();
  }
  if (query.status) {
    payload.status = query.status;
  }
  // `type` 只发给**有类型维度**的页签：切页签时 `selectTab` 会重置查询状态，
  // 但这条判断让「模型自身」也不依赖调用点是否记得重置 —— 一个不该出现的字段
  // 会被主进程的 `optionalEnumFilter` 直接报错，那是一条看不出原因的失败
  if (tab.typeOptions && query.type) {
    payload.type = query.type;
  }
  return payload;
}

