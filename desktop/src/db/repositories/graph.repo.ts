/**
 * 路网读取仓库（M2，`GET /api/nodes` / `GET /api/edges`）。
 *
 * ## 边的业务 `code` 是**推导**出来的，不是查出来的
 *
 * 契约（`docs/api.md` §3.2.4）要求边记录里含 `code`，但 `edges` 表**还没有这一列** ——
 * 它会随迁移 `0002_data_import.sql` 一起加上（`AGENTS.md` D-35，**待评审**）。
 * 按 D-25 的原则（派生字段在读取层算，不冗余落库），本层用 `deriveEdgeCode` 现场推导。
 *
 * **命名规则只写在 `@udm/shared` 的 `edge-code.ts` 一处**：主进程与浏览器 Mock 用的是
 * 同一个函数，SQL 里**不含**任何拼 code 的表达式 —— 否则两边会「形状相同、内容不同」，
 * 而那正是一次真实事故的形态（D-27）。SQL 只负责：
 *   - 把两端节点 `code` 查出来（供 JS 推导）；
 *   - 把「按 code 查」**翻译**成「两端节点 code 等于哪两个值」（`parseEdgeCode`）。
 *
 * 与 `edges.code` 列落地后的差异：届时本文件改为直接读列，`parseEdgeCode` 的翻译不再需要。
 */
import { deriveEdgeCode, parseEdgeCode, type EdgeListItem, type EdgeStatus, type NodeListItem } from '@udm/shared';
import { all, get, run, type Db, type SqlParam } from '../index.js';

/**
 * 边的通用查询。两次 join 节点表以拿到两端 code。
 *
 * 不写子查询：子查询每行都要再查一次，且没法把两端 code 拿到 JS 侧推导。
 */
const EDGE_SELECT = `SELECT e.id, e.from_node_id, e.to_node_id, e.length_m, e.speed_limit_mps, e.weight,
       e.status, e.remark, f.code AS from_node_code, t.code AS to_node_code
  FROM edges e
  JOIN nodes f ON f.id = e.from_node_id
  JOIN nodes t ON t.id = e.to_node_id`;

/**
 * 边的排序：按「两端 code 的有序对」分组，同一对的两个方向相邻，再按 id 定序。
 *
 * 为什么不直接按推导出的 code 排序：那需要 SQL 再实现一遍命名规则（本文件刻意避免）。
 * 代价是极端情况下（两端 code 长度不同，如 `N2` 与 `N10`）显示顺序与按字符串排序略有差异 ——
 * 这里要的是**稳定**（分页不重复不漏行）与**成对相邻**（一眼能看到双向边），不是字符串序。
 */
const EDGE_ORDER = 'ORDER BY MIN(f.code, t.code) ASC, MAX(f.code, t.code) ASC, e.id ASC';

interface EdgeRow {
  id: string;
  from_node_id: string;
  to_node_id: string;
  from_node_code: string;
  to_node_code: string;
  length_m: number;
  speed_limit_mps: number | null;
  weight: number;
  status: EdgeStatus;
  remark: string | null;
}

function toEdge(row: EdgeRow): EdgeListItem {
  return {
    id: row.id,
    code: deriveEdgeCode(row.from_node_code, row.to_node_code),
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    fromNodeCode: row.from_node_code,
    toNodeCode: row.to_node_code,
    lengthM: row.length_m,
    speedLimitMps: row.speed_limit_mps,
    // 兜底 1 而不是透传 null：权重是「代价倍数」，缺省必须等于畅通，
    // 而 0/undefined 会让这条边在规划里变成免费（比权重 1 更糟，且不会报错）
    weight: row.weight ?? 1,
    status: row.status,
    remark: row.remark
  };
}

interface NodeRow {
  id: string;
  code: string;
  name: string;
  x: number;
  y: number;
  status: EdgeStatus;
  remark: string | null;
}

function toNode(row: NodeRow): NodeListItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    x: row.x,
    y: row.y,
    status: row.status,
    remark: row.remark
  };
}

export interface NodeListQuery {
  keyword?: string;
  status?: EdgeStatus;
  page: number;
  pageSize: number;
}

