/**
 * Mock 适配器的 **M5 路径规划**（浏览器形态）。
 *
 * ## 与主进程的两处分工（与 `mock-tasks.ts` 同口径）
 *
 *   - **算法与规则共享**：构图（`buildRouteGraph`）、搜索（`searchRoute`）、
 *     字段规则（`validateRouteInput`）全部来自 `@udm/shared` —— 与
 *     `desktop/src/domain/route/route.service.ts` 读的是**同一份代码**，
 *     因此「哪条路更短」「什么迁移合法」不可能分叉；
 *   - **存储各自**：主进程查 SQLite，这里查内存数组（`MockBaseData`）。
 *     这一段必然有两份实现，口径由 `mock-parity.test.ts` 用同一批请求打两边来锁死。
 *
 * ## 一处必然的重复：失败原因 → 错误码
 *
 * `FAILURE_CODE` 与主进程服务层的表逐项相同。它没能共享，是因为渲染层**不能 import
 * 主进程代码**（`desktop/` 不在渲染层的依赖里，且它带 `node:sqlite`）。
 * 把它放进 `shared` 也考虑过，但内核刻意不 import `errors.ts`
 * （`route-search.ts` 的注释：失败是返回值、码由领域服务决定）。
 * 因此这里保留一份，并靠 `mock-parity.test.ts` 对每个 `reason` 各打一次两边来防分叉 ——
 * 只留两份表而不加断言才是真的危险。
 *
 * ## Mock 侧没有 `settings` 表
 *
 * 主进程在请求没给 `algorithm` 时读 `settings.route.defaultAlgorithm`；这里用
 * `validateRouteInput` 的兜底值 `aStar` —— 与 `SETTINGS_SCHEMA` 里该键的
 * `defaultValue` 一致，也与 seed 写入库里的值一致。浏览器里若改了设置再规划，
 * 表现会与 Electron 不同：这是「Mock 没有设置存储」的已知边界，
 * 与「审计在 Mock 侧不写」是同一类（演示形态的边界，不是行为分叉）。
 */
import {
  ERROR_CODES,
  ROUTE_ALGORITHMS,
  buildRouteGraph,
  searchRoute,
  validateRouteInput,
  type ApiResult,
  type ErrorCode,
  type RouteCompareItem,
  type RouteFailure,
  type RouteFailureReason,
  type RoutePlan,
  type RoutePlanInput,
  type RouteSearchSuccess
} from '@udm/shared';
import type { HttpMethod } from './client';
import type { MockBaseData, MockRouteStore } from './mock-data';

export interface MockRouteRequest {
  method: HttpMethod;
  /** 去掉前导空段后的路径片段：`['api','routes','plan']`。 */
  segments: string[];
  payload: Record<string, unknown>;
}

function fail(code: ErrorCode, detail?: Record<string, unknown>): ApiResult<never> {
  const definition = ERROR_CODES[code];
  return { code, message: definition.message, source: definition.source, ...(detail ? { detail } : {}) };
}

function ok<T>(data: T): ApiResult<T> {
  return { code: 0, message: 'success', data };
}

const FAILURE_CODE: Record<RouteFailureReason, ErrorCode> = {
  GRAPH_EMPTY: 'GRAPH.EMPTY',
  GRAPH_DISCONNECTED: 'GRAPH.DISCONNECTED',
  BLOCKED: 'GRAPH.BLOCKED',
  NOT_FOUND_PATH: 'ROUTE.NOT_FOUND_PATH',
  VIA_UNREACHABLE: 'ROUTE.NOT_FOUND_PATH'
};

/** 与主进程 `toFailureError` 同形（含 `detail` 的每一个键）。 */
function toFailure(failure: RouteFailure, extra?: Record<string, unknown>): ApiResult<never> {
  return fail(FAILURE_CODE[failure.reason], {
    reason: failure.reason,
    message: failure.message,
    ...(failure.unreachableVia ? { unreachableVia: failure.unreachableVia } : {}),
    ...(failure.reachedNodeId ? { reachedNodeId: failure.reachedNodeId } : {}),
    visitedNodes: failure.visitedNodes,
    ...extra
  });
}

