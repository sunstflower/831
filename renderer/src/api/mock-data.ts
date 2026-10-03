/**
 * Mock 适配器的演示数据（浏览器形态）。
 *
 * ## 数据来自 `data/campus/`，推导来自 `shared/src/seed-data.ts`
 *
 * 与主进程**同源**：两边都解析 `data/campus/` 的地图包，再调用同一个
 * `buildSeedDataset()` 得到节点 / 边 / 站点 / 车辆 / 模板 / 任务。
 * 浏览器读文件用 Vite 的 `?raw`（Node 侧用 fs），**解析与推导只写一遍**（D-27）。
 *
 * 这里此前靠「手抄一份与 seed 同规则的数据 + 一个比对用例」保持一致，
 * 而手抄必然漂移过一次（`seed-n-N1` vs `seed-n01`，见 D-27）。改成共用推导之后，
 * 两边不一致从「靠测试发现」变成「不可能发生」。
 *
 * ## 时间戳
 *
 * `MOCK_AT` 取**模块加载那一刻**（真实 seed 写的是 seed 运行时刻，两者必然不同）。
 *
 * 为什么不能写死一个过去的时间（曾用 2026-01-01 实测踩到）：演示待派发任务的
 * 时间窗是 `at` 起算的 45–240 分钟，而调度评估用的 `now` 是**真实当前时刻** ——
 * 固定在过去，时间窗就永远已经过期，调度中心会 100% 输出「时间窗冲突」，
 * 看起来像算法坏了。改成「加载即当前」，演示数据就永远落在窗口之内。
 *
 * 两种形态的差异因此仍**只有时间字段**，`mock-parity.test.ts` 的排除项是写死的，
 * 新增时间字段不会被静默放过（不排除就一定会不一致，测试会红）。
 */
import { buildSeedDataset, type CampusMapPackage, type SeedDataset } from '@udm/shared';
import { parseCampusPackage } from '@udm/shared';
import type { MapOverview, MapTask, MapRoute, MapSite, MapVehicle, MapNode, MapEdge } from './types';
import type {
  EdgeListItem,
  NodeListItem,
  RestrictionListItem,
  RouteDetail,
  SiteListItem,
  TaskDetail,
  TaskTemplateListItem,
  VehicleListItem
} from '@udm/shared';

import nodesCsv from '../../../data/campus/campus_nodes.csv?raw';
import edgesCsv from '../../../data/campus/campus_edges.csv?raw';
import stationsCsv from '../../../data/campus/campus_stations.csv?raw';
import obstaclesXml from '../../../data/campus/campus.obstacles.rou.xml?raw';
import congestionCsv from '../../../data/campus/campus_congestion.csv?raw';

/** 解析一次就够：地图包是随仓库进版的静态文件。 */
let packageCache: CampusMapPackage | null = null;

export function mockCampusPackage(): CampusMapPackage {
  packageCache ??= parseCampusPackage({ nodesCsv, edgesCsv, stationsCsv, obstaclesXml, congestionCsv });
  return packageCache;
}

/** 演示数据集的时间基准 = 模块加载时刻（见文件头「时间戳」）。 */
const MOCK_AT = new Date().toISOString();

/** 与 `map.repo.ts` 的 `OPEN_TASK_STATUSES` 同口径（地图只画未终结的任务）。 */
const OPEN_TASK_STATUSES: ReadonlyArray<MapTask['status']> = ['pending', 'assigned', 'running', 'paused'];

/** 按某个字符串字段升序（模拟 SQL 的 `ORDER BY <col>`）。 */
function byField<T extends Record<K, unknown>, K extends keyof T & string>(rows: readonly T[], field: K): T[] {
  return [...rows].sort((a, b) => String(a[field]) < String(b[field]) ? -1 : String(a[field]) > String(b[field]) ? 1 : 0);
}

let datasetCache: SeedDataset | null = null;

/** 演示数据集（与主进程 seed 同一份推导，只有时间字段不同）。 */
export function mockSeedDataset(): SeedDataset {
  datasetCache ??= buildSeedDataset(mockCampusPackage(), { at: MOCK_AT });
  return datasetCache;
}

/* ==================== 地图概览快照（`/api/map/overview`） ==================== */

/**
 * 地图快照里各类行的**排序**必须与 `map.repo.ts` 的 SQL 逐字对齐。
 *
 * 顺序不是细节：React Flow 按数组顺序绘制（后画的在上），
 * 「同图不同叠放」在两种形态下看起来就是两张不一样的图，而任何断言都抓不到它 ——
 * 除非像这里一样把 `ORDER BY` 也抄成同一套（并由 `mock-data.test.ts` 的整体比对守住）。
 */
