import { describe, expect, it } from 'vitest';
import { buildMockOverview } from '../../api/mock-data';
import { DEFAULT_VISIBILITY } from './layers';
import { toFlow } from './toFlow';
import { netEdgeId, netNodeId, routeSegmentId, siteNodeId, vehicleNodeId } from './ids';
import type { MapOverview } from '../../api/types';

function emptyOverview(): MapOverview {
  return { nodes: [], edges: [], sites: [], vehicles: [], tasks: [], routes: [], alerts: [], eventSeq: 0 };
}

describe('toFlow · 结构与顺序', () => {
  it('产出与 seed 一致的路网规模（12 节点 / 34 边 / 3 站点 / 3 车辆）', () => {
    const { nodes, edges } = toFlow(buildMockOverview());
    expect(nodes.filter((n) => n.type === 'net')).toHaveLength(12);
    expect(edges.filter((e) => e.type === 'net')).toHaveLength(34);
    expect(nodes.filter((n) => n.type === 'site')).toHaveLength(3);
    expect(nodes.filter((n) => n.type === 'vehicle')).toHaveLength(3);
  });

  it('路线高亮边排在基础路网边之后（后者在上，才能压住重叠路径）', () => {
    const { edges } = toFlow(buildMockOverview());
    const lastNet = edges.map((e) => e.type).lastIndexOf('net');
    const firstRoute = edges.map((e) => e.type).indexOf('route');
    expect(firstRoute).toBeGreaterThan(lastNet);
  });

  it('车辆节点排在最后（恒在最上层）', () => {
    const { nodes } = toFlow(buildMockOverview());
    const lastNonVehicle = nodes.map((n) => n.type).lastIndexOf('site');
    const firstVehicle = nodes.map((n) => n.type).indexOf('vehicle');
    expect(firstVehicle).toBeGreaterThan(lastNonVehicle);
  });

  it('节点与边 id 全局唯一', () => {
    const { nodes, edges } = toFlow(buildMockOverview());
    const ids = [...nodes.map((n) => n.id), ...edges.map((e) => e.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('toFlow · 路线分段', () => {
  it('nodeIds 长度为 n 时产出 n-1 条分段边，seq 递增', () => {
    const overview = emptyOverview();
    overview.nodes = [
      { id: 'a', code: 'A', x: 0, y: 0, status: 'enabled' },
      { id: 'b', code: 'B', x: 20, y: 0, status: 'enabled' },
      { id: 'c', code: 'C', x: 40, y: 0, status: 'enabled' }
    ];
    overview.routes = [{ id: 'r1', taskId: null, vehicleId: null, nodeIds: ['a', 'b', 'c'], status: 'active' }];
    const { edges } = toFlow(overview);
    const routeEdges = edges.filter((e) => e.type === 'route');
    expect(routeEdges).toHaveLength(2);
    expect(routeEdges.map((e) => e.id)).toEqual([routeSegmentId('r1', 0), routeSegmentId('r1', 1)]);
    expect(routeEdges[0]!.source).toBe(netNodeId('a'));
    expect(routeEdges[0]!.target).toBe(netNodeId('b'));
  });

  it('引用不存在的节点时跳过该段而不抛错（避免整张图白屏）', () => {
    const overview = emptyOverview();
    overview.nodes = [{ id: 'a', code: 'A', x: 0, y: 0, status: 'enabled' }];
    overview.routes = [{ id: 'r1', taskId: null, vehicleId: null, nodeIds: ['a', 'ghost'], status: 'active' }];
    expect(() => toFlow(overview)).not.toThrow();
    expect(toFlow(overview).edges).toHaveLength(0);
  });

  it('非 active 路线标记 superseded', () => {
    const overview = emptyOverview();
    overview.nodes = [
      { id: 'a', code: 'A', x: 0, y: 0, status: 'enabled' },
      { id: 'b', code: 'B', x: 20, y: 0, status: 'enabled' }
    ];
    overview.routes = [{ id: 'r1', taskId: null, vehicleId: null, nodeIds: ['a', 'b'], status: 'superseded' }];
    const route = toFlow(overview).edges.find((e) => e.type === 'route');
    expect(route?.data).toMatchObject({ superseded: true });
  });

  it('端点不存在的基础边被跳过', () => {
    const overview = emptyOverview();
    overview.nodes = [{ id: 'a', code: 'A', x: 0, y: 0, status: 'enabled' }];
    overview.edges = [{ id: 'e1', fromNodeId: 'a', toNodeId: 'ghost' }];
    const { edges } = toFlow(overview);
    expect(edges.find((e) => e.id === netEdgeId('e1'))).toBeUndefined();
  });
});

describe('toFlow · 图层开关', () => {
  it('关闭图层只置 hidden，元素数量不变（保住选中态与视口）', () => {
    const overview = buildMockOverview();
    const on = toFlow(overview, DEFAULT_VISIBILITY);
    const off = toFlow(overview, { ...DEFAULT_VISIBILITY, netNodes: false, netEdges: false });
    expect(off.nodes.filter((n) => n.type === 'net')).toHaveLength(12);
    expect(off.nodes.filter((n) => n.type === 'net').every((n) => n.hidden)).toBe(true);
    expect(off.edges.filter((e) => e.type === 'net').every((e) => e.hidden)).toBe(true);
    expect(off.nodes).toHaveLength(on.nodes.length);
    expect(off.edges).toHaveLength(on.edges.length);
  });

  it('车辆层不受图层开关影响（始终可见）', () => {
    const off = toFlow(buildMockOverview(), { ...DEFAULT_VISIBILITY, vehicles: false });
    expect(off.nodes.filter((n) => n.type === 'vehicle').every((n) => !n.hidden)).toBe(true);
  });
});

describe('toFlow · 坐标与数据缺失处理', () => {
  it('站点坐标缺失时回退到其绑定节点的坐标', () => {
    const overview = emptyOverview();
    overview.nodes = [{ id: 'n1', code: 'N1', x: 20, y: 40, status: 'enabled' }];
    overview.sites = [
      { id: 's1', code: 'S1', type: 'depot', nodeId: 'n1', x: Number.NaN, y: Number.NaN, status: 'enabled' }
    ];
    const site = toFlow(overview).nodes.find((n) => n.id === siteNodeId('s1'));
    expect(site?.position).toEqual({ x: 60, y: -120 });
  });

  it('站点既无坐标也无绑定节点时不上图（不伪造坐标）', () => {
    const overview = emptyOverview();
    overview.sites = [{ id: 's1', code: 'S1', type: 'depot', nodeId: null, x: Number.NaN, y: Number.NaN, status: 'enabled' }];
    expect(toFlow(overview).nodes.find((n) => n.id === siteNodeId('s1'))).toBeUndefined();
  });

  it('告警作为角标挂到对应实体，不新建节点', () => {
    const overview = buildMockOverview();
    const before = toFlow(overview).nodes.length;
    const withAlert: MapOverview = {
      ...overview,
      alerts: [{ id: 'al1', type: 'vehicle_offline', level: 'critical', objectType: 'vehicle', objectId: 'seed-veh-agv01' }]
    };
    const after = toFlow(withAlert);
    expect(after.nodes.filter((n) => n.id === vehicleNodeId('seed-veh-agv01'))[0]!.data).toMatchObject({ alerts: [{ id: 'al1' }] });
    // 数量不变：告警不产生新节点
    expect(after.nodes.length).toBe(before);
  });

  it('受控选中态回填到对应节点（刷新后不丢选中）', () => {
    const overview = buildMockOverview();
    const flowId = vehicleNodeId('seed-veh-agv01');
    const { nodes } = toFlow(overview, DEFAULT_VISIBILITY, { flowId });
    expect(nodes.filter((n) => n.selected)).toHaveLength(1);
    expect(nodes.find((n) => n.selected)?.id).toBe(flowId);
  });

  it('车辆实时位置覆盖快照坐标', () => {
    const overview = buildMockOverview();
    const { nodes } = toFlow(overview, DEFAULT_VISIBILITY, null, { 'seed-veh-agv01': { x: 100, y: 40 } });
    const vehicle = nodes.find((n) => n.id === vehicleNodeId('seed-veh-agv01'));
    expect(vehicle?.position).toEqual({ x: 300, y: -120 });
  });

  it('订单端点未匹配时不上图；已匹配则带置信度', () => {
    const overview = buildMockOverview();
    expect(toFlow(overview).nodes.filter((n) => n.type === 'orderEndpoint')).toHaveLength(0);
    const withOrder = toFlow({ ...overview, orderEndpoints: [{ orderId: 'o1', role: 'from', x: 20, y: 0, confidence: 0.6 }] });
    const node = withOrder.nodes.find((n) => n.type === 'orderEndpoint');
    expect(node?.data).toMatchObject({ entityId: 'o1', confidence: 0.6 });
  });
});

/**
 * MiniMap 回归护栏（实测事故）：
 * React Flow 的 `<MiniMap>` 只为「有尺寸」的节点画方块，判据是
 * `measured?.width ?? width ?? initialWidth` 全部有值。
 * 实测渲染完成后用户节点的 `measured` 仍未落位，缩略图于是**一个方块都不画**、
 * 只剩一个空框，且不报任何错。修复方式是给节点补 `initialWidth/initialHeight`。
 * 这里锁死「每个节点都带声明尺寸」，避免以后重构时又被静默去掉。
 */
describe('toFlow · 节点声明尺寸（MiniMap 依赖）', () => {
  it('每个节点都带 initialWidth/initialHeight，且各图层尺寸合理', () => {
    const { nodes } = toFlow(buildMockOverview());
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(node.initialWidth, `${String(node.id)} 缺少 initialWidth`).toBeGreaterThan(0);
      expect(node.initialHeight, `${String(node.id)} 缺少 initialHeight`).toBeGreaterThan(0);
    }
  });

  it('车辆节点比路网节点宽（与 CSS 尺寸一致，缩略图比例才不会失真）', () => {
    const { nodes } = toFlow(buildMockOverview());
    const vehicle = nodes.find((n) => n.type === 'vehicle')!;
    const net = nodes.find((n) => n.type === 'net')!;
    expect(vehicle.initialWidth!).toBeGreaterThan(net.initialWidth!);
    expect(vehicle.initialHeight!).toBeGreaterThan(net.initialHeight!);
  });

  it('不覆盖 width/height（避免与真实测量值冲突）', () => {
    const { nodes } = toFlow(buildMockOverview());
    for (const node of nodes) {
      expect(node.width).toBeUndefined();
      expect(node.height).toBeUndefined();
    }
  });
});
