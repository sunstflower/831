/**
 * 运行监控读模型（M7，`docs/api.md` §3.7.1 / §3.7.2）。
 *
 * ## 为什么是「读模型」而不是另一套仓库
 *
 * 监控页要的三个列表与 M2/M3 的列表接口**逐字段相同**，只是默认筛选与补充字段不同：
 *   - 任务：默认只看 `running,paused,failed`，字段已含 `progress`（无需补）；
 *   - 车辆：补一个 `currentTaskId`（由 `running/paused` 任务反查，D-25 的派生字段思路）。
 *
 * 因此这里不复制一份 SQL，而是复用 `listTasks` / `listVehicles` 后**补字段**：
 * 复制一份的风险是「基础数据页修了排序、监控页没修」，两边开始分叉（D-34）。
 *
 * ## 概览为什么不缓存
 *
 * 本地 SQLite 上四个 `COUNT(*)` 是微秒级（表规模见 `docs/database.md`），
 * 而缓存会引入「任务刚完成、工作台还显示跑着」的静默不一致。
 */
import type { MonitorOverview, MonitorVehicleItem, TaskStatus, VehicleStatus } from '@udm/shared';
import { nowIso, type Db } from '../../db/index.js';
import { alertStatusCounts } from '../../db/repositories/alert.repo.js';
import { runningTaskByVehicle } from '../../db/repositories/execution.repo.js';
import { monitorCounts } from '../../db/repositories/monitor.repo.js';
import { listTasks, type TaskListQuery } from '../../db/repositories/task.repo.js';
import { listVehicles, type VehicleListQuery } from '../../db/repositories/vehicle.repo.js';

const countOf = (map: Map<string, number>, key: string): number => map.get(key) ?? 0;

export function monitorOverview(db: Db, now: string = nowIso()): MonitorOverview {
  const counts = monitorCounts(db, now.slice(0, 10));
  const alerts = alertStatusCounts(db);
  return {
    taskCounts: {
      running: countOf(counts.tasks, 'running'),
      paused: countOf(counts.tasks, 'paused'),
      pending: countOf(counts.tasks, 'pending'),
      assigned: countOf(counts.tasks, 'assigned'),
      failed: countOf(counts.tasks, 'failed'),
      finishedToday: counts.finishedToday
    },
    vehicleCounts: {
      idle: countOf(counts.vehicles, 'idle'),
      busy: countOf(counts.vehicles, 'busy'),
      reserved: countOf(counts.vehicles, 'reserved'),
      charging: countOf(counts.vehicles, 'charging'),
      offline: countOf(counts.vehicles, 'offline'),
      fault: countOf(counts.vehicles, 'fault')
    },
    alertCounts: alerts,
    eventSeq: counts.eventSeq,
    updatedAt: now
  };
}

export function monitorTasks(
  db: Db,
  query: TaskListQuery
): { records: Awaited<ReturnType<typeof listTasks>>['records']; total: number } {
  return listTasks(db, query);
}

export function monitorVehicles(
  db: Db,
  query: VehicleListQuery
): { records: MonitorVehicleItem[]; total: number } {
  const { records, total } = listVehicles(db, query);
  const active = runningTaskByVehicle(db);
  return { records: records.map((vehicle) => ({ ...vehicle, currentTaskId: active.get(vehicle.id) ?? null })), total };
}

/** 监控任务列表的默认状态集合（路由用它兜住「不传 status」的情况）。 */
export const MONITOR_DEFAULT_TASK_STATUSES: TaskStatus[] = ['running', 'paused', 'failed'];

/** 车型/车态筛选取值来自 `shared` 的枚举（路由侧校验，不用在这里重复白名单）。 */
export type { TaskStatus, VehicleStatus };
