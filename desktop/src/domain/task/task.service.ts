/**
 * 任务领域服务（M3，`docs/api.md` §3.3）。
 *
 * ## 方法分工
 *
 *   - `createTask`：建任务（可套模板、可一步提交）；
 *   - `updateTask`：编辑（只有 `draft` / `pending` / `failed` 可编辑，Req-M3-3）；
 *   - `operateTask`：状态操作（六个 `POST …/{action}` 的公共实现）；
 *   - `deleteDraftTask`：物理删除草稿；
 *   - `applyTaskTransition`（内部）：**状态机执行器**，供本文件与将来的
 *     M4（`assign`）/ M7（`start` / `complete` / `fail`）复用同一套副作用。
 *
 * ## 每个方法的固定顺序
 *
 * 读旧值 → 状态机校验 → 跨表校验 → 写表（含副作用）→ 写审计 → 返回新值，
 * 全部在**一个事务**里。事件由调用点（`ipc/api.ts`）在事务提交**之后**发
 * （理由见 `../base/context.js`）。
 *
 * ## 状态机不在这里定义
 *
 * 「这个状态能不能那样改」的唯一作者是 `@udm/shared` 的 `task-state.ts`：
 * M4 与 M7 也要判同一批迁移。若在这里再写一遍 `if (status === 'running')`，
 * 三处判据迟早分叉，而分叉的后果是任务进入一个没有任何模块认可的状态。
 */
import { randomUUID } from 'node:crypto';
import {
  DomainError,
  FIELD_LIMITS,
  TASK_EDITABLE_STATUSES,
  checkTaskTransition,
  taskEndpointError,
  taskWindowError,
  validateTaskInput,
  type TaskAction,
  type TaskDetail,
  type TaskListItem,
  type TaskStatus,
  type TaskTransitionInfo
} from '@udm/shared';
import { nowIso, tx } from '../../db/index.js';
import { findSiteById } from '../../db/repositories/site.repo.js';
import { findTemplateById } from '../../db/repositories/template.repo.js';
import {
  deleteTask,
  findTaskById,
  findTaskRowById,
  getTaskDetail,
  insertTask,
  nextTaskCode,
  releaseTaskPlans,
  transitionTask,
  updateTaskRow,
  type TaskStampColumn
} from '../../db/repositories/task.repo.js';
import { findVehicleById, setVehicleStatus } from '../../db/repositories/vehicle.repo.js';
import { writeAudit, type AuditActor } from '../../services/audit.js';
import { toAuditActor, type CrudContext } from '../base/context.js';
import { invalid } from '../base/validate.js';

/** 状态操作的成功返回：详情 + 本次迁移（`docs/api.md` §3.3.7）。 */
export type TaskOperationResult = TaskDetail & { transition: TaskTransitionInfo };

function requireTask(ctx: CrudContext, id: string): TaskListItem {
  const task = findTaskById(ctx.db, id);
  if (!task) {
    throw new DomainError('TASK.NOT_FOUND', undefined, { id });
  }
  return task;
}

/** 详情读取：同时充当「写完之后回读新值」的唯一入口，避免各处自己拼 DTO。 */
function requireDetail(ctx: CrudContext, id: string): TaskDetail {
  const detail = getTaskDetail(ctx.db, id);
  if (!detail) {
    throw new DomainError('TASK.NOT_FOUND', undefined, { id });
  }
  return detail;
}

function actorOf(ctx: CrudContext): AuditActor | null {
  return toAuditActor(ctx.actor);
}

/**
 * 起终点站点必须是**存在且启用**的（`docs/api.md` §3.3 的字段说明）。
 *
 * 两种情况给不同的错误：不存在 → `SITE.NOT_FOUND`（这个 id 本身就是错的）；
 * 存在但停用 → `VALIDATION.FAILED` 并标在对应字段上。后者要的是**字段级可引导**
 * —— 使用者需要知道「是那个被我停用掉的仓库」，而一句笼统的 404 帮不上忙。
 */
