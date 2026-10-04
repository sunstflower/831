import { beforeEach, describe, expect, it } from 'vitest';
import { PLAN_RISK_SECTION_OF, SEED_IDS } from '@udm/shared';
import { nowIso, openDatabase, run, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { seedDatabase } from '../../db/seed.js';
import { alertRisks } from './risk.service.js';
import { apply as applyDispatch, preview as previewDispatch } from '../dispatch/dispatch.service.js';
import { setVehicleStatus } from '../base/vehicle.service.js';
import type { AuditContext } from '@udm/shared';

/**
 * 风险预检的**取数层**（`docs/api.md` §3.8.3）。
 *
 * 判断本身在 `shared/src/plan-risk.test.ts` 里逐条钉住；这里只锁「取数对不对」——
 * 也就是最容易悄悄出错、又不会报错的那部分：
 *   - 哪些计划该被看见（`applied` 且任务未完成），哪些不该（已完成任务的旧计划）；
 *   - 报告里的三个视图（风险 / 派发 / 缺口）是否来自**同一次**读取；
 *   - 演示数据（一条 `running` 任务 + 一条 `busy` 车 + 一条 `pending` 待派任务）
 *     在清新库上究竟报出什么 —— 这是页面首屏的样子，写错会让「告警中心」一进来就有假红点。
 */
function setup(): Db {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  return db;
}

describe('risk.service · 取数口径', () => {
  let db: Db;
  beforeEach(() => {
    db = setup();
  });

  it('清新库：演示执行数据（running 任务）不报「未派发」，也没有撞单', () => {
    const report = alertRisks(db);
    expect(report.scannedAt).toBeTruthy();
    expect(report.records.some((item) => item.kind === 'VEHICLE_OVERLAP')).toBe(false);
    // demo 任务是 running 且已派给 AGV-01，不该出现在「未派发」缺口里
    expect(report.unassignedTasks.some((row) => row.taskId === SEED_IDS.demoTask)).toBe(false);
  });

  it('seed 的 6 条待派任务全部进入 unassignedTasks（它们是首屏最该看到的缺口）', () => {
    const report = alertRisks(db);
    for (const id of SEED_IDS.pendingTasks) {
      expect(report.unassignedTasks.some((row) => row.taskId === id), id).toBe(true);
    }
    expect(report.records.filter((item) => item.kind === 'UNASSIGNED_TASK').length).toBe(SEED_IDS.pendingTasks.length);
  });

  it('assignments 只列未完成任务名下的计划，并带任务 / 车辆编码', () => {
    const report = alertRisks(db);
    expect(report.assignments.length).toBeGreaterThan(0);
    const demo = report.assignments.find((row) => row.taskId === SEED_IDS.demoTask);
    expect(demo, 'seed 的演示计划必须出现在派发区块里').toBeDefined();
    expect(demo!.taskStatus).toBe('running');
    expect(demo!.vehicleCode).toBe('AGV-01');
    expect(demo!.routeId).toBeTruthy();
  });

  it('把演示任务推到 finished 之后，它的计划**不再**出现在派发区块与风险里', () => {
    run(db, `UPDATE tasks SET status = 'finished', finished_at = ? WHERE id = ?`, [nowIso(), SEED_IDS.demoTask]);
    const report = alertRisks(db);
    expect(report.assignments.some((row) => row.taskId === SEED_IDS.demoTask)).toBe(false);
    expect(report.records.some((item) => item.taskCodes.includes('T-DEMO-0001'))).toBe(false);
  });

  it('车掉线 + 任务已指派 → 报车辆不可用（这正是「派了但跑不了」）', () => {
    run(db, `UPDATE vehicles SET status = 'offline' WHERE id = ?`, [SEED_IDS.vehicleAgv]);
    const report = alertRisks(db);
    const item = report.records.find((row) => row.kind === 'VEHICLE_UNAVAILABLE');
    expect(item).toBeDefined();
    expect(item!.vehicleCodes).toContain('AGV-01');
  });

  it('时间窗已过但任务还没做完 → 已超时（用注入的 now 断言秒数）', () => {
    /*
     * 种子数据里带时间窗的是 6 条**待派发**任务（演示执行任务的两端为 `null`：
     * 「回库回充」这类任务本来就不卡窗口）。把 now 推到一天之后，它们必定过期；
     * 同一批任务同时会报「未派发」—— 两条风险说的是同一件事的两面，都该出现。
     */
    const future = new Date(Date.now() + 24 * 3600_000).toISOString();
    const report = alertRisks(db, future);
    const item = report.records.find((row) => row.kind === 'WINDOW_EXPIRED');
    expect(item, '窗口过去一天后仍未完成的任务必须报超时').toBeDefined();
    expect(item!.detail['overdueS']).toBeGreaterThan(0);
    expect(item!.level).toBe('critical');
  });

  it('D-62 演示路径：派发一单 → 给那台车人工报障 → 「派发冲突」节立刻出现这条计划', () => {
    /*
     * 这一条锁的是**可达性**而不是算法（算法已在 `shared/src/plan-risk.test.ts` 钉死）：
     * `ISS-097` 说「告警中心节 1 的五类风险常规操作造不出来」。修法③（D-62）之后，
     * 唯一需要的操作是「基础数据页把那台车标记为故障」—— 用例照这条路径走一遍：
     *   pending 任务 → 预览 → 应用（车变 reserved / 任务变 assigned）→ 报障 → 再扫描。
     * 若 `fault` 又被打回「执行器专管」，这里会先红在 `setVehicleStatus` 上。
     */
    const ctx = { db, actor: { actorId: 'seed-admin', actorName: 'admin', role: 'admin', traceId: 'trace-risk' } as AuditContext };
    const taskId = SEED_IDS.pendingTasks[0]!;
    const previewResult = previewDispatch(ctx, { taskIds: [taskId], strategy: 'greedy' });
    const applied = applyDispatch(ctx, { requestId: previewResult.requestId, strategy: 'greedy' });
    const plan = applied.appliedPlans[0]!;

    // 报障前：这条计划**不是**风险（车是 reserved，正是正常中间态）
    const before = alertRisks(db);
    expect(before.records.some((item) => item.kind === 'VEHICLE_UNAVAILABLE' && item.taskIds.includes(taskId))).toBe(false);

    setVehicleStatus(ctx, plan.vehicleId, 'fault');

    const after = alertRisks(db);
    const item = after.records.find((row) => row.kind === 'VEHICLE_UNAVAILABLE');
    expect(item, '报障后必须报「车辆不可用」').toBeDefined();
    expect(item!.taskIds).toContain(taskId);
    expect(item!.vehicleCodes).toContain(plan.vehicleCode);
    expect(item!.detail['vehicleStatus']).toBe('fault');
    // 它属于「派发冲突与执行风险」这一节（依赖已生效派发），不是待派缺口
    expect(PLAN_RISK_SECTION_OF['VEHICLE_UNAVAILABLE']).toBe('dispatch');
  });

  it('同一时刻两次扫描结果完全相同（同一个 db、同一个 now）', () => {
    const at = nowIso();
    expect(alertRisks(db, at)).toEqual(alertRisks(db, at));
  });

  it('计数与记录条数自洽，且三个级别加起来等于总数', () => {
    const report = alertRisks(db);
    expect(report.total).toBe(report.records.length);
    expect(report.counts.critical + report.counts.warning + report.counts.info).toBe(report.total);
  });
});