type Prepared = { ok: true; input: RoutePlanInput } | { ok: false; result: ApiResult<never> };

function prepare(baseData: MockBaseData, payload: Record<string, unknown>): Prepared {
  const parsed = validateRouteInput(payload);
  if (!parsed.ok) {
    return { ok: false, result: fail('VALIDATION.FAILED', { fields: parsed.fields }) };
  }
  const input = parsed.value;
  // 节点存在性先于构图判（与主进程同序）：不存在 → NODE.NOT_FOUND，
  // 存在但被排除 → GRAPH.BLOCKED。合成一个就会给出无法行动的提示
  const known = new Set(baseData.nodes.map((node) => node.id));
  for (const nodeId of [input.fromNodeId, input.toNodeId, ...input.viaNodeIds]) {
    if (!known.has(nodeId)) {
      return { ok: false, result: fail('NODE.NOT_FOUND', { id: nodeId }) };
    }
  }
  return { ok: true, input };
}

function buildGraph(baseData: MockBaseData, vehicleType: RoutePlanInput['vehicleType']) {
  return buildRouteGraph({
    // 三类输入与主进程的中立形状逐字段相同（`MockBaseData` 的元素类型是 `@udm/shared` 的列表 DTO）
    nodes: baseData.nodes,
    edges: baseData.edges,
    restrictions: baseData.restrictions,
    vehicleType,
    at: new Date().toISOString()
  });
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
    warnings: result.warnings.map((warning) => warning.message)
  };
}

/**
 * `POST /api/routes/plan` 与 `POST /api/routes/compare`。
 *
 * 返回 `null` 表示「这不是我负责的路径」，由 `mock.ts` 兜成 `API.ROUTE_NOT_FOUND`
 * （与主进程「没有这条路」同解，而不是伪造成功）。
 */
export function mockRouteWrite(
  baseData: MockBaseData,
  request: MockRouteRequest
): ApiResult<unknown> | null {
  const [, resource, action] = request.segments;
  if (resource !== 'routes') {
    return null;
  }
  if (request.method !== 'POST') {
    return null;
  }
  if (action !== 'plan' && action !== 'compare') {
    return null;
  }
  const prepared = prepare(baseData, request.payload);
  if (!prepared.ok) {
    return prepared.result;
  }
  const { input } = prepared;
  const graph = buildGraph(baseData, input.vehicleType);

  if (action === 'plan') {
    const result = searchRoute(graph, {
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      viaNodeIds: input.viaNodeIds,
      algorithm: input.algorithm,
      vehicleType: input.vehicleType
    });
    return result.ok ? ok({ route: toRoutePlan(input, result) }) : toFailure(result);
  }

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
      return toFailure(result, { algorithm });
    }
    results.push({ algorithm, route: toRoutePlan(input, result), elapsedMs });
  }
  const [first, second] = results as [RouteCompareItem, RouteCompareItem];
  const difference = {
    distanceM: Number(Math.abs(first.route.distanceM - second.route.distanceM).toFixed(3)),
    durationS: Number(Math.abs(first.route.durationS - second.route.durationS).toFixed(3))
  };
  return ok({ results, consistent: difference.distanceM === 0 && difference.durationS === 0, difference });
}

/**
 * `GET /api/routes/{id}`。
 *
 * 只认「一段 id」：`/api/routes/plan`（GET）会走到这里并报 `ROUTE.NOT_FOUND` ——
 * 与主进程一致（那边 `plan` 也不是一个路线 id）。
 */
export function mockRouteRead(routeStore: MockRouteStore, path: string): ApiResult<unknown> | null {
  const prefix = '/api/routes/';
  if (!path.startsWith(prefix)) {
    return null;
  }
  const id = path.slice(prefix.length);
  if (id.length === 0 || id.includes('/')) {
    return null;
  }
  const route = routeStore.rows.find((row) => row.id === id);
  return route ? ok(route) : fail('ROUTE.NOT_FOUND', { id });
}
