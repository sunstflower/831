/**
 * 组装 `DispatchSnapshot`（`docs/module-M4-dispatch.md` §2.2 / §10.1 第 2 步）。
 *
 * ## 为什么这一步单独成文件
 *
 * 它是**唯一读库的地方**：把 SQLite 的行翻译成算法要的中立形状。算法层
 * （`shared/src/dispatch-*.ts`）因此完全不认识「站点」「SQL」这些概念，
 * 也就没有第二个人再写一遍这套翻译。
 *
 * ## 站点 → 路网节点：本模块最容易出错的一处
 *
 * `tasks` 存的是 `from_site_id` / `to_site_id`（站点），而路线搜索要的是**节点**。
 * 站点到节点有两条路：`sites.node_id`（可为空，D-30 的过渡态）与 `sites.edge_id`（边绑定）。
 * 这里只认 `node_id`：**边绑定的站点暂时无法参与调度**，因为「停在边上的泊位的坐标」
 * 不能直接当作图上的一个点。这种情况必须**在预览阶段就报出来**（字段级可引导的错误），
 * 而不是让算法拿到一个 `undefined` 然后报「不可达」—— 后者会让调度员去查路网，
 * 而真正的问题在站点配置。
 */
import { DISPATCH_COST_WEIGHTS } from '@udm/shared';
import type {
  DispatchSnapshot,
  DispatchTaskView,
  DispatchVehicleView,
  OccupiedSlot,
  RouteEdgeInput,
  RouteNodeInput,
  RouteRestrictionInput
} from '@udm/shared';
import { all, get, type Db } from '../../db/index.js';
import { latestOccupiedTo, listActiveOccupiedSlots } from '../../db/repositories/dispatch-plan.repo.js';

/**
 * 快照组装失败。
 *
 * 用异常而不是返回值：组装失败时**没有任何可用的快照**，返回 `null` 会让每个调用点
 * 都要写一遍「为空怎么办」，而那些分支最终会写出各不相同的错误文案。
 */
export class SnapshotProblem extends Error {
  constructor(
    message: string,
    readonly detail: Record<string, unknown>
  ) {
    super(message);
    this.name = 'SnapshotProblem';
  }
}

interface TaskSnapshotRow {
  id: string;
  code: string;
  priority: DispatchTaskView['priority'];
  cargo_kg: number;
  status: string;
  time_window_start: string | null;
  time_window_end: string | null;
  from_node_id: string | null;
  from_site_code: string | null;
  to_node_id: string | null;
  to_site_code: string | null;
}

interface VehicleSnapshotRow {
  id: string;
  code: string;
  type: DispatchVehicleView['type'];
  status: DispatchVehicleView['status'];
  capacity_kg: number;
  load_kg: number;
  battery: number;
  max_speed_mps: number;
  x: number;
  y: number;
  current_node_id: string | null;
}

interface NodeSnapshotRow {
  id: string;
  x: number;
  y: number;
  status: RouteNodeInput['status'];
}

interface EdgeSnapshotRow {
  id: string;
  from_node_id: string;
  to_node_id: string;
  length_m: number;
  speed_limit_mps: number | null;
  weight: number;
  status: RouteEdgeInput['status'];
}

interface RestrictionSnapshotRow {
  id: string;
  start_at: string | null;
  end_at: string | null;
  vehicle_type: RouteRestrictionInput['vehicleType'];
  status: RouteRestrictionInput['status'];
}

/**
 * 取任务并把站点解析成节点。
 *
 * 三种失败给三种 detail：任务不存在（`missingTaskIds`）、站点不存在（`siteCode`）、
 * 站点没绑节点（`siteCode` + `field`）。分开是为了让调用点能翻译成**不同的错误码** ——
 * 合并成一句「参数错误」会让使用者不知道该去哪一页修。
 */
export function loadTaskViews(db: Db, taskIds: readonly string[]): DispatchTaskView[] {
  if (taskIds.length === 0) {
    return [];
  }
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = all<TaskSnapshotRow>(
    db,
    `SELECT t.id, t.code, t.priority, t.cargo_kg, t.status,
            t.time_window_start, t.time_window_end,
            f.node_id AS from_node_id, f.code AS from_site_code,
            o.node_id AS to_node_id, o.code AS to_site_code
       FROM tasks t
       LEFT JOIN sites f ON f.id = t.from_site_id
       LEFT JOIN sites o ON o.id = t.to_site_id
      WHERE t.id IN (${placeholders})`,
    [...taskIds]
  );

  const found = new Set(rows.map((row) => row.id));
  const missing = taskIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new SnapshotProblem('任务不存在', { missingTaskIds: missing });
  }

  return rows.map((row) => {
    if (!row.from_site_code || !row.to_site_code) {
      throw new SnapshotProblem('任务的起终点站点不存在', { taskId: row.id, code: row.code });
    }
    for (const [side, nodeId, siteCode, field] of [
      ['起点', row.from_node_id, row.from_site_code, 'fromSiteId'],
      ['终点', row.to_node_id, row.to_site_code, 'toSiteId']
    ] as const) {
      if (!nodeId) {
        throw new SnapshotProblem(`${side}站点 ${siteCode} 未绑定路网节点，无法规划路线`, {
          taskId: row.id,
          code: row.code,
          field,
          siteCode
        });
      }
    }
    return {
      id: row.id,
      code: row.code,
      priority: row.priority,
      cargoKg: row.cargo_kg,
      fromNodeId: row.from_node_id as string,
      toNodeId: row.to_node_id as string,
      timeWindowStart: row.time_window_start,
      timeWindowEnd: row.time_window_end
    };
  });
}

