/**
 * 种子数据的**唯一推导处**。
 *
 * ## 为什么这份推导在 `shared`
 *
 * 主进程 seed（`desktop/src/db/seed.ts`）与浏览器 Mock（`renderer/src/api/mock-data.ts`）
 * 必须给出**逐字段相同**的数据：两边不一致时不会有任何报错，只会在切换形态后表现为
 * 「同一页看到不同的行 / 不同的路线 / 不同的派生字段」（D-27 那次事故的形态：
 * Mock 手抄了 `seed-n-N1`，而真实 seed 生成 `seed-n01`，浏览器里一切正常、
 * 进 Electron 后选中态与事件匹配全部静默失效）。
 *
 * 此前两边靠**两条各写一遍的生成逻辑 + 一个比对用例**来保持一致。
 * 比对用例能发现漂移，但发现时已经写完两遍代码了。现在改成：**推导只写一遍**
 * （本文件），两端只负责「把同一份结果落到各自的目标里」（SQLite / 内存数组）。
 * 因此这里刻意不 import 任何 db / node / browser 的东西 —— 它是纯函数（D-03 的同一条判据）。
 *
 * ## 取数方式不同，数据相同
 *
 * `data/campus/` 的文本由调用方读入（Node 用 fs、浏览器用 `?raw`），解析在本文件同目录的
 * `campus-map.ts`。两端拿到同一个 `CampusMapPackage` 之后，本文件是**唯一**继续往下推导的地方。
 *
 * ## 时间戳
 *
 * 所有时间字段来自入参 `at`：主进程传 `nowIso()`，Mock 传固定值（比对的用例显式排除时间字段）。
 * 时间不在本文件里生成，是为了让「同一份数据在两种形态下的差异恰好只有时间」这件事可断言。
 */
import { SEED_IDS, campusEdgeId, campusNodeId, campusSiteId } from './constants.js';
import { deriveEdgeCode } from './edge-code.js';
import type {
  AlertLevel,
  AlertType,
  ObjectType,
  TaskPriority,
  TaskStatus,
  VehicleStatus,
  VehicleType
} from './enums.js';
import { buildRouteGraph } from './route-graph.js';
import { searchRoute } from './route-search.js';
import { siteTypeOfCategory, applyObstacleImpacts, type CampusMapPackage } from './campus-map.js';
import type {
  EdgeListItem,
  NodeListItem,
  RestrictionListItem,
  RouteDetail,
  SiteListItem,
  TaskTemplateListItem,
  VehicleListItem
} from './types.js';

/** 一条种子任务（不落库形态、也不完全是 DTO —— 两端各自映射到自己需要的形状）。 */
export interface SeedTask {
  id: string;
  code: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  cargoKg: number;
  cargoDesc: string | null;
  fromSiteId: string;
  toSiteId: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  templateId: string | null;
  assignedVehicleId: string | null;
  progress: number;
  /**
   * 创建时刻。
   *
   * **每条任务必须不同**：列表按 `created_at` 排序，而同一毫秒的多行在 SQLite 里
   * 顺序未定义（`ISS-075` 的同族问题）——两边形态会得到不同的行序，
   * 而这种差异在页面上表现为「同一批任务在浏览器与桌面端顺序不同」。
   */
  createdAt: string;
  /** 已经是 `running` 的任务才有意义（其余为 `null`）。 */
  submittedAt: string | null;
  assignedAt: string | null;
  startedAt: string | null;
}

/** 演示告警（挂在车辆上，用于让地图与告警中心首次启动就有样本）。 */
export interface SeedAlert {
  id: string;
  type: AlertType;
  level: AlertLevel;
  objectType: ObjectType;
  objectId: string;
  message: string;
  status: 'new';
  createdAt: string;
}

export interface SeedDataset {
  nodes: NodeListItem[];
  edges: EdgeListItem[];
  sites: SiteListItem[];
  restrictions: RestrictionListItem[];
  vehicles: VehicleListItem[];
  templates: TaskTemplateListItem[];
  tasks: SeedTask[];
  /** 演示任务的已生效路线（`routes` 表 / Mock 路线表共用）。 */
  demoRoute: RouteDetail;
  demoAlert: SeedAlert;
  /** 演示执行任务的进度（地图上车辆从这一段往后跑）。 */
  demoProgress: number;
}

export interface BuildSeedOptions {
  /** 所有时间字段的取值（ISO）。主进程传当前时刻，Mock 传固定值。 */
  at: string;
  /** 演示任务的进度，缺省 0.42（与 M7 执行器的续跑口径一致）。 */
  demoProgress?: number;
}

