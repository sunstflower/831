import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditContext, DomainError } from '@udm/shared';
import { campusEdgeId, campusNodeId } from '@udm/shared';
import { openDatabase, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { seedDatabase } from '../../db/seed.js';
import { all } from '../../db/index.js';
import { createEdge, createNode, setEdgeStatus, setNodeStatus, updateEdge, updateNode } from './graph.service.js';
import { createSite, setSiteStatus, updateSite } from './site.service.js';
import { createRestriction, deleteRestriction, updateRestriction } from './restriction.service.js';
import { createTemplate, updateTemplate } from './template.service.js';
import { createVehicle, setVehicleStatus, updateVehicle } from './vehicle.service.js';
import type { CrudContext } from './context.js';

/**
 * M2 写路径的**服务层**行为。
 *
 * 这层要证明的不是「SQL 能跑」，而是四件事：
 *   1. **错误码选对了**（前端按 code 分支，选错就等于给了错的引导）；
 *   2. **审计写下来了**，且 `before` / `after` 都在（否则「谁改了什么」无法追溯）；
 *   3. **事务边界**：失败时不留半条数据；
 *   4. **幂等**：重复点「停用」不该产生第二条 disable 审计。
 */
const ACTOR: AuditContext = { actorId: 'seed-admin', actorName: 'admin', role: 'admin', traceId: 'trace-test' };

function setup(): { db: Db; ctx: CrudContext } {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  return { db, ctx: { db, actor: ACTOR } };
}

/** 取审计行（按时间倒序不稳定 —— 同一毫秒内多行，故按 module+action 过滤后看集合）。 */
function audits(db: Db, action: string) {
  return all<{ action: string; object_type: string; object_id: string; before: string | null; after: string | null; actor_name: string | null; trace_id: string | null }>(
    db,
    'SELECT action, object_type, object_id, before, after, actor_name, trace_id FROM audit_logs WHERE action = ?',
    [action]
  );
}

function expectDomainError(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (error) {
    const domainError = error as DomainError;
    expect(domainError.code).toBe(code);
    return domainError;
  }
  throw new Error(`期望抛出 ${code}，但没有抛`);
}

describe('site.service', () => {
  let db: Db;
  let ctx: CrudContext;
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('创建：坐标缺省时**跟随绑定节点**（不写 0,0 那种假坐标）', () => {
    const node = createNode(ctx, { code: 'N90', name: '新节点', x: 77, y: 88 });
    const site = createSite(ctx, { code: 'S-90', name: '新站点', type: 'depot', nodeId: node.id });
    expect(site.x).toBe(77);
    expect(site.y).toBe(88);
    expect(site.status).toBe('enabled');
  });

  it('创建：显式坐标优先于节点坐标（允许站点偏离节点）', () => {
    const node = createNode(ctx, { code: 'N91', name: '新节点', x: 10, y: 10 });
    const site = createSite(ctx, { code: 'S-91', name: 'S', type: 'dock', nodeId: node.id, x: 99, y: 0 });
    expect({ x: site.x, y: site.y }).toEqual({ x: 99, y: 0 });
  });

  it('创建：编码重复返回 BASE.CODE_EXISTS，且带上冲突对象的 id', () => {
    const first = createSite(ctx, { code: 'S-92', name: 'S', type: 'depot' });
    const error = expectDomainError(() => createSite(ctx, { code: 'S-92', name: 'S2', type: 'depot' }), 'BASE.CODE_EXISTS');
    expect(error.detail).toMatchObject({ code: 'S-92', kind: 'site', id: first.id });
  });

  it('创建：节点不存在返回 NODE.NOT_FOUND（而不是静默忽略那个绑定）', () => {
    expectDomainError(() => createSite(ctx, { code: 'S-93', name: 'S', type: 'depot', nodeId: 'no-such' }), 'NODE.NOT_FOUND');
  });

  it('创建：字段非法时一次报出所有问题字段', () => {
    const error = expectDomainError(() => createSite(ctx, { code: '', name: 'S', type: 'depot', x: 'abc' }), 'VALIDATION.FAILED');
    expect(Object.keys((error.detail?.['fields'] ?? {}) as object).sort()).toEqual(['code', 'x']);
  });

  it('创建：写审计，且 after 是完整对象、before 为空', () => {
    const site = createSite(ctx, { code: 'S-94', name: 'S', type: 'depot' });
    const rows = audits(db, 'create').filter((row) => row.object_id === site.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ object_type: 'site', actor_name: 'admin', trace_id: 'trace-test', before: null });
    expect(JSON.parse(rows[0]!.after ?? '{}')).toMatchObject({ code: 'S-94' });
  });

  it('更新：改 code 被拒（编码是不可变的持久键）', () => {
    const site = createSite(ctx, { code: 'S-95', name: 'S', type: 'depot' });
    expectDomainError(() => updateSite(ctx, site.id, { code: 'S-96' }), 'VALIDATION.FAILED');
  });

  it('更新：换绑节点时坐标跟着走（否则站点会留在旧节点上）', () => {
    const a = createNode(ctx, { code: 'N92', name: 'A', x: 0, y: 0 });
    const b = createNode(ctx, { code: 'N93', name: 'B', x: 50, y: 60 });
    const site = createSite(ctx, { code: 'S-97', name: 'S', type: 'depot', nodeId: a.id });
    const moved = updateSite(ctx, site.id, { nodeId: b.id });
    expect({ x: moved.x, y: moved.y }).toEqual({ x: 50, y: 60 });
  });

  it('更新：只改备注**不动**坐标（不把手工调过的坐标拉回节点位置）', () => {
    const node = createNode(ctx, { code: 'N94', name: 'A', x: 0, y: 0 });
    const site = createSite(ctx, { code: 'S-98', name: 'S', type: 'depot', nodeId: node.id, x: 5, y: 5 });
    const updated = updateSite(ctx, site.id, { remark: '只改备注' });
    expect({ x: updated.x, y: updated.y }).toEqual({ x: 5, y: 5 });
    expect(updated.remark).toBe('只改备注');
  });

  it('更新：审计里 before / after 都在（可对比出改了什么）', () => {
    const site = createSite(ctx, { code: 'S-99', name: '旧名', type: 'depot' });
    updateSite(ctx, site.id, { name: '新名' });
    const row = audits(db, 'update').find((item) => item.object_id === site.id)!;
    expect(JSON.parse(row.before ?? '{}')).toMatchObject({ name: '旧名' });
    expect(JSON.parse(row.after ?? '{}')).toMatchObject({ name: '新名' });
  });

  it('启停：动作名区分 enable / disable，状态真的落库', () => {
    const site = createSite(ctx, { code: 'S-100', name: 'S', type: 'depot' });
    expect(setSiteStatus(ctx, site.id, 'disabled').status).toBe('disabled');
    expect(setSiteStatus(ctx, site.id, 'enabled').status).toBe('enabled');
    expect(audits(db, 'disable').some((row) => row.object_id === site.id)).toBe(true);
    expect(audits(db, 'enable').some((row) => row.object_id === site.id)).toBe(true);
  });

  it('启停：重复设置同一状态是幂等的，不产生第二条审计', () => {
    const site = createSite(ctx, { code: 'S-101', name: 'S', type: 'depot' });
    setSiteStatus(ctx, site.id, 'disabled');
    setSiteStatus(ctx, site.id, 'disabled');
    expect(audits(db, 'disable').filter((row) => row.object_id === site.id)).toHaveLength(1);
  });

  it('启停：非法取值返回 VALIDATION.FAILED（不是悄悄当成 enabled）', () => {
    const site = createSite(ctx, { code: 'S-102', name: 'S', type: 'depot' });
    expectDomainError(() => setSiteStatus(ctx, site.id, 'paused' as never), 'VALIDATION.FAILED');
  });
});

