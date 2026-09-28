import type { AuditResult, ObjectType, Permission, Role } from '@udm/shared';
import { all, get, run, type Db, type SqlParam } from '../index.js';

export interface AuditEntry {
  id: string;
  ts: string;
  actorId: string | null;
  actorName: string | null;
  role: Role | null;
  module: string;
  action: string;
  objectType: ObjectType | null;
  objectId: string | null;
  before: unknown;
  after: unknown;
  result: AuditResult;
  message: string | null;
  errorCode: string | null;
  costMs: number;
  traceId: string | null;
}

export function insertAudit(db: Db, entry: AuditEntry): void {
  const params: SqlParam[] = [
    entry.id,
    entry.ts,
    entry.actorId,
    entry.actorName,
    entry.role,
    entry.module,
    entry.action,
    entry.objectType,
    entry.objectId,
    // `null` 与 `undefined` **都**表示「没有快照」：少了 `== null` 这层判断，
    // 显式传 `null` 会被 `JSON.stringify` 写成字符串 `'null'`，于是同一件事
    // （没有 after 快照）在库里有两种形态，而 `WHERE after IS NULL` 只找得到其中一种
    entry.before == null ? null : JSON.stringify(entry.before),
    entry.after == null ? null : JSON.stringify(entry.after),
    entry.result,
    entry.message,
    entry.errorCode,
    entry.costMs,
    entry.traceId
  ];
  run(
    db,
    `INSERT INTO audit_logs
     (id, ts, actor_id, actor_name, role, module, action, object_type, object_id, before, after, result, message, error_code, cost_ms, trace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params
  );
}

export interface AuditRow {
  id: string;
  ts: string;
  actor_name: string | null;
  role: Role | null;
  module: string;
  action: string;
  object_type: string | null;
  object_id: string | null;
  result: AuditResult;
  message: string | null;
  cost_ms: number;
  trace_id: string | null;
}

export function listAudit(
  db: Db,
  options: {
    page: number;
    pageSize: number;
    module?: string;
    action?: string;
    actorId?: string;
    objectType?: string;
    objectId?: string;
    from?: string;
    to?: string;
  }
): { records: AuditRow[]; total: number } {
  const clauses: string[] = [];
  const params: SqlParam[] = [];
  if (options.module) {
    clauses.push('module = ?');
    params.push(options.module);
  }
  if (options.action) {
    clauses.push('action = ?');
    params.push(options.action);
  }
  if (options.actorId) {
    clauses.push('actor_id = ?');
    params.push(options.actorId);
  }
  if (options.objectType) {
    clauses.push('object_type = ?');
    params.push(options.objectType);
  }
  if (options.objectId) {
    clauses.push('object_id = ?');
    params.push(options.objectId);
  }
  if (options.from) {
    clauses.push('ts >= ?');
    params.push(options.from);
  }
  if (options.to) {
    clauses.push('ts <= ?');
    params.push(options.to);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number(get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM audit_logs ${where}`, params)?.total ?? 0);
  const records = all<AuditRow>(
    db,
    `SELECT id, ts, actor_name, role, module, action, object_type, object_id, result, message, cost_ms, trace_id
     FROM audit_logs ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`,
    [...params, options.pageSize, (options.page - 1) * options.pageSize]
  );
  return { records, total };
}

export type { Permission };
