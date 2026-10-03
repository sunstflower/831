/**
 * 本轮新增可视化行为的护栏。
 *
 * 与 `toFlow.test.ts` 分开：那份文件锁定**原有契约**（顺序、图层、坐标回退），
 * 本份锁定**新增的可视化决策**（聚焦压暗、底板弱化、共点图层去重叠）。
 */
import { describe, expect, it } from 'vitest';
import { SEED_IDS, campusNodeId } from '@udm/shared';
import { buildMockOverview } from '../../api/mock-data';
import { LAYER_OFFSET, anchorOfFlow, toFlow } from './toFlow';
import { netNodeId, siteNodeId, taskEndpointId, vehicleNodeId } from './ids';
import { DEFAULT_VISIBILITY, LAYERS, LAYER_PRESETS, layersOfGroup } from './layers';

describe('toFlow · 聚焦压暗（选中后突出上下文）', () => {
  it('未选中时没有任何元素被压暗', () => {
    const { nodes, edges } = toFlow(buildMockOverview(), DEFAULT_VISIBILITY, null);
    expect(nodes.some((node) => node.className?.includes('is-dimmed'))).toBe(false);
    expect(edges.some((edge) => edge.className?.includes('is-dimmed'))).toBe(false);
  });

  it('选中车辆后：它自己与上下文不压暗，无关车辆被压暗', () => {
    const overview = buildMockOverview();
    const { nodes } = toFlow(overview, DEFAULT_VISIBILITY, {
      flowId: vehicleNodeId(SEED_IDS.vehicleAgv),
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleAgv
    });
    const agv = nodes.find((node) => node.id === vehicleNodeId(SEED_IDS.vehicleAgv))!;
    const drone = nodes.find((node) => node.id === vehicleNodeId(SEED_IDS.vehicleDrone))!;
    expect(agv.className ?? '').not.toContain('is-dimmed');
    // 车辆节点本身从不压暗（地图上找不到车是最差的结果），但它的**任务端点/路线**要遵循聚焦
    expect(drone.className ?? '').not.toContain('is-dimmed');
  });

  it('选中车辆后：不相关的路网节点被压暗，其任务起终点不压暗', () => {
    const overview = buildMockOverview();
    const { nodes } = toFlow(overview, DEFAULT_VISIBILITY, {
      flowId: vehicleNodeId(SEED_IDS.vehicleAgv),
      entityType: 'vehicle',
      entityId: SEED_IDS.vehicleAgv
    });
    const onTask = nodes.find((node) => node.id === taskEndpointId(SEED_IDS.demoTask, 'from'))!;
    // 取一个**不在** AGV 执行链上的路口（执行链由演示路线决定，见 seed-data.ts）
    const onRoute = new Set(overview.routes.flatMap((route) => route.nodeIds));
    const offRoute = overview.nodes.find((node) => !onRoute.has(node.id))!;
    const unrelated = nodes.find((node) => node.type === 'net' && node.id === netNodeId(offRoute.id))!;
    expect(onTask.className ?? '').not.toContain('is-dimmed');
    expect(unrelated.className ?? '').toContain('is-dimmed');
  });

  it('选中设置类对象（非画布实体）时不压暗任何元素', () => {
    const { nodes } = toFlow(buildMockOverview(), DEFAULT_VISIBILITY, {
      flowId: 'x',
      entityType: 'settings',
      entityId: 's1'
    });
    expect(nodes.some((node) => node.className?.includes('is-dimmed'))).toBe(false);
  });
});

describe('toFlow · 路网底板弱化（有路线时把权重让给路线）', () => {
  it('存在生效路线且路线图层可见时，路网边带 is-muted', () => {
    const { edges } = toFlow(buildMockOverview(), DEFAULT_VISIBILITY);
    const net = edges.filter((edge) => edge.type === 'net');
    expect(net.length).toBeGreaterThan(0);
    expect(net.every((edge) => edge.className?.includes('is-muted'))).toBe(true);
  });

  it('路线图层关闭时不弱化底板（否则画面只剩一堆淡线）', () => {
    const { edges } = toFlow(buildMockOverview(), { ...DEFAULT_VISIBILITY, routeEdges: false });
    const net = edges.filter((edge) => edge.type === 'net');
    expect(net.every((edge) => !edge.className?.includes('is-muted'))).toBe(true);
  });

  it('没有生效路线时不弱化底板（无路线可突出）', () => {
    const overview = buildMockOverview();
    overview.routes = overview.routes.map((route) => ({ ...route, status: 'superseded' as const }));
    const { edges } = toFlow(overview, DEFAULT_VISIBILITY);
    expect(edges.filter((edge) => edge.type === 'net').every((edge) => !edge.className?.includes('is-muted'))).toBe(true);
  });
});