/**
 * 车辆清单：**5 台、停在不同节点**。
 *
 * 为什么不是 3 台：调度对比要能分出策略高下，前提是「同一批任务交给不同车辆」的代价不一样
 * （空驶距离、载重、车种速度）。三台车里只有一台能装重货时，两种策略的结果会高度重合。
 * 车速一律取 `ROUTE_DEFAULT_SPEED_MPS` 的对应值 —— 让车辆限速与车种默认速度一致，
 * 避免出现「规划按 3 m/s 算、车辆参数写 5 m/s」这种两处不一致（规划用的是车种默认速度）。
 */
export const SEED_FLEET: Array<{
  id: string;
  code: string;
  name: string;
  type: VehicleType;
  capacityKg: number;
  maxSpeedMps: number;
  nodeCode: string;
  status: VehicleStatus;
}> = [
  { id: SEED_IDS.vehicleAgv, code: 'AGV-01', name: 'AGV 一号', type: 'agv', capacityKg: 500, maxSpeedMps: 1.5, nodeCode: 'DEPOT', status: 'busy' },
  { id: SEED_IDS.vehicleAgv2, code: 'AGV-02', name: 'AGV 二号', type: 'agv', capacityKg: 500, maxSpeedMps: 1.5, nodeCode: 'N20', status: 'idle' },
  { id: SEED_IDS.vehicleCarrier, code: 'CAR-01', name: '配送车一号', type: 'carrier', capacityKg: 800, maxSpeedMps: 3, nodeCode: 'N13', status: 'idle' },
  { id: SEED_IDS.vehicleCarrier2, code: 'CAR-02', name: '配送车二号', type: 'carrier', capacityKg: 1200, maxSpeedMps: 3, nodeCode: 'N42', status: 'idle' },
  { id: SEED_IDS.vehicleDrone, code: 'DRN-01', name: '无人机一号', type: 'drone', capacityKg: 50, maxSpeedMps: 5, nodeCode: 'N24', status: 'idle' }
];

/** 演示执行任务：配送中心 → 北苑学生宿舍（`AGV-01`）。 */
const DEMO_TASK = {
  id: SEED_IDS.demoTask,
  code: 'T-DEMO-0001',
  title: '配送中心 → 北苑学生宿舍 演示配送',
  cargoKg: 100,
  fromSite: 'DEPOT',
  toSite: 'ST09',
  progress: 0.42
} as const;

/**
 * 待派发任务清单（**远多于可用车辆数**）。
 *
 * 为什么必须多于车辆数：任务数 ≤ 车辆数时，贪心与匈牙利都只能「一车一单」，
 * 两种策略会给出完全相同的计划 —— 界面上「哪个策略更优」永远是平局。
 * 多出来的任务只能靠**接力**（一辆车跑完一单再接下一单）派出，
 * 而接力只有贪心会做（匈牙利是整体匹配，一辆车只接一单），对比于是有了真实结论。
 *
 * ## 每条任务是来「放大哪一种差异」的（删之前先读这段）
 *
 * 扩容的目标不是「多几行数据」，而是让两个策略在**更多维度**上分开：
 *   - **重货**（载重只有 1200 kg 车型能接）：把「唯一的车该留给谁」变成分水岭 ——
 *     贪心按优先级逐单挑车，可能先把它用在小件上；匈牙利在整批上会留给重货。
 *   - **中重件**（只有 800 kg 以上车型能接）：制造「大车不够分」，
 *     匈牙利必须放弃某些单，而贪心能靠接力排下。
 *   - **紧窗小件**：时间窗最短且落进无人机能力，逼出两种策略在接力顺序上的不同。
 *   - **短途小件**（起终点相邻）：执行段短，能塞进某台车已排班次之间的空档，
 *     于是贪心的「接力」不再是偶然 —— 它能把一台车填得更满，匈牙利则一车只接一单。
 *
 * 短途件的起终点**必须落在有向边的正确方向上**：样本路网里
 * `E_N12_N13` 被占道封路（`campus.obstacles.rou.xml` 的 `OBST_1`），
 * 反向的 `E_N12_N13_R` 却畅通 —— 同一对站点换个方向，执行段就从 150 m 变成绕行 450 m，
 * 「短途」就不再短（这一条是实测踩出来的，改任务前先跑一次调度预览）。
 *
 * 新任务一律**追加在尾部**：`code` 由下标派生（`T-DEMO-<index+2>`），
 * 追加不会改动既有任务的编码，引用旧编码的用例与文档因此保持稳定。
 */
