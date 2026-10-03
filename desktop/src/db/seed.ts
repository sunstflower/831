import bcrypt from 'bcryptjs';
import { SEED_ACCOUNTS, SETTINGS_SCHEMA, buildSeedDataset, settingsDefaults } from '@udm/shared';
import { all, nowIso, run, tx, type Db, type SqlParam } from './index.js';
import { loadCampusMap } from './campus-map-source.js';

/**
 * 种子数据（`docs/database.md` §4）。
 *
 * ## 本文件只做三件事
 *
 *   1. **取数**：把 `data/campus/` 的文件读进来（`campus-map-source.ts`）；
 *   2. **推导**：调用 `shared/src/seed-data.ts` 的 `buildSeedDataset()` ——
 *      节点 / 边 / 站点 / 禁行规则 / 车辆 / 模板 / 演示任务与路线的**唯一**推导处，
 *      浏览器 Mock 用的是同一个函数（D-27 的不变量从「两边各写一遍再比对」
 *      改成「只写一遍」）；
 *   3. **落库**：把推导结果写进各表（本文件剩下的部分）。
 *
 * 于是本文件里**没有业务数字**：路网规模、边长、权重、任务清单都在数据与推导里。
 *
 * ## 幂等
 *
 * 全部 `INSERT OR IGNORE` + 固定 id；两处例外会显式 UPDATE：
 *   - 演示执行任务把 AGV-01 置 `busy`（车辆运行态必须与任务状态自洽）；
 *   - 演示待派发任务的时间窗**跟着当前时刻走** —— 否则这份演示数据过一天就会因为
 *     「时间窗已过」而被全部拒绝，而拒绝原因看起来像业务问题。
 *     只在任务仍是 `pending` 时刷新：一旦被派发/执行，时间窗就是业务数据。
 */

function insertIgnore(db: Db, table: string, columns: string[], values: SqlParam[]): number {
  const result = run(db, `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders(columns)})`, values);
  return Number(result.changes ?? 0);
}

function placeholders(columns: readonly string[]): string {
  return columns.map(() => '?').join(', ');
}

export interface SeedSummary {
  nodes: number;
  edges: number;
  sites: number;
  restrictions: number;
  vehicles: number;
  templates: number;
  users: number;
  settings: number;
  tasks: number;
  routes: number;
  alerts: number;
}

