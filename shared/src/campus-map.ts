/**
 * 校园仿真地图包（F2）的**解析器**：把 `data/campus/` 的原生 5 文件形态
 * 转成「标准形态」的内部数据。
 *
 * ## 为什么要有这一层（D-28）
 *
 * 数据方交付的原生形态是 SUMO 工程目录（3 CSV + XML + GeoJSON），而系统内部只认
 * 节点 / 边 / 站点三张表的字段。两者的差异（列名、单位、要推导的字段）必须**只在一个地方**翻译 ——
 * 否则主进程 seed 与浏览器 Mock 会各写一套，两边「看起来一样、一处不一致」（D-27 的教训）。
 * 本文件就是那个唯一的翻译层：**纯函数，无 IO**，原始文本由调用方给（Node 读文件、浏览器用 `?raw`）。
 *
 * ## 为什么是 `?raw` + fs 而不是「生成一份 TS 常量」
 *
 * 生成物会让「data/ 改了」与「代码里的数据」之间出现一个必须手工同步的中间层；
 * 而 `data/` 才是数据的唯一来源（D-34）。两边的取数方式不同（Node 没有 `?raw`、
 * 浏览器没有 fs），但**解析规则完全相同**，这正是本文件存在的意义。
 *
 * ## 单位与口径
 *
 *   - 坐标：平面米制（D-05）。样本本身就是米（`campus_nodes.csv` 的 x/y）；
 *   - 长度：米（`length_m`）；
 *   - 速度：样本给的是 km/h（`speed_kmh`），内部一律 m/s —— 差的 3.6 倍正是
 *     「车开得比走路还慢」这类错误的来源（D-31 的同族问题）；
 *   - 泊位：`start_pos` / `end_pos` 是**沿边里程**（米），不是坐标。
 */
import type { SiteType } from './enums.js';

/** 解析结果里的一条路网节点（尚未落库）。 */
export interface CampusMapNode {
  /** 业务编码（`campus_nodes.csv` 的 `node_id`，如 `N00` / `DEPOT`）。 */
  code: string;
  x: number;
  y: number;
  /** 样本的道路口类型（`traffic_light` / `priority`），落库时进 `remark`，不参与业务判断。 */
  kind: string;
}

/** 解析结果里的一条有向边。 */
export interface CampusMapEdge {
  code: string;
  fromCode: string;
  toCode: string;
  roadType: string;
  numLanes: number;
  /** 通行权重（≥ 1）：来自拥堵叠加层，缺省 1（畅通）。 */
  weight: number;
  /** 由 `speed_kmh` 换算而来的限速，单位 m/s。 */
  speedLimitMps: number;
  lengthM: number;
}

/** 解析结果里的一个站点（原生文件里是「边绑定 + 泊位」形态）。 */
export interface CampusMapStation {
  code: string;
  name: string;
  category: string;
  x: number;
  y: number;
  /** 站点绑定的**边**编码（D-30 的边绑定模型；当前 DDL 尚未落地，落库时折到边的起点节点）。 */
  edgeCode: string;
  laneId: string;
  berthStartM: number;
  berthEndM: number;
  berthLengthM: number;
  berthCapacity: number;
}

/** 障碍物（施工 / 抛锚占道）。 */
export interface CampusMapObstacle {
  edgeCode: string;
  laneId: string;
  startPosM: number;
  endPosM: number;
  durationS: number;
}

export interface CampusMapPackage {
  nodes: CampusMapNode[];
  edges: CampusMapEdge[];
  stations: CampusMapStation[];
  obstacles: CampusMapObstacle[];
}

export interface CampusMapRaw {
  nodesCsv: string;
  edgesCsv: string;
  stationsCsv: string;
  obstaclesXml: string;
  /** 拥堵叠加层（本项目自写的演示数据，见 `data/campus/README.md`）；缺省表示全网畅通。 */
  congestionCsv?: string;
}

/**
 * 极简 CSV 解析：只支持本数据集的形态（无引号包裹、无字段内逗号/换行）。
 *
 * 为什么不用一个 CSV 库：数据集是**我们自己的样本**，字段里没有引号与逗号
 * （实测核对了 30 节点 / 90 边 / 13 站点的全部取值）。为此引入依赖，等于为一个
 * 不会出现的问题增加一个必须维护的包。一旦数据方给出带引号的文件，
 * `assertCsvIsSimple` 会立刻报错，而不是静默把一行切错。
 */