export function listNodes(db: Db, query: NodeListQuery): { records: NodeListItem[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.keyword) {
    clauses.push('(code LIKE ? OR name LIKE ?)');
    params.push(`%${query.keyword}%`, `%${query.keyword}%`);
  }
  if (query.status) {
    clauses.push('status = ?');
    params.push(query.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number(get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM nodes ${where}`, params)?.total ?? 0);
  const offset = (query.page - 1) * query.pageSize;
  const rows = all<NodeRow>(
    db,
    `SELECT * FROM nodes ${where} ORDER BY code ASC LIMIT ? OFFSET ?`,
    [...params, query.pageSize, offset]
  );
  return { records: rows.map(toNode), total };
}

export function findNodeById(db: Db, id: string): NodeListItem | undefined {
  const row = get<NodeRow>(db, 'SELECT * FROM nodes WHERE id = ?', [id]);
  return row ? toNode(row) : undefined;
}

export interface EdgeListQuery {
  code?: string;
  fromNodeId?: string;
  toNodeId?: string;
  status?: EdgeStatus;
  page: number;
  pageSize: number;
}

export function listEdges(db: Db, query: EdgeListQuery): { records: EdgeListItem[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.code) {
    const parsed = parseEdgeCode(query.code);
    if (!parsed) {
      // 格式不合法与查不到**同解**（空列表）：使用者问的是「库里有没有这条边」，
      // 一个拼错的 code 返回 400 只会让人以为「请求写错了」而不是「没有这条边」。
      // 注意**不做宽松匹配**：`E_N12_N01` 不等于 `E_N01_N12_R` ——
      // 一个对象两个 code 正是 D-33 禁止的形态（细则见 `shared/src/edge-code.ts`）。
      return { records: [], total: 0 };
    }
    const fromCode = parsed.reversed ? parsed.largeCode : parsed.smallCode;
    const toCode = parsed.reversed ? parsed.smallCode : parsed.largeCode;
    clauses.push('(f.code = ? AND t.code = ?)');
    params.push(fromCode, toCode);
  }
  if (query.fromNodeId) {
    clauses.push('e.from_node_id = ?');
    params.push(query.fromNodeId);
  }
  if (query.toNodeId) {
    clauses.push('e.to_node_id = ?');
    params.push(query.toNodeId);
  }
  if (query.status) {
    clauses.push('e.status = ?');
    params.push(query.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number(
    get<{ total: number }>(
      db,
      `SELECT COUNT(*) AS total FROM edges e JOIN nodes f ON f.id = e.from_node_id JOIN nodes t ON t.id = e.to_node_id ${where}`,
      params
    )?.total ?? 0
  );
  const offset = (query.page - 1) * query.pageSize;
  const rows = all<EdgeRow>(db, `${EDGE_SELECT} ${where} ${EDGE_ORDER} LIMIT ? OFFSET ?`, [
    ...params,
    query.pageSize,
    offset
  ]);
  return { records: rows.map(toEdge), total };
}

export function findEdgeById(db: Db, id: string): EdgeListItem | undefined {
  const row = get<EdgeRow>(db, `${EDGE_SELECT} WHERE e.id = ?`, [id]);
  return row ? toEdge(row) : undefined;
}

/*
 * ---- 写入（M2 写路径） ----
 *
 * 节点与边的写入都只在**本文件**：两者共用同一张引用图（边引用节点），
 * 拆成两个文件会让「谁在检查引用」变得不明确。仓储层只做受控写入，
 * 唯一性、引用完整性、边长推导都在领域服务（`domain/base/graph.service.ts`）。
 */

export interface NodeWriteRow {
  id: string;
  code: string;
  name: string;
  x: number;
  y: number;
  remark: string | null;
}

export function insertNode(db: Db, row: NodeWriteRow): void {
  run(db, "INSERT INTO nodes (id, code, name, x, y, status, remark) VALUES (?, ?, ?, ?, ?, 'enabled', ?)", [
    row.id,
    row.code,
    row.name,
    row.x,
    row.y,
    row.remark
  ]);
}

export function updateNodeRow(
  db: Db,
  id: string,
  patch: { name?: string; x?: number; y?: number; remark?: string | null }
): void {
  const assignments: string[] = [];
  const params: SqlParam[] = [];
  if (patch.name !== undefined) {
    assignments.push('name = ?');
    params.push(patch.name);
  }
  if (patch.x !== undefined) {
    assignments.push('x = ?');
    params.push(patch.x);
  }
  if (patch.y !== undefined) {
    assignments.push('y = ?');
    params.push(patch.y);
  }
  if (patch.remark !== undefined) {
    assignments.push('remark = ?');
    params.push(patch.remark);
  }
  if (assignments.length === 0) {
    return;
  }
  run(db, `UPDATE nodes SET ${assignments.join(', ')} WHERE id = ?`, [...params, id]);
}

export function setNodeStatus(db: Db, id: string, status: EdgeStatus): void {
  run(db, 'UPDATE nodes SET status = ? WHERE id = ?', [status, id]);
}

export function findNodeByCode(db: Db, code: string): NodeListItem | undefined {
  const row = get<NodeRow>(db, 'SELECT * FROM nodes WHERE code = ?', [code]);
  return row ? toNode(row) : undefined;
}

/**
 * 节点被多少条边 / 多少个站点引用（`BASE.NODE_IN_USE` 的判定依据）。
 *
 * 拆成两个数而不是一个和：**错误文案要能说清「被谁引用」** ——
 * 「被 3 条边与 1 个站点引用」比「被引用 4 次」有用得多，
 * 而合成一个数之后就再也拆不开了。
 */
export function countNodeReferences(db: Db, id: string): { edges: number; sites: number } {
  const row = get<{ edges: number; sites: number }>(
    db,
    `SELECT (SELECT COUNT(*) FROM edges WHERE from_node_id = ? OR to_node_id = ?) AS edges,
            (SELECT COUNT(*) FROM sites WHERE node_id = ?) AS sites`,
    [id, id, id]
  );
  return { edges: Number(row?.edges ?? 0), sites: Number(row?.sites ?? 0) };
}

export interface EdgeWriteRow {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  lengthM: number;
  speedLimitMps: number | null;
  weight: number;
  remark: string | null;
}

export function insertEdge(db: Db, row: EdgeWriteRow): void {
  run(
    db,
    "INSERT INTO edges (id, from_node_id, to_node_id, length_m, speed_limit_mps, weight, status, remark) VALUES (?, ?, ?, ?, ?, ?, 'enabled', ?)",
    [row.id, row.fromNodeId, row.toNodeId, row.lengthM, row.speedLimitMps, row.weight, row.remark]
  );
}

export function updateEdgeRow(
  db: Db,
  id: string,
  patch: {
    fromNodeId?: string;
    toNodeId?: string;
    lengthM?: number | null;
    speedLimitMps?: number | null;
    weight?: number;
    remark?: string | null;
  }
): void {
  const assignments: string[] = [];
  const params: SqlParam[] = [];
  if (patch.fromNodeId !== undefined) {
    assignments.push('from_node_id = ?');
    params.push(patch.fromNodeId);
  }
  if (patch.toNodeId !== undefined) {
    assignments.push('to_node_id = ?');
    params.push(patch.toNodeId);
  }
  if (patch.lengthM !== undefined) {
    assignments.push('length_m = ?');
    params.push(patch.lengthM);
  }
  if (patch.speedLimitMps !== undefined) {
    assignments.push('speed_limit_mps = ?');
    params.push(patch.speedLimitMps);
  }
  if (patch.weight !== undefined) {
    assignments.push('weight = ?');
    params.push(patch.weight);
  }
  if (patch.remark !== undefined) {
    assignments.push('remark = ?');
    params.push(patch.remark);
  }
  if (assignments.length === 0) {
    return;
  }
  run(db, `UPDATE edges SET ${assignments.join(', ')} WHERE id = ?`, [...params, id]);
}

export function setEdgeStatus(db: Db, id: string, status: EdgeStatus): void {
  run(db, 'UPDATE edges SET status = ? WHERE id = ?', [status, id]);
}

/** 方向对是否已存在（含反向：一条边只允许一个方向，反向要另建一条）。 */
export function findEdgeByDirection(db: Db, fromNodeId: string, toNodeId: string): EdgeListItem | undefined {
  const row = get<EdgeRow>(db, `${EDGE_SELECT} WHERE e.from_node_id = ? AND e.to_node_id = ?`, [fromNodeId, toNodeId]);
  return row ? toEdge(row) : undefined;
}

export function findEdgeByCode(db: Db, code: string): EdgeListItem | undefined {
  const parsed = parseEdgeCode(code);
  if (!parsed) {
    return undefined;
  }
  const fromCode = parsed.reversed ? parsed.largeCode : parsed.smallCode;
  const toCode = parsed.reversed ? parsed.smallCode : parsed.largeCode;
  const row = get<EdgeRow>(db, `${EDGE_SELECT} WHERE f.code = ? AND t.code = ?`, [fromCode, toCode]);
  return row ? toEdge(row) : undefined;
}
