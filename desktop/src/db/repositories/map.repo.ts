import type {
  AlertStatus,
  AlertType,
  AlertLevel,
  MapOverview,
  ObjectType,
  SiteType,
  TaskStatus,
  VehicleStatus
} from '@udm/shared';
import { all, get, type Db } from '../index.js';

/**
 * 地图概览快照（`GET /api/map/overview`）的读取层。
 *
 * 设计要点：
 *
 * 1. **一次查询集，同一时刻**。所有图层都由同一连接在同一批 SQL 中读出，
 *    避免渲染层拼多次请求导致「路网与车辆来自不同时刻」（Req-M6-5 / D-21）。
 *    SQLite 在单连接下顺序执行，这里不再另开事务：读不产生中间态，
 *    且包事务会与 WAL 写事务互相等待。
 * 2. **`eventSeq` 取自 `event_log` 当前最大 seq**（不是 `COUNT(*)`）。
 *    `seq` 是 AUTOINCREMENT 主键，事件删除后仍单调递增；渲染层用它做去重水位线，
 *    用 COUNT 会因为删除事件而回退，导致去重失效、事件被重复处理。
 * 3. **只读 enabled/active 之外的状态照样返回**，由渲染层决定置灰：
 *    接口不替前端做视觉决策，disabled 的路网与 superseded 的路线都要能看到。
 */

interface NodeRow {
  id: string;
  code: string;
  x: number;
  y: number;
  status: string;
}

interface EdgeRow {
  id: string;
  from_node_id: string;
  to_node_id: string;
  length_m: number;
  speed_limit_mps: number | null;
  status: string;
}

interface SiteRow {
  id: string;
  code: string;
  name: string;
  type: string;
  node_id: string | null;
  x: number;
  y: number;
  status: string;
}

interface VehicleRow {
  id: string;
  code: string;
  status: string;
  x: number;
  y: number;
  battery: number;
}

/**
 * 车辆当前任务：取「未结束任务」中最近指派的一条。
 *
 * 车辆的 `taskId` 是**派生值**而非库中列：`vehicles` 表不存任务，
 * 真实来源是 `tasks.assigned_vehicle_id`。若反过来在车辆上冗余一列，
 * 任务改派时就可能出现两处不一致（D-07 的引用完整性思路）。
 */
interface VehicleTaskRow {
  vehicle_id: string;
  task_id: string;
}

interface TaskRow {
  id: string;
  code: string;
  status: string;
  from_site_id: string;
  to_site_id: string;
  assigned_vehicle_id: string | null;
  progress: number;
}

/**
 * `routes` 表**没有 status 列** —— 路线的「当前/被取代」状态记在 `dispatch_plans.status`
 * 上（`docs/database.md` §2.6）。因此路线状态是**派生值**，由 `route_id` 反查计划得出：
 *
 * | dispatch_plans.status | 路线语义 |
 * | --- | --- |
 * | `applied` | 当前生效计划所用路线 → `active` |
 * | `superseded` / `cancelled` | 已被取代/作废 → 同名状态 |
 * | 无关联计划 | 手工规划产出、未走派发 → 视为 `active` |
 *
 * 若按 `routes` 逐行判状态而无视这一层，会把「新计划生效、旧计划置 superseded」
 * 的旧路线当成当前路线画到图上（D-04 的版本化就会失效）。
 */
interface RouteRow {
  id: string;
  task_id: string | null;
  node_ids: string;
}

interface AlertRow {
  id: string;
  type: string;
  level: string;
  status: string;
  object_type: string;
  object_id: string | null;
}

/** `routes` 表不直接存车辆，经 `tasks.assigned_vehicle_id` 关联。 */
interface RouteVehicleRow {
  route_id: string;
  vehicle_id: string;
}

/** 车辆「当前任务」等价于这些未终结状态。 */
const OPEN_TASK_STATUSES = ['pending', 'assigned', 'running', 'paused'] as const;

function parseNodeIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    // 单条脏数据不应让整张地图白屏：退化为空路线并交由渲染层跳过
    return [];
  }
}

/**
 * 事件游标（单调不减的水位线）。
 *
 * 取 `sqlite_sequence` 而非 `MAX(seq)`：后者在**最高位那条事件被删除后会回退**
 * （实测：插入两条后删掉第二条，`MAX(seq)` 从 2 掉回 1）。
 * 渲染层用该值丢弃重放/乱序事件，一旦回退就会把旧事件当新事件重放一遍。
 * `event_log.seq` 是 AUTOINCREMENT，`sqlite_sequence` 记录的是「历史分配过的最大值」，
 * 删除行不会让它变小，正是水位线需要的语义。
 *
 * 表尚无任何事件时 `sqlite_sequence` 无对应行，回退到 0。
 */
function readEventSeq(db: Db): number {
  const row = get<{ seq: number | null }>(db, "SELECT seq FROM sqlite_sequence WHERE name = 'event_log'");
  return Number(row?.seq ?? 0);
}