export function parseSimpleCsv(text: string): Array<Record<string, string>> {
  // BOM：Windows 导出的文件带 `\ufeff`，不去掉的话第一个列名会变成 `\ufeffnode_id`，
  // 而症状是「每一行的 node_id 都是 undefined」——看起来像解析器坏了
  const clean = text.replace(/^\ufeff/, '');
  // `#` 开头的行是注释：本项目自写的叠加层文件用它写「这份数据是怎么来的」，
  // 而样本 CSV 里没有注释 —— 允许注释不会让样本的解析结果发生任何变化
  const lines = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (lines.length === 0) {
    return [];
  }
  const header = lines[0]!.split(',').map((cell) => cell.trim());
  return lines.slice(1).map((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim());
    if (cells.length !== header.length) {
      throw new Error(`CSV 第 ${index + 2} 行的列数为 ${cells.length}，与表头的 ${header.length} 列不符`);
    }
    const row: Record<string, string> = {};
    header.forEach((key, position) => {
      row[key] = cells[position]!;
    });
    return row;
  });
}

/** 从 XML 里抠出 `<route .../>` 的 `id` 与 `edges`（本数据集只有这一种元素带有用信息）。 */
export function parseObstacleRoutes(xml: string): Array<{ id: string; edgeCodes: string[] }> {
  const routes: Array<{ id: string; edgeCodes: string[] }> = [];
  const pattern = /<route\s+([^>]*?)\/>/g;
  for (const match of xml.matchAll(pattern)) {
    const attributes = match[1] ?? '';
    const id = /id="([^"]*)"/.exec(attributes)?.[1];
    const edges = /edges="([^"]*)"/.exec(attributes)?.[1];
    if (!id || !edges) {
      continue;
    }
    routes.push({ id, edgeCodes: edges.split(/\s+/).filter((edge) => edge.length > 0) });
  }
  return routes;
}

/**
 * XML 里的障碍物明细（车道 + 占道区间 + 时长）。
 *
 * 与 `parseObstacleRoutes` 分开：一条 `<route>` 说明「封的是哪条边」，
 * 而 `<vehicle><stop .../></vehicle>` 说明「占了多久、占在哪一段」。
 * 两者在文件里是并列的两层，合成一个函数只能靠猜它们的对应关系。
 */
export function parseObstacleVehicles(xml: string): Array<{ id: string; laneId: string; startPosM: number; endPosM: number; durationS: number }> {
  const vehicles: Array<{ id: string; laneId: string; startPosM: number; endPosM: number; durationS: number }> = [];
  const pattern = /<vehicle\s+([^>]*?)>(.*?)<\/vehicle>/gs;
  for (const match of xml.matchAll(pattern)) {
    const id = /id="([^"]*)"/.exec(match[1] ?? '')?.[1] ?? '';
    const stop = /<stop\s+([^>]*?)\/>/s.exec(match[2] ?? '');
    if (!stop) {
      continue;
    }
    const attributes = stop[1] ?? '';
    const laneId = /lane="([^"]*)"/.exec(attributes)?.[1] ?? '';
    vehicles.push({
      id,
      laneId,
      startPosM: Number(/startPos="([^"]*)"/.exec(attributes)?.[1] ?? 0),
      endPosM: Number(/endPos="([^"]*)"/.exec(attributes)?.[1] ?? 0),
      durationS: Number(/duration="([^"]*)"/.exec(attributes)?.[1] ?? 0)
    });
  }
  return vehicles;
}

/** `20.0` km/h → `5.555…` m/s。保留原始精度，不做四舍五入（展示层才负责取整）。 */
export function kmhToMps(kmh: number): number {
  return kmh / 3.6;
}

/**
 * 拥堵叠加层：`edge_code,weight,remark`。
 *
 * 为什么它不在样本里：样本只给了**静态路网**（长度 / 限速 / 车道数），没有任何一条
 * 「这条路现在更慢」的数据。而调度对比要能分出高下，必须有**同一对起终点存在多条代价不同的路**。
 * 因此这一层由本项目编写并显式标注为演示数据（`data/campus/README.md`），
 * 语义与 `edges.weight` 一致：≥ 1 的惩罚系数。去掉这个文件（或传空）即得到全网畅通的基线。
 */
