import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditContext, DomainError } from '@udm/shared';
import { all, openDatabase, run, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { seedDatabase } from '../../db/seed.js';
import type { CrudContext } from '../base/context.js';
import { compareRoutes, getRoute, planRoute } from './route.service.js';

/**
 * M5 路径规划服务的**行为**（`docs/api.md` §3.5）。
 *
 * 算法本身（最短路、A* 与 Dijkstra 一致性、途经点拼接、警告）由
 * `shared/src/route-search.test.ts` 与 `route-graph.test.ts` 断言，这里**不重复**。
 * 本文件要证明的是服务层独有的四件事：
 *
 *   1. **五种内核失败翻译成四种 code**：`GRAPH.EMPTY` / `GRAPH.DISCONNECTED` /
 *      `GRAPH.BLOCKED` / `ROUTE.NOT_FOUND_PATH`，且 `via` 不可达时带上 `detail.unreachableVia`；
 *   2. **存在性先于构图判**：不存在的节点 id 报 `NODE.NOT_FOUND`，不是「走不通」；
 *   3. **运行期配置只在这里读**：请求不给 `algorithm` 时取 `settings.route.defaultAlgorithm`；
 *   4. **口径来自库里的真实数据**：禁用边、禁行规则、车种速度都真的改变了结果。
 *
 * 测试用的是 seed 的 4×3 网格（`seed-n01`..`seed-n12`，每段 20 m），
 * 因为「用真实 seed 数据」才能让这里的期望值与界面/手工验证对得上（D-26 的口径）。
 */
const ACTOR: AuditContext = { actorId: 'seed-admin', actorName: 'admin', role: 'admin', traceId: 'trace-m5' };

function setup(): { db: Db; ctx: CrudContext } {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  return { db, ctx: { db, actor: ACTOR } };
}

function expectDomainError(fn: () => unknown, code: string): DomainError {
  try {
    fn();
  } catch (error) {
    const domainError = error as DomainError;
    expect(domainError.code, `期望 ${code}，实际 ${domainError.code}`).toBe(code);
    return domainError;
  }
  throw new Error(`期望抛出 ${code}，但没有抛`);
}

const n = (index: number) => `seed-n${String(index).padStart(2, '0')}`;
const edge = (a: number, b: number) =>
  `seed-e-N${String(a).padStart(2, '0')}-N${String(b).padStart(2, '0')}`;

function plan(raw: Record<string, unknown>) {
  return planRoute({ db, actor: ACTOR }, raw);
}

/** 建一条禁行规则（直接写库：规则的写入路径由 M2 的用例覆盖，这里只关心它对规划的影响）。 */
function addRestriction(
  db: Db,
  input: { type: 'node' | 'edge'; targetId: string; vehicleType?: string | null; startAt?: string | null; endAt?: string | null; status?: string }
): void {
  run(
    db,
    `INSERT INTO restrictions (id, type, target_id, start_at, end_at, vehicle_type, reason, status, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, '测试规则', ?, '2026-09-26T00:00:00.000Z', 'seed')`,
    [
      `rule-${Math.random().toString(16).slice(2)}`,
      input.type,
      input.targetId,
      input.startAt ?? null,
      input.endAt ?? null,
      input.vehicleType ?? null,
      input.status ?? 'active'
    ]
  );
}

function disableEdges(db: Db, edges: string[]): void {
  for (const id of edges) {
    run(db, "UPDATE edges SET status = 'disabled' WHERE id = ?", [id]);
  }
}

let db: Db;

describe('route.service · 规划（plan）', () => {
  beforeEach(() => {
    ({ db } = setup());
  });

  it('网格上最短路：n01 → n12 为 5 段 100 m，AGV 默认 1.5 m/s → 66.667 s', () => {
    const { route } = plan({ fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' });
    expect(route.nodeIds).toHaveLength(6);
    expect(route.edgeIds).toHaveLength(5);
    expect(route.nodeIds[0]).toBe(n(1));
    expect(route.nodeIds[5]).toBe(n(12));
    expect(route.distanceM).toBe(100);
    expect(route.durationS).toBeCloseTo(100 / 1.5, 3);
    // 请求没给 algorithm → 落到 settings 的默认值（seed 写的是 aStar）
    expect(route.algorithm).toBe('aStar');
    expect(route.costDetail).toEqual({ travelS: route.durationS });
    expect(route.viaNodeIds).toEqual([]);
  });

  it('车种改变耗时：同一条路无人机（5 m/s）是 AGV 的三分之一', () => {
    const agv = plan({ fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' }).route;
    const drone = plan({ fromNodeId: n(1), toNodeId: n(12), vehicleType: 'drone' }).route;
    expect(agv.distanceM).toBe(drone.distanceM);
    expect(drone.durationS).toBeCloseTo(100 / 5, 3);
    expect(agv.durationS / drone.durationS).toBeCloseTo(5 / 1.5, 3);
  });

  it('途经点按顺序经过，接缝不重复', () => {
    const { route } = plan({
      fromNodeId: n(1),
      toNodeId: n(12),
      viaNodeIds: [n(5)],
      vehicleType: 'agv'
    });
    expect(route.viaNodeIds).toEqual([n(5)]);
    expect(route.nodeIds).toContain(n(5));
    // 拼接处不能在 nodeIds 里出现连续两个相同节点（那会让渲染层画出一段零长度边）
    for (let i = 1; i < route.nodeIds.length; i += 1) {
      expect(route.nodeIds[i]).not.toBe(route.nodeIds[i - 1]);
    }
    // 经过 n05 后里程不会小于直连的 100 m
    expect(route.distanceM).toBeGreaterThanOrEqual(100);
    expect(route.edgeIds).toHaveLength(route.nodeIds.length - 1);
  });

  it('禁行规则（node，全车种）真的把节点排除出可用图：绕路后里程变大', () => {
    const direct = plan({ fromNodeId: n(1), toNodeId: n(3), vehicleType: 'agv' }).route;
    expect(direct.distanceM).toBe(40);
    addRestriction(db, { type: 'node', targetId: n(2) });
    const detour = plan({ fromNodeId: n(1), toNodeId: n(3), vehicleType: 'agv' }).route;
    expect(detour.nodeIds).not.toContain(n(2));
    expect(detour.distanceM).toBeGreaterThan(40);
  });

  it('禁行规则只对指定车种生效：无人机仍可走被 AGV 禁行的节点', () => {
    addRestriction(db, { type: 'node', targetId: n(2), vehicleType: 'agv' });
    const agv = plan({ fromNodeId: n(1), toNodeId: n(3), vehicleType: 'agv' }).route;
    const drone = plan({ fromNodeId: n(1), toNodeId: n(3), vehicleType: 'drone' }).route;
    expect(agv.nodeIds).not.toContain(n(2));
    expect(drone.distanceM).toBe(40);
  });

  it('时间窗之外的规则不生效（半开区间 [start, end)）', () => {
    // 窗口整体在过去：end 已经到点
    addRestriction(db, {
      type: 'node',
      targetId: n(2),
      startAt: '2020-01-01T00:00:00.000Z',
      endAt: '2020-01-02T00:00:00.000Z'
    });
    const route = plan({ fromNodeId: n(1), toNodeId: n(3), vehicleType: 'agv' }).route;
    expect(route.distanceM).toBe(40);
  });

  it('端点本身被禁行封住 → GRAPH.BLOCKED（不是「找不到路」）', () => {
    addRestriction(db, { type: 'node', targetId: n(2) });
    const error = expectDomainError(() => plan({ fromNodeId: n(2), toNodeId: n(5), vehicleType: 'agv' }), 'GRAPH.BLOCKED');
    expect(error.detail).toMatchObject({ reason: 'BLOCKED', reachedNodeId: n(2) });
  });

  it('被停用的节点也进不了图（原因在 detail.message 里区分）', () => {
    run(db, "UPDATE nodes SET status = 'disabled' WHERE id = ?", [n(2)]);
    const error = expectDomainError(() => plan({ fromNodeId: n(2), toNodeId: n(5), vehicleType: 'agv' }), 'GRAPH.BLOCKED');
    expect(String(error.detail?.['message'])).toContain('已停用');
  });

  it('边全被禁用 → GRAPH.DISCONNECTED', () => {
    disableEdges(db, all<{ id: string }>(db, 'SELECT id FROM edges').map((row) => row.id));
    const error = expectDomainError(() => plan({ fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' }), 'GRAPH.DISCONNECTED');
    expect(error.source).toBe('business');
  });

  it('节点全被禁用 → GRAPH.EMPTY（空图与不连通是两个不同的处置）', () => {
    run(db, "UPDATE nodes SET status = 'disabled'", []);
    const error = expectDomainError(() => plan({ fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' }), 'GRAPH.EMPTY');
    expect(error.detail).toMatchObject({ reason: 'GRAPH_EMPTY' });
  });

  it('两点确实不连通 → ROUTE.NOT_FOUND_PATH', () => {
    // 把 n04（右上角）的四条邻边全部禁用 → 它还在图里，但谁也到不了
    disableEdges(db, [edge(3, 4), edge(4, 3), edge(4, 8), edge(8, 4)]);
    const error = expectDomainError(() => plan({ fromNodeId: n(1), toNodeId: n(4), vehicleType: 'agv' }), 'ROUTE.NOT_FOUND_PATH');
    expect(error.detail).toMatchObject({ reason: 'NOT_FOUND_PATH' });
  });

  it('途经点不可达 → ROUTE.NOT_FOUND_PATH + detail.unreachableVia', () => {
    disableEdges(db, [edge(3, 4), edge(4, 3), edge(4, 8), edge(8, 4)]);
    const error = expectDomainError(
      () => plan({ fromNodeId: n(1), toNodeId: n(12), viaNodeIds: [n(4)], vehicleType: 'agv' }),
      'ROUTE.NOT_FOUND_PATH'
    );
    expect(error.detail).toMatchObject({ reason: 'VIA_UNREACHABLE', unreachableVia: [n(4)] });
  });

  it('不存在的节点 id → NODE.NOT_FOUND（与「走不通」区分开）', () => {
    const error = expectDomainError(
      () => plan({ fromNodeId: 'seed-nope', toNodeId: n(12), vehicleType: 'agv' }),
      'NODE.NOT_FOUND'
    );
    expect(error.detail).toEqual({ id: 'seed-nope' });
  });

  it('途经点不存在也报 NODE.NOT_FOUND，而不是「到不了那个途经点」', () => {
    const error = expectDomainError(
      () => plan({ fromNodeId: n(1), toNodeId: n(12), viaNodeIds: ['seed-nope'], vehicleType: 'agv' }),
      'NODE.NOT_FOUND'
    );
    expect(error.detail).toEqual({ id: 'seed-nope' });
  });

  it('字段校验：缺 vehicleType → VALIDATION.FAILED（不给默认值，否则「忘了传」会被算成 other）', () => {
    const error = expectDomainError(
      () => plan({ fromNodeId: n(1), toNodeId: n(12) }),
      'VALIDATION.FAILED'
    );
    expect(Object.keys((error.detail?.['fields'] ?? {}) as object)).toEqual(['vehicleType']);
  });

  it('途经点超过上限 → VALIDATION.FAILED（成本护栏，不是业务规则）', () => {
    const error = expectDomainError(
      () => plan({ fromNodeId: n(1), toNodeId: n(12), viaNodeIds: Array(11).fill(n(5)), vehicleType: 'agv' }),
      'VALIDATION.FAILED'
    );
    expect(String((error.detail?.['fields'] as Record<string, string>)['viaNodeIds'])).toContain('10');
  });

  it('字段错误一次报全（不是遇到第一个就返回）', () => {
    const error = expectDomainError(
      () => plan({ fromNodeId: '', viaNodeIds: [123, 456], vehicleType: 'agv' }),
      'VALIDATION.FAILED'
    );
    const fields = error.detail?.['fields'] as Record<string, string>;
    expect(Object.keys(fields).sort()).toEqual(['fromNodeId', 'toNodeId', 'viaNodeIds']);
  });

  it('运行时配置生效：把 settings.route.defaultAlgorithm 改成 dijkstra 后不带 algorithm 的请求走 Dijkstra', () => {
    run(db, "UPDATE settings SET value = '\"dijkstra\"' WHERE key = 'route.defaultAlgorithm'", []);
    const route = plan({ fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' }).route;
    expect(route.algorithm).toBe('dijkstra');
  });

  it('请求给了 algorithm 时设置不参与', () => {
    run(db, "UPDATE settings SET value = '\"dijkstra\"' WHERE key = 'route.defaultAlgorithm'", []);
    const route = plan({ fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv', algorithm: 'aStar' }).route;
    expect(route.algorithm).toBe('aStar');
  });
});

describe('route.service · 算法对比（compare）', () => {
  beforeEach(() => {
    ({ db } = setup());
  });

  it('两个算法都算、顺序固定、结果一致时 difference 全 0', () => {
    const result = compareRoutes({ db, actor: ACTOR }, {
      fromNodeId: n(1),
      toNodeId: n(12),
      vehicleType: 'agv'
    });
    expect(result.results.map((item) => item.algorithm)).toEqual(['aStar', 'dijkstra']);
    expect(result.consistent).toBe(true);
    expect(result.difference).toEqual({ distanceM: 0, durationS: 0 });
    // 「一致」的定义是**里程与耗时相同**，不是节点序列相同：网格上等长的走法不止一条，
    // A* 的启发式会把它引向终点、Dijkstra 按 id 顺序展开，两者选出的等长路径本来就可能不同。
    // 断言 sequence 相等会把一个正确实现判成错的（等长走法由 tie-break 决定，不是契约）
    const [first, second] = result.results;
    expect(first!.route.distanceM).toBe(second!.route.distanceM);
    expect(first!.route.durationS).toBe(second!.route.durationS);
    expect(first!.route.edgeIds).toHaveLength(second!.route.edgeIds.length);
    expect(first!.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('请求里的 algorithm 被忽略：给了 dijkstra 仍然返回两个', () => {
    const result = compareRoutes({ db, actor: ACTOR }, {
      fromNodeId: n(1),
      toNodeId: n(12),
      vehicleType: 'agv',
      algorithm: 'dijkstra'
    });
    expect(result.results).toHaveLength(2);
  });

  it('非法 algorithm 仍然报参数错误（不静默忽略）', () => {
    expectDomainError(
      () => compareRoutes({ db, actor: ACTOR }, { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv', algorithm: 'floyd' }),
      'VALIDATION.FAILED'
    );
  });

  it('规划失败时 compare 也抛同一个错误（不会返回半份结果）', () => {
    addRestriction(db, { type: 'node', targetId: n(2) });
    expectDomainError(
      () => compareRoutes({ db, actor: ACTOR }, { fromNodeId: n(2), toNodeId: n(5), vehicleType: 'agv' }),
      'GRAPH.BLOCKED'
    );
  });

  it('结果一致时不写审计（compare 不是写操作）', () => {
    compareRoutes({ db, actor: ACTOR }, { fromNodeId: n(1), toNodeId: n(12), vehicleType: 'agv' });
    const rows = all<{ total: number }>(db, "SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'compare_inconsistent'");
    expect(rows[0]!.total).toBe(0);
  });
});

describe('route.service · 已存路线（detail）', () => {
  beforeEach(() => {
    ({ db } = setup());
  });

  it('读到 seed 的演示路线：全字段（含 edgeIds 与 warnings）', () => {
    const route = getRoute({ db, actor: ACTOR }, 'seed-route-demo');
    expect(route.id).toBe('seed-route-demo');
    expect(route.taskId).toBe('seed-task-demo');
    expect(route.nodeIds).toEqual([n(1), n(5), n(9), n(10), n(11), n(12)]);
    expect(route.edgeIds).toHaveLength(5);
    expect(route.distanceM).toBe(100);
    expect(route.durationS).toBeCloseTo(100 / 1.5, 3);
    expect(route.algorithm).toBe('aStar');
    expect(route.warnings).toEqual([]);
    expect(route.costDetail).toEqual({});
    expect(route.createdBy).toBe('seed');
  });

  it('不存在的路线 → ROUTE.NOT_FOUND（不是 NOT_FOUND_PATH）', () => {
    const error = expectDomainError(() => getRoute({ db, actor: ACTOR }, 'seed-route-nope'), 'ROUTE.NOT_FOUND');
    expect(error.detail).toEqual({ id: 'seed-route-nope' });
  });
});
