import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ROLE_PERMISSIONS } from '@udm/shared';
import { SEED_IDS, campusEdgeId, campusNodeId } from '@udm/shared';
import { openDatabase } from '../../../desktop/src/db/index';
import { applyMigrations } from '../../../desktop/src/db/migrate';
import { seedDatabase } from '../../../desktop/src/db/seed';
import { login } from '../../../desktop/src/services/auth';
import { EventBus } from '../../../desktop/src/services/event-bus';
import { SessionStore } from '../../../desktop/src/services/session';
import { ExecutionRunner } from '../../../desktop/src/domain/execution/executor';
import { createApiRoutes } from '../../../desktop/src/ipc/api';
import { createRouter } from '../../../desktop/src/ipc/router';
import { createMockAdapter } from './mock';
import { differenceLinesOf, outcomeRowOf, recommendationOf } from '../dispatch/model';
import type { ApiResult, PlanRiskReport, StrategyResult } from '@udm/shared';

/**
 * Mock 适配器与真实主进程的**错误码一致性**。
 *
 * 起因（ISS-001 附带发现）：mock 曾返回自造的 `AUTH.INVALID_CREDENTIALS`，
 * 而主进程返回 `AUTH.LOGIN_FAILED`。浏览器里看不出问题（页面只读 `message`），
 * 一旦切到 Electron，前端按 `code` 做的文案映射就静默失配。
 *
 * 契约（`docs/api.md` §1.1）：三层适配器行为必须一致，
 * **任何适配器都不得产生 `ERROR_CODES` 之外的 code**。
 */
const declared = new Set(Object.keys(ERROR_CODES));

