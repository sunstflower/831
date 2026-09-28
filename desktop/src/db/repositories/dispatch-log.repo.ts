/**
 * 调度日志仓库（M4，`docs/api.md` §3.4.6）。
 *
 * ## 快照列读出来但不在这里解析
 *
 * `input_snapshot` / `output_snapshot` 可能有几十 KB，而列表接口**不返回**它们
 * （契约 §3.4.6 明确写了「仅详情接口可见」）。因此列表的 SELECT 不取这两列 ——
 * 少读两列不是为了省那点 IO，而是为了不让「列表接口顺手带上了快照」这种事
 * 在后来者手里悄悄发生：不取，就传不出去。
 *
 * ## 坏 JSON 一律兜底
 *
 * `task_ids` / `summary` / `rejected` 都是 TEXT 存 JSON。坏 JSON 说明数据被外部改过，
 * 但让日志接口 500 只会更难排查 —— 返回空值 + 其余字段照常展示，
 * 使用者至少能看到「这条日志存在、但它的小结读不出来」。与 `route.repo.ts` 同口径。
 */
import type {
  DispatchLogAction,
  DispatchLogListItem,
  DispatchStrategySelection,
  PlanPreview,
  RejectItem,
  StrategySummary
} from '@udm/shared';
import { all, get, run, type Db } from '../index.js';

export interface LogWriteRow {
  id: string;
  requestId: string;
  action: DispatchLogAction;
  strategy: DispatchStrategySelection;
  taskIds: readonly string[];
  inputSnapshot: unknown;
  outputSnapshot: unknown;
  summary: StrategySummary;
  rejected: readonly RejectItem[];
  reason: string | null;
  elapsedMs: number;
  operatorId: string | null;
  createdAt: string;
}

export function insertLog(db: Db, row: LogWriteRow): void {
  run(
    db,
    `INSERT INTO dispatch_logs (id, request_id, action, strategy, task_ids, input_snapshot, output_snapshot,
                                summary, rejected, reason, elapsed_ms, operator_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.requestId,
      row.action,
      row.strategy,
      JSON.stringify(row.taskIds),
      row.inputSnapshot === undefined ? null : JSON.stringify(row.inputSnapshot),
      row.outputSnapshot === undefined ? null : JSON.stringify(row.outputSnapshot),
      JSON.stringify(row.summary ?? {}),
      JSON.stringify(row.rejected ?? []),
      row.reason,
      Math.round(row.elapsedMs),
      row.operatorId,
      row.createdAt
    ]
  );
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null || raw === '') {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

interface LogRow {
  id: string;
  request_id: string;
  action: DispatchLogAction;
  strategy: DispatchStrategySelection;
  task_ids: string;
  summary: string;
  rejected: string;
  reason: string | null;
  elapsed_ms: number;
  operator_name: string | null;
  created_at: string;
}

const EMPTY_SUMMARY: StrategySummary = { totalTasks: 0, assigned: 0, rejectedCount: 0, totalCost: 0, elapsedMs: 0 };

function toListItem(row: LogRow): DispatchLogListItem {
  return {
    id: row.id,
    requestId: row.request_id,
    action: row.action,
    strategy: row.strategy,
    taskIds: parseJson<string[]>(row.task_ids, []),
    summary: parseJson<StrategySummary>(row.summary, EMPTY_SUMMARY),
    rejected: parseJson<RejectItem[]>(row.rejected, []),
    reason: row.reason,
    elapsedMs: row.elapsed_ms,
    operatorName: row.operator_name,
    createdAt: row.created_at
  };
}

/** 该 requestId 是否已经应用过（幂等判据之一，§11）。 */
export function hasApplied(db: Db, requestId: string): boolean {
  const row = get<{ total: number }>(
    db,
    "SELECT COUNT(*) AS total FROM dispatch_logs WHERE request_id = ? AND action = 'apply'",
    [requestId]
  );
  return Number(row?.total ?? 0) > 0;
}

/**
 * 取一条预览（或重算）留下的**输出快照**，供 apply 落地（§10.2 第 1 步）。
 *
 * ## 排序键为什么是「created_at + rowid」而不是只看 created_at
 *
 * `recompute` 会**刻意**让回收日志与紧随其后的新预览共用同一个 `request_id`
 * （§10.4：事后要把「因为什么重算了哪张单」与「重算后建议怎么派」对上）。
 * 于是同一个 `request_id` 下同时存在两行：`recompute`（`output_snapshot` 为 NULL）
 * 与 `preview`（有输出）。`created_at` 只到毫秒，实测两次插入会落在**同一毫秒**里，
 * 此时 `ORDER BY created_at DESC LIMIT 1` 取到哪一行是**未定义**的 ——
 * 取到回收那行就会让用户刚看到的新预览「应用」时报 `DISPATCH.REQUEST_NOT_FOUND`，
 * 而且是偶发（取决于机器快慢），属最难排查的一类问题。
 *
 * 两处修正各管一件事：`output_snapshot IS NOT NULL` 保证取到的是**有输出**的那行，
 * `rowid DESC` 保证同一毫秒内**取后插入的**（rowid 是插入顺序，UUID 不是）。
 *
 * 为什么 apply 用**存档的输出**而不是重跑算法：使用者点「应用」时看到的是那份预览里的
 * 具体派发。重跑会得到一个**可能不同**的结果（时间推进后 `now` 变了、别的车被占用了），
 * 于是「我确认过的方案」与「实际落库的方案」不是同一个 —— 这是最难解释的一类问题。
 * 存档的输出 + 事务里的条件更新，两者合起来才既「所见即所得」又「并发安全」。
 */
export function findPreviewOutput(
  db: Db,
  requestId: string,
  strategy: DispatchStrategySelection
): { plans: PlanPreview[]; rejected: RejectItem[]; summary: StrategySummary } | undefined {
  const row = get<{ output_snapshot: string | null }>(
    db,
    `SELECT output_snapshot FROM dispatch_logs
      WHERE request_id = ? AND action IN ('preview','recompute') AND output_snapshot IS NOT NULL
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [requestId]
  );
  if (!row?.output_snapshot) {
    return undefined;
  }
  interface StoredOutcome {
    strategy: string;
    plans?: PlanPreview[];
    rejected?: RejectItem[];
    summary?: StrategySummary;
  }
  const stored = parseJson<StoredOutcome[] | StoredOutcome | null>(row.output_snapshot, null);
  if (!stored) {
    return undefined;
  }
  const list = Array.isArray(stored) ? stored : [stored];
  const picked =
    strategy === 'all' ? list[0] : (list.find((item) => item.strategy === strategy) ?? (list.length === 1 ? list[0] : undefined));
  if (!picked) {
    return undefined;
  }
  return {
    plans: picked.plans ?? [],
    rejected: picked.rejected ?? [],
    summary: picked.summary ?? EMPTY_SUMMARY
  };
}

