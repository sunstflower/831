import type { SettingSchemaItem } from './types.js';

export const APP_NAME = '无人物流调度管理软件';
export const APP_VERSION = '0.1.0';
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const DISPATCH_COST_WEIGHTS = { deadhead: 1, execute: 1, wait: 0.8, late: 2, chargeRisk: 1000 } as const;
export const MIN_BATTERY_PERCENT = 20;

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
  templateCharging: 'seed-tpl-chg'
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
