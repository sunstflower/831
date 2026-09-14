export const ROLES = ['admin', 'dispatcher', 'monitor'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const SITE_TYPES = ['depot', 'dock', 'charging', 'gate', 'other'] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const VEHICLE_TYPES = ['agv', 'carrier', 'drone', 'other'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_STATUSES = ['idle', 'reserved', 'busy', 'charging', 'offline', 'fault', 'disabled'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const EDGE_STATUSES = ['enabled', 'disabled'] as const;
export type EdgeStatus = (typeof EDGE_STATUSES)[number];

export const RESTRICTION_TYPES = ['node', 'edge'] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

export const TASK_STATUSES = ['draft', 'pending', 'assigned', 'running', 'paused', 'finished', 'cancelled', 'failed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const PRIORITY_WEIGHT: Record<TaskPriority, number> = { low: 1, normal: 2, high: 3, urgent: 4 };

export const DISPATCH_STRATEGIES = ['greedy', 'hungarian', 'genetic'] as const;
export type DispatchStrategy = (typeof DISPATCH_STRATEGIES)[number];
export const DISPATCH_STRATEGY_SELECTIONS = ['greedy', 'hungarian', 'genetic', 'all'] as const;
export type DispatchStrategySelection = (typeof DISPATCH_STRATEGY_SELECTIONS)[number];

export const PLAN_STATUSES = ['applied', 'superseded', 'cancelled'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const ROUTE_ALGORITHMS = ['aStar', 'dijkstra'] as const;
export type RouteAlgorithm = (typeof ROUTE_ALGORITHMS)[number];

export const ALERT_TYPES = ['vehicle_offline', 'task_timeout', 'task_failed', 'route_blocked', 'data_error'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_LEVELS = ['info', 'warning', 'critical'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

export const ALERT_STATUSES = ['new', 'acknowledged', 'processing', 'resolved', 'archived'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const OBJECT_TYPES = ['site', 'vehicle', 'task', 'route', 'node', 'edge', 'user', 'system', 'alert', 'settings'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export const REJECT_REASONS = [
  'VEHICLE_NOT_AVAILABLE',
  'LOAD_EXCEEDED',
  'TIMEWINDOW_CONFLICT',
  'BATTERY_INSUFFICIENT',
  'UNREACHABLE',
  'RESTRICTION_VIOLATED',
  'NO_AVAILABLE_VEHICLE'
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const AUDIT_RESULTS = ['success', 'failure'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const PERMISSIONS = [
  'user:manage',
  'base:read',
  'base:write',
  'task:read',
  'task:write',
  'dispatch:read',
  'dispatch:preview',
  'dispatch:apply',
  'route:plan',
  'map:read',
  'monitor:read',
  'execution:start',
  'execution:takeover',
  'alert:read',
  'alert:ack',
  'alert:resolve',
  'alert:archive',
  'audit:read',
  'settings:read',
  'settings:write'
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

const DISPATCHER_PERMISSIONS: Permission[] = [
  'base:read',
  'task:read',
  'task:write',
  'dispatch:read',
  'dispatch:preview',
  'dispatch:apply',
  'route:plan',
  'map:read',
  'monitor:read',
  'execution:start',
  'execution:takeover',
  'alert:read',
  'alert:ack',
  'alert:resolve',
  'alert:archive',
  'settings:read'
];

const MONITOR_PERMISSIONS: Permission[] = ['base:read', 'task:read', 'map:read', 'monitor:read', 'alert:read', 'alert:ack'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ALL_PERMISSIONS,
  dispatcher: DISPATCHER_PERMISSIONS,
  monitor: MONITOR_PERMISSIONS
};

export function permissionsOf(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
