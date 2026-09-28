/**
 * 告警读写仓库（M8，`docs/api.md` §3.8）。
 *
 * 只做「行 → 对象」的搬运与筛选拼装，**不含状态机判定**：
 * 「这个状态能不能被确认」的唯一作者是 `@udm/shared` 的 `alert-state.ts`
 * （主进程与浏览器 Mock 共用同一份），在这里再写一遍 `if (status === 'new')`
 * 就会让两条路径在新增状态时各自演化。
 *
 * `detail` 列是 JSON 文本：读出来**解析失败不抛错**，退化成空对象。
 * 一条手写的/旧版本的告警不该让整个告警中心打不开（与 `settings.repo.ts`
 * 对坏值的处理同一判据）。
 */
import type { AlertLevel, AlertStatus, AlertType, ObjectType } from '@udm/shared';
import { all, get, run, type Db, type SqlParam } from '../index.js';

export interface AlertRow {
  id: string;
  type: AlertType;
  level: AlertLevel;
  object_type: ObjectType;
  object_id: string | null;
  message: string;
  detail: string;
  status: AlertStatus;
  dedupe_key: string | null;
  created_at: string;
  ack_at: string | null;
  ack_by: string | null;
  resolve_at: string | null;
  resolve_by: string | null;
  resolution: string | null;
  archived_at: string | null;
  archived_by: string | null;
}

export interface AlertQuery {
  type?: AlertType;
  level?: AlertLevel;
  status?: AlertStatus[];
  objectType?: ObjectType;
  objectId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/** 把可选条件拼成 `WHERE`；参数顺序与占位符严格一一对应。 */
function buildWhere(query: Omit<AlertQuery, 'page' | 'pageSize'>): { where: string; params: SqlParam[] } {
  const clauses: string[] = [];
  const params: SqlParam[] = [];
  if (query.type) {
    clauses.push('type = ?');
    params.push(query.type);
  }
  if (query.level) {
    clauses.push('level = ?');
    params.push(query.level);
  }
  if (query.status && query.status.length > 0) {
    // 多值用 `IN (?, ?)` 展开而不是拼字符串：状态值虽然来自白名单，
    // 但「值来自白名单」不该成为把用户输入直接拼进 SQL 的理由
    clauses.push(`status IN (${query.status.map(() => '?').join(', ')})`);
    params.push(...query.status);
  }
  if (query.objectType) {
    clauses.push('object_type = ?');
    params.push(query.objectType);
  }
  if (query.objectId) {
    clauses.push('object_id = ?');
    params.push(query.objectId);
  }
  if (query.from) {
    clauses.push('created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    clauses.push('created_at <= ?');
    params.push(query.to);
  }
  return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function listAlerts(db: Db, query: AlertQuery): { records: AlertRow[]; total: number } {
  const { where, params } = buildWhere(query);
  const total = Number(get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM alerts ${where}`, params)?.total ?? 0);
  const records = all<AlertRow>(
    db,
    `SELECT * FROM alerts ${where} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`,
    [...params, query.pageSize, (query.page - 1) * query.pageSize]
  );
  return { records, total };
}

export function findAlertById(db: Db, id: string): AlertRow | undefined {
  return get<AlertRow>(db, 'SELECT * FROM alerts WHERE id = ?', [id]);
}

export interface AlertWriteRow {
  id: string;
  type: AlertType;
  level: AlertLevel;
  objectType: ObjectType;
  objectId: string | null;
  message: string;
  detail: Record<string, unknown>;
  dedupeKey: string | null;
  at: string;
}

export function insertAlert(db: Db, row: AlertWriteRow): void {
  run(
    db,
    `INSERT INTO alerts (id, type, level, object_type, object_id, message, detail, status, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
    [row.id, row.type, row.level, row.objectType, row.objectId, row.message, JSON.stringify(row.detail), row.dedupeKey, row.at]
  );
}

/**
 * 去重窗口内是否已有同 `dedupe_key` 的**未归档**告警。
 *
 * 只认同类未归档告警：已关闭的告警不该压制新的一起同类事件
 * （「上次那台车离线」与「这次又离线」是两件事）。窗口取设置表的
 * `alert.dedupeWindowS`（D-09），因此这里是「起点时刻」而不是固定间隔。
 */
export function findDuplicateAlert(db: Db, dedupeKey: string, since: string): AlertRow | undefined {
  return get<AlertRow>(
    db,
    `SELECT * FROM alerts
     WHERE dedupe_key = ? AND created_at >= ? AND status <> 'archived'
     ORDER BY created_at DESC LIMIT 1`,
    [dedupeKey, since]
  );
}

export interface AlertTransitionWrite {
  status: AlertStatus;
  ackAt?: string | null;
  ackBy?: string | null;
  resolveAt?: string | null;
  resolveBy?: string | null;
  resolution?: string | null;
  archivedAt?: string | null;
  archivedBy?: string | null;
}

/**
 * 写一次状态迁移。
 *
 * 用**显式列名**而不是 `COALESCE(?, col)`：后者在「本次要把 resolution 设为 null」
 * 与「本次不动 resolution」之间无法区分，而 `archive` 正需要保留上一次的处置结论。
 */
export function applyAlertTransition(db: Db, id: string, write: AlertTransitionWrite): void {
  const sets: string[] = ['status = ?'];
  const params: SqlParam[] = [write.status];
  const pairs: Array<[keyof AlertTransitionWrite, string]> = [
    ['ackAt', 'ack_at'],
    ['ackBy', 'ack_by'],
    ['resolveAt', 'resolve_at'],
    ['resolveBy', 'resolve_by'],
    ['resolution', 'resolution'],
    ['archivedAt', 'archived_at'],
    ['archivedBy', 'archived_by']
  ];
  for (const [key, column] of pairs) {
    if (write[key] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(write[key] as SqlParam);
    }
  }
  params.push(id);
  run(db, `UPDATE alerts SET ${sets.join(', ')} WHERE id = ?`, params);
}

export interface AlertStatusCounts {
  new: number;
  acknowledged: number;
  processing: number;
  unresolved: number;
}

/** 概览用的状态计数；`unresolved` = `new + acknowledged + processing`（未处置的总量）。 */
export function alertStatusCounts(db: Db): AlertStatusCounts {
  const rows = all<{ status: AlertStatus; total: number }>(
    db,
    'SELECT status, COUNT(*) AS total FROM alerts GROUP BY status'
  );
  const byStatus = new Map(rows.map((row) => [row.status, Number(row.total)]));
  const fresh = byStatus.get('new') ?? 0;
  const acknowledged = byStatus.get('acknowledged') ?? 0;
  const processing = byStatus.get('processing') ?? 0;
  return { new: fresh, acknowledged, processing, unresolved: fresh + acknowledged + processing };
}

export function parseAlertDetail(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