function ensureSiteUsable(ctx: CrudContext, siteId: string, field: 'fromSiteId' | 'toSiteId'): void {
  const site = findSiteById(ctx.db, siteId);
  if (!site) {
    throw new DomainError('SITE.NOT_FOUND', undefined, { [field]: siteId });
  }
  if (site.status !== 'enabled') {
    throw invalid({ [field]: `站点 ${site.code} 已停用，不能作为任务起终点` });
  }
}

/** 时间窗：要么都不给，要么成对且 `end > start`（判据见 `task-rules.ts`）。 */
function ensureTaskWindow(start: string | null, end: string | null): void {
  const error = taskWindowError(start, end);
  if (error) {
    throw invalid({ timeWindowEnd: error });
  }
}

function ensureTaskEndpoints(fromSiteId: string, toSiteId: string): void {
  const error = taskEndpointError(fromSiteId, toSiteId);
  if (error) {
    throw invalid({ toSiteId: error });
  }
}

/**
 * 套模板：把模板的缺省值补进请求（**只补请求里没给的字段**，显式 `null` 表示「就是不要」）。
 *
 * 模板同时承担两个约束：站点类型（`fromSiteType` / `toSiteType`）—— 那两个不是默认值
 * 而是**校验**：模板写着「仓库 → 充电桩」，起终点类型不符就该拒绝。
 * 否则模板上的这两个字段是装饰品，而使用者以为它们生效了（与 D-19 同类）。
 */
function applyTemplate(
  ctx: CrudContext,
  raw: Record<string, unknown>
): { effective: Record<string, unknown>; template: ReturnType<typeof findTemplateById> } {
  const templateId = raw['templateId'];
  if (templateId === undefined || templateId === null || templateId === '') {
    return { effective: raw, template: undefined };
  }
  const template = typeof templateId === 'string' ? findTemplateById(ctx.db, templateId) : undefined;
  if (!template) {
    throw new DomainError('TEMPLATE.NOT_FOUND', undefined, { templateId });
  }
  const effective: Record<string, unknown> = { ...raw };
  // 标题缺省时用模板名：套模板的意义就是「少填几个字段」
  if (effective['title'] === undefined && template.name) {
    effective['title'] = template.name;
  }
  if (effective['priority'] === undefined) {
    effective['priority'] = template.priority;
  }
  if (effective['cargoKg'] === undefined && template.defaultCargoKg !== null) {
    effective['cargoKg'] = template.defaultCargoKg;
  }
  // 结束时间可以由模板的「时间窗长度（分钟）」推出 —— 但必须已有开始时间
  const start = effective['timeWindowStart'];
  if (effective['timeWindowEnd'] === undefined && typeof start === 'string' && template.timeWindowMinutes !== null) {
    const startMs = Date.parse(start);
    if (!Number.isNaN(startMs)) {
      effective['timeWindowEnd'] = new Date(startMs + template.timeWindowMinutes * 60_000).toISOString();
    }
  }
  return { effective, template };
}

/** 模板声明的起终点类型约束（模板里为 `null` 的一侧不限）。 */
function ensureTemplateSiteTypes(
  ctx: CrudContext,
  template: NonNullable<ReturnType<typeof findTemplateById>>,
  fromSiteId: string,
  toSiteId: string
): void {
  const fields: Record<string, string> = {};
  const from = findSiteById(ctx.db, fromSiteId);
  const to = findSiteById(ctx.db, toSiteId);
  if (template.fromSiteType !== null && from && from.type !== template.fromSiteType) {
    fields['fromSiteId'] = `模板 ${template.code} 要求起点类型为 ${template.fromSiteType}，当前是 ${from.type}`;
  }
  if (template.toSiteType !== null && to && to.type !== template.toSiteType) {
    fields['toSiteId'] = `模板 ${template.code} 要求终点类型为 ${template.toSiteType}，当前是 ${to.type}`;
  }
  if (Object.keys(fields).length > 0) {
    throw invalid(fields);
  }
}

