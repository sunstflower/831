import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditContext, DomainError } from '@udm/shared';
import { all, openDatabase, run, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { seedDatabase } from '../../db/seed.js';
import { getTaskDetail, listTasks } from '../../db/repositories/task.repo.js';
import { setVehicleStatus } from '../../db/repositories/vehicle.repo.js';
import type { CrudContext } from '../base/context.js';
import { createTask, deleteDraftTask, operateTask, updateTask } from './task.service.js';

/**
 * M3 任务服务的**行为**（`docs/api.md` §3.3、`design.md` §4.3）。
 *
 * 这里要证明的不是「UPDATE 能跑」，而是四件事：
 *   1. **状态机判在服务层**：每个非法迁移都返回 `TASK.STATE_CONFLICT`，且 detail 里
 *      同时有「当前状态」与「期望状态」（`design.md` §4.3 的验收口径）；
 *   2. **副作用写全**：取消要回收车辆与计划、重排要清掉旧的失败原因、恢复要清掉暂停原因；
 *   3. **审计可追溯**：`action` 就是动作名，`before` / `after` 都在（Req-M3-5 的「审计含原因」）；
 *   4. **事务边界**：失败时不留半条数据。
 *
 * 执行器（M7）尚未落地，因此 `assigned → running`、`running → failed` 这类迁移
 * 在用例里用**直接改库**来构造前置状态 —— 这是有意为之：本文件测的是 M3 的动作，
 * 不该为了造状态而把 M7 的行为也实现一遍。
 */
const ACTOR: AuditContext = { actorId: 'seed-admin', actorName: 'admin', role: 'admin', traceId: 'trace-m3' };

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

/**
 * 审计动作序列。
 *
 * 排序必须带 `rowid`（插入顺序）：`audit_logs.ts` 只到毫秒，而同一次操作里
 * 连续写的两行（如「取消任务 + 回收车辆」）会落在同一毫秒，此时仅按 `ts`
 * 排序的先后是未定义的 —— 断言的是「顺序」的用例会偶发变红（ISS-068）。
 */
function auditActions(db: Db): string[] {
  return all<{ action: string }>(db, "SELECT action FROM audit_logs WHERE module = 'task' ORDER BY ts, rowid")
    .map((row) => row.action);
}

/** 造一条「已生效」的调度计划（M4 尚未落地，用它测回收逻辑）。 */
function insertPlan(db: Db, taskId: string, vehicleId: string): string {
  const id = `plan-${taskId}`;
  run(
    db,
    `INSERT INTO dispatch_plans (id, request_id, task_id, vehicle_id, strategy, status, cost, cost_detail,
                                 occupied_from, occupied_to, applied_at, created_at)
     VALUES (?, 'req-test', ?, ?, 'greedy', 'applied', 12, '{}', '2026-09-26T00:00:00.000Z',
             '2026-09-27T00:00:00.000Z', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z')`,
    [id, taskId, vehicleId]
  );
  return id;
}

function setTaskStatus(db: Db, id: string, status: string): void {
  run(db, 'UPDATE tasks SET status = ? WHERE id = ?', [status, id]);
}

const BASELINE = {
  title: 'A 仓 → B 仓',
  cargoKg: 100,
  fromSiteId: 'seed-site-a',
  toSiteId: 'seed-site-b'
};

describe('task.service · 创建', () => {
  let db: Db;
  let ctx: CrudContext;
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('默认落成 draft，编码按当天日期生成，并写一条 create 审计', () => {
    const task = createTask(ctx, { ...BASELINE });
    expect(task.status).toBe('draft');
    expect(task.code).toMatch(/^T\d{8}-0001$/);
    expect(task.progress).toBe(0);
    expect(task.currentPlan).toBeNull();
    expect(task.route).toBeNull();
    expect(task.alerts).toEqual([]);
    expect(auditActions(db)).toEqual(['create']);
  });

  it('同一天第二条任务的编码顺延（删除中间那条也不会撞号）', () => {
    const first = createTask(ctx, { ...BASELINE });
    const second = createTask(ctx, { ...BASELINE, title: '第二条' });
    expect([first.code, second.code].map((code) => code.slice(-4))).toEqual(['0001', '0002']);
    deleteDraftTask(ctx, first.id);
    const third = createTask(ctx, { ...BASELINE, title: '第三条' });
    expect(third.code.slice(-4)).toBe('0003');
  });

  it('submit=true 一步提交：状态 pending + submitted_at + 两条审计（create / submit）', () => {
    const task = createTask(ctx, { ...BASELINE, submit: true });
    expect(task.status).toBe('pending');
    expect(task.submittedAt).not.toBeNull();
    expect(auditActions(db)).toEqual(['create', 'submit']);
  });

  it('套模板：标题/优先级/载重取模板缺省值，结束时间由「时间窗长度」推出', () => {
    const task = createTask(ctx, {
      templateId: 'seed-tpl-std',
      fromSiteId: 'seed-site-a',
      toSiteId: 'seed-site-b',
      timeWindowStart: '2026-09-27T08:00:00.000Z'
    });
    expect(task.title).toBe('仓到仓标准配送');
    expect(task.priority).toBe('normal');
    expect(task.cargoKg).toBe(100);
    // seed 模板的时间窗长度是 60 分钟
    expect(task.timeWindowEnd).toBe('2026-09-27T09:00:00.000Z');
  });

  it('模板要求的起终点类型不符 → 字段级错误（模板上的类型不是装饰品）', () => {
    // TPL-CHG 要求「仓库 → 充电桩」，而 seed-site-b 是仓库
    const error = expectDomainError(
      () =>
        createTask(ctx, {
          templateId: 'seed-tpl-chg',
          fromSiteId: 'seed-site-a',
          toSiteId: 'seed-site-b',
          cargoKg: 10
        }),
      'VALIDATION.FAILED'
    );
    expect(error.detail?.['fields']).toMatchObject({ toSiteId: expect.stringContaining('charging') });
  });

  it('模板不存在 → TEMPLATE.NOT_FOUND', () => {
    expectDomainError(() => createTask(ctx, { ...BASELINE, templateId: 'nope' }), 'TEMPLATE.NOT_FOUND');
  });

  it('起终点站点：不存在 → SITE.NOT_FOUND；已停用 → VALIDATION.FAILED 并标在字段上', () => {
    expectDomainError(() => createTask(ctx, { ...BASELINE, fromSiteId: 'nope' }), 'SITE.NOT_FOUND');
    run(db, "UPDATE sites SET status = 'disabled' WHERE id = 'seed-site-b'");
    const error = expectDomainError(() => createTask(ctx, { ...BASELINE }), 'VALIDATION.FAILED');
    expect(error.detail?.['fields']).toMatchObject({ toSiteId: expect.stringContaining('已停用') });
  });

  it('起终点相同 → 字段级错误（不让 DDL 的 CHECK 当第一道关卡）', () => {
    const error = expectDomainError(
      () => createTask(ctx, { ...BASELINE, toSiteId: 'seed-site-a' }),
      'VALIDATION.FAILED'
    );
    expect(error.detail?.['fields']).toMatchObject({ toSiteId: expect.stringContaining('同一个站点') });
  });
});

describe('task.service · 编辑', () => {
  let db: Db;
  let ctx: CrudContext;
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('draft 可编辑：只改标题时时间窗保持原样（编辑只发改动字段）', () => {
    const task = createTask(ctx, {
      ...BASELINE,
      timeWindowStart: '2026-09-27T08:00:00.000Z',
      timeWindowEnd: '2026-09-27T09:00:00.000Z'
    });
    const updated = updateTask(ctx, task.id, { title: '改了标题' });
    expect(updated.title).toBe('改了标题');
    expect(updated.timeWindowStart).toBe('2026-09-27T08:00:00.000Z');
    expect(updated.timeWindowEnd).toBe('2026-09-27T09:00:00.000Z');
  });

  it('已派发（running）的任务不可编辑 → TASK.STATE_CONFLICT，detail 给出允许的状态', () => {
    // seed 的演示任务就是 running
    const error = expectDomainError(
      () => updateTask(ctx, 'seed-task-demo', { title: '偷偷改' }),
      'TASK.STATE_CONFLICT'
    );
    expect(error.detail).toMatchObject({ from: 'running', expected: ['draft', 'pending', 'failed'] });
  });

  it('时间窗跨字段：只改开始时间时用**库里的旧值**配对判，越界即字段级错误', () => {
    const task = createTask(ctx, {
      ...BASELINE,
      timeWindowStart: '2026-09-27T08:00:00.000Z',
      timeWindowEnd: '2026-09-27T09:00:00.000Z'
    });
    // 把开始时间推到结束时间之后 → 必须被服务层拦下（否则会被 DDL 的 CHECK 拒成 SYS.INTERNAL）
    const error = expectDomainError(
      () => updateTask(ctx, task.id, { timeWindowStart: '2026-09-27T10:00:00.000Z' }),
      'VALIDATION.FAILED'
    );
    expect(error.detail?.['fields']).toMatchObject({ timeWindowEnd: expect.stringContaining('晚于') });
    // 清空时间窗是允许的（显式传 null）
    const cleared = updateTask(ctx, task.id, { timeWindowStart: null, timeWindowEnd: null });
    expect(cleared.timeWindowStart).toBeNull();
    expect(cleared.timeWindowEnd).toBeNull();
  });

  it('编辑不允许改模板（否则「这条任务按哪个模板建的」会变成一个可抹掉的事实）', () => {
    const task = createTask(ctx, { ...BASELINE });
    const error = expectDomainError(
      () => updateTask(ctx, task.id, { templateId: 'seed-tpl-std' }),
      'VALIDATION.FAILED'
    );
    expect(error.detail?.['fields']).toMatchObject({ templateId: expect.stringContaining('创建时') });
  });
});

describe('task.service · 状态操作', () => {
  let db: Db;
  let ctx: CrudContext;
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('submit：draft → pending，返回 transition，并写一条以动作名为名的审计', () => {
    const task = createTask(ctx, { ...BASELINE });
    const result = operateTask(ctx, task.id, 'submit', {});
    expect(result.status).toBe('pending');
    expect(result.transition).toEqual({ from: 'draft', to: 'pending' });
    expect(auditActions(db)).toEqual(['create', 'submit']);
  });

  it('非法迁移：草稿上点「暂停」→ TASK.STATE_CONFLICT，detail 说明当前与期望', () => {
    const task = createTask(ctx, { ...BASELINE });
    const error = expectDomainError(() => operateTask(ctx, task.id, 'pause', { reason: 'x' }), 'TASK.STATE_CONFLICT');
    expect(error.detail).toMatchObject({ action: 'pause', from: 'draft', expected: ['running'] });
    expect(error.message).toContain('draft');
    expect(error.message).toContain('running');
  });

  it('必填原因：缺 reason 或只给空白 → VALIDATION.FAILED，且库里的状态没变', () => {
    setTaskStatus(db, 'seed-task-demo', 'running');
    expectDomainError(() => operateTask(ctx, 'seed-task-demo', 'pause', {}), 'VALIDATION.FAILED');
    expectDomainError(() => operateTask(ctx, 'seed-task-demo', 'pause', { reason: '   ' }), 'VALIDATION.FAILED');
    expect(getTaskDetail(db, 'seed-task-demo')?.status).toBe('running');
  });

  it('pause / resume：暂停原因写进库，恢复时清空（不留下已翻篇的旧原因）', () => {
    const paused = operateTask(ctx, 'seed-task-demo', 'pause', { reason: '前方拥堵' });
    expect(paused.status).toBe('paused');
    expect(paused.pauseReason).toBe('前方拥堵');
    expect(paused.transition).toEqual({ from: 'running', to: 'paused' });

    const resumed = operateTask(ctx, 'seed-task-demo', 'resume', {});
    expect(resumed.status).toBe('running');
    expect(resumed.pauseReason).toBeNull();
    expect(auditActions(db)).toEqual(['pause', 'resume']);
  });

  it('cancel：回收车辆到 idle、清掉派发痕迹、计划置 cancelled、写取消原因', () => {
    insertPlan(db, 'seed-task-demo', 'seed-veh-agv01');
    const result = operateTask(ctx, 'seed-task-demo', 'cancel', { reason: '客户取消' });
    expect(result.status).toBe('cancelled');
    expect(result.cancelReason).toBe('客户取消');
    expect(result.assignedVehicleId).toBeNull();
    expect(result.currentPlan).toBeNull();
    // 车辆回到 idle（Req-M3-6）
    expect(all<{ status: string }>(db, "SELECT status FROM vehicles WHERE id = 'seed-veh-agv01'")[0]?.status).toBe('idle');
    // 旧计划不删除，只改状态（D-04）
    expect(all<{ status: string }>(db, "SELECT status FROM dispatch_plans WHERE task_id = 'seed-task-demo'")[0]?.status).toBe('cancelled');
    const audit = all<{ action: string; before: string | null }>(
      db,
      "SELECT action, before FROM audit_logs WHERE action = 'cancel'"
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.before).toContain('running');
  });

  it('cancel：车辆处于故障时**不谎报 idle**，并把提示写进审计消息', () => {
    setVehicleStatus(db, 'seed-veh-agv01', 'fault', '2026-09-26T00:00:00.000Z');
    operateTask(ctx, 'seed-task-demo', 'cancel', { reason: '车坏了' });
    expect(all<{ status: string }>(db, "SELECT status FROM vehicles WHERE id = 'seed-veh-agv01'")[0]?.status).toBe('fault');
    const audit = all<{ message: string | null }>(db, "SELECT message FROM audit_logs WHERE action = 'cancel'")[0];
    expect(audit?.message).toContain('未回 idle');
  });

  it('reassign：回到 pending、车辆回收、原计划置 superseded（不是 cancelled）', () => {
    insertPlan(db, 'seed-task-demo', 'seed-veh-agv01');
    const result = operateTask(ctx, 'seed-task-demo', 'reassign', { reason: '换台车' });
    expect(result.status).toBe('pending');
    expect(result.transition).toEqual({ from: 'running', to: 'pending' });
    expect(result.assignedVehicleId).toBeNull();
    expect(all<{ status: string }>(db, "SELECT status FROM dispatch_plans WHERE task_id = 'seed-task-demo'")[0]?.status).toBe('superseded');
  });

  it('requeue：失败 → 候选池，并把上次的失败原因清掉', () => {
    run(
      db,
      "UPDATE tasks SET status = 'failed', fail_reason = '执行器超时' WHERE id = 'seed-task-demo'"
    );
    const result = operateTask(ctx, 'seed-task-demo', 'requeue', { reason: '已恢复' });
    expect(result.status).toBe('pending');
    expect(result.failReason).toBeNull();
    expect(auditActions(db)).toEqual(['requeue']);
  });

  it('状态机执行器对内部动作同样可用（M4 / M7 将来直接复用，不必再写一套副作用）', () => {
    setTaskStatus(db, 'seed-task-demo', 'pending');
    const assigned = operateTask(ctx, 'seed-task-demo', 'assign', {});
    expect(assigned.status).toBe('assigned');
    expect(assigned.assignedAt).not.toBeNull();
  });
});

describe('task.service · 删除', () => {
  let db: Db;
  let ctx: CrudContext;
  beforeEach(() => {
    ({ db, ctx } = setup());
  });

  it('草稿可物理删除：审计留下 before 快照，行本身消失', () => {
    const task = createTask(ctx, { ...BASELINE });
    const result = deleteDraftTask(ctx, task.id);
    expect(result.id).toBe(task.id);
    expect(getTaskDetail(db, task.id)).toBeUndefined();
    expect(listTasks(db, { page: 1, pageSize: 50 }).records.map((row) => row.id)).not.toContain(task.id);
    const audit = all<{ action: string; before: string | null; after: string | null }>(
      db,
      "SELECT action, before, after FROM audit_logs WHERE action = 'delete'"
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.before).toContain(task.code);
    expect(audit[0]?.after).toBeNull();
  });

  it('非草稿删除 → TASK.STATE_CONFLICT，并提示改用「取消」', () => {
    const error = expectDomainError(() => deleteDraftTask(ctx, 'seed-task-demo'), 'TASK.STATE_CONFLICT');
    expect(error.detail).toMatchObject({ action: 'delete', from: 'running', expected: ['draft'] });
    expect(String(error.detail?.['hint'])).toContain('取消');
    // 任务仍在
    expect(getTaskDetail(db, 'seed-task-demo')?.status).toBe('running');
  });
});
