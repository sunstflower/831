/**
 * 站点读取仓库（M2，`GET /api/sites`）。
 *
 * **为什么投影成 DTO 放在仓库层**：`sites` 表里有 `node_id` / `created_at` 等列，
 * 而接口契约（`docs/api.md` §3.2.1）用的是驼峰字段与「`nodeId` 可为空」的语义。
 * 这层薄映射紧挨着产生这些列的 SQL：列改名时改一处即可，不会出现
 * 「SQL 改了、映射忘改」而两边都编译通过的情况（`users` 的映射当初写在 `ipc/api.ts` 里，
 * 那是当时只有一个列表接口的权宜）。
 *
 * 本文件**不做业务判断**（不校验编码重复、不写审计）：那些属写入路径与领域服务
 * （`docs/module-M2-base-data.md` §3）。
 */
import type { EdgeStatus, SiteListItem, SiteType } from '@udm/shared';
import { all, get, run, type Db, type SqlParam } from '../index.js';

interface SiteRow {
  id: string;
  code: string;
  name: string;
  type: SiteType;
  node_id: string | null;
  x: number;
  y: number;
  status: EdgeStatus;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

function toSite(row: SiteRow): SiteListItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    status: row.status,
    nodeId: row.node_id,
    x: row.x,
    y: row.y,
    remark: row.remark,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface SiteListQuery {
  keyword?: string;
  type?: SiteType;
  status?: EdgeStatus;
  page: number;
  pageSize: number;
}

export function listSites(db: Db, query: SiteListQuery): { records: SiteListItem[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.keyword) {
    // 站点编码与名称都参与搜索：使用者记的是「A-01」还是「A 仓库」事先不知道
    clauses.push('(code LIKE ? OR name LIKE ?)');
    params.push(`%${query.keyword}%`, `%${query.keyword}%`);
  }
  if (query.type) {
    clauses.push('type = ?');
    params.push(query.type);
  }
  if (query.status) {
    clauses.push('status = ?');
    params.push(query.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number(get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM sites ${where}`, params)?.total ?? 0);
  const offset = (query.page - 1) * query.pageSize;
  // 排序固定为 `code`：分页接口**必须**有稳定顺序，否则同一页在两次请求间可能重复或漏行
  // （`created_at` 在 seed 数据里全部相同，不足以定序）
  const rows = all<SiteRow>(
    db,
    `SELECT * FROM sites ${where} ORDER BY code ASC LIMIT ? OFFSET ?`,
    [...params, query.pageSize, offset]
  );
  return { records: rows.map(toSite), total };
}

export function findSiteById(db: Db, id: string): SiteListItem | undefined {
  const row = get<SiteRow>(db, 'SELECT * FROM sites WHERE id = ?', [id]);
  return row ? toSite(row) : undefined;
}

/*
 * ---- 写入（M2 写路径） ----
 *
 * 本层只做**受控写入**，不判业务合法性（编码是否重复、节点是否存在）——
 * 那些要读库做判断，属领域服务（`docs/module-M2-base-data.md` §3 边界约束 1）。
 *
 * 为什么写入参数是**逐个列**而不是一个对象：列名与参数一一对应时，
 * 「加了列忘了传参」会在编译期报错；而收一个 `Record<string, unknown>` 再展开，
 * 新增列会被静默漏掉（INSERT 里少一列，SQLite 用默认值顶上，谁也不会发现）。
 */

export interface SiteWriteRow {
  id: string;
  code: string;
  name: string;
  type: SiteType;
  nodeId: string | null;
  x: number;
  y: number;
  remark: string | null;
  at: string;
}

export function insertSite(db: Db, row: SiteWriteRow): void {
  run(
    db,
    `INSERT INTO sites (id, code, name, type, node_id, x, y, status, remark, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'enabled', ?, ?, ?)`,
    [row.id, row.code, row.name, row.type, row.nodeId, row.x, row.y, row.remark, row.at, row.at]
  );
}

/** 更新站点：`code` 不在可改列里（契约与 `validateSiteInput` 都已拦住）。 */
export function updateSiteRow(
  db: Db,
  id: string,
  patch: { name?: string; type?: SiteType; nodeId?: string | null; x?: number; y?: number; remark?: string | null },
  at: string
): void {
  const assignments: string[] = [];
  const params: SqlParam[] = [];
  if (patch.name !== undefined) {
    assignments.push('name = ?');
    params.push(patch.name);
  }
  if (patch.type !== undefined) {
    assignments.push('type = ?');
    params.push(patch.type);
  }
  if (patch.nodeId !== undefined) {
    assignments.push('node_id = ?');
    params.push(patch.nodeId);
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
    // 空补丁：只有 `updated_at` 变。**仍然执行**，因为「PUT 了一个空 body」
    // 在语义上是「这个对象被确认过一次」，且审计里会留下痕迹
    assignments.push('updated_at = ?');
    params.push(at);
    run(db, `UPDATE sites SET ${assignments.join(', ')} WHERE id = ?`, [...params, id]);
    return;
  }
  run(db, `UPDATE sites SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`, [...params, at, id]);
}

export function setSiteStatus(db: Db, id: string, status: EdgeStatus, at: string): void {
  run(db, 'UPDATE sites SET status = ?, updated_at = ? WHERE id = ?', [status, at, id]);
}

/** 编码唯一性检查用：同表内按 code 查。**跨表不查** —— `sites` 与 `vehicles` 的编码允许重名。 */
export function findSiteByCode(db: Db, code: string): SiteListItem | undefined {
  const row = get<SiteRow>(db, 'SELECT * FROM sites WHERE code = ?', [code]);
  return row ? toSite(row) : undefined;
}
