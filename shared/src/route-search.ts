/**
 * 路径搜索内核（M5）：图模型 + A* + Dijkstra 基线 + 途经点拼接 + 警告。
 *
 * ## 为什么这个文件在 `shared/` 而不是 `desktop/src/algorithms/`
 *
 * `docs/module-M4-dispatch.md` §3 把算法层规划在 `desktop/src/algorithms/` 下，那一层
 * **只被主进程 import**。路径搜索不同：它同时被两个运行形态需要 ——
 *   - 主进程：从 SQLite 读节点/边/禁行规则构图；
 *   - 浏览器 Mock：从内存数组构图（`renderer/src/api/mock-route.ts`）。
 * 若把它放在 `desktop/`，渲染层就拿不到它，Mock 只能**照着抄一份** ——
 * 而两份实现不会同时改，分叉只在切换形态时显形（`D-27` 的 mock id 事故、`D-44` 的规则分叉，
 * 本项目已经为同一形态付过两次代价）。因此这里遵循 D-44 的分工：
 * **算法（纯函数）放 `shared`，存储各自**（主进程查 SQLite、Mock 查内存数组）。
 *
 * ## 这个文件是纯函数
 *
 * 不读时间、不碰数据库、不抛异常：失败返回 `{ ok: false, reason }`，由领域服务决定抛哪个
 * `DomainError`（与 `task-state.ts` / `base-rules.ts` 同一口径）。因此「不可达」在算法层
 * 是一个**返回值**而不是异常，能被上层区分成「图空 / 被禁行封住 / 两点不连通」四种原因。
 *
 * ## 三处容易写错的地方（都在这里钉死）
 *
 *   1. **通行时间用「边限速」而不是「车辆最高速」**：`speed_limit_mps` 是道路属性
 *      （园区里同一条路对不同车型都一样限速），车辆最高速只是它的**上限**。
 *      因此 `effective = min(edge.speedLimitMps ?? 车种默认速度, 车种默认速度)` ——
 *      漏掉 `min` 会让限速 1.0 m/s 的慢速段按 5 m/s 通过，路线耗时整体偏乐观；
 *   2. **A* 的启发式必须可采纳（admissible）**：用「欧氏直线距离 ÷ 全网最高速度」，
 *      它永远不会**高估**真实剩余时间（因为速度只可能更慢），所以 A* 的结果与 Dijkstra
 *      逐字段一致（这条性质由 `route-search.test.ts` 对随机图断言，不是靠推导）；
 *   3. **途经点是分段的，不是「顺路经过」**：`via` 必须按顺序逐段求解再拼接，
 *      拼接时**丢掉重复的接缝节点与边**。若把 via 当成一个「必须经过的集合」做单次搜索，
 *      顺序就丢了；若拼接时不去重，`nodeIds` 里会出现连续两个相同节点，
 *      渲染层画出的路线会多出一段零长度的边。
 */
import type { RouteAlgorithm, VehicleType } from './enums.js';

/** 图里的一个可用节点（禁用与被禁行的节点在构图时已剔除，因此这里没有 `status`）。 */
export interface RouteGraphNode {
  id: string;
  x: number;
  y: number;
}

/** 图里的一条可用有向边。`speedMps` 是**已换算好的通行速度**（见文件头第 1 条）。 */
export interface RouteGraphEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  lengthM: number;
  speedMps: number;
}

/** 节点/边被排除出可用图的两个原因 —— 两者的错误引导完全不同（见 `route.service.ts`）。 */
export type RouteExclusionReason = 'disabled' | 'restricted';

export interface RouteGraph {
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
  /**
   * 节点 id → 排除原因。
   *
   * 保留这张表是为了把三种「走不过去」区分开：**被禁行规则封住**（`GRAPH.BLOCKED`，
   * 使用者要做的是改规则或换时间）、**被停用**（`VALIDATION.FAILED`，去基础数据里启用）
   * 与**本来就不连通**（`ROUTE.NOT_FOUND_PATH`，路网规划问题）。只返回「找不到路」时，
   * 这三种情况的处置方式完全不同却报同一句话。
   */
  excludedNodes: Record<string, RouteExclusionReason>;
  excludedEdges: Record<string, RouteExclusionReason>;
  /** 图上任意一条边的最高速度（m/s）。用于 A* 启发式与「全网最低速段」判定。 */
  maxSpeedMps: number;
  /** 图上任意一条边的最低速度（m/s）；图为空时为 0。 */
  minSpeedMps: number;
}