describe('vehicle.service', () => {
  let db: Db;
  let ctx: CrudContext;
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('创建：status 固定 idle、online 为 0、battery 缺省 100', () => {
    const vehicle = createVehicle(ctx, {
      code: 'V-90',
      name: '新车',
      type: 'agv',
      capacityKg: 300,
      maxSpeedMps: 1.2,
      x: 1,
      y: 2
    });
    expect(vehicle).toMatchObject({ status: 'idle', online: false, battery: 100, loadKg: 0, currentNodeId: null });
  });

  it('创建：编码重复 → BASE.CODE_EXISTS；车辆域与站点域**不互相占名**', () => {
    createVehicle(ctx, { code: 'V-91', name: 'V', type: 'agv', capacityKg: 1, maxSpeedMps: 1, x: 0, y: 0 });
    expectDomainError(
      () => createVehicle(ctx, { code: 'V-91', name: 'V', type: 'agv', capacityKg: 1, maxSpeedMps: 1, x: 0, y: 0 }),
      'BASE.CODE_EXISTS'
    );
    // 同名不同表允许：`sites` 与 `vehicles` 是两个编码空间
    const site = createSite(ctx, { code: 'V-91', name: '同名站点', type: 'depot' });
    expect(site.code).toBe('V-91');
  });

  it('更新：载重上限与最高车速必须为正，battery 限 [0,100]', () => {
    const vehicle = createVehicle(ctx, { code: 'V-92', name: 'V', type: 'agv', capacityKg: 10, maxSpeedMps: 1, x: 0, y: 0 });
    expectDomainError(() => updateVehicle(ctx, vehicle.id, { capacityKg: 0 }), 'VALIDATION.FAILED');
    expectDomainError(() => updateVehicle(ctx, vehicle.id, { battery: 101 }), 'VALIDATION.FAILED');
  });

  it('启停：驳回执行器专管的状态（reserved / busy / charging…）', () => {
    const vehicle = createVehicle(ctx, { code: 'V-93', name: 'V', type: 'agv', capacityKg: 10, maxSpeedMps: 1, x: 0, y: 0 });
    for (const status of ['busy', 'reserved', 'charging', 'offline', 'fault']) {
      const error = expectDomainError(() => setVehicleStatus(ctx, vehicle.id, status as never), 'VALIDATION.FAILED');
      expect(String((error.detail?.['fields'] as Record<string, string>)['status'])).toContain('idle');
    }
  });

  it('启停：占用中的车（busy / reserved）不许停用 → VEHICLE.STATE_CONFLICT', () => {
    const vehicle = createVehicle(ctx, { code: 'V-94', name: 'V', type: 'agv', capacityKg: 10, maxSpeedMps: 1, x: 0, y: 0 });
    db.prepare('UPDATE vehicles SET status = ? WHERE id = ?').run('busy', vehicle.id);
    expectDomainError(() => setVehicleStatus(ctx, vehicle.id, 'disabled'), 'VEHICLE.STATE_CONFLICT');
  });

  it('启停：空闲车可停用，再启用时目标状态固定为 idle（不是「恢复停用前」）', () => {
    const vehicle = createVehicle(ctx, { code: 'V-95', name: 'V', type: 'agv', capacityKg: 10, maxSpeedMps: 1, x: 0, y: 0 });
    expect(setVehicleStatus(ctx, vehicle.id, 'disabled').status).toBe('disabled');
    expect(setVehicleStatus(ctx, vehicle.id, 'idle').status).toBe('idle');
    // 审计的 action 用 enable / disable，而不是把状态名当动作名 —— 否则前端按动作筛日志要记七个词
    expect(audits(db, 'disable').some((row) => row.object_id === vehicle.id)).toBe(true);
    expect(audits(db, 'enable').some((row) => row.object_id === vehicle.id)).toBe(true);
  });

  it('创建：给了所在节点、没给坐标 → 坐标跟随该节点（与站点同一口径）', () => {
    const node = campusNodeId('N13');
    const vehicle = createVehicle(ctx, {
      code: 'V-97',
      name: '落点车',
      type: 'carrier',
      capacityKg: 500,
      maxSpeedMps: 3,
      currentNodeId: node
    });
    const row = db.prepare('SELECT x, y FROM nodes WHERE id = ?').get(node) as { x: number; y: number };
    expect(vehicle).toMatchObject({ currentNodeId: node, x: row.x, y: row.y });
  });

  it('创建：显式坐标优先于节点坐标（两份都给时以坐标为准）', () => {
    const vehicle = createVehicle(ctx, {
      code: 'V-98',
      name: '中间车',
      type: 'carrier',
      capacityKg: 500,
      maxSpeedMps: 3,
      currentNodeId: campusNodeId('N13'),
      x: 123,
      y: 45
    });
    expect(vehicle).toMatchObject({ currentNodeId: campusNodeId('N13'), x: 123, y: 45 });
  });

  it('创建：节点不存在 → NODE.NOT_FOUND 并指到 currentNodeId 字段', () => {
    const error = expectDomainError(
      () =>
        createVehicle(ctx, {
          code: 'V-99',
          name: '野车',
          type: 'carrier',
          capacityKg: 500,
          maxSpeedMps: 3,
          currentNodeId: 'seed-n-NOT-EXIST'
        }),
      'NODE.NOT_FOUND'
    );
    expect((error.detail as Record<string, unknown>)['currentNodeId']).toBe('seed-n-NOT-EXIST');
  });

  it('创建：既没有坐标也没有节点 → 两个字段一起报必填（一辆没有位置的车无法被调度）', () => {
    const error = expectDomainError(
      () => createVehicle(ctx, { code: 'V-100', name: '无位置车', type: 'carrier', capacityKg: 500, maxSpeedMps: 3 }),
      'VALIDATION.FAILED'
    );
    const fields = (error.detail as Record<string, Record<string, string>>)['fields']!;
    expect(fields['x']).toBeDefined();
    expect(fields['y']).toBeDefined();
  });

  it('更新：只改所在节点时坐标跟着走；只改坐标时不动所在节点', () => {
    const vehicle = createVehicle(ctx, { code: 'V-101', name: 'V', type: 'agv', capacityKg: 10, maxSpeedMps: 1, x: 0, y: 0 });
    const moved = updateVehicle(ctx, vehicle.id, { currentNodeId: campusNodeId('N22') });
    const row = db.prepare('SELECT x, y FROM nodes WHERE id = ?').get(campusNodeId('N22')) as { x: number; y: number };
    expect(moved).toMatchObject({ currentNodeId: campusNodeId('N22'), x: row.x, y: row.y });

    const nudged = updateVehicle(ctx, vehicle.id, { x: 7, y: 8 });
    expect(nudged).toMatchObject({ currentNodeId: campusNodeId('N22'), x: 7, y: 8 });
  });

  it('启停：不修改 online（心跳是通信事实，管理接口不得代为声明）', () => {
    const vehicle = createVehicle(ctx, { code: 'V-96', name: 'V', type: 'agv', capacityKg: 10, maxSpeedMps: 1, x: 0, y: 0 });
    setVehicleStatus(ctx, vehicle.id, 'disabled');
    setVehicleStatus(ctx, vehicle.id, 'idle');
    const row = db.prepare('SELECT online FROM vehicles WHERE id = ?').get(vehicle.id) as { online: number };
    expect(row.online).toBe(0);
  });
});

