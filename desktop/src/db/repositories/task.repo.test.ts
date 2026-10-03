import { beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '@udm/shared';
import { openDatabase, run, type Db } from '../index.js';
import { applyMigrations } from '../migrate.js';
import { seedDatabase } from '../seed.js';
import { seedFixture } from '../seed-fixture.js';
import { getTaskDetail, insertTask, listTasks, nextTaskCode, releaseTaskPlans } from './task.repo.js';

/**
 * 任务仓库（M3 读路径）的单测。
 *
 * 这里锁两类容易出错的东西：
 *   1. **排序是全序**：分页接口没有稳定顺序时，同一页在两次请求之间会重复或漏行，
 *      而这种问题只在数据量上来之后才显形；
 *   2. **筛选语义**：`?status=` 多值、时间范围只筛「有时间窗的任务」、关键词命中编码或标题。
 */
function setup(): Db {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  return db;
}

function add(db: Db, task: Parameters<typeof insertTask>[1]): void {
  insertTask(db, task);
}

const BASE = {
  templateId: null,
  status: 'draft' as const,
  priority: 'normal' as const,
  cargoKg: 10,
  cargoDesc: null,
  fromSiteId: SEED_IDS.siteDepot,
  toSiteId: SEED_IDS.siteDorm,
  timeWindowStart: null,
  timeWindowEnd: null,
  // 用**晚于** seed 的时间戳：seed 的 created_at 是跑测试那一刻的 now，
  // 若用固定早于它的值，排序断言会把 seed 排在新任务前面（与直觉相反）。
  //
  // 为什么是「相对于 now 偏移」而不是一个固定日期（ISS-073）：固定值
  // 只在同一天成立 —— 实测 2026-09-28 跑这套用例时，写成 `'2026-09-27T00:00:00.000Z'`
  // 的常量已经早于 seed 的 now，排序断言当场转红，而**代码一行没改**。
  // 凡是「与 now 比大小」的测试常量，都必须从 now 派生。
  at: new Date(Date.now() + 60_000).toISOString(),
  actorName: 'admin'
};

describe('task.repo · 列表', () => {
  let db: Db;
  beforeEach(() => {
    db = setup();
  });

  it('排序：最新创建在前，同一时刻按 code 倒序（全序，翻页不会重复）', () => {
    add(db, { ...BASE, id: 't-1', code: 'T20260926-0001', title: '一' });
    add(db, { ...BASE, id: 't-2', code: 'T20260926-0002', title: '二' });
    add(db, { ...BASE, id: 't-3', code: 'T20260926-0003', title: '三' });
    // 用关键词把自己插的三行摘出来：seed 自带 7 条任务（1 演示 + 6 待派发），
    // 它们会按 `created_at` 参与排序，把整页的期望值写成字面量只会每次跟着 seed 改
    const codes = listTasks(db, { page: 1, pageSize: 10, keyword: 'T20260926' }).records.map((row) => row.code);
    expect(codes).toEqual(['T20260926-0003', 'T20260926-0002', 'T20260926-0001']);
    // 同一时刻按 code 倒序的另一面：seed 的 7 条也都在列表里
    expect(listTasks(db, { page: 1, pageSize: 50 }).total).toBeGreaterThanOrEqual(10);
  });

  it('分页是全序的一部分：第 1 页与第 2 页不重叠', () => {
    add(db, { ...BASE, id: 't-1', code: 'T20260926-0001', title: '一' });
    add(db, { ...BASE, id: 't-2', code: 'T20260926-0002', title: '二' });
    add(db, { ...BASE, id: 't-3', code: 'T20260926-0003', title: '三' });
    const page1 = listTasks(db, { page: 1, pageSize: 2 }).records.map((row) => row.id);
    const page2 = listTasks(db, { page: 2, pageSize: 2 }).records.map((row) => row.id);
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1.filter((id) => page2.includes(id))).toEqual([]);
  });

  it('筛选：状态多值 / 优先级 / 车辆 / 关键词（编码或标题）', () => {
    add(db, { ...BASE, id: 't-1', code: 'T20260926-0001', title: '苹果配送', status: 'pending' });
    add(db, { ...BASE, id: 't-2', code: 'T20260926-0002', title: '香蕉配送', priority: 'urgent', status: 'failed' });

    // 多值：`failed`/`draft` 在 seed 里都不存在，因此命中的只可能是自己插的行
    expect(listTasks(db, { page: 1, pageSize: 10, statuses: ['failed', 'draft'] }).records.map((row) => row.id)).toEqual(['t-2']);
    expect(listTasks(db, { page: 1, pageSize: 10, keyword: '苹果' }).records[0]?.id).toBe('t-1');
    expect(listTasks(db, { page: 1, pageSize: 10, keyword: 'T20260926-0001' }).total).toBe(1);
    expect(listTasks(db, { page: 1, pageSize: 10, keyword: '香蕉' }).total).toBe(1);
    expect(listTasks(db, { page: 1, pageSize: 10, priority: 'urgent', keyword: '香蕉' }).records[0]?.id).toBe('t-2');
    // seed 的演示任务挂在 AGV-01 上（其余 6 条待派发任务还没有车）
    expect(listTasks(db, { page: 1, pageSize: 10, vehicleId: SEED_IDS.vehicleAgv }).records.map((row) => row.id)).toEqual([SEED_IDS.demoTask]);
  });

  it('时间范围只筛**有时间窗**的任务（没时间窗的不会以别的时间参与筛选）', () => {
    add(db, {
      ...BASE,
      id: 't-1',
      code: 'T20260926-0001',
      title: '有时间窗',
      timeWindowStart: '2026-09-27T08:00:00.000Z',
      timeWindowEnd: '2026-09-27T09:00:00.000Z'
    });
    add(db, { ...BASE, id: 't-2', code: 'T20260926-0002', title: '没有时间窗' });
    const inRange = listTasks(db, { page: 1, pageSize: 10, from: '2026-09-27T00:00:00.000Z', to: '2026-09-27T23:59:59.999Z' });
    expect(inRange.records.map((row) => row.id)).toEqual(['t-1']);
    // 用**远期**下限而不是「明天」：seed 的 6 条待派发任务的时间窗是「相对当前时刻」
    // （见 seed.ts），写死某一天的日期会在那天过后悄悄命中它们
    const outside = listTasks(db, { page: 1, pageSize: 10, from: '2099-01-01T00:00:00.000Z' });
    expect(outside.total).toBe(0);
  });

  it('派生字段：站点名与车辆编码来自 join，不由调用方补齐（D-25）', () => {
    const fixture = seedFixture();
    const nameOf = (id: string) => fixture.sites.find((site) => site.id === id)!.name;
    const row = listTasks(db, { page: 1, pageSize: 10, keyword: 'T-DEMO-0001' }).records[0];
    expect(row).toMatchObject({
      fromSiteName: nameOf(SEED_IDS.siteDepot),
      toSiteName: nameOf(SEED_IDS.siteDorm),
      vehicleCode: 'AGV-01'
    });
  });
});