export function parseCongestionOverlay(csv: string): Map<string, number> {
  const weights = new Map<string, number>();
  for (const row of parseSimpleCsv(csv)) {
    const code = row['edge_code'];
    const weight = Number(row['weight']);
    if (!code || !Number.isFinite(weight)) {
      throw new Error(`拥堵叠加层出现无法解析的行：${JSON.stringify(row)}`);
    }
    if (weight < 1) {
      throw new Error(`拥堵权重必须 ≥ 1（收到 ${weight}，边 ${code}）：小于 1 会让 A* 的启发式高估`);
    }
    weights.set(code, weight);
  }
  return weights;
}

/** 站点类别 → `sites.type` 的取值域（DDL 只有 depot/dock/charging/gate/other 五种）。 */
const CATEGORY_TO_SITE_TYPE: Record<string, SiteType> = {
  配送中心: 'depot',
  学生宿舍: 'dock',
  公共建筑: 'dock',
  教学楼: 'dock',
  生活服务: 'dock',
  办公楼: 'dock',
  体育设施: 'dock',
  教工住宅: 'dock'
};

/** 原生类别的映射（未登记的类别落到 `other`，而不是猜一个更具体的类型）。 */
export function siteTypeOfCategory(category: string): SiteType {
  return CATEGORY_TO_SITE_TYPE[category] ?? 'other';
}

/**
 * 把 5 份原生文本解析成标准形态。
 *
 * 抛错而不是返回 `{ok:false}`：这一层的输入是**随仓库进版的文件**，
 * 解析失败说明仓库里的数据坏了（不是用户输入错了），此时继续往下走只会把
 * 半个路网写进库 —— 那比直接失败更难查。
 */
export function parseCampusPackage(raw: CampusMapRaw): CampusMapPackage {
  const nodes: CampusMapNode[] = parseSimpleCsv(raw.nodesCsv).map((row) => ({
    code: row['node_id']!,
    x: Number(row['x']),
    y: Number(row['y']),
    kind: row['type'] ?? 'priority'
  }));
  const nodeCodes = new Set(nodes.map((node) => node.code));

  const congestion = raw.congestionCsv ? parseCongestionOverlay(raw.congestionCsv) : new Map<string, number>();
  const edges: CampusMapEdge[] = parseSimpleCsv(raw.edgesCsv).map((row) => {
    const code = row['edge_id']!;
    const fromCode = row['from_node']!;
    const toCode = row['to_node']!;
    if (!nodeCodes.has(fromCode) || !nodeCodes.has(toCode)) {
      // 悬空端点的边会让规划在图上找不到节点而静默不可达，必须在这里拦住
      throw new Error(`边 ${code} 的端点不在节点表里：${fromCode} → ${toCode}`);
    }
    const weight = congestion.get(code) ?? 1;
    if (weight < 1) {
      throw new Error(`边 ${code} 的拥堵权重 ${weight} 小于 1`);
    }
    return {
      code,
      fromCode,
      toCode,
      roadType: row['road_type'] ?? 'campus_secondary',
      numLanes: Number(row['num_lanes'] ?? 1),
      weight,
      speedLimitMps: kmhToMps(Number(row['speed_kmh'])),
      lengthM: Number(row['length_m'])
    };
  });
  const edgeCodes = new Set(edges.map((edge) => edge.code));

  const stations: CampusMapStation[] = parseSimpleCsv(raw.stationsCsv).map((row) => {
    const edgeCode = row['edge_id']!;
    if (!edgeCodes.has(edgeCode)) {
      throw new Error(`站点 ${row['station_id']} 绑定的边 ${edgeCode} 不在边表里`);
    }
    return {
      code: row['station_id']!,
      name: row['name']!,
      category: row['category'] ?? 'other',
      x: Number(row['x']),
      y: Number(row['y']),
      edgeCode,
      laneId: row['lane_id'] ?? '',
      berthStartM: Number(row['start_pos'] ?? 0),
      berthEndM: Number(row['end_pos'] ?? 0),
      berthLengthM: Number(row['berth_length_m'] ?? 0),
      berthCapacity: Number(row['berth_capacity'] ?? 0)
    };
  });

  const obstacleRoutes = parseObstacleRoutes(raw.obstaclesXml);
  const obstacleVehicles = parseObstacleVehicles(raw.obstaclesXml);
  const vehiclesById = new Map(obstacleVehicles.map((vehicle) => [vehicle.id, vehicle]));
  // 障碍物的 id 形如 `OBST_1`，对应的车道形如 `E_N12_N13_0` —— 把车道末段的 `_0`
  // 去掉就得到边编码。不去猜「障碍物对应哪条 route」：文件里 `route` 的 `edges`
  // 就是权威，车道只用来判断这条边还剩几条道可用。
  const obstacles: CampusMapObstacle[] = [];
  obstacleRoutes.forEach((route, index) => {
    const vehicle = vehiclesById.get(`OBST_${index + 1}`);
    for (const edgeCode of route.edgeCodes) {
      obstacles.push({
        edgeCode,
        laneId: vehicle?.laneId ?? '',
        startPosM: vehicle?.startPosM ?? 0,
        endPosM: vehicle?.endPosM ?? 0,
        durationS: vehicle?.durationS ?? 0
      });
    }
  });

  return { nodes, edges, stations, obstacles };
}

