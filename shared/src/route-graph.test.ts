import { describe, expect, it } from 'vitest';
import { buildRouteGraph, ROUTE_DEFAULT_SPEED_MPS, type RouteRestrictionInput } from './route-graph.js';

/**
 * 构图的用例。
 *
 * 构图是「规则形同虚设」唯一可能发生的地方（搜到一条已封的路、或算出一个错误的速度），
 * 而它的失败**不会报错** —— 只会给出一个错误的路线。因此这里逐条钉住三件事：
 * 剔除原因、速度换算、以及「端点被排除时边也必须排除」。
 */

const NODES = [
  { id: 'n1', x: 0, y: 0, status: 'enabled' as const },
  { id: 'n2', x: 20, y: 0, status: 'enabled' as const },
  { id: 'n3', x: 40, y: 0, status: 'disabled' as const }
];

const EDGES = [
  { id: 'e12', fromNodeId: 'n1', toNodeId: 'n2', lengthM: 20, speedLimitMps: null, status: 'enabled' as const },
  { id: 'e23', fromNodeId: 'n2', toNodeId: 'n3', lengthM: 20, speedLimitMps: null, status: 'enabled' as const },
  { id: 'e21', fromNodeId: 'n2', toNodeId: 'n1', lengthM: 20, speedLimitMps: null, status: 'disabled' as const }
];

const AT = '2026-09-26T10:00:00.000Z';

const rule = (over: Partial<RouteRestrictionInput>): RouteRestrictionInput => ({
  type: 'node',
  targetId: 'n2',
  startAt: null,
  endAt: null,
  vehicleType: null,
  status: 'active',
  ...over
});

const build = (restrictions: RouteRestrictionInput[] = [], vehicleType: 'agv' | 'carrier' | 'drone' = 'agv') =>
  buildRouteGraph({ nodes: NODES, edges: EDGES, restrictions, vehicleType, at: AT });

describe('route-graph · 排除规则', () => {
  it('主数据里禁用/停用的元素不进图，原因是 disabled', () => {
    const graph = build();
    expect(graph.nodes.map((item) => item.id)).toEqual(['n1', 'n2']);
    expect(graph.edges.map((item) => item.id)).toEqual(['e12']);
    expect(graph.excludedNodes['n3']).toBe('disabled');
    expect(graph.excludedEdges['e21']).toBe('disabled');
  });

  it('端点被排除时，边也一并排除（否则路线会指向一个图里没有的节点）', () => {
    const graph = build();
    // e23 自身是 enabled，但它连着被停用的 n3
    expect(graph.edges.some((item) => item.id === 'e23')).toBe(false);
    expect(graph.excludedEdges['e23']).toBeUndefined();
  });

  it('禁行规则封住的元素原因是 restricted（与「停用」区分开）', () => {
    const graph = build([rule({ targetId: 'n1' }), rule({ type: 'edge', targetId: 'e12' })]);
    expect(graph.excludedNodes['n1']).toBe('restricted');
    expect(graph.excludedEdges['e12']).toBe('restricted');
  });

  it('同一元素既被停用又被规则封住时，原因是 disabled（先记更可行动的那一个）', () => {
    const graph = build([rule({ targetId: 'n3' })]);
    expect(graph.excludedNodes['n3']).toBe('disabled');
  });
});

describe('route-graph · 禁行规则的三个生效条件', () => {
  it('status 不是 active 的规则不生效', () => {
    const graph = build([rule({ status: 'expired' })]);
    expect(graph.nodes.map((item) => item.id)).toContain('n2');
  });

  it('车种不匹配的规则不生效；vehicleType 为空表示不限车种', () => {
    const forDrone = build([rule({ vehicleType: 'drone' })], 'agv');
    expect(forDrone.nodes.map((item) => item.id)).toContain('n2');
    const forAgv = build([rule({ vehicleType: 'agv' })], 'agv');
    expect(forAgv.nodes.map((item) => item.id)).not.toContain('n2');
    const forAll = build([rule({ vehicleType: null })], 'drone');
    expect(forAll.nodes.map((item) => item.id)).not.toContain('n2');
  });

  it('时间窗是半开区间 [start, end)：边界上「结束瞬间」不再生效', () => {
    // 起点正好等于 at → 生效
    expect(build([rule({ startAt: AT })]).excludedNodes['n2']).toBe('restricted');
    // 起点晚于 at → 还没生效
    expect(build([rule({ startAt: '2026-09-26T11:00:00.000Z' })]).excludedNodes['n2']).toBeUndefined();
    // 终点等于 at → 已过期（半开区间）
    expect(build([rule({ endAt: AT })]).excludedNodes['n2']).toBeUndefined();
    // 终点晚于 at → 生效中
    expect(build([rule({ endAt: '2026-09-26T11:00:00.000Z' })]).excludedNodes['n2']).toBe('restricted');
  });
});

describe('route-graph · 速度换算', () => {
  it('没有单独限速的边按车种默认速度（AGV 1.5 / 配送车 3 / 无人机 5）', () => {
    expect(build([], 'agv').edges[0]!.speedMps).toBe(ROUTE_DEFAULT_SPEED_MPS.agv);
    expect(build([], 'carrier').edges[0]!.speedMps).toBe(ROUTE_DEFAULT_SPEED_MPS.carrier);
    expect(build([], 'drone').edges[0]!.speedMps).toBe(ROUTE_DEFAULT_SPEED_MPS.drone);
  });

  it('道路限速是上限：限速比车种速度快时按车种速度算', () => {
    // 无人机 5 m/s 跑限速 3 m/s 的路 → 3（路面限速更严）
    const graph = buildRouteGraph({
      nodes: NODES,
      edges: [{ ...EDGES[0]!, speedLimitMps: 3 }],
      restrictions: [],
      vehicleType: 'drone',
      at: AT
    });
    expect(graph.edges[0]!.speedMps).toBe(3);
    // AGV 1.5 m/s 跑限速 3 m/s 的路 → 1.5（车本身就慢）
    const slow = buildRouteGraph({
      nodes: NODES,
      edges: [{ ...EDGES[0]!, speedLimitMps: 3 }],
      restrictions: [],
      vehicleType: 'agv',
      at: AT
    });
    expect(slow.edges[0]!.speedMps).toBe(1.5);
  });

  it('maxSpeedMps / minSpeedMps 由**进图的边**决定（被排除的边不参与）', () => {
    const graph = buildRouteGraph({
      nodes: NODES,
      edges: [
        { ...EDGES[0]!, speedLimitMps: 1 },
        { ...EDGES[1]!, speedLimitMps: 99 } // 这条连着被停用的 n3，不该进图
      ],
      restrictions: [],
      vehicleType: 'carrier',
      at: AT
    });
    expect(graph.maxSpeedMps).toBe(1);
    expect(graph.minSpeedMps).toBe(1);
  });

  it('图为空时 maxSpeedMps / minSpeedMps 都是 0（不是 Infinity / NaN）', () => {
    const graph = buildRouteGraph({ nodes: NODES, edges: [], restrictions: [], vehicleType: 'agv', at: AT });
    expect(graph.maxSpeedMps).toBe(0);
    expect(graph.minSpeedMps).toBe(0);
  });
});
