import { describe, expect, it } from 'vitest';
import { openDatabase, run, type Db } from '../index.js';
import { applyMigrations } from '../migrate.js';
import { seedDatabase } from '../seed.js';
import { findSiteById, listSites } from './site.repo.js';
import { findVehicleById, listVehicles } from './vehicle.repo.js';
import { findEdgeById, findNodeById, listEdges, listNodes } from './graph.repo.js';
import { findRestrictionById, listRestrictions } from './restriction.repo.js';
import { findTemplateById, listTemplates } from './template.repo.js';

/**
 * M2 读取路径（`/api/sites` `/api/vehicles` `/api/nodes` `/api/edges`）的仓库层测试。
 *
 * 这些用例只验证「查出来的行是不是对的那几行、字段名与类型对不对」——
 * 权限与错误码在 `ipc/router.test.ts`，页面渲染在 `renderer/` 里。
 *
 * 库用 seed 出来的真实数据（`db.test.ts` 已锁死它的规模）：
 * 测试里的期望值**从查询结果本身推导**而不是写死条数，避免 seed 调整时这里静默错位。
 */
function setup(): Db {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  return db;
}

const ALL = { page: 1, pageSize: 100 };

describe('listSites', () => {
  it('按 code 排序返回全部站点，并投影成驼峰字段', () => {
    const db = setup();
    const { records, total } = listSites(db, ALL);
    expect(total).toBe(records.length);
    expect(records.length).toBeGreaterThan(0);
    expect(records.map((site) => site.code)).toEqual([...records.map((site) => site.code)].sort());
    const first = records[0]!;
    expect(Object.keys(first).sort()).toEqual(
      [
        'code',
        'createdAt',
        'id',
        'name',
        'nodeId',
        'remark',
        'status',
        'type',
        'updatedAt',
        'x',
        'y'
      ].sort()
    );
    // seed 的三个站点都绑定了节点，且 nodeId 是**节点 id**（不是 code，也不是 null）
    expect(first.nodeId).toBeTypeOf('string');
  });

  it('keyword 同时匹配编码与名称', () => {
    const db = setup();
    const byCode = listSites(db, { ...ALL, keyword: 'A-01' });
    expect(byCode.total).toBeGreaterThan(0);
    expect(byCode.records.every((site) => site.code === 'A-01')).toBe(true);

    const byName = listSites(db, { ...ALL, keyword: '仓库' });
    expect(byName.total).toBeGreaterThanOrEqual(byCode.total);
    expect(byName.records.every((site) => site.name.includes('仓库'))).toBe(true);
  });

  it('type / status 过滤生效，且 pageSize 真的切片', () => {
    const db = setup();
    const charging = listSites(db, { ...ALL, type: 'charging' });
    expect(charging.records.every((site) => site.type === 'charging')).toBe(true);

    const disabled = listSites(db, { ...ALL, status: 'disabled' });
    expect(disabled.total).toBe(0); // seed 不含停用站点

    const paged = listSites(db, { page: 1, pageSize: 1 });
    expect(paged.records).toHaveLength(1);
    expect(paged.total).toBeGreaterThan(1);
  });

  it('findSiteById 命中与未命中', () => {
    const db = setup();
    const target = listSites(db, ALL).records[0]!;
    expect(findSiteById(db, target.id)?.code).toBe(target.code);
    expect(findSiteById(db, 'no-such-site')).toBeUndefined();
  });
});

describe('listVehicles', () => {
  it('把 online 的 0/1 还原成布尔，并保留运行态字段', () => {
    const db = setup();
    const { records } = listVehicles(db, ALL);
    expect(records.length).toBeGreaterThan(0);
    for (const vehicle of records) {
      expect(typeof vehicle.online).toBe('boolean');
      expect(vehicle.capacityKg).toBeGreaterThan(0);
      expect(vehicle.battery).toBeGreaterThanOrEqual(0);
      expect(vehicle.battery).toBeLessThanOrEqual(100);
    }
    // seed 的 AGV-01 处于演示任务的占用态（D-26）：状态与载重必须与之一致
    const agv = records.find((vehicle) => vehicle.code === 'AGV-01');
    expect(agv?.status).toBe('busy');
    expect(agv?.loadKg).toBeGreaterThan(0);
  });

  it('status 过滤与 keyword 过滤', () => {
    const db = setup();
    const idle = listVehicles(db, { ...ALL, status: 'idle' });
    expect(idle.records.every((vehicle) => vehicle.status === 'idle')).toBe(true);
    const busy = listVehicles(db, { ...ALL, status: 'busy' });
    expect(busy.records.map((vehicle) => vehicle.code)).toEqual(['AGV-01']);

    const drone = listVehicles(db, { ...ALL, keyword: '无人机' });
    expect(drone.records.map((vehicle) => vehicle.code)).toEqual(['DRN-01']);
  });

  it('findVehicleById 命中与未命中', () => {
    const db = setup();
    const target = listVehicles(db, ALL).records[0]!;
    expect(findVehicleById(db, target.id)?.code).toBe(target.code);
    expect(findVehicleById(db, 'no-such-vehicle')).toBeUndefined();
  });
});

