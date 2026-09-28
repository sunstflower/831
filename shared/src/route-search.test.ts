import { describe, expect, it } from 'vitest';
import { buildRouteGraph, ROUTE_DEFAULT_SPEED_MPS, type RouteEdgeInput, type RouteNodeInput } from './route-graph.js';
import { searchRoute, type RouteGraph, type RouteSearchRequest } from './route-search.js';

/**
 * 路径搜索内核的用例。
 *
 * 三条最重要的断言不是「某条路线对不对」，而是**性质**：
 *   1. A* 与 Dijkstra 在**随机图**上逐字段一致（启发式可采纳性的可执行证明）；
 *   2. 途经点是**有序**的（顺序不同的 via 必须给出不同的结果）；
 *   3. 三种「走不过去」返回**不同的 reason**（否则上层只能报同一句话）。
 * 单点用例容易被「恰好写对一条路」蒙过，性质用例不会。
 */

/** 确定性伪随机（LCG）：用例必须可复现，`Math.random` 会让失败无法重放。 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function node(id: string, x: number, y: number, status: 'enabled' | 'disabled' = 'enabled'): RouteNodeInput {
  return { id, x, y, status };
}

function edge(
  id: string,
  fromNodeId: string,
  toNodeId: string,
  lengthM: number,
  speedLimitMps: number | null = null,
  status: 'enabled' | 'disabled' = 'enabled'
): RouteEdgeInput {
  return { id, fromNodeId, toNodeId, lengthM, speedLimitMps, status };
}

/** 用构图层搭一个图（比手写 `RouteGraph` 更接近真实调用点，顺带覆盖构图逻辑）。 */
function graphOf(nodes: RouteNodeInput[], edges: RouteEdgeInput[], vehicleType: 'agv' | 'carrier' | 'drone' = 'agv'): RouteGraph {
  return buildRouteGraph({ nodes, edges, restrictions: [], vehicleType, at: '2026-09-26T10:00:00.000Z' });
}

const request = (over: Partial<RouteSearchRequest> = {}): RouteSearchRequest => ({
  fromNodeId: 'n1',
  toNodeId: 'n4',
  viaNodeIds: [],
  algorithm: 'aStar',
  vehicleType: 'agv',
  ...over
});

/**
 * 一个 3×2 的格子 + 一条「斜边」，边长按格子步长 20 m。
 *
 *   n1 -- n2 -- n3
 *   |     |     |
 *   n4 -- n5 -- n6
 */
function gridNodes(): RouteNodeInput[] {
  return [
    node('n1', 0, 0),
    node('n2', 20, 0),
    node('n3', 40, 0),
    node('n4', 0, 20),
    node('n5', 20, 20),
    node('n6', 40, 20)
  ];
}

function gridEdges(): RouteEdgeInput[] {
  return [
    // 双向：每条路两个方向各一条有向边（路网模型就是有向的）
    edge('e12', 'n1', 'n2', 20),
    edge('e21', 'n2', 'n1', 20),
    edge('e23', 'n2', 'n3', 20),
    edge('e32', 'n3', 'n2', 20),
    edge('e14', 'n1', 'n4', 20),
    edge('e41', 'n4', 'n1', 20),
    edge('e25', 'n2', 'n5', 20),
    edge('e52', 'n5', 'n2', 20),
    edge('e36', 'n3', 'n6', 20),
    edge('e63', 'n6', 'n3', 20),
    edge('e45', 'n4', 'n5', 20),
    edge('e54', 'n5', 'n4', 20),
    edge('e56', 'n5', 'n6', 20),
    edge('e65', 'n6', 'n5', 20)
  ];
}

