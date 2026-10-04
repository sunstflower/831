/**
 * Mock 适配器的 **M2 写路径**（浏览器形态）。
 *
 * ## 为什么这份实现是「规则共享、存储各自」
 *
 * 写操作在浏览器里没有 SQLite，只能用内存数组 —— 所以**存储**这一半必然有两份实现
 * （主进程 SQL / Mock 数组），这一点无法消除。能消除的是**规则**那一半：
 * 字段长度、数值域、枚举成员、自环判定全部来自 `@udm/shared` 的 `base-rules.ts`，
 * 与领域服务读的是同一张表。因此两边在「什么输入算合法」上不可能分叉。
 *
 * 剩下的差异只有三条，都是「存储」的性质而不是「规则」的性质：
 *   1. 编码唯一 / 引用存在：主进程查 SQL，这里查数组；
 *   2. 边的 `code`：两边都用 `deriveEdgeCode` 推导（同一个函数）；
 *   3. 审计：Mock **不写审计表**（它没有审计表）。这一点已经写在适配器注释里，
 *      不让浏览器里「看不到审计」被误当成「审计功能没实现」。
 *
 * `mock-parity.test.ts` 用同一批请求打两边，把「错误码」逐条锁死。
 */
import {
  deriveEdgeCode,
  MANAGED_VEHICLE_STATUSES,
  vehicleStatusConflictOf,
  validateEdgeInput,
  validateNodeInput,
  validateRestrictionInput,
  validateSiteInput,
  validateTemplateInput,
  validateVehicleInput,
  type EdgeListItem,
  type NodeListItem,
  type RestrictionListItem,
  type SiteListItem,
  type TaskTemplateListItem,
  type VehicleListItem
} from '@udm/shared';
import { ERROR_CODES, type ApiResult, type ErrorCode } from '@udm/shared';
import type { HttpMethod } from './client';
import type { MockBaseData } from './mock-data';

export interface MockBaseWriteRequest {
  method: HttpMethod;
  /** 去掉前导空段后的路径片段：`['api','sites','abc','status']`。 */
  segments: string[];
  payload: Record<string, unknown>;
}

/** 与 `mock.ts` 的 `fromCatalog` 同源：错误文案与 source 一律取自唯一登记处。 */
function fail(code: ErrorCode, detail?: Record<string, unknown>): ApiResult<never> {
  const definition = ERROR_CODES[code];
  return { code, message: definition.message, source: definition.source, ...(detail ? { detail } : {}) };
}

function ok<T>(data: T): ApiResult<T> {
  return { code: 0, message: 'success', data };
}

