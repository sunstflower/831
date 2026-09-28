/**
 * 构图（M5）：把「节点 / 有向边 / 禁行规则」三份原始数据 + 一个车种，
 * 折算成 `route-search.ts` 能直接搜索的**可用图**。
 *
 * ## 为什么构图与搜索分成两个文件
 *
 * 因为它们的**输入形态不同、复用方也不同**：
 *   - 构图关心「哪些元素不该进图」（禁用 / 禁行 / 时间窗 / 车种），
 *     主进程传 DB 行、Mock 传内存数组，两者字段名不同但语义相同 ——
 *     因此这里定义的是 `RouteNodeInput` 这类**中立输入**，而不是 DB 行类型；
 *   - 搜索只关心「图长什么样」，对来源一无所知。
 * 合在一起写会让「为什么这条边不在图里」和「哪条路最短」混在一段代码里，
 * 而前者恰恰是最需要单独断言的部分（`RouteGraph.excludedNodes` 的可解释性）。
 *
 * ## 禁行规则的三层判定（缺一层就会出现「规则形同虚设」）
 *
 *   1. **状态**：只有 `active` 生效（`expired` 是使用者主动置的历史规则）；
 *   2. **车种**：`vehicleType` 为空表示不限车种；
 *   3. **时间窗**：`startAt` / `endAt` 都是可空的半开区间 `[start, end)`；
 *      只给一端表示「某时刻之后 / 之前」。
 *
 * ⚠️ 时间窗用**服务端传入的 `at`** 而不是 `new Date()`：同一批调度里所有候选车辆
 * 必须用**同一个时刻**判规则，否则同一辆车先评估与后评估可能落在窗口的两侧，
 * 结果无法复核（`docs/module-M4-dispatch.md` §6 第 1 条对 `now` 有同样的要求）。
 */
import type { VehicleType } from './enums.js';

/** 中立输入：主进程从 SQLite 行映射、Mock 从内存对象映射（字段名不同、语义相同）。 */
export interface RouteNodeInput {
  id: string;
  x: number;
  y: number;
  status: 'enabled' | 'disabled';
}

export interface RouteEdgeInput {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  lengthM: number;
  /** 道路限速（可空 = 该路段不单独设限速，按车种默认速度计）。 */
  speedLimitMps: number | null;
  status: 'enabled' | 'disabled';
}

export interface RouteRestrictionInput {
  type: 'node' | 'edge';
  targetId: string;
  startAt: string | null;
  endAt: string | null;
  vehicleType: VehicleType | null;
  status: 'active' | 'expired';
}

/**
 * 车种默认通行速度（m/s）——用于**没有单独限速的边**。
 *
 * 取值与 `desktop/src/db/seed.ts` 的车辆 `max_speed_mps` 一致（AGV 1.5 / 配送车 3 / 无人机 5）。
 * 为什么按车种而不是取一个统一值：统一值会让 AGV 与无人机算出同样的耗时，
 * 而「哪个车种适合跑这条线」正是路径规划要回答的问题之一。
 * `other` 取最保守的 1.5：未知车种按最慢估，宁可提示资源紧张，也不要给出乐观到做不到的承诺。
 */
export const ROUTE_DEFAULT_SPEED_MPS: Record<VehicleType, number> = {
  agv: 1.5,
  carrier: 3,
  drone: 5,
  other: 1.5
};

export interface BuildRouteGraphInput {
  nodes: RouteNodeInput[];
  edges: RouteEdgeInput[];
  restrictions: RouteRestrictionInput[];
  vehicleType: VehicleType;
  /** 判定时间窗用的时刻（ISO 8601，字符串比较即时间序）。 */
  at: string;
}

/** 规则是否在 `at` 时刻、对本车种生效。 */
function restrictionApplies(restriction: RouteRestrictionInput, vehicleType: VehicleType, at: string): boolean {
  if (restriction.status !== 'active') {
    return false;
  }
  if (restriction.vehicleType !== null && restriction.vehicleType !== vehicleType) {
    return false;
  }
  if (restriction.startAt !== null && restriction.startAt > at) {
    return false;
  }
  if (restriction.endAt !== null && restriction.endAt <= at) {
    return false;
  }
  return true;
}

export function buildRouteGraph(input: BuildRouteGraphInput): import('./route-search.js').RouteGraph {
  const speedMps = ROUTE_DEFAULT_SPEED_MPS[input.vehicleType];
  const excludedNodes: Record<string, 'disabled' | 'restricted'> = {};
  const excludedEdges: Record<string, 'disabled' | 'restricted'> = {};

  // 1) 主数据层：禁用优先记原因是「已停用」——它是使用者在基础数据页能做主的那个事实
  for (const node of input.nodes) {
    if (node.status === 'disabled') {
      excludedNodes[node.id] = 'disabled';
    }
  }
  for (const edge of input.edges) {
    if (edge.status === 'disabled') {
      excludedEdges[edge.id] = 'disabled';
    }
  }

  // 2) 规则层：只补「还没被主数据排除」的元素，避免把两个原因叠成一个（先到的原因更可行动）
  for (const restriction of input.restrictions) {
    if (!restrictionApplies(restriction, input.vehicleType, input.at)) {
      continue;
    }
    if (restriction.type === 'node') {
      excludedNodes[restriction.targetId] ??= 'restricted';
    } else {
      excludedEdges[restriction.targetId] ??= 'restricted';
    }
  }

  const nodes = input.nodes
    .filter((node) => excludedNodes[node.id] === undefined)
    .map((node) => ({ id: node.id, x: node.x, y: node.y }));

  const available = new Set(nodes.map((node) => node.id));
  const edges = input.edges
    .filter((edge) => excludedEdges[edge.id] === undefined)
    // 端点被排除的边也必须排除：否则搜索会「经停一个已停用的节点」——
    // 图里没有那个节点，但边还在邻接表里，路线会指向一个不存在的节点
    .filter((edge) => available.has(edge.fromNodeId) && available.has(edge.toNodeId))
    .map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      lengthM: edge.lengthM,
      // 道路限速是**上限**，车种速度也是 —— 取小值。漏掉 min 会让慢速车按道路限速通过
      speedMps: Math.min(edge.speedLimitMps ?? speedMps, speedMps)
    }));

  const speeds = edges.map((edge) => edge.speedMps).filter((value) => value > 0);
  return {
    nodes,
    edges,
    excludedNodes,
    excludedEdges,
    maxSpeedMps: speeds.length > 0 ? Math.max(...speeds) : 0,
    minSpeedMps: speeds.length > 0 ? Math.min(...speeds) : 0
  };
}