const SEED_PENDING: Array<{
  from: string;
  to: string;
  cargoKg: number;
  priority: TaskPriority;
  /** 时间窗长度（分钟）：`[start, start + windowMinutes]`。 */
  windowMinutes: number;
  title: string;
}> = [
  { from: 'ST02', to: 'ST03', cargoKg: 40, priority: 'normal', windowMinutes: 240, title: '图书馆 → 第一食堂 餐食配送' },
  { from: 'DEPOT', to: 'ST05', cargoKg: 120, priority: 'high', windowMinutes: 240, title: '配送中心 → 实验楼 器材配送' },
  { from: 'ST09', to: 'DEPOT', cargoKg: 60, priority: 'normal', windowMinutes: 240, title: '北苑宿舍 → 配送中心 回收空箱' },
  { from: 'ST04', to: 'ST10', cargoKg: 200, priority: 'high', windowMinutes: 120, title: '教学楼A → 学生活动中心 物资转运' },
  { from: 'ST07', to: 'ST11', cargoKg: 30, priority: 'low', windowMinutes: 240, title: '体育馆 → 国际交流中心 器材归还' },
  { from: 'ST12', to: 'ST01', cargoKg: 300, priority: 'urgent', windowMinutes: 45, title: '西区公寓 → 南苑宿舍 急需物资' },
  // —— 本轮扩容：让两个策略在指派车、里程、完成时刻上分出更大的差 ——
  { from: 'ST05', to: 'ST10', cargoKg: 900, priority: 'high', windowMinutes: 240, title: '实验楼 → 学生活动中心 重型设备转运' },
  { from: 'ST01', to: 'ST09', cargoKg: 45, priority: 'urgent', windowMinutes: 60, title: '南苑宿舍 → 北苑学生宿舍 急救药品' },
  { from: 'ST10', to: 'ST05', cargoKg: 600, priority: 'high', windowMinutes: 150, title: '学生活动中心 → 实验楼 设备回运' },
  // 短途件：起终点都在某台车的驻点附近，执行段短，能塞进它已排班次的空档
  { from: 'ST09', to: 'ST04', cargoKg: 45, priority: 'normal', windowMinutes: 240, title: '北苑宿舍 → 教学楼A 教材转运' },
  { from: 'DEPOT', to: 'ST01', cargoKg: 120, priority: 'normal', windowMinutes: 240, title: '配送中心 → 南苑宿舍 生活物资' },
  { from: 'ST04', to: 'ST02', cargoKg: 80, priority: 'low', windowMinutes: 240, title: '教学楼A → 图书馆 教材回库' },
  // —— 第二批扩容：把任务池撑到「一车跑不完」，让容量瓶颈与算法差异同时可见 ——
  //
  // 实测（2026-10-03，真实 seed + 内核，18 条待派一起跑）：贪心 9 / 匈牙利 4。
  // 贪心比匈牙利多派的 5 单里，700 kg 中重件（`T-DEMO-0016`）与 45 kg 急件
  // （`T-DEMO-0018`）由 CAR-02 接力跑完，300 kg 相邻短途（`T-DEMO-0019`）
  // 与两单 150 m 短途塞进 CAR-01 的空档。
  //
  // 两个重货 + 一个中重件是**故意的容量压力**：1100 / 1000 kg 只有 CAR-02（1200kg）
  // 能接，700 kg 只有两台配送车（800 / 1200 kg）能接。实测里 CAR-02 被别的单占住，
  // 两个重货（`T-DEMO-0014` / `T-DEMO-0015`）在贪心与匈牙利下**都被拒** ——
  // 拒绝原因会如实写成「占用区间冲突」（而不是某个无关车辆的「不可用」，见 ISS-093）。
  // 它们的作用不是「跑起来」，而是让「车队装不下」这件事在对比表与预检里看得见。
  { from: 'ST11', to: 'DEPOT', cargoKg: 1100, priority: 'high', windowMinutes: 240, title: '国际交流中心 → 配送中心 重型器材回库' },
  { from: 'ST02', to: 'ST08', cargoKg: 1000, priority: 'high', windowMinutes: 240, title: '图书馆 → 教学楼B 书库搬迁' },
  { from: 'ST12', to: 'ST09', cargoKg: 700, priority: 'normal', windowMinutes: 240, title: '西区教师公寓 → 北苑学生宿舍 家具转运' },
  // 无人机能接的远距离小件：DRN-01（5 m/s）跑长对角线的耗时远低于地面车。
  { from: 'ST12', to: 'ST11', cargoKg: 40, priority: 'normal', windowMinutes: 240, title: '西区教师公寓 → 国际交流中心 文件专送' },
  { from: 'ST10', to: 'ST01', cargoKg: 45, priority: 'urgent', windowMinutes: 240, title: '学生活动中心 → 南苑宿舍 急救物资' },
  // 相邻节点的短途件：执行段只有一条边，能塞进某台车已排班次的空档（贪心的接力样本）。
  { from: 'ST06', to: 'ST07', cargoKg: 300, priority: 'high', windowMinutes: 240, title: '行政楼 → 体育馆 桌椅转运' }
];

