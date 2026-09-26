/**
 * MockAdapter：浏览器独立开发 / 演示形态（内存数据，无主进程）。
 *
 * 契约与 IpcAdapter / HttpAdapter 完全一致（`design.md` §2.2）。
 * 仅实现渲染层当前真正会调用的接口；未实现的路径返回 `API.ROUTE_NOT_FOUND`，
 * **不要伪造成功**，否则浏览器里「看起来能用」而进 Electron 就失败。
 */
import {
  ERROR_CODES,
  permissionsOf,
  type ApiResult,
  type DomainEvent,
  type ErrorCode,
  type Role,
  type SessionUser
} from '@udm/shared';
import type { ApiClient, Unsubscribe } from './client';
import type { MapOverview } from './types';
import { buildMockOverview } from './mock-data';

/**
 * 演示账号（与 `shared/src/constants.ts` 的 `SEED_ACCOUNTS` 同名同密码）。
 *
 * **`permissions` 必须按角色派生**（`permissionsOf(role)`），不能手写。
 * 实测（2026-09-25）：这里曾把三个账号的 `permissions` 一律写成 `[]`，
 * 而主进程 `services/auth.ts` 用的是 `permissionsOf(row.role)` —— 于是同一份"契约"
 * 在浏览器形态下每个账号都是 0 个权限点、在 Electron 下是各自角色的完整权限。
 * 界面只读角色判断导航时看不出问题（`hasPermission(role, …)` 仍按角色算），
 * 但任何**信任 `user.permissions`** 的地方（如顶栏用户菜单显示的权限点数）会静默显示错值。
 * 这与 mock 曾自造错误码（ISS-001 附带发现）是同一类问题：适配器之间行为不一致。
 */
function demoUser(id: string, username: string, role: Role, displayName: string): SessionUser {
  return { id, username, role, displayName, permissions: permissionsOf(role) };
}

const SEED_ACCOUNTS: Record<string, { password: string; user: SessionUser }> = {
  admin: { password: 'admin123', user: demoUser('seed-admin', 'admin', 'admin', '系统管理员') },
  dispatcher: {
    password: 'dispatcher123',
    user: demoUser('seed-dispatcher', 'dispatcher', 'dispatcher', '调度员')
  },
  monitor: { password: 'monitor123', user: demoUser('seed-monitor', 'monitor', 'monitor', '监控员') }
};

/**
 * 与真实主进程返回**完全相同**的失败信封。
 *
 * 起因：mock 曾自造 `AUTH.INVALID_CREDENTIALS` —— 该 code **不在** `ERROR_CODES` 里。
 * 浏览器里登录失败看着正常（只读 `message`），Electron 下返回的却是
 * `AUTH.LOGIN_FAILED`，前端按 code 做的文案映射会在这里静默失配。
 * 因此 mock 一律从目录取 source 与兜底文案，不再手写。
 */
function fromCatalog(code: ErrorCode, detail?: Record<string, unknown>): ApiResult<never> {
  const definition = ERROR_CODES[code];
  return { code, message: definition.message, source: definition.source, ...(detail ? { detail } : {}) };
}

export function createMockAdapter(): ApiClient {
  const listeners = new Set<{ event: string | null; handler: (m: DomainEvent) => void }>();
  const sessions = new Map<string, SessionUser>();
  let overview = buildMockOverview();
  let timer: ReturnType<typeof setInterval> | null = null;

  function emit(type: string, payload: Record<string, unknown>): void {
    overview = { ...overview, eventSeq: overview.eventSeq + 1 };
    const message: DomainEvent = { type, eventSeq: overview.eventSeq, payload };
    for (const listener of listeners) {
      if (!listener.event || listener.event === type) {
        listener.handler(message);
      }
    }
  }

  // 演示用「车辆缓动」：让地图上的车真的会动，便于目视验证动画与去重逻辑。
  function startDemoMotion(): void {
    if (timer) {
      return;
    }
    timer = setInterval(() => {
      const current = overview.vehicles[0];
      if (!current) {
        return;
      }
      const step = 4;
      const nextX = current.x + step > 60 ? 0 : current.x + step;
      overview = {
        ...overview,
        vehicles: overview.vehicles.map((v, i) => (i === 0 ? { ...v, x: nextX, status: 'busy' as const } : v))
      };
      emit('vehicle.changed', { vehicleId: current.id, x: nextX, y: current.y });
    }, 1000);
  }

  return {
    async invoke<T>(path: string, payload: Record<string, unknown> = {}, token?: string | null): Promise<ApiResult<T>> {
      switch (path) {
        case '/api/health':
          return { code: 0, message: 'success', data: { status: 'ok', db: false, version: 'mock', now: new Date().toISOString() } as T };
        case '/api/auth/login': {
          const username = String(payload.username ?? '');
          const password = String(payload.password ?? '');
          const account = SEED_ACCOUNTS[username];
          if (!account || account.password !== password) {
            return fromCatalog('AUTH.LOGIN_FAILED') as ApiResult<T>;
          }
          const sessionToken = `mock-${username}-${Date.now()}`;
          sessions.set(sessionToken, account.user);
          startDemoMotion();
          return { code: 0, message: 'success', data: { token: sessionToken, user: account.user } as T };
        }
        case '/api/auth/logout':
          if (token) {
            sessions.delete(token);
          }
          return { code: 0, message: 'success', data: { ok: true } as T };
        case '/api/auth/session':
          return { code: 0, message: 'success', data: { user: (token && sessions.get(token)) ?? null } as T };
        case '/api/settings':
          return { code: 0, message: 'success', data: { 'monitor.refreshIntervalMs': 1000 } as T };
        case '/api/map/overview':
          return { code: 0, message: 'success', data: overview as T };
        default:
          return fromCatalog('API.ROUTE_NOT_FOUND', { path }) as ApiResult<T>;
      }
    },
    on<T>(event: string | null, handler: (message: DomainEvent<T>) => void): Unsubscribe {
      const entry = { event, handler: handler as (m: DomainEvent) => void };
      listeners.add(entry);
      return () => listeners.delete(entry);
    }
  };
}