export interface LogListQuery {
  requestId?: string;
  action?: DispatchLogAction;
  strategy?: DispatchStrategySelection;
  taskId?: string;
  from?: string;
  to?: string;
  offset: number;
  limit: number;
}

/**
 * 日志列表（`docs/api.md` §3.4.6）。
 *
 * 排序 `created_at DESC, id DESC`：与任务列表同因 —— 分页接口必须有**全序**，
 * 而 `created_at` 只到毫秒，同一毫秒内的两条日志需要第二键定序（`id` 唯一）。
 * `taskId` 命中 JSON 数组用 `LIKE '%"id"%'`：SQLite 没有数组类型，
 * 而引号包裹能避免 `t1` 命中 `t10`（子串匹配最常见的误命中）。
 */
export function listLogs(db: Db, query: LogListQuery): { records: DispatchLogListItem[]; total: number } {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (query.requestId) {
    where.push('l.request_id = ?');
    params.push(query.requestId);
  }
  if (query.action) {
    where.push('l.action = ?');
    params.push(query.action);
  }
  if (query.strategy) {
    where.push('l.strategy = ?');
    params.push(query.strategy);
  }
  if (query.taskId) {
    where.push(`l.task_ids LIKE ?`);
    params.push(`%"${query.taskId}"%`);
  }
  if (query.from) {
    where.push('l.created_at >= ?');
    params.push(query.from);
  }
  if (query.to) {
    where.push('l.created_at <= ?');
    params.push(query.to);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total =
    get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM dispatch_logs l ${clause}`, params)?.total ?? 0;
  const records = all<LogRow>(
    db,
    `SELECT l.id, l.request_id, l.action, l.strategy, l.task_ids, l.summary, l.rejected,
            l.reason, l.elapsed_ms, u.display_name AS operator_name, l.created_at
       FROM dispatch_logs l
       LEFT JOIN users u ON u.id = l.operator_id
       ${clause}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ? OFFSET ?`,
    [...params, query.limit, query.offset]
  ).map(toListItem);

  return { records, total: Number(total) };
}
