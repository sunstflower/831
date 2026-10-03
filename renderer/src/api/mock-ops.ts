/**
 * Mock 适配器的 **M1 / M7 / M8 / M9 / M10**（浏览器形态）。
 *
 * ## 与主进程的分工（与 `mock-dispatch.ts` 同口径）
 *
 *   - **判据共享**：告警状态机（`alert-state.ts`）、设置校验（`settings-rules.ts`）、
 *     任务状态机（`task-state.ts`）全部来自 `@udm/shared` —— 与领域服务读的是**同一份内核**，
 *     因此「`new` 能不能直接关闭」这类判定不可能分叉；
 *   - **存储各自**：主进程读写 SQLite，这里改内存数组。这一段必然有两份实现，
 *     口径由 `mock-parity.test.ts` 用同一批请求打两边来锁死。
 *
 * ## 一处**有意的**差异
 *
 * **执行器只推进一步**：主进程有真实的定时推进（`ExecutionRunner.startTimer`），
 * 浏览器 Mock 不挂定时器 —— 页面里的「推进一帧」按钮直接调 `tickExecution()`。
 * 少一个后台定时器换来的是：Mock 形态的验收动作完全由使用者驱动，
 * 不会出现「什么都没点，数据自己变了」这种在演示里最难解释的现象。
 * 推进算法本身与主进程**共用一套**（折线插值 + 电量扣减 + 轨迹采样）。
 */
import {
  ALERT_ACTIONS,
  ALERT_NEXT_STEPS,
  buildPlanRiskReport,
  planInputsOf,
  scanPlanRisks,
  DEFAULT_PAGE_SIZE,
  ERROR_CODES,
  MAX_PAGE_SIZE,
  SEED_IDS,
  SETTINGS_SCHEMA,
  USER_STATUSES,
  checkAlertTransition,
  checkTaskTransition,
  validateSettingValue,
  type AlertAction,
  type AlertDetail,
  type AlertListItem,
  type AlertStatus,
  type AlertType,
  type ApiResult,
  type AuditLogItem,
  type ErrorCode,
  type ExecutionStartResult,
  type MonitorOverview,
  type MonitorVehicleItem,
  type Role,
  type SettingsUpdateResult,
  type TakeoverResult,
  type UserListItem,
  type VehicleTrackPoint
} from '@udm/shared';
import type { HttpMethod } from './client';
import { mockSeedDataset } from './mock-data';
import type { MockBaseData, MockRouteStore, MockTaskStore } from './mock-data';

export interface MockOpsRequest {
  method: HttpMethod;
  /** 去掉前导空段后的路径片段：`['api','alerts','a-1','resolve']`。 */
  segments: string[];
  payload: Record<string, unknown>;
}

interface MockAlertRow {
  id: string;
  type: AlertType;
  level: 'info' | 'warning' | 'critical';
  objectType: string;
  objectId: string | null;
  message: string;
  detail: Record<string, unknown>;
  status: AlertStatus;
  dedupeKey: string | null;
  createdAt: string;
  ackAt: string | null;
  ackBy: string | null;
  resolveAt: string | null;
  resolveBy: string | null;
  resolution: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
}

interface MockUserRow {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: Role;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
}

/** 执行体（与主进程 `RunningExecution` 同形，只是不含定时器）。 */
interface MockExecution {
  taskId: string;
  vehicleId: string;
  nodeIds: string[];
  travelledM: number;
  totalM: number;
  speedMps: number;
  cargoKg: number;
}

export interface MockOpsStore {
  alerts: MockAlertRow[];
  audit: AuditLogItem[];
  users: MockUserRow[];
  settings: Record<string, unknown>;
  tracks: Map<string, VehicleTrackPoint[]>;
  /** 内存里的「正在执行」集合；Mock 不挂定时器，推进由页面按钮驱动。 */
  executions: Map<string, MockExecution>;
  seq: number;
}

const MOCK_AT = '2026-01-01T00:00:00.000Z';

/** 与 `seed.ts` 的三条演示账号同源（密码不参与校验，Mock 的登录在 `mock.ts` 里）。 */
const MOCK_USERS: MockUserRow[] = [
  { id: 'seed-admin', username: 'admin', password: 'admin123', displayName: '系统管理员', role: 'admin', status: 'active', lastLoginAt: MOCK_AT, createdAt: MOCK_AT },
  { id: 'seed-dispatcher', username: 'dispatcher', password: 'dispatcher123', displayName: '调度员', role: 'dispatcher', status: 'active', lastLoginAt: MOCK_AT, createdAt: MOCK_AT },
  { id: 'seed-monitor', username: 'monitor', password: 'monitor123', displayName: '监控员', role: 'monitor', status: 'active', lastLoginAt: MOCK_AT, createdAt: MOCK_AT }
];