/**
 * 任务的当前状态（调用方据此判 `TASK.STATE_CONFLICT`）。
 *
 * **与 `loadTaskViews` 分开读**：状态要用**提交前的**那一份来判，而视图要带上时间窗。
 * 合成一次读会让「先判状态、再取快照」的顺序消失，而那个顺序正是 §10.2 的乐观锁前提。
 */
export function loadTaskStatuses(db: Db, taskIds: readonly string[]): Map<string, string> {
  if (taskIds.length === 0) {
    return new Map();
  }
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = all<{ id: string; status: string }>(
    db,
    `SELECT id, status FROM tasks WHERE id IN (${placeholders})`,
    [...taskIds]
  );
  return new Map(rows.map((row) => [row.id, row.status]));
}

export function loadVehicleViews(db: Db, now: string): DispatchVehicleView[] {
  const rows = all<VehicleSnapshotRow>(
    db,
    `SELECT id, code, type, status, capacity_kg, load_kg, battery, max_speed_mps, x, y, current_node_id
       FROM vehicles
      ORDER BY code`
  );
  const freeAt = latestOccupiedTo(
    db,
    rows.map((row) => row.id)
  );
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    type: row.type,
    status: row.status,
    capacityKg: row.capacity_kg,
    loadKg: row.load_kg,
    battery: row.battery,
    maxSpeedMps: row.max_speed_mps,
    x: row.x,
    y: row.y,
    startNodeId: row.current_node_id,
    // 没有任何占用时 `freeAt` 就是 `now`：算法内部再取 `max(now, freeAt)`，
    // 这里给 `now` 只是为了让字段**永远有值**（可空会让算法多一条没有意义的分支）
    freeAt: freeAt.get(row.id) ?? now
  }));
}

export function loadGraphInputs(db: Db): { nodes: RouteNodeInput[]; edges: RouteEdgeInput[] } {
  const nodes = all<NodeSnapshotRow>(db, 'SELECT id, x, y, status FROM nodes ORDER BY id').map((row) => ({
    id: row.id,
    x: row.x,
    y: row.y,
    status: row.status
  }));
  const edges = all<EdgeSnapshotRow>(
    db,
    'SELECT id, from_node_id, to_node_id, length_m, speed_limit_mps, weight, status FROM edges ORDER BY id'
  ).map((row) => ({
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    lengthM: row.length_m,
    speedLimitMps: row.speed_limit_mps,
    weight: row.weight ?? 1,
    status: row.status
  }));
  return { nodes, edges };
}

/**
 * 生效中的禁行规则（D-35）。
 *
 * 两类目标都要读：只读 `node` 会让「某条路封了」在构图时静默消失 ——
 * 而封路的后果是车辆被派进一条走不通的路线。`status = 'active'` 之外还要看时间窗，
 * 那一步由 `buildRouteGraph` 按 `at` 判（同一份实现，不在 SQL 里再写一遍）。
 */
export function loadRestrictionInputs(db: Db): RouteRestrictionInput[] {
  const rows = all<RestrictionSnapshotRow & { type: 'node' | 'edge' }>(
    db,
    `SELECT type, target_id AS id, start_at, end_at, vehicle_type, status
       FROM restrictions
      WHERE status = 'active'
      ORDER BY type, target_id`
  );
  return rows.map((row) => ({
    type: row.type,
    targetId: row.id,
    startAt: row.start_at,
    endAt: row.end_at,
    vehicleType: row.vehicle_type,
    status: row.status
  }));
}

export interface BuildSnapshotOptions {
  taskIds: readonly string[];
  now: string;
  /** 占用槽要排除的任务（重算场景：任务自己的旧计划不该把自己挡住）。 */
  excludeOccupiedTaskIds?: readonly string[];
}

/** 组装一份完整快照。**每次调用都实时读库**，不跨调用缓存（§2.2）。 */
export function buildSnapshot(db: Db, options: BuildSnapshotOptions): DispatchSnapshot {
  const tasks = loadTaskViews(db, options.taskIds);
  const { nodes, edges } = loadGraphInputs(db);
  const occupiedSlots: OccupiedSlot[] = listActiveOccupiedSlots(db, {
    excludeTaskIds: options.excludeOccupiedTaskIds ?? []
  }).map((slot) => ({ taskId: slot.taskId, vehicleId: slot.vehicleId, from: slot.from, to: slot.to }));

  return {
    tasks,
    vehicles: loadVehicleViews(db, options.now),
    nodes,
    edges,
    restrictions: loadRestrictionInputs(db),
    occupiedSlots,
    // 权重是常量（D-12：P4 不进设置表），这里只是把唯一作者「搬过来」
    weights: { ...DISPATCH_COST_WEIGHTS },
    now: options.now
  };
}

/**
 * 快照指纹：`任务:状态` 列表 + idle 车辆数。
 *
 * 只用于 `dispatch_logs.input_snapshot` 的排查留痕，**不参与任何业务判断** ——
 * 判定「快照是否过期」用的是条件 UPDATE（§10.2），不是这个字符串。
 * 若把它当成判据，就会出现「指纹相同结论就相同」的暗示，而它并不保证那件事。
 */
export function snapshotFingerprint(db: Db, taskIds: readonly string[]): string {
  const statuses = loadTaskStatuses(db, taskIds);
  const parts = [...statuses.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, status]) => `${id}:${status}`);
  const idle = get<{ total: number }>(db, "SELECT COUNT(*) AS total FROM vehicles WHERE status = 'idle'")?.total;
  return `${parts.join(',')}|idle:${Number(idle ?? 0)}`;
}
