/**
 * M3 任务的**字段规则**（唯一作者，`docs/api.md` §3.3.3 / §3.3.5）。
 *
 * 与 `base-rules.ts` 同一分工：规则放这里，主进程的领域服务与浏览器 Mock 都调它，
 * 各自只负责自己的存储（唯一性、引用、写表）。原语（`readText` / `readNumber` /
 * `readEnum` / `readTime` / `requiredWhen`）从 `base-rules.ts` 复用，**不复制**。
 *
 * ## 两个跨字段约束放在哪
 *
 *   `fromSiteId <> toSiteId` 与 `timeWindowEnd > timeWindowStart` 都是 DDL 里的 CHECK。
 *   创建时两个值都在同一份载荷里，因此**能在这里判完**（`validateTaskInput('create')`）；
 *   编辑时可能只传来其中一个，另一个要用库里的旧值 —— 那只有领域服务拿得到，
 *   所以本文件同时导出 `taskWindowError` / `taskEndpointError` 两个纯判定，
 *   让服务层在 patch 路径上**调用同一份比较逻辑**，而不是自己再写一遍 `>` 或 `!==`。
 *   少写这一层的后果是可预期的：请求通过校验、被 SQLite 的 CHECK 拒掉，
 *   报出来是 `SYS.INTERNAL`（一条看不出原因的 500）。
 */
import { TASK_PRIORITIES, type TaskPriority } from './enums.js';
import {
  FIELD_LIMITS,
  fieldError,
  readEnum,
  readNumber,
  readText,
  readTime,
  requiredWhen,
  type FieldErrors,
  type RuleResult
} from './base-rules.js';

/**
 * 任务标题的长度上限。
 *
 * 与站点 / 车辆名称不同（100），标题是一句话而不是一个名字：留 200 让人把
 * 「A 仓经 B 仓转运到 C 仓」写进去；上限仍然要有，否则列表行的宽度会被撑爆。
 */
export const TASK_TITLE_MAX_LENGTH = 200;

/** 货物描述上限（同 `remark` 一档）。 */
export const TASK_CARGO_DESC_MAX_LENGTH = FIELD_LIMITS.remark;

/** 载重上限（kg）：大于此值的任务不是「一辆车」能拉的，应当拆单。 */
export const TASK_MAX_CARGO_KG = 20000;

/** 创建 DTO（`docs/api.md` §3.3.3）。 */
export interface TaskCreate {
  title: string;
  templateId: string | null;
  priority: TaskPriority;
  cargoKg: number;
  cargoDesc: string | null;
  fromSiteId: string;
  toSiteId: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
}

/**
 * 编辑补丁（`docs/api.md` §3.3.5）。
 *
 * **不含 `status` / `assignedVehicleId` / `code` / `templateId`**：契约明说前两个不可直接改，
 * `code` 创建后不可变（与 M2 的 `code` 同一口径）；`templateId` 是「创建时套用」的一次性输入
 * —— 允许事后改它会让「这条任务到底是按哪个模板建的」变成一个可以随时被抹掉的事实，
 * 而模板变更与否本就不该反向影响已建任务（模板只提供默认值，不持有任务）。
 */
export type TaskPatch = Partial<{
  title: string;
  priority: TaskPriority;
  cargoKg: number;
  cargoDesc: string | null;
  fromSiteId: string;
  toSiteId: string;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
}>;

/**
 * 时间窗的跨字段判定（创建与编辑**共用**）。
 *
 * 返回 `null` 表示通过；否则返回给 `endAt` 字段的错误文案。
 * 两个值都可以为空（= 无时间窗约束），但**不能只有一个** —— 严格说只有一个也能表达语义
 * （「某时刻之后任意时间」），`restrictions` 就是这么设计的；任务不同：
 * 调度要用窗口判「能不能在窗口内跑完」，只有一个端点时会退化成全时段的候选评估，
 * 那是无意义的输入而非有意义的约束，因此这里要求成对出现。
 */
export function taskWindowError(start: string | null, end: string | null): string | null {
  if (start === null && end === null) {
    return null;
  }
  if (start === null || end === null) {
    return '时间窗必须同时给出开始与结束（或都不给）';
  }
  if (!(end > start)) {
    return '结束时间必须晚于开始时间';
  }
  return null;
}

/** 起终点不能相同（DDL 的 `CHECK (from_site_id <> to_site_id)`）。 */
export function taskEndpointError(fromSiteId: string, toSiteId: string): string | null {
  return fromSiteId === toSiteId ? '起点与终点不能是同一个站点' : null;
}

