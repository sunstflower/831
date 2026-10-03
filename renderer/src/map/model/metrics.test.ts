import { describe, expect, it } from 'vitest';
import { SEED_IDS } from '@udm/shared';
import { buildMockOverview } from '../../api/mock-data';
import { LOW_BATTERY_PERCENT, computeMetrics } from './metrics';

describe('computeMetrics', () => {
  it('空快照的每一项都是 0（不出现 undefined/NaN）', () => {
    const metrics = computeMetrics({
      nodes: [],
      edges: [],
      sites: [],
      vehicles: [],
      tasks: [],
      routes: [],
      alerts: [],
      eventSeq: 0
    });
    for (const [key, value] of Object.entries(metrics)) {
      if (typeof value === 'number') {
        expect(value, `${key} 应为 0`).toBe(0);
      }
    }
    expect(metrics.vehiclesByStatus).toEqual([]);
  });

  it('与 seed 演示数据一致：车辆按状态分组、执行中任务为 1', () => {
    const overview = buildMockOverview();
    const metrics = computeMetrics(overview);
    expect(metrics.vehicles).toBe(overview.vehicles.length);
    expect(metrics.nodes).toBe(overview.nodes.length);
    expect(metrics.edges).toBe(overview.edges.length);
    expect(metrics.runningTasks).toBe(1);
    // 分组条数从快照自身推出来（车队规模由 `shared/src/seed-data.ts` 的 SEED_FLEET 决定）
    const byStatus = new Map(metrics.vehiclesByStatus);
    for (const status of ['busy', 'idle'] as const) {
      expect(byStatus.get(status) ?? 0).toBe(overview.vehicles.filter((v) => v.status === status).length);
    }
    expect(byStatus.get('busy')).toBe(1);
  });

  it('未处理告警只算 status 为 new（或未给状态）的那些', () => {
    const overview = buildMockOverview();
    overview.alerts = [
      { id: 'a1', type: 'vehicle_offline', level: 'warning', status: 'new', objectType: 'vehicle', objectId: 'v1' },
      { id: 'a2', type: 'task_timeout', level: 'critical', status: 'resolved', objectType: 'task', objectId: 't1' },
      // status 缺省按未处理处理（契约里 status 是可选的）
      { id: 'a3', type: 'data_error', level: 'info', objectType: 'task', objectId: 't2' }
    ];
    const metrics = computeMetrics(overview);
    expect(metrics.alerts).toBe(3);
    expect(metrics.newAlerts).toBe(2);
  });

  it('低电计数阈值与 LOW_BATTERY_PERCENT 同源（含边界值）', () => {
    const overview = buildMockOverview();
    overview.vehicles = [
      { ...overview.vehicles[0]!, id: 'v-low', battery: LOW_BATTERY_PERCENT - 1 },
      { ...overview.vehicles[0]!, id: 'v-edge', battery: LOW_BATTERY_PERCENT },
      { ...overview.vehicles[0]!, id: 'v-ok', battery: LOW_BATTERY_PERCENT + 1 }
    ];
    // 边界值（正好等于阈值）应计入，与 VehicleNode 的视觉提示保持一致
    expect(computeMetrics(overview).lowBatteryVehicles).toBe(2);
  });

  it('统计被禁用的路网元素，供「路网不完整」提示使用', () => {
    const overview = buildMockOverview();
    overview.nodes = overview.nodes.map((node, index) => (index === 0 ? { ...node, status: 'disabled' as const } : node));
    overview.edges = overview.edges.map((edge, index) => (index === 0 ? { ...edge, status: 'disabled' as const } : edge));
    const metrics = computeMetrics(overview);
    expect(metrics.disabledNodes).toBe(1);
    expect(metrics.disabledEdges).toBe(1);
  });

  it('订单端点为可选字段：缺失时计 0，不抛错', () => {
    const overview = buildMockOverview();
    delete (overview as { orderEndpoints?: unknown }).orderEndpoints;
    expect(computeMetrics(overview).orderEndpoints).toBe(0);
  });

  it('生效路线数与总路线数分开统计（superseded 不计入生效）', () => {
    const overview = buildMockOverview();
    overview.routes = [
      ...overview.routes,
      { ...overview.routes[0]!, id: 'r-old', status: 'superseded' }
    ];
    const metrics = computeMetrics(overview);
    expect(metrics.routes).toBe(2);
    expect(metrics.activeRoutes).toBe(1);
  });

  it('vehiclesByStatus 顺序稳定（同一份数据两次计算结果一致）', () => {
    const overview = buildMockOverview();
    const first = computeMetrics(overview).vehiclesByStatus;
    const second = computeMetrics(overview).vehiclesByStatus;
    expect(first).toEqual(second);
  });

  it('不修改传入的快照（纯函数）', () => {
    const overview = buildMockOverview();
    const before = JSON.stringify(overview);
    computeMetrics(overview);
    expect(JSON.stringify(overview)).toBe(before);
  });
});

describe('demo 数据与 SEED_IDS 的关联（防止 mock 与 seed 漂移）', () => {
  it('演示任务/路线/车辆的 id 全部来自 SEED_IDS', () => {
    const overview = buildMockOverview();
    expect(overview.tasks.some((task) => task.id === SEED_IDS.demoTask)).toBe(true);
    expect(overview.routes.some((route) => route.id === SEED_IDS.demoRoute)).toBe(true);
    expect(overview.vehicles.some((vehicle) => vehicle.id === SEED_IDS.vehicleAgv)).toBe(true);
  });
});
