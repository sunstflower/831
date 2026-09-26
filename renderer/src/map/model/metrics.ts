/**
 * 画布指标的**纯计算**（供顶部状态条与图例复用）。
 *
 * 为什么单独一份：同一批数字要同时出现在「顶部状态条」和「图层面板」两处，
 * 各自 `filter().length` 地写就会重算两遍、且容易漏掉同一个口径
 * （例如一处排除了 superseded 路线、另一处没排）。
 * 这里只算一次，两个 UI 共用同一个结果对象。
 *
 * 全部为**展示口径**：不落库、不进接口、不写回业务数据。
 */
import type { MapOverview } from '../../api/types';

export interface MapMetrics {
  nodes: number;
  edges: number;
  /** 被禁用的路网元素（节点 + 边），用于提示「路网不完整」。 */
  disabledNodes: number;
  disabledEdges: number;
  sites: number;
  /** 车辆按状态分组计数（只含出现过的状态，避免 UI 出现一排 0）。 */
  vehiclesByStatus: Array<[string, number]>;
  vehicles: number;
  /** 电量低于阈值的车辆数（阈值与 `VehicleNode` 的「低电」提示保持一致）。 */
  lowBatteryVehicles: number;
  tasks: number;
  /** 执行中的任务数（`running`）。 */
  runningTasks: number;
  routes: number;
  /** 生效中的路线数（`active`）。 */
  activeRoutes: number;
  /** 未处理的告警数（`new`）。 */
  newAlerts: number;
  alerts: number;
  orderEndpoints: number;
}

/** 低电量阈值（%）。与 `VehicleNode` 的视觉提示同源，改这里即可两处生效。 */
export const LOW_BATTERY_PERCENT = 20;

export function computeMetrics(overview: MapOverview): MapMetrics {
  const vehiclesByStatus = new Map<string, number>();
  let lowBatteryVehicles = 0;
  for (const vehicle of overview.vehicles) {
    vehiclesByStatus.set(vehicle.status, (vehiclesByStatus.get(vehicle.status) ?? 0) + 1);
    if (vehicle.battery <= LOW_BATTERY_PERCENT) {
      lowBatteryVehicles += 1;
    }
  }

  return {
    nodes: overview.nodes.length,
    edges: overview.edges.length,
    disabledNodes: overview.nodes.filter((node) => node.status === 'disabled').length,
    disabledEdges: overview.edges.filter((edge) => edge.status === 'disabled').length,
    sites: overview.sites.length,
    // 按固定顺序输出，避免同一份数据在不同渲染间抖动
    vehiclesByStatus: [...vehiclesByStatus.entries()].sort(([a], [b]) => a.localeCompare(b)),
    vehicles: overview.vehicles.length,
    lowBatteryVehicles,
    tasks: overview.tasks.length,
    runningTasks: overview.tasks.filter((task) => task.status === 'running').length,
    routes: overview.routes.length,
    activeRoutes: overview.routes.filter((route) => route.status === 'active').length,
    newAlerts: overview.alerts.filter((alert) => (alert.status ?? 'new') === 'new').length,
    alerts: overview.alerts.length,
    orderEndpoints: overview.orderEndpoints?.length ?? 0
  };
}