/**
 * 建任务（`docs/api.md` §3.3.3）。
 *
 * `submit=true` 时**在同一个事务里**推到 `pending`：分两个事务的话，第一步成功、
 * 第二步失败会留下一条「使用者以为提交了、其实还是草稿」的任务，而界面提示是错误。
 */
export function createTask(ctx: CrudContext, raw: Record<string, unknown>): TaskDetail {
  return tx(ctx.db, () => {
    const { effective, template } = applyTemplate(ctx, raw);
    const parsed = validateTaskInput(effective, 'create');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const input = parsed.value;
    ensureTaskEndpoints(input.fromSiteId, input.toSiteId);
    ensureSiteUsable(ctx, input.fromSiteId, 'fromSiteId');
    ensureSiteUsable(ctx, input.toSiteId, 'toSiteId');
    if (template) {
      ensureTemplateSiteTypes(ctx, template, input.fromSiteId, input.toSiteId);
    }
    const at = nowIso();
    const id = randomUUID();
    insertTask(ctx.db, {
      id,
      code: nextTaskCode(ctx.db, at.slice(0, 10).replace(/-/g, '')),
      templateId: input.templateId,
      title: input.title,
      status: 'draft',
      priority: input.priority,
      cargoKg: input.cargoKg,
      cargoDesc: input.cargoDesc,
      fromSiteId: input.fromSiteId,
      toSiteId: input.toSiteId,
      timeWindowStart: input.timeWindowStart,
      timeWindowEnd: input.timeWindowEnd,
      at,
      actorName: ctx.actor?.actorName ?? null
    });
    const created = requireTask(ctx, id);
    writeAudit(ctx.db, actorOf(ctx), {
      module: 'task',
      action: 'create',
      objectType: 'task',
      objectId: id,
      after: created
    });
    if (raw['submit'] === true) {
      // 一步提交：走与 `POST /{id}/submit` **完全同一条**状态机路径（含审计与副作用）
      applyTaskTransition(ctx, created, 'submit', null);
    }
    return requireDetail(ctx, id);
  });
}

/**
 * 编辑任务（`docs/api.md` §3.3.5）。
 *
 * 可编辑状态只有 `draft` / `pending` / `failed`（Req-M3-3）：改已派发任务的起终点
 * 会让路线与计划失效，而它此刻可能正在路上 —— 那种情况正确的动作是「重派」或「取消」。
 */
export function updateTask(ctx: CrudContext, id: string, raw: Record<string, unknown>): TaskDetail {
  return tx(ctx.db, () => {
    const before = requireTask(ctx, id);
    // 可编辑状态的唯一作者是 `@udm/shared` 的 `TASK_EDITABLE_STATUSES`（界面用的是同一份）
    const editable = TASK_EDITABLE_STATUSES;
    if (!editable.includes(before.status)) {
      throw new DomainError('TASK.STATE_CONFLICT', undefined, {
        id,
        from: before.status,
        expected: editable,
        hint: '已派发的任务请用「重派」或「取消」，不要直接编辑'
      });
    }
    const parsed = validateTaskInput(raw, 'patch');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const patch = parsed.value;
    ensureTaskEndpoints(patch.fromSiteId ?? before.fromSiteId, patch.toSiteId ?? before.toSiteId);
    if (patch.fromSiteId !== undefined) {
      ensureSiteUsable(ctx, patch.fromSiteId, 'fromSiteId');
    }
    if (patch.toSiteId !== undefined) {
      ensureSiteUsable(ctx, patch.toSiteId, 'toSiteId');
    }
    // 时间窗用**新旧配对**判（只改一端时另一端取库里的旧值）。少了这一步，请求会通过
    // 字段校验、却被 DDL 的 CHECK 拒掉，报出来是 `SYS.INTERNAL`（看不出原因的 500）
    const row = findTaskRowById(ctx.db, id);
    const nextStart = patch.timeWindowStart === undefined ? (row?.time_window_start ?? null) : patch.timeWindowStart;
    const nextEnd = patch.timeWindowEnd === undefined ? (row?.time_window_end ?? null) : patch.timeWindowEnd;
    ensureTaskWindow(nextStart, nextEnd);
    updateTaskRow(ctx.db, id, patch, nowIso(), ctx.actor?.actorName ?? null);
    const after = requireTask(ctx, id);
    writeAudit(ctx.db, actorOf(ctx), {
      module: 'task',
      action: 'update',
      objectType: 'task',
      objectId: id,
      before,
      after
    });
    return requireDetail(ctx, id);
  });
}

