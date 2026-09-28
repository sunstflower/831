/**
 * 监控工作台的纯计算层。
 *
 * 为什么把「该显示哪几个数字」从组件里搬出来：这一屏的数字有 4 处复用
 * （KPI 卡 / 车队分布条 / 任务列表 / 告警列表），而每一处都要用**同一口径**
 * —— 例如「可用车辆」在 KPI 和分布图里若一处算 idle、一处算 idle+reserved，
 * 使用者会看到两个互相矛盾的数字，且都不报错。这里只算一次，组件只负责排版。
 *
 * 数据来源：只读 GET /api/map/overview 的同一份快照（Req-M6-5 的「画布唯一数据入口」）。
 * 本层不发请求、不落库、不写业务状态，因此可以完整单测。
 *
 * 注意：这不是 M7（运行监控）。M7 的专属接口 /api/monitor/* 尚未实现（ISS-010），
 * 工作台当前展示的是地图快照里已有的指标，页面上如实标注了数据来源。
 */
import type { AlertLevel, AlertStatus, TaskStatus, VehicleStatus } from '@udm/shared';
import type { MapAlert, MapOverview, MapTask } from '../../api/types';
import { TASK_STATUS_TONE, toneClass, type Tone } from '../../domain/tone';
import {
  ALERT_LEVEL_LABEL,
  ALERT_STATUS_LABEL,
  ALERT_TYPE_LABEL,
  OBJECT_TYPE_LABEL,
  TASK_STATUS_LABEL,
  VEHICLE_STATUS_LABEL,
  labelOf
} from '../../domain/labels';
import { LOW_BATTERY_PERCENT, type MapMetrics } from '../../map/model/metrics';


/* ==================== KPI ==================== */

export interface Kpi {
  key: string;
  label: string;
  value: string;
  /** 单位或分母，单独一列以便用更小的字号排版。 */
  suffix?: string;
  tone: Tone;
  /** 副说明：解释这个数字由什么构成（不用使用者去猜口径）。 */
  hint: string;
}

/**
 * 四个概览指标。
 *
 * 选取依据：这四项决定「现在要不要人介入」—— 可用的车够不够、有没有任务在跑、
 * 有没有告警没人管、车还能不能跑。其余统计（站点数、边数）属于背景信息，
 * 放在「数据源」卡片里，不占用首屏最贵的位置。
 */
export function buildKpis(overview: MapOverview, metrics: MapMetrics): Kpi[] {
  const byStatus = countBy(overview.vehicles.map((vehicle) => vehicle.status));
  // 「可用」= 空闲 + 已预留：已预留的车接了单但还没出车，调度上仍算在编运力
  const available = (byStatus.idle ?? 0) + (byStatus.reserved ?? 0);
  const total = overview.vehicles.length;
  const avgBattery = total === 0 ? 0 : overview.vehicles.reduce((sum, vehicle) => sum + vehicle.battery, 0) / total;

  return [
    {
      key: 'fleet',
      label: '可用车辆',
      value: String(available),
      suffix: `/ ${total}`,
      tone: available > 0 ? 'ok' : total > 0 ? 'warn' : 'dim',
      hint: `空闲 ${byStatus.idle ?? 0} · 已预留 ${byStatus.reserved ?? 0} · 执行中 ${byStatus.busy ?? 0}`
    },
    {
      key: 'running',
      label: '执行中任务',
      value: String(metrics.runningTasks),
      suffix: `/ ${metrics.tasks}`,
      tone: metrics.runningTasks > 0 ? 'info' : 'dim',
      hint: `待派 ${countStatus(overview.tasks, 'pending')} · 已派发 ${countStatus(overview.tasks, 'assigned')}`
    },
    {
      key: 'alerts',
      label: '待确认告警',
      value: String(metrics.newAlerts),
      suffix: `/ ${metrics.alerts}`,
      tone: metrics.newAlerts > 0 ? 'danger' : 'ok',
      hint: metrics.newAlerts > 0 ? '需先确认，再进入处理流程' : '暂无待确认告警'
    },
    {
      key: 'battery',
      label: '车队平均电量',
      value: String(Math.round(avgBattery)),
      suffix: '%',
      tone: avgBattery > 50 ? 'ok' : avgBattery > 25 ? 'warn' : 'danger',
      hint: `低电（≤${LOW_BATTERY_PERCENT}%）${metrics.lowBatteryVehicles} 台`
    }
  ];
}

