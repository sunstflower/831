import { describe, expect, it } from 'vitest';
import { all, get, openDatabase } from './index.js';
import { applyMigrations } from './migrate.js';
import { countRows, seedDatabase } from './seed.js';

function tableNames(): string[] {
  const db = openDatabase(':memory:');
  try {
    applyMigrations(db);
    return all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(
      (row) => row.name
    );
  } finally {
    db.close();
  }
}

describe('migrations', () => {
  it('applies 0001 once and is idempotent', () => {
    const db = openDatabase(':memory:');
    try {
      expect(applyMigrations(db)).toEqual([1]);
      expect(applyMigrations(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('creates all 16 business tables plus schema_version', () => {
    const names = tableNames();
    expect(names).toContain('schema_version');
    const business = names.filter((name) => name !== 'schema_version');
    // 实测口径：业务表 16 张 + schema_version = 17 张表（与 docs/database.md §2 一致）
    expect(business).toHaveLength(16);
  });

  it('exposes the exact business table set', () => {
    const names = tableNames().filter((name) => name !== 'schema_version').sort();
    expect(names).toEqual(
      [
        'alerts', 'audit_logs', 'dispatch_logs', 'dispatch_plans', 'edges', 'event_log',
        'nodes', 'restrictions', 'routes', 'settings', 'sites', 'task_templates',
        'tasks', 'users', 'vehicle_tracks', 'vehicles'
      ].sort()
    );
  });

  it('enforces enum check constraints', () => {
    const db = openDatabase(':memory:');
    applyMigrations(db);
    expect(() =>
      db.prepare(
        "INSERT INTO users (id, username, password_hash, role, display_name, status, created_at, updated_at) VALUES ('x','x','h','hacker','X','active','now','now')"
      ).run()
    ).toThrow();
    db.close();
  });
});

describe('seed', () => {
  it('is idempotent and fills demo data', () => {
    const db = openDatabase(':memory:');
    applyMigrations(db);
    seedDatabase(db);
    const first = {
      users: countRows(db, 'users'),
      nodes: countRows(db, 'nodes'),
      edges: countRows(db, 'edges'),
      sites: countRows(db, 'sites'),
      vehicles: countRows(db, 'vehicles'),
      settings: countRows(db, 'settings')
    };
    seedDatabase(db);
    const second = {
      users: countRows(db, 'users'),
      nodes: countRows(db, 'nodes'),
      edges: countRows(db, 'edges'),
      sites: countRows(db, 'sites'),
      vehicles: countRows(db, 'vehicles'),
      settings: countRows(db, 'settings')
    };
    expect(second).toEqual(first);
    expect(first.users).toBe(3);
    expect(first.nodes).toBe(12);
    expect(first.edges).toBe(34);
    expect(first.sites).toBe(3);
    expect(first.vehicles).toBe(3);
    expect(first.settings).toBeGreaterThanOrEqual(9);
    db.close();
  });

  it('演示执行数据自洽：任务/路线/车辆/告警互指且路线引用真实存在的边', () => {
    const db = openDatabase(':memory:');
    try {
      applyMigrations(db);
      const summary = seedDatabase(db);
      expect(summary).toMatchObject({ tasks: 1, routes: 1, alerts: 1 });

      const task = get<{ id: string; status: string; assigned_vehicle_id: string; progress: number }>(
        db,
        "SELECT id, status, assigned_vehicle_id, progress FROM tasks WHERE id = 'seed-task-demo'"
      );
      expect(task).toMatchObject({ status: 'running', assigned_vehicle_id: 'seed-veh-agv01', progress: 0.42 });

      const vehicle = get<{ status: string; load_kg: number }>(
        db,
        "SELECT status, load_kg FROM vehicles WHERE id = 'seed-veh-agv01'"
      );
      // 反向一致性：running 任务挂在 idle 车上是最容易被忽略的矛盾
      expect(vehicle?.status).toBe('busy');
      expect(vehicle?.load_kg).toBeGreaterThan(0);

      const route = get<{ node_ids: string; edge_ids: string }>(
        db,
        "SELECT node_ids, edge_ids FROM routes WHERE id = 'seed-route-demo'"
      );
      const nodeIds = JSON.parse(route!.node_ids) as string[];
      const edgeIds = JSON.parse(route!.edge_ids) as string[];
      expect(nodeIds).toHaveLength(6);
      expect(edgeIds).toHaveLength(nodeIds.length - 1);

      // 关键护栏：`edge_ids` 是 JSON 文本列、没有外键保护，写错不会报错。
      // 实测踩坑：曾生成小写 `seed-e-n01-n05`，而真实边 id 是 `seed-e-N01-N05`。
      for (const edgeId of edgeIds) {
        expect(get(db, 'SELECT id FROM edges WHERE id = ?', [edgeId]), `边不存在: ${edgeId}`).toBeDefined();
      }
      // 每一段都必须是**相邻节点间真实连通**的边，而不是随便挑一条
      for (let index = 0; index < nodeIds.length - 1; index += 1) {
        const from = nodeIds[index]!;
        const to = nodeIds[index + 1]!;
        expect(
          get(db, 'SELECT id FROM edges WHERE from_node_id = ? AND to_node_id = ?', [from, to]),
          `路线分段不连通: ${from} -> ${to}`
        ).toBeDefined();
      }

      // 告警只引用存在的车辆
      const alert = get<{ object_id: string }>(db, "SELECT object_id FROM alerts WHERE id = 'seed-alert-demo'");
      expect(get(db, 'SELECT id FROM vehicles WHERE id = ?', [alert!.object_id])).toBeDefined();
    } finally {
      db.close();
    }
  });
});