function buildNodes(): MapNode[] {
  return byField(mockSeedDataset().nodes, 'code').map((node) => ({
    id: node.id,
    code: node.code,
    x: node.x,
    y: node.y,
    status: node.status
  }));
}

function buildEdges(): MapEdge[] {
  return mockSeedDataset()
    .edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      lengthM: edge.lengthM,
      speedLimitMps: edge.speedLimitMps,
      weight: edge.weight,
      status: edge.status
    }))
    // 按 id 排序：与 `map.repo.ts` 的 `ORDER BY id` 一致。顺序影响 React Flow 的绘制次序
    // （后画的在上），两边必须同序，否则「同一张图在 Mock 与 Electron 下叠放关系不同」
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function buildSites(): MapSite[] {
  return byField(mockSeedDataset().sites, 'code').map((site) => ({
    id: site.id,
    code: site.code,
    name: site.name,
    type: site.type,
    nodeId: site.nodeId,
    x: site.x,
    y: site.y,
    status: site.status
  }));
}

function buildVehicles(): MapVehicle[] {
  const tasks = mockSeedDataset().tasks;
  return byField(mockSeedDataset().vehicles, 'code').map((vehicle) => ({
    id: vehicle.id,
    code: vehicle.code,
    status: vehicle.status,
    x: vehicle.x,
    y: vehicle.y,
    battery: vehicle.battery,
    // `taskId` 是派生字段（D-25）：由「哪条任务挂着这台车」反查，而不是存在车辆行上
    taskId: tasks.find((task) => task.assignedVehicleId === vehicle.id && task.status === 'running')?.id ?? null
  }));
}

/**
 * 演示任务与路线（地图上的高亮线 + 执行中的车）。
 *
 * 路线来自 `buildSeedDataset()` 里的 `demoRoute` —— 它由**路径内核**在真实路网
 * （含权重与禁行）上算出来，与主进程 `seed.ts` 落进 `routes` 表的是同一条。
 */
function buildTasksAndRoutes(): { tasks: MapTask[]; routes: MapRoute[] } {
  const data = mockSeedDataset();
  const demo = data.tasks.find((task) => task.status === 'running');
  if (!demo) {
    // 演示数据缺失说明推导坏了，静默返回空数组只会让地图「看起来正常但什么都没有」
    throw new Error('演示数据集里没有执行中的任务');
  }
  // 与 `map.repo` 同一套筛选与排序：只上「未终结」的任务，按 created_at 升序。
  // 少了这一步，浏览器里只画一条演示任务、桌面端画 7 条，而这种差异不会报错
  const openTasks: MapTask[] = data.tasks
    .filter((task) => OPEN_TASK_STATUSES.includes(task.status))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .map((task) => ({
      id: task.id,
      code: task.code,
      status: task.status,
      fromSiteId: task.fromSiteId,
      toSiteId: task.toSiteId,
      vehicleId: task.assignedVehicleId,
      progress: task.progress
    }));
  return {
    tasks: openTasks,
    routes: [
      {
        id: data.demoRoute.id,
        taskId: data.demoRoute.taskId,
        vehicleId: demo.assignedVehicleId,
        nodeIds: data.demoRoute.nodeIds,
        status: 'active'
      }
    ]
  };
}

/* ==================== M5 路线（`/api/routes/{id}`） ==================== */

export interface MockRouteStore {
  rows: RouteDetail[];
}

export function buildMockRouteStore(): MockRouteStore {
  return { rows: [{ ...mockSeedDataset().demoRoute }] };
}

let seq = 0;

/** 每次调用返回一份**新**快照（含递增 `eventSeq`），与主进程行为一致。 */
export function buildMockOverview(): MapOverview {
  seq += 1;
  const alert = mockSeedDataset().demoAlert;
  return {
    nodes: buildNodes(),
    edges: buildEdges(),
    sites: buildSites(),
    vehicles: buildVehicles(),
    ...buildTasksAndRoutes(),
    alerts: [
      {
        id: alert.id,
        type: alert.type,
        level: alert.level,
        status: alert.status,
        objectType: alert.objectType,
        objectId: alert.objectId
      }
    ],
    eventSeq: seq
  };
}

/* ==================== M2 基础数据（`/api/sites` 等） ==================== */

/*
 * 四个基础数据列表的**排序**必须与各自仓库的 SQL 逐字对齐（`ORDER BY`）：
 *   - `site.repo` / `vehicle.repo` / `graph.repo`(nodes) → `ORDER BY code ASC`；
 *   - `graph.repo`(edges) → `ORDER BY MIN(f.code,t.code), MAX(f.code,t.code), id`。
 *
 * 本轮实测到的差异正是出在这里：Mock 直接返回 `data/campus/*.csv` 的行序，
 * 而 `campus_stations.csv` 把配送中心写在**最后**一行，于是同一个列表在浏览器里
 * `ST01…ST12, DEPOT`、在 Electron 里 `DEPOT, ST01…` —— 两边都不报错，
 * 只有把两个适配器的响应放在一起比对（`mock-parity.test.ts`）才看得见。
 */