export function buildMockOpsStore(): MockOpsStore {
  return {
    /*
     * 演示告警**取自与 seed 同一份推导**（`shared/src/seed-data.ts`），只补上 Mock
     * 特有的几个字段（`detail` / `dedupeKey` / 处置时间）。
     *
     * 曾经这里手写了一条 `createdAt: MOCK_AT`（2026-01-01）：主进程 seed 写的是
     * 「seed 那一刻」，Mock 却把它钉在九个月前 —— 告警列表新加的「停滞时长」
     * 于是显示成「已 9 个月未认领」，看起来像一条被遗忘的真实故障。
     * 时间戳必须跟着「现在」走，故事才成立（与 `mock-data.ts` 的文件头同一条教训）。
     */
    alerts: [
      {
        ...mockSeedDataset().demoAlert,
        detail: {},
        dedupeKey: `vehicle_offline:${mockSeedDataset().demoAlert.objectId}`,
        ackAt: null,
        ackBy: null,
        resolveAt: null,
        resolveBy: null,
        resolution: null,
        archivedAt: null,
        archivedBy: null
      }
    ],
    audit: [],
    users: MOCK_USERS.map((row) => ({ ...row })),
    settings: Object.fromEntries(SETTINGS_SCHEMA.map((item) => [item.key, item.defaultValue])),
    tracks: new Map(),
    executions: new Map(),
    seq: 0
  };
}

function fail(code: ErrorCode, detail?: Record<string, unknown>): ApiResult<never> {
  const definition = ERROR_CODES[code];
  return { code, message: definition.message, source: definition.source, ...(detail ? { detail } : {}) };
}

function invalid(fields: Record<string, string>): ApiResult<never> {
  return fail('VALIDATION.FAILED', { fields });
}

function ok<T>(data: T): ApiResult<T> {
  return { code: 0, message: 'success', data };
}

/** 与 `mockPaginate` 同口径（宽进：非法值回落默认、超限夹取）。 */
function paginate<T>(records: T[], payload: Record<string, unknown>): { records: T[]; total: number; page: number; pageSize: number } {
  const rawPage = Number(payload.page ?? 1);
  const rawSize = Number(payload.pageSize ?? DEFAULT_PAGE_SIZE);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const pageSize =
    Number.isFinite(rawSize) && rawSize >= 1 ? Math.min(Math.floor(rawSize), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const start = (page - 1) * pageSize;
  return { records: records.slice(start, start + pageSize), total: records.length, page, pageSize };
}

/** 严出：不在白名单里就报错（与主进程 `optionalEnumFilter` 同解）。 */
function enumFilter<T extends string>(
  payload: Record<string, unknown>,
  field: string,
  values: readonly T[]
): T | undefined | ApiResult<never> {
  const raw = payload[field];
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (typeof raw !== 'string' || !(values as readonly string[]).includes(raw)) {
    return invalid({ [field]: `取值必须是 ${values.join(' / ')} 之一，收到：${String(raw)}` });
  }
  return raw as T;
}

function csvEnumFilter<T extends string>(
  payload: Record<string, unknown>,
  field: string,
  values: readonly T[]
): T[] | undefined | ApiResult<never> {
  const raw = payload[field];
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (typeof raw !== 'string') {
    return invalid({ [field]: '必须是字符串' });
  }
  const parts = raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 0) {
    return undefined;
  }
  const unknown = parts.filter((part) => !(values as readonly string[]).includes(part));
  if (unknown.length > 0) {
    return invalid({ [field]: `取值必须是 ${values.join(' / ')} 之一或它们的逗号组合，收到：${unknown.join(', ')}` });
  }
  return parts as T[];
}

function isFailure(value: unknown): value is ApiResult<never> {
  return typeof value === 'object' && value !== null && 'code' in value && (value as { code: unknown }).code !== 0;
}

