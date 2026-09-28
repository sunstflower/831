/**
 * 禁行规则仓库（M2，`docs/api.md` §3.2.5）。
 *
 * ## 这个仓库比其它三个多一件事：把多态引用翻译成可读的编码
 *
 * `restrictions.target_id` **没有外键**（`docs/database.md` §1 第 8 条：多态引用不设 FK），
 * 而接口契约要求「响应含对象编码便于展示」（§3.2.5）。因此读列表时要做一次翻译：
 *   - `type='node'` → `nodes.code`；
 *   - `type='edge'` → 按两端节点 code 推导的业务编码（`@udm/shared` 的 `deriveEdgeCode`）。
 *
 * 这次翻译放在 **SQL 里**而不是先查规则再逐条回查：逐条回查是 N+1，
 * 而禁行规则的数量会随园区规则累积（每条边都可能有一条），
 * 一条 SQL 里用 `LEFT JOIN` 一次取回更省且没有「先查了 20 条再发 20 个查询」的形态。
 *
 * 用 `LEFT JOIN` 而**不是** `JOIN`：目标被删除后规则仍在（多态引用没有 FK 保护），
 * 这是刻意接受的代价，此时 `targetCode` 为 `null`，界面显示「目标已不存在」。
 * 若用 `JOIN`，那条规则会**凭空从列表里消失** —— 使用者看不到它、也就无法清理它。
 *
 * 本文件不做业务判断（不校验目标是否存在、不比较时间窗），那些属领域服务。
 */
import { deriveEdgeCode, type RestrictionStatus, type RestrictionType, type RestrictionListItem, type VehicleType } from '@udm/shared';
import { all, get, run, type Db, type SqlParam } from '../index.js';

interface RestrictionRow {
  id: string;
  type: RestrictionType;
  target_id: string;
  start_at: string | null;
  end_at: string | null;
  vehicle_type: VehicleType | null;
  reason: string;
  status: RestrictionStatus;
  created_at: string;
  created_by: string | null;
  /* 下面三列来自 JOIN，不是 restrictions 表自己的列 */
  node_code: string | null;
  from_node_code: string | null;
  to_node_code: string | null;
}

/** 列表、详情共用同一段投影：两处字段必须一致，否则「列表有 code、详情没有」会静默分叉。 */
const SELECT_WITH_TARGET = `
  SELECT r.*,
         n.code  AS node_code,
         fn.code AS from_node_code,
         tn.code AS to_node_code
  FROM restrictions r
  LEFT JOIN nodes n  ON r.type = 'node' AND n.id = r.target_id
  LEFT JOIN edges e  ON r.type = 'edge' AND e.id = r.target_id
  LEFT JOIN nodes fn ON fn.id = e.from_node_id
  LEFT JOIN nodes tn ON tn.id = e.to_node_id
`;

