import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { ExecutionRunner } from '../domain/execution/executor.js';
import { EventBus } from '../services/event-bus.js';
import { SessionStore } from '../services/session.js';
import { createApiRoutes } from './api.js';
import { createRouter, type Router } from './router.js';

/**
 * 认证接口的**方法与路径**必须与契约逐字一致（`docs/api.md` §3.1）。
 *
 * 为什么值得单独一组：`Route.method` 是**可省字段**，省略时 Router 一律按 `GET` 注册
 * （那是为了兼容早期只有读接口的调用点，见 `router.ts` 文件头）。契约里
 * `POST /api/auth/login` 与 `POST /api/auth/logout` 都是 POST，而实现一度**没写** `method`
 * —— 于是：
 *
 *   - 渲染层的适配器不传方法时按 GET 发（`client.ts` 的默认值），**整条链路都是 GET**，
 *     Electron 里登录正常、界面正常、所有用例都绿；
 *   - 只有**照着契约写的调用方**（HTTP 形态的客户端、第三方、E2E 脚本）会拿到
 *     `API.ROUTE_NOT_FOUND`。
 *
 * 这正是 `ISS-002` / `ISS-055` 的同一族：两端各自「自洽」，差别只在有没有第三方照文档调用。
 * 该缺陷是 2026-09-26 走查我自己的 E2E 脚本时发现的（脚本照文档写了 POST）——`ISS-066`。
 *
 * 断言分两层：`paths()` 里有 `POST <path>`（注册表层面），以及真的发一次请求
 * （路由层面，能挡住「注册了但 public/权限写错」这类改动）。
 */
function setup(): { db: Db; router: Router } {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  const sessions = new SessionStore();
  const bus = new EventBus(db, sessions);
  // 执行器按依赖注入传入（M7）：这些用例不点执行接口，但构造签名必须与主进程一致
  const executor = new ExecutionRunner(db, bus);
  const router = createRouter(createApiRoutes({ db, sessions, bus, executor }), { db, sessions });
  return { db, router };
}

describe('ipc · 认证接口的方法与契约一致', () => {
  let db: Db;
  let router: Router;

  beforeEach(() => {
    ({ db, router } = setup());
  });

  it('注册表里登录与退出都是 POST（不是缺省的 GET）', () => {
    const paths = router.paths();
    expect(paths).toContain('POST /api/auth/login');
    expect(paths).toContain('POST /api/auth/logout');
    // 反向断言：GET 形态不得同时存在 —— 两种方法都能命中会让「文档怎么写都能用」，
    // 从而把「契约与实现不一致」永久掩盖（同 D-33「同一概念只允许一个 code」的纪律）
    expect(paths).not.toContain('GET /api/auth/login');
    expect(paths).not.toContain('GET /api/auth/logout');
  });

  it('POST /api/auth/login 成功，返回 token 与按角色派生的权限点', async () => {
    const result = await router.invoke({
      path: '/api/auth/login',
      method: 'POST',
      payload: { username: 'admin', password: 'admin123' }
    });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      const data = result.data as { token: string; user: { role: string; permissions: string[] } };
      expect(data.token).toBeTruthy();
      expect(data.user.role).toBe('admin');
      expect(data.user.permissions.length).toBeGreaterThan(0);
    }
  });

  it('GET /api/auth/login 返回 ROUTE_NOT_FOUND（照着契约写才调得到）', async () => {
    const result = await router.invoke({
      path: '/api/auth/login',
      payload: { username: 'admin', password: 'admin123' }
    });
    expect(result).toMatchObject({ code: 'API.ROUTE_NOT_FOUND' });
  });

  it('POST /api/auth/logout 作废会话：之后同一 token 的请求变成 AUTH.REQUIRED', async () => {
    const loggedIn = await router.invoke({
      path: '/api/auth/login',
      method: 'POST',
      payload: { username: 'monitor', password: 'monitor123' }
    });
    expect(loggedIn.code).toBe(0);
    const token = (loggedIn as { data: { token: string } }).data.token;

    const before = await router.invoke({ path: '/api/auth/session', token });
    expect(before.code).toBe(0);

    const logout = await router.invoke({ path: '/api/auth/logout', method: 'POST', token });
    expect(logout.code).toBe(0);

    const after = await router.invoke({ path: '/api/auth/session', token });
    expect(after).toMatchObject({ code: 'AUTH.REQUIRED' });
  });

  it('登录失败与账号锁定仍然按目录返回（方法与路径改对了，错误码不能被顺手改掉）', async () => {
    const wrongPassword = await router.invoke({
      path: '/api/auth/login',
      method: 'POST',
      payload: { username: 'admin', password: 'wrong' }
    });
    expect(wrongPassword).toMatchObject({ code: 'AUTH.LOGIN_FAILED' });
    const ghost = await router.invoke({
      path: '/api/auth/login',
      method: 'POST',
      payload: { username: 'nobody', password: 'whatever' }
    });
    expect(ghost).toMatchObject({ code: 'AUTH.LOGIN_FAILED' });
  });
});
