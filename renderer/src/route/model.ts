/**
 * 路径规划页（M5）的**表单与展示模型**。
 *
 * 与 `task/model.ts` 同一分工：本文件只做「用户输入 → 请求载荷」与
 * 「响应 → 可展示的行」，不含任何请求、不含 JSX。因此它可以脱离 DOM 逐条测
 * （`model.test.ts`），页面里也就不需要为「途经点怎么写上去」这类事做内联判断。
 *
 * ## 为什么途经点用**一个文本框**而不是多个下拉
 *
 * 途经点是**有序**的，而且常见用法是「照着一条既有路线敲几个节点」。
 * 下拉框方案要么给 ≤10 个固定槽位（大部分时候全空着），要么做成可增删的动态行
 * （键盘操作繁琐、顺序还容易改错）。文本框 + 一行提示的代价是必须解析用户输入，
 * 而那正好该由本文件负责并测到 —— 解析失败要给出「哪个词认不出来」，
 * 而不是静默丢弃（静默丢弃会让使用者以为途经点生效了，而路线其实是另一条）。
 *
 * ## 校验边界
 *
 * 这里**只做「载荷能不能构造出来」的检查**（必填、途经点能不能解析成节点）。
 * 其余规则（车种枚举、途经点个数上限、起终点是否存在）一律交给服务端 ——
 * 那是 `shared/src/route-rules.ts` 与领域服务的唯一作者（D-34）。
 * 在前端再写一遍就会多出一份必须手工同步的规则（`ISS-032` 那一类）。
 */
import {
  ROUTE_ALGORITHMS,
  VEHICLE_TYPES,
  type NodeListItem,
  type RouteAlgorithm,
  type RouteCompareResponse,
  type RoutePlan,
  type VehicleType
} from '@udm/shared';
import { formatNumber } from '../domain/format';
import { ROUTE_ALGORITHM_LABEL, VEHICLE_TYPE_LABEL } from '../domain/labels';

export interface RouteQuery {
  fromNodeId: string;
  toNodeId: string;
  /** 途经点的**自由文本**（逗号 / 空格分隔，可写节点编码或 id）。 */
  viaText: string;
  vehicleType: VehicleType;
  algorithm: RouteAlgorithm;
}

export const EMPTY_ROUTE_QUERY: RouteQuery = {
  fromNodeId: '',
  toNodeId: '',
  viaText: '',
  // 默认车种取 agv：演示数据里的在跑车辆是 AGV，选它能让默认规划结果与地图上的
  // 演示路线一致（20 m × 5 段 / 1.5 m/s）。默认算法取 aStar，与 settings 的默认值一致
  vehicleType: 'agv',
  algorithm: 'aStar'
};

/** 页面下拉用的车种选项（顺序与 `VEHICLE_TYPES` 一致，避免两处顺序不同）。 */
export const VEHICLE_OPTIONS = VEHICLE_TYPES.map((value) => ({ value, label: VEHICLE_TYPE_LABEL[value] }));

/** 页面下拉用的算法选项。 */
export const ALGORITHM_OPTIONS = ROUTE_ALGORITHMS.map((value) => ({ value, label: ROUTE_ALGORITHM_LABEL[value] }));

export interface NodeOption {
  value: string;
  label: string;
  code: string;
  disabled: boolean;
}

/**
 * 节点下拉选项：`N01 · 园区节点 1`。
 *
 * 编码在前、名称在后：规划时使用者看到的多是自己认得的编码（路网文件里也是编码），
 * 名称只是辅助。**已停用节点不隐藏而是禁用**（`disabled: true`）——
 * 隐藏会让人以为「这个节点不存在」，而真实情况是它在库里、只是不参与调度，
 * 那种差别决定了使用者是去基础数据里启用它，还是去查编码是不是敲错了。
 */
export function nodeOptionsOf(nodes: NodeListItem[]): NodeOption[] {
  return nodes.map((node) => ({
    value: node.id,
    label: `${node.code} · ${node.name}`,
    code: node.code,
    disabled: node.status !== 'enabled'
  }));
}

/** 途经点文本里被认出来的 / 没认出来的词。 */
export interface ViaParseResult {
  ids: string[];
  unknown: string[];
}

/**
 * 解析途经点文本。
 *
 * 分隔符接受逗号（半角/全角）、顿号与空白 —— 使用者从表格或地图上复制节点时常带空格。
 * 匹配规则是「节点编码（大小写不敏感）或节点 id（区分大小写）」：
 * id 是内部值，只在从别处（日志、接口响应）复制过来时出现，故不额外做模糊匹配。
 * **重复的途经点只保留第一次**：重复经过同一个节点在几何上没有意义（会得到 0 m 的段），
 * 而且那是使用者手滑复制，不是意图。
 */