/** 可达性失败的原因。**不含错误码** —— 码由领域服务映射（本文件不 import `errors.ts`）。 */
export type RouteFailureReason =
  | 'GRAPH_EMPTY'
  | 'GRAPH_DISCONNECTED'
  | 'BLOCKED'
  | 'NOT_FOUND_PATH'
  | 'VIA_UNREACHABLE';

export interface RouteFailure {
  ok: false;
  reason: RouteFailureReason;
  message: string;
  /** `reason === 'VIA_UNREACHABLE'` 时，逐段失败里「到不了的途经点」（按路径顺序）。 */
  unreachableVia?: string[];
  /** 前一段能走到的最后一个节点（`VIA_UNREACHABLE` 时用于定位「卡在哪」）。 */
  reachedNodeId?: string;
  /** 本次搜索展开的节点数：解释「为什么这条路线算得慢」时唯一的量化依据。 */
  visitedNodes: number;
}

/** 警告是**结构化**的：文案给界面看，`code` 给测试与后续筛选看（同 D-48 的口径）。 */
export type RouteWarningCode = 'slow_edge' | 'detour';

export interface RouteWarning {
  code: RouteWarningCode;
  message: string;
  detail: Record<string, unknown>;
}

export interface RouteSearchSuccess {
  ok: true;
  /** 起点 → … → 终点（含两端）；带途经点时是拼接去重后的完整序列。 */
  nodeIds: string[];
  /** `nodeIds.length - 1` 条边，顺序与 `nodeIds` 对齐（第 i 条连接第 i 与 i+1 个节点）。 */
  edgeIds: string[];
  distanceM: number;
  durationS: number;
  algorithm: RouteAlgorithm;
  warnings: RouteWarning[];
  visitedNodes: number;
}

export type RouteSearchResult = RouteSearchSuccess | RouteFailure;

export interface RouteSearchRequest {
  fromNodeId: string;
  toNodeId: string;
  /** 必须按顺序经过的节点（空数组 = 不限制）。 */
  viaNodeIds?: string[];
  algorithm: RouteAlgorithm;
  /**
   * 车种：只用于取「没有限速的边」的默认通行速度。
   *
   * 为什么必须有它：`edges.speed_limit_mps` 可空（园区里大多道路不单独设限速），
   * 缺省值只能按车种给 —— 少了它就只能写一个「所有车同一个速度」的默认值，
   * 而那会让 AGV（1.5 m/s）与无人机（5 m/s）算出同样的耗时。
   */
  vehicleType: VehicleType;
}

/**
 * 单条边的通行时间（秒）。
 *
 * `speedMps` 已由构图步骤算好（含 `min` 与车种默认值），这里只做除法；
 * 但仍然兜一个 `> 0` 的底线：速度为 0 会让耗时变成 `Infinity`，
 * 而 `Infinity` 一旦进入代价排序，表现是「这条路线永远排最后」而不是报错。
 */
function edgeDurationS(edge: RouteGraphEdge): number {
  return edge.speedMps > 0 ? edge.lengthM / edge.speedMps : Number.POSITIVE_INFINITY;
}

/** 邻接表：`fromNodeId` → 出边下标。构图时算一次，两次搜索共用。 */
function buildAdjacency(graph: RouteGraph): Map<string, number[]> {
  const adjacency = new Map<string, number[]>();
  graph.edges.forEach((edge, index) => {
    const bucket = adjacency.get(edge.fromNodeId);
    if (bucket) {
      bucket.push(index);
    } else {
      adjacency.set(edge.fromNodeId, [index]);
    }
  });
  return adjacency;
}

