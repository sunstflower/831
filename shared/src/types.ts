import type { AlertLevel, AlertStatus, AlertType, ObjectType, Permission, Role, RejectReason, SiteType, TaskPriority, TaskStatus, VehicleStatus } from './enums.js';

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

export interface VehicleListItem {
  id: string;
  code: string;
  name: string;
  status: VehicleStatus;
  battery: number;
  x: number;
  y: number;
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
