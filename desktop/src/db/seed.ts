import bcrypt from 'bcryptjs';
import { SEED_ACCOUNTS, SEED_IDS, SETTINGS_SCHEMA, settingsDefaults } from '@udm/shared';
import { all, nowIso, run, tx, type Db, type SqlParam } from './index.js';

const GRID_COLS = 4;
const GRID_ROWS = 3;
const GRID_STEP_M = 20;

function nodeId(index: number): string {
  return `seed-n${String(index).padStart(2, '0')}`;
}

function nodeCode(index: number): string {
  return `N${String(index).padStart(2, '0')}`;
}

function nodePosition(index: number): { x: number; y: number } {
  const zeroBased = index - 1;
  const col = zeroBased % GRID_COLS;
  const row = Math.floor(zeroBased / GRID_COLS);
  return { x: col * GRID_STEP_M, y: row * GRID_STEP_M };
}

function insertIgnore(db: Db, table: string, columns: string[], values: SqlParam[]): number {
  const placeholders = columns.map(() => '?').join(', ');
  const result = run(db, `INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`, values);
  return Number(result.changes ?? 0);
}

function seedNodes(db: Db, at: string): number {
  let inserted = 0;
  for (let index = 1; index <= GRID_COLS * GRID_ROWS; index += 1) {
    const { x, y } = nodePosition(index);
    inserted += insertIgnore(
      db,
      'nodes',
      ['id', 'code', 'name', 'x', 'y', 'status'],
      [nodeId(index), nodeCode(index), `园区节点 ${index}`, x, y, 'enabled']
    );
  }
  return inserted;
}

function seedEdges(db: Db): number {
  let inserted = 0;
  for (let index = 1; index <= GRID_COLS * GRID_ROWS; index += 1) {
    const zeroBased = index - 1;
    const col = zeroBased % GRID_COLS;
    const row = Math.floor(zeroBased / GRID_COLS);
    const pairs: Array<[number, number]> = [];
    if (col < GRID_COLS - 1) {
      pairs.push([index, index + 1]);
    }
    if (row < GRID_ROWS - 1) {
      pairs.push([index, index + GRID_COLS]);
    }
    for (const [from, to] of pairs) {
      for (const [a, b] of [
        [from, to],
        [to, from]
      ] as Array<[number, number]>) {
        inserted += insertIgnore(
          db,
          'edges',
          ['id', 'from_node_id', 'to_node_id', 'length_m', 'status'],
          [`seed-e-${nodeCode(a)}-${nodeCode(b)}`, nodeId(a), nodeId(b), GRID_STEP_M, 'enabled']
        );
      }
    }
  }
  return inserted;
}

function seedSites(db: Db, at: string): number {
  const rows: Array<{ id: string; code: string; name: string; type: string; node: number }> = [
    { id: SEED_IDS.siteDepotA, code: 'A-01', name: 'A 仓库', type: 'depot', node: 1 },
    { id: SEED_IDS.siteDepotB, code: 'B-01', name: 'B 仓库', type: 'depot', node: 12 },
    { id: SEED_IDS.siteCharging, code: 'CHG-01', name: '充电桩', type: 'charging', node: 4 }
  ];
  let inserted = 0;
  for (const site of rows) {
    const { x, y } = nodePosition(site.node);
    inserted += insertIgnore(
      db,
      'sites',
      ['id', 'code', 'name', 'type', 'node_id', 'x', 'y', 'status', 'created_at', 'updated_at', 'created_by'],
      [site.id, site.code, site.name, site.type, nodeId(site.node), x, y, 'enabled', at, at, 'seed']
    );
  }
  return inserted;
}