describe('listNodes / listEdges', () => {
  it('节点与边的条数一致（边两端都能解析出节点 code）', () => {
    const db = setup();
    const nodes = listNodes(db, ALL);
    const edges = listEdges(db, ALL);
    expect(nodes.total).toBeGreaterThan(0);
    expect(edges.total).toBeGreaterThan(0);
    for (const edge of edges.records) {
      expect(edge.fromNodeCode).not.toBe('');
      expect(edge.toNodeCode).not.toBe('');
      expect(edge.lengthM).toBeGreaterThan(0);
    }
  });

  it('边的 code 由两端节点 code 推导：同一对节点两个方向得到 `E_A_B` 与 `E_A_B_R`', () => {
    const db = setup();
    const { records, total } = listEdges(db, ALL);
    const sample = records[0]!;
    expect(sample.code).toBe(`E_${sample.fromNodeCode}_${sample.toNodeCode}`);

    // seed 的路网是**双向成对**写入的（`seed.ts` 对每个相邻索引对同时写 a→b 与 b→a），
    // 因此 34 条边 = 17 对 × 2 个方向，其中一半推导结果带 `_R`。
    // 这里不写死「几条带 _R」，只断言结构：每个 code 唯一，且每条 `_R` 都能找到配对的基码
    const codes = records.map((edge) => edge.code);
    expect(new Set(codes).size).toBe(codes.length);
    const byCode = new Map(records.map((edge) => [edge.code, edge]));
    const reversed = records.filter((edge) => edge.code.endsWith('_R'));
    expect(reversed.length).toBeGreaterThan(0);
    for (const edge of reversed) {
      const base = byCode.get(edge.code.slice(0, -2));
      expect(base, `${edge.code} 缺少基码`).toBeDefined();
      // `_R` 那条的起终点与基码相反，两端 code 也互换
      expect([edge.fromNodeId, edge.toNodeId]).toEqual([base!.toNodeId, base!.fromNodeId]);
      expect([edge.fromNodeCode, edge.toNodeCode]).toEqual([base!.toNodeCode, base!.fromNodeCode]);
    }
    expect(reversed.length * 2).toBe(total);
  });

  it('手工补一条字典序较大的节点，验证 `_R` 取的是「字典序小的一侧为基码」', () => {
    const db = setup();
    const anchor = listNodes(db, ALL).records[0]!;
    run(db, "INSERT INTO nodes (id, code, name, x, y, status) VALUES ('test-zz', 'ZZ-99', '测试节点', 0, 0, 'enabled')");
    run(db, "INSERT INTO edges (id, from_node_id, to_node_id, length_m, status) VALUES ('test-fwd', ?, 'test-zz', 10, 'enabled')", [anchor.id]);
    run(db, "INSERT INTO edges (id, from_node_id, to_node_id, length_m, status) VALUES ('test-rev', 'test-zz', ?, 10, 'enabled')", [anchor.id]);

    const forward = findEdgeById(db, 'test-fwd');
    const reverse = findEdgeById(db, 'test-rev');
    // 基码取字典序较小的一侧（这里是 N01 一侧），反方向无论谁在前都加 `_R`
    expect(forward?.code).toBe(`E_${anchor.code}_ZZ-99`);
    expect(reverse?.code).toBe(`E_${anchor.code}_ZZ-99_R`);
  });

  it('按 code / fromNodeId / status 过滤边，按 status 过滤节点', () => {
    const db = setup();
    const all = listEdges(db, ALL);
    const sample = all.records[0]!;

    expect(listEdges(db, { ...ALL, code: sample.code }).records.map((edge) => edge.id)).toEqual([sample.id]);
    expect(listEdges(db, { ...ALL, code: 'E_nope_nope' }).total).toBe(0);

    const outbound = listEdges(db, { ...ALL, fromNodeId: sample.fromNodeId });
    expect(outbound.total).toBeGreaterThan(0);
    expect(outbound.records.every((edge) => edge.fromNodeId === sample.fromNodeId)).toBe(true);
    // 反向再查一次，确认 fromNodeId 过滤的是方向而不是「两端之一」
    const inbound = listEdges(db, { ...ALL, fromNodeId: sample.toNodeId });
    expect(inbound.records.some((edge) => edge.toNodeId === sample.fromNodeId)).toBe(true);

    expect(listEdges(db, { ...ALL, status: 'disabled' }).total).toBe(0);
    expect(listNodes(db, { ...ALL, status: 'disabled' }).total).toBe(0);
  });

  it('按 code 过滤是**定向**的：`E_A_B` 只命中正向那一条', () => {
    const db = setup();
    const forward = listEdges(db, ALL).records.find((edge) => !edge.code.endsWith('_R'))!;

    const byBase = listEdges(db, { ...ALL, code: forward.code });
    expect(byBase.records.map((edge) => edge.id)).toEqual([forward.id]);
    expect(byBase.records[0]!.fromNodeId).toBe(forward.fromNodeId);

    // 同一对节点的反方向是**另一条边、另一个 code**
    const byReverse = listEdges(db, { ...ALL, code: `${forward.code}_R` });
    expect(byReverse.records).toHaveLength(1);
    expect(byReverse.records[0]!.id).not.toBe(forward.id);
    expect(byReverse.records[0]!.fromNodeId).toBe(forward.toNodeId);
    expect(byReverse.records[0]!.fromNodeCode).toBe(forward.toNodeCode);
  });

  it('code 写法不合法时返回空结果而不是报错（拼错的 code = 查不到）', () => {
    const db = setup();
    // 注意 `''` 不在此列：它在仓库层表示「未给筛选」（传输层已把空串转成 undefined，
    // 见 `ipc/validators.ts` 的 `optionalString`），因此 `code=''` 返回全量是对的
    for (const bad of ['N01', 'E_', 'E_N12_N01']) {
      // `E_N12_N01` 刻意不放行：它若被当成 `E_N01_N12_R`，同一个对象就有两个 code
      expect(listEdges(db, { ...ALL, code: bad }).total, JSON.stringify(bad)).toBe(0);
    }
  });

  it('分页在 join 之后仍然正确（total 是全量而不是当前页）', () => {
    const db = setup();
    const all = listEdges(db, ALL);
    const firstPage = listEdges(db, { page: 1, pageSize: 5 });
    expect(firstPage.records).toHaveLength(5);
    expect(firstPage.total).toBe(all.total);
    const secondPage = listEdges(db, { page: 2, pageSize: 5 });
    expect(secondPage.records.map((edge) => edge.id)).not.toEqual(firstPage.records.map((edge) => edge.id));
    // 稳定排序：两页不重叠
    const overlap = secondPage.records.filter((edge) => firstPage.records.some((row) => row.id === edge.id));
    expect(overlap).toEqual([]);
  });

  it('findNodeById / findEdgeById 命中与未命中', () => {
    const db = setup();
    const node = listNodes(db, ALL).records[0]!;
    expect(findNodeById(db, node.id)?.code).toBe(node.code);
    expect(findNodeById(db, 'no-such-node')).toBeUndefined();

    const edge = listEdges(db, ALL).records[0]!;
    expect(findEdgeById(db, edge.id)?.code).toBe(edge.code);
    expect(findEdgeById(db, 'no-such-edge')).toBeUndefined();
  });
});

