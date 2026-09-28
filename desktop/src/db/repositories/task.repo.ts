/**
 * 任务读取 / 状态写入仓库（M3，`docs/api.md` §3.3）。
 *
 * **投影成 DTO 放在仓库层**（与 M2 的 `site.repo.ts` 同一理由）：`tasks` 表存的是
 * `from_site_id` / `assigned_vehicle_id`，而契约要的是 `fromSiteName` / `vehicleCode`
 * 这类**读时派生**字段（D-25）。把 join 与映射紧挨着产生这些列的 SQL，
 * 列改名时只需改一处；若把这层映射写进 `ipc/api.ts`，就会出现「SQL 改了、映射忘改」
 * 而两边都编译通过的情况。
 *
 * 本层**不做业务判断**：状态机在 `shared/src/task-state.ts`，跨表校验与审计在
 * `domain/task/task.service.ts`。
 */
import type {
  AlertLevel,
  AlertStatus,
  AlertType,
  TaskDetail,
  TaskListItem,
  TaskPriority,
  TaskStatus
} from '@udm/shared';
import { all, get, run, type Db } from '../index.js';

/** 列表与详情共用的选择串：两次 join 站点、一次 join 车辆。 */
const TASK_SELECT = `
  SELECT t.*,
         f.name AS from_site_name,
         o.name AS to_site_name,
         v.code AS vehicle_code
    FROM tasks t
    LEFT JOIN sites f ON f.id = t.from_site_id
    LEFT JOIN sites o ON o.id = t.to_site_id
    LEFT JOIN vehicles v ON v.id = t.assigned_vehicle_id`;

/**
 * 列表排序：**最新创建的在前**，`code` 作定序兜底。
 *
 * 分页接口必须有**全序**，否则同一页在两次请求之间可能重复或漏行。
 * 任务与 M2 的站点不同（按 `code` 升序）：任务的 `created_at` 是它唯一有意义的
 * 时间维度，而 `code` 在 seed 数据里可能与创建顺序不一致 —— 只按 `code` 排会让
 * 刚建的任务出现在列表中间。`code` 唯一，因此「两键排序」是全序。
 *
 * 浏览器 Mock 必须复述这一行（`ISS-059` 的教训：Mock 顺序与 SQL 不一致时，
 * 同一页在两种形态下是不同的行）。
 */
const TASK_ORDER = 'ORDER BY t.created_at DESC, t.code DESC';

interface TaskRow {
  id: string;
  code: string;
  template_id: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  cargo_kg: number;
  cargo_desc: string | null;
  from_site_id: string;
  to_site_id: string;
  time_window_start: string | null;
  time_window_end: string | null;
  assigned_vehicle_id: string | null;
  plan_id: string | null;
  progress: number;
  cancel_reason: string | null;
  fail_reason: string | null;
  pause_reason: string | null;
  submitted_at: string | null;
  assigned_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  failed_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  from_site_name: string | null;
  to_site_name: string | null;
  vehicle_code: string | null;
}

function toListItem(row: TaskRow): TaskListItem {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    status: row.status,
    priority: row.priority,
    cargoKg: row.cargo_kg,
    fromSiteId: row.from_site_id,
    toSiteId: row.to_site_id,
    fromSiteName: row.from_site_name,
    toSiteName: row.to_site_name,
    timeWindowStart: row.time_window_start,
    timeWindowEnd: row.time_window_end,
    assignedVehicleId: row.assigned_vehicle_id,
    vehicleCode: row.vehicle_code,
    progress: row.progress,
    createdAt: row.created_at,
    createdBy: row.created_by
  };
}