function nextId(prefix: string): string {
  return `mock-${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 写一条审计。
 *
 * Mock 的审计**只有列表项那么宽**（`AuditLogItem`）：`before` / `after` 快照
 * 是主进程详情里才有的字段（`docs/api.md` §3.9 明写「before/after 仅详情」），
 * 而 Mock 没有详情接口 —— 造一个永远读不到的字段只会让两份实现看起来不一样。
 */
function record(
  store: MockOpsStore,
  actor: { id: string; name: string; role: Role },
  /**
   * `before` / `after` 允许传、但**不落库**：`AuditLogItem` 里没有这两列
   * （契约 §3.9 明写「before/after 仅详情」，而 Mock 没有详情接口）。
   * 保留这两个参数是为了让调用点的写法与主进程的 `writeAudit` 一致 ——
   * 两边调用形状相同，读代码的人不必在两套签名之间切换。
   */
  input: Omit<AuditLogItem, 'id' | 'ts' | 'actorName' | 'role' | 'traceId'> & { before?: unknown; after?: unknown }
): void {
  store.seq += 1;
  const { before: _before, after: _after, ...rest } = input;
  store.audit.unshift({
    id: `mock-audit-${store.seq}`,
    ts: MOCK_AT,
    actorName: actor.name,
    role: actor.role,
    traceId: `mock-trace-${store.seq}`,
    ...rest
  });
}

/* ============================ M7 监控与执行 ============================ */

interface MonitoringDeps {
  baseData: MockBaseData;
  taskStore: MockTaskStore;
  /**
   * 已生效的派发计划（风险预检用）。
   *
   * 用**函数**而不是数组：`mock.ts` 在启动时构造依赖，而计划会随
   * 「应用派发 / 重算」实时增长 —— 传一份快照会让预检永远停在启动那一刻。
   * 同理不 import 调度 store 的类型：`mock-dispatch.ts` 已经很大，
   * 这里只要一个只读的最小形状，避免为了一个字段把两个 store 绑在一起。
   */
  plans: () => readonly MockRiskPlan[];
  /**
   * 路线表（回退用）：演示数据「有任务 + 有路线、但没有派发计划」（D-26），
   * 与主进程一样要能按 `routes.task_id` 回退取出路线，否则会为一条正常执行中的
   * 演示任务误报「缺路线」。
   */
  routeStore: MockRouteStore;
}

/** 风险预检需要的计划字段（`dispatch_plans` 的对应子集）。 */
export interface MockRiskPlan {
  taskId: string;
  vehicleId: string;
  routeId: string | null;
  occupiedFrom: string;
  occupiedTo: string;
  status: 'applied' | 'superseded' | 'cancelled';
}

function overviewOf(store: MockOpsStore, deps: MonitoringDeps): MonitorOverview {
  const taskCount = (status: string): number => deps.taskStore.rows.filter((row) => row.status === status).length;
  const vehicleCount = (status: string): number => deps.baseData.vehicles.filter((row) => row.status === status).length;
  const alertCount = (status: AlertStatus): number => store.alerts.filter((row) => row.status === status).length;
  const unresolved = alertCount('new') + alertCount('acknowledged') + alertCount('processing');
  return {
    taskCounts: {
      running: taskCount('running'),
      paused: taskCount('paused'),
      pending: taskCount('pending'),
      assigned: taskCount('assigned'),
      failed: taskCount('failed'),
      finishedToday: deps.taskStore.rows.filter((row) => row.status === 'finished').length
    },
    vehicleCounts: {
      idle: vehicleCount('idle'),
      busy: vehicleCount('busy'),
      reserved: vehicleCount('reserved'),
      charging: vehicleCount('charging'),
      offline: vehicleCount('offline'),
      fault: vehicleCount('fault')
    },
    alertCounts: {
      new: alertCount('new'),
      acknowledged: alertCount('acknowledged'),
      processing: alertCount('processing'),
      unresolved
    },
    eventSeq: store.seq,
    updatedAt: MOCK_AT
  };
}

/** 与主进程同口径：只认 `running` / `paused` 的任务算「当前任务」。 */
function currentTaskByVehicle(taskStore: MockTaskStore): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of taskStore.rows) {
    if ((row.status === 'running' || row.status === 'paused') && row.assignedVehicleId) {
      map.set(row.assignedVehicleId, row.id);
    }
  }
  return map;
}

/** 折线上按里程取点（与主进程 `positionAt` 同算法：先走到第几段，再段内插值）。 */
function positionAt(nodeIds: string[], baseData: MockBaseData, travelledM: number): { x: number; y: number; nodeId: string } | null {
  const points = nodeIds
    .map((nodeId) => {
      const node = baseData.nodes.find((item) => item.id === nodeId);
      return node ? { x: node.x, y: node.y, nodeId } : null;
    })
    .filter((point): point is { x: number; y: number; nodeId: string } => point !== null);
  if (points.length < 2) {
    return null;
  }
  let remaining = travelledM;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (remaining <= length || index === points.length - 2) {
      const ratio = length === 0 ? 1 : Math.min(1, Math.max(0, remaining / length));
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
        nodeId: ratio >= 1 ? to.nodeId : from.nodeId
      };
    }
    remaining -= length;
  }
  return points[points.length - 1]!;
}

function routeNodeIdsOf(taskId: string, deps: MonitoringDeps): string[] | null {
  const task = deps.taskStore.rows.find((row) => row.id === taskId);
  if (!task) {
    return null;
  }
  // Mock 的任务详情带路线摘要（不含节点序列）时退化为两端站点所绑节点 —— 与
  // 主进程的两级查法同目的：宁可给一条直连折线，也不要「查不到路线就不动」
  const fromSite = deps.baseData.sites.find((site) => site.id === task.fromSiteId);
  const toSite = deps.baseData.sites.find((site) => site.id === task.toSiteId);
  const fromNode = fromSite?.nodeId ?? null;
  const toNode = toSite?.nodeId ?? null;
  if (fromNode && toNode && fromNode !== toNode) {
    return [fromNode, toNode];
  }
  return null;
}

function startExecution(
  store: MockOpsStore,
  deps: MonitoringDeps,
  actor: { id: string; name: string; role: Role },
  taskId: string,
  payload: Record<string, unknown>
): ApiResult<ExecutionStartResult> {
  const task = deps.taskStore.rows.find((row) => row.id === taskId);
  if (!task) {
    return fail('TASK.NOT_FOUND', { id: taskId });
  }
  if (!task.assignedVehicleId) {
    return fail('TASK.STATE_CONFLICT', { id: taskId, from: task.status, hint: '先在调度中心应用派发' });
  }
  const vehicle = deps.baseData.vehicles.find((row) => row.id === task.assignedVehicleId);
  if (!vehicle) {
    return fail('VEHICLE.NOT_FOUND', { id: task.assignedVehicleId });
  }
  const nodeIds = routeNodeIdsOf(taskId, deps);
  if (!nodeIds) {
    return fail('ROUTE.NOT_FOUND', { taskId, vehicleId: vehicle.id, hint: '重新预览并应用派发以生成路线' });
  }
  const check = checkTaskTransition('start', task.status);
  if (!check.ok) {
    return fail('TASK.STATE_CONFLICT', { id: taskId, action: 'start', from: check.failure.from, expected: check.failure.expected, to: check.failure.to });
  }
  const points = nodeIds.map((nodeId) => {
    const node = deps.baseData.nodes.find((item) => item.id === nodeId)!;
    return { x: node.x, y: node.y };
  });
  let totalM = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    totalM += Math.hypot(points[index + 1]!.x - points[index]!.x, points[index + 1]!.y - points[index]!.y);
  }
  const at = MOCK_AT;
  task.status = 'running';
  task.startedAt = at;
  task.progress = 0;
  task.updatedAt = at;
  vehicle.status = 'busy';
  vehicle.loadKg = task.cargoKg;
  vehicle.currentNodeId = nodeIds[0]!;
  vehicle.x = points[0]!.x;
  vehicle.y = points[0]!.y;
  store.executions.set(taskId, {
    taskId,
    vehicleId: vehicle.id,
    nodeIds,
    travelledM: 0,
    totalM,
    speedMps: vehicle.maxSpeedMps,
    cargoKg: task.cargoKg
  });
  store.tracks.set(vehicle.id, [
    { ts: at, x: points[0]!.x, y: points[0]!.y, speedMps: vehicle.maxSpeedMps, status: 'running', taskId }
  ]);
  record(store, actor, {
    module: 'execution',
    action: 'start',
    objectType: 'task',
    objectId: taskId,
    result: 'success',
    message: typeof payload.note === 'string' ? payload.note : null,
    costMs: 0,
  });
  return ok({ taskId, vehicleId: vehicle.id, status: 'running' as const, startedAt: at });
}

/**
 * 推进一帧（Mock 版，供页面按钮调用）。
 *
 * 与主进程 `tick()` 的差别只有「谁在调」：那边是定时器，这里是按钮。
 * 折线插值 / 电量扣减 / 到位收尾的顺序逐条对齐。
 */
export function tickExecution(store: MockOpsStore, deps: MonitoringDeps): { advanced: string[]; finished: string[] } {
  const advanced: string[] = [];
  const finished: string[] = [];
  for (const [taskId, execution] of [...store.executions.entries()]) {
    const task = deps.taskStore.rows.find((row) => row.id === taskId);
    if (!task || task.status !== 'running') {
      store.executions.delete(taskId);
      continue;
    }
    const vehicle = deps.baseData.vehicles.find((row) => row.id === execution.vehicleId);
    if (!vehicle) {
      store.executions.delete(taskId);
      continue;
    }
    const stepM = execution.speedMps * 4;
    execution.travelledM = Math.min(execution.totalM, execution.travelledM + stepM);
    const progress = execution.totalM === 0 ? 1 : execution.travelledM / execution.totalM;
    const position = positionAt(execution.nodeIds, deps.baseData, execution.travelledM);
    if (!position) {
      store.executions.delete(taskId);
      continue;
    }
    const done = execution.travelledM >= execution.totalM;
    vehicle.x = position.x;
    vehicle.y = position.y;
    vehicle.currentNodeId = position.nodeId;
    vehicle.battery = Math.max(0, vehicle.battery - stepM * 0.01);
    task.progress = Number(progress.toFixed(6));
    task.updatedAt = MOCK_AT;
    if (done) {
      task.status = 'finished';
      task.finishedAt = MOCK_AT;
      task.progress = 1;
      vehicle.status = 'idle';
      vehicle.loadKg = 0;
    }
    const points = store.tracks.get(vehicle.id) ?? [];
    points.push({
      ts: MOCK_AT,
      x: position.x,
      y: position.y,
      speedMps: done ? 0 : execution.speedMps,
      status: done ? 'finished' : 'running',
      taskId
    });
    store.tracks.set(vehicle.id, points);
    if (done) {
      store.executions.delete(taskId);
      finished.push(taskId);
    } else {
      advanced.push(taskId);
    }
  }
  return { advanced, finished };
}

function takeover(
  store: MockOpsStore,
  deps: MonitoringDeps,
  actor: { id: string; name: string; role: Role },
  taskId: string,
  payload: Record<string, unknown>
): ApiResult<TakeoverResult> {
  const task = deps.taskStore.rows.find((row) => row.id === taskId);
  if (!task) {
    return fail('TASK.NOT_FOUND', { id: taskId });
  }
  if (task.status !== 'running' && task.status !== 'assigned') {
    return fail('TASK.STATE_CONFLICT', { id: taskId, from: task.status, expected: ['running', 'assigned'] });
  }
  const rawType = payload.alertType;
  const alertType: AlertType =
    rawType === 'task_timeout' || rawType === 'route_blocked' || rawType === 'task_failed' ? rawType : 'task_timeout';
  const note = typeof payload.note === 'string' && payload.note.trim().length > 0 ? payload.note.trim() : null;
  if (task.status === 'running') {
    store.executions.delete(taskId);
    task.status = 'paused';
    task.pauseReason = note ?? '人工接管暂停';
    task.updatedAt = MOCK_AT;
    const vehicle = deps.baseData.vehicles.find((row) => row.id === task.assignedVehicleId);
    if (vehicle) {
      vehicle.status = 'reserved';
    }
  }
  const alertId = nextId('alert');
  store.alerts.unshift({
    id: alertId,
    type: alertType,
    level: 'warning',
    objectType: 'task',
    objectId: taskId,
    message: note ? `人工接管：${note}` : `人工接管任务 ${task.code}`,
    detail: { taskCode: task.code, status: task.status, vehicleId: task.assignedVehicleId, nextSteps: ALERT_NEXT_STEPS[alertType] },
    status: 'new',
    dedupeKey: `takeover:${taskId}`,
    createdAt: MOCK_AT,
    ackAt: null,
    ackBy: null,
    resolveAt: null,
    resolveBy: null,
    resolution: null,
    archivedAt: null,
    archivedBy: null
  });
  record(store, actor, {
    module: 'execution',
    action: 'takeover',
    objectType: 'task',
    objectId: taskId,
    result: 'success',
    message: note,
    costMs: 0,
    before: null,
    after: { alertId, alertType }
  });
  return ok({ taskId, alertId, nextSteps: ALERT_NEXT_STEPS[alertType] });
}

/* ============================ M8 告警 ============================ */

function toAlertItem(row: MockAlertRow): AlertListItem {
  return {
    id: row.id,
    type: row.type,
    level: row.level,
    objectType: row.objectType as AlertListItem['objectType'],
    objectId: row.objectId,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt,
    ackBy: row.ackBy,
    ackAt: row.ackAt,
    resolveBy: row.resolveBy,
    resolveAt: row.resolveAt
  };
}

function alertDetail(row: MockAlertRow, deps: MonitoringDeps): AlertDetail {
  const task = row.objectType === 'task' && row.objectId ? deps.taskStore.rows.find((item) => item.id === row.objectId) : undefined;
  const vehicle = row.objectType === 'vehicle' && row.objectId ? deps.baseData.vehicles.find((item) => item.id === row.objectId) : undefined;
  return {
    ...toAlertItem(row),
    detail: row.detail,
    resolution: row.resolution,
    dedupeKey: row.dedupeKey,
    archivedAt: row.archivedAt,
    archivedBy: row.archivedBy,
    related: {
      task: task ? { id: task.id, code: task.code, title: task.title, status: task.status } : null,
      vehicle: vehicle ? { id: vehicle.id, code: vehicle.code, name: vehicle.name, status: vehicle.status } : null
    },
    suggestedNextSteps: ALERT_NEXT_STEPS[row.type]
  };
}

/* ============================ M1 用户 ============================ */

function toUserItem(row: MockUserRow): UserListItem {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt
  };
}

/* ============================ 读接口 ============================ */

export function mockOpsRead(
  store: MockOpsStore,
  deps: MonitoringDeps,
  path: string,
  payload: Record<string, unknown>
): ApiResult<unknown> | null {
  if (path === '/api/monitor/overview') {
    return ok(overviewOf(store, deps));
  }
  if (path === '/api/monitor/tasks') {
    const statuses = csvEnumFilter(payload, 'status', [
      'draft',
      'pending',
      'assigned',
      'running',
      'paused',
      'finished',
      'cancelled',
      'failed'
    ] as const);
    if (isFailure(statuses)) return statuses;
    const effective = statuses && statuses.length > 0 ? statuses : ['running', 'paused', 'failed'];
    const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim().toLowerCase() : '';
    const rows = deps.taskStore.rows.filter(
      (row) =>
        effective.includes(row.status) &&
        (!keyword || row.code.toLowerCase().includes(keyword) || row.title.toLowerCase().includes(keyword))
    );
    return ok(paginate(rows, payload));
  }
  if (path === '/api/monitor/vehicles') {
    const status = enumFilter(payload, 'status', ['idle', 'reserved', 'busy', 'charging', 'offline', 'fault', 'disabled'] as const);
    if (isFailure(status)) return status;
    const type = enumFilter(payload, 'type', ['agv', 'carrier', 'drone', 'other'] as const);
    if (isFailure(type)) return type;
    const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim().toLowerCase() : '';
    const active = currentTaskByVehicle(deps.taskStore);
    const rows: MonitorVehicleItem[] = deps.baseData.vehicles
      .filter(
        (row) =>
          (!status || row.status === status) &&
          (!type || row.type === type) &&
          (!keyword || row.code.toLowerCase().includes(keyword) || row.name.toLowerCase().includes(keyword))
      )
      .map((row) => ({ ...row, currentTaskId: active.get(row.id) ?? null }));
    return ok(paginate(rows, payload));
  }
  if (path.startsWith('/api/map/tracks/')) {
    const vehicleId = path.slice('/api/map/tracks/'.length);
    if (!deps.baseData.vehicles.some((row) => row.id === vehicleId)) {
      return fail('VEHICLE.NOT_FOUND', { id: vehicleId });
    }
    const points = store.tracks.get(vehicleId) ?? [];
    const taskId = typeof payload.taskId === 'string' ? payload.taskId : undefined;
    const filtered = taskId ? points.filter((point) => point.taskId === taskId) : points;
    return ok({ vehicleId, points: filtered, total: filtered.length });
  }
  if (path === '/api/alerts') {
    const type = enumFilter(payload, 'type', ['vehicle_offline', 'task_timeout', 'task_failed', 'route_blocked', 'data_error'] as const);
    if (isFailure(type)) return type;
    const level = enumFilter(payload, 'level', ['info', 'warning', 'critical'] as const);
    if (isFailure(level)) return level;
    const status = csvEnumFilter(payload, 'status', ['new', 'acknowledged', 'processing', 'resolved', 'archived'] as const);
    if (isFailure(status)) return status;
    const objectType = typeof payload.objectType === 'string' && payload.objectType ? payload.objectType : undefined;
    const objectId = typeof payload.objectId === 'string' && payload.objectId ? payload.objectId : undefined;
    const rows = store.alerts
      .filter(
        (row) =>
          (!type || row.type === type) &&
          (!level || row.level === level) &&
          (!status || status.includes(row.status)) &&
          (!objectType || row.objectType === objectType) &&
          (!objectId || row.objectId === objectId)
      )
      .map(toAlertItem);
    return ok(paginate(rows, payload));
  }
  /*
   * 任务风险预检（`docs/api.md` §3.8.3）。
   *
   * 必须放在 `/api/alerts/{id}` 的前缀分支**之前**：`risks` 会被那条分支当成
   * 一个告警 id 去查，然后返回 `ALERT.NOT_FOUND` —— 页面会报「告警不存在」，
   * 而真正的原因是新接口没接上（ISS-055 的同类：错的原因把人带偏）。
   *
   * 判断本身来自 `@udm/shared`（与主进程同一个函数），这里只负责把 Mock 的
   * 内存数据翻译成它的入参 —— 因此「两边结论一致」是结构性的，不是靠比对用例维持的。
   */
  if (path === '/api/alerts/risks') {
    const vehicleById = new Map(deps.baseData.vehicles.map((row) => [row.id, row]));
    const applied = deps.plans().filter((plan) => plan.status === 'applied');
    const routeByTask = new Map<string, { id: string; durationS: number }>();
    for (const row of deps.routeStore.rows) {
      // 同一任务可能有多条历史路线：取**最新**的一条（与主进程 `ORDER BY created_at DESC LIMIT 1` 同口径）
      if (row.taskId && !routeByTask.has(row.taskId)) {
        routeByTask.set(row.taskId, { id: row.id, durationS: row.durationS });
      }
    }

    const tasks = deps.taskStore.rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      timeWindowStart: row.timeWindowStart,
      timeWindowEnd: row.timeWindowEnd,
      cargoKg: row.cargoKg
    }));

    /*
     * 「计划优先、否则按任务路线回退」这条规则**不在这里**：它是业务判断，
     * 唯一作者是 `shared` 的 `planInputsOf`（主进程调的是同一个函数）。
     * 这里只把内存里的三张表拼成它要的素材 —— Mock 与主进程因此只在
     * 「从哪里取数」上不同，结论不可能分叉。
     */
    const plans = planInputsOf(
      deps.taskStore.rows.map((row) => {
        const vehicle = row.assignedVehicleId ? vehicleById.get(row.assignedVehicleId) : undefined;
        const plan = applied.find((item) => item.taskId === row.id);
        return {
          taskId: row.id,
          taskStatus: row.status,
          vehicleId: vehicle ? vehicle.id : null,
          vehicleCode: vehicle ? vehicle.code : null,
          plan: plan
            ? { routeId: plan.routeId, occupiedFrom: plan.occupiedFrom, occupiedTo: plan.occupiedTo }
            : null,
          fallbackRoute: routeByTask.get(row.id) ?? null,
          fallbackFrom: row.startedAt ?? row.assignedAt ?? row.createdAt
        };
      })
    );

    const vehicles = deps.baseData.vehicles.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      battery: row.battery
    }));
    const now = new Date().toISOString();
    // 与主进程同一个函数、同一份输入形状：`tasks` / `plans` 也一并交给报告去拼派发区块
    return ok(
      buildPlanRiskReport(scanPlanRisks(tasks, plans, vehicles, { nowMs: Date.parse(now) }), now, { tasks, plans })
    );
  }
  if (path.startsWith('/api/alerts/')) {
    const id = path.slice('/api/alerts/'.length);
    const row = store.alerts.find((item) => item.id === id);
    if (!row) {
      return fail('ALERT.NOT_FOUND', { id });
    }
    return ok(alertDetail(row, deps));
  }
  if (path === '/api/audit/logs') {
    const module = typeof payload.module === 'string' && payload.module ? payload.module : undefined;
    const action = typeof payload.action === 'string' && payload.action ? payload.action : undefined;
    const rows = store.audit.filter((row) => (!module || row.module === module) && (!action || row.action === action));
    return ok(paginate(rows, payload));
  }
  if (path === '/api/audit/logs/export') {
    const header = 'ts,actorName,role,module,action,objectType,objectId,result,message,costMs,traceId';
    const cell = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const text = String(value);
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [header, ...store.audit.map((row) =>
      [row.ts, row.actorName, row.role, row.module, row.action, row.objectType, row.objectId, row.result, row.message, row.costMs, row.traceId]
        .map(cell)
        .join(',')
    )];
    return ok({ filename: 'udm-audit-mock.csv', content: `\uFEFF${lines.join('\r\n')}`, total: store.audit.length });
  }
  if (path === '/api/users') {
    const keyword = typeof payload.keyword === 'string' ? payload.keyword.trim().toLowerCase() : '';
    const role = enumFilter(payload, 'role', ['admin', 'dispatcher', 'monitor'] as const);
    if (isFailure(role)) return role;
    const status = enumFilter(payload, 'status', USER_STATUSES);
    if (isFailure(status)) return status;
    const rows = store.users
      .filter(
        (row) =>
          (!keyword || row.username.toLowerCase().includes(keyword) || row.displayName.toLowerCase().includes(keyword)) &&
          (!role || row.role === role) &&
          (!status || row.status === status)
      )
      .map(toUserItem);
    return ok(paginate(rows, payload));
  }
  return null;
}

/* ============================ 写接口 ============================ */

export function mockOpsWrite(
  store: MockOpsStore,
  deps: MonitoringDeps,
  request: MockOpsRequest,
  actor: { id: string; name: string; role: Role }
): ApiResult<unknown> | null {
  const { method, segments, payload } = request;
  const resource = segments[1];
  const id = segments[2];

  /* ---- M7 执行 ---- */
  if (resource === 'execution' && method === 'POST' && segments[2] === 'tasks' && segments[4] === 'start') {
    return startExecution(store, deps, actor, segments[3] ?? '', payload);
  }
  if (resource === 'execution' && method === 'POST' && segments[2] === 'tasks' && segments[4] === 'takeover') {
    return takeover(store, deps, actor, segments[3] ?? '', payload);
  }

  /* ---- M8 告警状态操作 ---- */
  if (resource === 'alerts' && method === 'POST' && id && segments[3]) {
    const action = segments[3] as AlertAction;
    if (!(ALERT_ACTIONS as readonly string[]).includes(action)) {
      return fail('API.ROUTE_NOT_FOUND', { path: `/api/alerts/${id}/${action}` });
    }
    const row = store.alerts.find((item) => item.id === id);
    if (!row) {
      return fail('ALERT.NOT_FOUND', { id, action });
    }
    const check = checkAlertTransition(action, row.status);
    if (!check.ok) {
      return fail('ALERT.STATE_CONFLICT', {
        id,
        action,
        from: check.failure.from,
        expected: check.failure.expected,
        to: check.failure.to
      });
    }
    const noteField = action === 'resolve' ? 'resolution' : 'note';
    const rawNote = payload[noteField];
    const note = typeof rawNote === 'string' && rawNote.trim() ? rawNote.trim() : null;
    if (action === 'resolve' && !note) {
      return invalid({ resolution: 'resolution 不能为空' });
    }
    const before = row.status;
    row.status = check.transition.to;
    if (action === 'acknowledge') {
      row.ackAt = MOCK_AT;
      row.ackBy = actor.name;
    }
    if (action === 'resolve') {
      row.resolveAt = MOCK_AT;
      row.resolveBy = actor.name;
      row.resolution = note;
    }
    if (action === 'archive') {
      row.archivedAt = MOCK_AT;
      row.archivedBy = actor.name;
    }
    record(store, actor, {
      module: 'alert',
      action,
      objectType: 'alert',
      objectId: id,
      result: 'success',
      message: note,
      costMs: 0,
    });
    return ok({ ...alertDetail(row, deps), transition: { from: before, to: row.status } });
  }

  /* ---- M10 设置写 ---- */
  if (resource === 'settings' && method === 'PATCH') {
    const updates = payload.updates;
    if (typeof updates !== 'object' || updates === null || Array.isArray(updates)) {
      return invalid({ updates: '必须是 `{ 键: 值 }` 对象' });
    }
    const entries = Object.entries(updates as Record<string, unknown>);
    if (entries.length === 0) {
      return invalid({ updates: '至少要给出一个设置项' });
    }
    const fields: Record<string, string> = {};
    for (const [key, value] of entries) {
      const item = SETTINGS_SCHEMA.find((candidate) => candidate.key === key);
      if (!item) {
        return fail('SETTINGS.KEY_NOT_FOUND', { key, known: SETTINGS_SCHEMA.map((entry) => entry.key) });
      }
      const reason = validateSettingValue(item, value);
      if (reason) {
        fields[key] = reason;
      }
    }
    if (Object.keys(fields).length > 0) {
      return invalid(fields);
    }
    const before: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      before[key] = store.settings[key];
      store.settings[key] = value;
    }
    record(store, actor, {
      module: 'settings',
      action: 'update',
      objectType: 'settings',
      objectId: entries.map(([key]) => key).join(','),
      result: 'success',
      message: null,
      costMs: 0,
      before,
      after: Object.fromEntries(entries)
    });
    return ok({ values: { ...store.settings }, updatedKeys: entries.map(([key]) => key) } satisfies SettingsUpdateResult);
  }

  /* ---- M1 用户写 ---- */
  if (resource === 'users' && method === 'POST' && !id) {
    const username = typeof payload.username === 'string' ? payload.username.trim() : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
    const role = payload.role;
    if (!username || !/^[A-Za-z0-9_-]+$/.test(username)) {
      return invalid({ username: '必填，且只能包含字母、数字、下划线与短横线' });
    }
    if (password.length < 6 || password.length > 32) {
      return invalid({ password: '长度必须在 6-32 之间' });
    }
    if (!displayName) {
      return invalid({ displayName: '必填' });
    }
    if (role !== 'admin' && role !== 'dispatcher' && role !== 'monitor') {
      return invalid({ role: '取值必须是 admin / dispatcher / monitor 之一' });
    }
    if (store.users.some((row) => row.username === username)) {
      return fail('USER.NAME_EXISTS', { username });
    }
    const row: MockUserRow = {
      id: nextId('user'),
      username,
      password,
      displayName,
      role,
      status: 'active',
      lastLoginAt: null,
      createdAt: MOCK_AT
    };
    store.users.push(row);
    record(store, actor, {
      module: 'user',
      action: 'create',
      objectType: 'user',
      objectId: row.id,
      result: 'success',
      message: null,
      costMs: 0,
      before: null,
      after: { username, role }
    });
    return ok(toUserItem(row));
  }
  if (resource === 'users' && method === 'POST' && id && segments[3] === 'reset-password') {
    const row = store.users.find((item) => item.id === id);
    if (!row) {
      return fail('USER.NOT_FOUND', { id });
    }
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (password.length < 6 || password.length > 32) {
      return invalid({ password: '长度必须在 6-32 之间' });
    }
    row.password = password;
    record(store, actor, { module: 'user', action: 'reset-password', objectType: 'user', objectId: id, result: 'success', message: null, costMs: 0, before: null, after: null });
    return ok({ id });
  }
  if (resource === 'users' && method === 'PATCH' && id && segments[3] === 'status') {
    const row = store.users.find((item) => item.id === id);
    if (!row) {
      return fail('USER.NOT_FOUND', { id });
    }
    const status = payload.status;
    if (status !== 'active' && status !== 'disabled') {
      return invalid({ status: '取值必须是 active / disabled 之一' });
    }
    if (status === 'disabled') {
      if (actor.id === id) {
        return invalid({ status: '不能禁用当前登录的账号' });
      }
      if (row.role === 'admin' && store.users.filter((item) => item.role === 'admin' && item.status === 'active' && item.id !== id).length === 0) {
        return invalid({ status: '不能禁用最后一个启用的管理员' });
      }
    }
    row.status = status;
    record(store, actor, { module: 'user', action: status === 'disabled' ? 'disable' : 'enable', objectType: 'user', objectId: id, result: 'success', message: null, costMs: 0, before: null, after: { status } });
    return ok(toUserItem(row));
  }
  if (resource === 'users' && method === 'PUT' && id === 'me' && segments[3] === 'password') {
    const row = store.users.find((item) => item.id === actor.id);
    if (!row) {
      return fail('USER.NOT_FOUND', { id: actor.id });
    }
    const oldPassword = typeof payload.oldPassword === 'string' ? payload.oldPassword : '';
    const newPassword = typeof payload.newPassword === 'string' ? payload.newPassword : '';
    if (oldPassword.length < 6 || oldPassword.length > 32) {
      return invalid({ oldPassword: '长度必须在 6-32 之间' });
    }
    if (newPassword.length < 6 || newPassword.length > 32) {
      return invalid({ newPassword: '长度必须在 6-32 之间' });
    }
    if (oldPassword === newPassword) {
      return invalid({ newPassword: '新密码不能与原密码相同' });
    }
    if (row.password !== oldPassword) {
      record(store, actor, { module: 'user', action: 'change-password', objectType: 'user', objectId: row.id, result: 'failure', message: null, costMs: 0, before: null, after: null });
      return fail('AUTH.OLD_PASSWORD_WRONG');
    }
    row.password = newPassword;
    record(store, actor, { module: 'user', action: 'change-password', objectType: 'user', objectId: row.id, result: 'success', message: null, costMs: 0, before: null, after: null });
    return ok({ id: row.id });
  }
  if (resource === 'users' && method === 'PUT' && id) {
    const row = store.users.find((item) => item.id === id);
    if (!row) {
      return fail('USER.NOT_FOUND', { id });
    }
    if (payload.role !== undefined) {
      if (payload.role !== 'admin' && payload.role !== 'dispatcher' && payload.role !== 'monitor') {
        return invalid({ role: '取值必须是 admin / dispatcher / monitor 之一' });
      }
      if (payload.role !== 'admin' && row.role === 'admin' && store.users.filter((item) => item.role === 'admin' && item.status === 'active' && item.id !== id).length === 0) {
        return invalid({ role: '不能降级最后一个启用的管理员' });
      }
      row.role = payload.role;
    }
    if (payload.displayName !== undefined) {
      if (typeof payload.displayName !== 'string' || !payload.displayName.trim()) {
        return invalid({ displayName: '必填' });
      }
      row.displayName = payload.displayName.trim();
    }
    if (payload.status !== undefined) {
      if (payload.status !== 'active' && payload.status !== 'disabled') {
        return invalid({ status: '取值必须是 active / disabled 之一' });
      }
      row.status = payload.status;
    }
    record(store, actor, { module: 'user', action: 'update', objectType: 'user', objectId: id, result: 'success', message: null, costMs: 0, before: null, after: null });
    return ok(toUserItem(row));
  }
  return null;
}