/**
 * 禁行规则的读取路径（§3.2.5）。
 *
 * 这一层独有的两件事，都是「查出来的行是不是对的」之外的东西：
 *   1. `targetCode` 是**派生**的（多态引用：节点取 code、边按两端推导）；
 *   2. 目标不存在时规则**仍然在列表里**（`LEFT JOIN` 而不是 `JOIN`）——
 *      若写成 `JOIN`，那条规则会凭空消失，使用者看不到它、也就无法清理它。
 */
describe('listRestrictions', () => {
  /** 直接写表：规则没有 seed 数据，而写路径的合法性由领域服务与接口层覆盖。 */
  function insertRule(db: Db, row: { id: string; type: 'node' | 'edge'; targetId: string; createdAt: string; reason?: string }): void {
    run(
      db,
      `INSERT INTO restrictions (id, type, target_id, start_at, end_at, vehicle_type, reason, status, created_at, created_by)
       VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'active', ?, 'seed-admin')`,
      [row.id, row.type, row.targetId, row.reason ?? '测试规则', row.createdAt]
    );
  }

  it('节点目标的 targetCode 取 nodes.code；边目标按两端节点 code 推导', () => {
    const db = setup();
    insertRule(db, { id: 'r-node', type: 'node', targetId: 'seed-n01', createdAt: '2026-01-02T00:00:00.000Z' });
    const edge = listEdges(db, ALL).records.find((item) => item.fromNodeCode === 'N01' && item.toNodeCode === 'N05')!;
    insertRule(db, { id: 'r-edge', type: 'edge', targetId: edge.id, createdAt: '2026-01-01T00:00:00.000Z' });

    const { records, total } = listRestrictions(db, ALL);
    expect(total).toBe(2);
    // 排序：created_at 倒序（新的在前）
    expect(records.map((rule) => rule.id)).toEqual(['r-node', 'r-edge']);
    expect(records[0]).toMatchObject({ id: 'r-node', type: 'node', targetCode: 'N01', status: 'active' });
    expect(records[1]!.targetCode).toBe(edge.code);
  });

  it('目标被删后规则**仍在列表里**，targetCode 为 null（用 JOIN 会让它凭空消失）', () => {
    const db = setup();
    insertRule(db, { id: 'r-orphan', type: 'node', targetId: 'ghost-node', createdAt: '2026-01-01T00:00:00.000Z' });
    const { records, total } = listRestrictions(db, ALL);
    expect(total).toBe(1);
    expect(records[0]).toMatchObject({ id: 'r-orphan', targetCode: null });
    // 详情走的是同一段投影：两处字段必须一致，否则「列表有 code、详情没有」会静默分叉
    expect(findRestrictionById(db, 'r-orphan')?.targetCode).toBeNull();
    expect(findRestrictionById(db, 'no-such-rule')).toBeUndefined();
  });

  it('type / status 筛选与计数都不受 JOIN 影响（计数走的是不带 JOIN 的那条 SQL）', () => {
    const db = setup();
    insertRule(db, { id: 'r-a', type: 'node', targetId: 'seed-n01', createdAt: '2026-01-01T00:00:00.000Z' });
    insertRule(db, { id: 'r-b', type: 'node', targetId: 'ghost', createdAt: '2026-01-02T00:00:00.000Z' });
    expect(listRestrictions(db, { ...ALL, type: 'node' }).total).toBe(2);
    expect(listRestrictions(db, { ...ALL, type: 'edge' }).total).toBe(0);
    expect(listRestrictions(db, { ...ALL, status: 'expired' }).total).toBe(0);
    expect(listRestrictions(db, { ...ALL, status: 'active' }).total).toBe(2);
  });
});

