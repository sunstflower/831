/**
 * 监控概览计数（M7，`docs/api.md` §3.7.1）。
 *
 * 四个计数都是**读模型**：直接对业务表 `GROUP BY` 现算，不落冗余的汇总表。
 * 汇总表会带来「更新了任务但忘了更新计数」这一类静默错误，
 * 而这里的表规模（本地演示场景）让现算完全够用。
 *
 * `eventSeq` 取 `sqlite_sequence`（**单调水位线**）而不是 `MAX(event_log.seq)`，
 * 理由见 D-24：删掉最高位那条事件会让 `MAX` 回退，渲染层据此丢弃重放事件，
 * 一旦回退就会把旧事件当成新的重放一遍。
 */
import { all, get, nowIso, type Db } from '../index.js';

export interface MonitorCounts {
  tasks: Map<string, number>;
  vehicles: Map<string, number>;
  /** 今日完成数：以 `finished_at` 的日期前缀判定，不引入时区换算（本地演示口径）。 */
  finishedToday: number;
  eventSeq: number;
}

export function monitorCounts(db: Db, today: string): MonitorCounts {
  const tasks = new Map(
    all<{ status: string; total: number }>(db, 'SELECT status, COUNT(*) AS total FROM tasks GROUP BY status').map((row) => [
      row.status,
      Number(row.total)
    ])
  );
  const vehicles = new Map(
    all<{ status: string; total: number }>(db, 'SELECT status, COUNT(*) AS total FROM vehicles GROUP BY status').map((row) => [
      row.status,
      Number(row.total)
    ])
  );
  const finishedToday = Number(
    get<{ total: number }>(
      db,
      "SELECT COUNT(*) AS total FROM tasks WHERE status = 'finished' AND finished_at LIKE ?",
      [`${today}%`]
    )?.total ?? 0
  );
  const eventSeq = Number(
    get<{ seq: number }>(db, "SELECT seq FROM sqlite_sequence WHERE name = 'event_log'")?.seq ?? 0
  );
  return { tasks, vehicles, finishedToday, eventSeq };
}

export function monitorUpdatedAt(): string {
  return nowIso();
}