describe('graph.service · 节点', () => {
  let db: Db;
  let ctx: CrudContext;
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('创建一个孤立节点 → 可禁用；被边引用的节点 → BASE.NODE_IN_USE（并报出引用数）', () => {
    const isolated = createNode(ctx, { code: 'N95', name: '孤立', x: 999, y: 999 });
    expect(setNodeStatus(ctx, isolated.id, 'disabled').status).toBe('disabled');

    // seed 的 N01 被边与站点引用着
    const referenced = all<{ id: string }>(db, "SELECT id FROM nodes WHERE code = 'N01'")[0]!;
    const error = expectDomainError(() => setNodeStatus(ctx, referenced.id, 'disabled'), 'BASE.NODE_IN_USE');
    expect((error.detail?.['edges'] as number) ?? 0).toBeGreaterThan(0);
    expect((error.detail?.['sites'] as number) ?? 0).toBeGreaterThan(0);
  });

  it('更新：传 code 被拒；坐标可为负（平面坐标系无象限限制）', () => {
    const node = createNode(ctx, { code: 'N96', name: 'N', x: 0, y: 0 });
    expectDomainError(() => updateNode(ctx, node.id, { code: 'N97' }), 'VALIDATION.FAILED');
    expect({ x: updateNode(ctx, node.id, { x: -10, y: -20 }).x, y: updateNode(ctx, node.id, { x: -10, y: -20 }).y }).toEqual({
      x: -10,
      y: -20
    });
  });

  it('创建：编码重复 → BASE.CODE_EXISTS', () => {
    createNode(ctx, { code: 'N98', name: 'N', x: 0, y: 0 });
    expectDomainError(() => createNode(ctx, { code: 'N98', name: 'N', x: 0, y: 0 }), 'BASE.CODE_EXISTS');
  });
});

