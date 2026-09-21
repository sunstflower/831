import { describe, expect, it } from 'vitest';
import { SEED_IDS } from '@udm/shared';
import { openDatabase } from '../../../desktop/src/db/index';
import { applyMigrations } from '../../../desktop/src/db/migrate';
import { seedDatabase } from '../../../desktop/src/db/seed';
import { getMapOverview } from '../../../desktop/src/db/repositories/map.repo';
import { buildMockOverview, GRID_COLS, GRID_ROWS } from './mock-data';

/**
 * 防漂移护栏：Mock 数据必须与 `desktop/src/db/seed.ts` 产出**逐字段一致**。
 *
 * 这组断言针对的是一次真实事故：mock-data 手写了 `seed-n-N1` / `seed-veh-AGV-01`，
 * 而 seed 生成 `seed-n01` / `seed-veh-agv01`。两边 id 不同但形状相似，
 * 浏览器里一切正常，切到 Electron 后选中态、事件匹配、告警角标全部静默失效。
 * 因此这里把「与 seed 同构」变成可执行的断言，而不是注释里的约定。
 */
describe('mock-data · 与 seed 的一致性', () => {
  const overview = buildMockOverview();

  it('路网规模与 seed 的 4×3 网格一致（12 节点 / 34 条双向边）', () => {
    expect(overview.nodes).toHaveLength(GRID_COLS * GRID_ROWS);
    expect(overview.nodes).toHaveLength(12);
    expect(overview.edges).toHaveLength(34);
  });

  it('节点 id 与 code 采用 seed 的两位补零规则（不是 seed-n-N1）', () => {
    expect(overview.nodes.map((node) => node.id)).toEqual([
      'seed-n01', 'seed-n02', 'seed-n03', 'seed-n04',
      'seed-n05', 'seed-n06', 'seed-n07', 'seed-n08',
      'seed-n09', 'seed-n10', 'seed-n11', 'seed-n12'
    ]);
    expect(overview.nodes.map((node) => node.code)).toContain('N01');
    expect(overview.nodes.some((node) => node.id.includes('seed-n-N'))).toBe(false);
  });

  it('站点/车辆 id 取自 shared 的 SEED_IDS（与 seed 同源）', () => {
    expect(overview.sites.map((site) => site.id).sort()).toEqual(
      [SEED_IDS.siteDepotA, SEED_IDS.siteDepotB, SEED_IDS.siteCharging].sort()
    );
    expect(overview.vehicles.map((vehicle) => vehicle.id).sort()).toEqual(
      [SEED_IDS.vehicleAgv, SEED_IDS.vehicleCarrier, SEED_IDS.vehicleDrone].sort()
    );
  });

  it('坐标/绑定节点/电量与 seed 一致', () => {
    const agv = overview.vehicles.find((vehicle) => vehicle.id === SEED_IDS.vehicleAgv);
    // AGV-01 正在执行演示任务：status 为 busy、并挂着 taskId（与 seed 一致）
    expect(agv).toMatchObject({ code: 'AGV-01', x: 0, y: 0, battery: 100, status: 'busy', taskId: SEED_IDS.demoTask });

    const depotB = overview.sites.find((site) => site.id === SEED_IDS.siteDepotB);
    expect(depotB).toMatchObject({ code: 'B-01', nodeId: 'seed-n12', x: 60, y: 40, type: 'depot' });
  });

  it('边端点都能解析到节点（渲染层依赖此不变量）', () => {
    const nodeIds = new Set(overview.nodes.map((node) => node.id));
    for (const edge of overview.edges) {
      expect(nodeIds.has(edge.fromNodeId)).toBe(true);
      expect(nodeIds.has(edge.toNodeId)).toBe(true);
    }
  });

  it('演示任务的起终点与车辆都指向 SEED_IDS，且路线节点全部存在', () => {
    const nodeIds = new Set(overview.nodes.map((node) => node.id));
    const task = overview.tasks[0]!;
    expect(task.fromSiteId).toBe(SEED_IDS.siteDepotA);
    expect(task.toSiteId).toBe(SEED_IDS.siteDepotB);
    expect(task.vehicleId).toBe(SEED_IDS.vehicleAgv);
    for (const id of overview.routes[0]!.nodeIds) {
      expect(nodeIds.has(id)).toBe(true);
    }
  });
});

/**
 * 最强护栏：Mock 快照必须与**真实 seed 库经 `getMapOverview` 产出**逐字段一致。
 *
 * 前面几条断言是「照规则推导」，这条直接拿真库比对 —— 只要 seed 改了而 mock 没跟，
 * 或者 mock 手写了错 id，就会立刻失败。这比人工核对可靠得多，
 * 也避免了「两者漂移后只在切适配器时才暴露」的返工。
 */
describe('mock-data · 与真实 seed 库的快照一致', () => {
  it('mock 快照 == seed 库快照（图层全字段比对）', () => {
    const db = openDatabase(':memory:');
    try {
      applyMigrations(db);
      seedDatabase(db);
      const real = getMapOverview(db);
      const mock = buildMockOverview();

      // eventSeq 是时间水位线，不属于数据内容，比对时排除
      const strip = (snapshot: typeof real) => ({ ...snapshot, eventSeq: 0 });
      expect(strip(mock as typeof real)).toEqual(strip(real));
    } finally {
      db.close();
    }
  });
});
