/**
 * 任务模板领域服务（M2，`docs/api.md` §3.2.6 的写接口）。
 *
 * 三个方法都很薄 —— 模板没有状态、没有引用要判、没有跨字段比较，
 * 因此这里只需要「读旧值 → 校验 → 写表 → 写审计」这条固定顺序（§4）。
 *
 * **没有 `deleteTemplate` / `setTemplateStatus`**：契约里没有 `DELETE`，
 * DDL 里也没有 status 列（见 `template.repo.ts` 的说明）。
 * 服务层不提供契约之外的入口，比提供后再靠调用方自觉不用要可靠 ——
 * 后者在半年后会被当成「已经支持但没写文档」。
 */
import { randomUUID } from 'node:crypto';
import { DomainError, validateTemplateInput } from '@udm/shared';
import { nowIso, tx } from '../../db/index.js';
import {
  findTemplateById,
  insertTemplate,
  updateTemplateRow
} from '../../db/repositories/template.repo.js';
import { writeAudit } from '../../services/audit.js';
import { BASE_ACTIONS, toAuditActor, type CrudContext } from './context.js';
import { ensureCodeFree, invalid } from './validate.js';

function requireTemplate(db: CrudContext['db'], id: string) {
  const template = findTemplateById(db, id);
  if (!template) {
    throw new DomainError('TEMPLATE.NOT_FOUND', undefined, { id });
  }
  return template;
}

export function createTemplate(ctx: CrudContext, raw: Record<string, unknown>) {
  return tx(ctx.db, () => {
    const parsed = validateTemplateInput(raw, 'create');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const input = parsed.value;
    ensureCodeFree(ctx.db, 'template', input.code);
    const at = nowIso();
    const id = randomUUID();
    insertTemplate(ctx.db, {
      id,
      code: input.code,
      name: input.name,
      priority: input.priority,
      defaultCargoKg: input.defaultCargoKg,
      timeWindowMinutes: input.timeWindowMinutes,
      fromSiteType: input.fromSiteType,
      toSiteType: input.toSiteType,
      remark: input.remark,
      at
    });
    const created = requireTemplate(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.create,
      objectType: 'taskTemplate',
      objectId: id,
      after: created
    });
    return created;
  });
}

export function updateTemplate(ctx: CrudContext, id: string, raw: Record<string, unknown>) {
  return tx(ctx.db, () => {
    const before = requireTemplate(ctx.db, id);
    const parsed = validateTemplateInput(raw, 'patch');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const patch = parsed.value;
    const at = nowIso();
    updateTemplateRow(ctx.db, id, patch, at);
    const after = requireTemplate(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.update,
      objectType: 'taskTemplate',
      objectId: id,
      before,
      after
    });
    return after;
  });
}