describe('graph.service · 边', () => {
  let db: Db;
  let ctx: CrudContext;
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  function pair(codeA: string, codeB: string, xb = 30, yb = 40) {
    const a = createNode(ctx, { code: codeA, name: codeA, x: 0, y: 0 });
    const b = createNode(ctx, { code: codeB, name: codeB, x: xb, y: yb });
    return { a, b };
  }

  it('创建：边长缺省按欧氏距离推导（3-4-5）', () => {
    const { a, b } = pair('N60', 'N61', 30, 40);
    const edge = createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id });
    expect(edge.lengthM).toBeCloseTo(50, 6);
    // code 由两端 code 推导：字典序小的一侧在前
    expect(edge.code).toBe('E_N60_N61');
    expect({ from: edge.fromNodeCode, to: edge.toNodeCode }).toEqual({ from: 'N60', to: 'N61' });
  });

  it('创建：反向边另有一条记录（有向图，反向不是同一条）', () => {
    const { a, b } = pair('N62', 'N63');
    createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id });
    const reverse = createEdge(ctx, { fromNodeId: b.id, toNodeId: a.id });
    expect(reverse.fromNodeId).toBe(b.id);
    expect(reverse.toNodeId).toBe(a.id);
  });

  it('创建：重复方向对 → BASE.CODE_EXISTS（方向对唯一，复用编码重复那个码）', () => {
    const { a, b } = pair('N64', 'N65');
    createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id });
    const error = expectDomainError(() => createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id }), 'BASE.CODE_EXISTS');
    expect(error.detail).toMatchObject({ kind: 'edge' });
  });

  it('创建：自环在服务层被拦为 VALIDATION.FAILED（不让它撞到 DDL 的 CHECK）', () => {
    const node = createNode(ctx, { code: 'N66', name: 'N', x: 0, y: 0 });
    expectDomainError(() => createEdge(ctx, { fromNodeId: node.id, toNodeId: node.id }), 'VALIDATION.FAILED');
  });

  it('创建：端点不存在 → NODE.NOT_FOUND；两端都缺时一次报两个字段', () => {
    const node = createNode(ctx, { code: 'N67', name: 'N', x: 0, y: 0 });
    expectDomainError(() => createEdge(ctx, { fromNodeId: 'ghost', toNodeId: node.id }), 'NODE.NOT_FOUND');
    const error = expectDomainError(() => createEdge(ctx, { fromNodeId: 'ghost', toNodeId: 'ghost2' }), 'NODE.NOT_FOUND');
    expect(Object.keys((error.detail ?? {}) as object).sort()).toEqual(['fromNodeId', 'toNodeId']);
  });

  it('创建：自定义 code 与推导值不符时被拒（静默丢弃 = 使用者以为生效了）', () => {
    const { a, b } = pair('N68', 'N69');
    expectDomainError(() => createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id, code: 'E_X_Y' }), 'VALIDATION.FAILED');
    // 与推导值一致则接受（幂等写法，便于调用方显式回填）
    expect(createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id, code: 'E_N68_N69' }).code).toBe('E_N68_N69');
  });

  it('创建：两端坐标重合导致推导不出正长度时，明确报错而不是写 0', () => {
    const a = createNode(ctx, { code: 'N70', name: 'A', x: 5, y: 5 });
    const b = createNode(ctx, { code: 'N71', name: 'B', x: 5, y: 5 });
    const error = expectDomainError(() => createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id }), 'VALIDATION.FAILED');
    expect(String((error.detail?.['fields'] as Record<string, string>)['lengthM'])).toContain('重合');
    // 手工指定边长即可绕过（使用者知道这是两条不同高度的通道）
    expect(createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id, lengthM: 3 }).lengthM).toBe(3);
  });

  it('更新：换端点后**重新推导**边长（旧长度是按旧端点算的，已失效）', () => {
    const { a, b } = pair('N72', 'N73', 30, 40);
    const c = createNode(ctx, { code: 'N74', name: 'C', x: 6, y: 8 });
    const edge = createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id });
    expect(edge.lengthM).toBeCloseTo(50, 6);
    const updated = updateEdge(ctx, edge.id, { toNodeId: c.id });
    expect(updated.lengthM).toBeCloseTo(10, 6);
  });

  it('更新：显式给了 lengthM 就用手工值（不被推导覆盖）', () => {
    const { a, b } = pair('N75', 'N76', 30, 40);
    const c = createNode(ctx, { code: 'N77', name: 'C', x: 6, y: 8 });
    const edge = createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id });
    expect(updateEdge(ctx, edge.id, { toNodeId: c.id, lengthM: 42 }).lengthM).toBe(42);
  });

  it('更新：只改一端时，与另一端组合出的自环也会被拦', () => {
    const { a, b } = pair('N78', 'N79');
    const edge = createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id });
    expectDomainError(() => updateEdge(ctx, edge.id, { toNodeId: a.id }), 'VALIDATION.FAILED');
  });

  it('封路：状态与审计都写下来（可达性会变，地图据此重画）', () => {
    const { a, b } = pair('N80', 'N81');
    const edge = createEdge(ctx, { fromNodeId: a.id, toNodeId: b.id });
    expect(setEdgeStatus(ctx, edge.id, 'disabled').status).toBe('disabled');
    expect(audits(db, 'disable').some((row) => row.object_id === edge.id)).toBe(true);
  });
});

