import { describe, expect, it } from 'vitest';
import { SEED_IDS } from '@udm/shared';
import { buildMockOverview } from '../../api/mock-data';
import { buildDetailCard } from './detail';
import { buildEdgeLengthIndex, routeLength } from './edgeIndex';

describe('buildDetailCard · 无选中 / 未知类型', () => {
  it('未选中时返回 null（由 UI 显示引导文案，而不是空卡片）', () => {
    expect(buildDetailCard(buildMockOverview(), null)).toBeNull();
  });

  it('选中对象但快照里不存在 → null，不臆造字段', () => {
    const overview = buildMockOverview();
    expect(buildDetailCard(overview, { flowId: 'x', entityType: 'vehicle', entityId: 'ghost' })).toBeNull();
  });

  it('可选中但无详情的类型（user/settings 等）→ null', () => {
    const overview = buildMockOverview();
    expect(buildDetailCard(overview, { flowId: 'x', entityType: 'settings', entityId: 's' })).toBeNull();
  });
});

describe('buildDetailCard · 车辆', () => {
  it('执行中的车辆带出任务、进度与路线长度', () => {
    const overview = buildMockOverview();
    const card = buildDetailCard(overview, {
      flowId: 'v',
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleAgv
    });
    expect(card).not.toBeNull();
    expect(card!.title).toBe('AGV-01');
    const rows = new Map(card!.rows.map((row) => [row.label, row.value]));
    expect(rows.get('状态')).toBe('执行中');
    expect(rows.get('电量')).toBe('100%');
    expect(rows.get('执行任务')).toBe('T-DEMO-0001');
    expect(rows.get('任务进度')).toBe('42%');
    // 路线长度必须来自路网边长求和，而不是「节点数 × 步长」这类猜测
    const route = overview.routes[0]!;
    const expected = routeLength(buildEdgeLengthIndex(overview), route.nodeIds);
    expect(rows.get('路线长度')).toBe(`${Math.round(expected.totalM)} m`);
  });

  it('空闲车辆在「执行任务」处显示占位符而非空白', () => {
    const overview = buildMockOverview();
    const card = buildDetailCard(overview, {
      flowId: 'v',
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleDrone
    });
    const rows = new Map(card!.rows.map((row) => [row.label, row.value]));
    expect(rows.get('执行任务')).toBe('—');
    expect(rows.get('路线')).toBe('无路线');
  });

  it('低电车辆的电量行标为 danger（阈值口径与节点组件同源）', () => {
    const overview = buildMockOverview();
    overview.vehicles = overview.vehicles.map((vehicle) =>
      vehicle.id === SEED_IDS.vehicleCarrier ? { ...vehicle, battery: 8 } : vehicle
    );
    const card = buildDetailCard(overview, {
      flowId: 'v',
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleCarrier
    });
    const batteryRow = card!.rows.find((row) => row.label === '电量')!;
    expect(batteryRow.value).toBe('8%');
    expect(batteryRow.tone).toBe('danger');
  });

  it('挂载的告警会带进详情卡（并保留级别）', () => {
    const overview = buildMockOverview();
    const card = buildDetailCard(overview, {
      flowId: 'v',
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleDrone
    });
    // mock 快照里 DRN-01 有一条 vehicle_offline 告警
    expect(card!.alerts).toHaveLength(1);
    expect(card!.alerts[0]!.tone).toBe('warning');
  });
});

describe('buildDetailCard · 任务 / 路线 / 站点 / 节点', () => {
  it('任务：起终点用站点编码展示，并带出执行车辆', () => {
    const overview = buildMockOverview();
    const card = buildDetailCard(overview, {
      flowId: 't',
      entityType: 'task',
      entityId: SEED_IDS.demoTask
    });
    const rows = new Map(card!.rows.map((row) => [row.label, row.value]));
    expect(rows.get('起点')).toContain('A-01');
    expect(rows.get('终点')).toContain('B-01');
    expect(rows.get('执行车辆')).toBe('AGV-01');
    expect(rows.get('进度')).toBe('42%');
  });

  it('路线：给出状态、节点数与长度', () => {
    const overview = buildMockOverview();
    const card = buildDetailCard(overview, {
      flowId: 'r',
      entityType: 'route',
      entityId: SEED_IDS.demoRoute
    });
    const rows = new Map(card!.rows.map((row) => [row.label, row.value]));
    expect(rows.get('状态')).toBe('生效中');
    expect(rows.get('节点数')).toBe('6');
  });

  it('站点：给出类型、挂靠节点与坐标', () => {
    const overview = buildMockOverview();
    const card = buildDetailCard(overview, {
      flowId: 's',
      entityType: 'site',
      entityId: SEED_IDS.siteCharging
    });
    const rows = new Map(card!.rows.map((row) => [row.label, row.value]));
    expect(rows.get('类型')).toBe('充电桩');
    expect(rows.get('挂靠节点')).toBe('N04');
  });

  it('路网节点：连接边数等于与它相连的边数（双向计数），并统计其中被禁行的数量', () => {
    const overview = buildMockOverview();
    const nodeId = 'seed-n01';
    // 不写死数字：路网是**双向**的，角落节点也有「出边 + 入边」，
    // 直接按快照实际相连的边数断言，避免把「出边」误当「连接边」。
    const expected = overview.edges.filter(
      (edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId
    ).length;
    const card = buildDetailCard(overview, { flowId: 'n', entityType: 'node', entityId: nodeId });
    const rows = new Map(card!.rows.map((row) => [row.label, row.value]));
    expect(rows.get('连接边数')).toBe(String(expected));
    expect(expected).toBeGreaterThan(0);
    expect(rows.get('禁行边')).toBe('0');
  });

  it('路网节点：被禁行的边计入「禁行边」（用于发现路网不连通）', () => {
    const overview = buildMockOverview();
    const nodeId = 'seed-n01';
    overview.edges = overview.edges.map((edge) =>
      edge.fromNodeId === nodeId || edge.toNodeId === nodeId ? { ...edge, status: 'disabled' as const } : edge
    );
    const card = buildDetailCard(overview, { flowId: 'n', entityType: 'node', entityId: nodeId });
    const row = card!.rows.find((item) => item.label === '禁行边')!;
    expect(Number(row.value)).toBeGreaterThan(0);
    expect(row.tone).toBe('warn');
  });

  it('订单端点：未上图的订单返回 null（不伪造坐标）', () => {
    const overview = buildMockOverview();
    expect(buildDetailCard(overview, { flowId: 'o', entityType: 'order', entityId: 'o1' })).toBeNull();
  });

  it('订单端点：上图后按角色给出取/送点与置信度', () => {
    const overview = buildMockOverview();
    overview.orderEndpoints = [
      { orderId: 'o1', role: 'from', x: 20, y: 0, confidence: 0.62, pathStatus: 'ok' },
      { orderId: 'o1', role: 'to', x: 40, y: 20, confidence: 0.95, pathStatus: 'route_unavailable' }
    ];
    const card = buildDetailCard(overview, { flowId: 'o', entityType: 'order', entityId: 'o1' });
    const rows = new Map(card!.rows.map((row) => [row.label, row.value]));
    expect(rows.get('取货点')).toContain('62%');
    // 置信度低 + 无路径 → 都应标黄（提醒人工复核），而不是当作正常点位
    expect(card!.rows.find((row) => row.label === '取货点')!.tone).toBe('warn');
    expect(card!.rows.find((row) => row.label === '送货点')!.tone).toBe('warn');
  });
});
