/**
 * **字段规则**（唯一作者）：M2 基础数据 + M3 任务的**共用读取原语**（`readText` / `readNumber` /
 * `readEnum` / `readTime` / `requiredWhen`）也在这里 —— M3 的字段规则见 `task-rules.ts`，
 * 它复用本文件的原语而不是复制一份：复制的那份迟早会在「空串算不算没给」这类口径上与它分叉。
 *
 * ## 为什么规则放在 `shared` 而不是领域层
 *
 * 主进程的领域服务与浏览器 Mock 适配器**都会**判断「这个输入合法吗」：
 * 领域服务判完之后写 SQLite，Mock 判完之后改内存数组。
 * 如果两边各写一份规则，它们迟早不一样 —— 而这类不一致**只在浏览器里显形**
 * （主进程仍是权威），排查时又最容易被当成「Mock 不准」而放过，
 * 正是 D-27 那次事故的形态。因此把**规则**（长度上限、数值域、枚举成员）
 * 收敛到这里，两边都调它；各适配器只负责自己的**存储**（唯一性、引用、写表）。
 *
 * 与 `ipc/validators.ts` 的分工（D-40）：传输层只判「字段**成形**」（是不是字符串、
 * 非空），**业务合法性**（长度、数值域、枚举、跨表引用）在这里与领域层判。
 * 分界的判据：传输层的失败**无法**给出 `detail.fields` 里有意义的字段级文案，
 * 而这里的可以。
 *
 * 本文件是**纯函数**：不读时间、不生成 id、不碰数据库。
 */
import {
  EDGE_STATUSES,
  RESTRICTION_STATUSES,
  RESTRICTION_TYPES,
  SITE_TYPES,
  TASK_PRIORITIES,
  VEHICLE_TYPES,
  type EdgeStatus,
  type RestrictionStatus,
  type RestrictionType,
  type SiteType,
  type TaskPriority,
  type VehicleStatus,
  type VehicleType
} from './enums.js';

/** 字段长度与数值域上限（`docs/module-M2-base-data.md` §5 的第 2、3 条）。 */
export const FIELD_LIMITS = {
  code: 32,
  name: 100,
  reason: 200,
  remark: 500
} as const;

/** 校验失败时的字段级明细：`{ 字段名: 中文原因 }`，直接放进 `VALIDATION.FAILED` 的 `detail.fields`。 */
export type FieldErrors = Record<string, string>;

/** 校验结果：成功时给出**已归一化**的值，失败时给出字段级原因。 */
export type RuleResult<T> = { ok: true; value: T } | { ok: false; fields: FieldErrors };

/**
 * 「创建时必填，更新时**出现就必须有值**」。
 *
 * 不可为空的列（`code` / `name` / `x` / `y` / `capacityKg` …）在更新时若显式传 `null`
 * 或空串，**不能**当成「这次不改它」—— 那是两回事，而按「不改」处理会让调用方
 * 以为自己清空了字段（界面照旧显示旧值），正是 D-19 要避免的静默忽略。
 * 可空列（`remark` / `nodeId` / `speedLimitMps`）不适用此规则：传 `null` 就是清空。
 */
export function requiredWhen(mode: 'create' | 'patch', raw: Record<string, unknown>, field: string): boolean {
  return mode === 'create' || raw[field] !== undefined;
}

/**
 * 记一条字段级错误。
 *
 * **就地累积到传入的 `fields` 上**：一次请求里多个字段可能同时出错，
 * 前端要能一次把所有输入框标红。返回的是**同一个对象**（不是副本），
 * 这样调用方把每个 `read*` 的结果都接上就能收齐所有原因 ——
 * 若返回副本，则「只在第一个失败处返回」的写法会丢掉后面所有字段的原因。
 */
export function fieldError(fields: FieldErrors, field: string, reason: string): RuleResult<never> {
  fields[field] = reason;
  return { ok: false, fields };
}

