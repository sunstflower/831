/**
 * 路径规划领域服务（M5，`docs/api.md` §3.5）。
 *
 * ## 这个服务只做「查库 → 构图 → 搜图 → 翻译错误」，一行算法都没有
 *
 * 搜索内核在 `shared/src/route-search.ts`、构图在 `shared/src/route-graph.ts`、
 * 字段规则在 `shared/src/route-rules.ts` —— 三者都是纯函数，浏览器 Mock 与主进程共用同一份。
 * 服务层剩下的唯一职责是**把库里的行喂给内核、把内核的失败翻译成错误码**，
 * 以及在这里才读得到的 `settings`。若把构图再抄一份到这里，两份实现的分叉只会
 * 在切换运行形态时显形（D-27 / D-44 的形态）。
 *
 * ## 失败原因 → 错误码的映射是本文件的核心
 *
 * `searchRoute` 返回五种 `reason`，它们对应的**处置动作完全不同**：
 *
 *   | reason | code | 使用者该做什么 |
 *   | --- | --- | --- |
 *   | `GRAPH_EMPTY` | `GRAPH.EMPTY` | 路网没数据，先去基础数据建档或导入地图 |
 *   | `GRAPH_DISCONNECTED` | `GRAPH.DISCONNECTED` | 所有边都被禁用/封住，检查禁用项 |
 *   | `BLOCKED` | `GRAPH.BLOCKED` | 端点被禁行规则封住，改规则或换时间窗 |
 *   | `NOT_FOUND_PATH` | `ROUTE.NOT_FOUND_PATH` | 路网规划问题，两点确实不连通 |
 *   | `VIA_UNREACHABLE` | `ROUTE.NOT_FOUND_PATH` | 同上，但 `detail.unreachableVia` 指出是哪一段 |
 *
 * 五种合成四种 code 是**故意的**：`VIA_UNREACHABLE` 与 `NOT_FOUND_PATH` 对使用者是同一件事
 * （这条线走不通），差别只是「走不通的位置」—— 那个信息放 `detail` 而不是拆成第五个 code。
 * 反过来说，前四种合并任何一个都会让使用者拿到一句无法行动的话。
 *
 * ## 不覆写错误文案
 *
 * `DomainError(code, message)` 的第二个参数在这里一律不传：面向使用者的文案由
 * `ERROR_CODES[code].message` **唯一作者**产出（渲染层也按 code 映射同一句话）。
 * 覆写文案会让「主进程说一句、Mock 说另一句」，而 `mock-parity.test.ts` 正是逐字比对
 * 两边 message 的 —— 那种分叉在浏览器里永远看不出来（D-33 / D-48 的同一原则）。
 * 具体是哪个节点、哪一段走不通，放 `detail`。
 */
import {
  DomainError,
  ROUTE_ALGORITHMS,
  buildRouteGraph,
  searchRoute,
  validateRouteInput,
  type ErrorCode,
  type RouteAlgorithm,
  type RouteCompareItem,
  type RouteCompareResponse,
  type RouteDetail,
  type RouteFailure,
  type RouteFailureReason,
  type RoutePlan,
  type RoutePlanInput,
  type RoutePlanResponse,
  type RouteSearchSuccess
} from '@udm/shared';
import { nowIso, tx } from '../../db/index.js';
import {
  findRouteById,
  listGraphEdges,
  listGraphNodes,
  listRestrictionRules
} from '../../db/repositories/route.repo.js';
import { getSettings, parseSettingsValues } from '../../db/repositories/settings.repo.js';
import { writeAudit } from '../../services/audit.js';
import { toAuditActor, type CrudContext } from '../base/context.js';
import { invalid } from '../base/validate.js';

const FAILURE_CODE: Record<RouteFailureReason, ErrorCode> = {
  GRAPH_EMPTY: 'GRAPH.EMPTY',
  GRAPH_DISCONNECTED: 'GRAPH.DISCONNECTED',
  BLOCKED: 'GRAPH.BLOCKED',
  NOT_FOUND_PATH: 'ROUTE.NOT_FOUND_PATH',
  VIA_UNREACHABLE: 'ROUTE.NOT_FOUND_PATH'
};

