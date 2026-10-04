/**
 * 车辆中心（`design.md` §7.1 `/fleet`）的**纯计算层**。
 *
 * 这里只做「行/分桶/迷你轨迹」的换算，不含请求与渲染：
 *   - 分桶统计与行数据组装（`fleetBucketsOf` / `fleetRowsOf`）；
 *   - 电量色调（复用 `shared` 的两个阈值，见下）；
 *   - 轨迹折线 → SVG `path`（把米制坐标归一化到固定画布的视图框）。
 *
 * ## 三个口径都从别处取，本文件不新立
 *
 * 1. **状态中文** 取 `domain/labels.ts`；**状态色调**取 `domain/tone.ts`（`VEHICLE_STATUS_TONE`，
 *    原本只在工作台用，本页落地时按 `tone.ts` 的规则上移）；
 * 2. **电量阈值**取 `shared` 的 `DISPATCH_CHARGE_COMFORT_PERCENT`（舒适线）与 `MIN_BATTERY_PERCENT`
 *    （调度允许下限）—— 界面上标红的那条线必须与调度内核拒绝任务用的是同一条，否则会出现
 *    「车显示续航不足、调度却说可行」；
 * 3. **时间文本**取 `domain/format.ts` 的 `formatDateTime`（与基础数据页的同一字段同口径）。
 *
 * 页面路由与导航的唯一作者仍是 `renderer/src/app/modules.ts`（D-34 / D-59）。
 */
import {
  DISPATCH_CHARGE_COMFORT_PERCENT,
  MIN_BATTERY_PERCENT,
  type MonitorVehicleItem,
  type TaskListItem,
  type VehicleStatus,
  type VehicleTrackPoint
} from '@udm/shared';
import { formatDateTime, formatNumber } from '../domain/format';
import { VEHICLE_STATUS_LABEL, VEHICLE_TYPE_LABEL } from '../domain/labels';
import { VEHICLE_STATUS_TONE, type Tone } from '../domain/tone';

/** 分桶的展示顺序；直接取枚举顺序，不另立一套需要同步的清单。 */
export const FLEET_BUCKET_STATUSES: VehicleStatus[] = [
  'idle',
  'reserved',
  'busy',
  'charging',
  'offline',
  'fault',
  'disabled'
];

export interface FleetBucket {
  status: VehicleStatus;
  label: string;
  count: number;
  tone: Tone;
}

/** 按状态分桶（七个桶恒在，空桶也返回 —— 表格与 KPI 的列宽不会随数据跳动）。 */
export function fleetBucketsOf(vehicles: MonitorVehicleItem[]): FleetBucket[] {
  const counts = new Map<VehicleStatus, number>();
  for (const vehicle of vehicles) {
    counts.set(vehicle.status, (counts.get(vehicle.status) ?? 0) + 1);
  }
  return FLEET_BUCKET_STATUSES.map((status) => ({
    status,
    label: VEHICLE_STATUS_LABEL[status],
    count: counts.get(status) ?? 0,
    tone: VEHICLE_STATUS_TONE[status]
  }));
}

/** 「需要人看一眼」的车辆数：故障 + 离线 + 充电中（停用是刻意关掉的，不算异常）。 */
export function fleetAttentionCount(vehicles: MonitorVehicleItem[]): number {
  return vehicles.filter((vehicle) => vehicle.status === 'fault' || vehicle.status === 'offline' || vehicle.status === 'charging')
    .length;
}

/** 电量色调：与调度内核同一条舒适线 / 下限（见文件头第 2 条）。 */
export function batteryToneOf(battery: number): Tone {
  if (battery >= DISPATCH_CHARGE_COMFORT_PERCENT) {
    return 'ok';
  }
  return battery >= MIN_BATTERY_PERCENT ? 'warn' : 'danger';
}

export interface FleetRow {
  id: string;
  code: string;
  name: string;
  typeLabel: string;
  status: VehicleStatus;
  statusLabel: string;
  statusTone: Tone;
  /** 「当前载重 / 额定载重」，单位 kg。 */
  loadText: string;
  loadRatio: number;
  battery: number;
  /** 是否在线（`online` + 心跳新鲜度由服务端决定，这里只透传）。 */
  online: boolean;
  speedText: string;
  positionText: string;
  /** 当前任务编码；空闲为 `null`（渲染成「—」而不是空单元格）。 */
  taskCode: string | null;
  heartbeatText: string;
}

/** 车辆列表 → 表格行。`tasks` 只用来把 `currentTaskId` 翻成可读编码。 */
export function fleetRowsOf(vehicles: MonitorVehicleItem[], tasks: TaskListItem[]): FleetRow[] {
  const codeById = new Map(tasks.map((task) => [task.id, task.code]));
  return vehicles.map((vehicle) => ({
    id: vehicle.id,
    code: vehicle.code,
    name: vehicle.name,
    typeLabel: VEHICLE_TYPE_LABEL[vehicle.type],
    status: vehicle.status,
    statusLabel: VEHICLE_STATUS_LABEL[vehicle.status],
    statusTone: VEHICLE_STATUS_TONE[vehicle.status],
    loadText: `${formatNumber(vehicle.loadKg)} / ${formatNumber(vehicle.capacityKg)} kg`,
    loadRatio: vehicle.capacityKg > 0 ? Math.min(1, Math.max(0, vehicle.loadKg / vehicle.capacityKg)) : 0,
    battery: vehicle.battery,
    online: vehicle.online,
    speedText: `${formatNumber(vehicle.maxSpeedMps)} m/s`,
    positionText: `${formatNumber(vehicle.x)}, ${formatNumber(vehicle.y)}`,
    taskCode: vehicle.currentTaskId ? (codeById.get(vehicle.currentTaskId) ?? vehicle.currentTaskId) : null,
    heartbeatText: formatDateTime(vehicle.lastHeartbeatAt)
  }));
}

/**
 * 轨迹采样点 → 固定画布上的 SVG `path`。
 *
 * 归一化到 `width × height` 的视图框并按 10% 留白：轨迹的绝对坐标对使用者没有意义
 * （他关心形状与方向），而按原始米制画会让越野/室内坐标互相错位。
 * 退化情形（只有一个点、或全点共线）不返回 `NaN` —— 单点画成一个小圆点由调用方处理，
 * 这里只保证所有共线情形下的另一轴跨度是 0（`scale` 用 1 兜底）。
 */
export function trackPathOf(
  points: VehicleTrackPoint[],
  width = 240,
  height = 120
): string {
  if (points.length === 0) {
    return '';
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const padX = width * 0.1;
  const padY = height * 0.1;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scaleX = spanX > 0 ? (width - padX * 2) / spanX : 1;
  const scaleY = spanY > 0 ? (height - padY * 2) / spanY : 1;
  const project = (point: VehicleTrackPoint) => {
    const x = padX + (point.x - minX) * scaleX;
    // SVG 的 y 轴向下，而平面坐标的 y 向上：不翻转的话轨迹会上下镜像
    const y = height - padY - (point.y - minY) * scaleY;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  const [first, ...rest] = points;
  return `M ${project(first!)} ${rest.map((point) => `L ${project(point)}`).join(' ')}`.trim();
}
