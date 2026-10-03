import { describe, expect, it } from 'vitest';
import { SEED_IDS, campusNodeId } from '@udm/shared';
import { openDatabase, run, tx, nowIso } from '../index.js';
import { applyMigrations } from '../migrate.js';
import { seedDatabase } from '../seed.js';
import { seedFixture } from '../seed-fixture.js';
import { getMapOverview } from './map.repo.js';

/** 路网节点 id 取自地图包推导，不写死字面量（见 seed-fixture.ts）。 */
const N01 = campusNodeId('N01');
const N02 = campusNodeId('N02');

function setup() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  return db;
}

/**
 * 清掉 seed 自带的演示执行数据（任务/路线/告警），得到一个「只有基础路网」的库。
 *
 * 这些用例断言的是「哪些记录会/不会进快照」，需要可控的初始状态；
 * 而 seed 为了首屏可见性会写一条演示任务（`seed-task-demo`）。
 * 显式清空比在断言里到处 `+1` 更不容易误判 —— 后者一旦 seed 调整就会静默错位。
 */
function clearDemoExecution(db: ReturnType<typeof openDatabase>) {
  tx(db, () => {
    // 顺序由外键决定：plan → route → task，先删引用方。
    // 不能只删演示任务：seed 还写 6 条**待派发**任务，它们同样会进快照（未终结即上图）。
    run(db, 'DELETE FROM dispatch_plans');
    run(db, 'DELETE FROM dispatch_logs');
    run(db, 'DELETE FROM routes');
    run(db, 'DELETE FROM alerts');
    run(db, 'DELETE FROM tasks');
    run(db, "UPDATE vehicles SET status = 'idle', load_kg = 0");
  });
}