function seedVehicles(db: Db, at: string): number {
  const rows: Array<{ id: string; code: string; name: string; type: string; capacity: number; speed: number; node: number }> = [
    { id: SEED_IDS.vehicleAgv, code: 'AGV-01', name: 'AGV 一号', type: 'agv', capacity: 500, speed: 1.5, node: 1 },
    { id: SEED_IDS.vehicleCarrier, code: 'CAR-01', name: '配送车一号', type: 'carrier', capacity: 800, speed: 3, node: 12 },
    { id: SEED_IDS.vehicleDrone, code: 'DRN-01', name: '无人机一号', type: 'drone', capacity: 50, speed: 5, node: 4 }
  ];
  let inserted = 0;
  for (const vehicle of rows) {
    const { x, y } = nodePosition(vehicle.node);
    inserted += insertIgnore(
      db,
      'vehicles',
      [
        'id',
        'code',
        'name',
        'type',
        'status',
        'capacity_kg',
        'load_kg',
        'max_speed_mps',
        'battery',
        'x',
        'y',
        'current_node_id',
        'online',
        'last_heartbeat_at',
        'created_at',
        'updated_at'
      ],
      [
        vehicle.id,
        vehicle.code,
        vehicle.name,
        vehicle.type,
        'idle',
        vehicle.capacity,
        0,
        vehicle.speed,
        100,
        x,
        y,
        nodeId(vehicle.node),
        1,
        at,
        at,
        at
      ]
    );
  }
  return inserted;
}

function seedTemplates(db: Db, at: string): number {
  const rows = [
    {
      id: SEED_IDS.templateStandard,
      code: 'TPL-STD',
      name: '仓到仓标准配送',
      priority: 'normal',
      cargo: 100,
      minutes: 60,
      from: 'depot',
      to: 'depot'
    },
    {
      id: SEED_IDS.templateCharging,
      code: 'TPL-CHG',
      name: '仓到充电桩回充',
      priority: 'low',
      cargo: 0,
      minutes: 120,
      from: 'depot',
      to: 'charging'
    }
  ];
  let inserted = 0;
  for (const template of rows) {
    inserted += insertIgnore(
      db,
      'task_templates',
      ['id', 'code', 'name', 'priority', 'default_cargo_kg', 'time_window_minutes', 'from_site_type', 'to_site_type', 'created_at', 'updated_at'],
      [template.id, template.code, template.name, template.priority, template.cargo, template.minutes, template.from, template.to, at, at]
    );
  }
  return inserted;
}

function seedUsers(db: Db, at: string): number {
  let inserted = 0;
  for (const account of SEED_ACCOUNTS) {
    inserted += insertIgnore(
      db,
      'users',
      ['id', 'username', 'password_hash', 'role', 'display_name', 'status', 'created_at', 'updated_at', 'created_by'],
      [account.id, account.username, bcrypt.hashSync(account.password, 10), account.role, account.displayName, 'active', at, at, 'seed']
    );
  }
  return inserted;
}

function seedSettings(db: Db, at: string): number {
  const defaults = settingsDefaults();
  let inserted = 0;
  for (const item of SETTINGS_SCHEMA) {
    inserted += insertIgnore(
      db,
      'settings',
      ['key', 'value', 'updated_at', 'updated_by'],
      [item.key, JSON.stringify(defaults[item.key]), at, 'seed']
    );
  }
  return inserted;
}

/**
 * 演示用任务 + 路线 + 告警（首次启动即可见「路线高亮」与「车辆执行中」）。
 *
 * 为什么 seed 要带这条数据：真实业务中 `tasks`/`routes` 由调度流程产生、初始为空，
 * 于是地图上永远只有路网，路线高亮与车辆动画**没有任何可见的验证样本**。
 * 这里给一条状态自洽的最小闭环：
 *
 * - 任务 `running`，绑定 AGV-01，进度 0.42；
 * - 路线经 `N01→N05→N09→N10→N11→N12`，**每一段都是库中真实存在的边**
 *   （seed 的 4×3 网格双向边），不会出现「路线压在一条不存在的边上」；
 * - 车辆状态同步为 `busy`、`load_kg` 与任务载重一致，避免「车空闲却挂着任务」的矛盾；
 * - 告警挂 DRN-01（该车保持 idle，不受影响），演示角标而不干扰主演示车。
 *
 * 幂等性：全部 `INSERT OR IGNORE` + 固定 id，重复执行不会新增（与其它 seed 一致）。
 */
