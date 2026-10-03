/**
 * MockAdapter：浏览器独立开发 / 演示形态（内存数据，无主进程）。
 *
 * 契约与 IpcAdapter / HttpAdapter 完全一致（`design.md` §2.2）。
 * 仅实现渲染层当前真正会调用的接口；未实现的路径返回 `API.ROUTE_NOT_FOUND`，
 * **不要伪造成功**，否则浏览器里「看起来能用」而进 Electron 就失败。
 */
import {
  DEFAULT_PAGE_SIZE,
  EDGE_STATUSES,
  ERROR_CODES,
  MAX_PAGE_SIZE,
  RESTRICTION_STATUSES,
  RESTRICTION_TYPES,
  SITE_TYPES,
  VEHICLE_STATUSES,
  VEHICLE_TYPES,
  permissionsOf,
  type ApiResult,
  type DomainEvent,
  type ErrorCode,
  type Role,
  type SessionUser
} from '@udm/shared';
import type { ApiClient, InvokeOptions, Unsubscribe } from './client';
import type { MapOverview } from './types';
import { buildMockBaseData, buildMockOverview, buildMockRouteStore, buildMockTaskStore } from './mock-data';
import { mockRouteRead, mockRouteWrite } from './mock-route';
import { mockBaseWrite } from './mock-base-write';
import { mockTaskRead, mockTaskWrite } from './mock-tasks';
import { buildMockDispatchStore, mockDispatchRead, mockDispatchWrite } from './mock-dispatch';
import { buildMockOpsStore, mockOpsRead, mockOpsWrite, tickExecution } from './mock-ops';

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


/**
 * 列表接口在 Mock 侧的**分页与筛选**。
 *
 * 这里的逻辑与主进程的 `ipc/paging.ts` + `db/repositories/*.repo.ts` 是两份实现
 * （浏览器跑不了 SQLite，也无法 import 主进程代码），因此**口径必须逐条对齐**，
 * 并由 `mock-parity.test.ts` 用同一批请求同时打两边来锁死：
 *   - 分页**宽进**：非法值回落默认、超上限夹取（`MAX_PAGE_SIZE` 与主进程共用同一常量）；
 *   - 筛选项**严出**：不在枚举里直接 `VALIDATION.FAILED`（静默忽略会让页面显示全量数据）；
 *   - `keyword` 大小写不敏感 —— 因为 SQLite 的 `LIKE` 对 ASCII 不区分大小写，
 *     而 JS 的 `includes` 区分。这是两份实现最容易静默分叉的一处，故显式写出来。
 */
function mockPaginate<T>(records: T[], payload: Record<string, unknown>): { records: T[]; total: number; page: number; pageSize: number } {
  const rawPage = Number(payload.page ?? 1);
  const rawSize = Number(payload.pageSize ?? DEFAULT_PAGE_SIZE);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const start = (page - 1) * pageSize;
  return { records: records.slice(start, start + pageSize), total: records.length, page, pageSize };
}

function mockKeyword(value: string, keyword: string): boolean {
  return value.toLowerCase().includes(keyword.toLowerCase());
}

/** 与主进程 `optionalEnumFilter` 同解：缺席 / 空串 = 未给筛选；给了非法值 = 报错。 */
function mockEnumFilter<T extends string>(
  payload: Record<string, unknown>,
  field: string,
  allowed: readonly T[]
): T | undefined | ApiResult<never> {
  const value = payload[field];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return fromCatalog('VALIDATION.FAILED', { fields: { [field]: `取值必须是 ${allowed.join(' / ')} 之一` } });
  }
  return value as T;
}

function isFailure(value: unknown): value is ApiResult<never> {
  return typeof value === 'object' && value !== null && 'code' in value && (value as { code: unknown }).code !== 0;
}

