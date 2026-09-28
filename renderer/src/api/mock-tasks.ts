/**
 * Mock 适配器的 **M3 任务读写**（浏览器形态）。
 *
 * ## 与主进程的两处分工
 *
 *   - **规则共享**：状态机来自 `@udm/shared` 的 `task-state.ts`，字段规则来自 `task-rules.ts`
 *     —— 与领域服务读的是同一份。因此「什么迁移合法」「什么输入合法」不可能分叉；
 *   - **存储各自**：主进程写 SQLite，这里改内存数组。这一段必然有两份实现，
 *     口径由 `mock-parity.test.ts` 用同一批请求打两边来锁死。
 *
 * ## 三条必须逐字对齐的地方（对不齐只在浏览器里显形，最容易被当成「Mock 不准」而放过）
 *
 *   1. **排序**：`createdAt DESC, code DESC`（`task.repo.ts` 的 `TASK_ORDER`）——
 *      顺序不一致会让同一页在两种形态下是不同的行（`ISS-059` 已经踩过一次）；
 *   2. **详情里的派生字段**：`fromSiteName` / `toSiteName` / `vehicleCode` 现算，
 *      并且**改站点名之后列表要跟着变**（主进程是 join，天然如此）；
 *   3. **副作用**：取消 / 重派要回收车辆、清派发痕迹，暂停要写原因、恢复要清空 ——
 *      少一条就会出现「浏览器里一切正常，进 Electron 后车辆状态不对」。
 *
 * 审计在 Mock 侧**不写**（它没有审计表）：这一点是「演示形态」的已知边界，
 * 与 M2 的写路径同一处理。
 */
import {
  ERROR_CODES,
  TASK_EDITABLE_STATUSES,
  checkTaskTransition,
  taskEndpointError,
  taskWindowError,
  validateTaskInput,
  type ApiResult,
  type ErrorCode,
  type SiteType,
  type TaskAction,
  type TaskDetail,
  type TaskListItem,
  type TaskStatus
} from '@udm/shared';
import type { HttpMethod } from './client';
import { TASK_API_ACTIONS } from '@udm/shared';
import type { MockBaseData, MockTaskStore } from './mock-data';

export interface MockTaskRequest {
  method: HttpMethod;
  /** 去掉前导空段后的路径片段：`['api','tasks','abc','pause']`。 */
  segments: string[];
  payload: Record<string, unknown>;
}

function fail(code: ErrorCode, detail?: Record<string, unknown>): ApiResult<never> {
  const definition = ERROR_CODES[code];
  return { code, message: definition.message, source: definition.source, ...(detail ? { detail } : {}) };
}

function ok<T>(data: T): ApiResult<T> {
  return { code: 0, message: 'success', data };
}

/**
 * 与 `fail` 相同，但**自定义 message**。
 *
 * 主进程抛 `DomainError(code, message, detail)` 时，信封里的 `message` 是自定义文案
 * （如「当前状态 draft 不能执行 pause…」），而不是错误目录里的默认文案。
 * Mock 若不跟着覆盖 message，两种形态下同一请求的 `message` 就不同 ——
 * 前端只读 message 的地方（如顶部的整条错误提示）会在浏览器里显示一句泛泛的默认文案。
 */
function failWith(code: ErrorCode, message: string, detail?: Record<string, unknown>): ApiResult<never> {
  const definition = ERROR_CODES[code];
  return { code, message, source: definition.source, ...(detail ? { detail } : {}) };
}

const MOCK_AT = '2026-01-01T00:00:00.000Z';

let seq = 0;
function nextId(): string {
  seq += 1;
  return `mock-task-${seq}`;
}

