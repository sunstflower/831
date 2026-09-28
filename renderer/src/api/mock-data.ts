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
import {
  ROUTE_DEFAULT_SPEED_MPS,
  SEED_IDS,
  deriveEdgeCode,
  type EdgeListItem,
  type NodeListItem,
  type RestrictionListItem,
  type RouteDetail,
  type SiteListItem,
  type TaskDetail,
  type TaskTemplateListItem,
  type VehicleListItem
} from '@udm/shared';
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

/* ==================== M5 路线的 Mock 数据（`/api/routes/{id}`） ==================== */

/**
 * Mock 侧的路线表（内存）。
 *
 * 与 `seedDemoExecution` 的 `seed-route-demo` **逐字段同源**：`nodeIds` 来自同一个
 * `buildTasksAndRoutes()`，`edgeIds` 由这些节点对在 `buildEdgeList()` 里反查得到
 * （不手拼字符串 —— 手拼会得到 `seed-e-n01-n05` 这种小写形态，而 `edgeIds` 是
 * **没有外键保护的 JSON 文本**，写错不报错，只在地图按 edgeIds 高亮时静默匹配不上）。
 * `durationS` 用 `ROUTE_DEFAULT_SPEED_MPS.agv` 求值，而不是再抄一个 1.5。
 */
export interface MockRouteStore {
  rows: RouteDetail[];
}

export function buildMockRouteStore(): MockRouteStore {
  const { routes } = buildTasksAndRoutes();
  const edges = buildEdgeList();
  const rows = routes.map((route) => {
    const segments = route.nodeIds.slice(0, -1).map((from, index) => {
      const to = route.nodeIds[index + 1]!;
      return edges.find((edge) => edge.fromNodeId === from && edge.toNodeId === to);
    });
    const distanceM = segments.reduce((total, edge) => total + (edge?.lengthM ?? 0), 0);
    return {
      id: route.id,
      taskId: route.taskId,
      fromNodeId: route.nodeIds[0]!,
      toNodeId: route.nodeIds[route.nodeIds.length - 1]!,
      viaNodeIds: route.nodeIds.slice(1, -1),
      nodeIds: route.nodeIds,
      edgeIds: segments.map((edge) => edge?.id ?? ''),
      distanceM,
      durationS: distanceM / ROUTE_DEFAULT_SPEED_MPS.agv,
      algorithm: 'aStar',
      costDetail: {},
      warnings: [],
      createdAt: MOCK_AT,
      createdBy: 'seed'
    } satisfies RouteDetail;
  });
  return { rows };
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

/* ==================== M2 基础数据的列表数据（`/api/sites` 等四个列表接口） ==================== */

/**
 * Mock 侧的时间戳。
 *
 * 真实 seed 写的是**运行时刻**（`nowIso()`），因此这两个字段在两种形态下**必然不同**，
 * 无法像坐标那样对齐。这里用一个固定值而不是 `new Date()`：
 * 固定值让「Mock 与库的差异只在时间戳」这件事**可断言**（parity 测试里显式排除这三个字段，
 * 排除项写死在测试里，新增字段不会被悄悄放过）。
 */
const MOCK_AT = '2026-01-01T00:00:00.000Z';

/** 站点：与 `seed.ts` 的 `seedSites` 同一组（id 取 `SEED_IDS`，坐标由节点位置推导）。 */
function buildSiteList(): SiteListItem[] {
  const rows: Array<{ id: string; code: string; name: string; type: SiteListItem['type']; node: number }> = [
    { id: SEED_IDS.siteDepotA, code: 'A-01', name: 'A 仓库', type: 'depot', node: 1 },
    { id: SEED_IDS.siteDepotB, code: 'B-01', name: 'B 仓库', type: 'depot', node: 12 },
    { id: SEED_IDS.siteCharging, code: 'CHG-01', name: '充电桩', type: 'charging', node: 4 }
  ];
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    status: 'enabled',
    nodeId: nodeId(row.node),
    ...nodePosition(row.node),
    remark: null,
    createdAt: MOCK_AT,
    updatedAt: MOCK_AT
  }));
}