describe('getMapOverview', () => {
  it('从 seed 库读出与种网一致的图层规模（含 seed 的演示执行数据）', () => {
    const db = setup();
    const snapshot = getMapOverview(db);
    const fixture = seedFixture();
    // 规模从 `data/campus/` 的推导来：这条用例要证明的是「seed 的图层规模 == 地图包」
    expect(snapshot.nodes).toHaveLength(fixture.nodes.length);
    expect(snapshot.edges).toHaveLength(fixture.edges.length);
    expect(snapshot.sites).toHaveLength(fixture.sites.length);
    expect(snapshot.vehicles).toHaveLength(fixture.vehicles.length);
    // seed 会写演示执行任务 + 6 条待派发任务，让首屏就能看到路线高亮与可派发的活
    expect(snapshot.tasks).toHaveLength(fixture.tasks.length);
    expect(snapshot.routes).toHaveLength(1);
    expect(snapshot.routes[0]?.status).toBe('active');
    expect(snapshot.alerts).toHaveLength(1);
    expect(snapshot.eventSeq).toBe(0);
    db.close();
  });

  it('边端点都能在 nodes 中解析（渲染层依赖此不变量跳过悬空边）', () => {
    const db = setup();
    const snapshot = getMapOverview(db);
    const nodeIds = new Set(snapshot.nodes.map((node) => node.id));
    for (const edge of snapshot.edges) {
      expect(nodeIds.has(edge.fromNodeId)).toBe(true);
      expect(nodeIds.has(edge.toNodeId)).toBe(true);
    }
    db.close();
  });

  it('车辆 taskId 派生自 tasks.assigned_vehicle_id，而非 vehicles 表的列', () => {
    const db = setup();
    clearDemoExecution(db);
    const at = nowIso();
    tx(db, () => {
      run(
        db,
        `INSERT INTO tasks (id, code, title, status, priority, cargo_kg, from_site_id, to_site_id,
                            assigned_vehicle_id, progress, assigned_at, created_at, updated_at)
         VALUES (?, ?, ?, 'running', 'normal', 10, ?, ?, ?, 0.5, ?, ?, ?)`,
        ['t-1', 'T-0001', '测试任务', SEED_IDS.siteDepot, SEED_IDS.siteDorm, SEED_IDS.vehicleAgv, at, at, at]
      );
    });

    const snapshot = getMapOverview(db);
    const agv = snapshot.vehicles.find((vehicle) => vehicle.id === SEED_IDS.vehicleAgv);
    const other = snapshot.vehicles.find((vehicle) => vehicle.id === SEED_IDS.vehicleCarrier);
    expect(agv?.taskId).toBe('t-1');
    expect(other?.taskId).toBeNull();
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]?.progress).toBe(0.5);
    db.close();
  });

  it('已终结任务不上图（否则历史任务会一直堆在画布上）', () => {
    const db = setup();
    clearDemoExecution(db);
    const at = nowIso();
    tx(db, () => {
      run(
        db,
        `INSERT INTO tasks (id, code, title, status, priority, cargo_kg, from_site_id, to_site_id,
                            progress, finished_at, created_at, updated_at)
         VALUES (?, ?, ?, 'finished', 'normal', 10, ?, ?, 1, ?, ?, ?)`,
        ['t-done', 'T-0002', '已完成', SEED_IDS.siteDepot, SEED_IDS.siteDorm, at, at, at]
      );
    });
    expect(getMapOverview(db).tasks).toHaveLength(0);
    db.close();
  });

  it('路线状态派生自 dispatch_plans.status（routes 表没有 status 列）', () => {
    const db = setup();
    clearDemoExecution(db);
    const at = nowIso();
    tx(db, () => {
      run(
        db,
        `INSERT INTO tasks (id, code, title, status, priority, cargo_kg, from_site_id, to_site_id,
                            assigned_vehicle_id, progress, assigned_at, created_at, updated_at)
         VALUES ('t-1', 'T-0001', '任务', 'running', 'normal', 10, ?, ?,
                 ?, 0.2, ?, ?, ?)`,
        [SEED_IDS.siteDepot, SEED_IDS.siteDorm, SEED_IDS.vehicleAgv, at, at, at]
      );
      const insertRoute = (id: string) =>
        run(
          db,
          `INSERT INTO routes (id, task_id, algorithm, from_node_id, to_node_id, via_node_ids, node_ids,
                               edge_ids, distance_m, duration_s, created_at)
           VALUES (?, 't-1', 'aStar', ?, ?, '[]', ?, '[]', 20, 20, ?)`,
          [id, N01, N02, JSON.stringify([N01, N02]), at]
        );
      const insertPlan = (id: string, routeId: string, status: string) =>
        run(
          db,
          `INSERT INTO dispatch_plans (id, request_id, task_id, vehicle_id, strategy, status, cost,
                                       route_id, occupied_from, occupied_to, created_at)
           VALUES (?, 'req-1', 't-1', 'seed-veh-agv01', 'greedy', ?, 1, ?, ?, ?, ?)`,
          [id, status, routeId, '2026-09-15T00:00:00.000Z', '2026-09-15T00:10:00.000Z', at]
        );
      insertRoute('r-old');
      insertRoute('r-new');
      insertPlan('p-old', 'r-old', 'superseded');
      insertPlan('p-new', 'r-new', 'applied');
    });

    const snapshot = getMapOverview(db);
    const byId = new Map(snapshot.routes.map((route) => [route.id, route]));
    // 两条都返回：由渲染层决定「暗色细线 vs 高亮动画」，接口不替前端取舍
    expect(snapshot.routes).toHaveLength(2);
    expect(byId.get('r-new')?.status).toBe('active');
    expect(byId.get('r-old')?.status).toBe('superseded');
    expect(byId.get('r-new')?.nodeIds).toEqual([N01, N02]);
    expect(byId.get('r-new')?.vehicleId).toBe('seed-veh-agv01');
    db.close();
  });

  it('无关联计划的路线视为 active（手工规划产出未走派发）', () => {
    const db = setup();
    clearDemoExecution(db);
    const at = nowIso();
    tx(db, () => {
      run(
        db,
        `INSERT INTO routes (id, task_id, algorithm, from_node_id, to_node_id, via_node_ids, node_ids,
                             edge_ids, distance_m, duration_s, created_at)
         VALUES ('r-manual', NULL, 'aStar', ?, ?, '[]', ?, '[]', 20, 20, ?)`,
        [N01, N02, JSON.stringify([N01, N02]), at]
      );
    });
    const snapshot = getMapOverview(db);
    expect(snapshot.routes[0]?.status).toBe('active');
    expect(snapshot.routes[0]?.taskId).toBeNull();
    expect(snapshot.routes[0]?.vehicleId).toBeNull();
    db.close();
  });

  it('node_ids 损坏时退化为空数组而不是抛错（单条脏数据不白屏）', () => {
    const db = setup();
    clearDemoExecution(db);
    const at = nowIso();
    tx(db, () => {
      run(
        db,
        `INSERT INTO routes (id, task_id, algorithm, from_node_id, to_node_id, via_node_ids, node_ids,
                             edge_ids, distance_m, duration_s, created_at)
         VALUES ('r-bad', NULL, 'aStar', ?, ?, '[]', 'not-json', '[]', 20, 20, ?)`,
        [N01, N02, at]
      );
    });
    expect(getMapOverview(db).routes[0]?.nodeIds).toEqual([]);
    db.close();
  });

  it('归档告警不上图；eventSeq 用 sqlite_sequence 水位线（删除后不回退）', () => {
    const db = setup();
    clearDemoExecution(db);
    const at = nowIso();
    tx(db, () => {
      run(
        db,
        `INSERT INTO alerts (id, type, level, object_type, object_id, message, status, created_at)
         VALUES ('a-new', 'vehicle_offline', 'warning', 'vehicle', ?, '离线', 'new', ?)`,
        [SEED_IDS.vehicleDrone, at]
      );
      run(
        db,
        `INSERT INTO alerts (id, type, level, object_type, object_id, message, status, created_at)
         VALUES ('a-arch', 'task_timeout', 'info', 'task', 't-1', '已归档', 'archived', ?)`,
        [at]
      );
      run(db, "INSERT INTO event_log (id, ts, type, payload) VALUES ('e1', ?, 'map.updated', '{}')", [at]);
      run(db, "INSERT INTO event_log (id, ts, type, payload) VALUES ('e2', ?, 'vehicle.changed', '{}')", [at]);
      // 删掉**最高位**那条事件：正是 MAX(seq) 会回退、而 sqlite_sequence 不回退的情形
      run(db, "DELETE FROM event_log WHERE id = 'e2'");
    });

    const snapshot = getMapOverview(db);
    expect(snapshot.alerts.map((alert) => alert.id)).toEqual(['a-new']);
    // e2 已被删除，MAX(seq) 会掉回 1；水位线必须仍是 2
    expect(snapshot.eventSeq).toBe(2);
    db.close();
  });
});