/** 站点/边的中文名来自样本，节点只给「编码 + 类型」（样本没有中文名，编一个反而像有业务含义）。 */
const NODE_KIND_LABEL: Record<string, string> = {
  traffic_light: '信号灯路口',
  priority: '普通路口'
};

export function buildSeedDataset(pkg: CampusMapPackage, options: BuildSeedOptions): SeedDataset {
  const at = options.at;
  const demoProgress = options.demoProgress ?? DEMO_TASK.progress;
  const applied = applyObstacleImpacts(pkg);
  const nodeByCode = new Map(pkg.nodes.map((node) => [node.code, node]));
  const edgeByCode = new Map(applied.edges.map((edge) => [edge.code, edge]));
  const stationByCode = new Map(pkg.stations.map((station) => [station.code, station]));

  const nodes: NodeListItem[] = pkg.nodes.map((node) => ({
    id: campusNodeId(node.code),
    code: node.code,
    name: `${node.code}（${NODE_KIND_LABEL[node.kind] ?? node.kind}）`,
    x: node.x,
    y: node.y,
    status: 'enabled',
    remark: null
  }));

  const edges: EdgeListItem[] = applied.edges.map((edge) => ({
    id: campusEdgeId(edge.code),
    code: deriveEdgeCode(edge.fromCode, edge.toCode),
    fromNodeId: campusNodeId(edge.fromCode),
    toNodeId: campusNodeId(edge.toCode),
    fromNodeCode: edge.fromCode,
    toNodeCode: edge.toCode,
    lengthM: edge.lengthM,
    speedLimitMps: edge.speedLimitMps,
    weight: edge.weight,
    status: 'enabled',
    remark: edge.roadType
  }));

  const sites: SiteListItem[] = pkg.stations.map((station) => {
    const edge = edgeByCode.get(station.edgeCode);
    return {
      id: campusSiteId(station.code),
      code: station.code,
      name: station.name,
      type: siteTypeOfCategory(station.category),
      status: 'enabled',
      // 边绑定（D-30）尚未落 DDL：折到该边上**离站点最近的那个端点**，泊位信息原样放进 remark
      nodeId: edge ? nearestEndpointOf(station, edge, nodeByCode) : null,
      x: station.x,
      y: station.y,
      remark: `泊位 ${station.edgeCode} 车道 ${station.laneId}，沿边 ${station.berthStartM}–${station.berthEndM} m，泊位长 ${station.berthLengthM} m × ${station.berthCapacity} 位（分类：${station.category}）`,
      createdAt: at,
      updatedAt: at
    };
  });

  const restrictions: RestrictionListItem[] = applied.blocked.map((impact, index) => ({
    id: `seed-restriction-obstacle-${index + 1}`,
    type: 'edge',
    targetId: campusEdgeId(impact.edgeCode),
    targetCode: edgeByCode.get(impact.edgeCode)
      ? deriveEdgeCode(edgeByCode.get(impact.edgeCode)!.fromCode, edgeByCode.get(impact.edgeCode)!.toCode)
      : null,
    startAt: null,
    endAt: null,
    vehicleType: null,
    reason: `样本占道：${impact.edgeCode} 单车道被占用 ${impact.obstacle.startPosM}–${impact.obstacle.endPosM} m（${Math.round(impact.obstacle.durationS / 3600)} h）`,
    status: 'active',
    createdAt: at,
    createdBy: 'seed'
  }));

  const demoFromNode = stationNodeOf(stationByCode, edgeByCode, nodeByCode, DEMO_TASK.fromSite);
  const demoToNode = stationNodeOf(stationByCode, edgeByCode, nodeByCode, DEMO_TASK.toSite);
  const demoRoute = planDemoRoute({
    nodes,
    edges,
    restrictions,
    fromNodeId: demoFromNode,
    toNodeId: demoToNode,
    at
  });

  const vehicles: VehicleListItem[] = SEED_FLEET.map((vehicle) => {
    const node = nodeByCode.get(vehicle.nodeCode);
    if (!node) {
      throw new Error(`种子车辆 ${vehicle.code} 停靠的节点 ${vehicle.nodeCode} 不在地图包里`);
    }
    return {
      id: vehicle.id,
      code: vehicle.code,
      name: vehicle.name,
      type: vehicle.type,
      status: vehicle.status,
      capacityKg: vehicle.capacityKg,
      // 演示执行中的车必须带上任务载重：busy 的车载重为 0 是库里不会出现的状态
      loadKg: vehicle.id === SEED_IDS.vehicleAgv ? DEMO_TASK.cargoKg : 0,
      maxSpeedMps: vehicle.maxSpeedMps,
      battery: 100,
      x: node.x,
      y: node.y,
      currentNodeId: campusNodeId(node.code),
      online: true,
      lastHeartbeatAt: at,
      remark: null,
      createdAt: at,
      updatedAt: at
    };
  });

  const templates: TaskTemplateListItem[] = [
    {
      id: SEED_IDS.templateStandard,
      code: 'TPL-STD',
      name: '配送中心 → 楼宇标准配送',
      priority: 'normal',
      defaultCargoKg: 100,
      timeWindowMinutes: 60,
      fromSiteType: 'depot',
      toSiteType: 'dock',
      remark: null,
      createdAt: at,
      updatedAt: at
    },
    {
      id: SEED_IDS.templateReturn,
      code: 'TPL-RET',
      name: '楼宇 → 配送中心回库回充',
      priority: 'low',
      // 0 而不是 null：回充任务真的不带货，两者在界面上都显示「0 / —」，
      // 但库里的默认载重是 0（`default_cargo_kg REAL NOT NULL DEFAULT 0`）
      defaultCargoKg: 0,
      timeWindowMinutes: 120,
      fromSiteType: 'dock',
      toSiteType: 'depot',
      remark: null,
      createdAt: at,
      updatedAt: at
    }
  ];

  const tasks: SeedTask[] = [
    {
      id: DEMO_TASK.id,
      code: DEMO_TASK.code,
      title: DEMO_TASK.title,
      status: 'running',
      priority: 'normal',
      cargoKg: DEMO_TASK.cargoKg,
      cargoDesc: '演示货物',
      fromSiteId: campusSiteId(DEMO_TASK.fromSite),
      toSiteId: campusSiteId(DEMO_TASK.toSite),
      timeWindowStart: null,
      timeWindowEnd: null,
      templateId: SEED_IDS.templateStandard,
      assignedVehicleId: SEED_IDS.vehicleAgv,
      progress: demoProgress,
      createdAt: at,
      submittedAt: at,
      assignedAt: at,
      startedAt: at
    },
    ...SEED_PENDING.map((pending, index) => ({
      id: SEED_IDS.pendingTasks[index]!,
      code: `T-DEMO-${String(index + 2).padStart(4, '0')}`,
      title: pending.title,
      status: 'pending' as TaskStatus,
      priority: pending.priority,
      cargoKg: pending.cargoKg,
      cargoDesc: null,
      fromSiteId: campusSiteId(pending.from),
      toSiteId: campusSiteId(pending.to),
      // 时间窗跟着入参 `at` 走：演示数据若把窗口冻在第一次 seed 的时刻，
      // 过一天就会全部因超时被拒，而那段拒绝原因看起来像业务故障
      timeWindowStart: at,
      timeWindowEnd: new Date(Date.parse(at) + pending.windowMinutes * 60_000).toISOString(),
      templateId: null,
      assignedVehicleId: null,
      progress: 0,
      // 每条晚 1 秒：让 `ORDER BY created_at` 有一个**全序**（并列时 SQLite 不保证顺序）
      createdAt: new Date(Date.parse(at) + (index + 1) * 1000).toISOString(),
      submittedAt: at,
      assignedAt: null,
      startedAt: null
    }))
  ];

  const demoAlert: SeedAlert = {
    id: SEED_IDS.demoAlert,
    type: 'vehicle_offline',
    level: 'warning',
    objectType: 'vehicle',
    objectId: SEED_IDS.vehicleDrone,
    message: 'DRN-01 心跳超时，疑似离线',
    status: 'new',
    createdAt: at
  };

  return { nodes, edges, sites, restrictions, vehicles, templates, tasks, demoRoute, demoAlert, demoProgress };
}

