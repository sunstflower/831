/**
 * 测试夹具：把「种子数据长什么样」变成**可推导的事实**，而不是散落在各用例里的字面量。
 *
 * 为什么需要它（本轮实测教训）：`data/campus/` 换成 30 节点 / 90 边 / 13 站点之后，
 * 19 个用例因为「写死的 12 / 34 / 3」而变红，而**业务代码一行都没错**。
 * 它们红得没有信息量，却要逐个手改 —— 且下次换数据还会重演。
 *
 * 所以：需要路网规模 / 站点 id / 演示任务端点的用例，一律走本文件。
 * 这里**不新增任何事实**：它只是把 `data/campus/` + `shared/src/seed-data.ts`
 * 的既有推导跑一遍，与 `desktop/src/db/seed.ts` 落库用的是同一个函数（D-27 的同源口径）。
 *
 * 只在测试里 import（不进生产路径）：`desktop/src/db/seed.ts` 自己调 `buildSeedDataset`。
 */
import { SEED_FLEET, buildSeedDataset, type SeedDataset } from '@udm/shared';
import { run, tx, type Db } from './index.js';
import { loadCampusMap } from './campus-map-source.js';

/** 固定时间戳：夹具只关心结构与规模，时间戳一致能让断言稳定。 */
export const FIXTURE_AT = '2026-01-01T00:00:00.000Z';

let cached: SeedDataset | null = null;

/** 与 seed 落库同源的种子数据集（进程内缓存，避免每个用例都重解析 CSV）。 */
export function seedFixture(): SeedDataset {
  if (!cached) {
    cached = buildSeedDataset(loadCampusMap().pkg, { at: FIXTURE_AT });
  }
  return cached;
}

/** 车队规模（`SEED_FLEET` 是本文件的唯一来源）。 */
export const SEED_VEHICLE_COUNT = SEED_FLEET.length;

/** 演示执行任务的起终点节点 id（地图上「任务端点」图层用它）。 */
export const DEMO_FROM_NODE = seedFixture().demoRoute.nodeIds[0]!;
export const DEMO_TO_NODE = seedFixture().demoRoute.nodeIds.at(-1)!;

/**
 * 4×3 方格网夹具：12 个节点、34 条有向边（17 对 × 2 方向），每段 20 m。
 *
 * 为什么需要一张**自己的**网：某些用例要断言的是几何量（「5 段 = 100 m」），
 * 而不是「数据长什么样」。挂在 `data/campus/` 上时，换一次地图数据就会让
 * 里程、耗时、绕路断言集体变红，而业务代码一行没错（本轮实测）。
 *
 * 节点 code 用 `T01`..`T12`（不是 `N01`..`N12`）：`nodes.code` 有 UNIQUE 约束，
 * 与校园路网的 `N01` 撞名会直接插不进去。id 与 code 都带 `fix-` 前缀，
 * 让「这是夹具而不是业务数据」在任何一次查询结果里都一眼可见。
 */
export function installGridFixture(db: Db): void {
  const cols = 4;
  const spacing = 20;
  tx(db, () => {
    for (let index = 1; index <= 12; index += 1) {
      const col = (index - 1) % cols;
      const row = Math.floor((index - 1) / cols);
      run(
        db,
        "INSERT INTO nodes (id, code, name, x, y, status) VALUES (?, ?, ?, ?, ?, 'enabled')",
        [gridNodeId(index), gridNodeCode(index), `夹具节点 ${index}`, col * spacing, row * spacing]
      );
    }
    for (let index = 1; index <= 12; index += 1) {
      const col = (index - 1) % cols;
      const row = Math.floor((index - 1) / cols);
      const neighbors: number[] = [];
      if (col < cols - 1) neighbors.push(index + 1);
      if (row < 2) neighbors.push(index + cols);
      for (const neighbor of neighbors) {
        for (const [from, to] of [
          [index, neighbor],
          [neighbor, index]
        ] as Array<[number, number]>) {
          run(
            db,
            "INSERT INTO edges (id, from_node_id, to_node_id, length_m, status) VALUES (?, ?, ?, ?, 'enabled')",
            [gridEdgeId(from, to), gridNodeId(from), gridNodeId(to), spacing]
          );
        }
      }
    }
  });
}

/** 方格网第 `index` 个节点的 id（1..12）。 */
export function gridNodeId(index: number): string {
  return `fix-n-T${String(index).padStart(2, '0')}`;
}

/** 方格网节点的业务 code（`T01`..`T12`）。 */
export function gridNodeCode(index: number): string {
  return `T${String(index).padStart(2, '0')}`;
}

/** 方格网上 `from → to` 那条边的 id。 */
export function gridEdgeId(from: number, to: number): string {
  return `fix-e-T${String(from).padStart(2, '0')}-T${String(to).padStart(2, '0')}`;
}

/** 方格网每段的长度（米）。 */
export const GRID_SPACING_M = 20;