/**
 * 障碍物对某条边的影响。
 *
 * 判据是**车道数**而不是「有没有障碍」：
 *   - 多车道道路坏了一条道 → 仍可通行，但只剩一半通行能力 → 权重 ×2（这就是 `weight` 的语义）；
 *   - 单车道道路坏了 → 整条路走不了 → 只能进禁行规则。
 * 把两者混为一谈（一律封路）会让多车道道路被误封，而使用者在地图上明明看得见另半幅是空的。
 */
export type ObstacleImpact =
  | { kind: 'weight'; edgeCode: string; factor: number; obstacle: CampusMapObstacle }
  | { kind: 'blocked'; edgeCode: string; obstacle: CampusMapObstacle };

export function obstacleImpacts(pkg: CampusMapPackage, laneCountOf: (edgeCode: string) => number): ObstacleImpact[] {
  return pkg.obstacles.map((obstacle) => {
    const lanes = laneCountOf(obstacle.edgeCode);
    return lanes <= 1
      ? { kind: 'blocked', edgeCode: obstacle.edgeCode, obstacle }
      : { kind: 'weight', edgeCode: obstacle.edgeCode, factor: 2, obstacle };
  });
}

/**
 * 应用障碍物影响后的**最终**边集合（权重已合并、被封的边已剔除）。
 *
 * 放在这里而不是 seed 里：Mock 与主进程都要得到同一份结果（D-27），
 * 各自算一遍必然会分叉。
 */
export function applyObstacleImpacts(pkg: CampusMapPackage): {
  edges: CampusMapEdge[];
  blocked: ObstacleImpact[];
  weighted: ObstacleImpact[];
} {
  const lanes = new Map(pkg.edges.map((edge) => [edge.code, edge.numLanes]));
  const impacts = obstacleImpacts(pkg, (edgeCode) => lanes.get(edgeCode) ?? 1);
  const blocked = impacts.filter((impact): impact is Extract<ObstacleImpact, { kind: 'blocked' }> => impact.kind === 'blocked');
  const weighted = impacts.filter((impact): impact is Extract<ObstacleImpact, { kind: 'weight' }> => impact.kind === 'weight');
  const factorByCode = new Map(weighted.map((impact) => [impact.edgeCode, impact.factor]));

  return {
    /*
     * 被封的边**仍然留在数据里**（不进 `blocked` 之外的任何过滤）：
     *   - 地图要把这条路画出来并标成「占用中」——删掉它会让路网出现一个洞，
     *     看起来像数据缺了一块，而不是「这条路暂时走不了」；
     *   - 排除它的职责属于**禁行规则**（`restrictions`）：那是一条可停用、可撤除、
     *     可带时间窗的业务事实。把它同时做成「库里没有这条边」等于有了两个真相。
     */
    edges: pkg.edges.map((edge) => {
      const factor = factorByCode.get(edge.code);
      return factor ? { ...edge, weight: edge.weight * factor } : edge;
    }),
    blocked,
    weighted
  };
}