export function createMockAdapter(): ApiClient {
  const listeners = new Set<{ event: string | null; handler: (m: DomainEvent) => void }>();
  const sessions = new Map<string, SessionUser>();
  let overview = buildMockOverview();
  // 基础数据的**可变**内存表：写路径（`mock-base-write.ts`）直接改它。
  // 注意它只在一次页面会话内有效 —— 刷新浏览器就回到初始快照（Mock 不持久化，
  // 这正是「它是演示形态」的意思；真实形态的数据在 SQLite 里）
  const baseData = buildMockBaseData();
  // M3 的任务表：与 `baseData` 同样是**一次页面会话内可变**的内存表
  const taskStore = buildMockTaskStore();
  // M5 的路线表：调度 apply 会把新路线推进它（与主进程写 `routes` 表对应）
  const routeStore = buildMockRouteStore();
  // M4 的调度日志 / 存档输出 / 已应用计划：同样只在一次页面会话内有效
  const dispatchStore = buildMockDispatchStore();
  /*
   * M1/M7/M8/M9/M10 的内存存储（告警、审计、用户、设置、轨迹、执行态）。
   *
   * 与其它 Mock 存储一样**只在一次页面会话内有效**：刷新即回到初始快照，
   * 这正是「它是演示形态」的意思。真实形态的数据在 SQLite 里。
   */
  const opsStore = buildMockOpsStore();
  /** 执行相关接口需要的两侧数据（任务表 + 基础数据），构造一次复用。 */
  const opsDeps = {
    baseData,
    taskStore,
    /*
     * 风险预检要读「已生效的派发计划」，而调度 store 构造在它**之上**（见 `dispatchStore`）。
     * 这里传函数而不是数组：Mock 的计划会随「应用派发 / 重算」实时增长，
     * 传一份快照会让预检永远停在启动那一刻 —— 页面表现为「刚派完的任务不报风险」。
     * 延迟到调用时才解引用，因此没有声明顺序问题。
     */
    plans: () => dispatchStore.plans,
    // 回退取路线用（D-26：演示数据有路线但没有派发计划）
    routeStore
  };
  /*
   * 演示用「执行推进」定时器：**只在该实例里真的有人在跑时**才动。
   *
   * 与主进程同目的（让地图上的车真的会动），但驱动方式不同：
   * 主进程的 `ExecutionRunner.startTimer()` 常驻推进；Mock 只在点过「开始执行」后才推进 ——
   * 若像 `startDemoMotion()` 那样无条件让第一台车漂移，演示里会出现
   * 「什么都没点，车自己走了」这种现象，而它恰恰是最难解释的一类。
   */
  let executionTimer: ReturnType<typeof setInterval> | null = null;
  function ensureExecutionTimer(): void {
    if (executionTimer) {
      return;
    }
    executionTimer = setInterval(() => {
      const result = tickExecution(opsStore, opsDeps);
      for (const taskId of result.advanced) {
        emit('task.changed', { reason: 'execution.progress', taskId });
        emit('execution.progress', { taskId });
      }
      for (const taskId of result.finished) {
        emit('task.changed', { reason: 'execution.finished', taskId });
        emit('map.updated', { reason: 'execution.finished' });
      }
    }, 1000);
  }
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
    async invoke<T>(
      path: string,
      payload: Record<string, unknown> = {},
      token?: string | null,
      options?: InvokeOptions
    ): Promise<ApiResult<T>> {
      const method = options?.method ?? 'GET';

      /*
       * ---- 认证：**先于权限判定**处理 ----
       *
       * 登录是「公开」的写请求（契约 `POST`，`desktop/src/ipc/api.ts` 里是 `public: true`），
       * 它天然没有 token 可校验 —— 若走下面的权限分支，会先得到 `AUTH.REQUIRED`，
       * 也就是「永远登不进去」。退出同理：它要的正是把自己那份会话作废。
       *
       * 这两个分支必须与 `docs/api.md` §3.1 的**方法**一致（POST）。实测（ISS-066）：
       * 主进程此前按 GET 注册登录，而契约写 POST，`POST /api/auth/login` 返回
       * `API.ROUTE_NOT_FOUND` —— 三层适配器之间只要有一处方法不一致，
       * 就会表现为「浏览器能登录、桌面端登不进去」。
       */
      if (method === 'POST' && path === '/api/auth/login') {
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
      if (method === 'POST' && path === '/api/auth/logout') {
        if (token) {
          sessions.delete(token);
        }
        return { code: 0, message: 'success', data: { ok: true } as T };
      }

      if (method !== 'GET') {
        /*
         * ---- M2 写路径 ----
         *
         * 权限在 Mock 侧同样**服务端式**强制：`base:write` 只有 admin 有
         * （`design.md` §3.7）。浏览器里也要拦住，否则「本地能用、进 Electron 被拒」
         * 会让人以为是打包问题。
         */
        const user = token ? sessions.get(token) : undefined;
        if (!user) {
          return fromCatalog('AUTH.REQUIRED') as ApiResult<T>;
        }
        const segments = path.split('/').filter((segment) => segment.length > 0);
        /*
         * 权限按**资源**取，而不是一刀切 `base:write`：
         * 任务归 `task:write`（调度员有、监控员没有），基础数据归 `base:write`。
         * 主进程是每个路由声明自己的权限点（`ipc/api.ts`），Mock 这一层是按前缀分派 ——
         * 两种写法必须给出**同一结果**，否则会出现「浏览器里调度员能建任务、Electron 里被拒」
         * 或者更糟的反向情况。
         */
        /*
         * 调度按**动作**取权限点（与主进程 `ipc/api.ts` 的路由声明一一对应）：
         * 预览要 `dispatch:preview`，应用 / 手动指派 / 重算要 `dispatch:apply`。
         * 一律取 `dispatch:apply` 会让「能预览不能应用」这种真实角色配置在浏览器里被误拒
         * （反之更糟：预览入口放行，使用者以为整条链路都可用）。
         */
        const required =
          segments[1] === 'tasks'
            ? 'task:write'
            : segments[1] === 'routes'
              ? 'route:plan'
              : segments[1] === 'dispatch'
                ? segments[2] === 'preview'
                  ? 'dispatch:preview'
                  : 'dispatch:apply'
                : segments[1] === 'settings'
                  ? 'settings:write'
                  : segments[1] === 'users'
                    ? segments[2] === 'me'
                      // 改自己的密码**不需要** `user:manage`（任何登录用户都该能改自己的密码）；
                      // 主进程那条路由没有声明权限点，正是同一口径
                      ? null
                      : 'user:manage'
                    : segments[1] === 'execution'
                      ? segments[4] === 'takeover'
                        ? 'execution:takeover'
                        : 'execution:start'
                      : segments[1] === 'alerts'
                        ? segments[3] === 'acknowledge'
                          ? 'alert:ack'
                          : segments[3] === 'resolve'
                            ? 'alert:resolve'
                            : 'alert:archive'
                        : 'base:write';
        if (required && !user.permissions.includes(required)) {
          return fromCatalog('AUTH.FORBIDDEN', { username: user.username, required }) as ApiResult<T>;
        }
        const written =
          segments[1] === 'execution' || segments[1] === 'alerts' || segments[1] === 'settings' || segments[1] === 'users'
            ? mockOpsWrite(opsStore, opsDeps, { method, segments, payload }, { id: user.id, name: user.displayName, role: user.role })
            : segments[1] === 'tasks'
            ? mockTaskWrite(taskStore, baseData, { method, segments, payload })
            : segments[1] === 'routes'
              ? mockRouteWrite(baseData, { method, segments, payload })
              : segments[1] === 'dispatch'
                ? mockDispatchWrite(dispatchStore, baseData, taskStore, routeStore, { method, segments, payload }, {
                    id: user.id,
                    name: user.displayName
                  })
                : mockBaseWrite(baseData, { method, segments, payload });
        if (written) {
          // 与主进程同为「事务提交之后再发事件」：Mock 的数据是同步改的，
          // 因此这里紧接着发就已经满足「订阅者能读到新值」。
          // 事件类型也按资源分：任务用 `task.changed`（地图与看板都要重拉），
          // 基础数据用 `map.updated`（改的是路网本身）
          if (written.code === 0) {
            if (segments[1] === 'tasks') {
              emit('task.changed', { reason: `task.${segments[3] ?? method.toLowerCase()}` });
            } else if (segments[1] === 'dispatch') {
              // 与主进程同口径：**只有真正改变了业务数据的动作才发事件**。
              // 预览只写一条日志，发 `map.updated` 会让地图为一个没有变化的世界重拉快照（D-23）
              if (segments[2] !== 'preview') {
                emit('task.changed', { reason: `dispatch.${segments[2] ?? ''}` });
                emit('vehicle.changed', { reason: `dispatch.${segments[2] ?? ''}` });
                emit('map.updated', { reason: `dispatch.${segments[2] ?? ''}` });
              }
            } else if (segments[1] === 'execution') {
              emit('task.changed', { reason: `execution.${segments[4] ?? ''}`, taskId: segments[3] });
              emit('vehicle.changed', { reason: `execution.${segments[4] ?? ''}` });
              emit('map.updated', { reason: `execution.${segments[4] ?? ''}` });
              if (segments[4] === 'start') {
                // 真的有人在跑了才挂推进定时器（与主进程常驻定时器的差别见 `ensureExecutionTimer`）
                ensureExecutionTimer();
              }
            } else if (segments[1] === 'alerts') {
              emit('alert.updated', { alertId: segments[2] ?? '', reason: `alert.${segments[3] ?? ''}` });
            } else if (segments[1] === 'settings') {
              emit('settings.changed', { reason: 'settings.update' });
            } else if (segments[1] === 'routes') {
              // 路径规划是**预览**：没有数据变化，不发任何事件。
              // 与主进程同口径（`ipc/api.ts` 的 M5 段注释）：发 `map.updated` 会让地图
              // 为一个没有变化的世界重拉快照，而 D-23 已证明反复重建 nodes/edges 会让边渲染不稳
            } else {
              emit('map.updated', { reason: `${segments[1]}.${method.toLowerCase()}` });
            }
          }
          return written as ApiResult<T>;
        }
        return fromCatalog('API.ROUTE_NOT_FOUND', { path, method }) as ApiResult<T>;
      }
      /*
       * 任务路径先处理：`/api/tasks/{id}` 是动态段，进不了下面的字面量 switch。
       * 与主进程同口径 —— 这条判断按 `path` 的前缀走，而不是把 id 拼进 switch。
       */
      /*
       * M5 路线：`/api/routes/{id}` 是动态段，同样进不了下面的字面量 switch。
       * 顺序放在 tasks 之后、switch 之前 —— 与主进程的路由注册顺序（tasks 在前、routes 在后）一致。
       */
      if (path === '/api/routes' || path.startsWith('/api/routes/')) {
        const read = mockRouteRead(routeStore, path);
        if (read) {
          return read as ApiResult<T>;
        }
        return fromCatalog('API.ROUTE_NOT_FOUND', { path }) as ApiResult<T>;
      }
      /*
       * M1/M7/M8/M9/M10 的读接口。
       *
       * **为什么整体放在字面量 switch 之前**：这批接口里既有字面量路径
       * （`/api/monitor/overview`、`/api/alerts`、`/api/audit/logs`、`/api/users`）
       * 也有动态段（`/api/alerts/{id}`、`/api/map/tracks/{id}`）。
       * 把其中一半塞进下面的 switch、另一半留在前缀判断里，等于让「这条路径由谁处理」
       * 分散在两处 —— 新增一条时必然有一半忘了接（主进程那边正是因为这件事，
       * 把路由表收在了一个数组里）。这里统一交给 `mockOpsRead`，它按完整路径分派。
       *
       * ⚠️ 新增读接口时**只改这一处 + `mockOpsRead`**，不要"顺手"在下面的 switch 里
       * 再加一条同名分支：那会让同一条路径有两个处理器，而先命中的那个永远不会被察觉。
       */
      if (
        path.startsWith('/api/monitor/') ||
        path.startsWith('/api/alerts') ||
        path.startsWith('/api/audit/') ||
        path.startsWith('/api/map/tracks/') ||
        path === '/api/users'
      ) {
        const read = mockOpsRead(opsStore, opsDeps, path, payload);
        if (read) {
          return read as ApiResult<T>;
        }
        return fromCatalog('API.ROUTE_NOT_FOUND', { path }) as ApiResult<T>;
      }
      if (path.startsWith('/api/alerts/')) {
        const read = mockOpsRead(opsStore, opsDeps, path, payload);
        if (read) {
          return read as ApiResult<T>;
        }
        return fromCatalog('API.ROUTE_NOT_FOUND', { path }) as ApiResult<T>;
      }
      if (path === '/api/tasks' || path.startsWith('/api/tasks/')) {
        const read = mockTaskRead(taskStore, baseData, path, payload);
        if (read) {
          return read as ApiResult<T>;
        }
        return fromCatalog('API.ROUTE_NOT_FOUND', { path }) as ApiResult<T>;
      }
      /*
       * M4 调度：两条读接口都是字面量路径，但**权限面不同**（`dispatch:read` 对两种角色都有），
       * 因此放在 switch 之前单独处理 —— 只为了让它与写路径的 `dispatch` 分支挨在一起，
       * 找「调度相关的一切」时不必在两个地方翻。
       */
      if (path === '/api/dispatch/strategies' || path === '/api/dispatch/logs') {
        const read = mockDispatchRead(dispatchStore, path, payload);
        if (read) {
          return read as ApiResult<T>;
        }
      }
      switch (path) {
        case '/api/health':
          return { code: 0, message: 'success', data: { status: 'ok', db: false, version: 'mock', now: new Date().toISOString() } as T };
        /*
         * `GET /api/auth/login` 与 `GET /api/auth/logout` **故意没有分支**：
         * 契约里它们是 POST，主进程按「方法 + 路径」索引，GET 会落到默认分支返回
         * `API.ROUTE_NOT_FOUND`。这里保持一致 —— Mock 若能接受 GET，
         * 浏览器里就永远看不到「方法漏传」这个真实缺陷（ISS-066 正是这样被漏掉的）。
         */
        case '/api/auth/session':
          return { code: 0, message: 'success', data: { user: (token && sessions.get(token)) ?? null } as T };
        case '/api/settings':
          return { code: 0, message: 'success', data: { 'monitor.refreshIntervalMs': 1000 } as T };
        case '/api/map/overview':
          return { code: 0, message: 'success', data: overview as T };
        /*
         * ---- M2 基础数据（读取） ----
         *
         * 与主进程的四个列表接口逐项对齐（分页 / 筛选 / 排序）。排序也必须同序：
         * 两边顺序不同会让「同一页在浏览器与 Electron 下显示不同的行」，
         * 而这种差异只在翻页时才看得出来。
         */
        case '/api/sites': {
          const type = mockEnumFilter(payload, 'type', SITE_TYPES);
          if (isFailure(type)) return type as ApiResult<T>;
          const status = mockEnumFilter(payload, 'status', EDGE_STATUSES);
          if (isFailure(status)) return status as ApiResult<T>;
          const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim() : '';
          const rows = baseData.sites.filter(
            (site) =>
              (!keyword || mockKeyword(site.code, keyword) || mockKeyword(site.name, keyword)) &&
              (!type || site.type === type) &&
              (!status || site.status === status)
          );
          return { code: 0, message: 'success', data: mockPaginate(rows, payload) as T };
        }
        case '/api/vehicles': {
          const status = mockEnumFilter(payload, 'status', VEHICLE_STATUSES);
          if (isFailure(status)) return status as ApiResult<T>;
          const type = mockEnumFilter(payload, 'type', VEHICLE_TYPES);
          if (isFailure(type)) return type as ApiResult<T>;
          const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim() : '';
          const rows = baseData.vehicles.filter(
            (vehicle) =>
              (!keyword || mockKeyword(vehicle.code, keyword) || mockKeyword(vehicle.name, keyword)) &&
              (!status || vehicle.status === status) &&
              (!type || vehicle.type === type)
          );
          return { code: 0, message: 'success', data: mockPaginate(rows, payload) as T };
        }
        case '/api/nodes': {
          const status = mockEnumFilter(payload, 'status', EDGE_STATUSES);
          if (isFailure(status)) return status as ApiResult<T>;
          const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim() : '';
          const rows = baseData.nodes.filter(
            (node) =>
              (!keyword || mockKeyword(node.code, keyword) || mockKeyword(node.name, keyword)) &&
              (!status || node.status === status)
          );
          return { code: 0, message: 'success', data: mockPaginate(rows, payload) as T };
        }
        case '/api/edges': {
          const status = mockEnumFilter(payload, 'status', EDGE_STATUSES);
          if (isFailure(status)) return status as ApiResult<T>;
          const code = typeof payload.code === 'string' && payload.code.trim() ? payload.code.trim() : undefined;
          const fromNodeId = typeof payload.fromNodeId === 'string' && payload.fromNodeId.trim() ? payload.fromNodeId.trim() : undefined;
          const toNodeId = typeof payload.toNodeId === 'string' && payload.toNodeId.trim() ? payload.toNodeId.trim() : undefined;
          const rows = baseData.edges.filter(
            (edge) =>
              (!code || edge.code === code) &&
              (!fromNodeId || edge.fromNodeId === fromNodeId) &&
              (!toNodeId || edge.toNodeId === toNodeId) &&
              (!status || edge.status === status)
          );
          return { code: 0, message: 'success', data: mockPaginate(rows, payload) as T };
        }
        case '/api/restrictions': {
          // 与主进程同口径：没有 keyword（规则的可读标识是派生出来的目标编码），
          // 只有 type / status 两个筛选
          const type = mockEnumFilter(payload, 'type', RESTRICTION_TYPES);
          if (isFailure(type)) return type as ApiResult<T>;
          const status = mockEnumFilter(payload, 'status', RESTRICTION_STATUSES);
          if (isFailure(status)) return status as ApiResult<T>;
          const rows = baseData.restrictions
            .filter((rule) => (!type || rule.type === type) && (!status || rule.status === status))
            // 与主进程 `restriction.repo.ts` 的 `ORDER BY created_at DESC, id ASC` 同序。
            // 排序不对齐的后果只在翻页时才显形（同一行出现在两页里、另一行一页都没有），
            // 那正是这个文件开头列出的「两份实现必然要逐条对齐」的其中一条
            .sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : b.createdAt.localeCompare(a.createdAt)));
          return { code: 0, message: 'success', data: mockPaginate(rows, payload) as T };
        }
        case '/api/task-templates': {
          const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim() : '';
          const rows = baseData.templates
            .filter((template) => !keyword || mockKeyword(template.code, keyword) || mockKeyword(template.name, keyword))
            // 与主进程 `template.repo.ts` 的 `ORDER BY code ASC` 同序（同上）
            .sort((a, b) => a.code.localeCompare(b.code));
          return { code: 0, message: 'success', data: mockPaginate(rows, payload) as T };
        }
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
