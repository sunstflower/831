import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { login } from '../services/auth.js';
import { ExecutionRunner } from '../domain/execution/executor.js';
import { EventBus } from '../services/event-bus.js';
import { SessionStore } from '../services/session.js';
import { createApiRoutes } from './api.js';
import { createRouter, type Router } from './router.js';

/**
 * M2 **写接口**的传输层行为。
 *
 * 这里要证明的是「请求怎么进来、错误怎么出去」这几件事：
 *   1. 方法 + 路径参数真的把请求送到了对的领域方法（`PUT /api/sites/:id`）；
 *   2. 权限**服务端**强制（`base:write` 只有 admin 有，见 `design.md` §3.7）；
 *   3. 领域错误原样透出为**统一信封**（前端按 code 分支，不能变成 500）；
 *   4. 审计里的 `traceId` 与响应信封里的**是同一个**（否则按它查日志只查得到一半）；
 *   5. 事件在事务提交**之后**才发（发事件时数据已经能查到）。
 */
function setup() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  const sessions = new SessionStore();
  const bus = new EventBus(db, sessions);
  // 执行器按依赖注入传入（M7）：这些用例不点执行接口，但构造签名必须与主进程一致
  const executor = new ExecutionRunner(db, bus);
  const router: Router = createRouter(createApiRoutes({ db, sessions, bus, executor }), { db, sessions });
  const admin = login(db, sessions, { username: 'admin', password: 'admin123' }, 't-admin');
  const dispatcher = login(db, sessions, { username: 'dispatcher', password: 'dispatcher123' }, 't-disp');
  const monitor = login(db, sessions, { username: 'monitor', password: 'monitor123' }, 't-mon');
  return { db, router, bus, admin, dispatcher, monitor };
}