describe('toFlow · 共点图层去重叠（实测缺陷：同位元素互相遮挡）', () => {
  it('挂在同一个节点上的车辆/站点/任务端点三者坐标两两不同', () => {
    const overview = buildMockOverview();
    const { nodes } = toFlow(overview);
    const site = nodes.find((node) => node.id === siteNodeId(SEED_IDS.siteDepot))!;
    const from = nodes.find((node) => node.id === taskEndpointId(SEED_IDS.demoTask, 'from'))!;
    const vehicle = nodes.find((node) => node.id === vehicleNodeId(SEED_IDS.vehicleAgv))!;
    const same = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x === b.x && a.y === b.y;
    // 原先这条断言写的是 `toBe(true)`：车辆与站点**故意**完全同位，于是两个标签框互相压住
    // （ISS-053）。现在站点抬起、端点让到两侧，四者（含路网节点）必须两两可分辨。
    expect(same(from.position, site.position)).toBe(false);
    expect(same(from.position, vehicle.position)).toBe(false);
    expect(same(vehicle.position, site.position)).toBe(false);
    // 方向也要对：站点在车辆**上方**（画布 y 更小），端点在同一水平线上
    expect(site.position.y).toBeLessThan(vehicle.position.y);
    // 用 `toBeCloseTo` 而不是 `toBe`：车辆走 `toFlowXY`（业务 y=0 取负得 `-0`），
    // 端点走 `shiftFlow`（`-0` 已归一成 `0`），`Object.is` 会把这对数值相等的值判为不同。
    expect(from.position.y).toBeCloseTo(vehicle.position.y, 6);
  });

  it('起点与终点各自相对锚点向两侧让开（与坐标先后无关）', () => {
    const { nodes } = toFlow(buildMockOverview());
    const from = nodes.find((node) => node.id === taskEndpointId(SEED_IDS.demoTask, 'from'))!;
    const to = nodes.find((node) => node.id === taskEndpointId(SEED_IDS.demoTask, 'to'))!;
    // 弱化成「相对各自的锚点向两侧偏移」而不是「起点的 x 更小」：
    // 起终点在路网上的左右关系由**路线**决定（配送中心在车站的东边完全合理），
    // 而这条用例要守的是「同一个锚点上端点让开、不与车辆/站点重叠」
    expect(from.position.x).toBeCloseTo(anchorOfFlow(from).x + LAYER_OFFSET.taskEndpoint.from.x, 6);
    expect(to.position.x).toBeCloseTo(anchorOfFlow(to).x + LAYER_OFFSET.taskEndpoint.to.x, 6);
  });

  it('偏移是纯展示变换：只影响画布坐标，不改业务坐标', () => {
    const overview = buildMockOverview();
    const site = overview.sites.find((item) => item.id === SEED_IDS.siteDepot)!;
    const before = { x: site.x, y: site.y };
    toFlow(overview);
    expect({ x: site.x, y: site.y }).toEqual(before);
  });
});