/**
 * 车辆：与 `seed.ts` 的 `seedVehicles` + `seedDemoExecution` 一致。
 *
 * `AGV-01` 的 `loadKg` 必须是 **100**，而不是 0：seed 把它置为演示任务的载重
 * （`cargoKg = 100`，与 `TPL-STD` 的默认载重一致）。写成 0 会造出「busy 的车载重为 0」
 * 这种库里不存在的状态，而页面上看不出哪里不对。
 */
function buildVehicleList(): VehicleListItem[] {
  const rows: Array<{
    id: string;
    code: string;
    name: string;
    type: VehicleListItem['type'];
    capacityKg: number;
    maxSpeedMps: number;
    node: number;
    status: VehicleListItem['status'];
    loadKg: number;
  }> = [
    { id: SEED_IDS.vehicleAgv, code: 'AGV-01', name: 'AGV 一号', type: 'agv', capacityKg: 500, maxSpeedMps: 1.5, node: 1, status: 'busy', loadKg: 100 },
    { id: SEED_IDS.vehicleCarrier, code: 'CAR-01', name: '配送车一号', type: 'carrier', capacityKg: 800, maxSpeedMps: 3, node: 12, status: 'idle', loadKg: 0 },
    { id: SEED_IDS.vehicleDrone, code: 'DRN-01', name: '无人机一号', type: 'drone', capacityKg: 50, maxSpeedMps: 5, node: 4, status: 'idle', loadKg: 0 }
  ];
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    status: row.status,
    capacityKg: row.capacityKg,
    loadKg: row.loadKg,
    maxSpeedMps: row.maxSpeedMps,
    battery: 100,
    ...nodePosition(row.node),
    currentNodeId: nodeId(row.node),
    online: true,
    lastHeartbeatAt: MOCK_AT,
    remark: null,
    createdAt: MOCK_AT,
    updatedAt: MOCK_AT
  }));
}

function buildNodeList(): NodeListItem[] {
  const nodes: NodeListItem[] = [];
  for (let index = 1; index <= GRID_COLS * GRID_ROWS; index += 1) {
    nodes.push({
      id: nodeId(index),
      code: nodeCode(index),
      name: `园区节点 ${index}`,
      ...nodePosition(index),
      status: 'enabled',
      remark: null
    });
  }
  return nodes;
}

/**
 * 边：**不手拼 code** —— 与主进程用同一个函数（`@udm/shared` 的 `deriveEdgeCode`）。
 *
 * 边的 `code` 目前既不在库里、也不在快照里，是由两端节点 code 推导的（D-35 待落地）。
 * 若这里自己拼字符串，浏览器看到 `E_N01_N02` 而 Electron 看到别的形态，
 * 就是 D-27 那次事故的翻版 —— 故两边共用一个函数。
 */
function buildEdgeList(): EdgeListItem[] {
  const edges: EdgeListItem[] = [];
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
      for (const [from, to] of [
        [a, b],
        [b, a]
      ] as Array<[number, number]>) {
        edges.push({
          id: `seed-e-${nodeCode(from)}-${nodeCode(to)}`,
          code: deriveEdgeCode(nodeCode(from), nodeCode(to)),
          fromNodeId: nodeId(from),
          toNodeId: nodeId(to),
          fromNodeCode: nodeCode(from),
          toNodeCode: nodeCode(to),
          lengthM: GRID_STEP_M,
          speedLimitMps: null,
          status: 'enabled',
          remark: null
        });
      }
    }
  }
  return edges;
}

/**
 * 演示模板：与 `desktop/src/db/seed.ts` 的 `seedTemplates` 逐字段同源。
 *
 * 这里**必须**把 `defaultCargoKg` 写成 `0` 而不是 `null`：TPL-CHG 的货重真的是 0
 * （回充任务不带货），两者在界面上都显示成「0」/「—」，但 `mock-parity.test.ts`
 * 比对的是字段值本身，`0 !== null` 会让护栏报红 —— 而那次报红是对的。
 */
