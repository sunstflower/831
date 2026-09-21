/**
 * Mock 适配器的演示数据。
 *
 * **不手抄 ID**：节点/边/站点/车辆的 id 与 code 全部由 `@udm/shared` 的 `SEED_IDS`
 * 与 seed 的生成规则推导，避免与 `desktop/src/db/seed.ts` 手工同步时出现笔误。
 *
 * 实测教训：本文件此前手写了 `seed-n-N1` / `seed-veh-AGV-01` 这类 id，
 * 而真实 seed 生成的是 `seed-n01` / `seed-veh-agv01`。两边「看起来一样」，
 * 但浏览器 Mock 形态与 Electron 形态看到的是两套 id，选中态、事件推送的
 * `vehicleId` 匹配、告警角标挂载都会在切到 Electron 后静默失效 ——
 * 这正是 `docs/module-M6-map.md` §1.1 提到的返工来源，故改为派生。
 *
 * 演示任务与路线是本文件**独有**的（真实库中 `tasks`/`routes` 初始为空）。
 * 它们的用途是让「路线高亮」「车辆动画」在浏览器里可见，见 `DEMO_*` 常量。
 */
import { SEED_IDS } from '@udm/shared';
import type { MapEdge, MapNode, MapOverview, MapRoute, MapSite, MapTask, MapVehicle } from './types';

export const GRID_COLS = 4;
export const GRID_ROWS = 3;
export const GRID_STEP_M = 20;

/** 与 `seed.ts` 的 `nodeId` / `nodeCode` 保持同一规则（两位补零）。 */
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

function buildNodes(): MapNode[] {
  const nodes: MapNode[] = [];
  for (let index = 1; index <= GRID_COLS * GRID_ROWS; index += 1) {
    nodes.push({ id: nodeId(index), code: nodeCode(index), ...nodePosition(index), status: 'enabled' });
  }
  return nodes;
}

function buildEdges(): MapEdge[] {
  const edges: MapEdge[] = [];
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
    for (const [a, b] of pairs) {
      // 双向：每条无向连接落两条有向边，与 seed 的 34 条一致
      for (const [from, to] of [
        [a, b],
        [b, a]
      ] as Array<[number, number]>) {
        edges.push({
          id: `seed-e-${nodeCode(from)}-${nodeCode(to)}`,
          fromNodeId: nodeId(from),
          toNodeId: nodeId(to),
          lengthM: GRID_STEP_M,
          speedLimitMps: null,
          status: 'enabled'
        });
      }
    }
  }
  // 按 id 排序：与 `map.repo.ts` 的 `ORDER BY id` 一致。
  // 顺序影响 React Flow 的绘制次序（后画的在上），两边必须同序，
  // 否则「同一张图在 Mock 与 Electron 下叠放关系不同」。
  return edges.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function buildSites(): MapSite[] {
  const rows: Array<{ id: string; code: string; name: string; type: MapSite['type']; node: number }> = [
    { id: SEED_IDS.siteDepotA, code: 'A-01', name: 'A 仓库', type: 'depot', node: 1 },
    { id: SEED_IDS.siteDepotB, code: 'B-01', name: 'B 仓库', type: 'depot', node: 12 },
    { id: SEED_IDS.siteCharging, code: 'CHG-01', name: '充电桩', type: 'charging', node: 4 }
  ];
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    nodeId: nodeId(row.node),
    ...nodePosition(row.node),
    status: 'enabled'
  }));
}

function buildVehicles(): MapVehicle[] {
  // 电量与 `seed.ts` 一致（seed 统一写 100），不要在这里造「看起来更真实」的差异值
  const rows: Array<{ id: string; code: string; node: number; status: MapVehicle['status']; taskId: string | null }> = [
    // AGV-01 正在执行演示任务：status/load/taskId 必须与 seed 一致（busy + 挂任务）
    { id: SEED_IDS.vehicleAgv, code: 'AGV-01', node: 1, status: 'busy', taskId: SEED_IDS.demoTask },
    { id: SEED_IDS.vehicleCarrier, code: 'CAR-01', node: 12, status: 'idle', taskId: null },
    { id: SEED_IDS.vehicleDrone, code: 'DRN-01', node: 4, status: 'idle', taskId: null }
  ];
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    status: row.status,
    ...nodePosition(row.node),
    battery: 100,
    taskId: row.taskId
  }));
}

/**
 * 演示用任务与路线：在 4×3 网格上取 A-01(N01) → B-01(N12) 的折线路径，
 * 与 `seed.ts` 的 `seedDemoExecution` **同一条**（同一路线、同一进度、同一车辆）。
 *
 * 这条数据在真实库里**也存在**（seed 会写入），因此浏览器与 Electron 看到的是同一张图，
 * 不会出现「浏览器有高亮路线、进 Electron 一片空白」的误判。
 */
function buildTasksAndRoutes(): { tasks: MapTask[]; routes: MapRoute[] } {
  // N01 → N05 → N09 → N10 → N11 → N12（与 seed 的 routeIndexes 一致）
  const nodeIds = [1, 5, 9, 10, 11, 12].map((index) => nodeId(index));
  return {
    tasks: [
      {
        id: SEED_IDS.demoTask,
        code: 'T-DEMO-0001',
        status: 'running',
        fromSiteId: SEED_IDS.siteDepotA,
        toSiteId: SEED_IDS.siteDepotB,
        vehicleId: SEED_IDS.vehicleAgv,
        progress: 0.42
      }
    ],
    routes: [
      {
        id: SEED_IDS.demoRoute,
        taskId: SEED_IDS.demoTask,
        vehicleId: SEED_IDS.vehicleAgv,
        nodeIds,
        status: 'active'
      }
    ]
  };
}

let seq = 0;

/** 每次调用返回一份**新**快照（含递增 `eventSeq`），与主进程行为一致。 */
export function buildMockOverview(): MapOverview {
  seq += 1;
  return {
    nodes: buildNodes(),
    edges: buildEdges(),
    sites: buildSites(),
    vehicles: buildVehicles(),
    ...buildTasksAndRoutes(),
    alerts: [
      {
        id: SEED_IDS.demoAlert,
        type: 'vehicle_offline',
        level: 'warning',
        status: 'new',
        objectType: 'vehicle',
        objectId: SEED_IDS.vehicleDrone
      }
    ],
    eventSeq: seq
  };
}