/**
 * 内核失败 → `DomainError`。
 *
 * `detail` 里带上 `reason`（机器可读）与 `message`（内核给出的**具体**说明，含节点 id）。
 * 两者都不与 `ERROR_CODES` 的文案冲突：`detail.message` 是「这次为什么失败」，
 * catalog 的 `message` 是「这类失败是什么」。
 */
function toFailureError(failure: RouteFailure, extra?: Record<string, unknown>): DomainError {
  return new DomainError(FAILURE_CODE[failure.reason], undefined, {
    reason: failure.reason,
    message: failure.message,
    ...(failure.unreachableVia ? { unreachableVia: failure.unreachableVia } : {}),
    ...(failure.reachedNodeId ? { reachedNodeId: failure.reachedNodeId } : {}),
    visitedNodes: failure.visitedNodes,
    ...extra
  });
}

/**
 * 缺省算法：请求没给 `algorithm` 时取 `settings.route.defaultAlgorithm`。
 *
 * 为什么不直接在 `validateRouteInput` 里默认成 `aStar`：那个函数是**字段规则**，
 * 只回答「给了的值合法吗」。而「没给时用哪个」是**运行期配置**，存在 `settings` 表里
 * （`SETTINGS_SCHEMA` 的 `route.defaultAlgorithm`），规则层读不到库。
 * 设置值被手工改成非法字符串时回落 `aStar` 而不是报错：一个设置项写坏不该让
 * 所有路径规划都打不开（与 `parseSettingsValues` 对坏 JSON 的态度一致）。
 */
function resolveAlgorithm(ctx: CrudContext, raw: Record<string, unknown>, parsed: RoutePlanInput): RouteAlgorithm {
  const given = raw['algorithm'];
  if (given !== undefined && given !== null && given !== '') {
    return parsed.algorithm;
  }
  const settings = parseSettingsValues(getSettings(ctx.db));
  const configured = settings['route.defaultAlgorithm'];
  return typeof configured === 'string' && (ROUTE_ALGORITHMS as readonly string[]).includes(configured)
    ? (configured as RouteAlgorithm)
    : 'aStar';
}

interface PreparedPlan {
  input: RoutePlanInput;
  graph: ReturnType<typeof buildRouteGraph>;
}

/**
 * 校验 → 节点存在性 → 构图。`plan` 与 `compare` 共用（两者请求体逐字段相同）。
 *
 * **节点存在性在构图之前判**：构图会把「不存在」与「存在但被排除」都变成「图里没有它」，
 * 而那两种情况该报的错完全不同（`NODE.NOT_FOUND` vs `GRAPH.BLOCKED`）。
 * 先查一次全量节点表就能把它们分开，代价是一次本来就要读的查询。
 */
function prepare(ctx: CrudContext, raw: Record<string, unknown>): PreparedPlan {
  const parsed = validateRouteInput(raw);
  if (!parsed.ok) {
    throw invalid(parsed.fields);
  }
  const input: RoutePlanInput = {
    ...parsed.value,
    algorithm: resolveAlgorithm(ctx, raw, parsed.value)
  };

  const nodes = listGraphNodes(ctx.db);
  const known = new Set(nodes.map((node) => node.id));
  // 端点与途经点一起判：只判端点会让「途经点 id 打错了」被报告成「到不了那个途经点」，
  // 使用者会去查路网，而真正的问题在于 id 根本不存在
  for (const nodeId of [input.fromNodeId, input.toNodeId, ...input.viaNodeIds]) {
    if (!known.has(nodeId)) {
      throw new DomainError('NODE.NOT_FOUND', undefined, { id: nodeId });
    }
  }

  return {
    input,
    graph: buildRouteGraph({
      nodes,
      edges: listGraphEdges(ctx.db),
      restrictions: listRestrictionRules(ctx.db),
      vehicleType: input.vehicleType,
      // 时间窗用同一个时刻判：一次请求里所有段必须落在窗口的同一侧（`route-graph.ts` 的注释）
      at: nowIso()
    })
  };
}

