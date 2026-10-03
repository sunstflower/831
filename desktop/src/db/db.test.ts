import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISPATCH_LOG_ACTIONS, DISPATCH_STRATEGY_SELECTIONS, OBJECT_TYPES } from '@udm/shared';
import { all, get, openDatabase } from './index.js';
import { applyMigrations } from './migrate.js';
import { seedFixture } from './seed-fixture.js';
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
  it('按 `desktop/migrations/` 里的文件顺序全部应用一次，且可重复执行', () => {
    /*
     * 不写死编号：迁移清单的**唯一来源**是目录里的文件（`docs/database.md` §6 的登记表是它的索引），
     * 写死 `[1]` 的代价在本次真实发生过 —— 新增 `0003_object_types.sql` 时这条用例变红，
     * 而它红得**没有信息量**（不是迁移坏了，是断言没跟上）。
     * 这里改为从目录推导期望值，于是「新增迁移」不再需要同步改测试。
     */
    const expected = readdirSync(join(import.meta.dirname, '..', '..', 'migrations'))
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .map((file) => Number(file.slice(0, 4)))
      .sort((a, b) => a - b);
    const db = openDatabase(':memory:');
    try {
      expect(expected.length).toBeGreaterThan(0);
      expect(applyMigrations(db)).toEqual(expected);
      // 幂等：第二次一行都不应用
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

  it('`OBJECT_TYPES` 的每个取值都被 `alerts.object_type` 的 CHECK 接受（枚举 ↔ DDL 漂移护栏）', () => {
    /*
     * 起因（2026-09-26，原 ISS-039 / M2 §11 Q1）：`OBJECT_TYPES` 与 `alerts` 表的 CHECK 约束
     * 是**同一个事实的两个作者** —— 一个是 TS 字面量、一个是 SQL 字面量，中间没有任何机制对齐。
     * `docs/database.md` §6 规则 4 要求「新增枚举值需同步 DB CHECK（新迁移重建约束）」，
     * 但这条规则此前**只存在于文档里**：漏做时的表现是「写入时才炸」——
     * 往 `alerts` 插一条 `object_type='restriction'` 会被 SQLite 拒成 `SYS.INTERNAL`
     * （一条看不出真实原因的 500），而它可能要到 M8 才会被触发。
     *
     * 因此这里把规则变成断言：**每个枚举值都必须能被 CHECK 接受**。
     * 断言方式不是比对 SQL 文本（那需要解析 DDL，脆且会误报），
     * 而是**真的插一条**：让 SQLite 自己回答「这个取值能不能进」。
     * 这样迁移漏做时会立刻红，而不是等到某个模块写告警时才炸。
     */
    const db = openDatabase(':memory:');
    applyMigrations(db);
    for (const objectType of OBJECT_TYPES) {
      expect(
        () =>
          db
            .prepare(
              `INSERT INTO alerts (id, type, level, object_type, object_id, message, status, created_at)
               VALUES (?, 'data_error', 'info', ?, NULL, 'probe', 'new', 'now')`
            )
            .run(`probe-${objectType}`, objectType),
        `${objectType} 未同步到 alerts.object_type 的 CHECK（见 docs/database.md §6 规则 4）`
      ).not.toThrow();
    }
    // 反向也要成立：约束仍然拦得住真错误值，否则上面那条断言只是在证明「约束不存在」
    expect(() =>
      db
        .prepare(
          `INSERT INTO alerts (id, type, level, object_type, object_id, message, status, created_at)
           VALUES ('probe-bad', 'data_error', 'info', 'not_a_real_type', NULL, 'probe', 'new', 'now')`
        )
        .run()
    ).toThrow();
    // 迁移是「新表 + 搬迁 + 改名」：既有的演示告警必须原样还在，而不是被搬迁丢掉
    expect(all<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM alerts')[0]?.count).toBeGreaterThan(0);
    db.close();
  });

  it('`DISPATCH_LOG_ACTIONS` / `DISPATCH_STRATEGY_SELECTIONS` 的每个取值都被 `dispatch_logs` 的 CHECK 接受', () => {
    /*
     * 与上面 `OBJECT_TYPES` 那条同因同法：`dispatch_logs.action` 与
     * `dispatch_logs.strategy` 的 CHECK 是**同一事实的第二个作者**（第一作者是
     * `shared/src/enums.ts`），而 M4 的写路径会一次性插入四个动作、四种策略选择。
     * 漏同步时的表现是「调度日志写入时才炸」——而且只在用到那个取值时才炸，
     * 例如 `manual_assign`（手动指派）与 `all`（预览对比）：`all` 不入库，
     * 但 `recompute` 会把用户选的 `greedy|hungarian|genetic` 原样落库。
     *
     * 断言方式同样是**真的插一条**，让 SQLite 自己回答取值能否进。
     */
    const db = openDatabase(':memory:');
    applyMigrations(db);
    const insert = db.prepare(
      `INSERT INTO dispatch_logs (id, request_id, action, strategy, task_ids, summary, rejected, elapsed_ms, created_at)
       VALUES (?, 'req-probe', ?, ?, '[]', '{}', '[]', 0, 'now')`
    );
    for (const action of DISPATCH_LOG_ACTIONS) {
      for (const strategy of DISPATCH_STRATEGY_SELECTIONS) {
        expect(
          () => insert.run(`probe-${action}-${strategy}`, action, strategy),
          `${action} / ${strategy} 未同步到 dispatch_logs 的 CHECK（见 docs/database.md §6 规则 4）`
        ).not.toThrow();
      }
    }
    // 反向：约束仍拦得住真错误值，否则上面只是在证明「约束不存在」
    expect(() => insert.run('probe-bad', 'applied', 'greedy')).toThrow();
    expect(() => insert.run('probe-bad-2', 'apply', 'fastest')).toThrow();
    db.close();
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
    // 规模从 `data/campus/` + `shared/src/seed-data.ts` 的推导来，不写死字面量：
    // 「seed 必须把地图包里的节点/边/站点全部落库」才是这条用例要证明的事
    const fixture = seedFixture();
    expect(first.users).toBe(3);
    expect(first.nodes).toBe(fixture.nodes.length);
    expect(first.edges).toBe(fixture.edges.length);
    expect(first.sites).toBe(fixture.sites.length);
    expect(first.vehicles).toBe(fixture.vehicles.length);
    expect(first.settings).toBeGreaterThanOrEqual(9);
    db.close();
  });

  it('演示执行数据自洽：任务/路线/车辆/告警互指且路线引用真实存在的边', () => {
    const db = openDatabase(':memory:');
    try {
      applyMigrations(db);
      const summary = seedDatabase(db);
      const fixture = seedFixture();
      // 演示任务 + 6 条待派发任务；路线与告警各只有演示那一条
      expect(summary).toMatchObject({ tasks: fixture.tasks.length, routes: 1, alerts: 1 });

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
      expect(nodeIds).toEqual(fixture.demoRoute.nodeIds);
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