describe('task.repo · 详情与编码', () => {
  let db: Db;
  beforeEach(() => {
    db = setup();
  });

  it('详情：路线摘要的节点数 / 边数从 JSON 列**现算**，不额外存一行冗余计数', () => {
    const detail = getTaskDetail(db, 'seed-task-demo');
    expect(detail).toBeDefined();
    const demoRoute = seedFixture().demoRoute;
    expect(detail?.route).toMatchObject({
      nodeCount: demoRoute.nodeIds.length,
      edgeCount: demoRoute.nodeIds.length - 1,
      algorithm: 'aStar'
    });
    expect(detail?.currentPlan).toBeNull();
    expect(detail?.auditSummaries).toEqual([]);
  });

  it('详情：没有当前计划时 `currentPlan` 是 null；置为 superseded 后也不再显示', () => {
    run(
      db,
      `INSERT INTO dispatch_plans (id, request_id, task_id, vehicle_id, strategy, status, cost, cost_detail,
                                   occupied_from, occupied_to, created_at)
       VALUES ('p-1', 'r-1', 'seed-task-demo', ?, 'greedy', 'applied', 9, '{}',
               '2026-09-26T00:00:00.000Z', '2026-09-27T00:00:00.000Z', '2026-09-26T00:00:00.000Z')`,
      [SEED_IDS.vehicleAgv]
    );
    expect(getTaskDetail(db, 'seed-task-demo')?.currentPlan).toMatchObject({ id: 'p-1', vehicleCode: 'AGV-01' });
    // superseded 是历史，不该显示成「当前计划」
    expect(releaseTaskPlans(db, 'seed-task-demo', 'superseded')).toBe(1);
    expect(getTaskDetail(db, 'seed-task-demo')?.currentPlan).toBeNull();
    // 已经是历史了，再回收一次不再计数（幂等）
    expect(releaseTaskPlans(db, 'seed-task-demo', 'superseded')).toBe(0);
  });

  it('nextTaskCode：按当天最大号 +1；只认当天的编码', () => {
    add(db, { ...BASE, id: 't-1', code: 'T20260926-0007', title: '七' });
    add(db, { ...BASE, id: 't-2', code: 'T20260925-0099', title: '昨天' });
    expect(nextTaskCode(db, '20260926')).toBe('T20260926-0008');
    expect(nextTaskCode(db, '20260927')).toBe('T20260927-0001');
  });

  it('详情：不存在的 id 返回 undefined（调用点据此给 TASK.NOT_FOUND）', () => {
    expect(getTaskDetail(db, 'nope')).toBeUndefined();
  });
});