/**
 * 回收车辆（取消 / 重派的前置，Req-M3-6）。
 *
 * **只在车辆确实被占用时才回 `idle`**：故障、离线、充电中、已停用的车回 `idle`
 * 是**谎报状态** —— 它会立刻重新出现在调度候选池里，而那些状态本来就是要把它挡在外面的。
 * 这种情况保留原状态并返回 `released: false`，由调用点把提示写进审计消息。
 *
 * 同理不动 `load_kg`：卸没卸货由执行器说了算，任务层改载重等于替它做了决定。
 */
function releaseVehicle(ctx: CrudContext, vehicleId: string, at: string): { released: boolean; status: string } {
  const vehicle = findVehicleById(ctx.db, vehicleId);
  if (!vehicle) {
    return { released: false, status: 'missing' };
  }
  if (vehicle.status !== 'busy' && vehicle.status !== 'reserved') {
    return { released: false, status: vehicle.status };
  }
  setVehicleStatus(ctx.db, vehicleId, 'idle', at);
  return { released: true, status: 'idle' };
}

/** 各动作要打的时间戳列（`submit` 之外的动作不重复打 `submitted_at`）。 */
const STAMPS: Partial<Record<TaskAction, TaskStampColumn[]>> = {
  submit: ['submitted_at'],
  assign: ['assigned_at'],
  start: ['started_at'],
  complete: ['finished_at'],
  cancel: ['cancelled_at'],
  fail: ['failed_at']
};

/**
 * 状态机执行器：**把一次合法迁移的副作用写全**（内部函数，不开关事务）。
 *
 * 之所以不是 `operateTask` 的一部分：`createTask(submit=true)` 需要在**自己的事务里**
 * 再走一次 `submit`，而 `tx()` 嵌套会在 `node:sqlite` 的嵌套 `BEGIN` 上直接抛错
 * —— 那个错误只会在「一步提交」这条相对少用的路径上显形。
 */
function applyTaskTransition(
  ctx: CrudContext,
  before: TaskListItem,
  action: TaskAction,
  reason: string | null
): TaskOperationResult {
  const check = checkTaskTransition(action, before.status);
  if (!check.ok) {
    throw new DomainError('TASK.STATE_CONFLICT', check.failure.message, {
      id: before.id,
      action,
      from: check.failure.from,
      expected: check.failure.expected,
      to: check.failure.to
    });
  }
  const transition = check.transition;
  if (transition.requiresReason && (reason === null || reason === '')) {
    // 原因不是可选信息：`cancel_reason` 是后来者判断「这条任务为什么不跑了」的唯一线索
    throw invalid({ reason: `${action} 必须给出原因` });
  }
  const at = nowIso();
  const write: Parameters<typeof transitionTask>[2] = {
    status: transition.to as TaskStatus,
    at,
    updatedBy: ctx.actor?.actorName ?? null,
    stamps: STAMPS[action]
  };
  let note: string | null = null;

  if (action === 'cancel' || action === 'reassign') {
    // 已派发的先回收车辆与计划（`design.md` §4.3：「已派发需先回收车辆」）
    const vehicleId = before.assignedVehicleId;
    if (vehicleId) {
      const outcome = releaseVehicle(ctx, vehicleId, at);
      if (!outcome.released) {
        note = `车辆 ${before.vehicleCode ?? vehicleId} 未回 idle（当前 ${outcome.status}），需人工处理`;
      }
    }
    releaseTaskPlans(ctx.db, before.id, action === 'reassign' ? 'superseded' : 'cancelled');
    // 派发痕迹必须清掉：否则详情页会出现「状态：待派发」+「车辆：AGV-01」这种自相矛盾的组合，
    // 而且下一次调度还会以为这条任务已经有车了
    write.assignedVehicleId = null;
    write.planId = null;
  }
  if (action === 'cancel') {
    write.cancelReason = reason;
  }
  if (action === 'requeue') {
    // 重排回候选池：清掉上次的失败原因，否则列表里会一直挂着一个已经翻篇的理由
    write.failReason = null;
  }
  if (action === 'pause') {
    write.pauseReason = reason;
  }
  if (action === 'resume') {
    write.pauseReason = null;
  }
  transitionTask(ctx.db, before.id, write);
  const after = requireTask(ctx, before.id);
  writeAudit(ctx.db, actorOf(ctx), {
    module: 'task',
    action,
    objectType: 'task',
    objectId: before.id,
    before,
    after,
    // 只在真有提示时才带 message：`null` 会被审计层当成「有值但为空」而写进库里
    ...(note ? { message: note } : {})
  });
  return { ...requireDetail(ctx, before.id), transition: { from: before.status, to: after.status } };
}

