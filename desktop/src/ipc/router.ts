import { randomUUID } from 'node:crypto';
import { DomainError, fromError, hasPermission, ok, type ApiResult, type Permission, type Role } from '@udm/shared';
import type { Db } from '../db/index.js';
import type { SessionRecord, SessionStore } from '../services/session.js';

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
}

export interface RouteRequest {
  path: string;
  payload?: Record<string, unknown>;
  token?: string | null;
}

export interface Route {
  path: string;
  public?: boolean;
  permission?: Permission;
  handler: (payload: Record<string, unknown>, ctx: RouteContext) => unknown | Promise<unknown>;
}

export interface Router {
  invoke(request: RouteRequest): Promise<ApiResult<unknown>>;
  paths(): string[];
}

export interface RouterOptions {
  db: Db;
  sessions: SessionStore;
  onError?: (info: { path: string; traceId: string; error: unknown }) => void;
}

export function createRouter(routes: Route[], options: RouterOptions): Router {
  const table = new Map<string, Route>();
  for (const route of routes) {
    if (table.has(route.path)) {
      throw new Error(`重复注册接口: ${route.path}`);
    }
    table.set(route.path, route);
  }

  async function invoke(request: RouteRequest): Promise<ApiResult<unknown>> {
    const traceId = randomUUID();
    const route = table.get(request.path);
    if (!route) {
      return fromError(new DomainError('API.ROUTE_NOT_FOUND', undefined, { path: request.path }), traceId);
    }
    const ctx: RouteContext = {
      db: options.db,
      sessions: options.sessions,
      token: request.token ?? null,
      session: null,
      actor: null,
      traceId
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