/**
 * 禁行规则（§3.2.5）。
 *
 * 这层独有的三个断言点：
 *   1. 目标是**多态**引用 —— 用 `node` 规则指向一个边的 id 必须被拒（反之亦然）；
 *   2. 时间窗是**跨字段**比较 —— 只传 `endAt` 时要与库里的 `startAt` 配对判；
 *   3. 删除是**物理**删除 —— 行真的没了，但审计里留着（这正是「允许真删」仍然可控的原因）。
 */
describe('restriction.service', () => {
  // 用地图包里真实存在的边（`N01 → N02`）与节点；写错 id 的用例在下面单独覆盖
  const edgeId = campusEdgeId('E_N01_N02');
  const nodeId = campusNodeId('N01');

  it('创建：默认 active，targetCode 是派生的，created_by 取自会话', () => {
    const { db, ctx } = setup();
    const created = createRestriction(ctx, { type: 'edge', targetId: edgeId, reason: '施工' });
    expect(created).toMatchObject({ type: 'edge', targetCode: 'E_N01_N02', status: 'active', createdBy: 'seed-admin' });
    const rows = audits(db, 'create');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ object_type: 'restriction', object_id: created.id, trace_id: 'trace-test' });
    // after 里有完整的新值（真删之后审计是唯一的追溯依据，因此这里必须存全）
    expect(JSON.parse(rows[0]!.after!)).toMatchObject({ id: created.id, reason: '施工' });
  });

  it('目标必须存在，且必须与 type 匹配（多态引用的经典错法）', () => {
    const { db, ctx } = setup();
    // 节点 id 出现在 edge 规则里：两边都是「目标不存在」，但只有这条能拦住「类型选错」
    expectDomainError(() => createRestriction(ctx, { type: 'node', targetId: edgeId, reason: 'x' }), 'MAP.RESTRICTION_TARGET_NOT_FOUND');
    expectDomainError(() => createRestriction(ctx, { type: 'edge', targetId: nodeId, reason: 'x' }), 'MAP.RESTRICTION_TARGET_NOT_FOUND');
    expectDomainError(() => createRestriction(ctx, { type: 'node', targetId: 'ghost', reason: 'x' }), 'MAP.RESTRICTION_TARGET_NOT_FOUND');
  });

  it('时间窗倒挂 → 字段级 VALIDATION.FAILED（而不是撞 DDL 的 CHECK 报 SYS.INTERNAL）', () => {
    const { db, ctx } = setup();
    expectDomainError(
      () =>
        createRestriction(ctx, {
          type: 'node',
          targetId: nodeId,
          reason: 'x',
          startAt: '2026-09-27T10:00:00.000Z',
          endAt: '2026-09-27T09:00:00.000Z'
        }),
      'VALIDATION.FAILED'
    );
  });

  it('更新：只传 endAt 时与**库里的** startAt 配对判（跨字段校验只有服务层做得到）', () => {
    const { db, ctx } = setup();
    const created = createRestriction(ctx, { type: 'node', targetId: nodeId, reason: 'x', startAt: '2026-09-27T10:00:00.000Z' });
    // 库里 startAt = 10:00，把 endAt 改到 09:00 必须被拒
    expectDomainError(() => updateRestriction(ctx, created.id, { endAt: '2026-09-27T09:00:00.000Z' }), 'VALIDATION.FAILED');
    const ok = updateRestriction(ctx, created.id, { endAt: '2026-09-27T11:00:00.000Z' });
    expect(ok.endAt).toBe('2026-09-27T11:00:00.000Z');
  });

  it('更新：改 type 时会重判目标；置为 expired 记 disable 而不是 update', () => {
    const { db, ctx } = setup();
    const created = createRestriction(ctx, { type: 'node', targetId: nodeId, reason: 'x' });
    // 只改 type 不改 targetId：新类型下那个 id 不存在 → 必须被拒
    expectDomainError(() => updateRestriction(ctx, created.id, { type: 'edge' }), 'MAP.RESTRICTION_TARGET_NOT_FOUND');
    updateRestriction(ctx, created.id, { type: 'edge', targetId: edgeId });
    const expired = updateRestriction(ctx, created.id, { status: 'expired' });
    expect(expired).toMatchObject({ status: 'expired', targetCode: 'E_N01_N02' });
    // 失效走的是 disable 动作：按 action='disable' 查「谁停用了它」时必须能查到这条规则
    expect(audits(db, 'disable').map((row) => row.object_id)).toEqual([created.id]);
    // before/after 都在（只存一半就无法回答「它原来是什么状态」）
    expect(audits(db, 'disable')[0]!.before).toContain('"status":"active"');
    expect(audits(db, 'disable')[0]!.after).toContain('"status":"expired"');
  });

  it('删除是**物理**删除：行没了，但审计留着（before 里有完整的被删对象）', () => {
    const { db, ctx } = setup();
    const created = createRestriction(ctx, { type: 'node', targetId: nodeId, reason: '临停' });
    const result = deleteRestriction(ctx, created.id);
    expect(result).toEqual({ id: created.id, deleted: true });
    // seed 自带 2 条占道规则，因此断言「这一行没了」而不是「表空了」
    expect(all(db, 'SELECT id FROM restrictions WHERE id = ?', [created.id])).toHaveLength(0);
    const rows = audits(db, 'delete');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ object_type: 'restriction', object_id: created.id });
    expect(JSON.parse(rows[0]!.before!)).toMatchObject({ id: created.id, reason: '临停', targetCode: 'N01' });
    // 删过之后再删：NOT_FOUND（而不是「成功删除了 0 行」）
    expectDomainError(() => deleteRestriction(ctx, created.id), 'RESTRICTION.NOT_FOUND');
  });

  it('id 不存在 → RESTRICTION.NOT_FOUND（更新与删除都要先要求记录存在）', () => {
    const { db, ctx } = setup();
    expectDomainError(() => updateRestriction(ctx, 'ghost', { reason: 'x' }), 'RESTRICTION.NOT_FOUND');
    expectDomainError(() => deleteRestriction(ctx, 'ghost'), 'RESTRICTION.NOT_FOUND');
  });
});

