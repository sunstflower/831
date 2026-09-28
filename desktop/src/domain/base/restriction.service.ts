/**
 * 禁行规则领域服务（M2，`docs/api.md` §3.2.5）。
 *
 * 与另外三个服务的三处差异，都是「禁行规则」这个对象自身决定的：
 *
 * 1. **允许物理删除**（`updateRestriction` / `deleteRestriction`）：`design.md` D-07 定的是
 *    「站点/车辆/节点/边一律软删」，唯一的例外就是禁行规则 —— 它没有历史依赖
 *    （不是任何表的引用目标），留着 `expired` 的残规则只会让「哪些规则在生效」越来越难读。
 * 2. **目标存在性要判两次**：更新时若改了 `type` 或 `targetId`（任一），
 *    目标可能在新类型下不存在（把 `edge` 规则改成 `node` 规则、却仍指向原来的边 id）。
 * 3. **时间窗是跨字段比较**：只传来 `endAt` 时要和库里的 `startAt` 配对判，
 *    因此校验发生在服务层而不是纯函数层（见 `validate.ts` 的 `ensureRestrictionWindow`）。
 *
 * 事务与审计的顺序与其它服务一致：读旧值 → 校验 → 写表 → 写审计（一个 tx）。
 */
import { randomUUID } from 'node:crypto';
import { DomainError, validateRestrictionInput } from '@udm/shared';
import { nowIso, tx } from '../../db/index.js';
import {
  deleteRestrictionRow,
  findRestrictionById,
  insertRestriction,
  updateRestrictionRow
} from '../../db/repositories/restriction.repo.js';
import { writeAudit } from '../../services/audit.js';
import { BASE_ACTIONS, toAuditActor, type CrudContext } from './context.js';
import { ensureRestrictionTargetExists, ensureRestrictionWindow, invalid } from './validate.js';

function requireRestriction(db: CrudContext['db'], id: string) {
  const restriction = findRestrictionById(db, id);
  if (!restriction) {
    throw new DomainError('RESTRICTION.NOT_FOUND', undefined, { id });
  }
  return restriction;
}

export function createRestriction(ctx: CrudContext, raw: Record<string, unknown>) {
  return tx(ctx.db, () => {
    const parsed = validateRestrictionInput(raw, 'create');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const input = parsed.value;
    ensureRestrictionTargetExists(ctx.db, input.type, input.targetId);
    ensureRestrictionWindow(input.startAt, input.endAt);
    const at = nowIso();
    const id = randomUUID();
    insertRestriction(ctx.db, {
      id,
      type: input.type,
      targetId: input.targetId,
      startAt: input.startAt,
      endAt: input.endAt,
      vehicleType: input.vehicleType,
      reason: input.reason,
      // 创建者取自会话（`audit_logs` 里也有 actor，但规则表自己的 `created_by`
      // 会被「谁建的规则」这类查询直接读到，不该要求先 join 审计表）
      createdBy: ctx.actor?.actorId ?? null,
      at
    });
    const created = requireRestriction(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.create,
      objectType: 'restriction',
      objectId: id,
      after: created
    });
    return created;
  });
}

export function updateRestriction(ctx: CrudContext, id: string, raw: Record<string, unknown>) {
  return tx(ctx.db, () => {
    const before = requireRestriction(ctx.db, id);
    const parsed = validateRestrictionInput(raw, 'patch');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const patch = parsed.value;
    const nextType = patch.type ?? before.type;
    const nextTargetId = patch.targetId ?? before.targetId;
    if (patch.type !== undefined || patch.targetId !== undefined) {
      ensureRestrictionTargetExists(ctx.db, nextType, nextTargetId);
    }
    ensureRestrictionWindow(
      patch.startAt !== undefined ? patch.startAt : before.startAt,
      patch.endAt !== undefined ? patch.endAt : before.endAt
    );
    updateRestrictionRow(ctx.db, id, patch);
    const after = requireRestriction(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: patch.status === 'expired' ? BASE_ACTIONS.disable : BASE_ACTIONS.update,
      objectType: 'restriction',
      objectId: id,
      before,
      after
    });
    return after;
  });
}

export function deleteRestriction(ctx: CrudContext, id: string) {
  return tx(ctx.db, () => {
    const before = requireRestriction(ctx.db, id);
    deleteRestrictionRow(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      // 物理删除也留痕（这正是「允许物理删除」仍然可控的原因：行没了，但谁删的还在）
      action: BASE_ACTIONS.delete,
      objectType: 'restriction',
      objectId: id,
      before
    });
    return { id, deleted: true };
  });
}