describe('toFlow · 新增 data 字段（详情面板依赖）', () => {
  it('站点带出头 nodeCode，便于回答「仓库在哪个路口」', () => {
    const overview = buildMockOverview();
    const anchor = overview.nodes.find(
      (node) => node.id === overview.sites.find((item) => item.id === SEED_IDS.siteDepot)!.nodeId
    )!;
    const { nodes } = toFlow(overview);
    const site = nodes.find((node) => node.id === siteNodeId(SEED_IDS.siteDepot))!;
    expect(site.data).toMatchObject({ nodeCode: anchor.code });
  });

  it('任务端点带出对端站点编码', () => {
    const overview = buildMockOverview();
    const { nodes } = toFlow(overview);
    const toSite = overview.sites.find((item) => item.id === SEED_IDS.siteDorm)!;
    const from = nodes.find((node) => node.id === taskEndpointId(SEED_IDS.demoTask, 'from'))!;
    // 起点的对端是终点站点（编码从快照读，`ST09` 这类编码由车站文件决定）
    expect(from.data).toMatchObject({ peerCode: toSite.code });
  });

  it('车辆带出 lowBattery 标记（阈值判定只在数据层做一次）', () => {
    const overview = buildMockOverview();
    overview.vehicles = overview.vehicles.map((vehicle) =>
      vehicle.id === SEED_IDS.vehicleCarrier ? { ...vehicle, battery: 5 } : vehicle
    );
    const { nodes } = toFlow(overview);
    const low = nodes.find((node) => node.id === vehicleNodeId(SEED_IDS.vehicleCarrier))!;
    const ok = nodes.find((node) => node.id === vehicleNodeId(SEED_IDS.vehicleDrone))!;
    expect(low.data).toMatchObject({ lowBattery: true });
    expect(ok.data).toMatchObject({ lowBattery: false });
  });

  it('路线分段带出段序与边长（供「第 N/M 段 · xx m」标签）', () => {
    const overview = buildMockOverview();
    const { edges } = toFlow(overview);
    const route = edges.filter((edge) => edge.type === 'route');
    expect(route.length).toBeGreaterThan(0);
    // 边长必须等于**该段两端节点间那条基础边**的长度（不是猜的常数）
    const path = overview.routes[0]!.nodeIds;
    const segment = overview.edges.find(
      (edge) => edge.fromNodeId === path[0] && edge.toNodeId === path[1]
    )!;
    expect(route[0]!.data).toMatchObject({ seq: 0, total: route.length, lengthM: segment.lengthM });
  });

  it('路网边带出通行信息与端点编码', () => {
    const overview = buildMockOverview();
    const { edges } = toFlow(overview);
    // 取一条**畅通**边（weight = 1）：慢边的 kind 是「拥堵（通行变慢）」，由下一条用例单独断言
    const net = edges.find((edge) => edge.type === 'net' && (edge.data as { weight?: number }).weight === 1)!;
    expect(net.data).toMatchObject({ kind: '可通行', fromCode: expect.any(String), toCode: expect.any(String) });
    // 耗时的唯一算法：`边长 × 权重 ÷ 限速`（与 `shared/src/route-search.ts` 同一条式子）；
    // 没有限速的边必须是 null 而不是瞎猜
    const netData = net.data as { fromCode: string; toCode: string; travelSeconds: number | null; weight: number };
    const edge = overview.edges.find(
      (item) => item.fromNodeId === campusNodeId(netData.fromCode) && item.toNodeId === campusNodeId(netData.toCode)
    )!;
    const weight = edge.weight ?? 1;
    expect(netData.weight).toBe(weight);
    if (edge.speedLimitMps && edge.lengthM !== undefined) {
      expect(netData.travelSeconds).toBeCloseTo((edge.lengthM * weight) / edge.speedLimitMps, 1);
    } else {
      expect(netData.travelSeconds).toBeNull();
    }
  });

  it('慢边（weight > 1）带上 is-slow 与「拥堵」说明：调度绕开它时使用者要能看懂', () => {
    const overview = buildMockOverview();
    // 数据里确实有慢边（`data/campus/campus_congestion.csv`）
    const slowEdge = overview.edges.find((edge) => (edge.weight ?? 1) > 1);
    expect(slowEdge, '演示数据里应当有至少一条通行权重 > 1 的边').toBeDefined();
    const { edges } = toFlow(overview);
    const slow = edges.find((edge) => edge.id === `net-edge-${slowEdge!.id}`) ?? edges.find(
      (edge) => (edge.data as { weight?: number }).weight !== undefined && ((edge.data as { weight: number }).weight) > 1
    )!;
    expect(String(slow.className)).toContain('is-slow');
    expect(slow.data).toMatchObject({ kind: '拥堵（通行变慢）' });
    // 畅通边不该被标成慢边
    const fast = edges.find((edge) => (edge.data as { weight?: number }).weight === 1)!;
    expect(String(fast.className)).not.toContain('is-slow');
    expect(fast.data).toMatchObject({ kind: '可通行' });
  });
});

describe('图层定义 · 元数据完备性', () => {
  it('每个图层都有分组、配色 tone 与说明文案', () => {
    for (const layer of LAYERS) {
      expect(layer.group, `${layer.key} 缺 group`).toBeTruthy();
      expect(layer.tone, `${layer.key} 缺 tone`).toBeTruthy();
      expect(layer.hint.length, `${layer.key} 的说明太短`).toBeGreaterThan(4);
    }
  });

  it('分组覆盖全部图层（没有图层掉在分组之外）', () => {
    const grouped = new Set(
      (['network', 'dispatch', 'facility'] as const).flatMap((group) => layersOfGroup(group).map((layer) => layer.key))
    );
    expect(grouped.size).toBe(LAYERS.length);
  });

  it('车辆层永远不可关闭，且所有预设都把它置为可见', () => {
    const vehicle = LAYERS.find((layer) => layer.key === 'vehicles')!;
    expect(vehicle.toggleable).toBe(false);
    for (const preset of LAYER_PRESETS) {
      expect(preset.visibility.vehicles, `预设 ${preset.key} 把车辆关掉了`).toBe(true);
    }
  });

  it('每个预设都给出全部图层的取值（不留 undefined）', () => {
    for (const preset of LAYER_PRESETS) {
      for (const layer of LAYERS) {
        expect(typeof preset.visibility[layer.key], `预设 ${preset.key} 缺 ${layer.key}`).toBe('boolean');
      }
    }
  });
});
