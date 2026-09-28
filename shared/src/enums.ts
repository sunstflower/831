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

/**
 * 启停状态：`sites` / `nodes` / `edges` **三张表共用**同一组取值（DDL 见 `docs/database.md`）。
 * 类型名保留了 `Edge` 前缀（既有引用与文档已在用），语义是「这个对象能不能被使用」。
 */
export const EDGE_STATUSES = ['enabled', 'disabled'] as const;
export type EdgeStatus = (typeof EDGE_STATUSES)[number];

export const RESTRICTION_TYPES = ['node', 'edge'] as const;
export type RestrictionType = (typeof RESTRICTION_TYPES)[number];

/**
 * 禁行规则状态（`restrictions.status` 的 CHECK 取值）。
 *
 * `active` = 规则生效中；`expired` = 已失效。
 *
 * **它目前不是自动流转的**：`active → expired` 正常应由「时间窗是否已过」驱动
 * （`docs/database.md` §6 的生效查询就是按 `start_at`/`end_at` 与 `:now` 比较算出来的），
 * 而那个评估器属调度/路径模块（M4/M5），尚未落地。因此本字段当前：
 *   - 建规则时一律写 `active`；
 *   - 允许通过更新接口手工改成 `expired`（停用一条规则），但是**显式动作**、会留审计；
 *   - 列表按它筛选时，读的是**存储值**，不是「按当前时刻算出来的值」。
 * 这个区别必须写在类型旁边：否则会有人以为「过期了状态自动变」，
 * 于是看到一条 `active` 的历史规则以为功能坏了。
 */
export const RESTRICTION_STATUSES = ['active', 'expired'] as const;
export type RestrictionStatus = (typeof RESTRICTION_STATUSES)[number];

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

/**
 * 调度日志的动作（`dispatch_logs.action`，`docs/api.md` §3.4.6）。
 *
 * 与 `DISPATCH_STRATEGY_SELECTIONS` 分开：动作是「做了什么」，策略是「用什么算的」。
 * 合成一个枚举会让「手动指派没有策略」这件事无法表达 —— 而手动指派恰好是
 * 唯一一个既不选策略、又必须给原因的写动作。
 *
 * 与 `dispatch_logs.action` 的 CHECK 约束是同一个事实的两个作者，
 * 由 `desktop/src/db/db.test.ts` 的探针断言强制对齐（同 `OBJECT_TYPES`）。
 */
export const DISPATCH_LOG_ACTIONS = ['preview', 'apply', 'recompute', 'manual_assign'] as const;
export type DispatchLogAction = (typeof DISPATCH_LOG_ACTIONS)[number];

export const ROUTE_ALGORITHMS = ['aStar', 'dijkstra'] as const;
export type RouteAlgorithm = (typeof ROUTE_ALGORITHMS)[number];

export const ALERT_TYPES = ['vehicle_offline', 'task_timeout', 'task_failed', 'route_blocked', 'data_error'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_LEVELS = ['info', 'warning', 'critical'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

export const ALERT_STATUSES = ['new', 'acknowledged', 'processing', 'resolved', 'archived'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/**
 * 审计 / 告警可指向的对象类型（`audit_logs.object_type`、`alerts.object_type`）。
 *
 * **这条清单是 DB `CHECK` 约束的唯一作者**（`docs/database.md` §6 规则 4）：
 * 在 `alerts` 表上是逐字抄写的 SQL 字面量，因此新增取值**必须同时**：
 *   1. 改这里；2. 加一个迁移重建 `alerts` 的 CHECK（见 `desktop/migrations/0003_object_types.sql` 的先例）；3. 补 `OBJECT_TYPE_LABEL` 文案。
 * 三步缺任一步的表现都不同，且都**不报错**：漏 (1) 是编译错（映射表缺键），
 * 漏 (2) 是**运行时**才炸（往 `alerts` 写 restriction 时被 SQLite 拒成 `SYS.INTERNAL`），
 * 漏 (3) 是界面显示机器值。`desktop/src/db/db.test.ts` 有一条断言把 (1)(2) 钉在一起。
 *
 * `restriction` / `taskTemplate` 于 2026-09-26 加入（原 `ISS-039` / M2 §11 Q1）：
 * M2 的禁行规则与任务模板要写审计，而审计的 `objectType` 受本类型约束。
 * 命名沿用既有的 camelCase 风格（`taskTemplate`，不是 `task_template`）。
 */
export const OBJECT_TYPES = [
  'site',
  'vehicle',
  'task',
  'route',
  'node',
  'edge',
  'restriction',
  'taskTemplate',
  'user',
  'system',
  'alert',
  'settings'
] as const;
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

/**
 * 审计的**模块**取值（`audit_logs.module` 与 `GET /api/audit/logs?module=`）。
 *
 * 为什么要有这份清单而不是让使用者自由输入：模块名是**过滤维度**，
 * 而过滤器的选项必须与实际会写入的值完全一致 —— 少一个值就筛不到那批记录，
 * 而使用者会得出「这个模块没有操作记录」的错误结论（M2 的 `?status=foo` 是同一判据）。
 *
 * 与代码的关系：`desktop/src/**` 里 `writeAudit({ module })` 的取值必须落在这张表内。
 * 新增模块时先改这里，再改审计页的筛选项 —— 它是这个事实的唯一作者（D-34）。
 */
export const AUDIT_MODULES = [
  'auth',
  'user',
  'task',
  'base',
  'route',
  'dispatch',
  'execution',
  'alert',
  'settings'
] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];