/* ==================== 车队状态分布 ==================== */

export interface FleetBucket {
  status: VehicleStatus;
  label: string;
  count: number;
  /** 占车队总数的比例（0–1），用于堆叠条宽度。 */
  ratio: number;
  tone: Tone;
  /** 该状态是否属于可调度运力。 */
  schedulable: boolean;
}

/**
 * 展示顺序与枚举定义顺序（`VEHICLE_STATUSES`）一致：能出车的在前、需人处理的居中、已停用的收尾。
 * 直接取枚举顺序而不另立一套排序，少一处需要同步的清单。
 */
const FLEET_ORDER: VehicleStatus[] = ['idle', 'reserved', 'busy', 'charging', 'offline', 'fault', 'disabled'];

/** 状态 → tone：只有「需要人介入」的状态才给警示色，避免整条图都是红的。 */
const FLEET_TONE: Record<VehicleStatus, Tone> = {
  idle: 'ok',
  reserved: 'info',
  busy: 'info',
  charging: 'warn',
  offline: 'dim',
  fault: 'danger',
  disabled: 'dim'
};

/** 车辆离线 / 故障 / 停用不进入调度候选集（Req-M2-7）。 */
const SCHEDULABLE: VehicleStatus[] = ['idle', 'reserved', 'busy', 'charging'];

export function buildFleetBuckets(overview: MapOverview): FleetBucket[] {
  const byStatus = countBy(overview.vehicles.map((vehicle) => vehicle.status));
  const total = overview.vehicles.length;
  return FLEET_ORDER.map((status) => {
    const count = byStatus[status] ?? 0;
    return {
      status,
      label: VEHICLE_STATUS_LABEL[status],
      count,
      ratio: total === 0 ? 0 : count / total,
      tone: FLEET_TONE[status],
      schedulable: SCHEDULABLE.includes(status)
    };
  });
}

/* ==================== 任务进度 ==================== */

export interface TaskRow {
  id: string;
  code: string;
  status: TaskStatus;
  statusLabel: string;
  tone: Tone;
  /** 进度（0–1）。 */
  progress: number;
  /** 百分比整数，避免组件里各自 round 后显示不一致。 */
  percent: number;
  fromCode: string;
  toCode: string;
  vehicleCode: string | null;
}

/** 任务排序：执行中的先看，然后按「离完成还差几步」倒排。 */
const TASK_ORDER: TaskStatus[] = ['running', 'paused', 'assigned', 'pending', 'draft', 'failed', 'cancelled', 'finished'];

export interface TaskRowPage {
  rows: TaskRow[];
  /** 被截断的任务数（列表只显示前 limit 条，但要如实说明还有多少）。 */
  hidden: number;
}

export function buildTaskRows(overview: MapOverview, limit = 6): TaskRowPage {
  const siteCode = new Map(overview.sites.map((site) => [site.id, site.code]));
  const vehicleCode = new Map(overview.vehicles.map((vehicle) => [vehicle.id, vehicle.code]));
  const sorted = [...overview.tasks].sort((a, b) => rank(TASK_ORDER, a.status) - rank(TASK_ORDER, b.status));

  const rows = sorted.slice(0, limit).map((task: MapTask) => ({
    id: task.id,
    code: task.code,
    status: task.status,
    statusLabel: labelOf(TASK_STATUS_LABEL, task.status),
    tone: TASK_STATUS_TONE[task.status],
    progress: task.progress,
    percent: Math.round(task.progress * 100),
    // 站点 / 车辆缺失时回落到原 id，绝不显示空白（design.md §7.2 第 6 条）
    fromCode: siteCode.get(task.fromSiteId) ?? task.fromSiteId,
    toCode: siteCode.get(task.toSiteId) ?? task.toSiteId,
    vehicleCode: task.vehicleId ? (vehicleCode.get(task.vehicleId) ?? task.vehicleId) : null
  }));

  return { rows, hidden: Math.max(0, sorted.length - rows.length) };
}

/* ==================== 告警 ==================== */

export interface AlertRow {
  id: string;
  typeLabel: string;
  level: AlertLevel;
  levelLabel: string;
  tone: Tone;
  statusLabel: string;
  /** 「车辆 · DRN-01」这类可读对象名（id 一律翻译成 code，翻译不到才回显 id）。 */
  objectLabel: string;
  /** 是否还需要人处理（new / acknowledged / processing）。 */
  open: boolean;
}