/**
 * 任务模板的读取路径（§3.2.6）。
 *
 * seed 里有两个模板，因此这一组既有真实数据可断言，也不必写死条数之外的东西。
 */
describe('listTemplates', () => {
  it('按 code 排序，投影成驼峰字段（含可空的时间窗与站点类型）', () => {
    const db = setup();
    const { records, total } = listTemplates(db, ALL);
    expect(total).toBe(2);
    expect(records.map((row) => row.code)).toEqual(['TPL-CHG', 'TPL-STD']);
    expect(records[0]).toMatchObject({ code: 'TPL-CHG', priority: 'low', defaultCargoKg: 0, timeWindowMinutes: 120, toSiteType: 'charging' });
    // 模板没有 status 列：DTO 里就不该出现这个字段（界面按它筛「全部状态」会永远筛出空表）
    expect('status' in records[0]!).toBe(false);
  });

  it('keyword 同时匹配编码与名称（大小写不敏感与 SQLite 的 LIKE 一致）', () => {
    const db = setup();
    expect(listTemplates(db, { ...ALL, keyword: 'tpl-' }).total).toBe(2);
    expect(listTemplates(db, { ...ALL, keyword: '回充' }).total).toBe(1);
    expect(listTemplates(db, { ...ALL, keyword: 'zzz' }).total).toBe(0);
  });

  it('findTemplateById 命中与未命中', () => {
    const db = setup();
    const row = listTemplates(db, ALL).records[0]!;
    expect(findTemplateById(db, row.id)?.code).toBe(row.code);
    expect(findTemplateById(db, 'no-such-template')).toBeUndefined();
  });
});
