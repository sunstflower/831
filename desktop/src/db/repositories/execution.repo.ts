/**
 * 执行与轨迹仓库（M7，`docs/api.md` §3.7 / §3.6.2）。
 *
 * 与其它仓库的区别只有一处：这里的写入方是**执行器**（`domain/execution/executor.ts`），
 * 不是用户的 CRUD 请求。因此这里只提供「按 id 定向更新」的窄接口，
 * 不放任何业务判定 —— 车辆该不该 busy、任务能不能完成，都由执行器与
 * `@udm/shared` 的状态机决定。
 *
 * ## 为什么轨迹表只增不改
 *
 * `vehicle_tracks` 是**时间序列**：一次采样一行，永不更新、永不删除。
 * 它是「这辆车昨晚 3 点在哪」这类事后问题的唯一答案，而任何 UPDATE
 * 都会让那个答案变成「最后一次写入时的样子」（与审计日志同一判据）。
 */
import type { VehicleStatus } from '@udm/shared';
import { all, get, run, type Db, type SqlParam } from '../index.js';

export interface ExecutionRoute {
  routeId: string;
  nodeIds: string[];
  edgeIds: string[];
  distanceM: number;
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 取该任务**已生效计划**所属的路线。
 *
 * 为什么经 `dispatch_plans` 而不是 `tasks.plan_id`：`plan_id` 是派发时写的冗余快照，
 * 而 `dispatch_plans.status='applied'` 才是「此刻有效的计划」的真身（D-25 的同一判据）。
 * 计划被改派置 `superseded` 后，任务仍可能挂着旧 `plan_id`，照它取路线会让车沿着
 * 一条已经作废的路径跑。
 */
export function findExecutionRoute(db: Db, taskId: string): ExecutionRoute | undefined {
  const row =
    get<{ route_id: string; node_ids: string; edge_ids: string; distance_m: number }>(
      db,
      `SELECT r.id AS route_id, r.node_ids, r.edge_ids, r.distance_m
       FROM dispatch_plans p JOIN routes r ON r.id = p.route_id
       WHERE p.task_id = ? AND p.status = 'applied'
       ORDER BY p.created_at DESC LIMIT 1`,
      [taskId]
    ) ??
    /*
     * 回退：按 `routes.task_id` 直接取。
     *
     * 为什么必须留这条路径：D-26 的 seed 演示任务是「任务 running + 一条 routes 行」，
     * 它**没有** `dispatch_plans` 行（演示数据不是走调度流程产生的），
     * 而 `tasks.plan_id` 也只是派发时写的冗余快照。少了这个回退，首次启动时
     * 那条「执行中」的演示任务会被判定成「没有可用路线」—— 车永远不动，
     * 而界面上它明明显示在跑。`task.repo.ts` 的 `findTaskRoute` 是同一套两级查法。
     */
    get<{ route_id: string; node_ids: string; edge_ids: string; distance_m: number }>(
      db,
      `SELECT id AS route_id, node_ids, edge_ids, distance_m
       FROM routes WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`,
      [taskId]
    );
  if (!row) {
    return undefined;
  }
  return {
    routeId: row.route_id,
    nodeIds: parseStringArray(row.node_ids),
    edgeIds: parseStringArray(row.edge_ids),
    distanceM: Number(row.distance_m)
  };
}

export function updateTaskProgress(db: Db, id: string, progress: number, at: string): void {
  run(db, 'UPDATE tasks SET progress = ?, updated_at = ? WHERE id = ?', [progress, at, id]);
}

export interface VehicleTelemetry {
  x?: number;
  y?: number;
  battery?: number;
  loadKg?: number;
  status?: VehicleStatus;
  currentNodeId?: string | null;
  online?: boolean;
  heartbeat?: boolean;
}

/**
 * 写一次车辆遥测。
 *
 * `heartbeat: true` 时同时刷新 `last_heartbeat_at` —— 心跳是**通信事实**，
 * 只有真的收到执行器的采样才该更新它（`base/vehicle.service.ts` 的启停接口
 * 明确不得代为声明 online，同一条边界）。
 */
export function updateVehicleTelemetry(db: Db, id: string, patch: VehicleTelemetry, at: string): void {
  const sets: string[] = ['updated_at = ?'];
  const params: SqlParam[] = [at];
  if (patch.x !== undefined) {
    sets.push('x = ?');
    params.push(patch.x);
  }
  if (patch.y !== undefined) {
    sets.push('y = ?');
    params.push(patch.y);
  }
  if (patch.battery !== undefined) {
    sets.push('battery = ?');
    params.push(patch.battery);
  }
  if (patch.loadKg !== undefined) {
    sets.push('load_kg = ?');
    params.push(patch.loadKg);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  if (patch.currentNodeId !== undefined) {
    sets.push('current_node_id = ?');
    params.push(patch.currentNodeId);
  }
  if (patch.online !== undefined) {
    sets.push('online = ?');
    params.push(patch.online ? 1 : 0);
  }
  if (patch.heartbeat) {
    sets.push('last_heartbeat_at = ?');
    params.push(at);
  }
  params.push(id);
  run(db, `UPDATE vehicles SET ${sets.join(', ')} WHERE id = ?`, params);
}

export interface TrackWriteRow {
  id: string;
  vehicleId: string;
  ts: string;
  x: number;
  y: number;
  status: string;
  speedMps: number;
  taskId: string | null;
}

export function insertTrack(db: Db, row: TrackWriteRow): void {
  run(
    db,
    `INSERT INTO vehicle_tracks (id, vehicle_id, ts, x, y, status, speed_mps, task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.vehicleId, row.ts, row.x, row.y, row.status, row.speedMps, row.taskId]
  );
}

export interface TrackQuery {
  vehicleId: string;
  taskId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/** 轨迹按时间**升序**返回：折线图与回放都要求点序与时间一致（倒序会让折线来回穿插）。 */
export function listTracks(db: Db, query: TrackQuery): { points: Array<Omit<TrackWriteRow, 'id' | 'vehicleId'>>; total: number } {
  const clauses = ['vehicle_id = ?'];
  const params: SqlParam[] = [query.vehicleId];
  if (query.taskId) {
    clauses.push('task_id = ?');
    params.push(query.taskId);
  }
  if (query.from) {
    clauses.push('ts >= ?');
    params.push(query.from);
  }
  if (query.to) {
    clauses.push('ts <= ?');
    params.push(query.to);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const total = Number(get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM vehicle_tracks ${where}`, params)?.total ?? 0);
  const limit = query.limit ?? 1000;
  const rows = all<{ ts: string; x: number; y: number; status: string; speed_mps: number; task_id: string | null }>(
    db,
    `SELECT ts, x, y, status, speed_mps, task_id FROM vehicle_tracks ${where} ORDER BY ts ASC, id ASC LIMIT ?`,
    [...params, limit]
  );
  return {
    points: rows.map((row) => ({
      ts: row.ts,
      x: row.x,
      y: row.y,
      status: row.status,
      speedMps: row.speed_mps,
      taskId: row.task_id
    })),
    total
  };
}

/**
 * 车辆 → 当前任务 id。
 *
 * 只认 `running` / `paused`：`assigned` 的车已经在候选池外，但**还没开始跑**，
 * 把它显示成「当前任务」会让监控页说一辆停着的车在执行（与 D-25
 * 「派生字段在读取层计算」同一思路）。
 */
export function runningTaskByVehicle(db: Db): Map<string, string> {
  const rows = all<{ assigned_vehicle_id: string; id: string }>(
    db,
    `SELECT assigned_vehicle_id, id FROM tasks
     WHERE status IN ('running', 'paused') AND assigned_vehicle_id IS NOT NULL`
  );
  return new Map(rows.map((row) => [row.assigned_vehicle_id, row.id]));
}

export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

/**
 * 取若干节点的平面坐标（执行器把 `node_ids` 折成折线用）。
 *
 * 返回 `Map` 而不是数组：调用方要按 `node_ids` 的**顺序**取坐标，
 * 而 SQL 的 `IN` 不保证顺序 —— 用返回值顺序拼折线会让车沿着乱序的点跑。
 */
export function nodePositions(db: Db, ids: string[]): Map<string, NodePosition> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = all<NodePosition>(
    db,
    `SELECT id, x, y FROM nodes WHERE id IN (${ids.map(() => '?').join(', ')})`,
    ids
  );
  return new Map(rows.map((row) => [row.id, row]));
}
