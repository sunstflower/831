import type { DispatchLogAction, DispatchStrategy, RejectReason } from './enums.js';
import type { SettingSchemaItem } from './types.js';

export const APP_NAME = '无人物流调度管理软件';
export const APP_VERSION = '0.1.0';
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const DISPATCH_COST_WEIGHTS = { deadhead: 1, execute: 1, wait: 0.8, late: 2, chargeRisk: 1000 } as const;
export const MIN_BATTERY_PERCENT = 20;

/*
 * 调度相关的**展示文案**（策略名 / 拒绝原因 / 动作名）。
 *
 * 为什么在 `shared` 而不是某一端：这三个词表有三类读者 ——
 *   1. 主进程的调度服务（`desktop/src/domain/dispatch/explain.ts` 生成解释文案、
 *      `listStrategies()` 产出策略清单）；
 *   2. 浏览器 Mock（同两个接口，浏览器里跑不了主进程代码）；
 *   3. 渲染层的下拉与表格（`renderer/src/domain/labels.ts` 再导出）。
 * 若各写一份，「匈牙利」/「载重超限」这类词就会在三个地方各有一个作者（D-34）——
 * 而它们**必须**逐字相同：策略下拉里选的那一项、日志里记的那一项、
 * 解释文案里说的那一项，使用者要能把它们对上。
 *
 * 与 §8「内核不产出文案」不冲突：内核（`dispatch-*.ts`）**不 import 本文件**，
 * 它只产出结构化原因（`RejectReason` 枚举值）；文案是给人和接口用的。
 */
export const DISPATCH_STRATEGY_LABELS: Record<DispatchStrategy, string> = {
  greedy: '贪心',
  hungarian: '匈牙利',
  genetic: '遗传'
};

/** 拒绝原因（`RejectReason`）的中文说法。界面、日志与解释文案共用同一份。 */
export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  VEHICLE_NOT_AVAILABLE: '车辆当前不可用',
  LOAD_EXCEEDED: '载重超限',
  TIMEWINDOW_CONFLICT: '时间窗冲突',
  BATTERY_INSUFFICIENT: '电量不足',
  UNREACHABLE: '路网不可达',
  RESTRICTION_VIOLATED: '禁行规则阻挡',
  NO_AVAILABLE_VEHICLE: '没有可用车辆'
};

/**
 * 调度日志动作（`DISPATCH_LOG_ACTIONS`）。
 *
 * 用「做了什么」而不是「接口名」：日志表里同时有预览与应用两类行，
 * 写「预览 / 应用 / 重算 / 手动指派」比写 `preview` / `apply` 对使用者更有意义，
 * 也让「同一 requestId 下的两行」在界面上一眼能分辨（§10.4）。
 */
export const DISPATCH_LOG_ACTION_LABELS: Record<DispatchLogAction, string> = {
  preview: '预览',
  apply: '应用派发',
  recompute: '重算',
  manual_assign: '手动指派'
};

export const SEED_ACCOUNTS = [
  { id: 'seed-admin', username: 'admin', password: 'admin123', role: 'admin', displayName: '系统管理员' },
  { id: 'seed-dispatcher', username: 'dispatcher', password: 'dispatcher123', role: 'dispatcher', displayName: '调度员' },
  { id: 'seed-monitor', username: 'monitor', password: 'monitor123', role: 'monitor', displayName: '监控员' }
] as const;

export const SEED_IDS = {
  siteDepotA: 'seed-site-a',
  siteDepotB: 'seed-site-b',
  siteCharging: 'seed-site-chg',
  vehicleAgv: 'seed-veh-agv01',
  vehicleCarrier: 'seed-veh-car01',
  vehicleDrone: 'seed-veh-drn01',
  templateStandard: 'seed-tpl-std',
  templateCharging: 'seed-tpl-chg',
  /**
   * 演示任务/路线/告警：让「地图路线高亮」「车辆执行中」这两件事在**首次启动**就可见。
   *
   * 真实业务里 `tasks`/`routes` 初始为空（由调度流程产生），但那样地图上永远只有路网，
   * 无法验证路线高亮与车辆动画。这里放入一条状态自洽的最小演示数据
   * （AGV-01 从 A 仓跑向 B 仓，路线经真实存在着的 5 条边），
   * 与 Mock 形态的演示数据保持同一语义。
   */
  demoTask: 'seed-task-demo',
  demoRoute: 'seed-route-demo',
  demoAlert: 'seed-alert-demo'
} as const;

export const SETTINGS_SCHEMA: SettingSchemaItem[] = [
  { key: 'dispatch.defaultStrategy', type: 'select', label: '默认调度策略', defaultValue: 'greedy', options: ['greedy', 'hungarian', 'genetic'], remark: '调度中心默认选中的策略' },
  { key: 'route.defaultAlgorithm', type: 'select', label: '默认路径算法', defaultValue: 'aStar', options: ['aStar', 'dijkstra'], remark: 'A* 为默认快速算法，Dijkstra 作为基线' },
  { key: 'task.timeoutToleranceS', type: 'number', label: '任务超时容忍（秒）', defaultValue: 300, min: 0, max: 86400, unit: 's', remark: '在预估时长基础上叠加的容忍时间' },
  { key: 'alert.dedupeWindowS', type: 'number', label: '告警去重窗口（秒）', defaultValue: 300, min: 0, max: 86400, unit: 's', remark: '同对象同类型告警的静默窗口' },
  { key: 'auth.maxLoginAttempts', type: 'number', label: '密码错误锁定阈值', defaultValue: 5, min: 1, max: 20, unit: '次', remark: '连续错误次数达到即锁定' },
  { key: 'auth.lockMinutes', type: 'number', label: '锁定时长（分钟）', defaultValue: 10, min: 1, max: 1440, unit: 'min', remark: '账号锁定的持续时间' },
  { key: 'monitor.refreshIntervalMs', type: 'number', label: '监控刷新间隔（毫秒）', defaultValue: 1000, min: 250, max: 60000, unit: 'ms', remark: '事件推送之外的兜底轮询间隔' },
  { key: 'alert.autoArchiveDays', type: 'number', label: '告警自动归档天数', defaultValue: 90, min: 1, max: 3650, unit: '天', remark: '已解决告警超期自动归档' },
  { key: 'ui.theme', type: 'select', label: '界面主题', defaultValue: 'light', options: ['light', 'dark'], remark: '仅影响展示，不影响业务' }
];

export function settingsDefaults(): Record<string, string | number | boolean> {
  return Object.fromEntries(SETTINGS_SCHEMA.map((item) => [item.key, item.defaultValue]));
}