/** 与主进程 `nextTaskCode` 同规则：当天最大号 +1。 */
function nextCode(rows: TaskDetail[], serviceDate: string): string {
  const prefix = `T${serviceDate}-`;
  const numbers = rows
    .filter((row) => row.code.startsWith(prefix))
    .map((row) => Number(row.code.slice(prefix.length)))
    .filter((value) => Number.isFinite(value));
  const next = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

/**
 * 详情读取：派生字段**每次现算**。
 *
 * 不缓存站点名与车辆编码：那样「改了站点名，列表还是旧名字」——
 * 而主进程是 join，天然每次都是新值。这类差异在演示时看不出来，
 * 一旦拿去核对数据就会发现两边不一致。
 */
function detailOf(store: MockTaskStore, baseData: MockBaseData, id: string): TaskDetail | undefined {
  const row = store.rows.find((item) => item.id === id);
  if (!row) {
    return undefined;
  }
  const from = baseData.sites.find((site) => site.id === row.fromSiteId);
  const to = baseData.sites.find((site) => site.id === row.toSiteId);
  const vehicle = baseData.vehicles.find((item) => item.id === row.assignedVehicleId);
  return {
    ...row,
    fromSiteName: from?.name ?? null,
    toSiteName: to?.name ?? null,
    vehicleCode: vehicle?.code ?? null,
    // 派发痕迹与当前计划必须同步：任务被取消 / 重派后 `assignedVehicleId` 已是 null，
    // 若这里还返回旧的计划，页面会显示「待派发 + 当前计划 AGV-01」
    currentPlan: row.assignedVehicleId ? row.currentPlan : null
  };
}

/**
 * 详情 → 列表项的投影。
 *
 * **为什么要显式挑字段**：列表接口（`docs/api.md` §3.3.1）只给
 * `TaskListItem` 的字段，而详情多了 `templateId` / `route` / 计划 / 告警 / 操作记录。
 * 若列表直接把详情对象丢出去，浏览器形态下会比真机多出几个键 ——
 * 前端据此渲染的列在 Electron 下会全部变成 `undefined`，
 * 而 `mock-parity.test.ts` 正是靠逐字段比对把这类差异逼出来的。
 */
function toListItem(detail: TaskDetail): TaskListItem {
  return {
    id: detail.id,
    code: detail.code,
    title: detail.title,
    status: detail.status,
    priority: detail.priority,
    cargoKg: detail.cargoKg,
    fromSiteId: detail.fromSiteId,
    toSiteId: detail.toSiteId,
    fromSiteName: detail.fromSiteName,
    toSiteName: detail.toSiteName,
    timeWindowStart: detail.timeWindowStart,
    timeWindowEnd: detail.timeWindowEnd,
    assignedVehicleId: detail.assignedVehicleId,
    vehicleCode: detail.vehicleCode,
    progress: detail.progress,
    createdAt: detail.createdAt,
    createdBy: detail.createdBy
  };
}

/** 任务的读接口（列表 / 详情）。认不出路径时返回 `null`，由调用点回落 404。 */
export function mockTaskRead(
  store: MockTaskStore,
  baseData: MockBaseData,
  path: string,
  payload: Record<string, unknown>
): ApiResult<unknown> | null {
  if (path === '/api/tasks') {
    const rawPage = Number(payload.page ?? 1);
    const rawSize = Number(payload.pageSize ?? 20);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const pageSize = Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(Math.floor(rawSize), 200) : 20;

    // `?status=` 逗号多值（与主进程 `parseTaskStatusFilter` 同口径：非法值直接报错）
    let statuses: TaskStatus[] | undefined;
    const rawStatus = typeof payload.status === 'string' ? payload.status.trim() : '';
    if (rawStatus) {
      const parts = rawStatus
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      const allowed: readonly string[] = ['draft', 'pending', 'assigned', 'running', 'paused', 'finished', 'cancelled', 'failed'];
      const unknown = parts.filter((part) => !allowed.includes(part));
      if (unknown.length > 0) {
        return fail('VALIDATION.FAILED', {
          fields: { status: `取值必须是 ${allowed.join(' / ')} 之一或它们的逗号组合，收到：${unknown.join(', ')}` }
        });
      }
      statuses = parts as TaskStatus[];
    }
    const priority = payload.priority === undefined || payload.priority === '' ? undefined : payload.priority;
    if (priority !== undefined && !['low', 'normal', 'high', 'urgent'].includes(String(priority))) {
      return fail('VALIDATION.FAILED', { fields: { priority: '取值必须是 low / normal / high / urgent 之一' } });
    }
    const vehicleId = typeof payload.vehicleId === 'string' && payload.vehicleId ? payload.vehicleId : undefined;
    const from = typeof payload.from === 'string' && payload.from ? payload.from : undefined;
    const to = typeof payload.to === 'string' && payload.to ? payload.to : undefined;
    const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim().toLowerCase() : '';

    const matched = store.rows
      .map((row) => toListItem(detailOf(store, baseData, row.id) as TaskDetail))
      .filter((row) => {
        if (statuses && !statuses.includes(row.status)) return false;
        if (priority !== undefined && row.priority !== priority) return false;
        if (vehicleId && row.assignedVehicleId !== vehicleId) return false;
        // 时间范围只筛**有时间窗**的任务（与 SQL 的 `time_window_start IS NOT NULL` 一致）
        if (from && !(row.timeWindowStart !== null && row.timeWindowStart >= from)) return false;
        if (to && !(row.timeWindowStart !== null && row.timeWindowStart <= to)) return false;
        if (keyword && !(row.code.toLowerCase().includes(keyword) || row.title.toLowerCase().includes(keyword))) return false;
        return true;
      })
      // 与 `task.repo.ts` 的 `TASK_ORDER` 同序（见文件头第 1 条）
      .sort((a, b) => (a.createdAt === b.createdAt ? b.code.localeCompare(a.code) : b.createdAt.localeCompare(a.createdAt)));

    const start = (page - 1) * pageSize;
    return ok({ records: matched.slice(start, start + pageSize), total: matched.length, page, pageSize });
  }

  const single = /^\/api\/tasks\/([^/]+)$/.exec(path);
  if (single) {
    const detail = detailOf(store, baseData, decodeURIComponent(single[1] as string));
    if (!detail) {
      return fail('TASK.NOT_FOUND', { id: single[1] });
    }
    return ok(detail);
  }
  return null;
}

/** 任务的写接口（创建 / 编辑 / 删除 / 六个状态操作）。 */
export function mockTaskWrite(
  store: MockTaskStore,
  baseData: MockBaseData,
  request: MockTaskRequest
): ApiResult<unknown> | null {
  const { method, segments, payload } = request;
  const id = segments[2];

  if (method === 'POST' && segments.length === 2) {
    return createTask(store, baseData, payload);
  }
  if (!id) {
    return null;
  }
  if (method === 'PUT' && segments.length === 3) {
    return updateTask(store, baseData, id, payload);
  }
  if (method === 'DELETE' && segments.length === 3) {
    return removeTask(store, id);
  }
  if (method === 'POST' && segments.length === 4) {
    const action = segments[3] as string;
    // 暴露面同样由状态机决定（与主进程的路由层同一判据）
    if (!(TASK_API_ACTIONS as readonly string[]).includes(action) || action === 'delete') {
      return fail('API.ROUTE_NOT_FOUND', { path: `/api/tasks/${id}/${action}` });
    }
    return transitionTask(store, baseData, id, action as TaskAction, payload);
  }
  return null;
}

function createTask(store: MockTaskStore, baseData: MockBaseData, payload: Record<string, unknown>): ApiResult<unknown> {
  const effective: Record<string, unknown> = { ...payload };
  // 套模板：与主进程 `applyTemplate` 同口径（补缺省、类型约束校验）
  const templateId = payload.templateId;
  if (typeof templateId === 'string' && templateId) {
    const template = baseData.templates.find((item) => item.id === templateId);
    if (!template) {
      return fail('TEMPLATE.NOT_FOUND', { templateId });
    }
    if (effective.title === undefined) effective.title = template.name;
    if (effective.priority === undefined) effective.priority = template.priority;
    if (effective.cargoKg === undefined && template.defaultCargoKg !== null) effective.cargoKg = template.defaultCargoKg;
    const start = effective.timeWindowStart;
    if (
      effective.timeWindowEnd === undefined &&
      typeof start === 'string' &&
      template.timeWindowMinutes !== null &&
      !Number.isNaN(Date.parse(start))
    ) {
      effective.timeWindowEnd = new Date(Date.parse(start) + template.timeWindowMinutes * 60_000).toISOString();
    }
  }

  const parsed = validateTaskInput(effective, 'create');
  if (!parsed.ok) {
    return fail('VALIDATION.FAILED', { fields: parsed.fields });
  }
  const input = parsed.value;
  const endpoints = taskEndpointError(input.fromSiteId, input.toSiteId);
  if (endpoints) {
    return fail('VALIDATION.FAILED', { fields: { toSiteId: endpoints } });
  }
  const siteCheck = ensureSites(baseData, input.fromSiteId, input.toSiteId);
  if (siteCheck) {
    return siteCheck;
  }
  if (typeof templateId === 'string' && templateId) {
    const template = baseData.templates.find((item) => item.id === templateId);
    const typeCheck = template ? ensureTemplateTypes(baseData, template, input.fromSiteId, input.toSiteId) : null;
    if (typeCheck) {
      return typeCheck;
    }
  }

  const id = nextId();
  const detail: TaskDetail = {
    id,
    code: nextCode(store.rows, '20260101'),
    title: input.title,
    status: 'draft',
    priority: input.priority,
    cargoKg: input.cargoKg,
    fromSiteId: input.fromSiteId,
    toSiteId: input.toSiteId,
    fromSiteName: null,
    toSiteName: null,
    timeWindowStart: input.timeWindowStart,
    timeWindowEnd: input.timeWindowEnd,
    assignedVehicleId: null,
    vehicleCode: null,
    progress: 0,
    createdAt: MOCK_AT,
    createdBy: 'mock',
    templateId: input.templateId,
    cargoDesc: input.cargoDesc,
    cancelReason: null,
    failReason: null,
    pauseReason: null,
    submittedAt: null,
    assignedAt: null,
    startedAt: null,
    finishedAt: null,
    cancelledAt: null,
    failedAt: null,
    updatedAt: MOCK_AT,
    currentPlan: null,
    route: null,
    alerts: [],
    auditSummaries: []
  };
  store.rows.push(detail);
  if (payload.submit === true) {
    // 一步提交：与主进程一样走**同一条**状态机路径
    const submitted = transitionTask(store, baseData, id, 'submit', {});
    if (submitted.code !== 0) {
      return submitted;
    }
  }
  return ok(detailOf(store, baseData, id) as TaskDetail);
}

function ensureSites(baseData: MockBaseData, fromSiteId: string, toSiteId: string): ApiResult<never> | null {
  const from = baseData.sites.find((site) => site.id === fromSiteId);
  if (!from) {
    return fail('SITE.NOT_FOUND', { fromSiteId });
  }
  const to = baseData.sites.find((site) => site.id === toSiteId);
  if (!to) {
    return fail('SITE.NOT_FOUND', { toSiteId });
  }
  if (from.status !== 'enabled') {
    return fail('VALIDATION.FAILED', { fields: { fromSiteId: `站点 ${from.code} 已停用，不能作为任务起终点` } });
  }
  if (to.status !== 'enabled') {
    return fail('VALIDATION.FAILED', { fields: { toSiteId: `站点 ${to.code} 已停用，不能作为任务起终点` } });
  }
  return null;
}

function ensureTemplateTypes(
  baseData: MockBaseData,
  template: { code: string; fromSiteType: SiteType | null; toSiteType: SiteType | null },
  fromSiteId: string,
  toSiteId: string
): ApiResult<never> | null {
  const fields: Record<string, string> = {};
  const from = baseData.sites.find((site) => site.id === fromSiteId);
  const to = baseData.sites.find((site) => site.id === toSiteId);
  if (template.fromSiteType !== null && from && from.type !== template.fromSiteType) {
    fields['fromSiteId'] = `模板 ${template.code} 要求起点类型为 ${template.fromSiteType}，当前是 ${from.type}`;
  }
  if (template.toSiteType !== null && to && to.type !== template.toSiteType) {
    fields['toSiteId'] = `模板 ${template.code} 要求终点类型为 ${template.toSiteType}，当前是 ${to.type}`;
  }
  return Object.keys(fields).length > 0 ? fail('VALIDATION.FAILED', { fields }) : null;
}

function updateTask(
  store: MockTaskStore,
  baseData: MockBaseData,
  id: string,
  payload: Record<string, unknown>
): ApiResult<unknown> {
  const row = store.rows.find((item) => item.id === id);
  if (!row) {
    return fail('TASK.NOT_FOUND', { id });
  }
  // 与主进程同源：可编辑状态来自 shared（界面上的「编辑」按钮也用它）
  const editable = TASK_EDITABLE_STATUSES;
  if (!editable.includes(row.status)) {
    return fail('TASK.STATE_CONFLICT', {
      id,
      from: row.status,
      expected: editable,
      hint: '已派发的任务请用「重派」或「取消」，不要直接编辑'
    });
  }
  const parsed = validateTaskInput(payload, 'patch');
  if (!parsed.ok) {
    return fail('VALIDATION.FAILED', { fields: parsed.fields });
  }
  const patch = parsed.value;
  const endpointError = taskEndpointError(patch.fromSiteId ?? row.fromSiteId, patch.toSiteId ?? row.toSiteId);
  if (endpointError) {
    return fail('VALIDATION.FAILED', { fields: { toSiteId: endpointError } });
  }
  if (patch.fromSiteId !== undefined || patch.toSiteId !== undefined) {
    const siteCheck = ensureSites(baseData, patch.fromSiteId ?? row.fromSiteId, patch.toSiteId ?? row.toSiteId);
    if (siteCheck) {
      return siteCheck;
    }
  }
  const nextStart = patch.timeWindowStart === undefined ? row.timeWindowStart : patch.timeWindowStart;
  const nextEnd = patch.timeWindowEnd === undefined ? row.timeWindowEnd : patch.timeWindowEnd;
  const windowError = taskWindowError(nextStart, nextEnd);
  if (windowError) {
    return fail('VALIDATION.FAILED', { fields: { timeWindowEnd: windowError } });
  }
  Object.assign(row, patch, { updatedAt: MOCK_AT });
  return ok(detailOf(store, baseData, id) as TaskDetail);
}

function removeTask(store: MockTaskStore, id: string): ApiResult<unknown> {
  const index = store.rows.findIndex((item) => item.id === id);
  if (index < 0) {
    return fail('TASK.NOT_FOUND', { id });
  }
  const row = store.rows[index] as TaskDetail;
  const check = checkTaskTransition('delete', row.status);
  if (!check.ok) {
    // message 用状态机给的**同一句话**：主进程抛的是 `check.failure.message`，
    // 若这里退回错误目录的兜底文案（「当前状态不允许执行该操作」），
    // 同一次失败在浏览器与 Electron 下会给使用者两句不同的话
    return failWith('TASK.STATE_CONFLICT', check.failure.message, {
      id,
      action: 'delete',
      from: check.failure.from,
      expected: check.failure.expected,
      hint: '只有草稿可以删除；其余状态请用「取消」'
    });
  }
  store.rows.splice(index, 1);
  return ok({ id, transition: { from: row.status, to: row.status } });
}

/** 状态操作的包装：把「未登记的动作」与「非法迁移」的判定交给共享状态机。 */
function transitionTask(
  store: MockTaskStore,
  baseData: MockBaseData,
  id: string,
  action: TaskAction,
  payload: Record<string, unknown>
): ApiResult<unknown> {
  const row = store.rows.find((item) => item.id === id);
  if (!row) {
    return fail('TASK.NOT_FOUND', { id });
  }
  const reasonValue = payload.reason;
  const reason = typeof reasonValue === 'string' && reasonValue.trim() ? reasonValue.trim() : null;
  return mockTaskTransition(store, baseData, row, action, reason, MOCK_AT);
}

/**
 * 已暴露的 HTTP 动作（与主进程 `ipc/api.ts` 的 `TASK_ACTIONS_VIA_POST` 同一判据：
 * 状态机里的动作减去走 `DELETE` 的那一个）。
 */
export function exposedTaskPostActions(): readonly string[] {
  return TASK_API_ACTIONS.filter((action) => action !== 'delete');
}

/**
 * 状态机执行器（Mock 侧）。
 *
 * 判据全部来自共享状态机（`checkTaskTransition`），这里只负责**副作用**：
 *   - 时间戳列（submittedAt / cancelledAt …）；
 *   - 取消 / 重派：回收车辆到 `idle`、清派发痕迹、计划作废；
 *   - 暂停写原因、恢复清原因、重排清失败原因。
 *
 * 三条副作用与主进程逐条对应，少一条就会出现「浏览器里正常、Electron 里车辆状态不对」。
 */
function mockTaskTransition(
  store: MockTaskStore,
  baseData: MockBaseData,
  row: TaskDetail,
  action: TaskAction,
  reason: string | null,
  at: string
): ApiResult<unknown> {
  const check = checkTaskTransition(action, row.status);
  if (!check.ok) {
    return failWith('TASK.STATE_CONFLICT', check.failure.message, {
      id: row.id,
      action,
      from: check.failure.from,
      expected: check.failure.expected,
      to: check.failure.to
    });
  }
  if (check.transition.requiresReason && !reason) {
    return fail('VALIDATION.FAILED', { fields: { reason: `${action} 必须给出原因` } });
  }
  const from = row.status;
  const to = check.transition.to as TaskStatus;
  row.status = to;
  row.updatedAt = at;

  if (action === 'submit') row.submittedAt = at;
  if (action === 'assign') row.assignedAt = at;
  if (action === 'start') row.startedAt = at;
  if (action === 'complete') row.finishedAt = at;
  if (action === 'cancel') row.cancelledAt = at;
  if (action === 'fail') row.failedAt = at;

  if (action === 'cancel' || action === 'reassign') {
    const vehicle = baseData.vehicles.find((item) => item.id === row.assignedVehicleId);
    // 只在车辆确实被占用时才回 idle（故障 / 离线的车回 idle 是谎报状态）
    if (vehicle && (vehicle.status === 'busy' || vehicle.status === 'reserved')) {
      vehicle.status = 'idle';
    }
    row.assignedVehicleId = null;
    row.vehicleCode = null;
    row.currentPlan = null;
  }
  if (action === 'cancel') row.cancelReason = reason;
  if (action === 'pause') row.pauseReason = reason;
  if (action === 'resume') row.pauseReason = null;
  if (action === 'requeue') row.failReason = null;

  return ok({ ...(detailById(store, baseData, row.id) as TaskDetail), transition: { from, to } });
}

/** 按 id 取详情（`detailOf` 的内部别名，避免把 `store` 之外的参数透出去）。 */
function detailById(store: MockTaskStore, baseData: MockBaseData, id: string): TaskDetail | undefined {
  return detailOf(store, baseData, id);
}