/**
 * 状态操作（`docs/api.md` §3.3.6 的六个动作）。
 *
 * **接受任意已登记的动作**（含 M4 / M7 专用的 `assign` / `start` / `complete` / `fail`）：
 * 它是状态机执行器，不该知道「谁在调我」。**对外暴露面由路由控制** ——
 * `ipc/api.ts` 只注册 `TASK_API_ACTIONS` 里的动作，因此使用者无法把任务手工标成「执行中」，
 * 而 M4 / M7 落地时能直接复用这里（含车辆回收、原因清空这些副作用）。
 */
export function operateTask(
  ctx: CrudContext,
  id: string,
  action: TaskAction,
  payload: Record<string, unknown>
): TaskOperationResult {
  return tx(ctx.db, () => {
    const before = requireTask(ctx, id);
    return applyTaskTransition(ctx, before, action, readReason(payload));
  });
}

/** 原因字段：可选动作传了就记；必填动作缺了由状态机执行器报错。 */
function readReason(payload: Record<string, unknown>): string | null {
  const value = payload['reason'];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw invalid({ reason: '必须是字符串' });
  }
  const trimmed = value.trim();
  if (trimmed.length > FIELD_LIMITS.reason) {
    throw invalid({ reason: `长度不能超过 ${FIELD_LIMITS.reason}` });
  }
  return trimmed === '' ? null : trimmed;
}

/**
 * 物理删除草稿（`docs/api.md` §3.3.6 的 `DELETE`）。
 *
 * 只有 `draft` 能删，其余状态一律走 `cancel`（软删、留痕）。这条判定与状态机里的
 * `delete.from` 是**同一个事实**，因此复用 `checkTaskTransition` 判一次 ——
 * 删除是「移出表」而不是「改状态」，无法表达成一次 `transitionTask` 写入。
 */
export function deleteDraftTask(ctx: CrudContext, id: string): { id: string; transition: TaskTransitionInfo } {
  return tx(ctx.db, () => {
    const before = requireTask(ctx, id);
    const check = checkTaskTransition('delete', before.status);
    if (!check.ok) {
      throw new DomainError('TASK.STATE_CONFLICT', check.failure.message, {
        id,
        action: 'delete',
        from: check.failure.from,
        expected: check.failure.expected,
        hint: '只有草稿可以删除；其余状态请用「取消」'
      });
    }
    writeAudit(ctx.db, actorOf(ctx), {
      module: 'task',
      action: 'delete',
      objectType: 'task',
      objectId: id,
      before,
      after: null
    });
    deleteTask(ctx.db, id);
    return { id, transition: { from: before.status, to: before.status } };
  });
}