describe('route-search · 最短路', () => {
  it('两点之间取最短的一条（n1 → n3 走上方 2 段，而不是绕下方 4 段）', () => {
    const result = searchRoute(graphOf(gridNodes(), gridEdges()), request({ toNodeId: 'n3' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodeIds).toEqual(['n1', 'n2', 'n3']);
    expect(result.edgeIds).toEqual(['e12', 'e23']);
    expect(result.distanceM).toBe(40);
  });

  it('通行时间 = 里程 ÷ 车种速度；车种变了耗时跟着变（不是写死的常量）', () => {
    const agv = searchRoute(graphOf(gridNodes(), gridEdges(), 'agv'), request({ toNodeId: 'n3' }));
    const drone = searchRoute(graphOf(gridNodes(), gridEdges(), 'drone'), request({ toNodeId: 'n3' }));
    expect(agv.ok && drone.ok).toBe(true);
    if (!agv.ok || !drone.ok) return;
    expect(agv.durationS).toBeCloseTo(40 / ROUTE_DEFAULT_SPEED_MPS.agv, 3);
    expect(drone.durationS).toBeCloseTo(40 / ROUTE_DEFAULT_SPEED_MPS.drone, 3);
    expect(drone.durationS).toBeLessThan(agv.durationS);
  });

  it('道路限速是上限：慢速段的实际速度取「限速与车种速度的较小者」', () => {
    // e12 限速 0.5 m/s，AGV 默认 1.5 —— 实际按 0.5 算
    const edges = gridEdges().map((item) => (item.id === 'e12' ? { ...item, speedLimitMps: 0.5 } : item));
    const result = searchRoute(graphOf(gridNodes(), edges), request({ toNodeId: 'n2' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.durationS).toBeCloseTo(20 / 0.5, 3);
  });

  it('起点即终点：返回单节点空路线，而不是报「找不到路」', () => {
    const result = searchRoute(graphOf(gridNodes(), gridEdges()), request({ fromNodeId: 'n2', toNodeId: 'n2' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodeIds).toEqual(['n2']);
    expect(result.edgeIds).toEqual([]);
    expect(result.distanceM).toBe(0);
  });

  it('有向图：反向不可达时如实返回失败（不会「顺手当作无向」）', () => {
    // 只有 n1 → n2 一条边，没有 n2 → n1
    const graph = graphOf([node('n1', 0, 0), node('n2', 20, 0)], [edge('e12', 'n1', 'n2', 20)]);
    expect(searchRoute(graph, request({ fromNodeId: 'n1', toNodeId: 'n2' })).ok).toBe(true);
    const back = searchRoute(graph, request({ fromNodeId: 'n2', toNodeId: 'n1' }));
    expect(back.ok).toBe(false);
    if (back.ok) return;
    expect(back.reason).toBe('NOT_FOUND_PATH');
  });
});

describe('route-search · A* 与 Dijkstra 一致（启发式可采纳）', () => {
  it('随机图上两种算法的 nodeIds / edgeIds / distanceM 逐字段相同', () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const random = lcg(seed * 7919);
      const size = 6 + Math.floor(random() * 5);
      const nodes: RouteNodeInput[] = Array.from({ length: size }, (_, index) =>
        node(`n${index}`, Math.round(random() * 100), Math.round(random() * 100))
      );
      const edges: RouteEdgeInput[] = [];
      for (let i = 0; i < size; i += 1) {
        for (let j = 0; j < size; j += 1) {
          if (i === j || random() > 0.34) continue;
          const length = Math.max(1, Math.round(Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y)));
          // 限速随机可空，保证两条路径都要处理 `speedLimitMps === null` 的分支
          edges.push(edge(`e${i}_${j}`, `n${i}`, `n${j}`, length, random() > 0.6 ? 1 + random() * 4 : null));
        }
      }
      const graph = graphOf(nodes, edges);
      for (let pair = 0; pair < 6; pair += 1) {
        const from = `n${Math.floor(random() * size)}`;
        const to = `n${Math.floor(random() * size)}`;
        const a = searchRoute(graph, request({ fromNodeId: from, toNodeId: to, algorithm: 'aStar' }));
        const d = searchRoute(graph, request({ fromNodeId: from, toNodeId: to, algorithm: 'dijkstra' }));
        expect(a.ok, `seed=${seed} ${from}→${to}`).toBe(d.ok);
        if (!a.ok || !d.ok) continue;
        expect(a.nodeIds, `seed=${seed} ${from}→${to}`).toEqual(d.nodeIds);
        expect(a.edgeIds).toEqual(d.edgeIds);
        expect(a.distanceM).toBeCloseTo(d.distanceM, 6);
        expect(a.durationS).toBeCloseTo(d.durationS, 6);
        // A* 展开的节点数不该多于 Dijkstra（启发式没起作用时最多持平）
        expect(a.visitedNodes).toBeLessThanOrEqual(d.visitedNodes);
      }
    }
  });
});

describe('route-search · 途经点', () => {
  it('途经点必须按顺序经过：n1 →(via n5)→ n3 不会走更短的 n1-n2-n3', () => {
    const graph = graphOf(gridNodes(), gridEdges());
    const direct = searchRoute(graph, request({ toNodeId: 'n3' }));
    const via = searchRoute(graph, request({ toNodeId: 'n3', viaNodeIds: ['n5'] }));
    expect(direct.ok && via.ok).toBe(true);
    if (!direct.ok || !via.ok) return;
    // 断言的是**性质**而不是某一条具体路线：n1-n5 与 n5-n3 各有两条等长走法
    // （经 n2 或经 n4/n6，都是 80 m），选哪条由边表顺序决定 —— 把具体路线写死
    // 会变成「锁住一个任意选择」，换个插入顺序就红，而产品其实没错。
    expect(via.nodeIds).toContain('n5');
    expect(via.nodeIds.indexOf('n5')).toBeGreaterThan(0);
    expect(via.nodeIds.indexOf('n5')).toBeLessThan(via.nodeIds.length - 1);
    expect(via.nodeIds).not.toEqual(direct.nodeIds);
    expect(via.distanceM).toBeGreaterThan(direct.distanceM);
  });

  it('顺序不同的途经点给出不同结果（via 是序列而不是集合）', () => {
    const graph = graphOf(gridNodes(), gridEdges());
    const ab = searchRoute(graph, request({ fromNodeId: 'n1', toNodeId: 'n6', viaNodeIds: ['n2', 'n5'] }));
    const ba = searchRoute(graph, request({ fromNodeId: 'n1', toNodeId: 'n6', viaNodeIds: ['n5', 'n2'] }));
    expect(ab.ok && ba.ok).toBe(true);
    if (!ab.ok || !ba.ok) return;
    expect(ab.nodeIds).not.toEqual(ba.nodeIds);
  });

  it('拼接处不重复：路线里没有连续两个相同节点（否则渲染会多出一段零长度边）', () => {
    const graph = graphOf(gridNodes(), gridEdges());
    const result = searchRoute(graph, request({ fromNodeId: 'n1', toNodeId: 'n6', viaNodeIds: ['n2', 'n5'] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (let i = 1; i < result.nodeIds.length; i += 1) {
      expect(result.nodeIds[i]).not.toBe(result.nodeIds[i - 1]);
    }
    expect(result.edgeIds).toHaveLength(result.nodeIds.length - 1);
  });

  it('via 里出现起点或终点时被忽略（等价于不传，不算错）', () => {
    const graph = graphOf(gridNodes(), gridEdges());
    const plain = searchRoute(graph, request({ toNodeId: 'n3' }));
    const noisy = searchRoute(graph, request({ toNodeId: 'n3', viaNodeIds: ['n1', 'n3'] }));
    expect(plain.ok && noisy.ok).toBe(true);
    if (!plain.ok || !noisy.ok) return;
    expect(noisy.nodeIds).toEqual(plain.nodeIds);
  });

  it('某个途经点不可达时给出 VIA_UNREACHABLE 与具体的那个途经点', () => {
    // n9 是个孤岛（没有任何边）—— 注意别用网格里已有的节点，那样它有路可达
    const graph = graphOf([...gridNodes(), node('n9', 500, 500)], gridEdges());
    const result = searchRoute(graph, request({ fromNodeId: 'n1', toNodeId: 'n4', viaNodeIds: ['n9'] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('VIA_UNREACHABLE');
    expect(result.unreachableVia).toEqual(['n9']);
  });
});

describe('route-search · 三种「走不过去」必须可区分', () => {
  it('图里没有可用节点 → GRAPH_EMPTY', () => {
    const graph = graphOf([node('n1', 0, 0, 'disabled')], [edge('e12', 'n1', 'n2', 10)]);
    const result = searchRoute(graph, request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('GRAPH_EMPTY');
  });

  it('有节点但没有可用边 → GRAPH_DISCONNECTED（与「两点不连通」不是一回事）', () => {
    const graph = graphOf([node('n1', 0, 0), node('n2', 10, 0)], [edge('e12', 'n1', 'n2', 10, null, 'disabled')]);
    const result = searchRoute(graph, request({ fromNodeId: 'n1', toNodeId: 'n2' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('GRAPH_DISCONNECTED');
  });

  it('端点被禁行规则封住 → BLOCKED（提示去改规则，而不是「找不到路」）', () => {
    const graph = buildRouteGraph({
      nodes: gridNodes(),
      edges: gridEdges(),
      restrictions: [{ type: 'node', targetId: 'n4', startAt: null, endAt: null, vehicleType: null, status: 'active' }],
      vehicleType: 'agv',
      at: '2026-09-26T10:00:00.000Z'
    });
    const result = searchRoute(graph, request({ fromNodeId: 'n4', toNodeId: 'n3' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('BLOCKED');
    expect(result.message).toContain('n4');
  });

  it('同一个图里另找一条路能绕开封住的节点（BLOCKED 只针对端点）', () => {
    const graph = buildRouteGraph({
      nodes: gridNodes(),
      edges: gridEdges(),
      restrictions: [{ type: 'node', targetId: 'n2', startAt: null, endAt: null, vehicleType: null, status: 'active' }],
      vehicleType: 'agv',
      at: '2026-09-26T10:00:00.000Z'
    });
    const result = searchRoute(graph, request({ fromNodeId: 'n1', toNodeId: 'n3' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodeIds).not.toContain('n2');
    expect(result.nodeIds).toEqual(['n1', 'n4', 'n5', 'n6', 'n3']);
  });

  it('两点在不同连通块 → NOT_FOUND_PATH', () => {
    const graph = graphOf(
      [node('n1', 0, 0), node('n2', 10, 0), node('n3', 100, 0), node('n4', 110, 0)],
      [edge('e12', 'n1', 'n2', 10), edge('e34', 'n3', 'n4', 10)]
    );
    const result = searchRoute(graph, request({ fromNodeId: 'n1', toNodeId: 'n4' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('NOT_FOUND_PATH');
  });
});

describe('route-search · 警告', () => {
  it('路径包含全网最低速段时提示慢速段（并带上具体数值）', () => {
    const edges = gridEdges().map((item) => (item.id === 'e12' ? { ...item, speedLimitMps: 0.5 } : item));
    const result = searchRoute(graphOf(gridNodes(), edges), request({ toNodeId: 'n3' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const warning = result.warnings.find((item) => item.code === 'slow_edge');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('0.5');
  });

  it('里程远超直线距离时提示绕行', () => {
    // n1 与 n2 只有 10 m 直线距离，但必须绕经 n3/n4 走 90 m
    const graph = graphOf(
      [node('n1', 0, 0), node('n2', 10, 0), node('n3', 0, 50), node('n4', 10, 50)],
      [
        edge('a', 'n1', 'n3', 50),
        edge('b', 'n3', 'n4', 20),
        edge('c', 'n4', 'n2', 50)
      ]
    );
    const result = searchRoute(graph, request({ fromNodeId: 'n1', toNodeId: 'n2', vehicleType: 'agv' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((item) => item.code === 'detour')).toBe(true);
  });

  it('理想路线不产生警告（避免「总是有一条提示」而让人忽略它）', () => {
    const result = searchRoute(graphOf(gridNodes(), gridEdges()), request({ toNodeId: 'n2' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });
});
