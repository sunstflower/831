/**
 * 枚举值 → 中文展示名。
 *
 * 为什么单独一份：`design.md` §7.1 要求「状态栏展示中文状态」，而 shared 的枚举是
 * **机器值**（`idle` / `busy` / …），界面必须给出可读中文。此前节点只用 CSS class 区分
 * 状态、不显示文字 —— 结果是「颜色记得住才看得懂」，新用户完全无法解读。
 *
 * **为什么在 `domain/` 而不是某个模块目录下**：这张表被**地图节点**与**监控工作台**同时使用；
 * 原先住在 `map/model/labels.ts` 时，地图之外的模块要用它就只能「import 地图模块」
 * 或「再抄一份」，两者都不可接受（后者正是本项目反复出现的「同一事实多个作者」，见 D-34）。
 *
 * 单一职责：本文件只做「值 → 文案」映射，不含任何业务判断；
 * 枚举本身的清单仍然以 `shared/src/enums.ts` 为唯一来源（D-34），
 * 这里用 `Record<枚举联合类型, string>` 让 TS 强制「枚举新增一值就编译报错」，
 * 从而不可能出现「新增了状态但 UI 没有文案」。
 */
import {
  DISPATCH_LOG_ACTION_LABELS,
  DISPATCH_STRATEGY_LABELS,
  REJECT_REASON_LABELS
} from '@udm/shared';
import type {
  AlertLevel,
  AlertStatus,
  AlertType,
  AuditModule,
  Role,
  EdgeStatus,
  RestrictionStatus,
  RestrictionType,
  RouteAlgorithm,
  SiteType,
  TaskAction,
  TaskPriority,
  TaskStatus,
  VehicleStatus,
  VehicleType
} from '@udm/shared';
import type { SelectableEntityType } from '../store/selection';

/** 车辆 7 态（`VEHICLE_STATUSES`）。 */
export const VEHICLE_STATUS_LABEL: Record<VehicleStatus, string> = {
  idle: '空闲',
  reserved: '已预留',
  busy: '执行中',
  charging: '充电中',
  offline: '离线',
  fault: '故障',
  disabled: '已停用'
};

/**
 * 路径算法（`ROUTE_ALGORITHMS`）。
 *
 * 括号里的说明不是装饰：使用者在调度/规划里要选一个算法，而 `aStar` / `dijkstra`
 * 两个词对非算法背景的人没有区别。标出「默认」与「基线」是这一对选项的全部意义 ——
 * 前者是日常选择，后者用于交叉验证（`compare` 接口就是拿它们互相对照）。
 */
export const ROUTE_ALGORITHM_LABEL: Record<RouteAlgorithm, string> = {
  aStar: 'A*（默认，快）',
  dijkstra: 'Dijkstra（基线，可对照）'
};

/** 车辆类型（`VEHICLE_TYPES`）。 */
export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  agv: 'AGV',
  carrier: '配送车',
  drone: '无人机',
  other: '其它'
};

/**
 * 启停状态（`EDGE_STATUSES`，被 `sites` / `nodes` / `edges` 共用）。
 *
 * 文案取「启用 / 已停用」而不是「开 / 关」：这三张表上的动作是**停用**（软删，D-07），
 * 使用者要能一眼看出「这条数据还在，只是不参与调度」。
 */
export const ENABLED_STATUS_LABEL: Record<EdgeStatus, string> = {
  enabled: '启用',
  disabled: '已停用'
};

/**
 * 禁行规则的对象类型（`RESTRICTION_TYPES`）。
 *
 * 文案是「路网节点 / 有向边」（与 `OBJECT_TYPE_LABEL` 一致），不是「节点 / 边」：
 * 规则页的「类型」下拉要和地图图层、基础数据页签里看到的叫法一样，
 * 否则使用者在三处看到三个词、以为是三样东西。
 */
export const RESTRICTION_TYPE_LABEL: Record<RestrictionType, string> = {
  node: '路网节点',
  edge: '有向边'
};

/** 禁行规则状态（`RESTRICTION_STATUSES`）：`expired` 是「已失效」，不是「已删除」。 */
export const RESTRICTION_STATUS_LABEL: Record<RestrictionStatus, string> = {
  active: '生效中',
  expired: '已失效'
};

/** 任务优先级（`TASK_PRIORITIES`）。 */
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急'
};

/** 站点类型（`SITE_TYPES`）。 */
export const SITE_TYPE_LABEL: Record<SiteType, string> = {
  depot: '仓库',
  dock: '月台',
  charging: '充电桩',
  gate: '道口',
  other: '其它'
};