export function getMapOverview(db: Db): MapOverview {
  const nodes = all<NodeRow>(db, 'SELECT id, code, x, y, status FROM nodes ORDER BY code').map((row) => ({
    id: row.id,
    code: row.code,
    x: row.x,
    y: row.y,
    status: row.status as 'enabled' | 'disabled'
  }));

  const edges = all<EdgeRow>(
    db,
    'SELECT id, from_node_id, to_node_id, length_m, speed_limit_mps, status FROM edges ORDER BY id'
  ).map((row) => ({
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    lengthM: row.length_m,
    speedLimitMps: row.speed_limit_mps,
    status: row.status as 'enabled' | 'disabled'
  }));

  const sites = all<SiteRow>(db, 'SELECT id, code, name, type, node_id, x, y, status FROM sites ORDER BY code').map(
    (row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      type: row.type as SiteType,
      nodeId: row.node_id,
      x: row.x,
      y: row.y,
      status: row.status as 'enabled' | 'disabled'
    })
  );

  const placeholder = OPEN_TASK_STATUSES.map(() => '?').join(', ');
  const vehicleTasks = all<VehicleTaskRow>(
    db,
    `SELECT assigned_vehicle_id AS vehicle_id, id AS task_id
       FROM tasks
      WHERE assigned_vehicle_id IS NOT NULL
        AND status IN (${placeholder})
      ORDER BY assigned_at DESC, created_at DESC`,
    [...OPEN_TASK_STATUSES]
  );
  // 一车一任务：按「最近指派」取首条，后者不覆盖前者
  const taskByVehicle = new Map<string, string>();
  for (const row of vehicleTasks) {
    if (!taskByVehicle.has(row.vehicle_id)) {
      taskByVehicle.set(row.vehicle_id, row.task_id);
    }
  }

  const vehicles = all<VehicleRow>(db, 'SELECT id, code, status, x, y, battery FROM vehicles ORDER BY code').map(
    (row) => ({
      id: row.id,
      code: row.code,
      status: row.status as VehicleStatus,
      x: row.x,
      y: row.y,
      battery: row.battery,
      taskId: taskByVehicle.get(row.id) ?? null
    })
  );

  // 地图只关心「在跑的/待跑的」，已终结任务不上图（否则历史任务会长期堆积在画布上）
  const tasks = all<TaskRow>(
    db,
    `SELECT id, code, status, from_site_id, to_site_id, assigned_vehicle_id, progress
       FROM tasks
      WHERE status IN (${placeholder})
      ORDER BY created_at ASC`,
    [...OPEN_TASK_STATUSES]
  ).map((row) => ({
    id: row.id,
    code: row.code,
    status: row.status as TaskStatus,
    fromSiteId: row.from_site_id,
    toSiteId: row.to_site_id,
    vehicleId: row.assigned_vehicle_id,
    progress: row.progress
  }));

  const routeVehicles = all<RouteVehicleRow>(
    db,
    `SELECT r.id AS route_id, t.assigned_vehicle_id AS vehicle_id
       FROM routes r
       JOIN tasks t ON t.id = r.task_id
      WHERE t.assigned_vehicle_id IS NOT NULL`
  );
  const vehicleByRoute = new Map(routeVehicles.map((row) => [row.route_id, row.vehicle_id]));

  // 路线状态派生自 dispatch_plans（见 RouteRow 注释）。
  // 同一路线理论上只被一个计划引用，取最新计划为准（万一有多条，后写的覆盖）。
  // 全部路线都返回（含被取代的），由渲染层按 `status` 决定「暗色细线」还是「高亮动画」——
  // 接口不替前端做取舍，否则计划版本对比（D-04）就没有数据可用。
  const routePlans = all<{ route_id: string; status: string }>(
    db,
    'SELECT route_id, status FROM dispatch_plans WHERE route_id IS NOT NULL ORDER BY created_at ASC'
  );
  const planStatusByRoute = new Map(routePlans.map((row) => [row.route_id, row.status]));

  /** `dispatch_plans.status` → 路线（`MapSnapshotRoute.status`）语义映射。 */
  const toRouteStatus = (planStatus: string | undefined): 'active' | 'superseded' | 'cancelled' => {
    switch (planStatus) {
      case 'superseded':
        return 'superseded';
      case 'cancelled':
        return 'cancelled';
      // `applied` 计划所用路线即当前路线；无关联计划 = 手工规划，同样视为生效中
      default:
        return 'active';
    }
  };

  const routes = all<RouteRow>(
    db,
    'SELECT id, task_id, node_ids FROM routes ORDER BY created_at ASC'
  ).map((row) => ({
    id: row.id,
    taskId: row.task_id,
    vehicleId: row.task_id ? vehicleByRoute.get(row.id) ?? null : null,
    nodeIds: parseNodeIds(row.node_ids),
    status: toRouteStatus(planStatusByRoute.get(row.id))
  }));

  // 只返回未归档告警：archived 属于「已处理完」的历史，挂在地图上会永远消不掉
  const alerts = all<AlertRow>(
    db,
    `SELECT id, type, level, status, object_type, object_id
       FROM alerts
      WHERE status <> 'archived' AND object_id IS NOT NULL
      ORDER BY created_at DESC`
  ).map((row) => ({
    id: row.id,
    type: row.type as AlertType,
    level: row.level as AlertLevel,
    status: row.status as AlertStatus,
    objectType: row.object_type as ObjectType,
    objectId: row.object_id as string
  }));

  const eventSeq = readEventSeq(db);

  return { nodes, edges, sites, vehicles, tasks, routes, alerts, eventSeq };
}