/** 节点坐标索引：启发式与「直线距离」都要用。 */
function buildNodeIndex(graph: RouteGraph): Map<string, RouteGraphNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function euclidean(a: RouteGraphNode, b: RouteGraphNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 最小二叉堆。
 *
 * 为什么不用「每次线性扫最小」：路网规模在演示形态下很小，但 `docs/module-M4-dispatch.md`
 * §7.2 把调度上限写成 50 任务 × 30 车辆，那意味着一次预览要跑上千次最短路 ——
 * 线性扫描会把复杂度乘上一个 O(n)，堆是这次唯一值得写的「小数据结构」。
 */
class MinHeap {
  private readonly items: Array<{ key: number; nodeId: string }> = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, nodeId: string): void {
    this.items.push({ key, nodeId });
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.items[parent]!.key <= this.items[child]!.key) {
        break;
      }
      [this.items[parent], this.items[child]] = [this.items[child]!, this.items[parent]!];
      child = parent;
    }
  }

  pop(): { key: number; nodeId: string } | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (!top || this.items.length === 0 || !last) {
      return top;
    }
    this.items[0] = last;
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < this.items.length && this.items[left]!.key < this.items[smallest]!.key) {
        smallest = left;
      }
      if (right < this.items.length && this.items[right]!.key < this.items[smallest]!.key) {
        smallest = right;
      }
      if (smallest === parent) {
        break;
      }
      [this.items[parent], this.items[smallest]] = [this.items[smallest]!, this.items[parent]!];
      parent = smallest;
    }
    return top;
  }
}

interface Segment {
  nodeIds: string[];
  edgeIds: string[];
  distanceM: number;
  durationS: number;
  visitedNodes: number;
}

/**
 * 单段最短路（A* 与 Dijkstra 共用一套框架）。
 *
 * 两者的差别**只有优先级**：Dijkstra 用已行时间，A* 再用启发式估计剩余时间。
 * 把「启发式为 0」当成 Dijkstra 时，两条路径的代码是同一份 ——
 * 若各写一份，`compare` 接口就永远只是在比两份代码，而不是在比两个算法。
 */
function searchSegment(
  graph: RouteGraph,
  adjacency: Map<string, number[]>,
  nodeIndex: Map<string, RouteGraphNode>,
  fromId: string,
  toId: string,
  algorithm: RouteAlgorithm
): Segment | null {
  if (fromId === toId) {
    // 起点即终点：空路线是**合法**结果（同一站点内的挪车没有意义，但接口不该因此报错）
    return { nodeIds: [fromId], edgeIds: [], distanceM: 0, durationS: 0, visitedNodes: 1 };
  }

  const dist = new Map<string, number>([[fromId, 0]]);
  const previousNode = new Map<string, string>();
  const previousEdge = new Map<string, string>();
  const settled = new Set<string>();
  const open = new MinHeap();
  let visitedNodes = 0;

  const heuristic = (nodeId: string): number => {
    if (algorithm !== 'aStar') {
      return 0;
    }
    const node = nodeIndex.get(nodeId);
    const target = nodeIndex.get(toId);
    // 欧氏距离 ÷ 全网最高速度：真实剩余时间只可能更大（速度只可能更慢），故不会高估
    return node && target && graph.maxSpeedMps > 0 ? euclidean(node, target) / graph.maxSpeedMps : 0;
  };

  open.push(heuristic(fromId), fromId);
  const best = new Map<string, number>([[fromId, 0]]);

  while (open.size > 0) {
    const top = open.pop()!;
    if (settled.has(top.nodeId)) {
      continue;
    }
    settled.add(top.nodeId);
    visitedNodes += 1;
    if (top.nodeId === toId) {
      break;
    }
    const cost = dist.get(top.nodeId) ?? Number.POSITIVE_INFINITY;
    for (const edgeIndex of adjacency.get(top.nodeId) ?? []) {
      const edge = graph.edges[edgeIndex]!;
      const next = cost + edgeDurationS(edge);
      if (next < (dist.get(edge.toNodeId) ?? Number.POSITIVE_INFINITY)) {
        dist.set(edge.toNodeId, next);
        previousNode.set(edge.toNodeId, top.nodeId);
        previousEdge.set(edge.toNodeId, edge.id);
        best.set(edge.toNodeId, next + heuristic(edge.toNodeId));
        open.push(next + heuristic(edge.toNodeId), edge.toNodeId);
      }
    }
  }

  if (!settled.has(toId)) {
    return null;
  }

  // 回溯：从终点沿 `previousNode` 往回走，再反转
  const nodeIds: string[] = [toId];
  const edgeIds: string[] = [];
  let cursor = toId;
  while (cursor !== fromId) {
    const prev = previousNode.get(cursor);
    const edge = previousEdge.get(cursor);
    if (!prev || !edge) {
      // 理论上不可达（settled 命中说明有前驱链）；防御性返回 null 而不是抛
      return null;
    }
    edgeIds.push(edge);
    nodeIds.push(prev);
    cursor = prev;
  }
  nodeIds.reverse();
  edgeIds.reverse();

  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  let distanceM = 0;
  let durationS = 0;
  for (const edgeId of edgeIds) {
    const edge = edgeById.get(edgeId);
    if (!edge) {
      return null;
    }
    distanceM += edge.lengthM;
    durationS += edgeDurationS(edge);
  }
  return { nodeIds, edgeIds, distanceM, durationS, visitedNodes };
}