export function validateTaskInput(raw: Record<string, unknown>, mode: 'create'): RuleResult<TaskCreate>;
export function validateTaskInput(raw: Record<string, unknown>, mode: 'patch'): RuleResult<TaskPatch>;
export function validateTaskInput(
  raw: Record<string, unknown>,
  mode: 'create' | 'patch'
): RuleResult<TaskCreate | TaskPatch> {
  const fields: FieldErrors = {};
  const title = readText(
    raw,
    'title',
    { required: requiredWhen(mode, raw, 'title'), maxLength: TASK_TITLE_MAX_LENGTH },
    fields
  );
  // 模板 id：可选。**不在这里判它是否存在**（那是必须读库的引用校验，属领域服务）
  const templateId = readText(raw, 'templateId', { required: false, maxLength: 64 }, fields);
  const priority = readEnum(raw, 'priority', TASK_PRIORITIES, { required: false }, fields);
  const cargoKg = readNumber(
    raw,
    'cargoKg',
    { required: requiredWhen(mode, raw, 'cargoKg'), min: 0, max: TASK_MAX_CARGO_KG },
    fields
  );
  const cargoDesc = readText(raw, 'cargoDesc', { required: false, maxLength: TASK_CARGO_DESC_MAX_LENGTH }, fields);
  const fromSiteId = readText(
    raw,
    'fromSiteId',
    { required: requiredWhen(mode, raw, 'fromSiteId'), maxLength: 64 },
    fields
  );
  const toSiteId = readText(raw, 'toSiteId', { required: requiredWhen(mode, raw, 'toSiteId'), maxLength: 64 }, fields);
  const timeWindowStart = readTime(raw, 'timeWindowStart', fields);
  const timeWindowEnd = readTime(raw, 'timeWindowEnd', fields);

  if (
    !title.ok ||
    !templateId.ok ||
    !priority.ok ||
    !cargoKg.ok ||
    !cargoDesc.ok ||
    !fromSiteId.ok ||
    !toSiteId.ok ||
    !timeWindowStart.ok ||
    !timeWindowEnd.ok
  ) {
    return { ok: false, fields };
  }

  /*
   * 跨字段：起终点与时间窗**只在两个值都出现在本次请求里时**才能判。
   *
   * 编辑时只传 `toSiteId` 是合法请求（另一个用库里的旧值），此时在这里判会拿 `''`
   * 与真实 id 比较，得出一个假的「起终点相同」。因此 patch 模式下这两个判定
   * 一律交给领域服务（它读得到旧值），并且服务层调用的是**下面同一对纯函数**。
   */
  if (mode === 'create') {
    const endpointError = taskEndpointError(fromSiteId.value ?? '', toSiteId.value ?? '');
    if (endpointError) {
      fields['toSiteId'] = endpointError;
    }
    const windowError = taskWindowError(timeWindowStart.value, timeWindowEnd.value);
    if (windowError) {
      fields['timeWindowEnd'] = windowError;
    }
    if (Object.keys(fields).length > 0) {
      return { ok: false, fields };
    }
    return {
      ok: true,
      value: {
        title: title.value as string,
        templateId: templateId.value,
        // 缺省优先级是 `normal`（DDL 的 `DEFAULT 'normal'`），**不是**枚举首项 `low`
        priority: (priority.value ?? 'normal') as TaskPriority,
        cargoKg: cargoKg.value as number,
        cargoDesc: cargoDesc.value,
        fromSiteId: fromSiteId.value as string,
        toSiteId: toSiteId.value as string,
        timeWindowStart: timeWindowStart.value,
        timeWindowEnd: timeWindowEnd.value
      }
    };
  }

  // 模板只能在创建时指定：改它等于悄悄换掉「这条任务的默认值来自哪」，
  // 而任务字段本身并没有跟着变 —— 一个没有对应效果的成功响应。
  // 与 M2 的 `code` 同一口径（`assertCodeImmutable`）：显式传了就报错，不静默忽略
  if (raw['templateId'] !== undefined) {
    fieldError(fields, 'templateId', '模板只能在创建时指定');
    return { ok: false, fields };
  }
  const patch: TaskPatch = {};
  if (title.value !== null) patch.title = title.value;
  if (priority.value !== null) patch.priority = priority.value;
  if (cargoKg.value !== null) patch.cargoKg = cargoKg.value;
  if (fromSiteId.value !== null) patch.fromSiteId = fromSiteId.value;
  if (toSiteId.value !== null) patch.toSiteId = toSiteId.value;
  // 可空列：**显式传 null 才是清空**（`=== undefined` 表示这次没动它）——
  // 见 `base-rules.ts` 的「空值三态」。若按 `!== null` 判断，清空时间窗这件事
  // 在界面上永远做不到，而请求会安静地成功（`ISS-058` 的同一族问题）
  if (raw['cargoDesc'] !== undefined) patch.cargoDesc = cargoDesc.value;
  if (raw['timeWindowStart'] !== undefined) patch.timeWindowStart = timeWindowStart.value;
  if (raw['timeWindowEnd'] !== undefined) patch.timeWindowEnd = timeWindowEnd.value;
  return { ok: true, value: patch };
}
