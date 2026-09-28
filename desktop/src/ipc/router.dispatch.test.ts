import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { SessionStore } from '../services/session.js';
import { createRouter, type Route } from './router.js';

/**
 * 路由分发的**传输层**行为：方法区分 + 路径参数。
 *
 * 这些用例不碰数据库、不碰权限，只回答一个问题：
 * 「同一个路径上的不同方法、以及带 `:param` 的路径，能不能被正确区分并送到对应的处理函数」。
 *
 * 为什么单独一个文件：`router.test.ts` 用的是**真实接口表**（`createApiRoutes`），
 * 那里断言的是「权限与鉴权」；本文件用的是**手写的最小路由表**，
 * 断言的是分发机制本身 —— 前者变了（新增接口）不该让这些用例跟着动。
 */
function setup(routes: Route[]) {
  const db = openDatabase(':memory:');
  const sessions = new SessionStore();
  const router = createRouter(routes, { db, sessions });
  return { db, router };
}

function echoRoute(overrides: Partial<Route> & Pick<Route, 'path'>): Route {
  return {
    public: true,
    handler: (_payload, ctx) => ({ path: overrides.path, method: overrides.method ?? 'GET', params: ctx.params }),
    ...overrides
  } as Route;
}

describe('ipc router · 方法与路径参数', () => {
  it('同一路径上的不同方法互不覆盖，各走各的处理函数', async () => {
    const { db, router } = setup([
      echoRoute({ path: '/api/sites', method: 'GET', handler: () => ({ kind: 'list' }) }),
      echoRoute({ path: '/api/sites', method: 'POST', handler: () => ({ kind: 'create' }) })
    ]);
    const list = await router.invoke({ path: '/api/sites', method: 'GET' });
    const create = await router.invoke({ path: '/api/sites', method: 'POST' });
    expect(list.code === 0 && list.data).toEqual({ kind: 'list' });
    expect(create.code === 0 && create.data).toEqual({ kind: 'create' });
    db.close();
  });

  it('调用方不传方法时按 GET 处理（老调用点的行为不变）', async () => {
    const { db, router } = setup([echoRoute({ path: '/api/sites', method: 'GET' })]);
    const result = await router.invoke({ path: '/api/sites' });
    expect(result.code === 0 && (result.data as { method: string }).method).toBe('GET');
    db.close();
  });

  it('方法不匹配时报 API.ROUTE_NOT_FOUND，并回显方法与路径（便于定位）', async () => {
    const { db, router } = setup([echoRoute({ path: '/api/sites', method: 'GET' })]);
    const result = await router.invoke({ path: '/api/sites', method: 'DELETE' });
    expect(result).toMatchObject({ code: 'API.ROUTE_NOT_FOUND' });
    expect((result as { detail?: Record<string, unknown> }).detail).toMatchObject({
      path: '/api/sites',
      method: 'DELETE'
    });
    db.close();
  });

  it('`:name` 段解析进 ctx.params，且模板与静态段可共存', async () => {
    const { db, router } = setup([
      echoRoute({ path: '/api/sites/:id', method: 'PUT' }),
      echoRoute({ path: '/api/sites/:id/status', method: 'PATCH' })
    ]);
    const put = await router.invoke({ path: '/api/sites/seed-site-a', method: 'PUT' });
    const patch = await router.invoke({ path: '/api/sites/seed-site-a/status', method: 'PATCH' });
    expect(put.code === 0 && (put.data as { params: unknown }).params).toEqual({ id: 'seed-site-a' });
    expect(patch.code === 0 && (patch.data as { params: unknown }).params).toEqual({ id: 'seed-site-a' });
    db.close();
  });

  it('静态段必须逐字相等，段数不同也不匹配', async () => {
    const { db, router } = setup([echoRoute({ path: '/api/sites/:id', method: 'PUT' })]);
    expect((await router.invoke({ path: '/api/vehicles/x', method: 'PUT' })).code).toBe('API.ROUTE_NOT_FOUND');
    expect((await router.invoke({ path: '/api/sites/x/y', method: 'PUT' })).code).toBe('API.ROUTE_NOT_FOUND');
    expect((await router.invoke({ path: '/api/sites', method: 'PUT' })).code).toBe('API.ROUTE_NOT_FOUND');
    db.close();
  });

  it('参数值经过 decodeURIComponent（中文编码名可作 id）', async () => {
    const { db, router } = setup([echoRoute({ path: '/api/sites/:id', method: 'GET' })]);
    const result = await router.invoke({ path: '/api/sites/%E4%BB%93%E5%BA%93-1', method: 'GET' });
    expect(result.code === 0 && (result.data as { params: { id: string } }).params).toEqual({ id: '仓库-1' });
    db.close();
  });

  it('形状相同的两条模板在注册时就报错（避免出现「永远 404 的接口」）', () => {
    const db = openDatabase(':memory:');
    const sessions = new SessionStore();
    expect(() =>
      createRouter([echoRoute({ path: '/api/sites/:id' }), echoRoute({ path: '/api/sites/:code' })], { db, sessions })
    ).toThrow(/形状重复/);
    db.close();
  });

  it('同一方法 + 同一路径重复注册仍然报错', () => {
    const db = openDatabase(':memory:');
    const sessions = new SessionStore();
    expect(() => createRouter([echoRoute({ path: '/api/x' }), echoRoute({ path: '/api/x' })], { db, sessions })).toThrow(
      /重复注册接口/
    );
    db.close();
  });

  it('paths() 回显「方法 + 路径」（供自检与文档断言使用）', () => {
    const { db, router } = setup([
      echoRoute({ path: '/api/sites', method: 'GET' }),
      echoRoute({ path: '/api/sites', method: 'POST' }),
      echoRoute({ path: '/api/sites/:id', method: 'PUT' })
    ]);
    expect(router.paths().sort()).toEqual(['GET /api/sites', 'POST /api/sites', 'PUT /api/sites/:id']);
    db.close();
  });

  it('上下文骨架完整（handler 能拿到 db / params / traceId）', async () => {
    const { db, router } = setup([
      {
        path: '/api/probe',
        public: true,
        handler: (_payload, ctx) => ({
          hasDb: Boolean(ctx.db),
          // traceId 由 Router 生成（uuid v4，36 字符）；handler 拿得到它才能写进日志与审计
          traceIdLength: ctx.traceId.length,
          params: ctx.params
        })
      }
    ]);
    const result = await router.invoke({ path: '/api/probe' });
    expect(result.code === 0 && (result.data as { hasDb: boolean }).hasDb).toBe(true);
    if (result.code === 0) {
      expect((result.data as { traceIdLength: number }).traceIdLength).toBe(36);
    }
    db.close();
  });
});
