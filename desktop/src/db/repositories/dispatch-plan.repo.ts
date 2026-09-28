/**
 * 调度计划仓库（M4，`docs/api.md` §3.4 / `docs/module-M4-dispatch.md` §10.2）。
 *
 * ## 这个文件里的 `…If` 函数是**乐观锁**，不是「顺手多写一个 WHERE」
 *
 * `assignTaskIfPending` / `reserveVehicleIfIdle` 都带一个**前置状态条件**，
 * 返回「改到了几行」。原因（`docs/module-M4-dispatch.md` §10.2 保护 1）：
 * 预览与 apply 之间隔着人的一次点击，这段时间里别人可能已经把任务取消了、
 * 或者把车派给了别的任务。若用无条件 UPDATE，两次派发会**同时成功** ——
 * 库里于是出现一辆车挂着两条 `applied` 计划，而两条计划的时间窗还互相重叠。
 * 条件更新把「谁先提交谁生效」交给 SQLite 自己判，`rowCount === 0` 的那一方回滚重来。
 *
 * 两个函数都**只做一次 UPDATE**，事务边界由调用方（`dispatch.service.ts`）持有。
 */
import type { DispatchStrategy, PlanStatus } from '@udm/shared';
import { all, get, run, type Db } from '../index.js';

export interface PlanWriteRow {
  id: string;
  requestId: string;
  taskId: string;
  vehicleId: string;
  strategy: DispatchStrategy;
  cost: number;
  costDetail: unknown;
  routeId: string;
  occupiedFrom: string;
  occupiedTo: string;
  snapshotId: string | null;
  appliedAt: string;
  appliedBy: string | null;
}

export function insertPlan(db: Db, row: PlanWriteRow): void {
  run(
    db,
    `INSERT INTO dispatch_plans (id, request_id, task_id, vehicle_id, strategy, status, cost, cost_detail,
                                 route_id, occupied_from, occupied_to, snapshot_id, applied_at, applied_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.requestId,
      row.taskId,
      row.vehicleId,
      row.strategy,
      row.cost,
      JSON.stringify(row.costDetail ?? {}),
      row.routeId,
      row.occupiedFrom,
      row.occupiedTo,
      row.snapshotId,
      row.appliedAt,
      row.appliedBy,
      row.appliedAt
    ]
  );
}

/**
 * 任务 `pending → assigned` 的**条件更新**（乐观锁）。返回改动的行数。
 *
 * `plan_id` 指向刚插入的 `dispatch_plans` 行：它是「当前生效计划」的指针，
 * 没有外键（`0001_init.sql` 刻意如此，见 §2.4 的表关系说明），因此必须先插计划再改任务。
 */
export function assignTaskIfPending(
  db: Db,
  input: { taskId: string; vehicleId: string; planId: string; at: string; actorName: string | null }
): number {
  const result = run(
    db,
    `UPDATE tasks
        SET status = 'assigned', assigned_vehicle_id = ?, plan_id = ?, assigned_at = ?,
            updated_at = ?, updated_by = ?
      WHERE id = ? AND status = 'pending'`,
    [input.vehicleId, input.planId, input.at, input.at, input.actorName, input.taskId]
  );
  return Number(result.changes ?? 0);
}

/** 车辆 `idle → reserved` 的**条件更新**（乐观锁）。返回改动的行数。 */
export function reserveVehicleIfIdle(db: Db, vehicleId: string, at: string): number {
  const result = run(
    db,
    "UPDATE vehicles SET status = 'reserved', updated_at = ? WHERE id = ? AND status = 'idle'",
    [at, vehicleId]
  );
  return Number(result.changes ?? 0);
}

/** 车辆回收（`busy` / `reserved → idle`）：重算与取消时用。返回改动的行数。 */
export function releaseVehicleIfBusy(db: Db, vehicleId: string, at: string): number {
  const result = run(
    db,
    "UPDATE vehicles SET status = 'idle', updated_at = ? WHERE id = ? AND status IN ('busy','reserved')",
    [at, vehicleId]
  );
  return Number(result.changes ?? 0);
}

/**
 * 该车是否还挂着**其它**生效中的计划（`excludeTaskIds` 之外）。
 *
 * ## 为什么回收车辆前必须问这一句
 *
 * 同一辆车可以在一批计划里**串行拉多单**（占用区间不重叠，见 `docs/module-M4-dispatch.md` §6）：
 * 例如「先送 B 仓、再送 A 仓」两条计划都挂在 CAR-01 上。此时回收其中一单
 * （重算 / 取消）如果无条件把车置 `idle`，就会出现
 * **车辆显示空闲、可它身上还挂着另一单未完成的计划** —— 于是下一次调度会把这辆车
 * 派出去，两条计划的占用区间真重叠，而库里查不出是哪一步错了。
 *
 * 所以「回收」的语义是「释放**这一单**的占用」，只有当这辆车不再被任何生效计划占用时
 * 才把状态改回 `idle`。
 */
export function hasOtherActivePlanForVehicle(db: Db, vehicleId: string, excludeTaskIds: readonly string[]): boolean {
  const excluded = excludeTaskIds.filter((id) => id.length > 0);
  const placeholders = excluded.map(() => '?').join(',');
  const filter = excluded.length > 0 ? `AND p.task_id NOT IN (${placeholders})` : '';
  const row = get<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n
       FROM dispatch_plans p
       JOIN tasks t ON t.id = p.task_id
      WHERE p.vehicle_id = ?
        AND p.status = 'applied'
        AND t.status IN ('assigned','running','paused')
        ${filter}`,
    [vehicleId, ...excluded]
  );
  return Number(row?.n ?? 0) > 0;
}

