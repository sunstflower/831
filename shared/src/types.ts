import type { AlertLevel, AlertStatus, AlertType, ObjectType, Permission, Role, RejectReason, TaskPriority, TaskStatus, VehicleStatus } from './enums.js';

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

export type DomainEventHandler<T = unknown> = (payload: T) => void;

export interface DomainEvent<T = unknown> {
  type: string;
  payload: T;
  eventSeq: number;
}