export function parseViaInput(text: string, nodes: NodeListItem[]): ViaParseResult {
  const tokens = text
    .split(/[,，、\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const byCode = new Map(nodes.map((node) => [node.code.toUpperCase(), node.id]));
  const byId = new Set(nodes.map((node) => node.id));
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const token of tokens) {
    const id = byCode.get(token.toUpperCase()) ?? (byId.has(token) ? token : undefined);
    if (id === undefined) {
      unknown.push(token);
      continue;
    }
    if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return { ids, unknown };
}

export interface PayloadBuild {
  payload: Record<string, unknown> | null;
  /** 字段级错误：键 = 表单字段名，与 `useApiWrite` 的 `detail.fields` 同一形状。 */
  fields: Record<string, string>;
}

/** 用户输入 → `POST /api/routes/plan` 的载荷。字段不全或途经点解析失败时 `payload = null`。 */
export function buildPlanPayload(query: RouteQuery, nodes: NodeListItem[]): PayloadBuild {
  const fields: Record<string, string> = {};
  if (!query.fromNodeId) {
    fields['fromNodeId'] = '请选择起点节点';
  }
  if (!query.toNodeId) {
    fields['toNodeId'] = '请选择终点节点';
  }
  const via = parseViaInput(query.viaText, nodes);
  if (via.unknown.length > 0) {
    fields['viaText'] = `认不出这些节点：${via.unknown.join('、')}（可填节点编码，如 N02）`;
  }
  if (Object.keys(fields).length > 0) {
    return { payload: null, fields };
  }
  return {
    payload: {
      fromNodeId: query.fromNodeId,
      toNodeId: query.toNodeId,
      // 空数组与不传等价（`validateRouteInput` 的口径），这里统一成空数组，
      // 免得「传了空数组」与「没传」在日志里看起来是两种请求
      viaNodeIds: via.ids,
      vehicleType: query.vehicleType,
      algorithm: query.algorithm
    },
    fields: {}
  };
}

/** 路线结果的一行摘要（顺序即展示顺序）。 */
export interface RouteFact {
  label: string;
  value: string;
}

/** 把规划结果铺成可展示的条目。**所有单位与小数位都在这里定**（`domain/format` 的口径）。 */
export function routeFactsOf(route: RoutePlan): RouteFact[] {
  return [
    { label: '里程', value: `${formatNumber(route.distanceM)} m` },
    { label: '预计耗时', value: `${formatNumber(route.durationS)} s` },
    { label: '经停节点', value: `${route.nodeIds.length} 个` },
    { label: '经过边', value: `${route.edgeIds.length} 条` },
    { label: '算法', value: ROUTE_ALGORITHM_LABEL[route.algorithm as RouteAlgorithm] ?? route.algorithm }
  ];
}

/** 节点链：`N01 → N02 → …`（用编码而不是 id，id 是内部值）。 */
export function nodeChainOf(route: RoutePlan, nodes: NodeListItem[]): string[] {
  const codeOf = new Map(nodes.map((node) => [node.id, node.code]));
  return route.nodeIds.map((id) => codeOf.get(id) ?? id);
}

/** 对比表的一行。 */
export interface CompareRow {
  algorithm: string;
  label: string;
  distanceM: string;
  durationS: string;
  elapsedMs: string;
  nodeCount: number;
}

export function compareRowsOf(response: RouteCompareResponse): CompareRow[] {
  return response.results.map((item) => ({
    algorithm: item.algorithm,
    label: ROUTE_ALGORITHM_LABEL[item.algorithm as RouteAlgorithm] ?? item.algorithm,
    distanceM: `${formatNumber(item.route.distanceM)} m`,
    durationS: `${formatNumber(item.route.durationS)} s`,
    elapsedMs: `${item.elapsedMs} ms`,
    nodeCount: item.route.nodeIds.length
  }));
}

/**
 * 对比结果的结论文案。
 *
 * `consistent=false` 不是「两种策略各有取舍」，而是**实现缺陷**（A* 的启发式高估了
 * 剩余时间）。因此文案要说清「已记入审计待排查」，而不是让使用者以为自己在看两种合理的方案。
 */
export function compareVerdict(response: RouteCompareResponse): { tone: 'ok' | 'danger'; text: string } {
  if (response.consistent) {
    return { tone: 'ok', text: '两个算法结果一致：里程与耗时完全相同' };
  }
  return {
    tone: 'danger',
    text: `两个算法结果不一致（里程差 ${formatNumber(response.difference.distanceM)} m、耗时差 ${formatNumber(
      response.difference.durationS
    )} s）。这属于实现缺陷，已记入审计，请联系维护者`
  };
}