/**
 * 站点锚定的路网节点 = 它绑定边的**两个端点中离站点坐标更近的那个**。
 *
 * 曾经的实现一律取 `edge.fromCode`，看起来「站点总是落在边的起点」，但那条边是**有向**的：
 * `campus_stations.csv` 里 `ST09` 绑在 `E_N13_N23` 上、坐标 (220, 450)，
 * 而 `N13` 在 (150, 450)、`N23` 在 (300, 450) —— `fromCode` 给出的 `N13` 比 `N23` 更远，
 * 车辆要先把货送到 150 m 外再折返 450 m 到站点，演示路线的里程因此凭空多出近一倍。
 * 最近端点的判据与泊位坐标同源（都是米制平面坐标，D-05），不需要额外的映射表。
 */
function nearestEndpointOf(
  station: CampusMapPackage['stations'][number],
  edge: CampusMapPackage['edges'][number],
  nodes: Map<string, CampusMapPackage['nodes'][number]>
): string {
  const from = nodes.get(edge.fromCode);
  const to = nodes.get(edge.toCode);
  if (!from || !to) {
    throw new Error(`边 ${edge.code} 的端点在节点表里缺失：${edge.fromCode} / ${edge.toCode}`);
  }
  const dist = (node: CampusMapPackage['nodes'][number]) =>
    (node.x - station.x) ** 2 + (node.y - station.y) ** 2;
  return campusNodeId(dist(from) <= dist(to) ? edge.fromCode : edge.toCode);
}