export function seedDatabase(db: Db): SeedSummary {
  const at = nowIso();
  const map = loadCampusMap();
  const data = buildSeedDataset(map.pkg, { at });

  return tx(db, () => {
    // 顺序不可换：演示任务外键引用 stations/vehicles/templates，
    // 且路线引用 nodes/edges；必须等基础数据落库后再写。

    let nodes = 0;
    for (const node of data.nodes) {
      nodes += insertIgnore(
        db,
        'nodes',
        ['id', 'code', 'name', 'x', 'y', 'status', 'remark'],
        [node.id, node.code, node.name, node.x, node.y, node.status, node.remark]
      );
    }

    let edges = 0;
    for (const edge of data.edges) {
      edges += insertIgnore(
        db,
        'edges',
        ['id', 'from_node_id', 'to_node_id', 'length_m', 'speed_limit_mps', 'weight', 'status', 'remark'],
        [edge.id, edge.fromNodeId, edge.toNodeId, edge.lengthM, edge.speedLimitMps, edge.weight, edge.status, edge.remark]
      );
    }

    let sites = 0;
    for (const site of data.sites) {
      sites += insertIgnore(
        db,
        'sites',
        ['id', 'code', 'name', 'type', 'node_id', 'x', 'y', 'status', 'remark', 'created_at', 'updated_at', 'created_by'],
        [site.id, site.code, site.name, site.type, site.nodeId, site.x, site.y, site.status, site.remark, at, at, 'seed']
      );
    }

    // 禁行规则来自样本里的占道（`data/campus/README.md` §3），不是「预置的业务规则」
    let restrictions = 0;
    for (const rule of data.restrictions) {
      restrictions += insertIgnore(
        db,
        'restrictions',
        ['id', 'type', 'target_id', 'start_at', 'end_at', 'vehicle_type', 'reason', 'status', 'created_at', 'created_by'],
        [rule.id, rule.type, rule.targetId, rule.startAt, rule.endAt, rule.vehicleType, rule.reason, rule.status, at, 'seed']
      );
    }

    let vehicles = 0;
    for (const vehicle of data.vehicles) {
      vehicles += insertIgnore(
        db,
        'vehicles',
        [
          'id', 'code', 'name', 'type', 'status', 'capacity_kg', 'load_kg', 'max_speed_mps',
          'battery', 'x', 'y', 'current_node_id', 'online', 'last_heartbeat_at', 'created_at', 'updated_at'
        ],
        [
          vehicle.id, vehicle.code, vehicle.name, vehicle.type, vehicle.status, vehicle.capacityKg, vehicle.loadKg,
          vehicle.maxSpeedMps, vehicle.battery, vehicle.x, vehicle.y, vehicle.currentNodeId, vehicle.online ? 1 : 0,
          at, at, at
        ]
      );
    }

    let templates = 0;
    for (const template of data.templates) {
      templates += insertIgnore(
        db,
        'task_templates',
        ['id', 'code', 'name', 'priority', 'default_cargo_kg', 'time_window_minutes', 'from_site_type', 'to_site_type', 'created_at', 'updated_at'],
        [
          template.id, template.code, template.name, template.priority, template.defaultCargoKg,
          template.timeWindowMinutes, template.fromSiteType, template.toSiteType, at, at
        ]
      );
    }

    let users = 0;
    for (const account of SEED_ACCOUNTS) {
      users += insertIgnore(
        db,
        'users',
        ['id', 'username', 'password_hash', 'role', 'display_name', 'status', 'created_at', 'updated_at', 'created_by'],
        [account.id, account.username, bcrypt.hashSync(account.password, 10), account.role, account.displayName, 'active', at, at, 'seed']
      );
    }

    let settings = 0;
    const defaults = settingsDefaults();
    for (const item of SETTINGS_SCHEMA) {
      settings += insertIgnore(
        db,
        'settings',
        ['key', 'value', 'updated_at', 'updated_by'],
        [item.key, JSON.stringify(defaults[item.key]), at, 'seed']
      );
    }

    /*
     * 演示任务。
     *
     * 两条 UPDATE 是这份 seed 里唯一的写覆盖，都必须**限定在自己该管的那一行**：
     *   - 时间窗刷新只对仍为 `pending` 的行生效（已派发/执行的任务，时间窗是业务数据）；
     *   - AGV-01 置忙只对仍为 `idle` 的行生效（用户手动改过状态就不再覆盖）。
     */
    let tasks = 0;
    for (const task of data.tasks) {
      tasks += insertIgnore(
        db,
        'tasks',
        [
          'id', 'code', 'template_id', 'title', 'status', 'priority', 'cargo_kg', 'cargo_desc',
          'from_site_id', 'to_site_id', 'time_window_start', 'time_window_end',
          'assigned_vehicle_id', 'progress',
          'submitted_at', 'assigned_at', 'started_at', 'created_at', 'updated_at', 'created_by', 'updated_by'
        ],
        [
          task.id, task.code, task.templateId, task.title, task.status, task.priority, task.cargoKg, task.cargoDesc,
          task.fromSiteId, task.toSiteId, task.timeWindowStart, task.timeWindowEnd,
          task.assignedVehicleId, task.progress,
          task.submittedAt, task.assignedAt, task.startedAt, task.createdAt, task.createdAt, 'seed', 'seed'
        ]
      );
      if (task.status === 'pending') {
        run(
          db,
          `UPDATE tasks SET time_window_start = ?, time_window_end = ?, updated_at = ?
            WHERE id = ? AND status = 'pending'`,
          [task.timeWindowStart, task.timeWindowEnd, at, task.id]
        );
      }
    }

    let routes = 0;
    for (const route of [data.demoRoute]) {
      routes += insertIgnore(
        db,
        'routes',
        [
          'id', 'task_id', 'algorithm', 'from_node_id', 'to_node_id', 'via_node_ids', 'node_ids',
          'edge_ids', 'distance_m', 'duration_s', 'created_at', 'created_by'
        ],
        [
          route.id, route.taskId, route.algorithm, route.fromNodeId, route.toNodeId,
          JSON.stringify(route.viaNodeIds), JSON.stringify(route.nodeIds), JSON.stringify(route.edgeIds),
          route.distanceM, route.durationS, at, 'seed'
        ]
      );
    }

    const alerts = insertIgnore(
      db,
      'alerts',
      ['id', 'type', 'level', 'object_type', 'object_id', 'message', 'status', 'created_at'],
      [
        data.demoAlert.id,
        data.demoAlert.type,
        data.demoAlert.level,
        data.demoAlert.objectType,
        data.demoAlert.objectId,
        data.demoAlert.message,
        'new',
        at
      ]
    );

    // 车辆运行态：演示任务挂在哪台车上，那台车就必须是 busy 且载重与任务一致
    const demo = data.tasks.find((task) => task.status === 'running' && task.assignedVehicleId);
    if (demo?.assignedVehicleId) {
      const fromSite = data.sites.find((site) => site.id === demo.fromSiteId);
      run(
        db,
        `UPDATE vehicles SET status = 'busy', load_kg = ?, current_node_id = ?, x = ?, y = ?, updated_at = ?
          WHERE id = ? AND status = 'idle'`,
        [demo.cargoKg, fromSite?.nodeId ?? null, fromSite?.x ?? 0, fromSite?.y ?? 0, at, demo.assignedVehicleId]
      );
    }
    return { nodes, edges, sites, restrictions, vehicles, templates, users, settings, tasks, routes, alerts };
  });
}

export function countRows(db: Db, table: string): number {
  const row = all<{ total: number }>(db, `SELECT COUNT(*) AS total FROM ${table}`)[0];
  return row ? Number(row.total) : 0;
}
