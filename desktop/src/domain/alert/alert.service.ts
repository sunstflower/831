/**
 * 告警领域服务（M8，`docs/api.md` §3.8）。
 *
 * ## 分工
 *
 *   - `listAlerts` / `getAlertDetail`：读；
 *   - `runAlertAction`：三个状态操作（`acknowledge` / `resolve` / `archive`）的公共实现；
 *   - `createAlert`：**供执行器与人工接管**落一条告警（带去重窗口）。
 *
 * ## 状态机不在这里
 *
 * 「这个状态能不能确认」的唯一作者是 `@udm/shared` 的 `alert-state.ts`，
 * M8 的三个接口、执行器的接管路径、浏览器 Mock 全部读它（理由见该文件头）。
 *
 * ## 事务与事件
 *
 * 写方法各自一个 `tx()`，顺序固定「读旧值 → 状态机校验 → 写表 → 写审计」；
 * 事件由调用点（`ipc/api.ts` / 执行器）在事务提交**之后**发（`../base/context.js`）。
 */
import { randomUUID } from 'node:crypto';
import {
  ALERT_NEXT_STEPS,
  DomainError,
  checkAlertTransition,
  type AlertAction,
  type AlertDetail,
  type AlertListItem,
  type AlertStatus,
  type AuditContext
} from '@udm/shared';
import { nowIso, tx, type Db } from '../../db/index.js';
import {
  applyAlertTransition,
  findAlertById,
  findDuplicateAlert,
  insertAlert,
  listAlerts as listAlertRows,
  parseAlertDetail,
  type AlertQuery,
  type AlertRow
} from '../../db/repositories/alert.repo.js';
import { getSettings, parseSettingsValues } from '../../db/repositories/settings.repo.js';
import { getTaskDetail } from '../../db/repositories/task.repo.js';
import { findVehicleById } from '../../db/repositories/vehicle.repo.js';
import { writeAudit } from '../../services/audit.js';
import { toAuditActor, type CrudContext } from '../base/context.js';
import { invalid } from '../base/validate.js';

export interface AlertTransitionResult extends AlertDetail {
  transition: { from: AlertStatus; to: AlertStatus };
}

function toListItem(row: AlertRow): AlertListItem {
  return {
    id: row.id,
    type: row.type,
    level: row.level,
    objectType: row.object_type,
    objectId: row.object_id,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    ackBy: row.ack_by,
    ackAt: row.ack_at,
    resolveBy: row.resolve_by,
    resolveAt: row.resolve_at
  };
}

/**
 * 关联对象摘要。
 *
 * 取不到时返回 `null` 而不是抛错：告警指向的对象可能已经被物理删除
 * （禁行规则是唯一允许物理删除的实体），而「告警还在、对象没了」正是
 * 使用者最需要看到的信息 —— 这里把 `null` 如实传下去。
 */
function relatedOf(db: Db, row: AlertRow): AlertDetail['related'] {
  if (row.object_type === 'task' && row.object_id) {
    const task = getTaskDetail(db, row.object_id);
    if (task) {
      return { task: { id: task.id, code: task.code, title: task.title, status: task.status }, vehicle: null };
    }
  }
  if (row.object_type === 'vehicle' && row.object_id) {
    const vehicle = findVehicleById(db, row.object_id);
    if (vehicle) {
      return {
        task: null,
        vehicle: { id: vehicle.id, code: vehicle.code, name: vehicle.name, status: vehicle.status }
      };
    }
  }
  return { task: null, vehicle: null };
}

export function toAlertDetail(db: Db, row: AlertRow): AlertDetail {
  return {
    ...toListItem(row),
    detail: parseAlertDetail(row.detail),
    resolution: row.resolution,
    dedupeKey: row.dedupe_key,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
    related: relatedOf(db, row),
    suggestedNextSteps: ALERT_NEXT_STEPS[row.type]
  };
}

export function listAlerts(db: Db, query: AlertQuery): { records: AlertListItem[]; total: number } {
  const { records, total } = listAlertRows(db, query);
  return { records: records.map(toListItem), total };
}

export function getAlertDetail(db: Db, id: string): AlertDetail {
  const row = findAlertById(db, id);
  if (!row) {
    throw new DomainError('ALERT.NOT_FOUND', undefined, { id });
  }
  return toAlertDetail(db, row);
}

