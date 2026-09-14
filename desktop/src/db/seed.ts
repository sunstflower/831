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

export interface SeedSummary {
  nodes: number;
  edges: number;
  sites: number;
  vehicles: number;
  templates: number;
  users: number;
  settings: number;
}

export function seedDatabase(db: Db): SeedSummary {
  const at = nowIso();
  return tx(db, () => ({
    nodes: seedNodes(db, at),
    edges: seedEdges(db),
    sites: seedSites(db, at),
    vehicles: seedVehicles(db, at),
    templates: seedTemplates(db, at),
    users: seedUsers(db, at),
    settings: seedSettings(db, at)
  }));
}

export function countRows(db: Db, table: string): number {
  const row = all<{ total: number }>(db, `SELECT COUNT(*) AS total FROM ${table}`)[0];
  return row ? Number(row.total) : 0;
}
