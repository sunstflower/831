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
import type { AlertLevel, AlertStatus, AlertType, SiteType, TaskStatus, VehicleStatus } from '@udm/shared';
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
  user: '用户',
  system: '系统',
  alert: '告警',
  settings: '系统设置',
  order: '订单'
};

/** 取不到映射时的兜底：直接回显原值，绝不显示空白（`design.md` §7.2 第 6 条）。 */
export function labelOf<T extends string>(table: Record<T, string>, value: T | undefined): string {
  if (value === undefined) {
    return '未知';
  }
  return table[value] ?? String(value);
}