export interface TaskListQuery {
  /** 多个状态（契约允许逗号多值，见 `docs/api.md` §3.3.1）。空数组 = 不筛选。 */
  statuses?: readonly TaskStatus[];
  priority?: TaskPriority;
  vehicleId?: string;
  /** `timeWindowStart >= from`。 */
  from?: string;
  /** `timeWindowStart <= to`。 */
  to?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

export function listTasks(db: Db, query: TaskListQuery): { records: TaskListItem[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (query.statuses && query.statuses.length > 0) {
    // 用 `IN (?,?,…)` 而不是 `status = ?`：契约允许一次筛多个状态，
    // 而「多值」不能靠前端发多次请求来实现（那样分页会各算各的）
    clauses.push(`t.status IN (${query.statuses.map(() => '?').join(', ')})`);
    params.push(...query.statuses);
  }
  if (query.priority) {
    clauses.push('t.priority = ?');
    params.push(query.priority);
  }
  if (query.vehicleId) {
    clauses.push('t.assigned_vehicle_id = ?');
    params.push(query.vehicleId);
  }
  /*
   * 时间范围筛的是 `time_window_start`，且**未设时间窗的任务一律不出现在结果里**。
   *
   * 为什么不用 `COALESCE(time_window_start, created_at)`：那会让「没有时间窗」的任务
   * 以一个并不存在的时间参与筛选，使用者看到的行与他给的区间对不上。
   * 需要找没有时间窗的任务时，应当用「状态 + 关键词」，而不是把时间维度混进来。
   */
  if (query.from) {
    clauses.push('t.time_window_start IS NOT NULL AND t.time_window_start >= ?');
    params.push(query.from);
  }
  if (query.to) {
    clauses.push('t.time_window_start IS NOT NULL AND t.time_window_start <= ?');
    params.push(query.to);
  }
  if (query.keyword) {
    // 编码与标题都参与搜索：使用者手里可能是「T-DEMO-0001」也可能是一句话标题
    clauses.push('(t.code LIKE ? OR t.title LIKE ?)');
    params.push(`%${query.keyword}%`, `%${query.keyword}%`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number(
    get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM tasks t ${where}`, params)?.total ?? 0
  );
  const offset = (query.page - 1) * query.pageSize;
  const rows = all<TaskRow>(db, `${TASK_SELECT} ${where} ${TASK_ORDER} LIMIT ? OFFSET ?`, [
    ...params,
    query.pageSize,
    offset
  ]);
  return { records: rows.map(toListItem), total };
}

export function findTaskRowById(db: Db, id: string): TaskRow | undefined {
  return get<TaskRow>(db, `${TASK_SELECT} WHERE t.id = ?`, [id]);
}

/** 详情的基础部分（列表字段 + 只有详情才需要的列），供领域服务判「编辑前的旧值」。 */
export function findTaskById(db: Db, id: string): TaskListItem | undefined {
  const row = findTaskRowById(db, id);
  return row ? toListItem(row) : undefined;
}

/** 状态流转需要写的「时间戳列」：`submit` 写 `submitted_at`、`cancel` 写 `cancelled_at`…… */
export type TaskStampColumn =
  | 'submitted_at'
  | 'assigned_at'
  | 'started_at'
  | 'finished_at'
  | 'cancelled_at'
  | 'failed_at';

/** 固定映射（**不是**把调用方给的列名拼进 SQL）：列名只可能来自这张表。 */
const STAMP_SQL: Record<TaskStampColumn, string> = {
  submitted_at: 'submitted_at = ?',
  assigned_at: 'assigned_at = ?',
  started_at: 'started_at = ?',
  finished_at: 'finished_at = ?',
  cancelled_at: 'cancelled_at = ?',
  failed_at: 'failed_at = ?'
};

export interface TaskTransitionWrite {
  status: TaskStatus;
  at: string;
  updatedBy: string | null;
  /** 本次迁移要打的时间戳（可多个：apply 同时写 `assigned_at` 与 `started_at` 不会发生，故按需传）。 */
  stamps?: TaskStampColumn[];
  /** 取消 / 失败原因；`null` 表示清空（重排回候选池时用）。 */
  cancelReason?: string | null;
  failReason?: string | null;
  /** 暂停原因；`null` 表示清空（恢复执行时用）。 */
  pauseReason?: string | null;
  /** 清空派发痕迹（取消 / 重派时要回收车辆）。`null` 表示写成 NULL。 */
  assignedVehicleId?: string | null;
  planId?: string | null;
  progress?: number;
}

/**
 * 写状态（一个 UPDATE）。
 *
 * 为什么把「状态 + 时间戳 + 原因」合成一次 UPDATE：分两步写（先改状态、再补原因）
 * 会在中间留下一个「状态已变、原因没写」的窗口，而审计与事件都在事务提交之后发 ——
 * 一旦这时进程被杀，库里就多了一条**没有原因的取消**，事后无法解释。
 */
export function transitionTask(db: Db, id: string, write: TaskTransitionWrite): void {
  const sets: string[] = ['status = ?', 'updated_at = ?', 'updated_by = ?'];
  const params: Array<string | number | null> = [write.status, write.at, write.updatedBy];
  for (const stamp of write.stamps ?? []) {
    sets.push(STAMP_SQL[stamp]);
    params.push(write.at);
  }
  if (write.cancelReason !== undefined) {
    sets.push('cancel_reason = ?');
    params.push(write.cancelReason);
  }
  if (write.failReason !== undefined) {
    sets.push('fail_reason = ?');
    params.push(write.failReason);
  }
  if (write.pauseReason !== undefined) {
    sets.push('pause_reason = ?');
    params.push(write.pauseReason);
  }
  if (write.assignedVehicleId !== undefined) {
    sets.push('assigned_vehicle_id = ?');
    params.push(write.assignedVehicleId);
  }
  if (write.planId !== undefined) {
    sets.push('plan_id = ?');
    params.push(write.planId);
  }
  if (write.progress !== undefined) {
    sets.push('progress = ?');
    params.push(write.progress);
  }
  params.push(id);
  run(db, `UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params);
}

export interface TaskWriteRow {
  id: string;
  code: string;
  templateId: string | null;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  cargoKg: number;
  cargoDesc: string | null;
  fromSiteId: string;
  toSiteId: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  at: string;
  actorName: string | null;
}

export function insertTask(db: Db, row: TaskWriteRow): void {
  run(
    db,
    `INSERT INTO tasks (id, code, template_id, title, status, priority, cargo_kg, cargo_desc,
                        from_site_id, to_site_id, time_window_start, time_window_end,
                        progress, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [
      row.id,
      row.code,
      row.templateId,
      row.title,
      row.status,
      row.priority,
      row.cargoKg,
      row.cargoDesc,
      row.fromSiteId,
      row.toSiteId,
      row.timeWindowStart,
      row.timeWindowEnd,
      row.at,
      row.at,
      row.actorName,
      row.actorName
    ]
  );
}

export interface TaskEditPatch {
  title?: string;
  priority?: TaskPriority;
  cargoKg?: number;
  cargoDesc?: string | null;
  fromSiteId?: string;
  toSiteId?: string;
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
}

/**
 * 编辑可改列。
 *
 * `status` / `assigned_vehicle_id` / `code` / `template_id` 都**不在**这里：
 * 前三个由状态机与调度管，`template_id` 只在创建时写（见 `task-rules.ts` 的说明）。
 * 把它们漏进这张映射，就会出现「一次 PUT 顺手改了状态」而状态机根本没参与的路径。
 */
export function updateTaskRow(db: Db, id: string, patch: TaskEditPatch, at: string, updatedBy: string | null): void {
  const sets: string[] = ['updated_at = ?', 'updated_by = ?'];
  const params: Array<string | number | null> = [at, updatedBy];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.priority !== undefined) {
    sets.push('priority = ?');
    params.push(patch.priority);
  }
  if (patch.cargoKg !== undefined) {
    sets.push('cargo_kg = ?');
    params.push(patch.cargoKg);
  }
  if (patch.cargoDesc !== undefined) {
    sets.push('cargo_desc = ?');
    params.push(patch.cargoDesc);
  }
  if (patch.fromSiteId !== undefined) {
    sets.push('from_site_id = ?');
    params.push(patch.fromSiteId);
  }
  if (patch.toSiteId !== undefined) {
    sets.push('to_site_id = ?');
    params.push(patch.toSiteId);
  }
  if (patch.timeWindowStart !== undefined) {
    sets.push('time_window_start = ?');
    params.push(patch.timeWindowStart);
  }
  if (patch.timeWindowEnd !== undefined) {
    sets.push('time_window_end = ?');
    params.push(patch.timeWindowEnd);
  }
  params.push(id);
  run(db, `UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params);
}

/**
 * 物理删除（仅 `draft`，由状态机与领域服务双重把关）。
 *
 * 删除前先把「指向它的行」处理掉：`dispatch_plans` / `routes` 都有 `task_id` 外键。
 * 草稿任务按定义不可能有这两者，但**不依赖这个前提** —— 若哪天有别的路径给草稿建了计划，
 * 外键会直接抛错（好过留下悬空引用）。
 */
export function deleteTask(db: Db, id: string): void {
  run(db, 'DELETE FROM dispatch_plans WHERE task_id = ?', [id]);
  run(db, 'DELETE FROM routes WHERE task_id = ?', [id]);
  run(db, 'DELETE FROM tasks WHERE id = ?', [id]);
}

/** 计划摘要（`currentPlan`）：只认 `applied` —— `superseded` / `cancelled` 是历史，不该显示成「当前计划」。 */
export function findAppliedPlan(db: Db, taskId: string): TaskDetail['currentPlan'] {
  const row = get<{
    id: string;
    vehicle_id: string;
    vehicle_code: string | null;
    strategy: string;
    cost: number;
    route_id: string | null;
    applied_at: string | null;
  }>(
    db,
    `SELECT p.id, p.vehicle_id, v.code AS vehicle_code, p.strategy, p.cost, p.route_id, p.applied_at
       FROM dispatch_plans p
       LEFT JOIN vehicles v ON v.id = p.vehicle_id
      WHERE p.task_id = ? AND p.status = 'applied'
      ORDER BY p.created_at DESC
      LIMIT 1`,
    [taskId]
  );
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    vehicleCode: row.vehicle_code,
    strategy: row.strategy,
    cost: row.cost,
    routeId: row.route_id,
    appliedAt: row.applied_at
  };
}

/** 路线摘要。优先取当前计划指向的那条；没有计划时退回「最近生成的一条」。 */
export function findTaskRoute(db: Db, taskId: string, routeId: string | null): TaskDetail['route'] {
  const row = get<{
    id: string;
    distance_m: number;
    duration_s: number;
    algorithm: string;
    node_ids: string;
    edge_ids: string;
  }>(
    db,
    routeId
      ? 'SELECT id, distance_m, duration_s, algorithm, node_ids, edge_ids FROM routes WHERE id = ?'
      : 'SELECT id, distance_m, duration_s, algorithm, node_ids, edge_ids FROM routes WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
    [routeId ?? taskId]
  );
  if (!row) {
    return null;
  }
  // 节点数与边数从 JSON 列现算：它们是**派生**的，存两份必然有一天不一致（D-25）
  return {
    id: row.id,
    distanceM: row.distance_m,
    durationS: row.duration_s,
    algorithm: row.algorithm,
    nodeCount: parseJsonArray(row.node_ids).length,
    edgeCount: parseJsonArray(row.edge_ids).length
  };
}

function parseJsonArray(text: string): unknown[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // 坏 JSON 不该让整个详情接口 500：这两列是展示用的统计，返回 0 比报错更有用
    return [];
  }
}

/** 关联的未归档告警。归档的告警不再占据注意力，因此不进详情（`docs/api.md` §3.3.2）。 */
export function findTaskAlerts(db: Db, taskId: string): TaskDetail['alerts'] {
  return all<{
    id: string;
    type: AlertType;
    level: AlertLevel;
    status: AlertStatus;
    message: string;
  }>(
    db,
    `SELECT id, type, level, status, message FROM alerts
      WHERE object_type = 'task' AND object_id = ? AND status <> 'archived'
      ORDER BY created_at DESC`,
    [taskId]
  );
}

/** 最近 5 条操作。为什么是 5 条：详情页是「一眼看现状」的地方，全量留痕在 M9 查。 */
export function findTaskAuditSummaries(db: Db, taskId: string): TaskDetail['auditSummaries'] {
  return all<{ ts: string; action: string; actorName: string | null; message: string | null }>(
    db,
    `SELECT ts, action, actor_name AS actorName, message FROM audit_logs
      WHERE object_type = 'task' AND object_id = ?
      ORDER BY ts DESC
      LIMIT 5`,
    [taskId]
  );
}

/**
 * 任务详情（`GET /api/tasks/{id}`）。
 *
 * 五个部分**一次拼好**：详情页要同时显示列表字段、计划、路线、未归档告警与最近操作，
 * 拆成五个接口会让这一页发五次请求，而它们之间没有一致性问题需要分开处理
 * （都在同一个进程、同一份库上读）。组合放在仓库层而非服务层：跨表查询属本层职责
 * （`docs/module-M2-base-data.md` §3 边界约束 1）。
 */
export function getTaskDetail(db: Db, id: string): TaskDetail | undefined {
  const row = findTaskRowById(db, id);
  if (!row) {
    return undefined;
  }
  const plan = findAppliedPlan(db, id);
  return {
    ...toListItem(row),
    templateId: row.template_id,
    cargoDesc: row.cargo_desc,
    cancelReason: row.cancel_reason,
    failReason: row.fail_reason,
    pauseReason: row.pause_reason,
    submittedAt: row.submitted_at,
    assignedAt: row.assigned_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cancelledAt: row.cancelled_at,
    failedAt: row.failed_at,
    updatedAt: row.updated_at,
    currentPlan: plan,
    route: findTaskRoute(db, id, plan?.routeId ?? null),
    alerts: findTaskAlerts(db, id),
    auditSummaries: findTaskAuditSummaries(db, id)
  };
}

/**
 * 生成下一个任务编码 `T<yyyyMMdd>-NNNN`（`docs/api.md` §3.3.7 的示例形态）。
 *
 * 为什么在库上算而不是拿随机数：编码是给人复述的（电话里说「T20260926-0003」），
 * 必须短、可读、按天有序。同一天内用当天已有的**最大值 +1**，
 * 于是删除中间某条再新建也不会撞号（`code` 上还有 UNIQUE 兜底）。
 *
 * 调用点都在事务里：同一进程内不会有两条并发请求读到同一个最大值
 * （`node:sqlite` 的同步 API + `tx()` 的单连接事务）。
 */
export function nextTaskCode(db: Db, serviceDate: string): string {
  const prefix = `T${serviceDate}-`;
  const row = get<{ code: string }>(
    db,
    'SELECT code FROM tasks WHERE code LIKE ? ORDER BY code DESC LIMIT 1',
    [`${prefix}%`]
  );
  const next = row ? Number(row.code.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(Number.isFinite(next) ? next : 1).padStart(4, '0')}`;
}

/**
 * 回收任务名下的计划。
 *
 * `cancel` 与 `reassign` 都要先把「原计划」从 `applied` 上摘下来，否则
 * `findAppliedPlan` 会一直认为任务还有一份生效中的计划，而任务已经回到候选池 ——
 * 详情页于是显示「当前计划：AGV-01」+「状态：待派发」这种自相矛盾的组合。
 *
 * `superseded`（被替代）与 `cancelled`（被取消）不是同义词：重派时原计划是被**替换**的，
 * 取消时它才是被作废的。两者都保留在表里可回溯（D-04：旧计划不删除）。
 */
export function releaseTaskPlans(db: Db, taskId: string, next: 'superseded' | 'cancelled'): number {
  const before = get<{ total: number }>(
    db,
    "SELECT COUNT(*) AS total FROM dispatch_plans WHERE task_id = ? AND status = 'applied'",
    [taskId]
  );
  run(db, "UPDATE dispatch_plans SET status = ? WHERE task_id = ? AND status = 'applied'", [next, taskId]);
  return Number(before?.total ?? 0);
}