function buildSiteList(): SiteListItem[] {
  return byField(mockSeedDataset().sites, 'code').map((site) => ({ ...site }));
}

function buildVehicleList(): VehicleListItem[] {
  return byField(mockSeedDataset().vehicles, 'code').map((vehicle) => ({ ...vehicle }));
}

function buildNodeList(): NodeListItem[] {
  return byField(mockSeedDataset().nodes, 'code').map((node) => ({ ...node }));
}

function buildEdgeList(): EdgeListItem[] {
  const rows = mockSeedDataset().edges.map((edge) => ({ ...edge }));
  // 返回**元组**而不是数组：定长的两端，元组让解构出来的两个值都是 `string`
  // （数组会推断成 `string[]`，在 `noUncheckedIndexedAccess` 下解构成 `string | undefined`）
  const pair = (edge: EdgeListItem): [string, string] =>
    edge.fromNodeCode <= edge.toNodeCode
      ? [edge.fromNodeCode, edge.toNodeCode]
      : [edge.toNodeCode, edge.fromNodeCode];
  return rows.sort((a, b) => {
    const [aLow, aHigh] = pair(a);
    const [bLow, bHigh] = pair(b);
    if (aLow !== bLow) return aLow < bLow ? -1 : 1;
    if (aHigh !== bHigh) return aHigh < bHigh ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * 禁行规则：来自样本里的两处占道（`data/campus/README.md` §3）。
 *
 * 它**不再是空表**：占道是地图包的一部分，主进程 seed 同样会落这两条。
 * 「浏览器里空、Electron 里两条」正是 D-27 那类静默差异，故两边同源。
 */
function buildRestrictionList(): RestrictionListItem[] {
  return mockSeedDataset().restrictions.map((rule) => ({ ...rule }));
}

const MOCK_TEMPLATES = (): TaskTemplateListItem[] => mockSeedDataset().templates.map((template) => ({ ...template }));

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
    restrictions: buildRestrictionList(),
    // 复制一份再返回：调用方（写路径）会就地改它，不能让两次 `buildMockBaseData()`
    // 共享同一批对象 —— 那会让一次「编辑模板」污染下一次会话的初始快照
    templates: MOCK_TEMPLATES()
  };
}

/* ==================== M3 任务（`/api/tasks`） ==================== */

export interface MockTaskStore {
  rows: TaskDetail[];
}

/**
 * 任务表：演示执行任务 + 6 条待派发任务（与主进程 seed 同一份推导）。
 *
 * 这里给的是 `TaskDetail` 的**基础形状**：`fromSiteName` / `toSiteName` / `vehicleCode`
 * 由 `mock-tasks.ts` 的 `detailOf()` 每次现算（与主进程 join 的行为一致），
 * 因此这里留 `null` 是对的 —— 写死会在改名后变成一份陈旧副本。
 */
export function buildMockTaskStore(): MockTaskStore {
  const data = mockSeedDataset();
  const rows: TaskDetail[] = data.tasks.map((task) => ({
    id: task.id,
    code: task.code,
    title: task.title,
    status: task.status,
    priority: task.priority,
    cargoKg: task.cargoKg,
    fromSiteId: task.fromSiteId,
    toSiteId: task.toSiteId,
    fromSiteName: null,
    toSiteName: null,
    timeWindowStart: task.timeWindowStart,
    timeWindowEnd: task.timeWindowEnd,
    assignedVehicleId: task.assignedVehicleId,
    vehicleCode: null,
    progress: task.progress,
    createdAt: task.createdAt,
    createdBy: 'seed',
    templateId: task.templateId,
    cargoDesc: task.cargoDesc,
    cancelReason: null,
    failReason: null,
    pauseReason: null,
    submittedAt: task.submittedAt,
    assignedAt: task.assignedAt,
    startedAt: task.startedAt,
    finishedAt: null,
    cancelledAt: null,
    failedAt: null,
    updatedAt: task.createdAt,
    currentPlan: null,
    route:
      task.status === 'running'
        ? {
            id: data.demoRoute.id,
            distanceM: data.demoRoute.distanceM,
            durationS: data.demoRoute.durationS,
            algorithm: data.demoRoute.algorithm,
            nodeCount: data.demoRoute.nodeIds.length,
            edgeCount: data.demoRoute.edgeIds.length
          }
        : null,
    alerts: [],
    auditSummaries: []
  }));
  return { rows };
}
