/**
 * 审计查询（M9，`docs/api.md` §3.9）。
 *
 * ## 只读
 *
 * 这个模块**没有写接口**：审计行由 `services/audit.ts` 在各写路径上落库，
 * 而「审计只增不改不删」（`design.md` §4.9 / Req-M9-1）意味着不该存在
 * 修改或删除审计的入口 —— 一个能改审计的系统，审计就不再是证据。
 *
 * ## 导出为什么返回 `{ filename, content }` 而不是裸 CSV
 *
 * HTTP 形态下导出确实该带 `Content-Disposition`（契约这么写），但本地 IPC 形态
 * 没有响应头可放它；两种形态共用同一个 `ApiResult` 信封，因此把「文件名 + 正文」
 * 放进 `data` 里，由渲染层拼 `Blob` 触发下载。**契约的语义没变**（导出的是一个
 * 带文件名的 CSV），变的只是它的承载方式 —— 这一点在 `docs/api.md` §3.9 有说明。
 */
import type { AuditLogItem, AuditResult, ObjectType, Role } from '@udm/shared';
import type { Db } from '../../db/index.js';
import { listAudit, type AuditRow } from '../../db/repositories/audit.repo.js';

export interface AuditQuery {
  module?: string;
  action?: string;
  actorId?: string;
  objectType?: string;
  objectId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

function toItem(row: AuditRow): AuditLogItem {
  return {
    id: row.id,
    ts: row.ts,
    actorName: row.actor_name,
    role: row.role as Role | null,
    module: row.module,
    action: row.action,
    objectType: row.object_type as ObjectType | null,
    objectId: row.object_id,
    result: row.result as AuditResult,
    message: row.message,
    costMs: row.cost_ms,
    traceId: row.trace_id
  };
}

export function listAuditLogs(db: Db, query: AuditQuery): { records: AuditLogItem[]; total: number } {
  // 全部筛选条件都在**仓库层**变成 WHERE：在读到的一页上做内存过滤会让
  // `total` 与实际行数不一致，而分页 UI 正是按 `total` 算页数的
  // （表现是最后一页凭空多出几页空白）。
  const { records, total } = listAudit(db, {
    page: query.page,
    pageSize: query.pageSize,
    module: query.module,
    action: query.action,
    actorId: query.actorId,
    objectType: query.objectType,
    objectId: query.objectId,
    from: query.from,
    to: query.to
  });
  return { records: records.map(toItem), total };
}

/**
 * CSV 单元格转义（RFC 4180）。
 *
 * 三个必须处理的字符：`"` 翻倍、含 `,`/`"`/换行时整体加引号。
 * 审计的 `message` 里出现逗号与引号是常态（用户备注、JSON 片段），
 * 不转义会直接把列错位 —— 而错位的 CSV 在表格软件里**不会报错**，
 * 只会把备注的第二段显示到「结果」列里。
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

const CSV_HEADERS = ['ts', 'actorName', 'role', 'module', 'action', 'objectType', 'objectId', 'result', 'message', 'costMs', 'traceId'];

/** 导出上限：一次导出十万行对本地演示没有意义，却能让渲染层卡住。 */
export const AUDIT_EXPORT_LIMIT = 5000;

export function exportAuditCsv(db: Db, query: Omit<AuditQuery, 'page' | 'pageSize'>): { filename: string; content: string; total: number } {
  const { records, total } = listAudit(db, { ...query, page: 1, pageSize: AUDIT_EXPORT_LIMIT });
  const lines = [CSV_HEADERS.join(',')];
  for (const row of records) {
    lines.push(
      [
        row.ts,
        row.actor_name,
        row.role,
        row.module,
        row.action,
        row.object_type,
        row.object_id,
        row.result,
        row.message,
        row.cost_ms,
        row.trace_id
      ]
        .map(csvCell)
        .join(',')
    );
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return { filename: `udm-audit-${stamp}.csv`, content: `\uFEFF${lines.join('\r\n')}`, total };
}