/** 备注类字段（`note` / `resolution`）：长度受限、去掉首尾空白。 */
function readNote(payload: Record<string, unknown>, field: string, required: boolean): string | null {
  const value = payload[field];
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw invalid({ [field]: `${field} 不能为空` });
    }
    return null;
  }
  if (typeof value !== 'string') {
    throw invalid({ [field]: '必须是字符串' });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (required) {
      throw invalid({ [field]: `${field} 不能为空` });
    }
    return null;
  }
  if (trimmed.length > 200) {
    throw invalid({ [field]: '长度不能超过 200' });
  }
  return trimmed;
}

/**
 * 状态操作（`docs/api.md` §3.8.3）。
 *
 * `resolve` 的说明文字是**必填**的：处置结论是这条告警唯一有价值的知识
 * （「上次同类问题是怎么解决的」），允许空着等于把这条信息永久丢掉。
 * `acknowledge` / `archive` 的备注可选。
 */
export function runAlertAction(
  ctx: CrudContext,
  id: string,
  action: AlertAction,
  payload: Record<string, unknown>
): AlertTransitionResult {
  const note = action === 'resolve' ? readNote(payload, 'resolution', true) : readNote(payload, 'note', false);
  return tx(ctx.db, () => {
    const before = findAlertById(ctx.db, id);
    if (!before) {
      throw new DomainError('ALERT.NOT_FOUND', undefined, { id, action });
    }
    const check = checkAlertTransition(action, before.status);
    if (!check.ok) {
      throw new DomainError('ALERT.STATE_CONFLICT', check.failure.message, {
        id,
        action,
        from: check.failure.from,
        expected: check.failure.expected,
        to: check.failure.to
      });
    }
    const at = nowIso();
    const actorName = ctx.actor?.actorName ?? null;
    applyAlertTransition(ctx.db, id, {
      status: check.transition.to,
      ...(action === 'acknowledge' ? { ackAt: at, ackBy: actorName } : {}),
      ...(action === 'resolve' ? { resolveAt: at, resolveBy: actorName, resolution: note } : {}),
      ...(action === 'archive' ? { archivedAt: at, archivedBy: actorName } : {})
    });
    const after = findAlertById(ctx.db, id)!;
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'alert',
      action,
      objectType: 'alert',
      objectId: id,
      before: toListItem(before),
      after: toListItem(after),
      ...(note ? { message: note } : {})
    });
    return { ...toAlertDetail(ctx.db, after), transition: { from: before.status, to: after.status } };
  });
}

export interface CreateAlertInput {
  type: AlertListItem['type'];
  level: AlertListItem['level'];
  objectType: AlertListItem['objectType'];
  objectId: string | null;
  message: string;
  detail?: Record<string, unknown>;
  /** 去重键；缺省为 `类型:对象id`（同对象同类型在窗口内只留一条）。 */
  dedupeKey?: string;
  actor?: AuditContext | null;
}

export interface CreateAlertResult {
  id: string;
  /** `true` = 命中去重窗口，**没有**新建行（调用方据此决定要不要发事件）。 */
  deduped: boolean;
}

/**
 * 落一条告警（执行器与人工接管共用）。
 *
 * 去重窗口读设置表的 `alert.dedupeWindowS`（D-09）：一台离线 10 分钟的车辆
 * 每次心跳超时都插一条，会把告警列表刷成同一条消息的 600 个副本。
 */
export function createAlert(ctx: CrudContext, input: CreateAlertInput): CreateAlertResult {
  return tx(ctx.db, () => {
    const at = nowIso();
    const dedupeKey = input.dedupeKey ?? `${input.type}:${input.objectId ?? 'none'}`;
    const windowS = Number(parseSettingsValues(getSettings(ctx.db))['alert.dedupeWindowS'] ?? 300);
    if (windowS > 0) {
      const since = new Date(Date.now() - windowS * 1000).toISOString();
      const duplicate = findDuplicateAlert(ctx.db, dedupeKey, since);
      if (duplicate) {
        return { id: duplicate.id, deduped: true };
      }
    }
    const id = randomUUID();
    insertAlert(ctx.db, {
      id,
      type: input.type,
      level: input.level,
      objectType: input.objectType,
      objectId: input.objectId,
      message: input.message,
      detail: input.detail ?? {},
      dedupeKey,
      at
    });
    writeAudit(ctx.db, toAuditActor(input.actor ?? ctx.actor), {
      module: 'alert',
      action: 'create',
      objectType: 'alert',
      objectId: id,
      after: { type: input.type, level: input.level, objectType: input.objectType, objectId: input.objectId, message: input.message }
    });
    return { id, deduped: false };
  });
}