function invalidFields(fields: Record<string, string>): ApiResult<never> {
  return fail('VALIDATION.FAILED', { fields });
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `mock-${prefix}-${Date.now().toString(36)}-${seq}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 写路径的分发。
 *
 * 返回 `null` 表示「这不是一条写路由」，由调用方继续走读路径的分发 ——
 * 用返回值而不是抛异常表达「不匹配」，是因为「未命中」在这里是**正常控制流**
 * （读接口占绝大多数），异常会把它变成一件需要 catch 的事。
 */
export function mockBaseWrite(store: MockBaseData, request: MockBaseWriteRequest): ApiResult<unknown> | null {
  // 路径片段形如 ['api','sites','<id>','status']：`api` 是固定前缀，**资源名从第 2 段开始**
  // （这里曾误写成 `slice(2)`，于是 `/api/sites` 被切成空数组、所有写请求都落进 `null` 分支，
  //   表现为「写接口一律 API.ROUTE_NOT_FOUND」——不报错，只是永远命中不到）
  const [resource, id, action] = request.segments.slice(1);
  if (resource === undefined) {
    return null;
  }
  const key = `${request.method} ${resource}${id ? '/:id' : ''}${action ? `/${action}` : ''}`;
  switch (key) {
    case 'POST sites':
      return createSite(store, request.payload);
    case 'PUT sites/:id':
      return updateSite(store, id!, request.payload);
    case 'PATCH sites/:id/status':
      return setStatus(store.sites, id!, request.payload, 'site');
    case 'POST vehicles':
      return createVehicle(store, request.payload);
    case 'PUT vehicles/:id':
      return updateVehicle(store, id!, request.payload);
    case 'PATCH vehicles/:id/status':
      return setVehicleStatus(store, id!, request.payload);
    case 'POST nodes':
      return createNode(store, request.payload);
    case 'PUT nodes/:id':
      return updateNode(store, id!, request.payload);
    case 'PATCH nodes/:id/status':
      return setNodeStatus(store, id!, request.payload);
    case 'POST edges':
      return createEdge(store, request.payload);
    case 'PUT edges/:id':
      return updateEdge(store, id!, request.payload);
    case 'PATCH edges/:id/status':
      return setStatus(store.edges, id!, request.payload, 'edge');
    // 禁行规则：唯一允许**物理删除**的一类（`design.md` D-07 的例外）
    case 'POST restrictions':
      return createRestriction(store, request.payload);
    case 'PUT restrictions/:id':
      return updateRestriction(store, id!, request.payload);
    case 'DELETE restrictions/:id':
      return deleteRestriction(store, id!);
    // 任务模板：只有创建与更新，没有删除（契约 §3.2.6）
    case 'POST task-templates':
      return createTemplate(store, request.payload);
    case 'PUT task-templates/:id':
      return updateTemplate(store, id!, request.payload);
    default:
      return null;
  }
}

function findByCode<T extends { code: string; id: string }>(rows: T[], code: string, excludeId?: string): T | undefined {
  return rows.find((row) => row.code === code && row.id !== excludeId);
}

function createSite(store: MockBaseData, payload: Record<string, unknown>): ApiResult<unknown> {
  const parsed = validateSiteInput(payload, 'create');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const input = parsed.value;
  if (findByCode(store.sites, input.code)) {
    return fail('BASE.CODE_EXISTS', { code: input.code, kind: 'site' });
  }
  const node = input.nodeId ? store.nodes.find((row) => row.id === input.nodeId) : undefined;
  if (input.nodeId && !node) {
    return fail('NODE.NOT_FOUND', { nodeId: input.nodeId });
  }
  const at = nowIso();
  const created: SiteListItem = {
    id: nextId('site'),
    code: input.code,
    name: input.name,
    type: input.type,
    status: 'enabled',
    nodeId: input.nodeId,
    // 与主进程同解：坐标缺省时跟随绑定节点，再兜底 0
    x: input.x ?? node?.x ?? 0,
    y: input.y ?? node?.y ?? 0,
    remark: input.remark,
    createdAt: at,
    updatedAt: at
  };
  store.sites.push(created);
  return ok(created);
}

function updateSite(store: MockBaseData, id: string, payload: Record<string, unknown>): ApiResult<unknown> {
  const site = store.sites.find((row) => row.id === id);
  if (!site) {
    return fail('SITE.NOT_FOUND', { id });
  }
  const parsed = validateSiteInput(payload, 'patch');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const patch = parsed.value;
  if (patch.nodeId !== undefined && patch.nodeId !== null && !store.nodes.some((row) => row.id === patch.nodeId)) {
    return fail('NODE.NOT_FOUND', { nodeId: patch.nodeId });
  }
  const nodeChanged = patch.nodeId !== undefined && patch.nodeId !== site.nodeId;
  const node = patch.nodeId ? store.nodes.find((row) => row.id === patch.nodeId) : undefined;
  Object.assign(site, {
    ...patch,
    ...(nodeChanged && node ? { x: node.x, y: node.y } : {}),
    updatedAt: nowIso()
  });
  return ok(site);
}

/**
 * 车辆坐标：优先用请求里给的，其次跟随所在节点，最后才是 `(0, 0)`。
 * 与主进程 `vehicle.service.ts` 的 `resolveVehicleXY` 同一口径（否则两种形态下
 * 同一份请求会建出位置不同的车，而界面上看不出差别）。
 */
function resolveVehicleXY(
  store: MockBaseData,
  input: { x: number | null; y: number | null; currentNodeId: string | null }
): { x: number; y: number } {
  const node = input.currentNodeId ? store.nodes.find((row) => row.id === input.currentNodeId) : undefined;
  return { x: input.x ?? node?.x ?? 0, y: input.y ?? node?.y ?? 0 };
}

function createVehicle(store: MockBaseData, payload: Record<string, unknown>): ApiResult<unknown> {
  const parsed = validateVehicleInput(payload, 'create');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const input = parsed.value;
  if (findByCode(store.vehicles, input.code)) {
    return fail('BASE.CODE_EXISTS', { code: input.code, kind: 'vehicle' });
  }
  if (input.currentNodeId && !store.nodes.some((row) => row.id === input.currentNodeId)) {
    return fail('NODE.NOT_FOUND', { currentNodeId: input.currentNodeId });
  }
  const { x, y } = resolveVehicleXY(store, input);
  const at = nowIso();
  const created: VehicleListItem = {
    id: nextId('veh'),
    code: input.code,
    name: input.name,
    type: input.type,
    status: 'idle',
    capacityKg: input.capacityKg,
    loadKg: 0,
    maxSpeedMps: input.maxSpeedMps,
    battery: input.battery,
    x,
    y,
    currentNodeId: input.currentNodeId,
    // 新车未上线：与主进程 `insertVehicle` 的 `online = 0` 同解
    online: false,
    lastHeartbeatAt: null,
    remark: input.remark,
    createdAt: at,
    updatedAt: at
  };
  store.vehicles.push(created);
  return ok(created);
}

function updateVehicle(store: MockBaseData, id: string, payload: Record<string, unknown>): ApiResult<unknown> {
  const vehicle = store.vehicles.find((row) => row.id === id);
  if (!vehicle) {
    return fail('VEHICLE.NOT_FOUND', { id });
  }
  const parsed = validateVehicleInput(payload, 'patch');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const patch = { ...parsed.value };
  if (patch.currentNodeId && !store.nodes.some((row) => row.id === patch.currentNodeId)) {
    return fail('NODE.NOT_FOUND', { currentNodeId: patch.currentNodeId });
  }
  // 只给了节点、没给坐标时坐标跟着节点走（与主进程同一条规则）
  if (patch.currentNodeId !== undefined && patch.x === undefined && patch.y === undefined && patch.currentNodeId) {
    const node = store.nodes.find((row) => row.id === patch.currentNodeId);
    if (node) {
      patch.x = node.x;
      patch.y = node.y;
    }
  }
  Object.assign(vehicle, { ...patch, updatedAt: nowIso() });
  return ok(vehicle);
}

/**
 * 车辆状态写路径。
 *
 * 白名单与冲突判定都来自 `@udm/shared` 的 `base-rules.ts` —— 与主进程领域服务
 * 调的是**同一个** `MANAGED_VEHICLE_STATUSES` / `vehicleStatusConflictOf`（D-34），
 * 这里只负责把它落到内存数组上（存储那一半无法共享）。
 */
function setVehicleStatus(store: MockBaseData, id: string, payload: Record<string, unknown>): ApiResult<unknown> {
  const vehicle = store.vehicles.find((row) => row.id === id);
  if (!vehicle) {
    return fail('VEHICLE.NOT_FOUND', { id });
  }
  const status = payload.status;
  if (typeof status !== 'string' || !(MANAGED_VEHICLE_STATUSES as readonly string[]).includes(status)) {
    return invalidFields({ status: `管理接口只能设置为 ${MANAGED_VEHICLE_STATUSES.join(' / ')}；运行态由执行器维护` });
  }
  if (vehicle.status === status) {
    return ok(vehicle);
  }
  const conflict = vehicleStatusConflictOf(
    vehicle.status,
    status as (typeof MANAGED_VEHICLE_STATUSES)[number]
  );
  if (conflict !== null) {
    return fail('VEHICLE.STATE_CONFLICT', { id, status: vehicle.status, target: status, reason: conflict });
  }
  vehicle.status = status as VehicleListItem['status'];
  vehicle.updatedAt = nowIso();
  return ok(vehicle);
}

function createNode(store: MockBaseData, payload: Record<string, unknown>): ApiResult<unknown> {
  const parsed = validateNodeInput(payload, 'create');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const input = parsed.value;
  if (findByCode(store.nodes, input.code)) {
    return fail('BASE.CODE_EXISTS', { code: input.code, kind: 'node' });
  }
  const created: NodeListItem = {
    id: nextId('node'),
    code: input.code,
    name: input.name,
    x: input.x,
    y: input.y,
    status: 'enabled',
    remark: input.remark
  };
  store.nodes.push(created);
  return ok(created);
}

function updateNode(store: MockBaseData, id: string, payload: Record<string, unknown>): ApiResult<unknown> {
  const node = store.nodes.find((row) => row.id === id);
  if (!node) {
    return fail('NODE.NOT_FOUND', { id });
  }
  const parsed = validateNodeInput(payload, 'patch');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  Object.assign(node, parsed.value);
  return ok(node);
}

function setNodeStatus(store: MockBaseData, id: string, payload: Record<string, unknown>): ApiResult<unknown> {
  const node = store.nodes.find((row) => row.id === id);
  if (!node) {
    return fail('NODE.NOT_FOUND', { id });
  }
  const status = payload.status;
  if (status !== 'enabled' && status !== 'disabled') {
    return invalidFields({ status: '取值必须是 enabled / disabled 之一' });
  }
  if (node.status === status) {
    return ok(node);
  }
  if (status === 'disabled') {
    const edges = store.edges.filter((edge) => edge.fromNodeId === id || edge.toNodeId === id).length;
    const sites = store.sites.filter((site) => site.nodeId === id).length;
    if (edges > 0 || sites > 0) {
      return fail('BASE.NODE_IN_USE', { id, edges, sites });
    }
  }
  node.status = status;
  return ok(node);
}

function euclidean(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function createEdge(store: MockBaseData, payload: Record<string, unknown>): ApiResult<unknown> {
  const parsed = validateEdgeInput(payload, 'create');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const input = parsed.value;
  const from = store.nodes.find((row) => row.id === input.fromNodeId);
  const to = store.nodes.find((row) => row.id === input.toNodeId);
  const missing: Record<string, string> = {};
  if (!from) {
    missing['fromNodeId'] = input.fromNodeId;
  }
  if (!to) {
    missing['toNodeId'] = input.toNodeId;
  }
  if (Object.keys(missing).length > 0) {
    return fail('NODE.NOT_FOUND', missing);
  }
  const duplicate = store.edges.find((edge) => edge.fromNodeId === input.fromNodeId && edge.toNodeId === input.toNodeId);
  if (duplicate) {
    return fail('BASE.CODE_EXISTS', { code: duplicate.code, kind: 'edge', id: duplicate.id });
  }
  const code = deriveEdgeCode(from!.code, to!.code);
  if (input.code && input.code !== code) {
    return invalidFields({
      code: `当前版本的边编码由两端节点推导（应为 ${code}）；自定义编码需要 edges.code 列落地（D-35）`
    });
  }
  const lengthM = input.lengthM ?? euclidean(from!, to!);
  if (lengthM <= 0) {
    return invalidFields({ lengthM: '两端节点坐标重合，无法推导边长，请手工指定 lengthM 或修正节点坐标' });
  }
  const created: EdgeListItem = {
    id: nextId('edge'),
    code,
    fromNodeId: input.fromNodeId,
    toNodeId: input.toNodeId,
    fromNodeCode: from!.code,
    toNodeCode: to!.code,
    lengthM,
    speedLimitMps: input.speedLimitMps,
    weight: input.weight,
    status: 'enabled',
    remark: input.remark
  };
  store.edges.push(created);
  return ok(created);
}

function updateEdge(store: MockBaseData, id: string, payload: Record<string, unknown>): ApiResult<unknown> {
  const edge = store.edges.find((row) => row.id === id);
  if (!edge) {
    return fail('EDGE.NOT_FOUND', { id });
  }
  const parsed = validateEdgeInput(payload, 'patch');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const patch = parsed.value;
  const fromNodeId = patch.fromNodeId ?? edge.fromNodeId;
  const toNodeId = patch.toNodeId ?? edge.toNodeId;
  if (fromNodeId === toNodeId) {
    return invalidFields({ toNodeId: '起点与终点不能是同一个节点' });
  }
  const endpointsChanged = patch.fromNodeId !== undefined || patch.toNodeId !== undefined;
  const from = store.nodes.find((row) => row.id === fromNodeId);
  const to = store.nodes.find((row) => row.id === toNodeId);
  if (endpointsChanged) {
    const missing: Record<string, string> = {};
    if (!from) {
      missing['fromNodeId'] = fromNodeId;
    }
    if (!to) {
      missing['toNodeId'] = toNodeId;
    }
    if (Object.keys(missing).length > 0) {
      return fail('NODE.NOT_FOUND', missing);
    }
    const duplicate = store.edges.find(
      (row) => row.fromNodeId === fromNodeId && row.toNodeId === toNodeId && row.id !== id
    );
    if (duplicate) {
      return fail('BASE.CODE_EXISTS', { code: duplicate.code, kind: 'edge', id: duplicate.id });
    }
  }
  const lengthM = patch.lengthM ?? (endpointsChanged ? euclidean(from!, to!) : edge.lengthM);
  if (lengthM <= 0) {
    return invalidFields({ lengthM: '两端节点坐标重合，无法推导边长，请手工指定 lengthM' });
  }
  Object.assign(edge, { ...patch, fromNodeId, toNodeId, lengthM });
  // 端点变了 → code 与两端 code 都要重算（它们是**派生**字段，不是存下来的）
  if (from && to) {
    edge.fromNodeCode = from.code;
    edge.toNodeCode = to.code;
    edge.code = deriveEdgeCode(from.code, to.code);
  }
  return ok(edge);
}

/** `sites` / `edges` 的启停共用（两者规则相同：只允许 enabled / disabled）。 */
function setStatus<T extends { id: string; status: string }>(
  rows: T[],
  id: string,
  payload: Record<string, unknown>,
  kind: 'site' | 'edge'
): ApiResult<unknown> {
  const row = rows.find((item) => item.id === id);
  if (!row) {
    return fail(kind === 'site' ? 'SITE.NOT_FOUND' : 'EDGE.NOT_FOUND', { id });
  }
  const status = payload.status;
  if (status !== 'enabled' && status !== 'disabled') {
    return invalidFields({ status: '取值必须是 enabled / disabled 之一' });
  }
  row.status = status;
  return ok(row);
}

/*
 * ---- 禁行规则（`docs/api.md` §3.2.5）----
 *
 * 三处与主进程必须逐条同解，否则 parity 会红：
 *   1. 目标存在性 → `MAP.RESTRICTION_TARGET_NOT_FOUND`（**不是** VALIDATION.FAILED）；
 *   2. 时间窗跨字段比较 → 结束时必须晚于开始（DDL 也有 CHECK，Mock 没有 DDL 只能自己判）；
 *   3. 物理删除后行真的不在数组里（不是打个 `expired` 标记 —— 那正是「软删」）。
 *
 * `targetCode` 是**派生**字段（节点取 code，边按两端推导），Mock 侧同样现算，
 * 不落存储 —— 与主进程用 LEFT JOIN 现算是同一件事（D-25 的思路）。
 */

function targetCodeOf(store: MockBaseData, type: 'node' | 'edge', targetId: string): string | null {
  if (type === 'node') {
    return store.nodes.find((node) => node.id === targetId)?.code ?? null;
  }
  const edge = store.edges.find((item) => item.id === targetId);
  return edge ? deriveEdgeCode(edge.fromNodeCode, edge.toNodeCode) : null;
}

function targetExists(store: MockBaseData, type: 'node' | 'edge', targetId: string): boolean {
  return type === 'node'
    ? store.nodes.some((node) => node.id === targetId)
    : store.edges.some((edge) => edge.id === targetId);
}

/** 时间窗校验：与 `domain/base/validate.ts` 的 `ensureRestrictionWindow` 同解。 */
function windowError(startAt: string | null, endAt: string | null): ApiResult<never> | null {
  if (startAt !== null && endAt !== null && !(endAt > startAt)) {
    return invalidFields({ endAt: '结束时间必须晚于开始时间' });
  }
  return null;
}

function restrictionByIndex(store: MockBaseData, id: string): { index: number; rule: RestrictionListItem } | null {
  const index = store.restrictions.findIndex((rule) => rule.id === id);
  if (index < 0) {
    return null;
  }
  return { index, rule: store.restrictions[index]! };
}

function createRestriction(store: MockBaseData, payload: Record<string, unknown>): ApiResult<unknown> {
  const parsed = validateRestrictionInput(payload, 'create');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const input = parsed.value;
  if (!targetExists(store, input.type, input.targetId)) {
    return fail('MAP.RESTRICTION_TARGET_NOT_FOUND', { targetId: input.targetId, type: input.type });
  }
  const badWindow = windowError(input.startAt, input.endAt);
  if (badWindow) {
    return badWindow;
  }
  const rule: RestrictionListItem = {
    id: nextId('restr'),
    type: input.type,
    targetId: input.targetId,
    targetCode: targetCodeOf(store, input.type, input.targetId),
    startAt: input.startAt,
    endAt: input.endAt,
    vehicleType: input.vehicleType,
    reason: input.reason,
    // 新建一律 active（与主进程仓储写死的行为一致）
    status: 'active',
    createdAt: nowIso(),
    // Mock 不写审计表，因此没有会话身份可记（`mock-base-write.ts` 文件头的第 3 条差异）
    createdBy: null
  };
  store.restrictions.push(rule);
  return ok(rule);
}

function updateRestriction(store: MockBaseData, id: string, payload: Record<string, unknown>): ApiResult<unknown> {
  const found = restrictionByIndex(store, id);
  if (!found) {
    return fail('RESTRICTION.NOT_FOUND', { id });
  }
  const parsed = validateRestrictionInput(payload, 'patch');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const patch = parsed.value;
  const nextType = patch.type ?? found.rule.type;
  const nextTargetId = patch.targetId ?? found.rule.targetId;
  // 与主进程同解：只在「改了 type 或 targetId」时才重判目标
  if ((patch.type !== undefined || patch.targetId !== undefined) && !targetExists(store, nextType, nextTargetId)) {
    return fail('MAP.RESTRICTION_TARGET_NOT_FOUND', { targetId: nextTargetId, type: nextType });
  }
  const nextStart = patch.startAt !== undefined ? patch.startAt : found.rule.startAt;
  const nextEnd = patch.endAt !== undefined ? patch.endAt : found.rule.endAt;
  const badWindow = windowError(nextStart, nextEnd);
  if (badWindow) {
    return badWindow;
  }
  const next: RestrictionListItem = {
    ...found.rule,
    ...patch,
    type: nextType,
    targetId: nextTargetId,
    startAt: nextStart,
    endAt: nextEnd,
    targetCode:
      nextType === found.rule.type && nextTargetId === found.rule.targetId
        ? found.rule.targetCode
        : targetCodeOf(store, nextType, nextTargetId)
  };
  store.restrictions[found.index] = next;
  return ok(next);
}

function deleteRestriction(store: MockBaseData, id: string): ApiResult<unknown> {
  const found = restrictionByIndex(store, id);
  if (!found) {
    return fail('RESTRICTION.NOT_FOUND', { id });
  }
  // 真删：`splice` 而不是改 `status`。与主进程的 `DELETE /api/restrictions/:id` 同解
  store.restrictions.splice(found.index, 1);
  return ok({ id, deleted: true });
}

/*
 * ---- 任务模板（`docs/api.md` §3.2.6）----
 *
 * 模板没有状态、没有引用要判，因此两份实现之间只剩「编码唯一」与「字段规则」，
 * 而字段规则来自 `shared/src/base-rules.ts`（同一份）。
 */

function createTemplate(store: MockBaseData, payload: Record<string, unknown>): ApiResult<unknown> {
  const parsed = validateTemplateInput(payload, 'create');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const input = parsed.value;
  if (findByCode(store.templates, input.code)) {
    return fail('BASE.CODE_EXISTS', { code: input.code, kind: 'template' });
  }
  const at = nowIso();
  const template: TaskTemplateListItem = {
    id: nextId('tpl'),
    code: input.code,
    name: input.name,
    priority: input.priority,
    defaultCargoKg: input.defaultCargoKg,
    timeWindowMinutes: input.timeWindowMinutes,
    fromSiteType: input.fromSiteType,
    toSiteType: input.toSiteType,
    remark: input.remark,
    createdAt: at,
    updatedAt: at
  };
  store.templates.push(template);
  return ok(template);
}

function updateTemplate(store: MockBaseData, id: string, payload: Record<string, unknown>): ApiResult<unknown> {
  const index = store.templates.findIndex((template) => template.id === id);
  if (index < 0) {
    return fail('TEMPLATE.NOT_FOUND', { id });
  }
  const parsed = validateTemplateInput(payload, 'patch');
  if (!parsed.ok) {
    return invalidFields(parsed.fields);
  }
  const next: TaskTemplateListItem = { ...store.templates[index]!, ...parsed.value, updatedAt: nowIso() };
  store.templates[index] = next;
  return ok(next);
}