/** 起终点直线距离 —— 「绕行」警告的基准（不含途经点，那是路径自身的形状）。 */
function straightLineM(graph: RouteGraph, fromId: string, toId: string): number {
  const index = buildNodeIndex(graph);
  const from = index.get(fromId);
  const to = index.get(toId);
  return from && to ? euclidean(from, to) : 0;
}

/** 里程超过直线距离这个倍数即提示绕行（阈值是展示口径，不是约束）。 */
export const ROUTE_DETOUR_WARN_RATIO = 2;

function buildWarnings(graph: RouteGraph, request: RouteSearchRequest, segment: Segment): RouteWarning[] {
  const warnings: RouteWarning[] = [];
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));

  // 1) 慢速段：路径里出现了全网最低速的边。它通常正是「这条路线为什么这么慢」的答案，
  //    而这个答案无法从总里程/总耗时看出来。
  //
  //    前提是**全网的速度确实有差异**（`max > min`）：所有路段一样快时，「最低速段」
  //    就是每一条边，提示会在每条路线上都出现 —— 而一条永远出现的提示等于没有提示
  //    （与 D-48「说得出来的名字都该来自唯一作者」同一类问题：无意义的信号会淹没有意义的）。
  const speedVaries = graph.maxSpeedMps > graph.minSpeedMps;
  for (const edgeId of segment.edgeIds) {
    const edge = edgeById.get(edgeId);
    if (speedVaries && edge && graph.minSpeedMps > 0 && edge.speedMps <= graph.minSpeedMps) {
      warnings.push({
        code: 'slow_edge',
        message: `途经边 ${edgeId} 限速 ${edge.speedMps} m/s，为全网最低速段`,
        detail: { edgeId, speedMps: edge.speedMps, graphMinSpeedMps: graph.minSpeedMps }
      });
      break;
    }
  }

  // 2) 绕行：里程远大于直线距离。用 `>=` 而不是 `>`：正好 2 倍已经值得提醒。
  const straight = straightLineM(graph, request.fromNodeId, request.toNodeId);
  if (straight > 0 && segment.distanceM >= straight * ROUTE_DETOUR_WARN_RATIO) {
    const ratio = Number((segment.distanceM / straight).toFixed(2));
    warnings.push({
      code: 'detour',
      message: `路线里程为起终点直线距离的 ${ratio} 倍，存在绕行`,
      detail: { distanceM: segment.distanceM, straightLineM: Number(straight.toFixed(2)), ratio }
    });
  }
  return warnings;
}

/**
 * 图里有没有这个节点（可用节点集合）。
 *
 * 单独导出：领域服务要先用它区分「节点不存在」（`NODE.NOT_FOUND`）与
 * 「节点被排除出可用图」（禁用 / 禁行），而这两个判断都需要看 `excludedNodes`。
 */