/** 文本字段：可选则允许 `undefined` / `null` / 空串（归一化为 `null`）。 */
export function readText(
  raw: Record<string, unknown>,
  field: string,
  options: { required: boolean; maxLength: number },
  fields: FieldErrors = {}
): RuleResult<string | null> {
  const value = raw[field];
  if (value === undefined || value === null) {
    return options.required ? fieldError(fields, field, '必填') : { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return fieldError(fields, field, '必须是字符串');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return options.required ? fieldError(fields, field, '必填') : { ok: true, value: null };
  }
  if (trimmed.length > options.maxLength) {
    return fieldError(fields, field, `长度不能超过 ${options.maxLength}`);
  }
  return { ok: true, value: trimmed };
}

/** 数值字段：可选则允许 `undefined` / `null`；`integer` 为真时只接受整数。 */
export function readNumber(
  raw: Record<string, unknown>,
  field: string,
  options: { required: boolean; min?: number; max?: number; integer?: boolean },
  fields: FieldErrors = {}
): RuleResult<number | null> {
  const value = raw[field];
  if (value === undefined || value === null || value === '') {
    return options.required ? fieldError(fields, field, '必填') : { ok: true, value: null };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    // 字符串数字**不**自动转换：`"100"` 与 `100` 的差别是调用方写错了类型，
    // 静默转换会把「传了字符串」这类问题一路带到写库
    return fieldError(fields, field, '必须是有限数字');
  }
  if (options.integer && !Number.isInteger(value)) {
    return fieldError(fields, field, '必须是整数');
  }
  if (options.min !== undefined && value < options.min) {
    return fieldError(fields, field, `不能小于 ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    return fieldError(fields, field, `不能大于 ${options.max}`);
  }
  return { ok: true, value };
}

/** 枚举字段：可选则允许缺省；取值必须是指定集合的成员（**不做大小写归一化**）。 */
export function readEnum<T extends string>(
  raw: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  options: { required: boolean },
  fields: FieldErrors = {}
): RuleResult<T | null> {
  const value = raw[field];
  if (value === undefined || value === null || value === '') {
    return options.required ? fieldError(fields, field, '必填') : { ok: true, value: null };
  }
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return fieldError(fields, field, `取值必须是 ${allowed.join(' / ')} 之一`);
  }
  return { ok: true, value: value as T };
}

export const isSiteType = (value: unknown): value is SiteType =>
  typeof value === 'string' && (SITE_TYPES as readonly string[]).includes(value);

export const isVehicleType = (value: unknown): value is VehicleType =>
  typeof value === 'string' && (VEHICLE_TYPES as readonly string[]).includes(value);

export const isEdgeStatus = (value: unknown): value is EdgeStatus =>
  typeof value === 'string' && (EDGE_STATUSES as readonly string[]).includes(value);

/**
 * **管理接口可以设置的车辆状态**（白名单，唯一作者）。
 *
 * 车辆七态里，`reserved` / `busy` 由调度占用（M4），`charging` / `offline` 是运行态读数
 * （M7 执行器与心跳）—— 这三者管理接口不得代写。剩下的三个是运维真正需要改的：
 *
 *   - `idle`：恢复可用（`disabled` / `fault` 的唯一出口）；
 *   - `disabled`：D-07 的软删停用；
 *   - `fault`：**人工报障** —— 「这车坏了」是现场先知道、执行器后知道的事。
 *     没有它就只能靠停用（软删）来表达「暂时别派这辆车」，而停用语义上更重、
 *     也不能停在 `reserved` 车上（见下面的冲突规则）。见 `AGENTS.md` D-62。
 *
 * 用白名单而非「排除 reserved/busy/charging/offline」：后者在枚举新增取值时会默认放行，
 * 而新增的运行态本该继续归执行器管。
 */
export const MANAGED_VEHICLE_STATUSES = ['idle', 'disabled', 'fault'] as const;

export type ManagedVehicleStatus = (typeof MANAGED_VEHICLE_STATUSES)[number];

/**
 * 管理接口状态迁移的**冲突判定**（唯一作者）：主进程领域服务与浏览器 Mock 都调它，
 * 两边不可能在「什么状态下不许改」上分叉。
 *
 * 两种情况各自有明确的理由，因此返回不同的原因而不是一个布尔：
 *
 *   - `disableOccupied`：`disabled` 是软删（语义上「这辆车不再投入使用」），
 *     而 `reserved` / `busy` 说明它身上还挂着任务 —— 停用会造出「任务挂着一辆已停用车」，
 *     也就是 seed 里那句「状态必须成对写」的反面。**不回收任务，只拒绝**（回收是 M3/M4 的事）。
 *   - `faultRunning`：`fault` 是运行态。`busy` 意味着执行器正在驱动这辆车跑，
 *     手动置故障会让「故障车还在跑」自相矛盾 —— 必须先在调度中心接管（暂停）再报障。
 *     `reserved`（已派发未开跑）不在此列：那正是报障最有用的时刻（还没出发，直接改派）。
 */
export type VehicleStatusConflict = 'disableOccupied' | 'faultRunning';

export function vehicleStatusConflictOf(
  from: VehicleStatus,
  to: ManagedVehicleStatus
): VehicleStatusConflict | null {
  if (to === 'disabled' && (from === 'busy' || from === 'reserved')) {
    return 'disableOccupied';
  }
  if (to === 'fault' && from === 'busy') {
    return 'faultRunning';
  }
  return null;
}

/**
 * M2 的 DTO 形状（写入用）。
 *
 * 放在这里而不是 `types.ts`：它们是**校验函数的输出**，字段可选性由规则决定
 * （例如 `update` 时全部可选）。与 `types.ts` 的「接口响应 DTO」分开，
 * 避免「读出来的东西」与「写进去的东西」混在同一批类型里。
 */
export interface SiteCreate {
  code: string;
  name: string;
  type: SiteType;
  nodeId: string | null;
  x: number | null;
  y: number | null;
  remark: string | null;
}

/**
 * 更新用补丁。
 *
 * **不能**写成 `Partial<Omit<SiteCreate, 'code'>>`：`SiteCreate.x` 是 `number | null`
 * （创建时可以不填、由绑定节点兜底），但更新时「显式传 null」必须被拒绝而不是写进库 ——
 * 直接派生会把可空性一起带过来，于是类型上允许一个运行期不允许的值。
 */
export type SitePatch = Partial<{
  name: string;
  type: SiteType;
  nodeId: string | null;
  x: number;
  y: number;
  remark: string | null;
}>;

export interface VehicleCreate {
  code: string;
  name: string;
  type: VehicleType;
  capacityKg: number;
  maxSpeedMps: number;
  /**
   * 坐标：**可空**。留空表示「跟着 `currentNodeId` 走」（与站点同一口径）。
   * 直接写 0 与「没给」是两件事，因此这里保留 `null` 而不是兜底成 0 ——
   * 兜底会把「没给坐标」变成一辆停在原点 (0,0) 的车，而原点往往不在路网上。
   */
  x: number | null;
  y: number | null;
  /**
   * 车辆当前所在节点（可空）。
   *
   * 为什么车辆也要有这个字段：调度评估的第一步就是「车从哪出发」
   * （`startNodeOf()`）。没有它时内核会按坐标就近取点 —— 那是个**兜底**，
   * 不是使用者表达的意图：车停在两节点之间时，就近取点会把空驶段算成一条
   * 并不存在的路。让建车的人显式指定落点，坐标则可以跟着它走。
   */
  currentNodeId: string | null;
  battery: number;
  remark: string | null;
}

/**
 * 车辆补丁：`x` / `y` **不许是 `null`**。
 *
 * 建车时 `null` = 「跟着所在节点走」；但 PATCH 里 `null` 只能读成「不改」，
 * 与 `undefined` 同义 —— 两种写法表达同一件事，迟早有人用错一种。
 * 因此把这两个字段收窄成 `number`：想改坐标就给出数，不想改就别传。
 */
export type VehiclePatch = Partial<Omit<VehicleCreate, 'code' | 'x' | 'y'>> & { x?: number; y?: number };

export interface NodeCreate {
  code: string;
  name: string;
  x: number;
  y: number;
  remark: string | null;
}

export type NodePatch = Partial<Omit<NodeCreate, 'code'>>;

export interface EdgeCreate {
  code: string | null;
  fromNodeId: string;
  toNodeId: string;
  lengthM: number | null;
  speedLimitMps: number | null;
  /**
   * 通行权重（`edges.weight`）：≥ 1 的惩罚系数，1 = 畅通。
   *
   * 缺省 1（不填 = 畅通）而不是 `null`：这是一个**有默认值的量**，
   * 界面上留空与「填 1」必须是同一件事，否则同一条边会出现两种写法。
   */
  weight: number;
  remark: string | null;
}

export type EdgePatch = Partial<{
  fromNodeId: string;
  toNodeId: string;
  lengthM: number;
  speedLimitMps: number | null;
  weight: number;
  remark: string | null;
}>;

/**
 * 禁行规则的写 DTO（`docs/api.md` §3.2.5）。
 *
 * **没有 `status` 字段**：新建的规则一律 `active`（由仓储写死），
 * 停用一条规则走 `RestrictionPatch.status` —— 它是**显式动作**，不是创建参数。
 * 把它放进 `RestrictionCreate` 会让「新建一条已经失效的规则」在类型上成立，
 * 而那件事没有任何合理用途。
 */
export interface RestrictionCreate {
  type: RestrictionType;
  targetId: string;
  startAt: string | null;
  endAt: string | null;
  vehicleType: VehicleType | null;
  reason: string;
}

export type RestrictionPatch = Partial<{
  type: RestrictionType;
  targetId: string;
  startAt: string | null;
  endAt: string | null;
  vehicleType: VehicleType | null;
  reason: string;
  status: RestrictionStatus;
}>;

/**
 * 时间窗字段：`startAt` / `endAt` 是 **ISO 8601 文本**（DDL 里就是 TEXT）。
 *
 * 为什么不只判「非空」：这两个值会被写成 SQL 里的字符串比较
 * （`docs/database.md` §6 的生效查询用 `start_at <= :now`），因此**必须**是
 * 「同一格式、字典序即时间序」的 ISO 串。放一个 `"明天上午"` 进去不会报错，
 * 那条规则从此**永远算不出来**（字符串比较下 `'明' > '2'`），而且没人会发现。
 *
 * 单独的字段级错误只判「能不能解析成时间」；**`endAt > startAt` 的跨字段比较放在领域服务**
 * —— 更新时可能只传来其中一个，必须与库里的另一个配对比较，只有服务层拿得到。
 */
export function readTime(raw: Record<string, unknown>, field: string, fields: FieldErrors = {}): RuleResult<string | null> {
  const value = raw[field];
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: null };
  }
  if (typeof value !== 'string') {
    return fieldError(fields, field, '必须是 ISO 8601 时间字符串');
  }
  const trimmed = value.trim();
  if (Number.isNaN(Date.parse(trimmed))) {
    return fieldError(fields, field, '必须是可解析的时间，如 2026-09-27T08:00:00.000Z');
  }
  return { ok: true, value: trimmed };
}

export function validateRestrictionInput(raw: Record<string, unknown>, mode: 'create'): RuleResult<RestrictionCreate>;
export function validateRestrictionInput(raw: Record<string, unknown>, mode: 'patch'): RuleResult<RestrictionPatch>;
export function validateRestrictionInput(
  raw: Record<string, unknown>,
  mode: 'create' | 'patch'
): RuleResult<RestrictionCreate | RestrictionPatch> {
  const fields: FieldErrors = {};
  const type = readEnum(raw, 'type', RESTRICTION_TYPES, { required: requiredWhen(mode, raw, 'type') }, fields);
  const targetId = readText(raw, 'targetId', { required: requiredWhen(mode, raw, 'targetId'), maxLength: 64 }, fields);
  const startAt = readTime(raw, 'startAt', fields);
  const endAt = readTime(raw, 'endAt', fields);
  const vehicleType = readEnum(raw, 'vehicleType', VEHICLE_TYPES, { required: false }, fields);
  const reason = readText(raw, 'reason', { required: requiredWhen(mode, raw, 'reason'), maxLength: FIELD_LIMITS.reason }, fields);
  const status = readEnum(raw, 'status', RESTRICTION_STATUSES, { required: false }, fields);
  if (!type.ok || !targetId.ok || !startAt.ok || !endAt.ok || !vehicleType.ok || !reason.ok || !status.ok) {
    return { ok: false, fields };
  }
  if (mode === 'patch') {
    const patch: RestrictionPatch = {};
    if (type.value !== null) patch.type = type.value;
    if (targetId.value !== null) patch.targetId = targetId.value;
    // 时间窗与「适用车辆」是**可空列**：显式传 null 表示清空（如把限定车辆改成「全部车辆」）
    if (raw['startAt'] !== undefined) patch.startAt = startAt.value;
    if (raw['endAt'] !== undefined) patch.endAt = endAt.value;
    if (raw['vehicleType'] !== undefined) patch.vehicleType = vehicleType.value;
    if (reason.value !== null) patch.reason = reason.value;
    if (status.value !== null) patch.status = status.value;
    return { ok: true, value: patch };
  }
  return {
    ok: true,
    value: {
      type: type.value as RestrictionType,
      targetId: targetId.value ?? '',
      startAt: startAt.value,
      endAt: endAt.value,
      vehicleType: vehicleType.value,
      reason: reason.value ?? ''
    }
  };
}

/**
 * `code` 不可改的字段在**更新**时收到 `code` 直接报错，而不是静默忽略。
 *
 * 与 D-19 同一条理由：静默忽略会让调用方以为改成功了（界面照旧显示旧编码，
 * 而调用方以为是自己没刷新）。宁可给一条明确的 `VALIDATION.FAILED`。
 */
function assertCodeImmutable(raw: Record<string, unknown>, fields: FieldErrors): RuleResult<never> | null {
  if (raw['code'] !== undefined) {
    return fieldError(fields, 'code', '编码创建后不可修改');
  }
  return null;
}

/**
 * 重载的意义：`mode` 决定返回的是「完整对象」还是「补丁」。
 * 不用重载的话返回类型是二者的联合，调用点每次都要自己窄化 ——
 * 而窄化错了编译器也不会拦（`Partial` 的字段都在联合里），
 * 于是「创建时忘了给 code 兜底」这类问题会一路跑到写库。
 */

/**
 * 站点输入校验（第 1/2/3/4/12 条）。
 *
 * **不查**唯一性与引用（第 6/7 条）—— 那些要读库，属领域层。返回值的字段顺序
 * 与错误顺序都稳定：一次请求可以同时报多个字段，前端据此一次性标红所有输入框。
 */
export function validateSiteInput(raw: Record<string, unknown>, mode: 'create'): RuleResult<SiteCreate>;
export function validateSiteInput(raw: Record<string, unknown>, mode: 'patch'): RuleResult<SitePatch>;
export function validateSiteInput(raw: Record<string, unknown>, mode: 'create' | 'patch'): RuleResult<SiteCreate | SitePatch> {
  const fields: FieldErrors = {};
  const code = readText(raw, 'code', { required: requiredWhen(mode, raw, 'code'), maxLength: FIELD_LIMITS.code }, fields);
  const name = readText(raw, 'name', { required: requiredWhen(mode, raw, 'name'), maxLength: FIELD_LIMITS.name }, fields);
  const type = readEnum(raw, 'type', SITE_TYPES, { required: requiredWhen(mode, raw, 'type') }, fields);
  const nodeId = readText(raw, 'nodeId', { required: false, maxLength: 64 }, fields);
  const x = readNumber(raw, 'x', { required: false }, fields);
  const y = readNumber(raw, 'y', { required: raw['y'] !== undefined }, fields);
  const remark = readText(raw, 'remark', { required: false, maxLength: FIELD_LIMITS.remark }, fields);
  if (!code.ok || !name.ok || !type.ok || !nodeId.ok || !x.ok || !y.ok || !remark.ok) {
    return { ok: false, fields };
  }
  const value: SiteCreate = {
    code: code.value ?? '',
    name: name.value ?? '',
    type: type.value as SiteType,
    nodeId: nodeId.value,
    x: x.value,
    y: y.value,
    remark: remark.value
  };
  if (mode === 'patch') {
    const immutable = assertCodeImmutable(raw, fields);
    if (immutable) {
      return immutable;
    }
    // 不打补丁到旧值上（那是领域层的事）：这里只交出「本次真的传了哪些字段」
    const patch: SitePatch = {};
    if (name.value !== null) patch.name = name.value;
    if (type.value !== null) patch.type = type.value;
    if (raw['nodeId'] !== undefined) patch.nodeId = value.nodeId;
    if (x.value !== null) patch.x = x.value;
    if (y.value !== null) patch.y = y.value;
    if (raw['remark'] !== undefined) patch.remark = value.remark;
    return { ok: true, value: patch };
  }
  return { ok: true, value };
}

export function validateVehicleInput(raw: Record<string, unknown>, mode: 'create'): RuleResult<VehicleCreate>;
export function validateVehicleInput(raw: Record<string, unknown>, mode: 'patch'): RuleResult<VehiclePatch>;
export function validateVehicleInput(
  raw: Record<string, unknown>,
  mode: 'create' | 'patch'
): RuleResult<VehicleCreate | VehiclePatch> {
  const fields: FieldErrors = {};
  const code = readText(raw, 'code', { required: requiredWhen(mode, raw, 'code'), maxLength: FIELD_LIMITS.code }, fields);
  const name = readText(raw, 'name', { required: requiredWhen(mode, raw, 'name'), maxLength: FIELD_LIMITS.name }, fields);
  const type = readEnum(raw, 'type', VEHICLE_TYPES, { required: requiredWhen(mode, raw, 'type') }, fields);
  const capacityKg = readNumber(raw, 'capacityKg', { required: requiredWhen(mode, raw, 'capacityKg'), min: Number.EPSILON }, fields);
  const maxSpeedMps = readNumber(raw, 'maxSpeedMps', { required: requiredWhen(mode, raw, 'maxSpeedMps'), min: Number.EPSILON }, fields);
  const currentNodeId = readText(raw, 'currentNodeId', { required: false, maxLength: 64 }, fields);
  /*
   * 坐标在**建车时**要么自己填、要么由所在节点派生（与站点的口径一致）。
   *
   * 因此「选了节点」可以两个都不填；既没有节点又没有坐标才报必填 ——
   * 一辆没有位置的车在地图上是孤点，调度也确定不了出发地。
   */
  const hasNode = typeof raw['currentNodeId'] === 'string' && raw['currentNodeId'].trim() !== '';
  const coordinateRequired = raw['x'] !== undefined || (mode === 'create' && !hasNode);
  const x = readNumber(raw, 'x', { required: coordinateRequired }, fields);
  const y = readNumber(raw, 'y', { required: raw['y'] !== undefined || (mode === 'create' && !hasNode) }, fields);
  const battery = readNumber(raw, 'battery', { required: raw['battery'] !== undefined, min: 0, max: 100 }, fields);
  const remark = readText(raw, 'remark', { required: false, maxLength: FIELD_LIMITS.remark }, fields);
  if (
    !code.ok || !name.ok || !type.ok || !capacityKg.ok || !maxSpeedMps.ok ||
    !currentNodeId.ok || !x.ok || !y.ok || !battery.ok || !remark.ok
  ) {
    return { ok: false, fields };
  }
  if (mode === 'patch') {
    const immutable = assertCodeImmutable(raw, fields);
    if (immutable) {
      return immutable;
    }
    const patch: VehiclePatch = {};
    if (name.value !== null) patch.name = name.value;
    if (type.value !== null) patch.type = type.value;
    if (capacityKg.value !== null) patch.capacityKg = capacityKg.value;
    if (maxSpeedMps.value !== null) patch.maxSpeedMps = maxSpeedMps.value;
    if (x.value !== null) patch.x = x.value;
    if (y.value !== null) patch.y = y.value;
    if (battery.value !== null) patch.battery = battery.value;
    if (raw['currentNodeId'] !== undefined) patch.currentNodeId = currentNodeId.value;
    if (raw['remark'] !== undefined) patch.remark = remark.value;
    return { ok: true, value: patch };
  }
  return {
    ok: true,
    value: {
      code: code.value ?? '',
      name: name.value ?? '',
      type: type.value as VehicleType,
      capacityKg: capacityKg.value ?? 0,
      maxSpeedMps: maxSpeedMps.value ?? 0,
      x: x.value,
      y: y.value,
      currentNodeId: currentNodeId.value,
      // 缺省 100%：新车第一次上线时电量是满的；显式传 0 仍被接受（域是 [0,100]）
      battery: battery.value ?? 100,
      remark: remark.value
    }
  };
}

export function validateNodeInput(raw: Record<string, unknown>, mode: 'create'): RuleResult<NodeCreate>;
export function validateNodeInput(raw: Record<string, unknown>, mode: 'patch'): RuleResult<NodePatch>;
export function validateNodeInput(raw: Record<string, unknown>, mode: 'create' | 'patch'): RuleResult<NodeCreate | NodePatch> {
  const fields: FieldErrors = {};
  const code = readText(raw, 'code', { required: requiredWhen(mode, raw, 'code'), maxLength: FIELD_LIMITS.code }, fields);
  const name = readText(raw, 'name', { required: requiredWhen(mode, raw, 'name'), maxLength: FIELD_LIMITS.name }, fields);
  const x = readNumber(raw, 'x', { required: requiredWhen(mode, raw, 'x') }, fields);
  const y = readNumber(raw, 'y', { required: requiredWhen(mode, raw, 'y') }, fields);
  const remark = readText(raw, 'remark', { required: false, maxLength: FIELD_LIMITS.remark }, fields);
  if (!code.ok || !name.ok || !x.ok || !y.ok || !remark.ok) {
    return { ok: false, fields };
  }
  if (mode === 'patch') {
    const immutable = assertCodeImmutable(raw, fields);
    if (immutable) {
      return immutable;
    }
    const patch: NodePatch = {};
    if (name.value !== null) patch.name = name.value;
    if (x.value !== null) patch.x = x.value;
    if (y.value !== null) patch.y = y.value;
    if (raw['remark'] !== undefined) patch.remark = remark.value;
    return { ok: true, value: patch };
  }
  return {
    ok: true,
    value: { code: code.value ?? '', name: name.value ?? '', x: x.value ?? 0, y: y.value ?? 0, remark: remark.value }
  };
}

export function validateEdgeInput(raw: Record<string, unknown>, mode: 'create'): RuleResult<EdgeCreate>;
export function validateEdgeInput(raw: Record<string, unknown>, mode: 'patch'): RuleResult<EdgePatch>;
export function validateEdgeInput(raw: Record<string, unknown>, mode: 'create' | 'patch'): RuleResult<EdgeCreate | EdgePatch> {
  const fields: FieldErrors = {};
  const code = readText(raw, 'code', { required: false, maxLength: FIELD_LIMITS.code }, fields);
  const fromNodeId = readText(raw, 'fromNodeId', { required: mode === 'create', maxLength: 64 }, fields);
  const toNodeId = readText(raw, 'toNodeId', { required: mode === 'create', maxLength: 64 }, fields);
  const lengthM = readNumber(raw, 'lengthM', { required: raw['lengthM'] !== undefined, min: Number.EPSILON }, fields);
  const speedLimitMps = readNumber(raw, 'speedLimitMps', { required: false, min: Number.EPSILON }, fields);
  // 权重下限是 1，**不是** `Number.EPSILON`：`weight < 1` 会让 A* 的启发式变成高估，
  // 于是返回一条非最优路线而且不报错（见 0005 迁移的注释）。这里把它拦在传输层，
  // DDL 的 CHECK 只是最后一道兜底，两者必须一致。
  const weight = readNumber(raw, 'weight', { required: false, min: 1 }, fields);
  const remark = readText(raw, 'remark', { required: false, maxLength: FIELD_LIMITS.remark }, fields);
  if (!code.ok || !fromNodeId.ok || !toNodeId.ok || !lengthM.ok || !speedLimitMps.ok || !weight.ok || !remark.ok) {
    return { ok: false, fields };
  }
  // 自环：DDL 有 `CHECK (from_node_id <> to_node_id)` 兜底，但**必须在这里先拦**，
  // 否则会以 SQLite 约束错误的形态冒出来（`SYS.INTERNAL`），而不是可引导的校验失败
  if (fromNodeId.value !== null && fromNodeId.value === toNodeId.value) {
    return { ok: false, fields: { ...fields, toNodeId: '起点与终点不能是同一个节点' } };
  }
  if (mode === 'patch') {
    const immutable = assertCodeImmutable(raw, fields);
    if (immutable) {
      return immutable;
    }
    const patch: EdgePatch = {};
    if (fromNodeId.value !== null) patch.fromNodeId = fromNodeId.value;
    if (toNodeId.value !== null) patch.toNodeId = toNodeId.value;
    if (lengthM.value !== null) patch.lengthM = lengthM.value;
    if (raw['speedLimitMps'] !== undefined) patch.speedLimitMps = speedLimitMps.value;
    if (weight.value !== null) patch.weight = weight.value;
    if (raw['remark'] !== undefined) patch.remark = remark.value;
    const from = patch.fromNodeId;
    const to = patch.toNodeId;
    if (from !== undefined && to !== undefined && from === to) {
      return { ok: false, fields: { toNodeId: '起点与终点不能是同一个节点' } };
    }
    return { ok: true, value: patch };
  }
  return {
    ok: true,
    value: {
      code: code.value,
      fromNodeId: fromNodeId.value ?? '',
      toNodeId: toNodeId.value ?? '',
      lengthM: lengthM.value,
      speedLimitMps: speedLimitMps.value,
      // 缺省 1：不填 = 畅通（与列默认值、与 `RouteEdgeInput.weight` 的兜底同一口径）
      weight: weight.value ?? 1,
      remark: remark.value
    }
  };
}

/**
 * 任务模板的写 DTO（`docs/api.md` §3.2.6）。
 *
 * 与其它五类的一个结构性差异：**模板没有状态**，因此没有 `TemplatePatch.status`，
 * 也没有「停用」这条路径 —— 契约里 `GET/POST/PUT` 三条，没有 `DELETE`。
 * 这不是遗漏：模板是填任务时的辅助，一旦被任务引用（`tasks.template_id`）就不能删，
 * 而「停用」需要一个状态列，当前 DDL 里没有 —— 与其临时加一列，不如先按“可编辑的草稿纸”定义。
 */
export interface TaskTemplateCreate {
  code: string;
  name: string;
  priority: TaskPriority;
  defaultCargoKg: number | null;
  timeWindowMinutes: number | null;
  fromSiteType: SiteType | null;
  toSiteType: SiteType | null;
  remark: string | null;
}

export type TaskTemplatePatch = Partial<{
  name: string;
  priority: TaskPriority;
  defaultCargoKg: number | null;
  timeWindowMinutes: number | null;
  fromSiteType: SiteType | null;
  toSiteType: SiteType | null;
  remark: string | null;
}>;

/**
 * 模板的字段规则。
 *
 * `priority` 在创建时**可以缺省**，缺省值是 `normal`（与 DDL 的 `DEFAULT 'normal'` 一致）。
 * 这不违反「不可为空的字段创建时必填」的口径 —— 那条规则针对的是调用方**给不出合理兜底**的字段
 * （编码、名称），而优先级有一个明确且无害的默认值。
 *
 * `defaultCargoKg` / `timeWindowMinutes` 的域照抄 DDL 的 CHECK：
 * `>= 0`、`> 0`（`min: 1`）。**两处必须一致**：DDL 拒掉的值若在这里通过，
 * 报出来会是 `SYS.INTERNAL` 而不是可引导的字段级错误（见 `ensureRestrictionWindow` 的同类说明）。
 */
export function validateTemplateInput(raw: Record<string, unknown>, mode: 'create'): RuleResult<TaskTemplateCreate>;
export function validateTemplateInput(raw: Record<string, unknown>, mode: 'patch'): RuleResult<TaskTemplatePatch>;
export function validateTemplateInput(
  raw: Record<string, unknown>,
  mode: 'create' | 'patch'
): RuleResult<TaskTemplateCreate | TaskTemplatePatch> {
  const fields: FieldErrors = {};
  const code = readText(raw, 'code', { required: requiredWhen(mode, raw, 'code'), maxLength: FIELD_LIMITS.code }, fields);
  const name = readText(raw, 'name', { required: requiredWhen(mode, raw, 'name'), maxLength: FIELD_LIMITS.name }, fields);
  // 创建时可选、缺省 normal；更新时同样可选（不传就是不改）
  const priority = readEnum(raw, 'priority', TASK_PRIORITIES, { required: false }, fields);
  const defaultCargoKg = readNumber(raw, 'defaultCargoKg', { required: false, min: 0 }, fields);
  const timeWindowMinutes = readNumber(raw, 'timeWindowMinutes', { required: false, min: 1, integer: true }, fields);
  const fromSiteType = readEnum(raw, 'fromSiteType', SITE_TYPES, { required: false }, fields);
  const toSiteType = readEnum(raw, 'toSiteType', SITE_TYPES, { required: false }, fields);
  const remark = readText(raw, 'remark', { required: false, maxLength: FIELD_LIMITS.remark }, fields);
  if (
    !code.ok ||
    !name.ok ||
    !priority.ok ||
    !defaultCargoKg.ok ||
    !timeWindowMinutes.ok ||
    !fromSiteType.ok ||
    !toSiteType.ok ||
    !remark.ok
  ) {
    return { ok: false, fields };
  }
  if (mode === 'patch') {
    const immutable = assertCodeImmutable(raw, fields);
    if (immutable) {
      return immutable;
    }
    const patch: TaskTemplatePatch = {};
    if (name.value !== null) patch.name = name.value;
    if (priority.value !== null) patch.priority = priority.value;
    // 四个可空列：显式传 null 表示清空（「不再预设货重 / 时间窗 / 站点类型」）
    if (raw['defaultCargoKg'] !== undefined) patch.defaultCargoKg = defaultCargoKg.value;
    if (raw['timeWindowMinutes'] !== undefined) patch.timeWindowMinutes = timeWindowMinutes.value;
    if (raw['fromSiteType'] !== undefined) patch.fromSiteType = fromSiteType.value;
    if (raw['toSiteType'] !== undefined) patch.toSiteType = toSiteType.value;
    if (raw['remark'] !== undefined) patch.remark = remark.value;
    return { ok: true, value: patch };
  }
  return {
    ok: true,
    value: {
      code: code.value ?? '',
      name: name.value ?? '',
      priority: priority.value ?? 'normal',
      defaultCargoKg: defaultCargoKg.value,
      timeWindowMinutes: timeWindowMinutes.value,
      fromSiteType: fromSiteType.value,
      toSiteType: toSiteType.value,
      remark: remark.value
    }
  };
}