function stationNodeOf(
  stations: Map<string, CampusMapPackage['stations'][number]>,
  edges: Map<string, CampusMapPackage['edges'][number]>,
  nodes: Map<string, CampusMapPackage['nodes'][number]>,
  stationCode: string
): string {
  const station = stations.get(stationCode);
  if (!station) {
    throw new Error(`种子数据引用了地图包里不存在的站点 ${stationCode}`);
  }
  const edge = edges.get(station.edgeCode);
  if (!edge) {
    throw new Error(`站点 ${stationCode} 绑定的边 ${station.edgeCode} 不在边表里`);
  }
  return nearestEndpointOf(station, edge, nodes);
}

/**
 * 演示路线**由内核算出来**，不手写节点清单。
 *
 * 手写清单只有两种结局：要么写错一条边（`edge_ids` 是 JSON 文本、没有外键，
 * 写错只在前端按 id 高亮时静默匹配不上），要么在路网换掉之后变成一条压着空气的线。
 * 这里用与调度器**同一份内核、同一张图**（含权重与禁行）算，于是三者不可能不一致。
 */
function planDemoRoute(input: {
  nodes: NodeListItem[];
  edges: EdgeListItem[];
  restrictions: RestrictionListItem[];
  fromNodeId: string;
  toNodeId: string;
  at: string;
}): RouteDetail {
  const graph = buildRouteGraph({
    nodes: input.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, status: node.status })),
    edges: input.edges.map((edge) => ({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      lengthM: edge.lengthM,
      speedLimitMps: edge.speedLimitMps,
      weight: edge.weight,
      status: edge.status
    })),
    restrictions: input.restrictions.map((restriction) => ({
      type: restriction.type,
      targetId: restriction.targetId,
      startAt: restriction.startAt,
      endAt: restriction.endAt,
      vehicleType: restriction.vehicleType,
      status: restriction.status
    })),
    vehicleType: 'agv',
    at: input.at
  });
  const found = searchRoute(graph, {
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    algorithm: 'aStar',
    vehicleType: 'agv'
  });
  if (!found.ok) {
    throw new Error(`演示路线规划失败（${input.fromNodeId} → ${input.toNodeId}）：${found.reason}`);
  }
  return {
    id: SEED_IDS.demoRoute,
    taskId: DEMO_TASK.id,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    viaNodeIds: found.nodeIds.slice(1, -1),
    nodeIds: found.nodeIds,
    edgeIds: found.edgeIds,
    distanceM: found.distanceM,
    durationS: found.durationS,
    algorithm: 'aStar',
    costDetail: {},
    warnings: found.warnings.map((warning) => warning.code),
    createdAt: input.at,
    createdBy: 'seed'
  };
}
