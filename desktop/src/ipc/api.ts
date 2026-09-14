import { APP_VERSION, DEFAULT_PAGE_SIZE, DomainError, MAX_PAGE_SIZE, SETTINGS_SCHEMA, type UserListItem } from '@udm/shared';
import { get, nowIso, type Db } from '../db/index.js';
import { listUsers } from '../db/repositories/users.repo.js';
import { getSettings } from '../db/repositories/settings.repo.js';
import { login } from '../services/auth.js';
import { writeAudit } from '../services/audit.js';
import type { EventBus } from '../services/event-bus.js';
import type { SessionStore } from '../services/session.js';
import type { Route, RouteContext } from './router.js';

function parsePagination(payload: Record<string, unknown>): { page: number; pageSize: number; keyword?: string } {
  const rawPage = Number(payload.page ?? 1);
  const rawSize = Number(payload.pageSize ?? DEFAULT_PAGE_SIZE);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const keyword = typeof payload.keyword === 'string' && payload.keyword.trim() ? payload.keyword.trim() : undefined;
  return { page, pageSize, keyword };
}

function requireString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainError('VALIDATION.FAILED', undefined, { fields: { [field]: '必填且需为非空字符串' } });
  }
  return value;
}

function parseSettings(raw: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    try {
      result[key] = JSON.parse(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}

export interface ApiDependencies {
  db: Db;
  sessions: SessionStore;
  bus: EventBus;
}

export function createApiRoutes(deps: ApiDependencies): Route[] {
  const { db, sessions, bus } = deps;

  return [
    {
      path: '/api/health',
      public: true,
      handler: () => ({
        status: 'ok',
        db: Boolean(get(db, 'SELECT 1 AS ok')),
        version: APP_VERSION,
        now: nowIso()
      })
    },
    {
      path: '/api/auth/login',
      public: true,
      handler: (payload, ctx) => {
        const username = requireString(payload, 'username');
        const password = requireString(payload, 'password');
        const result = login(db, sessions, { username, password }, ctx.traceId);
        bus.emit('map.updated', { reason: 'login' });
        return result;
      }
    },
    {
      path: '/api/auth/logout',
      handler: (_payload, ctx) => {
        sessions.destroy(ctx.token);
        writeAudit(db, ctx.actor, { module: 'auth', action: 'logout', objectType: 'user', objectId: ctx.actor?.actorId });
        return { ok: true };
      }
    },
    {
      path: '/api/auth/session',
      handler: (_payload, ctx) => ({ user: ctx.session?.user ?? null })
    },
    {
      path: '/api/settings',
      permission: 'settings:read',
      handler: () => parseSettings(getSettings(db))
    },
    {
      path: '/api/settings/schema',
      permission: 'settings:read',
      handler: () => SETTINGS_SCHEMA
    },
    {
      path: '/api/users',
      permission: 'user:manage',
      handler: (payload: Record<string, unknown>, ctx: RouteContext) => {
        const { page, pageSize, keyword } = parsePagination(payload);
        const { records, total } = listUsers(db, { page, pageSize, keyword });
        const items: UserListItem[] = records.map((row) => ({
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          role: row.role,
          status: row.status,
          lastLoginAt: row.last_login_at,
          createdAt: row.created_at
        }));
        void ctx;
        return { records: items, total, page, pageSize };
      }
    }
  ];
}