function seedDemoExecution(db: Db, at: string): { tasks: number; routes: number; alerts: number } {
  const taskId = SEED_IDS.demoTask;
  const routeId = SEED_IDS.demoRoute;
  const cargoKg = 100; // 与 TPL-STD 的 default_cargo_kg 一致
  // 用节点**序号**描述路径，再统一推导 id/code，避免手写字符串出现大小写不一致。
  // 实测踩坑：`edges.id` 里的 code 是**大写**（`seed-e-N01-N05`），
  // 而节点 id 是小写（`seed-n01`）。若直接拿节点 id 拼边 id 会得到
  // `seed-e-n01-n05` —— 该列是 JSON 文本、**没有外键保护**，
  // 写错不会报错，只会在前端按 edgeIds 高亮时静默匹配不上。
  const routeIndexes = [1, 5, 9, 10, 11, 12];
  const nodeIds = routeIndexes.map((index) => nodeId(index));
  const fromNodeId = nodeIds[0]!;
  const toNodeId = nodeIds[nodeIds.length - 1]!;
  const edgeIds = routeIndexes
    .slice(0, -1)
    .map((_, index) => `seed-e-${nodeCode(routeIndexes[index]!)}-${nodeCode(routeIndexes[index + 1]!)}`);
  // 每段 20 m，共 5 段 = 100 m；AGV 限速 1.5 m/s
  const distanceM = 100;
  const durationS = distanceM / 1.5;

  let tasks = 0;
  let routes = 0;
  let alerts = 0;

  // 任务的 status 与车辆 status 必须成对写：单独写一个会出现「running 任务挂在 idle 车上」
  tasks += insertIgnore(
    db,
    'tasks',
    [
      'id', 'code', 'template_id', 'title', 'status', 'priority', 'cargo_kg', 'cargo_desc',
      'from_site_id', 'to_site_id', 'assigned_vehicle_id', 'progress',
      'submitted_at', 'assigned_at', 'started_at', 'created_at', 'updated_at', 'created_by', 'updated_by'
    ],
    [
      taskId, 'T-DEMO-0001', SEED_IDS.templateStandard, 'A 仓 → B 仓 演示配送', 'running', 'normal',
      cargoKg, '演示货物', SEED_IDS.siteDepotA, SEED_IDS.siteDepotB, SEED_IDS.vehicleAgv, 0.42,
      at, at, at, at, at, 'seed', 'seed'
    ]
  );

  routes += insertIgnore(
    db,
    'routes',
    [
      'id', 'task_id', 'algorithm', 'from_node_id', 'to_node_id', 'via_node_ids', 'node_ids',
      'edge_ids', 'distance_m', 'duration_s', 'created_at', 'created_by'
    ],
    [
      routeId, taskId, 'aStar', fromNodeId, toNodeId,
      JSON.stringify(nodeIds.slice(1, -1)), JSON.stringify(nodeIds),
      JSON.stringify(edgeIds),
      distanceM, durationS, at, 'seed'
    ]
  );

  alerts += insertIgnore(
    db,
    'alerts',
    ['id', 'type', 'level', 'object_type', 'object_id', 'message', 'status', 'created_at'],
    [SEED_IDS.demoAlert, 'vehicle_offline', 'warning', 'vehicle', SEED_IDS.vehicleDrone, 'DRN-01 心跳超时，疑似离线', 'new', at]
  );

  // 车辆运行态（`INSERT OR IGNORE` 不会更新已存在行，这里显式同步一次）
  run(
    db,
    "UPDATE vehicles SET status = 'busy', load_kg = ?, current_node_id = ?, updated_at = ? WHERE id = ? AND status = 'idle'",
    [cargoKg, fromNodeId, at, SEED_IDS.vehicleAgv]
  );

  return { tasks, routes, alerts };
}

export interface SeedSummary {
  nodes: number;
  edges: number;
  sites: number;
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
  return tx(db, () => {
    // 顺序不可换：演示任务外键引用 stations/vehicles/templates，
    // 且路线引用 nodes/edges；必须等基础数据落库后再写。
    const nodes = seedNodes(db, at);
    const edges = seedEdges(db);
    const sites = seedSites(db, at);
    const vehicles = seedVehicles(db, at);
    const templates = seedTemplates(db, at);
    const users = seedUsers(db, at);
    const settings = seedSettings(db, at);
    const execution = seedDemoExecution(db, at);
    return { nodes, edges, sites, vehicles, templates, users, settings, ...execution };
  });
}

export function countRows(db: Db, table: string): number {
  const row = all<{ total: number }>(db, `SELECT COUNT(*) AS total FROM ${table}`)[0];
  return row ? Number(row.total) : 0;
}