const ALERT_STATUS_ORDER: AlertStatus[] = ['new', 'acknowledged', 'processing', 'resolved', 'archived'];
const ALERT_LEVEL_RANK: Record<AlertLevel, number> = { critical: 0, warning: 1, info: 2 };
const ALERT_TONE: Record<AlertLevel, Tone> = { critical: 'danger', warning: 'warn', info: 'info' };

export interface AlertRowPage {
  rows: AlertRow[];
  hidden: number;
  /** 仍未闭环的告警数（跨状态统计，与「待确认」不是一回事）。 */
  openCount: number;
}

/**
 * 告警列表：先按状态（未闭环优先），再按级别（严重优先）。
 *
 * 为什么不只按级别排：一条 critical 但已归档的告警排在一条 warning 的待确认告警之前，
 * 会让人把注意力放在已经处理完的事情上。状态优先才符合「先看要动手的」。
 */
export function buildAlertRows(overview: MapOverview, limit = 6): AlertRowPage {
  const statusOf = (alert: MapAlert): AlertStatus => alert.status ?? 'new';
  const sorted = [...overview.alerts].sort((a, b) => {
    const byStatus = rank(ALERT_STATUS_ORDER, statusOf(a)) - rank(ALERT_STATUS_ORDER, statusOf(b));
    return byStatus !== 0 ? byStatus : ALERT_LEVEL_RANK[a.level] - ALERT_LEVEL_RANK[b.level];
  });

  const nameOf = buildObjectNameResolver(overview);
  const rows = sorted.slice(0, limit).map((alert) => ({
    id: alert.id,
    typeLabel: labelOf(ALERT_TYPE_LABEL, alert.type),
    level: alert.level,
    levelLabel: labelOf(ALERT_LEVEL_LABEL, alert.level),
    tone: ALERT_TONE[alert.level],
    statusLabel: labelOf(ALERT_STATUS_LABEL, statusOf(alert)),
    objectLabel: nameOf(alert),
    open: statusOf(alert) !== 'resolved' && statusOf(alert) !== 'archived'
  }));

  return {
    rows,
    hidden: Math.max(0, sorted.length - rows.length),
    openCount: overview.alerts.filter((alert) => statusOf(alert) !== 'resolved' && statusOf(alert) !== 'archived').length
  };
}

/**
 * 把告警的 objectId 翻译成人类可读的名字。
 *
 * 为什么值得这一步：告警最关键的上下文是「哪台车、哪个任务出事了」，
 * 而快照里给的是内部 id（如 seed-veh-agv01）。直接把 id 印在界面上，
 * 使用者还得回地图上比对一遍才能确认是哪台车。
 */
function buildObjectNameResolver(overview: MapOverview): (alert: MapAlert) => string {
  const sites = new Map(overview.sites.map((site) => [site.id, site.code]));
  const vehicles = new Map(overview.vehicles.map((vehicle) => [vehicle.id, vehicle.code]));
  const tasks = new Map(overview.tasks.map((task) => [task.id, task.code]));
  const routes = new Map(overview.routes.map((route) => [route.id, route.id]));
  const nodes = new Map(overview.nodes.map((node) => [node.id, node.code]));
  const edges = new Map(overview.edges.map((edge) => [edge.id, edge.id]));

  return (alert) => {
    const typeLabel = labelOf(OBJECT_TYPE_LABEL, alert.objectType);
    const table = {
      site: sites,
      vehicle: vehicles,
      task: tasks,
      node: nodes,
      route: routes,
      edge: edges
    }[alert.objectType as 'site' | 'vehicle' | 'task' | 'node' | 'route' | 'edge'];
    const name = table?.get(alert.objectId) ?? alert.objectId;
    return `${typeLabel} · ${name}`;
  };
}

/* ==================== 工具 ==================== */

function countBy<T extends string>(values: T[]): Partial<Record<T, number>> {
  const result: Partial<Record<T, number>> = {};
  for (const value of values) {
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function countStatus(tasks: MapTask[], status: TaskStatus): number {
  return tasks.filter((task) => task.status === status).length;
}

/** 取枚举在给定展示顺序里的下标；未登记的一律排到最后（不抛错、不静默丢弃）。 */
function rank<T extends string>(order: T[], value: T): number {
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}
