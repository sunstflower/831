import type {
  AlertLevel,
  AuditResult,
  AlertStatus,
  AlertType,
  DispatchLogAction,
  DispatchStrategy,
  DispatchStrategySelection,
  EdgeStatus,
  ObjectType,
  Permission,
  RejectReason,
  RestrictionStatus,
  RestrictionType,
  Role,
  SiteType,
  TaskPriority,
  TaskStatus,
  VehicleStatus,
  VehicleType
} from './enums.js';

export type ErrorSource = 'validation' | 'auth' | 'business' | 'system';

export interface ApiSuccess<T> {
  code: 0;
  message: 'success';
  data: T;
}

export interface ApiFailure {
  code: string;
  message: string;
  source: ErrorSource;
  detail?: Record<string, unknown>;
  traceId?: string;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export interface PageRequest {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export interface PageResult<T> {
  records: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SessionUser {
  id: string;
  username: string;
  role: Role;
  displayName: string;
  permissions: Permission[];
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: SessionUser;
}

export interface HealthResult {
  status: 'ok';
  db: boolean;
  version: string;
  now: string;
}

export type SettingValueType = 'string' | 'number' | 'boolean' | 'select' | 'json';

export interface SettingSchemaItem {
  key: string;
  type: SettingValueType;
  label: string;
  defaultValue: string | number | boolean;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
  remark?: string;
}

export interface UserListItem {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditContext {
  actorId: string;
  actorName: string;
  role: Role;
  traceId: string;
}

export interface ActionNote {
  reason?: string;
  note?: string;
}

export interface CostDetail {
  deadheadTimeS: number;
  executeTimeS: number;
  waitTimeS: number;
  penaltyLateS: number;
  chargeRisk: number;
}

export interface PlanRouteSummary {
  fromNodeId: string;
  toNodeId: string;
  nodeIds: string[];
  distanceM: number;
  durationS: number;
}

export interface PlanPreview {
  taskId: string;
  vehicleId: string;
  vehicleCode: string;
  route: PlanRouteSummary | null;
  cost: number;
  costDetail: CostDetail;
  occupiedFrom: string;
  occupiedTo: string;
}

export interface RejectItem {
  taskId: string;
  reason: RejectReason;
  message: string;
  detail: Record<string, unknown>;
}

export interface StrategySummary {
  totalTasks: number;
  assigned: number;
  rejectedCount: number;
  totalCost: number;
  elapsedMs: number;
}

export interface StrategyResult {
  strategy: string;
  plans: PlanPreview[];
  rejected: RejectItem[];
  summary: StrategySummary;
  explain: string[];
}

export interface PreviewResult {
  requestId: string;
  strategies: StrategyResult[];
}

/** 调度策略清单项（`GET /api/dispatch/strategies`，`docs/api.md` §3.4.1）。 */
export interface DispatchStrategyInfo {
  key: DispatchStrategy;
  label: string;
  description: string;
  /** P4 只有 `greedy` / `hungarian` 可用；`genetic` 是二期预留，界面据此刻画禁用态。 */
  enabled: boolean;
}

/**
 * 一次成功派发的落地结果（`docs/api.md` §3.4.3 / §3.4.4）。
 *
 * `routeId` 是**真的写进 `routes` 表的那一行**的 id，而不是预览里的路线对象：
 * 界面点完「应用派发」后要能跳到任务详情、看到那条路线，靠的就是这个 id。
 */
export interface AppliedPlan {
  planId: string;
  taskId: string;
  taskCode: string;
  vehicleId: string;
  vehicleCode: string;
  routeId: string;
  cost: number;
  occupiedFrom: string;
  occupiedTo: string;
}

export interface ApplyResult {
  requestId: string;
  strategy: DispatchStrategy;
  appliedPlans: AppliedPlan[];
  summary: StrategySummary;
}

/**
 * 调度日志项（`GET /api/dispatch/logs`，`docs/api.md` §3.4.6）。
 *
 * `inputSnapshot` / `outputSnapshot` **不在这里**：它们可能有几十 KB，
 * 列表接口带上它们会让一页日志变成几 MB 的响应。详情接口（将来）再给。
 */
export interface DispatchLogListItem {
  id: string;
  requestId: string;
  action: DispatchLogAction;
  strategy: DispatchStrategySelection;
  taskIds: string[];
  /** 结构化小结：与预览回执里的 `summary` 同形状（同一份数据，不是另一个口径）。 */
  summary: StrategySummary;
  rejected: RejectItem[];
  /** 手动指派 / 重算必填的原因；预览与应用为 `null`。 */
  reason: string | null;
  elapsedMs: number;
  operatorName: string | null;
  createdAt: string;
}

/**
 * 路线规划结果（M5，`docs/api.md` §3.5.1）。**不落库** —— 落库只发生在调度 apply。
 *
 * 与 `TaskDetail['route']`（`PlanRouteSummary` 那个形状）是**两个用途**：
 * 那个是「任务详情里一句话说清这条线」的摘要，这个是「规划接口的完整回执」，
 * 多了 `edgeIds`（前端画线要用真实边）与 `warnings`（为什么这条线不理想）。
 * 合并成一个类型会让任务详情的读取路径被迫去 join 边表。
 */
export interface RoutePlan {
  fromNodeId: string;
  toNodeId: string;
  viaNodeIds: string[];
  nodeIds: string[];
  edgeIds: string[];
  distanceM: number;
  durationS: number;
  algorithm: string;
  /**
   * 目前只有通行时间一项；留成对象是为了 future 的能耗/费用项不破坏既有字段。
   *
   * `travelS` **可选**，这是数据的事实而不是将就：`POST /api/routes/plan` 的响应总会带上它，
   * 但**落库**的路线不一定有 —— `routes.cost_detail` 列的默认值是 `'{}'`，
   * seed 的演示路线正是这种情况（`desktop/src/db/seed.ts` 没写这一列）。
   * 把它写成必填，读取层就只能替它编一个值（或把 `{}` 硬断言成有值的形状），
   * 两种做法都会让类型掩盖「这行数据没有成本明细」这个真实差别（D-25 的同一条思路）。
   */
  costDetail: { travelS?: number };
  /** 面向使用者的提示（慢速段 / 绕行），**已翻译成中文**，直接展示。 */
  warnings: string[];
}

export interface RoutePlanResponse {
  route: RoutePlan;
}

export interface RouteCompareItem {
  algorithm: string;
  route: RoutePlan;
  elapsedMs: number;
}

/**
 * 算法对比结果（`docs/api.md` §3.5.2）。
 *
 * `consistent` 不是「两次结果一样」的装饰：A* 的启发式若不可采纳（高估剩余时间），
 * 它就会给出比 Dijkstra 更长的路线 —— 那是**实现缺陷**而不是策略差异。
 * 把这条性质做成返回值，界面就能把它显示成告警，而不是让人肉眼比对两条路线。
 */
export interface RouteCompareResponse {
  results: RouteCompareItem[];
  consistent: boolean;
  difference: { distanceM: number; durationS: number };
}

/** `GET /api/routes/{id}`：已落库的路线（含 `edgeIds` 与 `warnings` 全字段）。 */
export interface RouteDetail extends RoutePlan {
  id: string;
  taskId: string | null;
  createdAt: string;
  createdBy: string | null;
}

export interface AlertDTO {
  id: string;
  type: AlertType;
  level: AlertLevel;
  objectType: ObjectType;
  objectId: string | null;
  message: string;
  status: AlertStatus;
  createdAt: string;
}

export interface TaskListItem {
  id: string;
  code: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  cargoKg: number;
  fromSiteId: string;
  toSiteId: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  assignedVehicleId: string | null;
  progress: number;
  createdAt: string;
}

/**
 * 车辆列表项（`GET /api/vehicles`，`docs/api.md` §3.2.2）。
 *
 * 为什么把运行态字段（`status` / `loadKg` / `battery` / 坐标）也放进**基础数据**的返回里：
 * 它们在同一张表上，而「车辆停用（`disabled`）」这个管理动作必须能看到车辆当前是否被占用
 * （`reserved` / `busy` 时停用会被拒，见 §3.2.2 说明）。只返回静态参数的话，
 * 使用者点「停用」只能先失败再去看别处。
 *
 * `online`（心跳标志）与 `lastHeartbeatAt` 是只读展示项，管理接口不改（见 `docs/module-M2-base-data.md` §6.1）。
 */
export interface VehicleListItem {
  id: string;
  code: string;
  name: string;
  type: VehicleType;
  status: VehicleStatus;
  capacityKg: number;
  loadKg: number;
  maxSpeedMps: number;
  battery: number;
  x: number;
  y: number;
  currentNodeId: string | null;
  online: boolean;
  lastHeartbeatAt: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 站点列表项（`GET /api/sites`，`docs/api.md` §3.2.1）。
 *
 * `nodeId` 可空是**当前**的过渡状态（D-30：站点正从「绑节点」改为「绑边 + 泊位」）
 * 因此不得把 `nodeId` 当作必填来渲染，否则过渡期的站点会显示成异常。
 */
export interface SiteListItem {
  id: string;
  code: string;
  name: string;
  type: SiteType;
  status: EdgeStatus;
  nodeId: string | null;
  x: number;
  y: number;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 禁行规则列表项（`GET /api/restrictions`，`docs/api.md` §3.2.5）。
 *
 * `targetId` 是**多态引用**：`type='node'` 时指向 `nodes.id`，`type='edge'` 时指向 `edges.id`。
 * DDL 因此**不能**给它加外键（`docs/database.md` §1 第 8 条），一致性由领域服务保证。
 *
 * `targetCode` 是**派生字段**（读取时算出来的展示值）：节点取 `nodes.code`，
 * 边取按两端节点推导的业务编码（`shared/src/edge-code.ts`）。
 * 它为 `null` 只有一种情况 —— 目标已被删除/停用而规则还在（多态引用没有外键保护，
 * 这正是本项目刻意接受的代价），此时界面必须显示「目标已不存在」而不是空白。
 */
export interface RestrictionListItem {
  id: string;
  type: RestrictionType;
  targetId: string;
  targetCode: string | null;
  startAt: string | null;
  endAt: string | null;
  vehicleType: VehicleType | null;
  reason: string;
  status: RestrictionStatus;
  createdAt: string;
  createdBy: string | null;
}

/**
 * 任务模板列表项（`GET /api/task-templates`，`docs/api.md` §3.2.6）。
 *
 * 模板是**填任务的草稿纸**：给出默认优先级、默认货重、时间窗长度与起终点站点类型，
 * 让调度员少填几项。它不参与执行，也没有状态 —— 停用一个模板目前就是删掉它
 * （契约里没有 `DELETE`，也没有 status 列），因此这里没有 `status` 字段。
 *
 * `fromSiteType` / `toSiteType` 是 `SiteType | null`：为空表示「不限站点类型」，
 * 而不是「没有这个字段」—— 这是它与 `remark` 的区别，两者都必须能表达「清空」。
 */
export interface TaskTemplateListItem {
  id: string;
  code: string;
  name: string;
  priority: TaskPriority;
  /** 默认货重（kg）；`null` 表示不预设，填任务时自己填。 */
  defaultCargoKg: number | null;
  /** 时间窗长度（分钟）；`null` 表示不预设。 */
  timeWindowMinutes: number | null;
  fromSiteType: SiteType | null;
  toSiteType: SiteType | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * 任务列表项（`GET /api/tasks`，`docs/api.md` §3.3.1）。
 *
 * 契约里带 `fromSiteName` / `toSiteName` / `vehicleCode` 三个**冗余字段**，
 * 而不是只给 id：列表是使用者读得最多的一屏，让前端自己去 join 三张表
 * （或每行再发三个请求）是把这个负担从一处挪到了一百处；
 * 而它们是**读时派生**的（`D-25`），不会因为站点改名而变成两处不一致。
 */
export interface TaskListItem {
  id: string;
  code: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  cargoKg: number;
  fromSiteId: string;
  toSiteId: string;
  fromSiteName: string | null;
  toSiteName: string | null;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  assignedVehicleId: string | null;
  vehicleCode: string | null;
  progress: number;
  createdAt: string;
  createdBy: string | null;
}

/** 任务的操作响应里的迁移信息（`docs/api.md` §3.3.7）：让界面能说出「从什么变成了什么」。 */
export interface TaskTransitionInfo {
  from: TaskStatus;
  to: TaskStatus;
}

/**
 * 任务详情（`GET /api/tasks/{id}`，`docs/api.md` §3.3.2）。
 *
 * 四个附加块**都可为空**，且都必须显式给 `null` / 空数组而不是省略键 ——
 * 「没有当前计划」与「这个字段没实现」在界面上的处理完全不同，
 * 省略键会让两者都以 `undefined` 的形态到达前端。
 */
export interface TaskDetail extends TaskListItem {
  templateId: string | null;
  cargoDesc: string | null;
  cancelReason: string | null;
  failReason: string | null;
  /** 暂停原因（`design.md` §4.3 要求 pause 写原因）；恢复执行时清空，故只有 `paused` 时才有值。 */
  pauseReason: string | null;
  submittedAt: string | null;
  assignedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  updatedAt: string;
  /** 已生效的计划摘要（`applied`）；未派发时为 `null`。 */
  currentPlan: {
    id: string;
    vehicleId: string;
    vehicleCode: string | null;
    strategy: string;
    cost: number;
    routeId: string | null;
    appliedAt: string | null;
  } | null;
  /** 当前路线摘要；没有路线时为 `null`。 */
  route: {
    id: string;
    distanceM: number;
    durationS: number;
    algorithm: string;
    nodeCount: number;
    edgeCount: number;
  } | null;
  /** 关联的**未归档**告警（归档的不再占据注意力）。 */
  alerts: Array<{ id: string; type: AlertType; level: AlertLevel; status: AlertStatus; message: string }>;
  /** 最近 5 条操作（按时间倒序）。 */
  auditSummaries: Array<{ ts: string; action: string; actorName: string | null; message: string | null }>;
}

/** 路网节点列表项（`GET /api/nodes`，`docs/api.md` §3.2.3）。 */
export interface NodeListItem {
  id: string;
  code: string;
  name: string;
  x: number;
  y: number;
  status: EdgeStatus;
  remark: string | null;
}

/**
 * 有向边列表项（`GET /api/edges`，`docs/api.md` §3.2.4）。
 *
 * `code` 是**业务键**（D-35）：由两端节点 code 推导（`E_<from>_<to>`，反向边加 `_R`），
 * 因此它随节点 code 变化而变化 —— 展示时请一并显示 `fromNodeCode` / `toNodeCode`，
 * 否则使用者看到一个「E_ 开头」的字符串无从核对它指向哪条边。
 *
 * `code` 列本身要等迁移 `0002_data_import.sql` 落地（D-35 待评审），在此之前由读取层推导。
 */
export interface EdgeListItem {
  id: string;
  code: string;
  fromNodeId: string;
  toNodeId: string;
  fromNodeCode: string;
  toNodeCode: string;
  lengthM: number;
  speedLimitMps: number | null;
  status: EdgeStatus;
  remark: string | null;
}

/**
 * 地图概览快照（`GET /api/map/overview`，契约见 `docs/api.md` §3.6.1）。
 *
 * 这是地图画布的**唯一数据入口**（D-21 / Req-M6-5）：不得由渲染层拼多次请求，
 * 否则路网与车辆可能来自不同时刻，出现「车在已禁用的边上」这类鬼影。
 *
 * 坐标一律为平面 `{ x, y }` 米制（D-05 / `design.md` §3.2），**禁止经纬度**。
 */
export interface MapSnapshotNode {
  id: string;
  code: string;
  x: number;
  y: number;
  status: 'enabled' | 'disabled';
}

export interface MapSnapshotEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  lengthM?: number;
  speedLimitMps?: number | null;
  status?: 'enabled' | 'disabled';
}

export interface MapSnapshotSite {
  id: string;
  code: string;
  name?: string;
  type: SiteType;
  nodeId: string | null;
  x: number;
  y: number;
  status: 'enabled' | 'disabled';
}

export interface MapSnapshotVehicle {
  id: string;
  code: string;
  status: VehicleStatus;
  x: number;
  y: number;
  battery: number;
  taskId: string | null;
}

export interface MapSnapshotTask {
  id: string;
  code: string;
  status: TaskStatus;
  fromSiteId: string;
  toSiteId: string;
  vehicleId: string | null;
  progress: number;
}

export interface MapSnapshotRoute {
  id: string;
  taskId: string | null;
  vehicleId: string | null;
  nodeIds: string[];
  status: 'active' | 'superseded' | 'cancelled';
}

export interface MapSnapshotAlert {
  id: string;
  type: AlertType;
  level: AlertLevel;
  status?: AlertStatus;
  objectType: ObjectType;
  objectId: string;
}

/**
 * 订单起终点（`?include=orders,orderEndpoints`）。
 * 契约来源：`docs/order-data-map-design.md` §5。**未匹配到地区的订单不上图，不伪造坐标。**
 * 订单摄入（`0002_data_import`）尚未落地，故首期该字段恒为空。
 */
export interface MapSnapshotOrderEndpoint {
  orderId: string;
  role: 'from' | 'to';
  x: number;
  y: number;
  confidence?: number;
  matchType?: string;
  pathStatus?: 'ok' | 'route_unavailable';
}

export interface MapOverview {
  nodes: MapSnapshotNode[];
  edges: MapSnapshotEdge[];
  sites: MapSnapshotSite[];
  vehicles: MapSnapshotVehicle[];
  tasks: MapSnapshotTask[];
  routes: MapSnapshotRoute[];
  alerts: MapSnapshotAlert[];
  /** 可选：仅在 `?include=orders,orderEndpoints` 时返回。 */
  orderEndpoints?: MapSnapshotOrderEndpoint[];
  /** 事件日志当前游标；渲染层据此丢弃重放/乱序的旧事件。 */
  eventSeq: number;
}

export type DomainEventHandler<T = unknown> = (payload: T) => void;

export interface DomainEvent<T = unknown> {
  type: string;
  payload: T;
  eventSeq: number;
}

/* ================================================================== *
 * M7 运行监控与执行（`docs/api.md` §3.7）
 * ================================================================== */

/** 监控概览（`GET /api/monitor/overview`）。 */
export interface MonitorOverview {
  taskCounts: {
    running: number;
    paused: number;
    pending: number;
    assigned: number;
    failed: number;
    finishedToday: number;
  };
  vehicleCounts: {
    idle: number;
    busy: number;
    reserved: number;
    charging: number;
    offline: number;
    fault: number;
  };
  alertCounts: { new: number; acknowledged: number; processing: number; unresolved: number };
  /** 事件日志水位线（单调，见 D-24）；渲染层据此丢弃重放事件。 */
  eventSeq: number;
  updatedAt: string;
}

/** 监控任务项（`GET /api/monitor/tasks`）= 任务列表项（已含 `progress`）。 */
export type MonitorTaskItem = TaskListItem;

/** 监控车辆项（`GET /api/monitor/vehicles`）：在车辆列表项上补当前任务。 */
export interface MonitorVehicleItem extends VehicleListItem {
  /** 该车此刻正在执行/暂停中的任务 id；空闲时为 `null`。 */
  currentTaskId: string | null;
}

/** 轨迹采样点（`GET /api/map/tracks/{vehicleId}`）。 */
export interface VehicleTrackPoint {
  ts: string;
  x: number;
  y: number;
  speedMps: number;
  status: string;
  taskId: string | null;
}

export interface VehicleTracks {
  vehicleId: string;
  points: VehicleTrackPoint[];
  total: number;
}

/** `POST /api/execution/tasks/{id}/start` 的成功响应。 */
export interface ExecutionStartResult {
  taskId: string;
  vehicleId: string;
  status: TaskStatus;
  startedAt: string;
}

/** `POST /api/execution/tasks/{id}/takeover` 的成功响应。 */
export interface TakeoverResult {
  taskId: string;
  alertId: string;
  nextSteps: string[];
}

/* ================================================================== *
 * M8 告警（`docs/api.md` §3.8）
 * ================================================================== */

export interface AlertListItem {
  id: string;
  type: AlertType;
  level: AlertLevel;
  objectType: ObjectType;
  objectId: string | null;
  message: string;
  status: AlertStatus;
  createdAt: string;
  ackBy: string | null;
  ackAt: string | null;
  resolveBy: string | null;
  resolveAt: string | null;
}

export interface AlertDetail extends AlertListItem {
  detail: Record<string, unknown>;
  resolution: string | null;
  dedupeKey: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  /** 关联对象摘要（按 `objectType` 取其一，取不到时为 `null`）。 */
  related: {
    task: { id: string; code: string; title: string; status: TaskStatus } | null;
    vehicle: { id: string; code: string; name: string; status: VehicleStatus } | null;
  };
  /** 建议的下一步（唯一来源 `@udm/shared` 的 `ALERT_NEXT_STEPS`）。 */
  suggestedNextSteps: string[];
}

/* ================================================================== *
 * M9 审计（`docs/api.md` §3.9）
 * ================================================================== */

export interface AuditLogItem {
  id: string;
  ts: string;
  actorName: string | null;
  role: Role | null;
  module: string;
  action: string;
  objectType: ObjectType | null;
  objectId: string | null;
  result: AuditResult;
  message: string | null;
  costMs: number;
  traceId: string | null;
}

/* ================================================================== *
 * M10 系统设置（`docs/api.md` §3.10）
 * ================================================================== */

/** `PATCH /api/settings` 的成功响应：生效值 + 本次真正改动的键。 */
export interface SettingsUpdateResult {
  values: Record<string, unknown>;
  updatedKeys: string[];
}
