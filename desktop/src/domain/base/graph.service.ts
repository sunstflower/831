/**
 * 路网领域服务（M2，`docs/api.md` §3.2.3 / §3.2.4）：节点与有向边。
 *
 * 两者放同一文件因为它们的规则**互相纠缠**：边的两端必须是存在的节点、
 * 节点禁用前必须确认没有边与站点引用它、边长要按两端坐标推导。
 * 拆成两个服务就得互相 import，或者把「读节点坐标」这类查询抄两遍。
 */
import { randomUUID } from 'node:crypto';
import { DomainError, deriveEdgeCode, validateEdgeInput, validateNodeInput, type EdgeStatus } from '@udm/shared';
import { nowIso, tx } from '../../db/index.js';
import {
  countNodeReferences,
  findEdgeById,
  findNodeById,
  insertEdge,
  insertNode,
  setEdgeStatus as setEdgeStatusRow,
  setNodeStatus as setNodeStatusRow,
  updateEdgeRow,
  updateNodeRow
} from '../../db/repositories/graph.repo.js';
import { writeAudit } from '../../services/audit.js';
import { BASE_ACTIONS, toAuditActor, type CrudContext } from './context.js';
import {
  ensureBaseStatus,
  ensureCodeFree,
  ensureDirectionFree,
  ensureEdgeEndpointsExist,
  invalid
} from './validate.js';

export interface GraphWriteOptions {
  traceId?: string;
}

function requireNode(db: CrudContext['db'], id: string) {
  const node = findNodeById(db, id);
  if (!node) {
    throw new DomainError('NODE.NOT_FOUND', undefined, { id });
  }
  return node;
}

function requireEdge(db: CrudContext['db'], id: string) {
  const edge = findEdgeById(db, id);
  if (!edge) {
    throw new DomainError('EDGE.NOT_FOUND', undefined, { id });
  }
  return edge;
}

/** 两点欧氏距离（米）。边长缺省时按它推导。 */
function euclidean(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function createNode(ctx: CrudContext, raw: Record<string, unknown>) {
  return tx(ctx.db, () => {
    const parsed = validateNodeInput(raw, 'create');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const input = parsed.value;
    ensureCodeFree(ctx.db, 'node', input.code);
    const id = randomUUID();
    insertNode(ctx.db, { id, code: input.code, name: input.name, x: input.x, y: input.y, remark: input.remark });
    const created = requireNode(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.create,
      objectType: 'node',
      objectId: id,
      after: created
    });
    return created;
  });
}

export function updateNode(
  ctx: CrudContext,
  id: string,
  raw: Record<string, unknown>,
) {
  return tx(ctx.db, () => {
    const before = requireNode(ctx.db, id);
    const parsed = validateNodeInput(raw, 'patch');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    updateNodeRow(ctx.db, id, parsed.value);
    const after = requireNode(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.update,
      objectType: 'node',
      objectId: id,
      before,
      after
    });
    return after;
  });
}

export function setNodeStatus(
  ctx: CrudContext,
  id: string,
  status: EdgeStatus,
) {
  return tx(ctx.db, () => {
    const before = requireNode(ctx.db, id);
    ensureBaseStatus(status);
    if (before.status === status) {
      return before;
    }
    if (status === 'disabled') {
      const refs = countNodeReferences(ctx.db, id);
      if (refs.edges > 0 || refs.sites > 0) {
        // 把「被谁引用」写进 detail：使用者据此知道该先处理什么，
        // 而不是收到一句「被引用，禁止禁用」再自己去找引用它的边
        throw new DomainError('BASE.NODE_IN_USE', undefined, { id, ...refs });
      }
    }
    setNodeStatusRow(ctx.db, id, status);
    const after = requireNode(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: status === 'disabled' ? BASE_ACTIONS.disable : BASE_ACTIONS.enable,
      objectType: 'node',
      objectId: id,
      before,
      after
    });
    return after;
  });
}