describe('ipc · M2 写接口', () => {
  let db: Db;
  let router: Router;
  let admin: { token: string };
  let dispatcher: { token: string };
  let monitor: { token: string };

  beforeEach(() => {
    ({ db, router, admin, dispatcher, monitor } = setup());
  });

  it('POST /api/sites 创建并回读（admin）', async () => {
    const result = await router.invoke({
      path: '/api/sites',
      method: 'POST',
      token: admin.token,
      payload: { code: 'S-901', name: '九零一仓', type: 'depot', x: 3, y: 4 }
    });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      expect(result.data).toMatchObject({ code: 'S-901', type: 'depot', status: 'enabled', x: 3, y: 4 });
    }
    // 回读确认真的落库了（不是只在返回值里）
    const list = await router.invoke({ path: '/api/sites', token: admin.token, payload: { keyword: 'S-901' } });
    expect(list.code === 0 && (list.data as { total: number }).total).toBe(1);
  });

  it('写接口的权限是 base:write：dispatcher 与 monitor 一律 AUTH.FORBIDDEN', async () => {
    for (const token of [dispatcher.token, monitor.token]) {
      const result = await router.invoke({
        path: '/api/sites',
        method: 'POST',
        token,
        payload: { code: 'S-902', name: 'S', type: 'depot' }
      });
      expect(result).toMatchObject({ code: 'AUTH.FORBIDDEN' });
    }
  });

  it('未登录写请求返回 AUTH.REQUIRED（先鉴权再判权限）', async () => {
    const result = await router.invoke({ path: '/api/sites', method: 'POST', payload: { code: 'X', name: 'X', type: 'depot' } });
    expect(result).toMatchObject({ code: 'AUTH.REQUIRED' });
  });

  it('路径参数送到对的记录：PUT /api/sites/:id 只改目标那一条', async () => {
    const created = await router.invoke({
      path: '/api/sites',
      method: 'POST',
      token: admin.token,
      payload: { code: 'S-903', name: '旧名', type: 'depot' }
    });
    const id = (created as { data: { id: string } }).data.id;
    const updated = await router.invoke({
      path: `/api/sites/${id}`,
      method: 'PUT',
      token: admin.token,
      payload: { name: '新名' }
    });
    expect(updated.code === 0 && (updated.data as { name: string }).name).toBe('新名');
    // 同一时刻列表里没有第二个人被改名
    const list = await router.invoke({ path: '/api/sites', token: admin.token });
    const names = (list as { data: { records: Array<{ name: string }> } }).data.records.map((row) => row.name);
    expect(names.filter((name) => name === '新名')).toHaveLength(1);
  });

  it('领域校验错误透出为 VALIDATION.FAILED + detail.fields（不是 SYS.INTERNAL）', async () => {
    const result = await router.invoke({
      path: '/api/sites',
      method: 'POST',
      token: admin.token,
      payload: { code: '', name: 'S', type: 'depot', x: Number.NaN }
    });
    expect(result).toMatchObject({ code: 'VALIDATION.FAILED', source: 'validation' });
    expect(Object.keys(((result as { detail: { fields: object } }).detail.fields) as object).sort()).toEqual(['code', 'x']);
  });

  it('业务错误透出为域错误码：编码重复 → BASE.CODE_EXISTS（409 语义）', async () => {
    const payload = { code: 'S-904', name: 'S', type: 'depot' };
    await router.invoke({ path: '/api/sites', method: 'POST', token: admin.token, payload });
    const again = await router.invoke({ path: '/api/sites', method: 'POST', token: admin.token, payload });
    expect(again).toMatchObject({ code: 'BASE.CODE_EXISTS', source: 'business' });
  });

  it('启停：PATCH /api/{资源}/:id/status 三个资源各走各的领域方法', async () => {
    const site = await router.invoke({ path: '/api/sites', method: 'POST', token: admin.token, payload: { code: 'S-905', name: 'S', type: 'depot' } });
    const siteId = (site as { data: { id: string } }).data.id;
    const disabled = await router.invoke({ path: `/api/sites/${siteId}/status`, method: 'PATCH', token: admin.token, payload: { status: 'disabled' } });
    expect(disabled.code === 0 && (disabled.data as { status: string }).status).toBe('disabled');

    const node = await router.invoke({ path: '/api/nodes', method: 'POST', token: admin.token, payload: { code: 'N950', name: 'N', x: 900, y: 900 } });
    const nodeId = (node as { data: { id: string } }).data.id;
    const nodeOff = await router.invoke({ path: `/api/nodes/${nodeId}/status`, method: 'PATCH', token: admin.token, payload: { status: 'disabled' } });
    expect(nodeOff.code === 0 && (nodeOff.data as { status: string }).status).toBe('disabled');

    // 被引用的节点不能禁用（seed 的 N01）
    const referenced = await router.invoke({ path: '/api/nodes', token: admin.token, payload: { keyword: 'N01' } });
    const refId = (referenced as { data: { records: Array<{ id: string }> } }).data.records[0]!.id;
    const blocked = await router.invoke({ path: `/api/nodes/${refId}/status`, method: 'PATCH', token: admin.token, payload: { status: 'disabled' } });
    expect(blocked).toMatchObject({ code: 'BASE.NODE_IN_USE' });
  });

  it('启停：status 缺失或取值非法都在传输层就报 VALIDATION.FAILED', async () => {
    const site = await router.invoke({ path: '/api/sites', method: 'POST', token: admin.token, payload: { code: 'S-906', name: 'S', type: 'depot' } });
    const id = (site as { data: { id: string } }).data.id;
    const missing = await router.invoke({ path: `/api/sites/${id}/status`, method: 'PATCH', token: admin.token, payload: {} });
    expect(missing).toMatchObject({ code: 'VALIDATION.FAILED' });
    const bogus = await router.invoke({ path: `/api/sites/${id}/status`, method: 'PATCH', token: admin.token, payload: { status: 'paused' } });
    expect(bogus).toMatchObject({ code: 'VALIDATION.FAILED' });
  });

  it('车辆启停：占用中不许停用 → VEHICLE.STATE_CONFLICT；执行器专管的状态 → VALIDATION.FAILED', async () => {
    const list = await router.invoke({ path: '/api/vehicles', token: admin.token, payload: { keyword: 'AGV-01' } });
    const id = (list as { data: { records: Array<{ id: string }> } }).data.records[0]!.id;
    // seed 把 AGV-01 置为 busy（演示执行数据）
    const blocked = await router.invoke({ path: `/api/vehicles/${id}/status`, method: 'PATCH', token: admin.token, payload: { status: 'disabled' } });
    expect(blocked).toMatchObject({ code: 'VEHICLE.STATE_CONFLICT' });
    const notManaged = await router.invoke({ path: `/api/vehicles/${id}/status`, method: 'PATCH', token: admin.token, payload: { status: 'charging' } });
    expect(notManaged).toMatchObject({ code: 'VALIDATION.FAILED' });
  });

  it('方法不匹配时不误命中同路径的其它方法（POST 到只读路径 → ROUTE_NOT_FOUND）', async () => {
    const result = await router.invoke({ path: '/api/sites', method: 'DELETE', token: admin.token });
    expect(result).toMatchObject({ code: 'API.ROUTE_NOT_FOUND' });
  });

  it('不存在的 id 返回各自的 NOT_FOUND，而不是「成功但什么都没改」', async () => {
    const put = await router.invoke({ path: '/api/sites/ghost', method: 'PUT', token: admin.token, payload: { name: 'x' } });
    expect(put).toMatchObject({ code: 'SITE.NOT_FOUND' });
    const patch = await router.invoke({ path: '/api/vehicles/ghost/status', method: 'PATCH', token: admin.token, payload: { status: 'disabled' } });
    expect(patch).toMatchObject({ code: 'VEHICLE.NOT_FOUND' });
    const edge = await router.invoke({ path: '/api/edges/ghost', method: 'PUT', token: admin.token, payload: { lengthM: 5 } });
    expect(edge).toMatchObject({ code: 'EDGE.NOT_FOUND' });
  });

  it('每条写审计都带 traceId，且两次请求的 traceId 不同（可与请求一一对上）', async () => {
    /*
     * 为什么不断言「审计的 traceId == 响应信封的 traceId」：成功信封**没有** traceId 字段
     * （`shared/src/types.ts` 的 `ApiSuccess` 只有 code / message / data，失败信封才有）——
     * 那是一条不存在的契约，断言它只会得到一句「两边都是 undefined」的假通过。
     *
     * 真正要防的是「审计行根本没记 traceId」以及「所有请求共用一个 traceId」：
     * 前者让日志串不起来，后者让 traceId 失去区分能力。
     */
    const write = (code: string) =>
      router.invoke({ path: '/api/nodes', method: 'POST', token: admin.token, payload: { code, name: 'N', x: 910, y: 910 } });
    for (const code of ['N951', 'N952x']) {
      expect((await write(code)).code).toBe(0);
    }
    const rows = db.prepare('SELECT trace_id FROM audit_logs WHERE module = ?').all('base') as Array<{ trace_id: string | null }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.trace_id).toBeTruthy();
    }
    expect(new Set(rows.map((row) => row.trace_id)).size).toBe(2);
  });

  it('事件在事务提交之后发：订阅者收到事件时，新数据已经能查到', async () => {
    const seen: string[] = [];
    const target = {
      // 通道名与消息分列两参：漏掉第一个参数会让断言「什么都没收到」而**看起来像**事件没发
      send: (channel: string, message: unknown) => {
        const event = message as { type: string; payload: Record<string, unknown> };
        if (channel !== 'udm:event' || event.type !== 'map.updated') {
          return;
        }
        const reason = event.payload['reason'];
        if (typeof reason === 'string') {
          seen.push(reason);
        }
      }
    };
    const sessions = new SessionStore();
    const db2 = openDatabase(':memory:');
    applyMigrations(db2);
    seedDatabase(db2);
    const bus2 = new EventBus(db2, sessions);
    const router2 = createRouter(createApiRoutes({ db: db2, sessions, bus: bus2 }), { db: db2, sessions });
    const localAdmin = login(db2, sessions, { username: 'admin', password: 'admin123' }, 't');
    bus2.attach(target, localAdmin.token);

    const result = await router2.invoke({
      path: '/api/sites',
      method: 'POST',
      token: localAdmin.token,
      payload: { code: 'S-907', name: 'S', type: 'depot' }
    });
    expect(result.code).toBe(0);
    expect(seen).toContain('site.created');
    // 事件已经发过了，此刻库里必然查得到 —— 若事件先于提交发出，这里会查不到
    const row = db2.prepare('SELECT COUNT(*) AS total FROM sites WHERE code = ?').get('S-907') as { total: number };
    expect(row.total).toBe(1);
  });

  it('GET /api/restrictions 需要 base:read：monitor 能读、未登录被拒', async () => {
    const asMonitor = await router.invoke({ path: '/api/restrictions', token: monitor.token });
    expect(asMonitor.code).toBe(0);
    const anonymous = await router.invoke({ path: '/api/restrictions' });
    expect(anonymous).toMatchObject({ code: 'AUTH.REQUIRED' });
  });

  it('禁行规则：POST 建规则 → 列表带 targetCode → PUT 改状态 → DELETE 物理删除', async () => {
    const created = await router.invoke({
      path: '/api/restrictions',
      method: 'POST',
      token: admin.token,
      payload: { type: 'edge', targetId: 'seed-e-N01-N05', reason: '道路施工' }
    });
    expect(created.code).toBe(0);
    const id = (created as { data: { id: string } }).data.id;
    // 目标编码是派生字段：列表与详情都要有（否则界面上这一列永远是空的）
    const list = await router.invoke({ path: '/api/restrictions', token: admin.token, payload: { type: 'edge' } });
    expect(list.code === 0 && (list.data as { total: number }).total).toBe(1);
    expect((list as { data: { records: Array<{ targetCode: string }> } }).data.records[0]!.targetCode).toBe('E_N01_N05');

    const expired = await router.invoke({ path: `/api/restrictions/${id}`, method: 'PUT', token: admin.token, payload: { status: 'expired' } });
    expect(expired.code === 0 && (expired.data as { status: string }).status).toBe('expired');

    const deleted = await router.invoke({ path: `/api/restrictions/${id}`, method: 'DELETE', token: admin.token });
    expect(deleted).toMatchObject({ code: 0, data: { deleted: true } });
    // 物理删除：列表里真的没有它（不是打标记），且审计里留了 delete
    const after = await router.invoke({ path: '/api/restrictions', token: admin.token });
    expect(after.code === 0 && (after.data as { total: number }).total).toBe(0);
    const deleteAudit = db.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'delete' AND object_type = 'restriction'").get() as { total: number };
    expect(deleteAudit.total).toBe(1);
  });

  it('禁行规则：dispatcher 与 monitor 写一律 AUTH.FORBIDDEN（含 delete）', async () => {
    for (const token of [dispatcher.token, monitor.token]) {
      const create = await router.invoke({
        path: '/api/restrictions',
        method: 'POST',
        token,
        payload: { type: 'node', targetId: 'seed-n01', reason: 'x' }
      });
      expect(create).toMatchObject({ code: 'AUTH.FORBIDDEN' });
      const remove = await router.invoke({ path: '/api/restrictions/anything', method: 'DELETE', token });
      expect(remove).toMatchObject({ code: 'AUTH.FORBIDDEN' });
    }
  });

  it('DELETE 落在对的记录上：只删目标那一条，其它规则不受影响', async () => {
    const first = await router.invoke({ path: '/api/restrictions', method: 'POST', token: admin.token, payload: { type: 'node', targetId: 'seed-n01', reason: 'A' } });
    const second = await router.invoke({ path: '/api/restrictions', method: 'POST', token: admin.token, payload: { type: 'node', targetId: 'seed-n02', reason: 'B' } });
    const firstId = (first as { data: { id: string } }).data.id;
    await router.invoke({ path: `/api/restrictions/${firstId}`, method: 'DELETE', token: admin.token });
    const list = await router.invoke({ path: '/api/restrictions', token: admin.token });
    const rules = (list as { data: { records: Array<{ id: string; reason: string }> } }).data.records;
    expect(rules.map((rule) => rule.reason)).toEqual(['B']);
    expect(rules[0]!.id).toBe((second as { data: { id: string } }).data.id);
  });

  it('任务模板：POST → GET（keyword 命中）→ PUT；没有 DELETE 路由（契约里就没有）', async () => {
    const created = await router.invoke({
      path: '/api/task-templates',
      method: 'POST',
      token: admin.token,
      payload: { code: 'TPL-901', name: '九零一模板', priority: 'high', defaultCargoKg: 25, timeWindowMinutes: 45, fromSiteType: 'depot', toSiteType: 'gate' }
    });
    expect(created.code).toBe(0);
    const id = (created as { data: { id: string } }).data.id;
    const list = await router.invoke({ path: '/api/task-templates', token: admin.token, payload: { keyword: 'TPL-901' } });
    expect(list.code === 0 && (list.data as { total: number }).total).toBe(1);

    const updated = await router.invoke({ path: `/api/task-templates/${id}`, method: 'PUT', token: admin.token, payload: { remark: '改过' } });
    expect(updated.code === 0 && (updated.data as { remark: string }).remark).toBe('改过');

    // 契约（`docs/api.md` §3.2.6）只定义了 GET/POST/PUT 三条：
    // DELETE 必须落到 ROUTE_NOT_FOUND，而不是「删了但文档里没有」
    const remove = await router.invoke({ path: `/api/task-templates/${id}`, method: 'DELETE', token: admin.token });
    expect(remove).toMatchObject({ code: 'API.ROUTE_NOT_FOUND' });
  });

  it('边：创建后能按推导出的 code 查到（写路径与读路径用的是同一套命名）', async () => {
    const a = await router.invoke({ path: '/api/nodes', method: 'POST', token: admin.token, payload: { code: 'N952', name: 'A', x: 0, y: 0 } });
    const b = await router.invoke({ path: '/api/nodes', method: 'POST', token: admin.token, payload: { code: 'N953', name: 'B', x: 30, y: 40 } });
    const aId = (a as { data: { id: string } }).data.id;
    const bId = (b as { data: { id: string } }).data.id;
    const created = await router.invoke({ path: '/api/edges', method: 'POST', token: admin.token, payload: { fromNodeId: aId, toNodeId: bId } });
    expect(created.code === 0 && (created.data as { lengthM: number }).lengthM).toBeCloseTo(50, 6);
    expect(created.code === 0 && (created.data as { code: string }).code).toBe('E_N952_N953');

    const found = await router.invoke({ path: '/api/edges', token: admin.token, payload: { code: 'E_N952_N953' } });
    expect(found.code === 0 && (found.data as { total: number }).total).toBe(1);
    const reverse = await router.invoke({ path: '/api/edges', token: admin.token, payload: { code: 'E_N952_N953_R' } });
    expect(reverse.code === 0 && (reverse.data as { total: number }).total).toBe(0);
  });
});