const MOCK_TEMPLATES: TaskTemplateListItem[] = [
  {
    id: SEED_IDS.templateStandard,
    code: 'TPL-STD',
    name: '仓到仓标准配送',
    priority: 'normal',
    defaultCargoKg: 100,
    timeWindowMinutes: 60,
    fromSiteType: 'depot',
    toSiteType: 'depot',
    remark: null,
    createdAt: MOCK_AT,
    updatedAt: MOCK_AT
  },
  {
    id: SEED_IDS.templateCharging,
    code: 'TPL-CHG',
    name: '仓到充电桩回充',
    priority: 'low',
    defaultCargoKg: 0,
    timeWindowMinutes: 120,
    fromSiteType: 'depot',
    toSiteType: 'charging',
    remark: null,
    createdAt: MOCK_AT,
    updatedAt: MOCK_AT
  }
];

/**
 * M2 六类列表接口的数据源（每次调用返回新数组，调用方可安全排序/切片）。
 *
 * `restrictions` 初始为**空数组**，与 seed 一致：真实库里禁行规则也由使用者建立，
 * 不是预置数据（预置一条「封住某条边」的规则会让首次启动的地图看上去坏了）。
 * 「浏览器里建规则 → 列表里出现」这条路径由 `mock-parity.test.ts` 的写路径用例覆盖。
 */
export interface MockBaseData {
  sites: SiteListItem[];
  vehicles: VehicleListItem[];
  nodes: NodeListItem[];
  edges: EdgeListItem[];
  restrictions: RestrictionListItem[];
  templates: TaskTemplateListItem[];
}

export function buildMockBaseData(): MockBaseData {
  return {
    sites: buildSiteList(),
    vehicles: buildVehicleList(),
    nodes: buildNodeList(),
    edges: buildEdgeList(),
    restrictions: [],
    // 复制一份再返回：调用方（写路径）会就地改它，不能让两次 `buildMockBaseData()`
    // 共享同一批对象 —— 那会让一次「编辑模板」污染下一次会话的初始快照
    templates: MOCK_TEMPLATES.map((template) => ({ ...template }))
  };
}

/* ==================== M3 任务的 Mock 数据（`/api/tasks`） ==================== */

/**
 * Mock 侧的任务表（内存）。
 *
 * 与 `seed.ts` 的 `seedDemoExecution()` 同源：一条 `running` 的演示任务 + 一条路线摘要，
 * 车辆 `AGV-01` 因此是 `busy` 且载重与任务一致。**不手抄 id**（用 `SEED_IDS`），
 * 也不手写与 seed 不同的字段值 —— 两边不一致的后果是「浏览器里一切正常、
 * 切到 Electron 后选中态与事件匹配静默失效」（D-27 的事故形态）。
 */
export interface MockTaskStore {
  rows: TaskDetail[];
}

export function buildMockTaskStore(): MockTaskStore {
  const from = buildSiteList().find((site) => site.id === SEED_IDS.siteDepotA);
  const to = buildSiteList().find((site) => site.id === SEED_IDS.siteDepotB);
  const vehicle = buildVehicleList().find((item) => item.id === SEED_IDS.vehicleAgv);
  const task: TaskDetail = {
    id: SEED_IDS.demoTask,
    code: 'T-DEMO-0001',
    title: 'A 仓 → B 仓 演示配送',
    status: 'running',
    priority: 'normal',
    cargoKg: 100,
    fromSiteId: SEED_IDS.siteDepotA,
    toSiteId: SEED_IDS.siteDepotB,
    fromSiteName: from?.name ?? null,
    toSiteName: to?.name ?? null,
    timeWindowStart: null,
    timeWindowEnd: null,
    assignedVehicleId: SEED_IDS.vehicleAgv,
    vehicleCode: vehicle?.code ?? null,
    progress: 0.42,
    createdAt: MOCK_AT,
    createdBy: 'seed',
    templateId: SEED_IDS.templateStandard,
    cargoDesc: '演示货物',
    cancelReason: null,
    failReason: null,
    pauseReason: null,
    submittedAt: MOCK_AT,
    assignedAt: MOCK_AT,
    startedAt: MOCK_AT,
    finishedAt: null,
    cancelledAt: null,
    failedAt: null,
    updatedAt: MOCK_AT,
    currentPlan: null,
    // 路线摘要与 seed 的 `seed-route-demo` 一致：6 个节点、5 条边、100 m
    route: { id: SEED_IDS.demoRoute, distanceM: 100, durationS: 200 / 3, algorithm: 'aStar', nodeCount: 6, edgeCount: 5 },
    alerts: [],
    auditSummaries: []
  };
  return { rows: [task] };
}