function toRestriction(row: RestrictionRow): RestrictionListItem {
  const targetCode =
    row.type === 'node'
      ? row.node_code
      : row.from_node_code && row.to_node_code
        ? deriveEdgeCode(row.from_node_code, row.to_node_code)
        : null;
  return {
    id: row.id,
    type: row.type,
    targetId: row.target_id,
    targetCode,
    startAt: row.start_at,
    endAt: row.end_at,
    vehicleType: row.vehicle_type,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

export interface RestrictionListQuery {
  type?: RestrictionType;
  status?: RestrictionStatus;
  page: number;
  pageSize: number;
}

export function listRestrictions(db: Db, query: RestrictionListQuery): { records: RestrictionListItem[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.type) {
    clauses.push('r.type = ?');
    params.push(query.type);
  }
  if (query.status) {
    clauses.push('r.status = ?');
    params.push(query.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  // 计数**不带 JOIN**：JOIN 是 1:1 的（`LEFT JOIN edges` 后还可能接两个节点），
  // 但计数只要 restrictions 的行数，走 JOIN 只是白白多算一遍
  const total = Number(get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM restrictions r ${where}`, params)?.total ?? 0);
  const offset = (query.page - 1) * query.pageSize;
  // 排序：先按创建时间倒序（新规则在前），再按 id 兜底 —— 时间戳可能同毫秒，
  // 而分页接口没有稳定顺序会让同一行在两页里重复出现、另一行一页都不出现
  const rows = all<RestrictionRow>(
    db,
    `${SELECT_WITH_TARGET} ${where} ORDER BY r.created_at DESC, r.id ASC LIMIT ? OFFSET ?`,
    [...params, query.pageSize, offset]
  );
  return { records: rows.map(toRestriction), total };
}

export function findRestrictionById(db: Db, id: string): RestrictionListItem | undefined {
  const row = get<RestrictionRow>(db, `${SELECT_WITH_TARGET} WHERE r.id = ?`, [id]);
  return row ? toRestriction(row) : undefined;
}

/*
 * ---- 写入 ----
 *
 * 与其它三个仓库同口径：只做受控写入，不判业务合法性。
 */

export interface RestrictionWriteRow {
  id: string;
  type: RestrictionType;
  targetId: string;
  startAt: string | null;
  endAt: string | null;
  vehicleType: VehicleType | null;
  reason: string;
  createdBy: string | null;
  at: string;
}

/** 新建的规则一律 `active`：`expired` 只能由「停用」这一次显式动作产生（见 `enums.ts` 的说明）。 */
export function insertRestriction(db: Db, row: RestrictionWriteRow): void {
  run(
    db,
    `INSERT INTO restrictions (id, type, target_id, start_at, end_at, vehicle_type, reason, status, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [row.id, row.type, row.targetId, row.startAt, row.endAt, row.vehicleType, row.reason, row.at, row.createdBy]
  );
}

/**
 * 更新规则。
 *
 * `updated_at` **不在表上**：`restrictions` 的 DDL 只有 `created_at`
 * （规则是「有生效区间的一次性声明」，没有「最后修改于」的语义）。
 * 因此这里不写不存在的列 —— 加它会需要一次迁移，而那不属于本次范围。
 */
export function updateRestrictionRow(
  db: Db,
  id: string,
  patch: {
    type?: RestrictionType;
    targetId?: string;
    startAt?: string | null;
    endAt?: string | null;
    vehicleType?: VehicleType | null;
    reason?: string;
    status?: RestrictionStatus;
  }
): void {
  const assignments: string[] = [];
  const params: SqlParam[] = [];
  if (patch.type !== undefined) {
    assignments.push('type = ?');
    params.push(patch.type);
  }
  if (patch.targetId !== undefined) {
    assignments.push('target_id = ?');
    params.push(patch.targetId);
  }
  if (patch.startAt !== undefined) {
    assignments.push('start_at = ?');
    params.push(patch.startAt);
  }
  if (patch.endAt !== undefined) {
    assignments.push('end_at = ?');
    params.push(patch.endAt);
  }
  if (patch.vehicleType !== undefined) {
    assignments.push('vehicle_type = ?');
    params.push(patch.vehicleType);
  }
  if (patch.reason !== undefined) {
    assignments.push('reason = ?');
    params.push(patch.reason);
  }
  if (patch.status !== undefined) {
    assignments.push('status = ?');
    params.push(patch.status);
  }
  if (assignments.length === 0) {
    // 空补丁：没有列可写，也**没有** `updated_at` 可碰。直接返回，由服务层决定是否写审计
    return;
  }
  run(db, `UPDATE restrictions SET ${assignments.join(', ')} WHERE id = ?`, [...params, id]);
}

/** 物理删除：禁行规则是**唯一**允许物理删除的主数据（`design.md` D-07 的例外）。 */
export function deleteRestrictionRow(db: Db, id: string): void {
  run(db, 'DELETE FROM restrictions WHERE id = ?', [id]);
}
