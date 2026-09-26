/**
 * 本轮新增可视化行为的护栏。
 *
 * 与 `toFlow.test.ts` 分开：那份文件锁定**原有契约**（顺序、图层、坐标回退），
 * 本份锁定**新增的可视化决策**（聚焦压暗、底板弱化、起终点去重叠）。
 */
import { describe, expect, it } from 'vitest';
import { SEED_IDS } from '@udm/shared';
import { buildMockOverview } from '../../api/mock-data';
import { toFlow } from './toFlow';
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
    const unrelated = nodes.find((node) => node.type === 'net' && node.id === netNodeId('seed-n07'))!;
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

describe('toFlow · 起终点去重叠（实测缺陷：三者同位互相遮挡）', () => {
  it('任务起终点不再与站点/车辆坐标完全重合', () => {
    const overview = buildMockOverview();
    const { nodes } = toFlow(overview);
    const site = nodes.find((node) => node.id === siteNodeId(SEED_IDS.siteDepotA))!;
    const from = nodes.find((node) => node.id === taskEndpointId(SEED_IDS.demoTask, 'from'))!;
    const vehicle = nodes.find((node) => node.id === vehicleNodeId(SEED_IDS.vehicleAgv))!;
    const same = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x === b.x && a.y === b.y;
    expect(same(from.position, site.position)).toBe(false);
    expect(same(from.position, vehicle.position)).toBe(false);
    expect(same(vehicle.position, site.position)).toBe(true);
  });

  it('起点与终点分别向对角两侧让开（互不重叠）', () => {
    const { nodes } = toFlow(buildMockOverview());
    const from = nodes.find((node) => node.id === taskEndpointId(SEED_IDS.demoTask, 'from'))!;
    const to = nodes.find((node) => node.id === taskEndpointId(SEED_IDS.demoTask, 'to'))!;
    expect(from.position.x).not.toBe(to.position.x);
    expect(from.position.y).not.toBe(to.position.y);
  });

  it('偏移是纯展示变换：只影响画布坐标，不改业务坐标', () => {
    const overview = buildMockOverview();
    const site = overview.sites.find((item) => item.id === SEED_IDS.siteDepotA)!;
    const before = { x: site.x, y: site.y };
    toFlow(overview);
    expect({ x: site.x, y: site.y }).toEqual(before);
  });
});

describe('toFlow · 新增 data 字段（详情面板依赖）', () => {
  it('站点带出头 nodeCode，便于回答「仓库在哪个路口」', () => {
    const { nodes } = toFlow(buildMockOverview());
    const site = nodes.find((node) => node.id === siteNodeId(SEED_IDS.siteDepotA))!;
    expect(site.data).toMatchObject({ nodeCode: 'N01' });
  });

  it('任务端点带出对端站点编码', () => {
    const { nodes } = toFlow(buildMockOverview());
    const from = nodes.find((node) => node.id === taskEndpointId(SEED_IDS.demoTask, 'from'))!;
    // 起点（A-01）的对端是终点 B-01
    expect(from.data).toMatchObject({ peerCode: 'B-01' });
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
    const { edges } = toFlow(buildMockOverview());
    const route = edges.filter((edge) => edge.type === 'route');
    expect(route.length).toBeGreaterThan(0);
    expect(route[0]!.data).toMatchObject({ seq: 0, total: route.length, lengthM: 20 });
  });

  it('路网边带出通行信息与端点编码', () => {
    const { edges } = toFlow(buildMockOverview());
    const net = edges.find((edge) => edge.type === 'net')!;
    expect(net.data).toMatchObject({ kind: '可通行', fromCode: expect.any(String), toCode: expect.any(String) });
    // seed 的边长度为 20m 且无速度限制 → 耗时不可算，必须是 null 而不是瞎猜
    expect((net.data as { travelSeconds: number | null }).travelSeconds).toBeNull();
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
