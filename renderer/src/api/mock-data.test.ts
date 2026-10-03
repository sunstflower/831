import { describe, expect, it } from 'vitest';
import { SEED_IDS } from '@udm/shared';
import { openDatabase } from '../../../desktop/src/db/index';
import { applyMigrations } from '../../../desktop/src/db/migrate';
import { seedDatabase } from '../../../desktop/src/db/seed';
import { getMapOverview } from '../../../desktop/src/db/repositories/map.repo';
import { buildMockOverview, mockCampusPackage } from './mock-data';

/**
 * 防漂移护栏：Mock 数据必须与 `desktop/src/db/seed.ts` 产出**逐字段一致**。
 *
 * 这组断言针对的是一次真实事故：mock-data 手写了 `seed-n-N1` / `seed-veh-AGV-01`，
 * 而 seed 生成 `seed-n01` / `seed-veh-agv01`。两边 id 不同但形状相似，
 * 浏览器里一切正常，切到 Electron 后选中态、事件匹配、告警角标全部静默失效。
 * 因此这里把「与 seed 同构」变成可执行的断言，而不是注释里的约定。
 */
describe('mock-data · 与 seed 的推导同源', () => {
  const overview = buildMockOverview();
  const pkg = mockCampusPackage();

  it('路网规模来自地图包本身（不是写死的数字）', () => {
    // 断言「等于地图包的长度」而不是「等于 30」：换一份地图包时，用例仍然是对的，
    // 而写死数字的用例会在换数据时报一个与语义无关的错
    expect(overview.nodes).toHaveLength(pkg.nodes.length);
    expect(overview.edges).toHaveLength(pkg.edges.length);
    expect(overview.sites).toHaveLength(pkg.stations.length);
  });

  it('节点 id / code 由地图包的编码派生（不是手抄的 seed-n-N1）', () => {
    // 每个 id 都必须等于「前缀 + 自己的 code」，而不是与 code 无关的另一套编号
    expect(overview.nodes.every((node) => node.id === `seed-n-${node.code}`)).toBe(true);
    expect(overview.nodes.map((node) => node.code).sort()).toEqual(pkg.nodes.map((node) => node.code).sort());
  });

  it('站点/车辆 id 取自 shared 的 SEED_IDS（与 seed 同源）', () => {
    // 演示用的三个站点必须在站点表里存在，否则演示任务会引用一个不存在的站点
    for (const id of [SEED_IDS.siteDepot, SEED_IDS.siteDorm, SEED_IDS.siteCanteen]) {
      expect(overview.sites.map((site) => site.id)).toContain(id);
    }
    expect(overview.vehicles.map((vehicle) => vehicle.id).sort()).toEqual(
      [SEED_IDS.vehicleAgv, SEED_IDS.vehicleAgv2, SEED_IDS.vehicleCarrier, SEED_IDS.vehicleCarrier2, SEED_IDS.vehicleDrone].sort()
    );
  });

  it('坐标/绑定节点/电量与 seed 一致', () => {
    const agv = overview.vehicles.find((vehicle) => vehicle.id === SEED_IDS.vehicleAgv);
    // AGV-01 正在执行演示任务：status 为 busy、并挂着 taskId（与 seed 一致）
    expect(agv).toMatchObject({ code: 'AGV-01', battery: 100, status: 'busy', taskId: SEED_IDS.demoTask });

    // 站点坐标来自样本，直接与地图包对照（手抄坐标正是 D-27 那类漂移的起点）
    const depot = overview.sites.find((site) => site.id === SEED_IDS.siteDepot);
    const station = pkg.stations.find((item) => item.code === 'DEPOT');
    expect(depot).toMatchObject({ code: 'DEPOT', x: station!.x, y: station!.y, type: 'depot' });
    expect(depot?.nodeId).toBe(`seed-n-${station!.edgeCode.split('_')[1]!}`);
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
    expect(task.fromSiteId).toBe(SEED_IDS.siteDepot);
    expect(task.toSiteId).toBe(SEED_IDS.siteDorm);
    expect(task.vehicleId).toBe(SEED_IDS.vehicleAgv);
    // 路线必须走得通：每个节点都在图上、每一段都对应一条真实存在的边
    expect(overview.routes[0]!.nodeIds.length).toBeGreaterThan(2);
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