export function createEdge(ctx: CrudContext, raw: Record<string, unknown>) {
  return tx(ctx.db, () => {
    const parsed = validateEdgeInput(raw, 'create');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const input = parsed.value;
    ensureEdgeEndpointsExist(ctx.db, input.fromNodeId, input.toNodeId);
    ensureDirectionFree(ctx.db, input.fromNodeId, input.toNodeId);
    const from = requireNode(ctx.db, input.fromNodeId);
    const to = requireNode(ctx.db, input.toNodeId);
    if (input.code) {
      // 显式给的 code 必须与推导值一致 —— 否则会被**静默丢弃**：
      // `edges.code` 列还没落地（D-35 待评审），读取层一律按两端节点 code 现场推导，
      // 于是「传了一个自定义 code」与「什么都没传」的效果完全相同。
      // 按 D-19 的同一理由（静默忽略会让调用方以为生效了）在这里直接拒绝。
      const derived = deriveEdgeCode(from.code, to.code);
      if (input.code !== derived) {
        throw invalid({
          code: `当前版本的边编码由两端节点推导（应为 ${derived}）；自定义编码需要 edges.code 列落地（D-35）`
        });
      }
    }
    // 边长缺省按坐标推导：让调用方只给两端、不必自己算（算错了还得人工核对）
    const lengthM = input.lengthM ?? euclidean(from, to);
    if (lengthM <= 0) {
      // 两端坐标重合：推导不出正长度，而 DDL 要求 `length_m > 0`。
      // 这是**数据问题**（两个节点画在同一个点上），交给使用者决定是改坐标还是手工给边长
      throw invalid({ lengthM: '两端节点坐标重合，无法推导边长，请手工指定 lengthM 或修正节点坐标' });
    }
    const id = randomUUID();
    insertEdge(ctx.db, {
      id,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      lengthM,
      speedLimitMps: input.speedLimitMps,
      remark: input.remark
    });
    const created = requireEdge(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.create,
      objectType: 'edge',
      objectId: id,
      after: created
    });
    return created;
  });
}

export function updateEdge(
  ctx: CrudContext,
  id: string,
  raw: Record<string, unknown>,
) {
  return tx(ctx.db, () => {
    const before = requireEdge(ctx.db, id);
    const parsed = validateEdgeInput(raw, 'patch');
    if (!parsed.ok) {
      throw invalid(parsed.fields);
    }
    const patch = parsed.value;
    // 端点补齐后再判引用与自环：只改一端时，**另一端取旧值**才能判断
    const fromNodeId = patch.fromNodeId ?? before.fromNodeId;
    const toNodeId = patch.toNodeId ?? before.toNodeId;
    if (fromNodeId === toNodeId) {
      throw invalid({ toNodeId: '起点与终点不能是同一个节点' });
    }
    const endpointsChanged = patch.fromNodeId !== undefined || patch.toNodeId !== undefined;
    if (endpointsChanged) {
      ensureEdgeEndpointsExist(ctx.db, fromNodeId, toNodeId);
      ensureDirectionFree(ctx.db, fromNodeId, toNodeId, id);
    }
    const next: typeof patch = { ...patch };
    if (endpointsChanged && patch.lengthM === undefined) {
      // 端点变了而没给新边长：旧长度已失效（它按旧端点算的），必须重新推导。
      // 这是「改了坐标但长度没变」这类静默不一致的根因
      const from = requireNode(ctx.db, fromNodeId);
      const to = requireNode(ctx.db, toNodeId);
      const derived = euclidean(from, to);
      if (derived <= 0) {
        throw invalid({ lengthM: '两端节点坐标重合，无法推导边长，请手工指定 lengthM' });
      }
      next.lengthM = derived;
    }
    updateEdgeRow(ctx.db, id, next);
    const after = requireEdge(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: BASE_ACTIONS.update,
      objectType: 'edge',
      objectId: id,
      before,
      after
    });
    return after;
  });
}

export function setEdgeStatus(
  ctx: CrudContext,
  id: string,
  status: EdgeStatus,
) {
  return tx(ctx.db, () => {
    const before = requireEdge(ctx.db, id);
    ensureBaseStatus(status);
    if (before.status === status) {
      return before;
    }
    setEdgeStatusRow(ctx.db, id, status);
    const after = requireEdge(ctx.db, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'base',
      action: status === 'disabled' ? BASE_ACTIONS.disable : BASE_ACTIONS.enable,
      objectType: 'edge',
      objectId: id,
      before,
      after
    });
    return after;
  });
}

