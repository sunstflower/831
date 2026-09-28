/**
 * 路线仓库（M5，`docs/api.md` §3.5.3）。
 *
 * ## 这个文件有两类读取，用途完全不同
 *
 *   1. **给规划用的全量输入**（`listGraphNodes` / `listGraphEdges` / `listRestrictionRules`）：
 *      返回的是 `shared/src/route-graph.ts` 定义的中立输入形状，**不返回列表 DTO**。
 *      规划需要的是整张图，而 `graph.repo.listNodes` 是分页列表接口 —— 拿它取图会
 *      只拿到第一页（默认 20 条），路线于是被静默规划在一张残缺的路网上。
 *   2. **给查询用的单条路线**（`findRouteById`）：落库路线只在 apply / 调度过程中产生，
 *      因此这里没有 `listRoutes` —— 契约里也没有路线列表接口（§3.5.3 只有详情）。
 *
 * ## 为什么 JSON 列读取一律兜底
 *
 * `via_node_ids` / `node_ids` / `edge_ids` / `cost_detail` / `warnings` 都是 TEXT 存 JSON。
 * 坏 JSON 说明数据被外部改过，但**让详情接口 500 只会更难排查**：返回空数组 + 其余字段
 * 照常展示，使用者至少能看到「这条路线存在、但它的节点列表读不出来」。
 * 这与 `task.repo.ts` 对 `node_ids` 的处理一致。
 */
import type { RouteDetail, RouteEdgeInput, RouteNodeInput, RouteRestrictionInput } from '@udm/shared';
import { all, get, run, type Db } from '../index.js';

interface RouteRow {
  id: string;
  task_id: string | null;
  algorithm: string;
  from_node_id: string;
  to_node_id: string;
  via_node_ids: string;
  node_ids: string;
  edge_ids: string;
  distance_m: number;
  duration_s: number;
  cost_detail: string;
  warnings: string;
  created_at: string;
  created_by: string | null;
}

function parseJsonArray(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toRouteDetail(row: RouteRow): RouteDetail {
  return {
    id: row.id,
    taskId: row.task_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    viaNodeIds: parseJsonArray(row.via_node_ids),
    nodeIds: parseJsonArray(row.node_ids),
    edgeIds: parseJsonArray(row.edge_ids),
    distanceM: row.distance_m,
    durationS: row.duration_s,
    algorithm: row.algorithm,
    costDetail: parseJsonObject(row.cost_detail) as RouteDetail['costDetail'],
    warnings: parseJsonArray(row.warnings),
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

export function findRouteById(db: Db, id: string): RouteDetail | undefined {
  const row = get<RouteRow>(db, 'SELECT * FROM routes WHERE id = ?', [id]);
  return row ? toRouteDetail(row) : undefined;
}

export interface RouteWriteRow {
  id: string;
  taskId: string | null;
  algorithm: string;
  fromNodeId: string;
  toNodeId: string;
  viaNodeIds: string[];
  nodeIds: string[];
  edgeIds: string[];
  distanceM: number;
  durationS: number;
  costDetail: Record<string, unknown>;
  warnings: string[];
  createdAt: string;
  createdBy: string | null;
}

export function insertRoute(db: Db, row: RouteWriteRow): void {
  run(
    db,
    `INSERT INTO routes (id, task_id, algorithm, from_node_id, to_node_id, via_node_ids,
                         node_ids, edge_ids, distance_m, duration_s, cost_detail, warnings,
                         created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.taskId,
      row.algorithm,
      row.fromNodeId,
      row.toNodeId,
      JSON.stringify(row.viaNodeIds),
      JSON.stringify(row.nodeIds),
      JSON.stringify(row.edgeIds),
      row.distanceM,
      row.durationS,
      JSON.stringify(row.costDetail),
      JSON.stringify(row.warnings),
      row.createdAt,
      row.createdBy
    ]
  );
}

/* ==================== 规划输入：全量图（不是分页列表） ==================== */

interface GraphNodeRow {
  id: string;
  x: number;
  y: number;
  status: RouteNodeInput['status'];
}

interface GraphEdgeRow {
  id: string;
  from_node_id: string;
  to_node_id: string;
  length_m: number;
  speed_limit_mps: number | null;
  status: RouteEdgeInput['status'];
}

interface RestrictionRuleRow {
  type: RouteRestrictionInput['type'];
  target_id: string;
  start_at: string | null;
  end_at: string | null;
  vehicle_type: RouteRestrictionInput['vehicleType'];
  status: RouteRestrictionInput['status'];
}

/**
 * 全部节点（**含禁用**）。
 *
 * 禁用节点也要返回：它必须作为「被排除」进入构图，而不是从输入里消失 ——
 * 否则搜索会给出「经停一个已停用节点」的路线（`route-graph.ts` 的注释里说明了这条）。
 * `ORDER BY id` 让构图结果可复现（同一次输入必得同一张图，便于把差异归因到数据而不是顺序）。
 */
export function listGraphNodes(db: Db): RouteNodeInput[] {
  return all<GraphNodeRow>(db, 'SELECT id, x, y, status FROM nodes ORDER BY id ASC').map((row) => ({
    id: row.id,
    x: row.x,
    y: row.y,
    status: row.status
  }));
}

export function listGraphEdges(db: Db): RouteEdgeInput[] {
  return all<GraphEdgeRow>(
    db,
    'SELECT id, from_node_id, to_node_id, length_m, speed_limit_mps, status FROM edges ORDER BY id ASC'
  ).map((row) => ({
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    lengthM: row.length_m,
    speedLimitMps: row.speed_limit_mps,
    status: row.status
  }));
}

/**
 * 全部禁行规则（**含过期 / 已停用**）。
 *
 * 与节点同理：`expired` 由 `buildRouteGraph` 判掉，而不是在这里过滤 ——
 * 「为什么这条规则没生效」的答案应该只有一处（构图时的时间窗判定），
 * 两处都过滤会让「规则没生效」既可能是状态问题、也可能是读取层漏了它。
 */
export function listRestrictionRules(db: Db): RouteRestrictionInput[] {
  return all<RestrictionRuleRow>(
    db,
    'SELECT type, target_id, start_at, end_at, vehicle_type, status FROM restrictions ORDER BY created_at ASC, id ASC'
  ).map((row) => ({
    type: row.type,
    targetId: row.target_id,
    startAt: row.start_at,
    endAt: row.end_at,
    vehicleType: row.vehicle_type,
    status: row.status
  }));
}
