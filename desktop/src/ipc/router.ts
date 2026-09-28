/**
 * IPC 路由分发。
 *
 * ## 为什么需要「方法 + 路径参数」
 *
 * 契约（`docs/api.md` §3.2）用的是 REST 语义：同一个 `/api/sites` 上 `GET` 是列表、
 * `POST` 是创建；`/api/sites/{id}` 上 `PUT` 是更新、`PATCH .../status` 是启停。
 * 早期只有「读列表」一种形态，于是注册表只按 `path` 索引就够了 —— 但**方法不同、
 * 路径相同的接口一旦出现，仅按路径索引就再也表达不出来**（后注册的会覆盖前一个，
 * 而注册表那层 `重复注册接口` 的检查反而会把它拦下）。
 *
 * 因此这里做两件事：
 *   1. `Route.method`（缺省 `GET`）：注册键为 `方法 + 路径`；
 *   2. `Route.path` 支持 `:name` 段：匹配到的值放进 `ctx.params`。
 *
 * ⚠️ 调用方**不传方法时一律按 `GET` 处理**：老调用点（`invoke({ path })`）的行为
 * 因此完全不变 —— 这是有意的兼容，不是巧合。
 *
 * 形状相同的两条模板（如 `:id` 与 `:code`）在**注册时**就报错：
 * 它们运行时无法区分，后注册的会永远匹配不到，而那种「接口在、但永远 404」的问题
 * 极难从报错里看出原因。
 */
import { randomUUID } from 'node:crypto';
import { DomainError, fromError, hasPermission, ok, type ApiResult, type Permission, type Role } from '@udm/shared';
import type { Db } from '../db/index.js';
import type { SessionRecord, SessionStore } from '../services/session.js';

/** 与 `docs/api.md` 的方法列一致；`DELETE` 供后续模块（如禁行规则的物理删除）使用。 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteActor {
  actorId: string;
  actorName: string;
  role: Role;
  traceId: string;
}

export interface RouteContext {
  db: Db;
  sessions: SessionStore;
  token: string | null;
  session: SessionRecord | null;
  actor: RouteActor | null;
  traceId: string;
  /** 路径模板里 `:name` 段解析出的值（如 `{ id: 's-1' }`）；无参数时为 `{}`。 */
  params: Record<string, string>;
}

export interface RouteRequest {
  path: string;
  method?: HttpMethod;
  payload?: Record<string, unknown>;
  token?: string | null;
}

export interface Route {
  path: string;
  method?: HttpMethod;
  public?: boolean;
  permission?: Permission;
  handler: (payload: Record<string, unknown>, ctx: RouteContext) => unknown | Promise<unknown>;
}

export interface Router {
  invoke(request: RouteRequest): Promise<ApiResult<unknown>>;
  /** 已注册的「方法 + 路径模板」清单，形如 `GET /api/sites`；供自检与文档断言使用。 */
  paths(): string[];
}

export interface RouterOptions {
  db: Db;
  sessions: SessionStore;
  onError?: (info: { path: string; traceId: string; error: unknown }) => void;
}

interface CompiledRoute {
  route: Route;
  method: HttpMethod;
  segments: string[];
  /** 把 `:name` 段折叠成 `*`，用于检测「形状相同」的重复注册。 */
  shape: string;
}

export function createRouter(routes: Route[], options: RouterOptions): Router {
  const table = new Map<string, CompiledRoute>();
  const dynamic: CompiledRoute[] = [];

  for (const route of routes) {
    const method = route.method ?? 'GET';
    const key = `${method} ${route.path}`;
    if (table.has(key)) {
      throw new Error(`重复注册接口: ${key}`);
    }
    const segments = route.path.split('/').filter((segment) => segment.length > 0);
    const compiled: CompiledRoute = {
      route,
      method,
      segments,
      shape: `${method} /${segments.map((segment) => (segment.startsWith(':') ? '*' : segment)).join('/')}`
    };
    // 同形状的两条模板永远只能命中先注册的那条 —— 直接拒绝，不留下「永远 404 的接口」
    const clash = [...table.values()].find((other) => other.shape === compiled.shape);
    if (clash) {
      throw new Error(`接口形状重复（参数名不同但无法区分）: ${key} 与 ${clash.method} ${clash.route.path}`);
    }
    table.set(key, compiled);
    if (segments.some((segment) => segment.startsWith(':'))) {
      dynamic.push(compiled);
    }
  }

  /** 路径模板匹配；命中返回参数表，未命中返回 `null`。 */
  function match(compiled: CompiledRoute, parts: string[]): Record<string, string> | null {
    if (compiled.segments.length !== parts.length) {
      return null;
    }
    const params: Record<string, string> = {};
    for (let index = 0; index < compiled.segments.length; index += 1) {
      const segment = compiled.segments[index]!;
      const part = parts[index]!;
      if (segment.startsWith(':')) {
        // 空段不可能出现（`split` 已滤空），但仍显式判一次：`/api/sites/` 与 `/api/sites` 必须同解
        if (part.length === 0) {
          return null;
        }
        params[segment.slice(1)] = decodeURIComponent(part);
        continue;
      }
      if (segment !== part) {
        return null;
      }
    }
    return params;
  }

  /** 解析请求；返回命中的路由与参数表。 */
  function resolve(request: RouteRequest): { compiled: CompiledRoute; params: Record<string, string> } | null {
    const method = request.method ?? 'GET';
    const exact = table.get(`${method} ${request.path}`);
    if (exact) {
      return { compiled: exact, params: {} };
    }
    // 模板路由按注册顺序匹配；形状去重已在注册时保证不会撞车
    const parts = request.path.split('/').filter((segment) => segment.length > 0);
    for (const compiled of dynamic) {
      if (compiled.method !== method) {
        continue;
      }
      const params = match(compiled, parts);
      if (params) {
        return { compiled, params };
      }
    }
    return null;
  }

  async function invoke(request: RouteRequest): Promise<ApiResult<unknown>> {
    const traceId = randomUUID();
    const matched = resolve(request);
    if (!matched) {
      return fromError(
        new DomainError('API.ROUTE_NOT_FOUND', undefined, {
          path: request.path,
          method: request.method ?? 'GET'
        }),
        traceId
      );
    }
    const { route } = matched.compiled;
    const ctx: RouteContext = {
      db: options.db,
      sessions: options.sessions,
      token: request.token ?? null,
      session: null,
      actor: null,
      traceId,
      params: matched.params
    };
    try {
      if (!route.public) {
        const session = options.sessions.get(request.token);
        if (!session) {
          throw new DomainError('AUTH.REQUIRED');
        }
        ctx.session = session;
        ctx.actor = {
          actorId: session.user.id,
          actorName: session.user.username,
          role: session.user.role,
          traceId
        };
        if (route.permission && !hasPermission(session.user.role, route.permission)) {
          throw new DomainError('AUTH.FORBIDDEN', undefined, {
            username: session.user.username,
            required: route.permission
          });
        }
      }
      const data = await route.handler(request.payload ?? {}, ctx);
      return ok(data);
    } catch (error) {
      options.onError?.({ path: request.path, traceId, error });
      return fromError(error, traceId);
    }
  }

  return { invoke, paths: () => [...table.keys()] };
}