/** 某任务名下生效中的计划（用于重算前取「原计划」写进日志与审计）。 */
export interface AppliedPlanRow {
  id: string;
  taskId: string;
  vehicleId: string;
  routeId: string | null;
  occupiedFrom: string;
  occupiedTo: string;
  strategy: DispatchStrategy;
  cost: number;
}

export function listAppliedPlans(db: Db, taskIds: readonly string[]): AppliedPlanRow[] {
  if (taskIds.length === 0) {
    return [];
  }
  const placeholders = taskIds.map(() => '?').join(',');
  return all<{
    id: string;
    task_id: string;
    vehicle_id: string;
    route_id: string | null;
    occupied_from: string;
    occupied_to: string;
    strategy: DispatchStrategy;
    cost: number;
  }>(
    db,
    `SELECT id, task_id, vehicle_id, route_id, occupied_from, occupied_to, strategy, cost
       FROM dispatch_plans
      WHERE status = 'applied' AND task_id IN (${placeholders})
      ORDER BY occupied_from`,
    [...taskIds]
  ).map((row) => ({
    id: row.id,
    taskId: row.task_id,
    vehicleId: row.vehicle_id,
    routeId: row.route_id,
    occupiedFrom: row.occupied_from,
    occupiedTo: row.occupied_to,
    strategy: row.strategy,
    cost: row.cost
  }));
}

/**
 * **未完成**任务的占用槽（供候选筛选）。
 *
 * 只看 `assigned` / `running` / `paused` 三种状态下的任务：
 * `finished` / `cancelled` / `failed` 的任务虽然计划行还在（D-04：不删除），
 * 但车辆早已释放，把它们算进占用会让车辆**永远排不出空档**。
 */
export function listActiveOccupiedSlots(
  db: Db,
  options: { excludeTaskIds?: readonly string[] } = {}
): Array<{ taskId: string; vehicleId: string; from: string; to: string }> {
  const excluded = options.excludeTaskIds ?? [];
  const placeholders = excluded.map(() => '?').join(',');
  const filter = excluded.length > 0 ? `AND p.task_id NOT IN (${placeholders})` : '';
  return all<{ task_id: string; vehicle_id: string; occupied_from: string; occupied_to: string }>(
    db,
    `SELECT p.task_id, p.vehicle_id, p.occupied_from, p.occupied_to
       FROM dispatch_plans p
       JOIN tasks t ON t.id = p.task_id
      WHERE p.status = 'applied'
        AND t.status IN ('assigned','running','paused')
        ${filter}
      ORDER BY p.occupied_from`,
    [...excluded]
  ).map((row) => ({ taskId: row.task_id, vehicleId: row.vehicle_id, from: row.occupied_from, to: row.occupied_to }));
}

/** 一辆车已落库占用的最晚结束时刻（推导 `VehicleView.freeAt`，§6 区间规则 4）。 */
export function latestOccupiedTo(db: Db, vehicleIds: readonly string[]): Map<string, string> {
  if (vehicleIds.length === 0) {
    return new Map();
  }
  const placeholders = vehicleIds.map(() => '?').join(',');
  const rows = all<{ vehicle_id: string; latest: string }>(
    db,
    `SELECT p.vehicle_id, MAX(p.occupied_to) AS latest
       FROM dispatch_plans p
       JOIN tasks t ON t.id = p.task_id
      WHERE p.status = 'applied'
        AND t.status IN ('assigned','running','paused')
        AND p.vehicle_id IN (${placeholders})
      GROUP BY p.vehicle_id`,
    [...vehicleIds]
  );
  return new Map(rows.map((row) => [row.vehicle_id, row.latest]));
}

/** 计划状态流转（重算时把原计划置 `superseded`）。 */
export function setPlansStatus(db: Db, taskIds: readonly string[], from: PlanStatus, to: PlanStatus): number {
  if (taskIds.length === 0) {
    return 0;
  }
  const placeholders = taskIds.map(() => '?').join(',');
  const before = get<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM dispatch_plans WHERE status = ? AND task_id IN (${placeholders})`,
    [from, ...taskIds]
  );
  run(db, `UPDATE dispatch_plans SET status = ? WHERE status = ? AND task_id IN (${placeholders})`, [
    to,
    from,
    ...taskIds
  ]);
  return Number(before?.total ?? 0);
}
