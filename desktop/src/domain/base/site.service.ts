/**
 * 站点领域服务（M2，`docs/api.md` §3.2.1 的写接口）。
 *
 * 每个方法都是「一个事务 + 一次审计」，顺序固定为「读旧值 → 校验 → 写表 → 写审计」（§4）。
 * 事件不在这里发：调用点在事务提交之后发（见 `context.ts` 的说明）。
 */
import { randomUUID } from 'node:crypto';
import { DomainError, validateSiteInput, type EdgeStatus } from '@udm/shared';
import { nowIso, tx } from '../../db/index.js';
import { findNodeById } from '../../db/repositories/graph.repo.js';
import {
  findSiteById,
  insertSite,
  setSiteStatus as setSiteStatusRow,
  updateSiteRow
} from '../../db/repositories/site.repo.js';
import { writeAudit } from '../../services/audit.js';
import { BASE_ACTIONS, toAuditActor, type CrudContext } from './context.js';
import { ensureBaseStatus, ensureCodeFree, ensureNodeExists, invalid } from './validate.js';

function requireSite(db: CrudContext['db'], id: string) {
  const site = findSiteById(db, id);
  if (!site) {
    throw new DomainError('SITE.NOT_FOUND', undefined, { id });
  }
  return site;
}

/**
 * 站点坐标：优先用请求里给的，其次**跟随绑定节点**，最后才是 `(0,0)`。
 *
 * 为什么允许缺省而不是直接报错：站点与节点绑定之后，它的位置**本来就等于**节点的位置
 * （`GET /api/map/overview` 的站点坐标也是这么派生的），要求调用方把同一个坐标抄两遍
 * 只会制造「两处坐标不一致」的机会。
 */
function resolveXY(
  db: CrudContext['db'],
  input: { x: number | null; y: number | null; nodeId: string | null }
): { x: number; y: number } {
  const node = input.nodeId ? findNodeById(db, input.nodeId) : undefined;
  return { x: input.x ?? node?.x ?? 0, y: input.y ?? node?.y ?? 0 };
}

export function createSite(ctx: CrudContext, raw: Record<string, unknown>) {
  return tx(ctx.db, () => {
    const parsed = validateSiteInput(raw, 'create');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const input = parsed.value;
    ensureCodeFree(ctx.db, 'site', input.code);
    if (input.nodeId) {
      ensureNodeExists(ctx.db, input.nodeId);
    }
    const { x, y } = resolveXY(ctx.db, input);
    const at = nowIso();
    const id = randomUUID();
    insertSite(ctx.db, {
      id,
      code: input.code,
      name: input.name,
      type: input.type,
      nodeId: input.nodeId,
      x,
      y,
      remark: input.remark,
      at
    });
    const created = requireSite(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.create,
      objectType: 'site',
      objectId: id,
      after: created
    });
    return created;
  });
}

export function updateSite(
  ctx: CrudContext,
  id: string,
  raw: Record<string, unknown>,
) {
  return tx(ctx.db, () => {
    const before = requireSite(ctx.db, id);
    const parsed = validateSiteInput(raw, 'patch');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const patch = parsed.value;
    if (patch.nodeId !== undefined && patch.nodeId !== null) {
      ensureNodeExists(ctx.db, patch.nodeId);
    }
    // 坐标未显式给出时**跟随绑定节点**，否则站点会留在旧节点上（换绑之后位置却没动）。
    // 跟随只发生在「本次改了 nodeId」或「原有坐标缺失」这两种情况：
    // 否则一次「只改备注」的请求会把使用者手工调过的坐标悄悄拉回节点位置。
    const nextNodeId = patch.nodeId === undefined ? before.nodeId : patch.nodeId;
    const nodeChanged = patch.nodeId !== undefined && patch.nodeId !== before.nodeId;
    const follow = nodeChanged ? resolveXY(ctx.db, { x: null, y: null, nodeId: nextNodeId }) : null;
    const at = nowIso();
    updateSiteRow(
      ctx.db,
      id,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.nodeId !== undefined ? { nodeId: patch.nodeId } : {}),
        ...(patch.x !== undefined ? { x: patch.x } : follow ? { x: follow.x } : {}),
        ...(patch.y !== undefined ? { y: patch.y } : follow ? { y: follow.y } : {}),
        ...(patch.remark !== undefined ? { remark: patch.remark } : {})
      },
      at
    );
    const after = requireSite(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.update,
      objectType: 'site',
      objectId: id,
      before,
      after
    });
    return after;
  });
}

export function setSiteStatus(
  ctx: CrudContext,
  id: string,
  status: EdgeStatus,
) {
  return tx(ctx.db, () => {
    const before = requireSite(ctx.db, id);
    ensureBaseStatus(status);
    if (before.status === status) {
      // 幂等：已是目标状态就直接返回，不写审计。否则「重复点两次停用」会留下两条 disable，
      // 之后按审计追溯「谁停用了它」时会看到重复记录（与车辆、路网启停同一口径）
      return before;
    }
    const at = nowIso();
    setSiteStatusRow(ctx.db, id, status, at);
    const after = requireSite(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: status === 'disabled' ? BASE_ACTIONS.disable : BASE_ACTIONS.enable,
      objectType: 'site',
      objectId: id,
      before,
      after
    });
    return after;
  });
}