function toRoutePlan(input: RoutePlanInput, result: RouteSearchSuccess): RoutePlan {
  return {
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    viaNodeIds: input.viaNodeIds,
    nodeIds: result.nodeIds,
    edgeIds: result.edgeIds,
    distanceM: result.distanceM,
    durationS: result.durationS,
    algorithm: result.algorithm,
    costDetail: { travelS: result.durationS },
    // 警告只暴露文案：契约里 `warnings: string[]` 直接给界面展示。
    // `code` 仍在（`route-search.ts` 的 `RouteWarning`），M6 若要按类型筛选再开口子
    warnings: result.warnings.map((warning) => warning.message)
  };
}

/** `POST /api/routes/plan`：预览，**不落库**（`docs/api.md` §3.5.1）。 */
export function planRoute(ctx: CrudContext, raw: Record<string, unknown>): RoutePlanResponse {
  const { input, graph } = prepare(ctx, raw);
  const result = searchRoute(graph, {
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    viaNodeIds: input.viaNodeIds,
    algorithm: input.algorithm,
    vehicleType: input.vehicleType
  });
  if (!result.ok) {
    throw toFailureError(result);
  }
  return { route: toRoutePlan(input, result) };
}

/**
 * `POST /api/routes/compare`：两个算法在同一张图上各算一次（`docs/api.md` §3.5.2）。
 *
 * 三处刻意的口径：
 *   1. **请求里的 `algorithm` 被忽略**（契约如此）—— 但仍会走字段校验：
 *      给了一个非法算法名应当报参数错误，而不是「静默忽略」；
 *   2. **构图只做一次**：两次搜索必须面对同一张图，否则差异里混进了「两次读数之间的数据变化」；
 *   3. 结果不一致时**写一条审计**（契约要求「记系统日志排查」）。A* 的启发式若不可采纳
 *      （高估剩余时间）就会给出更长的路线 —— 那是实现缺陷而不是策略差异，
 *      不记下来就只能靠人肉比对两条路线才能发现。
 */
export function compareRoutes(ctx: CrudContext, raw: Record<string, unknown>): RouteCompareResponse {
  const { input, graph } = prepare(ctx, raw);
  const results: RouteCompareItem[] = [];

  for (const algorithm of ROUTE_ALGORITHMS) {
    const startedAt = Date.now();
    const result = searchRoute(graph, {
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      viaNodeIds: input.viaNodeIds,
      algorithm,
      vehicleType: input.vehicleType
    });
    const elapsedMs = Date.now() - startedAt;
    if (!result.ok) {
      throw toFailureError(result, { algorithm });
    }
    results.push({ algorithm, route: toRoutePlan(input, result), elapsedMs });
  }

  const [first, second] = results as [RouteCompareItem, RouteCompareItem];
  const difference = {
    distanceM: Number(Math.abs(first.route.distanceM - second.route.distanceM).toFixed(3)),
    durationS: Number(Math.abs(first.route.durationS - second.route.durationS).toFixed(3))
  };
  const consistent = difference.distanceM === 0 && difference.durationS === 0;
  if (!consistent) {
    tx(ctx.db, () => {
      writeAudit(ctx.db, toAuditActor(ctx.actor), {
        module: 'route',
        action: 'compare_inconsistent',
        objectType: 'route',
        objectId: `${input.fromNodeId}->${input.toNodeId}`,
        result: 'failure',
        message: 'A* 与 Dijkstra 在相同输入上得出不同结果，存在实现缺陷',
        after: { algorithms: ROUTE_ALGORITHMS, difference, vehicleType: input.vehicleType }
      });
    });
  }
  return { results, consistent, difference };
}

/** `GET /api/routes/{id}`：已落库路线（`docs/api.md` §3.5.3）。 */
export function getRoute(ctx: CrudContext, id: string): RouteDetail {
  const route = findRouteById(ctx.db, id);
  if (!route) {
    throw new DomainError('ROUTE.NOT_FOUND', undefined, { id });
  }
  return route;
}