/** 任务状态（`TASK_STATUSES`）。 */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  draft: '草稿',
  pending: '待派',
  assigned: '已派发',
  running: '执行中',
  paused: '已暂停',
  finished: '已完成',
  cancelled: '已取消',
  failed: '执行失败'
};

/**
 * 任务状态机动作（`TASK_ACTIONS`）的中文名。
 *
 * 键是 `Record<TaskAction, string>`：状态机新增一个动作时这里会**编译报错** ——
 * 按钮文案是新增动作的最后一步，漏了它就会出现一个没有名字的按钮。
 * 动作的**副作用说明**不在这里（那是业务判断，见 `task/actions.ts`）。
 */
export const TASK_ACTION_LABEL: Record<TaskAction, string> = {
  submit: '提交',
  assign: '派发',
  start: '开始执行',
  pause: '暂停',
  resume: '继续',
  complete: '完成',
  fail: '标记失败',
  cancel: '取消任务',
  requeue: '重新入池',
  reassign: '重派',
  delete: '删除'
};

/** 告警级别（`ALERT_LEVELS`）。 */
export const ALERT_LEVEL_LABEL: Record<AlertLevel, string> = {
  info: '提示',
  warning: '警告',
  critical: '严重'
};

/**
 * 告警类型（`ALERT_TYPES`）。
 *
 * 文案取自 `design.md` §4.8 的「告警类型与触发规则」表（首期五类），不另起叫法 ——
 * 该表是这些类型的**唯一来源**，本表只是给界面一份可读名与筛选项。
 */
export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  vehicle_offline: '车辆离线',
  task_timeout: '任务超时',
  task_failed: '任务失败',
  route_blocked: '路线受阻',
  data_error: '数据异常'
};

/** 告警状态（`ALERT_STATUSES`，状态机见 `design.md` §4.8）。 */
export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  new: '待确认',
  acknowledged: '已确认',
  processing: '处理中',
  resolved: '已解决',
  archived: '已归档'
};

/**
 * 对象类型的中文名。
 *
 * 覆盖 **`SELECTABLE_ENTITY_TYPES`**（`ObjectType` + 地图特有的 `'order'`），
 * 因此 `'order'` 也在这里有文案 —— 它是画布上真实存在的图层，不能没名字。
 */
export const OBJECT_TYPE_LABEL: Record<SelectableEntityType, string> = {
  site: '站点',
  vehicle: '车辆',
  task: '任务',
  route: '路线',
  node: '路网节点',
  edge: '路网边',
  restriction: '禁行规则',
  taskTemplate: '任务模板',
  user: '用户',
  system: '系统',
  alert: '告警',
  settings: '系统设置',
  order: '订单'
};

/*
 * 调度三个词表的**再导出**（策略名 / 拒绝原因 / 日志动作）。
 *
 * 它们的第一作者是 `shared/src/constants.ts`，而不是本文件 —— 与上面那些表不同：
 * 策略名与拒绝原因同时出现在**主进程**（`explain.ts` 生成解释文案、`/api/dispatch/strategies`
 * 产出清单）与**渲染层**（下拉、日志表、调度台），必须逐字相同才可能对得上。
 * 放在 `shared` 之后，渲染层这边只是换个名字取用，不再各写一份（D-34）。
 */
export const DISPATCH_STRATEGY_LABEL = DISPATCH_STRATEGY_LABELS;
export const REJECT_REASON_LABEL = REJECT_REASON_LABELS;
export const DISPATCH_LOG_ACTION_LABEL = DISPATCH_LOG_ACTION_LABELS;

/** 取不到映射时的兜底：直接回显原值，绝不显示空白（`design.md` §7.2 第 6 条）。 */
export function labelOf<T extends string>(table: Record<T, string>, value: T | undefined): string {
  if (value === undefined) {
    return '未知';
  }
  return table[value] ?? String(value);
}

/**
 * 角色（`ROLES`）。
 *
 * 审计页每一行都要显示角色：同一件事由 `admin` 还是 `monitor` 做的，
 * 事后追责与排查的结论完全不同。
 */
export const ROLE_LABEL: Record<Role, string> = {
  admin: '系统管理员',
  dispatcher: '调度员',
  monitor: '监控员'
};

/** 审计模块（`AUDIT_MODULES`，唯一作者在 `shared/src/enums.ts`）。 */
export const AUDIT_MODULE_LABEL: Record<AuditModule, string> = {
  auth: '登录与权限',
  user: '用户',
  task: '任务',
  base: '基础数据',
  route: '路径规划',
  dispatch: '调度',
  execution: '执行',
  alert: '告警',
  settings: '系统设置'
};