describe('mock 适配器 · 错误码与目录一致', () => {
  it('未实现的路由返回已登记的 API.ROUTE_NOT_FOUND', async () => {
    const client = createMockAdapter();
    const result = await client.invoke('/api/not-implemented');
    expect(result.code).toBe('API.ROUTE_NOT_FOUND');
    expect(declared.has(result.code as string)).toBe(true);
  });

  it('登录失败返回主进程同款 AUTH.LOGIN_FAILED，而不是自造 code', async () => {
    const client = createMockAdapter();
    const result = await client.invoke('/api/auth/login', { username: 'admin', password: 'wrong' }, null, {
      method: 'POST'
    });
    expect(result.code).toBe('AUTH.LOGIN_FAILED');
    if (result.code !== 0) {
      // source 与兜底文案也必须来自目录，避免两处维护两份文案
      expect(result.source).toBe(ERROR_CODES['AUTH.LOGIN_FAILED'].source);
      expect(result.message).toBe(ERROR_CODES['AUTH.LOGIN_FAILED'].message);
    }
  });

  it('登录成功返回统一信封', async () => {
    const client = createMockAdapter();
    const result = await client.invoke('/api/auth/login', { username: 'admin', password: 'admin123' }, null, {
      method: 'POST'
    });
    expect(result.code).toBe(0);
  });

  it('登录返回的 permissions 与主进程口径一致（按角色派生，不是空数组）', async () => {
    // 起因（2026-09-25 实测）：mock 曾把三个账号的 permissions 一律写成 []，
    // 而主进程 `services/auth.ts` 用 `permissionsOf(row.role)`。
    // 界面若信任 `user.permissions`，两种形态会显示不同的权限数，且都不报错。
    const client = createMockAdapter();
    for (const [username, password, role] of [
      ['admin', 'admin123', 'admin'],
      ['dispatcher', 'dispatcher123', 'dispatcher'],
      ['monitor', 'monitor123', 'monitor']
    ] as const) {
      const result = await client.invoke('/api/auth/login', { username, password }, null, {
      method: 'POST'
    });
      expect(result.code).toBe(0);
      if (result.code === 0) {
        const user = (result.data as { user: { permissions: string[]; role: string } }).user;
        expect(user.role).toBe(role);
        expect(user.permissions.slice().sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());
        expect(user.permissions.length).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * 基础数据四个列表接口：**Mock 与真实主进程逐项对齐**。
 *
 * 为什么值得单独一组断言：这两个实现天然是两份（浏览器跑不了 SQLite），
 * 而它们之间的差异**不会报错**，只在切换形态时表现为「同一页看到不同的行 / 不同的顺序 / 不同的总数」。
 * 之前的做法（`mock-data.test.ts`）是把 Mock 的快照与 seed 库比对；
 * 这里更进一步 —— 用**同一批请求**同时打两个适配器，比对整个响应。
 *
 * **显式排除的三个字段**：`createdAt` / `updatedAt` / `lastHeartbeatAt`。
 * 它们是 seed 落库时写入的**运行时刻**，Mock 无法复现（也不该假装能）。
 * 排除项写死在这里，而不是用 `expect.anything()` —— 否则将来新增的时间字段会被**静默放过**。
 */
const TIME_FIELDS = [
  'createdAt',
  'updatedAt',
  'lastHeartbeatAt',
  // 待派发任务的**时间窗**由 seed / Mock 各自按「当前时刻」刷新（见 seed.ts 的说明），
  // 因此两边必然不同值 —— 但它又必须排除在比对之外，否则这条用例会一直红
  'timeWindowStart',
  'timeWindowEnd',
  // M3 任务的六个「状态时间戳」：seed 写的是运行时刻，Mock 用固定值（同上一行）
  'submittedAt',
  'assignedAt',
  'startedAt',
  'finishedAt',
  'cancelledAt',
  'failedAt'
];

function stripTimes(record: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...record };
  for (const field of TIME_FIELDS) {
    delete copy[field];
  }
  return copy;
}

function setupRealRouter() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  const sessions = new SessionStore();
  const bus = new EventBus(db, sessions);
  // 与主进程同构：执行器按依赖注入（M7）。这些用例不点执行接口，但签名必须一致
  const executor = new ExecutionRunner(db, bus);
  const router = createRouter(createApiRoutes({ db, sessions, bus, executor }), { db, sessions });
  const admin = login(db, sessions, { username: 'admin', password: 'admin123' }, 't-parity');
  // `sessions` 也返回：需要第二个角色的会话时，必须用**同一个**会话存储登录
  // （另起一个 SessionStore 得到的 token 在 Router 里查不到，会变成 AUTH.REQUIRED）
  return { db, router, sessions, token: admin.token };
}

/**
 * 这一组用例引用的节点 / 站点用 `data/campus/` 里真实存在的编码推导。
 *
 * 之前写的是 4×3 方格网的 `seed-n01..seed-n12` —— 换地图数据后那些 id 全部不存在，
 * 于是用例以 `NODE.NOT_FOUND` 的形态失败，看起来像「Mock 与主进程不一致」，
 * 实际只是夹具引用了不存在的行。
 */
const NODE_00 = campusNodeId('N00');
const NODE_01 = campusNodeId('N01');
const NODE_10 = campusNodeId('N10');
const NODE_44 = campusNodeId('N44');
const SITE_A = SEED_IDS.siteDepot;
const SITE_B = SEED_IDS.siteDorm;

describe('mock 适配器 · 与主进程列表接口逐项一致', () => {
  const paths = ['/api/sites', '/api/vehicles', '/api/nodes', '/api/edges'];
  const payloads: Array<Record<string, unknown>> = [
    {},
    { page: 2, pageSize: 5 },
    { page: 'abc', pageSize: -3 },
    { pageSize: 1000 },
    { keyword: 'a' },
    { keyword: 'AGV-01' },
    { status: 'disabled' }
  ];

  it('四个接口 × 七组参数：code / total / page / pageSize / records 全部相同', async () => {
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    let compared = 0;

    for (const path of paths) {
      for (const payload of payloads) {
        const mockResult = await mock.invoke<{ records: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }>(
          path,
          payload,
          null
        );
        const realResult = await router.invoke({ path, payload, token });
        const label = `${path} ${JSON.stringify(payload)}`;
        expect(realResult.code, label).toBe(0);
        expect(mockResult.code, label).toBe(0);
        if (mockResult.code !== 0 || realResult.code !== 0) {
          continue;
        }
        // Router 的返回类型是 ApiResult<unknown>（每个接口的 data 形状不同，由调用方声明）；
        // 这里按列表信封断言，两边用的是同一份形状
        const real = realResult.data as { records: Array<Record<string, unknown>>; total: number; page: number; pageSize: number };
        expect(mockResult.data.page, label).toBe(real.page);
        expect(mockResult.data.pageSize, label).toBe(real.pageSize);
        expect(mockResult.data.total, label).toBe(real.total);
        expect(mockResult.data.records.map(stripTimes), label).toEqual(real.records.map(stripTimes));
        compared += 1;
      }
    }
    // 护栏自检：确认真的比对了 4×7 组，而不是循环提前退出
    expect(compared).toBe(paths.length * payloads.length);
    db.close();
  });

  it('筛选值非法时两边返回**同一个**错误码，而不是一边报错一边静默全量', async () => {
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    for (const path of ['/api/sites', '/api/vehicles', '/api/nodes', '/api/edges']) {
      const mockResult = await mock.invoke(path, { status: 'nonsense' }, null);
      const realResult = await router.invoke({ path, payload: { status: 'nonsense' }, token });
      expect(mockResult.code, path).toBe('VALIDATION.FAILED');
      expect(realResult.code, path).toBe('VALIDATION.FAILED');
    }
    db.close();
  });

  it('未实现的路径两边都返回 API.ROUTE_NOT_FOUND（不伪造成功）', async () => {
    // 这条用例的**取值会随实现推进而更换**：它需要一个「契约里规划了、但两边都还没实现」的路径。
    // 2026-09-26 换到 `/api/alerts`（M8）；2026-09-28 M8 落地后，它换成
    // **四类数据文件导入**（`docs/data-interfaces.md`；`/api/import/*`）——
    // 那是目前唯一还没开工的接口族。
    // 若哪天导入也实现了，这条会以「两边都返回 0」的形式失败 —— 那时换下一个未实现的路径即可，
    // 不要因为「它不再失败」而删掉这条断言（它守的是「不伪造成功」这条规则，不是某个具体路径）。
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    const path = '/api/import/orders/preflight';
    expect((await mock.invoke(path, {}, null)).code).toBe('API.ROUTE_NOT_FOUND');
    expect((await router.invoke({ path, payload: {}, token })).code).toBe('API.ROUTE_NOT_FOUND');
    db.close();
  });

  it('禁行规则与任务模板两个列表也逐项一致（后两类主数据）', async () => {
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    /*
     * 这两类与四类主数据的 payload 矩阵**不能共用**：`status: 'disabled'` 对它们是
     * 非法取值（规则只有 active/expired、模板没有状态维度），共用会让四类主数据那组的
     * 「同一批参数打四个接口」失去意义，或者把非法取值当成正常用例。
     * 因此各自一组，参数覆盖点仍保持相同：默认 / 翻页 / 非法分页 / 超大页 / 关键词 / 筛选。
     */
    const matrix: Array<{ path: string; payloads: Array<Record<string, unknown>> }> = [
      {
        path: '/api/restrictions',
        payloads: [{}, { page: 2, pageSize: 5 }, { page: 'abc', pageSize: -3 }, { pageSize: 1000 }, { type: 'node' }, { type: 'edge' }, { status: 'active' }]
      },
      {
        path: '/api/task-templates',
        // `keyword: 'TPL'` 是关键的一组：它让两边都返回**非空**记录，
        // 从而真正比对模板的字段值（默认参数下两边都返回 2 条，同样是非空）
        payloads: [{}, { page: 2, pageSize: 1 }, { page: 'abc', pageSize: -3 }, { pageSize: 1000 }, { keyword: 'TPL' }, { keyword: '回充' }, { keyword: '不存在的名字' }]
      }
    ];
    let compared = 0;
    for (const { path, payloads } of matrix) {
      for (const payload of payloads) {
        const mockResult = await mock.invoke<{ records: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }>(path, payload, null);
        const realResult = await router.invoke({ path, payload, token });
        const label = `${path} ${JSON.stringify(payload)}`;
        expect(realResult.code, label).toBe(0);
        expect(mockResult.code, label).toBe(0);
        if (mockResult.code !== 0 || realResult.code !== 0) {
          continue;
        }
        const real = realResult.data as { records: Array<Record<string, unknown>>; total: number; page: number; pageSize: number };
        expect(mockResult.data.total, label).toBe(real.total);
        expect(mockResult.data.records.map(stripTimes), label).toEqual(real.records.map(stripTimes));
        compared += 1;
      }
    }
    expect(compared).toBe(14);
    db.close();
  });
});

/**
 * M3 任务：列表与详情的逐项比对。
 *
 * 任务的比对比基础数据多一层价值：它的**读路径**已经含派生字段
 * （`fromSiteName` / `toSiteName` / `vehicleCode`）与派生摘要（路线节点数 / 边数），
 * 这些字段一旦两边算法不同，界面上的数字就会不一样，而且不会有任何报错。
 */
describe('mock 适配器 · 与主进程的任务接口逐项一致', () => {
  it('/api/tasks × 七组参数：code / total / records 逐字段相同（含派生字段）', async () => {
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    const payloads: Array<Record<string, unknown>> = [
      { pageSize: 1000 },
      { keyword: 'T-DEMO' },
      { keyword: '演示配送' },
      { status: 'running' },
      { status: 'draft, running' },
      { priority: 'normal' },
      { vehicleId: 'seed-veh-agv01' }
    ];
    let compared = 0;
    for (const payload of payloads) {
      const mockResult = await mock.invoke<{ records: Array<Record<string, unknown>>; total: number }>('/api/tasks', payload, null);
      const realResult = await router.invoke({ path: '/api/tasks', payload, token });
      const label = `/api/tasks ${JSON.stringify(payload)}`;
      expect(realResult.code, label).toBe(0);
      expect(mockResult.code, label).toBe(0);
      if (mockResult.code !== 0 || realResult.code !== 0) {
        continue;
      }
      const real = realResult.data as { records: Array<Record<string, unknown>>; total: number };
      expect(mockResult.data.total, label).toBe(real.total);
      expect(mockResult.data.records.map(stripTimes), label).toEqual(real.records.map(stripTimes));
      compared += 1;
    }
    expect(compared).toBe(payloads.length);
    db.close();
  });

  it('/api/tasks/{id}：详情的四个附加块（计划 / 路线 / 告警 / 操作）也逐项相同', async () => {
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    const mockResult = await mock.invoke<Record<string, unknown>>('/api/tasks/seed-task-demo', {}, null);
    const realResult = await router.invoke({ path: '/api/tasks/seed-task-demo', payload: {}, token });
    expect(mockResult.code).toBe(0);
    expect(realResult.code).toBe(0);
    if (mockResult.code !== 0 || realResult.code !== 0) {
      db.close();
      return;
    }
    expect(stripTimes(mockResult.data)).toEqual(stripTimes(realResult.data as Record<string, unknown>));
    // 404 也要一致
    expect((await mock.invoke('/api/tasks/ghost', {}, null)).code).toBe('TASK.NOT_FOUND');
    expect((await router.invoke({ path: '/api/tasks/ghost', payload: {}, token })).code).toBe('TASK.NOT_FOUND');
    db.close();
  });

  it('读路径的筛选值非法时两边同码（`?status=` 逗号多值里的坏值也一样）', async () => {
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    for (const payload of [{ status: 'nope' }, { status: 'draft, nope' }, { priority: 'blocker' }]) {
      const label = JSON.stringify(payload);
      expect((await mock.invoke('/api/tasks', payload, null)).code, label).toBe('VALIDATION.FAILED');
      expect((await router.invoke({ path: '/api/tasks', payload, token })).code, label).toBe('VALIDATION.FAILED');
    }
    db.close();
  });
});

/**
 * 写路径：**错误码一致性**。
 *
 * 写操作在 Mock 与主进程之间是「规则共享、存储各自」（`mock-base-write.ts` 的说明）：
 * 字段规则来自 `shared/src/base-rules.ts`，两边的**校验结论**因此必然相同；
 * 存储那一半（唯一性、引用）各查各的库，但结论也必须相同 ——
 * 那才是「同一份契约」的意思。
 *
 * 这里**只比对错误码与 detail.fields 的键**，不比对成功返回值：
 * 成功返回值里必然含 `id` 与时间戳（两边的生成方式不同），
 * 而逐一排除那些字段只会得到一个「看起来在比对、其实什么都没比」的断言。
 */
describe('mock 适配器 · 与主进程写接口的错误码一致', () => {
  /** 同一批写请求，两边各打一次。`payload` 故意覆盖四类失败：字段 / 唯一 / 引用 / 状态。 */
  // `DELETE` 也在里面：禁行规则的物理删除是一条破例的写路径，
  // 而「删除不存在的 id」同样必须两边返回同一个 code
  const cases: Array<{ label: string; path: string; method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; payload: Record<string, unknown> }> = [
    { label: '站点：编码为空', path: '/api/sites', method: 'POST', payload: { code: '', name: 'S', type: 'depot' } },
    { label: '站点：类型非法', path: '/api/sites', method: 'POST', payload: { code: 'S9', name: 'S', type: 'nope' } },
    { label: '站点：x 是字符串', path: '/api/sites', method: 'POST', payload: { code: 'S9', name: 'S', type: 'depot', x: 'abc' } },
    { label: '站点：编码重复', path: '/api/sites', method: 'POST', payload: { code: 'ST01', name: 'S', type: 'depot' } },
    { label: '站点：节点不存在', path: '/api/sites', method: 'POST', payload: { code: 'S9', name: 'S', type: 'depot', nodeId: 'ghost' } },
    { label: '站点：改 code 被拒', path: `/api/sites/${SEED_IDS.siteDepot}`, method: 'PUT', payload: { code: 'X' } },
    { label: '站点：id 不存在', path: '/api/sites/ghost', method: 'PUT', payload: { name: 'x' } },
    { label: '站点：启停取值非法', path: `/api/sites/${SEED_IDS.siteDepot}/status`, method: 'PATCH', payload: { status: 'paused' } },
    { label: '站点：status 缺失', path: `/api/sites/${SEED_IDS.siteDepot}/status`, method: 'PATCH', payload: {} },
    {
      label: '车辆：载重为 0',
      path: '/api/vehicles',
      method: 'POST',
      payload: { code: 'V9', name: 'V', type: 'agv', capacityKg: 0, maxSpeedMps: 1, x: 0, y: 0 }
    },
    {
      label: '车辆：battery 越界',
      path: '/api/vehicles',
      method: 'POST',
      payload: { code: 'V9', name: 'V', type: 'agv', capacityKg: 1, maxSpeedMps: 1, x: 0, y: 0, battery: 101 }
    },
    { label: '车辆：占用中停用', path: `/api/vehicles/${SEED_IDS.vehicleAgv}/status`, method: 'PATCH', payload: { status: 'disabled' } },
    { label: '车辆：执行器专管状态', path: `/api/vehicles/${SEED_IDS.vehicleAgv}/status`, method: 'PATCH', payload: { status: 'charging' } },
    { label: '节点：坐标缺失', path: '/api/nodes', method: 'POST', payload: { code: 'N9', name: 'N' } },
    { label: '节点：编码重复', path: '/api/nodes', method: 'POST', payload: { code: 'N01', name: 'N', x: 0, y: 0 } },
    { label: '节点：被引用时禁用', path: `/api/nodes/${NODE_00}/status`, method: 'PATCH', payload: { status: 'disabled' } },
    { label: '边：自环', path: '/api/edges', method: 'POST', payload: { fromNodeId: NODE_00, toNodeId: NODE_00 } },
    { label: '边：端点不存在', path: '/api/edges', method: 'POST', payload: { fromNodeId: 'ghost', toNodeId: NODE_00 } },
    { label: '边：方向对重复', path: '/api/edges', method: 'POST', payload: { fromNodeId: NODE_00, toNodeId: NODE_01 } },
    { label: '边：自定义 code 与推导值不符', path: '/api/edges', method: 'POST', payload: { fromNodeId: NODE_10, toNodeId: NODE_00, code: 'E_X_Y' } },
    // ---- 禁行规则（§3.2.5）----
    { label: '规则：原因缺失', path: '/api/restrictions', method: 'POST', payload: { type: 'node', targetId: NODE_00 } },
    { label: '规则：类型非法', path: '/api/restrictions', method: 'POST', payload: { type: 'lane', targetId: NODE_00, reason: 'x' } },
    { label: '规则：目标不存在', path: '/api/restrictions', method: 'POST', payload: { type: 'node', targetId: 'ghost', reason: 'x' } },
    {
      label: '规则：边目标不存在（类型对、id 不对）',
      path: '/api/restrictions',
      method: 'POST',
      payload: { type: 'edge', targetId: 'seed-e-N99-N98', reason: 'x' }
    },
    { label: '规则：时间不能解析', path: '/api/restrictions', method: 'POST', payload: { type: 'node', targetId: NODE_00, reason: 'x', startAt: '明天上午' } },
    {
      label: '规则：结束早于开始（跨字段）',
      path: '/api/restrictions',
      method: 'POST',
      payload: { type: 'node', targetId: NODE_00, reason: 'x', startAt: '2026-09-27T10:00:00.000Z', endAt: '2026-09-27T09:00:00.000Z' }
    },
    { label: '规则：id 不存在', path: '/api/restrictions/ghost', method: 'PUT', payload: { reason: 'x' } },
    // 这条同时锁住**校验顺序**：主进程先 `requireRestriction` 再判 status，
    // Mock 必须同序 —— 若 Mock 先判字段，同一条请求会返回两个不同的 code
    { label: '规则：id 不存在时先报 NOT_FOUND，而不是先报字段非法', path: '/api/restrictions/ghost', method: 'PUT', payload: { status: 'paused' } },
    // delete 一个不存在的 id：两边都必须是 RESTRICTION.NOT_FOUND，而不是「成功删除了 0 行」
    { label: '规则：删除不存在的 id', path: '/api/restrictions/ghost', method: 'DELETE', payload: {} },
    // ---- 任务模板（§3.2.6）----
    { label: '模板：编码缺失', path: '/api/task-templates', method: 'POST', payload: { name: 'T' } },
    { label: '模板：优先级非法', path: '/api/task-templates', method: 'POST', payload: { code: 'TPL-9', name: 'T', priority: 'blocker' } },
    { label: '模板：载重为负', path: '/api/task-templates', method: 'POST', payload: { code: 'TPL-9', name: 'T', defaultCargoKg: -1 } },
    { label: '模板：时间窗非整数', path: '/api/task-templates', method: 'POST', payload: { code: 'TPL-9', name: 'T', timeWindowMinutes: 1.5 } },
    { label: '模板：站点类型非法', path: '/api/task-templates', method: 'POST', payload: { code: 'TPL-9', name: 'T', fromSiteType: 'roof' } },
    { label: '模板：编码重复', path: '/api/task-templates', method: 'POST', payload: { code: 'TPL-STD', name: 'T' } },
    { label: '模板：id 不存在', path: '/api/task-templates/ghost', method: 'PUT', payload: { name: 'T' } },
    { label: '模板：改 code 被拒', path: '/api/task-templates/seed-tpl-std', method: 'PUT', payload: { code: 'X' } },
    // ---- 任务（§3.3）----
    { label: '任务：标题缺失', path: '/api/tasks', method: 'POST', payload: { cargoKg: 10, fromSiteId: SITE_A, toSiteId: SITE_B } },
    { label: '任务：载重是字符串', path: '/api/tasks', method: 'POST', payload: { title: 'T', cargoKg: '10', fromSiteId: SITE_A, toSiteId: SITE_B } },
    { label: '任务：起终点相同', path: '/api/tasks', method: 'POST', payload: { title: 'T', cargoKg: 10, fromSiteId: SITE_A, toSiteId: SITE_A } },
    { label: '任务：时间窗倒置', path: '/api/tasks', method: 'POST', payload: { title: 'T', cargoKg: 10, fromSiteId: SITE_A, toSiteId: SITE_B, timeWindowStart: '2026-09-27T10:00:00.000Z', timeWindowEnd: '2026-09-27T09:00:00.000Z' } },
    { label: '任务：时间窗只给一端', path: '/api/tasks', method: 'POST', payload: { title: 'T', cargoKg: 10, fromSiteId: SITE_A, toSiteId: SITE_B, timeWindowStart: '2026-09-27T10:00:00.000Z' } },
    { label: '任务：起点站点不存在', path: '/api/tasks', method: 'POST', payload: { title: 'T', cargoKg: 10, fromSiteId: 'ghost', toSiteId: SITE_B } },
    { label: '任务：模板不存在', path: '/api/tasks', method: 'POST', payload: { title: 'T', cargoKg: 10, fromSiteId: SITE_A, toSiteId: SITE_B, templateId: 'ghost' } },
    { label: '任务：模板要求的终点类型不符', path: '/api/tasks', method: 'POST', payload: { title: 'T', cargoKg: 10, fromSiteId: SITE_A, toSiteId: SITE_B, templateId: SEED_IDS.templateReturn } },
    { label: '任务：编辑传 templateId 被拒', path: '/api/tasks/seed-task-demo', method: 'PUT', payload: { templateId: 'seed-tpl-std' } },
    { label: '任务：已派发（running）不可编辑', path: '/api/tasks/seed-task-demo', method: 'PUT', payload: { title: '偷偷改' } },
    { label: '任务：编辑不存在的 id', path: '/api/tasks/ghost', method: 'PUT', payload: { title: 'T' } },
    { label: '任务：非法迁移（running 上恢复）', path: '/api/tasks/seed-task-demo/resume', method: 'POST', payload: {} },
    { label: '任务：取消缺原因', path: '/api/tasks/seed-task-demo/cancel', method: 'POST', payload: {} },
    { label: '任务：状态操作的目标不存在', path: '/api/tasks/ghost/cancel', method: 'POST', payload: { reason: 'x' } },
    { label: '任务：内部动作 assign 不开放', path: '/api/tasks/seed-task-demo/assign', method: 'POST', payload: {} },
    { label: '任务：delete 不开放（走 DELETE 方法）', path: '/api/tasks/seed-task-demo/delete', method: 'POST', payload: {} },
    { label: '任务：未登记的动作', path: '/api/tasks/seed-task-demo/fly', method: 'POST', payload: {} },
    { label: '任务：非草稿删除', path: '/api/tasks/seed-task-demo', method: 'DELETE', payload: {} },
    { label: '任务：删除不存在的 id', path: '/api/tasks/ghost', method: 'DELETE', payload: {} }
  ];

  it('同一批写请求：两边返回**同一个** code（含 fields 的键集合）', async () => {
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    // Mock 需要登录态：写接口在 Mock 侧也按 `base:write` 强制（admin 有）。
    // `token` 为 `null` 时下面的断言会以 AUTH.REQUIRED 的形式失败，不会静默跳过。
    const loginResult = await mock.invoke<{ token: string }>('/api/auth/login', {
      username: 'admin',
      password: 'admin123'
    }, null, { method: 'POST' });
    const mockToken = loginResult.code === 0 ? loginResult.data.token : null;

    let compared = 0;
    for (const testCase of cases) {
      const mockResult = await mock.invoke(testCase.path, testCase.payload, mockToken, { method: testCase.method });
      const realResult = await router.invoke({ path: testCase.path, method: testCase.method, payload: testCase.payload, token });
      expect(realResult.code, testCase.label).not.toBe(0);
      expect(mockResult.code, `${testCase.label} —— mock 返回 ${JSON.stringify(mockResult)}`).toBe(realResult.code);

      // `detail.fields` 的**键集合**也必须一致：前端按字段名标红输入框，
      // 少一个键就等于少标红一个输入框（而 code 相同，看不出差别）
      const mockFields = (mockResult as { detail?: { fields?: Record<string, string> } }).detail?.fields;
      const realFields = (realResult as { detail?: { fields?: Record<string, string> } }).detail?.fields;
      expect(Object.keys(mockFields ?? {}).sort(), `${testCase.label} 的 fields`).toEqual(Object.keys(realFields ?? {}).sort());

      // `message` 也要一致：页面在整表级错误里**直接显示这句话**，
      // 两种形态给两句不同的话（如主进程说「当前状态 pending 不能执行 delete」、
      // mock 说「当前状态不允许执行该操作」）会让同一份契约看起来像两个产品。
      // 实测（2026-09-26）：`DELETE /api/tasks/{id}` 正是这样一处 —— code 相同、文案不同。
      expect(mockResult.message, `${testCase.label} 的 message`).toBe(realResult.message);
      compared += 1;
    }
    // 防「循环提前退出 / 用例表被清空」把这条断言变成假通过
    expect(compared).toBe(cases.length);
    expect(compared).toBeGreaterThanOrEqual(20);
    db.close();
  });

  it('成功路径也一致：两边都能创建同一个编码，第二次都报 BASE.CODE_EXISTS', async () => {
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    const loginResult = await mock.invoke<{ token: string }>('/api/auth/login', { username: 'admin', password: 'admin123' }, null, { method: 'POST' });
    const mockToken = loginResult.code === 0 ? loginResult.data.token : null;

    const payload = { code: 'S-PARITY-1', name: '一致性站点', type: 'depot', x: 1, y: 2 };
    const mockFirst = await mock.invoke('/api/sites', payload, mockToken, { method: 'POST' });
    const realFirst = await router.invoke({ path: '/api/sites', method: 'POST', payload, token });
    expect(realFirst.code).toBe(0);
    expect(mockFirst.code).toBe(0);
    // 两边返回的对象**键集合**相同（值里的 id / 时间戳必然不同）
    if (mockFirst.code === 0 && realFirst.code === 0) {
      expect(Object.keys(mockFirst.data as object).sort()).toEqual(Object.keys(realFirst.data as object).sort());
    }

    const mockAgain = await mock.invoke('/api/sites', payload, mockToken, { method: 'POST' });
    const realAgain = await router.invoke({ path: '/api/sites', method: 'POST', payload, token });
    expect(mockAgain.code).toBe('BASE.CODE_EXISTS');
    expect(realAgain.code).toBe('BASE.CODE_EXISTS');
    db.close();
  });

  it('禁行规则：创建 → 读回派生目标编码 → 改状态 → 物理删除，两边逐步一致', async () => {
    /*
     * 为什么值得一条**成套**的用例：禁行规则独有的三件事都在这条路径上
     *   - 目标是多态引用，列表里的 `targetCode` 是**派生**的（节点取 code、边按两端推导）；
     *   - 状态只能通过 PUT 改（没有启停接口）；
     *   - 删除是**物理**删除 —— 删完之后列表里必须真的没有它，而不是多了一条 expired。
     * 只靠错误码一致的那组用例，这三件事一件也验证不到。
     */
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    const loginResult = await mock.invoke<{ token: string }>('/api/auth/login', { username: 'admin', password: 'admin123' }, null, { method: 'POST' });
    const mockToken = loginResult.code === 0 ? loginResult.data.token : null;
    // 目标用节点而不是边：seed 自带 2 条**边**类型占道规则，
    // 用节点类型才能让「列表里只有我刚建的那条」成立（否则计数永远是 3 而不是 1）
    const payload = {
      type: 'node',
      targetId: NODE_00,
      reason: '道路施工',
      startAt: '2026-09-27T08:00:00.000Z',
      endAt: '2026-09-27T18:00:00.000Z'
    };
    const mockCreated = await mock.invoke<Record<string, unknown>>('/api/restrictions', payload, mockToken, { method: 'POST' });
    const realCreated = await router.invoke({ path: '/api/restrictions', method: 'POST', payload, token });
    expect(realCreated.code).toBe(0);
    expect(mockCreated.code).toBe(0);
    if (mockCreated.code !== 0 || realCreated.code !== 0) {
      db.close();
      return;
    }
    // 派生字段与逐字段值必须一致（id / createdAt / createdBy 必然不同，见 stripTimes 的口径）
    const mockRule = stripTimes(mockCreated.data);
    // Router 的返回类型是 `ApiResult<unknown>`（每个接口的 data 形状不同，由调用方声明）
    const realRule = stripTimes(realCreated.data as Record<string, unknown>);
    delete mockRule.id;
    delete realRule.id;
    delete mockRule.createdBy;
    delete realRule.createdBy;
    expect(mockRule).toEqual(realRule);
    // 目标编码是推导出来的：节点的 `code`
    expect(realRule['targetCode']).toBe('N00');

    // 列表里能查到（读路径与写路径用的是同一套投影）
    const mockList = await mock.invoke<{ total: number }>('/api/restrictions', { type: 'node' }, mockToken);
    const realList = await router.invoke({ path: '/api/restrictions', payload: { type: 'node' }, token });
    expect(realList.code === 0 && (realList.data as { total: number }).total).toBe(1);
    expect(mockList.code === 0 && mockList.data.total).toBe(1);

    // 改成 expired（契约里没有启停接口，失效是一条 PUT）
    const realId = (realCreated.data as { id: string }).id;
    const mockId = (mockCreated.data as { id: string }).id;
    const realExpired = await router.invoke({ path: `/api/restrictions/${realId}`, method: 'PUT', payload: { status: 'expired' }, token });
    const mockExpired = await mock.invoke(`/api/restrictions/${mockId}`, { status: 'expired' }, mockToken, { method: 'PUT' });
    expect(realExpired.code === 0 && (realExpired.data as { status: string }).status).toBe('expired');
    expect(mockExpired.code === 0 && (mockExpired.data as { status: string }).status).toBe('expired');

    // 物理删除：两边都必须真的删掉（不是打标记）
    const realDeleted = await router.invoke({ path: `/api/restrictions/${realId}`, method: 'DELETE', token });
    const mockDeleted = await mock.invoke(`/api/restrictions/${mockId}`, {}, mockToken, { method: 'DELETE' });
    expect(realDeleted).toMatchObject({ code: 0, data: { deleted: true } });
    expect(mockDeleted).toMatchObject({ code: 0, data: { deleted: true } });
    // 只看 `node` 类型的规则：seed 自带的 2 条占道规则是 `edge` 类型，不该混进这次计数
    const realAfter = await router.invoke({ path: '/api/restrictions', payload: { type: 'node' }, token });
    expect(realAfter.code === 0 && (realAfter.data as { total: number }).total).toBe(0);
    const mockAfter = await mock.invoke<{ total: number }>('/api/restrictions', { type: 'node' }, mockToken);
    expect(mockAfter.code === 0 && mockAfter.data.total).toBe(0);
    // 第二次删除同一个 id：两边都必须是 NOT_FOUND（不存在与「删过了」可区分）
    const realAgain = await router.invoke({ path: `/api/restrictions/${realId}`, method: 'DELETE', token });
    expect(realAgain.code).toBe('RESTRICTION.NOT_FOUND');
    db.close();
  });

  it('任务模板：创建 → 列表 → 更新，两边一致（模板不可删除）', async () => {
    const { db, router, token } = setupRealRouter();
    const mock = createMockAdapter();
    const loginResult = await mock.invoke<{ token: string }>('/api/auth/login', { username: 'admin', password: 'admin123' }, null, { method: 'POST' });
    const mockToken = loginResult.code === 0 ? loginResult.data.token : null;
    // 故意**不给 priority**：缺省必须是 normal（DDL 的 DEFAULT 与校验函数的口径要一致）
    const payload = { code: 'TPL-PARITY-1', name: '一致性模板', defaultCargoKg: 12.5, timeWindowMinutes: 30, fromSiteType: 'depot', toSiteType: 'gate' };
    const mockCreated = await mock.invoke<Record<string, unknown>>('/api/task-templates', payload, mockToken, { method: 'POST' });
    const realCreated = await router.invoke({ path: '/api/task-templates', method: 'POST', payload, token });
    expect(realCreated.code).toBe(0);
    expect(mockCreated.code).toBe(0);
    if (mockCreated.code !== 0 || realCreated.code !== 0) {
      db.close();
      return;
    }
    const mockTemplate = stripTimes(mockCreated.data);
    const realTemplate = stripTimes(realCreated.data as Record<string, unknown>);
    expect(mockTemplate['priority']).toBe('normal');
    expect(realTemplate['priority']).toBe('normal');
    // 键集合与逐字段值（去掉两边必然不同的 id）
    expect(Object.keys(mockTemplate).sort()).toEqual(Object.keys(realTemplate).sort());
    delete mockTemplate.id;
    delete realTemplate.id;
    expect(mockTemplate).toEqual(realTemplate);

    const realId = (realCreated.data as { id: string }).id;
    const mockId = (mockCreated.data as { id: string }).id;
    const realUpdated = await router.invoke({ path: `/api/task-templates/${realId}`, method: 'PUT', payload: { remark: '备注', defaultCargoKg: null }, token });
    const mockUpdated = await mock.invoke(`/api/task-templates/${mockId}`, { remark: '备注', defaultCargoKg: null }, mockToken, { method: 'PUT' });
    expect(realUpdated.code === 0 && (realUpdated.data as { defaultCargoKg: null }).defaultCargoKg).toBeNull();
    expect(mockUpdated.code === 0 && (mockUpdated.data as { defaultCargoKg: null }).defaultCargoKg).toBeNull();
    db.close();
  });

  it('权限：Mock 侧同样按 base:write 强制（dispatcher 写 → AUTH.FORBIDDEN）', async () => {
    const mock = createMockAdapter();
    const loginResult = await mock.invoke<{ token: string }>('/api/auth/login', {
      username: 'dispatcher',
      password: 'dispatcher123'
    }, null, { method: 'POST' });
    const token = loginResult.code === 0 ? loginResult.data.token : null;
    const result = await mock.invoke('/api/sites', { code: 'X', name: 'X', type: 'depot' }, token, { method: 'POST' });
    expect(result).toMatchObject({ code: 'AUTH.FORBIDDEN' });
    // 未登录同理
    const anonymous = await mock.invoke('/api/sites', { code: 'X', name: 'X', type: 'depot' }, null, { method: 'POST' });
    expect(anonymous).toMatchObject({ code: 'AUTH.REQUIRED' });
  });

  it('方法不匹配的写请求返回 ROUTE_NOT_FOUND，而不是误当成读接口', async () => {
    const mock = createMockAdapter();
    const loginResult = await mock.invoke<{ token: string }>('/api/auth/login', { username: 'admin', password: 'admin123' }, null, { method: 'POST' });
    const token = loginResult.code === 0 ? loginResult.data.token : null;
    const result = await mock.invoke('/api/sites', {}, token, { method: 'DELETE' });
    expect(result).toMatchObject({ code: 'API.ROUTE_NOT_FOUND' });
  });
});

/**
 * M5 路径规划：**Mock 与真实主进程逐项一致**。
 *
 * 这一组比前面的读接口更值得断言，原因是规划结果是**算出来的**：
 * 算法的输入（节点/边/禁行规则）两边来自不同的存储，只要有一处口径不同
 * （边的长度、车种默认速度、禁行规则的时间窗判定），得到的路线就会不同，
 * 而**两边都不会报错** —— 使用者只会看到「浏览器里是这条路、Electron 里是另一条」。
 *
 * 做法上有一个关键点：**禁行规则通过两边的写接口分别建立**，而不是直接改库。
 * 直接改库只能验证读路径；走写接口则顺带证明「同一条规则在两边都被解析成同一张图」。
 */
describe('mock 适配器 · 与主进程的路径规划接口逐项一致', () => {
  /*
   * 用校园路网上真实的四个点（不再依赖 4×3 方格网夹具）：
   *   - `A` = N00 左上角（**只有两个邻居**：N10 与 N01）→ 用来做「封住它就与世隔绝」的用例；
   *   - `B` = N44 右下角，离 A 最远 → 长路径用例；
   *   - `VIA` = N22 路网中心；
   *   - `SELF` = N11，用于「起终点相同」。
   */
  const A = campusNodeId('N00');
  const B = campusNodeId('N44');
  const VIA = campusNodeId('N22');
  const SELF = campusNodeId('N11');
  const n = (index: number) => (index === 1 ? A : index === 12 ? B : index === 5 ? VIA : SELF);

  async function setupBoth() {
    const real = setupRealRouter();
    const mock = createMockAdapter();
    const loginResult = await mock.invoke<{ token: string }>('/api/auth/login', {
      username: 'admin',
      password: 'admin123'
    }, null, { method: 'POST' });
    expect(loginResult.code).toBe(0);
    const mockToken = loginResult.code === 0 ? loginResult.data.token : null;
    return { ...real, mock, mockToken };
  }

  /** 两边各建一条禁行规则（`type` 决定目标是节点还是边）。 */
  async function addRuleOnBoth(
    ctx: Awaited<ReturnType<typeof setupBoth>>,
    payload: Record<string, unknown>
  ): Promise<void> {
    const mockCreated = await ctx.mock.invoke('/api/restrictions', payload, ctx.mockToken, { method: 'POST' });
    const realCreated = await ctx.router.invoke({ path: '/api/restrictions', method: 'POST', payload, token: ctx.token });
    expect(realCreated.code, JSON.stringify(payload)).toBe(0);
    expect(mockCreated.code, JSON.stringify(payload)).toBe(0);
  }

  it('plan：多组输入（车种 / 途经点 / 算法 / 坏参数）下 code 与 route 逐字段相同', async () => {
    const ctx = await setupBoth();
    const payloads: Array<Record<string, unknown>> = [
      { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' },
      { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'drone' },
      { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'carrier', algorithm: 'dijkstra' },
      { fromNodeId: n(1), toNodeId: n(12), viaNodeIds: [n(5)], vehicleType: 'agv' },
      { fromNodeId: n(3), toNodeId: n(3), vehicleType: 'agv' },
      { fromNodeId: n(1), toNodeId: n(12) },
      { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv', algorithm: 'floyd' },
      { fromNodeId: 'seed-nope', toNodeId: n(12), vehicleType: 'agv' },
      { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv', viaNodeIds: [123] }
    ];
    let compared = 0;
    for (const payload of payloads) {
      const label = `plan ${JSON.stringify(payload)}`;
      const mockResult = await ctx.mock.invoke<Record<string, unknown>>('/api/routes/plan', payload, ctx.mockToken, { method: 'POST' });
      const realResult = await ctx.router.invoke({ path: '/api/routes/plan', method: 'POST', payload, token: ctx.token });
      expect(mockResult.code, label).toBe(realResult.code);
      if (mockResult.code === 0 && realResult.code === 0) {
        expect(mockResult.data, label).toEqual(realResult.data);
      } else if (mockResult.code !== 0 && realResult.code !== 0) {
        // 失败时 message / source / detail 都要逐字相同：前端按 detail 做提示，
        // 只比 code 会放过「主进程说节点被禁行、Mock 说找不到路」这类分叉。
        // 两个分支都写成 `code === 0` / `code !== 0` 是为了让 TS 的联合类型收窄生效 ——
        // 用 `as` 强行取字段会让「一边成功一边失败」这种最该报错的形态静默通过
        expect(mockResult.message, label).toBe(realResult.message);
        expect(mockResult.source, label).toBe(realResult.source);
        expect(mockResult.detail, label).toEqual(realResult.detail);
      } else {
        throw new Error(`${label}：一边成功一边失败（mock=${String(mockResult.code)} real=${String(realResult.code)}）`);
      }
      compared += 1;
    }
    expect(compared).toBe(payloads.length);
    ctx.db.close();
  });

  it('compare：两个算法、consistent、difference 两边相同（elapsedMs 只要求存在）', async () => {
    const ctx = await setupBoth();
    const payload = { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' };
    const mockResult = await ctx.mock.invoke<{ results: Array<{ algorithm: string; elapsedMs: number; route: unknown }>; consistent: boolean; difference: unknown }>(
      '/api/routes/compare',
      payload,
      ctx.mockToken,
      { method: 'POST' }
    );
    const realResult = await ctx.router.invoke({ path: '/api/routes/compare', method: 'POST', payload, token: ctx.token });
    expect(mockResult.code).toBe(0);
    expect(realResult.code).toBe(0);
    if (mockResult.code !== 0 || realResult.code !== 0) {
      ctx.db.close();
      return;
    }
    const real = realResult.data as typeof mockResult.data;
    expect(mockResult.data.results.map((item) => item.algorithm)).toEqual(real.results.map((item) => item.algorithm));
    expect(mockResult.data.consistent).toBe(real.consistent);
    expect(mockResult.data.difference).toEqual(real.difference);
    for (const [index, item] of mockResult.data.results.entries()) {
      expect(item.elapsedMs).toBeGreaterThanOrEqual(0);
      // 路线本身逐字段相同（elapsedMs 是耗时，两边必然不同值，单独排除）
      expect(item.route).toEqual(real.results[index]!.route);
    }
    ctx.db.close();
  });

  it('禁行规则建在两边的同一处后，规划结果仍然一致（绕行路线与里程都相同）', async () => {
    const ctx = await setupBoth();
    // 禁掉 N10：A(N00) → SELF(N11) 只剩「绕 N01」这一条，且该节点不得出现在路线里
    await addRuleOnBoth(ctx, { type: 'node', targetId: NODE_10, reason: '一致性用例' });
    const payload = { fromNodeId: A, toNodeId: SELF, vehicleType: 'agv' };
    const mockResult = await ctx.mock.invoke<{ route: { nodeIds: string[]; distanceM: number } }>(
      '/api/routes/plan',
      payload,
      ctx.mockToken,
      { method: 'POST' }
    );
    const realResult = await ctx.router.invoke({ path: '/api/routes/plan', method: 'POST', payload, token: ctx.token });
    expect(mockResult.code).toBe(0);
    expect(realResult.code).toBe(0);
    if (mockResult.code !== 0 || realResult.code !== 0) {
      ctx.db.close();
      return;
    }
    expect(mockResult.data).toEqual(realResult.data);
    expect(mockResult.data.route.nodeIds).not.toContain(NODE_10);
    expect(mockResult.data.route.distanceM).toBeGreaterThan(0);
    ctx.db.close();
  });

  it('被禁行封住的端点：两边同码同 detail（GRAPH.BLOCKED）', async () => {
    const ctx = await setupBoth();
    await addRuleOnBoth(ctx, { type: 'node', targetId: NODE_10, reason: '一致性用例' });
    const payload = { fromNodeId: NODE_10, toNodeId: VIA, vehicleType: 'agv' };
    const mockResult = await ctx.mock.invoke('/api/routes/plan', payload, ctx.mockToken, { method: 'POST' });
    const realResult = await ctx.router.invoke({ path: '/api/routes/plan', method: 'POST', payload, token: ctx.token });
    expect(mockResult.code).toBe('GRAPH.BLOCKED');
    expect(realResult.code).toBe('GRAPH.BLOCKED');
    if (mockResult.code === 'GRAPH.BLOCKED' && realResult.code === 'GRAPH.BLOCKED') {
      expect(mockResult.detail).toEqual(realResult.detail);
    }
    ctx.db.close();
  });

  it('把角落节点 N00 的四条邻边全封住：两边都报 ROUTE.NOT_FOUND_PATH，途经点不可达时 unreachableVia 也相同', async () => {
    const ctx = await setupBoth();
    // 有向边：两个方向是两条独立记录（`E_N00_N10` 与它的反向 `E_N00_N10_R`），
    // 四条都要封，否则 N00 仍可从反方向进来
    for (const code of ['E_N00_N10', 'E_N00_N10_R', 'E_N00_N01', 'E_N00_N01_R']) {
      const list = await ctx.router.invoke({ path: '/api/edges', payload: { code }, token: ctx.token });
      // `Router.invoke` 的 data 是 unknown（每个接口形状不同，由调用方声明）：
      // 先按 code 收窄到成功分支，再声明这里确实是列表信封
      const id =
        list.code === 0 ? (list.data as { records: Array<{ id: string }> }).records[0]?.id : undefined;
      expect(id, `库里应有边 ${code}`).toBeTruthy();
      await addRuleOnBoth(ctx, { type: 'edge', targetId: id, reason: '一致性用例' });
    }
    for (const payload of [
      { fromNodeId: B, toNodeId: A, vehicleType: 'agv' },
      { fromNodeId: B, toNodeId: B, viaNodeIds: [A], vehicleType: 'agv' }
    ]) {
      const label = JSON.stringify(payload);
      const mockResult = await ctx.mock.invoke('/api/routes/plan', payload, ctx.mockToken, { method: 'POST' });
      const realResult = await ctx.router.invoke({ path: '/api/routes/plan', method: 'POST', payload, token: ctx.token });
      expect(mockResult.code, label).toBe('ROUTE.NOT_FOUND_PATH');
      expect(realResult.code, label).toBe('ROUTE.NOT_FOUND_PATH');
      if (mockResult.code === 'ROUTE.NOT_FOUND_PATH' && realResult.code === 'ROUTE.NOT_FOUND_PATH') {
        expect(mockResult.detail, label).toEqual(realResult.detail);
      }
    }
    ctx.db.close();
  });

  it('GET /api/routes/{id}：演示路线逐字段相同，不存在的 id 两边同码', async () => {
    const ctx = await setupBoth();
    const mockResult = await ctx.mock.invoke<Record<string, unknown>>('/api/routes/seed-route-demo', {}, ctx.mockToken);
    const realResult = await ctx.router.invoke({ path: '/api/routes/seed-route-demo', payload: {}, token: ctx.token });
    expect(mockResult.code).toBe(0);
    expect(realResult.code).toBe(0);
    if (mockResult.code === 0 && realResult.code === 0) {
      expect(stripTimes(mockResult.data)).toEqual(stripTimes(realResult.data as Record<string, unknown>));
    }
    expect((await ctx.mock.invoke('/api/routes/seed-route-nope', {}, ctx.mockToken)).code).toBe('ROUTE.NOT_FOUND');
    expect((await ctx.router.invoke({ path: '/api/routes/seed-route-nope', payload: {}, token: ctx.token })).code).toBe('ROUTE.NOT_FOUND');
    ctx.db.close();
  });

  it('权限：规划类接口要求 route:plan，monitor 在两边都被拒', async () => {
    const ctx = await setupBoth();
    const monitorLogin = await ctx.mock.invoke<{ token: string }>('/api/auth/login', {
      username: 'monitor',
      password: 'monitor123'
    }, null, { method: 'POST' });
    const monitorMockToken = monitorLogin.code === 0 ? monitorLogin.data.token : null;
    // 真主进程侧的 monitor 会话必须**从同一个会话存储**登录得到：
    // 另起一个 `SessionStore` 的话，Router 认不出这个 token，会返回 AUTH.REQUIRED 而不是 AUTH.FORBIDDEN
    const monitorRealToken = login(ctx.db, ctx.sessions, { username: 'monitor', password: 'monitor123' }, 't-mon-parity').token;
    const payload = { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' };
    const mockResult = await ctx.mock.invoke('/api/routes/plan', payload, monitorMockToken, { method: 'POST' });
    const realResult = await ctx.router.invoke({ path: '/api/routes/plan', method: 'POST', payload, token: monitorRealToken });
    expect(mockResult.code).toBe('AUTH.FORBIDDEN');
    expect(realResult.code).toBe('AUTH.FORBIDDEN');
    ctx.db.close();
  });
});

describe('mock 适配器 · M1/M7/M8/M9/M10 与主进程一致', () => {
  async function setupBoth() {
    const real = setupRealRouter();
    const mock = createMockAdapter();
    const loginResult = await mock.invoke<{ token: string }>('/api/auth/login', {
      username: 'admin',
      password: 'admin123'
    }, null, { method: 'POST' });
    expect(loginResult.code).toBe(0);
    const mockToken = loginResult.code === 0 ? loginResult.data.token : null;
    return { ...real, mock, mockToken };
  }

  /**
   * 状态操作与错误码的**逐条对照**。
   *
   * 这类用例的价值全在「同一批请求打两边」：两边各自的单测都绿，
   * 但一份写「`new` 不能直接关闭」、另一份写「可以」时，只有对照才看得出来。
   */
  it('告警状态操作：合法迁移与越级迁移在两边给出同一个 code', async () => {
    const ctx = await setupBoth();
    const cases: Array<{ path: string; payload: Record<string, unknown> }> = [
      { path: `/api/alerts/${SEED_IDS.demoAlert}/resolve`, payload: { resolution: '直接关' } },
      { path: `/api/alerts/${SEED_IDS.demoAlert}/acknowledge`, payload: { note: '接手' } },
      { path: `/api/alerts/${SEED_IDS.demoAlert}/resolve`, payload: { resolution: '已恢复' } },
      { path: `/api/alerts/${SEED_IDS.demoAlert}/resolve`, payload: { resolution: '再关一次' } },
      { path: `/api/alerts/${SEED_IDS.demoAlert}/archive`, payload: { note: '归档' } },
      { path: '/api/alerts/alert-nope/acknowledge', payload: {} }
    ];
    for (const item of cases) {
      const mockResult = await ctx.mock.invoke<Record<string, unknown>>(item.path, item.payload, ctx.mockToken, { method: 'POST' });
      const realResult = await ctx.router.invoke({ path: item.path, method: 'POST', payload: item.payload, token: ctx.token });
      expect(mockResult.code, item.path).toBe(realResult.code);
      if (mockResult.code === 0 && realResult.code === 0) {
        const mockData = mockResult.data as { status: string; transition: unknown };
        const realData = realResult.data as { status: string; transition: unknown };
        expect(mockData.status, item.path).toBe(realData.status);
        expect(mockData.transition, item.path).toEqual(realData.transition);
      }
    }
    ctx.db.close();
  });

  it('告警列表：筛选与非法取值的错误码在两边一致', async () => {
    const ctx = await setupBoth();
    for (const payload of [{}, { status: 'new' }, { level: 'warning' }, { status: 'new-ish' }, { level: 'nope' }]) {
      const mockResult = await ctx.mock.invoke<{ total: number }>('/api/alerts', payload, ctx.mockToken);
      const realResult = await ctx.router.invoke({ path: '/api/alerts', payload, token: ctx.token });
      expect(mockResult.code, JSON.stringify(payload)).toBe(realResult.code);
    }
    ctx.db.close();
  });

  /**
   * 风险预检（`GET /api/alerts/risks`）。
   *
   * 判断本身两边调的是 `shared/src/plan-risk.ts` 同一个函数，所以「同不同」其实取决于
   * **取数**：Mock 从内存数组、主进程从 SQLite。这条用例正是去锁那个差 ——
   * 尤其是 seed 的演示任务「有路线但没有 `dispatch_plans` 行」这条回退路径，
   * 两边都必须看到它，否则其中一边会为一条正常执行中的任务报「缺路线」。
   *
   * 逐字段比对时剥掉墙钟量（`scannedAt`）与派生的占用区间（回退行由「开始时刻 + 路线时长」
   * 推导，两边的 seed 时刻不同）—— 剩下的是**结论**：风险类型 / 级别 / 涉及对象 / 派发条数。
   */
  it('风险预检：两边的风险类型、派发区块与缺口逐项相同', async () => {
    const ctx = await setupBoth();
    const mockResult = await ctx.mock.invoke<PlanRiskReport>('/api/alerts/risks', {}, ctx.mockToken);
    const realResult = (await ctx.router.invoke({ path: '/api/alerts/risks', token: ctx.token })) as ApiResult<PlanRiskReport>;
    expect(mockResult.code).toBe(0);
    expect(realResult.code).toBe(0);
    if (mockResult.code !== 0 || realResult.code !== 0) {
      ctx.db.close();
      return;
    }

    const keys = (report: PlanRiskReport) =>
      report.records.map((item) => `${item.level}|${item.kind}|${item.taskCodes.join(',')}|${item.vehicleCodes.join(',')}`);
    expect(keys(mockResult.data)).toEqual(keys(realResult.data));
    expect(mockResult.data.total).toBe(realResult.data.total);

    // 派发区块：任务与车辆的**配对**必须相同（时间由各自的 seed 时刻派生，不比）
    const pairs = (report: PlanRiskReport) => report.assignments.map((row) => `${row.taskCode}→${row.vehicleCode}`);
    expect(pairs(mockResult.data)).toEqual(pairs(realResult.data));

    // 缺口：待派发任务集合必须相同（这正是调度中心的候选清单）
    expect(mockResult.data.unassignedTasks.map((row) => row.taskCode)).toEqual(
      realResult.data.unassignedTasks.map((row) => row.taskCode)
    );
    expect(mockResult.data.unassignedTasks.length).toBeGreaterThan(0);
    ctx.db.close();
  });

  /**
   * 三个角色都能读（`alert:read` 是三角色共有的权限点）。
   *
   * **已知缺口（ISS-083）**：`未登录`这一档两边**不一致** —— 主进程对每个非 public 路由
   * 都要求会话，Mock 只拦写请求，于是浏览器形态下匿名也能读。这是本批之前就有的差异
   * （全部读接口都如此，不只这一个），修它要给 Mock 补一张「已知路径表」才能保住
   * 「未知路径 → ROUTE_NOT_FOUND」，因此单独登记、不混在本批里改。
   * 这里只断言**有会话时**两边一致。
   */
  it('风险预检：三个角色都能读，且结论相同', async () => {
    const ctx = await setupBoth();
    for (const [username, password] of [
      ['admin', 'admin123'],
      ['dispatcher', 'dispatcher123'],
      ['monitor', 'monitor123']
    ] as const) {
      const mockLogin = await ctx.mock.invoke<{ token: string }>('/api/auth/login', { username, password }, null, {
        method: 'POST'
      });
      expect(mockLogin.code, username).toBe(0);
      const mockToken = mockLogin.code === 0 ? mockLogin.data.token : null;
      const realUser = login(ctx.db, ctx.sessions, { username, password }, `t-${username}`);
      const mockResult = await ctx.mock.invoke<PlanRiskReport>('/api/alerts/risks', {}, mockToken);
      const realResult = await ctx.router.invoke({ path: '/api/alerts/risks', token: realUser.token });
      expect(mockResult.code, username).toBe(0);
      expect(realResult.code, username).toBe(0);
    }
    ctx.db.close();
  });

  it('设置写：合法 / 越界 / 未知键 在两边给出同一个 code', async () => {
    const ctx = await setupBoth();
    const updates = [
      { 'ui.theme': 'dark' },
      { 'task.timeoutToleranceS': 999999 },
      { 'monitor.refreshInterval': 500 },
      { 'ui.theme': 42 }
    ];
    for (const item of updates) {
      const mockResult = await ctx.mock.invoke('/api/settings', { updates: item }, ctx.mockToken, { method: 'PATCH' });
      const realResult = await ctx.router.invoke({ path: '/api/settings', method: 'PATCH', payload: { updates: item }, token: ctx.token });
      expect(mockResult.code, JSON.stringify(item)).toBe(realResult.code);
    }
    ctx.db.close();
  });

  it('监控概览：任务 / 车辆 / 告警计数逐字段相同', async () => {
    const ctx = await setupBoth();
    const mockResult = await ctx.mock.invoke<Record<string, unknown>>('/api/monitor/overview', {}, ctx.mockToken);
    const realResult = await ctx.router.invoke({ path: '/api/monitor/overview', payload: {}, token: ctx.token });
    expect(mockResult.code).toBe(0);
    expect(realResult.code).toBe(0);
    if (mockResult.code === 0 && realResult.code === 0) {
      // 去掉 `updatedAt` / `eventSeq`：两边的时间与事件编号必然不同（Mock 是内存计数）
      const strip = (data: Record<string, unknown>) => {
        const copy = { ...data };
        delete copy.updatedAt;
        delete copy.eventSeq;
        return copy;
      };
      expect(strip(mockResult.data)).toEqual(strip(realResult.data as Record<string, unknown>));
    }
    ctx.db.close();
  });

  it('监控车辆列表：currentTaskId 在两边指向同一条任务', async () => {
    const ctx = await setupBoth();
    const mockResult = await ctx.mock.invoke<{ records: Array<{ code: string; currentTaskId: string | null }> }>(
      '/api/monitor/vehicles',
      { pageSize: 50 },
      ctx.mockToken
    );
    const realResult = await ctx.router.invoke({
      path: '/api/monitor/vehicles',
      payload: { pageSize: 50 },
      token: ctx.token
    });
    expect(mockResult.code).toBe(0);
    expect(realResult.code).toBe(0);
    if (mockResult.code === 0 && realResult.code === 0) {
      const agvOf = (records: Array<{ code: string; currentTaskId: string | null }>) =>
        records.find((row) => row.code === 'AGV-01')?.currentTaskId ?? null;
      expect(agvOf(mockResult.data.records)).toBe(agvOf((realResult.data as { records: Array<{ code: string; currentTaskId: string | null }> }).records));
    }
    ctx.db.close();
  });

  it('执行链路：start 之后两边都是 running，且轨迹点从 1 条起', async () => {
    // 两边的演示任务都是 `running`；为了测 start，先在**各自那一侧**把它改回「已派发」。
    // 主进程侧直接改库（`reassign` 会把车也回收，更贴近真实路径）；Mock 侧用同一个接口。
    const ctx = await setupBoth();
    const reassign = { reason: 'parity: 回到候选池以便重跑 start' };
    await ctx.router.invoke({ path: `/api/tasks/${SEED_IDS.demoTask}/reassign`, method: 'POST', payload: reassign, token: ctx.token });
    const mockReassign = await ctx.mock.invoke(`/api/tasks/${SEED_IDS.demoTask}/reassign`, reassign, ctx.mockToken, { method: 'POST' });
    expect(mockReassign.code).toBe(0);

    // 重新派发：预览拿 requestId，再带**同一个策略** apply（契约要求 apply 指定单一策略）
    const previewMock = await ctx.mock.invoke<{ requestId: string }>(
      '/api/dispatch/preview',
      { strategy: 'greedy', taskIds: [SEED_IDS.demoTask] },
      ctx.mockToken,
      { method: 'POST' }
    );
    expect(previewMock.code).toBe(0);
    const applyMock = await ctx.mock.invoke('/api/dispatch/apply', {
      requestId: (previewMock as { data: { requestId: string } }).data.requestId,
      strategy: 'greedy'
    }, ctx.mockToken, { method: 'POST' });
    expect(applyMock.code).toBe(0);

    const previewReal = await ctx.router.invoke({
      path: '/api/dispatch/preview',
      method: 'POST',
      payload: { strategy: 'greedy', taskIds: [SEED_IDS.demoTask] },
      token: ctx.token
    });
    const applyReal = await ctx.router.invoke({
      path: '/api/dispatch/apply',
      method: 'POST',
      payload: { requestId: (previewReal as { data: { requestId: string } }).data.requestId, strategy: 'greedy' },
      token: ctx.token
    });
    expect(applyReal.code).toBe(0);

    const mockStart = await ctx.mock.invoke<{ status: string; vehicleId: string }>(`/api/execution/tasks/${SEED_IDS.demoTask}/start`, {}, ctx.mockToken, { method: 'POST' });
    const realStart = await ctx.router.invoke({
      path: `/api/execution/tasks/${SEED_IDS.demoTask}/start`,
      method: 'POST',
      payload: {},
      token: ctx.token
    });
    expect(mockStart.code).toBe(realStart.code);
    expect(mockStart.code).toBe(0);
    if (mockStart.code === 0 && realStart.code === 0) {
      expect(mockStart.data.status).toBe((realStart.data as { status: string }).status);
      expect(mockStart.data.status).toBe('running');
    }

    /*
     * 轨迹按**实际被派到的那台车**取，不写死 AGV-01：
     * 重新派发后内核可能把这一单给别的空闲车（对照实测里给的正是 CAR-01），
     * 而写死车牌会让用例在「内核换了选择」时以「轨迹为空」的形式失败 ——
     * 那看起来像执行器的 bug，实际是测试假设错了。
     */
    const assignedVehicle = (realStart as { data: { vehicleId: string } }).data.vehicleId;
    const mockTracks = await ctx.mock.invoke<{ points: Array<{ taskId: string | null }> }>(
      `/api/map/tracks/${assignedVehicle}`,
      {},
      ctx.mockToken
    );
    const realTracks = await ctx.router.invoke({
      path: `/api/map/tracks/${assignedVehicle}`,
      payload: {},
      token: ctx.token
    });
    expect(mockTracks.code).toBe(0);
    expect(realTracks.code).toBe(0);
    if (mockTracks.code === 0 && realTracks.code === 0) {
      expect(mockTracks.data.points.length).toBeGreaterThan(0);
      expect((realTracks.data as { points: unknown[] }).points.length).toBeGreaterThan(0);
      expect(mockTracks.data.points[0]!.taskId).toBe(SEED_IDS.demoTask);
      expect((realTracks.data as { points: Array<{ taskId: string | null }> }).points[0]!.taskId).toBe(SEED_IDS.demoTask);
    }
    ctx.db.close();
  });

  it('用户列表：角色筛选与非法取值在两边一致', async () => {
    const ctx = await setupBoth();
    for (const payload of [{}, { role: 'admin' }, { role: 'root' }, { status: 'disabled' }]) {
      const mockResult = await ctx.mock.invoke('/api/users', payload, ctx.mockToken);
      const realResult = await ctx.router.invoke({ path: '/api/users', payload, token: ctx.token });
      expect(mockResult.code, JSON.stringify(payload)).toBe(realResult.code);
      if (mockResult.code === 0 && realResult.code === 0) {
        expect((mockResult.data as { total: number }).total).toBe((realResult.data as { total: number }).total);
      }
    }
    ctx.db.close();
  });

  it('用户写：建号 / 重名 / 禁用自己 / 重置密码 的 code 逐条相同', async () => {
    const ctx = await setupBoth();
    const create = { username: 'parity01', password: 'secret123', displayName: '对照账号', role: 'dispatcher' };
    const mockCreate = await ctx.mock.invoke<{ id: string }>('/api/users', create, ctx.mockToken, { method: 'POST' });
    const realCreate = await ctx.router.invoke({ path: '/api/users', method: 'POST', payload: create, token: ctx.token });
    expect(mockCreate.code).toBe(realCreate.code);
    expect(mockCreate.code).toBe(0);

    const duplicateMock = await ctx.mock.invoke('/api/users', create, ctx.mockToken, { method: 'POST' });
    const duplicateReal = await ctx.router.invoke({ path: '/api/users', method: 'POST', payload: create, token: ctx.token });
    expect(duplicateMock.code).toBe('USER.NAME_EXISTS');
    expect(duplicateReal.code).toBe('USER.NAME_EXISTS');

    // 禁用自己：两边都拒绝（seed-admin 是当前会话）
    const selfMock = await ctx.mock.invoke('/api/users/seed-admin/status', { status: 'disabled' }, ctx.mockToken, { method: 'PATCH' });
    const selfReal = await ctx.router.invoke({
      path: '/api/users/seed-admin/status',
      method: 'PATCH',
      payload: { status: 'disabled' },
      token: ctx.token
    });
    expect(selfMock.code).toBe(selfReal.code);
    expect(selfMock.code).toBe('VALIDATION.FAILED');

    // 重置密码
    const resetMock = await ctx.mock.invoke('/api/users/seed-monitor/reset-password', { password: 'brandnew123' }, ctx.mockToken, { method: 'POST' });
    const resetReal = await ctx.router.invoke({
      path: '/api/users/seed-monitor/reset-password',
      method: 'POST',
      payload: { password: 'brandnew123' },
      token: ctx.token
    });
    expect(resetMock.code).toBe(resetReal.code);
    expect(resetMock.code).toBe(0);
    ctx.db.close();
  });

  it('审计导出：两边的 CSV 都带 BOM 与同一套表头', async () => {
    const ctx = await setupBoth();
    const mockResult = await ctx.mock.invoke<{ filename: string; content: string }>('/api/audit/logs/export', {}, ctx.mockToken);
    const realResult = await ctx.router.invoke({
      path: '/api/audit/logs/export',
      payload: {},
      token: ctx.token
    });
    expect(mockResult.code).toBe(0);
    expect(realResult.code).toBe(0);
    if (mockResult.code === 0 && realResult.code === 0) {
      const header = (text: string) => text.replace('\uFEFF', '').split('\r\n')[0];
      expect(header(mockResult.data.content)).toBe(header((realResult.data as { content: string }).content));
    }
    ctx.db.close();
  });
});

/**
 * 剥掉**墙钟量**后再比。
 *
 * 调度预览里有两类时间量两边必然不同值，而它们都不是算法结论：
 * 1. `summary.elapsedMs`（算法耗时）与 `explain` 文案里的「耗时 Nms」——
 *    两次运行本来就该差几个毫秒；
 * 2. `explain`（人读解释文案）——**这是写在明处的有意差异**（`mock-dispatch.ts` 文件头第 1 条）：
 *    Mock 侧恒为空数组，它的唯一作者是主进程的 `domain/dispatch/explain.ts`。
 *    差异无害的前提是「渲染层不读它」，因此下面单独把这条前提也断言了一次
 *    （`renderer/` 下除测试与 mock 适配器自身外，没有任何源码读取该字段）。
 * 3. 计划占用区间的**毫秒位**（`occupiedFrom` / `occupiedTo`）——
 *    它们以「预览的此刻」为基准算出来，Mock 与主进程各调一次 `Date.now()`，
 *    相差 3 ms 就会让整串相等断言失败。**秒级必须相同**，毫秒级不算事实。
 *
 * 其余字段（计划本身、里程、代价、拒绝原因、完成时刻）都必须逐字相同 ——
 * 它们才是「浏览器里看到的对比结论」与「Electron 里看到的」是否同一个方案的判据。
 */
function normalize(strategies: readonly StrategyResult[]): unknown {
  return JSON.parse(
    JSON.stringify(strategies)
      .replace(/"elapsedMs":\d+/g, '"elapsedMs":0')
      .replace(/"explain":\[[^\]]*\]/g, '"explain":[]')
      // ISO 时间戳只保留到秒：`.609Z` → `Z`
      .replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.\d{3}Z/g, '$1Z')
  );
}

describe('mock 适配器 · 调度对比与接力（M4）两边一致', () => {
  async function setupBoth() {
    const real = setupRealRouter();
    const mock = createMockAdapter();
    const loginResult = await mock.invoke<{ token: string }>('/api/auth/login', {
      username: 'admin',
      password: 'admin123'
    }, null, { method: 'POST' });
    expect(loginResult.code).toBe(0);
    const mockToken = loginResult.code === 0 ? loginResult.data.token : null;
    return { ...real, mock, mockToken };
  }

  /**
   * 这条用例锁的是**调度中心那一屏**的两件事：
   * 1. 「全部（对比）」是同一个算法内核的两个输出，Mock 与主进程必须逐字节相同
   *    （差异文案、里程、完成时刻都是从这里派生的，一边不同就会让浏览器与
   *    Electron 给出不同的推荐结论）；
   * 2. **接力**（同一台车在这批里跑两单）两边都得出现 —— 它正是「贪心 vs 匈牙利」
   *    有结论的原因（见 `SEED_IDS.pendingTasks` 的注释）。
   */
  it('/api/dispatch/preview?strategy=all：两条策略的计划 / 拒绝 / 小结逐字段相同，且「接力」两边都在', async () => {
    const ctx = await setupBoth();
    const payload = { taskIds: [...SEED_IDS.pendingTasks], strategy: 'all' };
    const mockResult = await ctx.mock.invoke<{ requestId: string; strategies: StrategyResult[] }>(
      '/api/dispatch/preview',
      payload,
      ctx.mockToken,
      { method: 'POST' }
    );
    const realResult = await ctx.router.invoke({ path: '/api/dispatch/preview', method: 'POST', payload, token: ctx.token });
    expect(mockResult.code).toBe(0);
    expect(realResult.code).toBe(0);
    if (mockResult.code !== 0 || realResult.code !== 0) {
      ctx.db.close();
      return;
    }

    const mockStrategies = mockResult.data.strategies;
    const realStrategies = (realResult.data as { strategies: StrategyResult[] }).strategies;
    expect(mockStrategies.map((item) => item.strategy)).toEqual(realStrategies.map((item) => item.strategy));
    expect(mockStrategies.map((item) => item.strategy)).toEqual(['greedy', 'hungarian']);
    expect(normalize(mockStrategies)).toEqual(normalize(realStrategies));

    /*
     * `explain` 是**写在明处的有意差异**（`mock-dispatch.ts` 文件头第 1 条）：
     * Mock 恒为空数组，唯一作者是主进程的 `explain.ts`。这里把它断言出来，
     * 而不是让它躲在 normalize 后面 —— 有意差异一旦没人看着，就会变成「两边都有」
     * （两个人各拼一份中文），而那正是项目反复踩到的漂移形态。
     */
    expect(mockStrategies.every((item) => item.explain.length === 0)).toBe(true);
    expect(realStrategies.every((item) => item.explain.length > 0)).toBe(true);

    /**
     * 接力断言：贪心里必须有一台车带 2 条计划，而两条计划的占用区间**不重叠**
     * （重叠就是「同一台车同一时刻跑两单」，是内核级错误，不是文案问题）。
     * 匈牙利是整体匹配，一辆车只接一单，因此这里只对贪心断言。
     */
    const greedy = mockStrategies[0] as { plans: Array<{ vehicleId: string; occupiedFrom: string; occupiedTo: string }> };
    const byVehicle = new Map<string, Array<{ occupiedFrom: string; occupiedTo: string }>>();
    for (const plan of greedy.plans) {
      const list = byVehicle.get(plan.vehicleId) ?? [];
      list.push({ occupiedFrom: plan.occupiedFrom, occupiedTo: plan.occupiedTo });
      byVehicle.set(plan.vehicleId, list);
    }
    const relay = [...byVehicle.values()].filter((list) => list.length > 1);
    expect(relay.length, '演示数据里必须有接力，否则对比屏没有可看的内容').toBeGreaterThan(0);
    for (const list of relay) {
      const sorted = [...list].sort((a, b) => Date.parse(a.occupiedFrom) - Date.parse(b.occupiedFrom));
      for (let i = 1; i < sorted.length; i += 1) {
        expect(Date.parse(sorted[i]!.occupiedFrom)).toBeGreaterThanOrEqual(Date.parse(sorted[i - 1]!.occupiedTo));
      }
    }
    ctx.db.close();
  });

  it('对比表的一行（里程 / 行驶耗时 / 完成时刻 / 用车 / 差异文案）在两边逐字相同', async () => {
    const ctx = await setupBoth();
    const payload = { taskIds: [...SEED_IDS.pendingTasks], strategy: 'all' };
    const mockResult = await ctx.mock.invoke<{ strategies: StrategyResult[] }>('/api/dispatch/preview', payload, ctx.mockToken, { method: 'POST' });
    const realResult = await ctx.router.invoke({ path: '/api/dispatch/preview', method: 'POST', payload, token: ctx.token });
    if (mockResult.code !== 0 || realResult.code !== 0) {
      ctx.db.close();
      return;
    }
    const realStrategies = (realResult.data as { strategies: StrategyResult[] }).strategies;
    const recommended = recommendationOf(mockResult.data.strategies).strategy;

    // 对比表：整行逐字段比（`elapsedMs` 是墙钟耗时，取出后单独丢弃）
    const rowsOf = (list: StrategyResult[]) =>
      list.map((item) => {
        const { elapsedMs: _elapsed, ...rest } = outcomeRowOf(item, recommended);
        return rest;
      });
    expect(rowsOf(mockResult.data.strategies)).toEqual(rowsOf(realStrategies));

    // 差异行：文案里带的是「少跑 680 m」「早 12 分 2 秒完成」这类可核对的数字
    const diffsOf = (list: StrategyResult[]) => differenceLinesOf(list, recommended).map((line) => line.text);
    expect(diffsOf(mockResult.data.strategies)).toEqual(diffsOf(realStrategies));
    expect(diffsOf(mockResult.data.strategies).length).toBeGreaterThan(0);

    // 至少在「里程 / 完成时刻」里有一个维度两边不同，否则这张对比表什么也没比出来
    const distinct = new Set(rowsOf(mockResult.data.strategies).map((row) => `${row.distance}|${row.finishAt}`));
    expect(distinct.size).toBeGreaterThan(1);
    ctx.db.close();
  });
});

/**
 * 「Mock 的 `explain` 恒为空」之所以无害，只因为它**没有消费者**。
 *
 * 这条护栏把那个前提变成断言：`renderer/` 下除了 Mock 适配器自己（要按契约把字段
 * 填成空数组）与测试之外，没有源码读取该字段。哪天有人在界面上渲染了 `explain`，
 * 浏览器形态会静默少一段文字（Mock 空数组不会报错），先在这里红。
 */
describe('渲染层不消费 explain（Mock 与主进程的有意差异的前提）', () => {
  it('renderer/src 下除 mock 适配器与测试外，没有源码读取策略解释文案', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(process.cwd(), 'renderer/src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) files.push(full);
      }
    };
    walk(root);

    const offenders = files.filter((file) => {
      if (file.endsWith('api/mock-dispatch.ts')) return false; // 契约要求它产出该字段（空数组）
      // 只看**取值**：注释里提到 `explain.ts` 不算消费
      return /\.explain\b/.test(readFileSync(file, 'utf8'));
    });
    expect(offenders, `这些文件开始读取 explain：${offenders.join(', ')}`).toEqual([]);
  });
});