/**
 * 任务模板（§3.2.6）。
 *
 * 模板没有状态与引用，因此这里只锁三件事：编码唯一、优先级缺省、可空列的清空语义。
 */
describe('template.service', () => {
  it('创建：priority 缺省 normal、可空列落 null、审计留痕', () => {
    const { db, ctx } = setup();
    const created = createTemplate(ctx, { code: 'TPL-T1', name: '测试模板' });
    expect(created).toMatchObject({
      code: 'TPL-T1',
      priority: 'normal',
      defaultCargoKg: null,
      timeWindowMinutes: null,
      fromSiteType: null,
      toSiteType: null,
      remark: null
    });
    const rows = audits(db, 'create');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ object_type: 'taskTemplate', object_id: created.id });
  });

  it('编码唯一：重复编码 → BASE.CODE_EXISTS（与站点/车辆/节点同一个 code）', () => {
    const { db, ctx } = setup();
    expectDomainError(() => createTemplate(ctx, { code: 'TPL-STD', name: '重复' }), 'BASE.CODE_EXISTS');
  });

  it('更新：可空列传 null 表示清空；code 不可改', () => {
    const { db, ctx } = setup();
    const created = createTemplate(ctx, { code: 'TPL-T2', name: '测试', defaultCargoKg: 10, fromSiteType: 'depot' });
    const cleared = updateTemplate(ctx, created.id, { defaultCargoKg: null, fromSiteType: null });
    expect(cleared).toMatchObject({ defaultCargoKg: null, fromSiteType: null });
    expectDomainError(() => updateTemplate(ctx, created.id, { code: 'X' }), 'VALIDATION.FAILED');
    expectDomainError(() => updateTemplate(ctx, 'ghost', { name: 'x' }), 'TEMPLATE.NOT_FOUND');
  });
});