export function graphHasNode(graph: RouteGraph, nodeId: string): boolean {
  return graph.nodes.some((node) => node.id === nodeId);
}

/**
 * 路径规划主入口。
 *
 * 顺序：空图检查 → 端点可用性 → 逐段搜索（含 `via` 拼接）→ 警告。
 * 每一段的失败都带 `reachedNodeId`，用于回答「卡在哪一段」—— 只说「到不了」的
 * 拒绝信息在使用者看来等于没有信息。
 */
export function searchRoute(graph: RouteGraph, request: RouteSearchRequest): RouteSearchResult {
  if (graph.nodes.length === 0) {
    return {
      ok: false,
      reason: 'GRAPH_EMPTY',
      message: '路网中没有可用节点（全部被禁用或被禁行规则封住）',
      visitedNodes: 0
    };
  }
  if (graph.edges.length === 0) {
    return {
      ok: false,
      reason: 'GRAPH_DISCONNECTED',
      message: '路网中没有可用边（全部被禁用或被禁行规则封住）',
      visitedNodes: 0
    };
  }

  // `via` 里出现端点属于调用方的输入错误：拼接后会出现「起点 → 起点」这种零长度段，
  // 而它不算错、只是没有意义 —— 过滤掉比报错友好，且与「空路线合法」的口径一致。
  const via = (request.viaNodeIds ?? []).filter((id) => id !== request.fromNodeId && id !== request.toNodeId);
  const stops = [request.fromNodeId, ...via, request.toNodeId];

  const blockedStop = stops.find((id) => graph.excludedNodes[id] === 'restricted');
  if (blockedStop) {
    return {
      ok: false,
      reason: 'BLOCKED',
      message: `节点 ${blockedStop} 被禁行规则封住，无法作为起点 / 终点 / 途经点`,
      reachedNodeId: blockedStop,
      visitedNodes: 0
    };
  }

  const adjacency = buildAdjacency(graph);
  const nodeIndex = buildNodeIndex(graph);
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  let distanceM = 0;
  let durationS = 0;
  let visitedNodes = 0;

  for (let i = 0; i + 1 < stops.length; i += 1) {
    const from = stops[i]!;
    const to = stops[i + 1]!;
    const segment = searchSegment(graph, adjacency, nodeIndex, from, to, request.algorithm);
    if (!segment) {
      // 端点本身不在可用图里 → 不是「到不了」，而是「这个节点不可用」：分开报告
      const unusable = [from, to].find((id) => !graphHasNode(graph, id) && graph.excludedNodes[id] !== undefined);
      if (unusable) {
        return {
          ok: false,
          reason: 'BLOCKED',
          message: `节点 ${unusable} 当前不可用（${graph.excludedNodes[unusable] === 'disabled' ? '已停用' : '被禁行规则封住'}）`,
          reachedNodeId: unusable,
          visitedNodes
        };
      }
      return {
        ok: false,
        reason: i === 0 && from === request.fromNodeId && to === request.toNodeId ? 'NOT_FOUND_PATH' : 'VIA_UNREACHABLE',
        message:
          i === 0 && to === request.toNodeId
            ? `节点 ${from} 与 ${to} 之间不存在可行路径`
            : `无法从 ${from} 到达途经点 ${to}`,
        unreachableVia: to === request.toNodeId ? undefined : [to],
        reachedNodeId: from,
        visitedNodes
      };
    }
    visitedNodes += segment.visitedNodes;
    // 拼接：接缝处（上一段的终点 = 这一段的起点）只保留一份，因此跳过每段的第一个节点
    nodeIds.push(...(nodeIds.length === 0 ? segment.nodeIds : segment.nodeIds.slice(1)));
    edgeIds.push(...segment.edgeIds);
    distanceM += segment.distanceM;
    durationS += segment.durationS;
  }

  const merged: Segment = { nodeIds, edgeIds, distanceM, durationS, visitedNodes };
  return {
    ok: true,
    nodeIds,
    edgeIds,
    distanceM,
    durationS: Number(durationS.toFixed(3)),
    algorithm: request.algorithm,
    warnings: buildWarnings(graph, request, merged),
    visitedNodes
  };
}
