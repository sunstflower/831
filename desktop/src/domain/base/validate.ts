/**
 * M2 的**跨表**校验（唯一性、引用完整性）。
 *
 * 字段级规则（长度 / 数值域 / 枚举 / 自环）在 `@udm/shared` 的 `base-rules.ts`，
 * 因为浏览器 Mock 也要判同一批规则。本文件只放**必须读库**的那几条 ——
 * Mock 的库是内存数组，主进程的库是 SQLite，除了「怎么查」之外没有别的差别。
 *
 * 每个函数返回「失败时的错误」或 `null`（通过），调用点因此可以写成
 * `throwIf(fail) ?? 继续` 的线性顺序，与 §5 的校验序号一一对应。
 */
import { DomainError, type EdgeStatus, type RestrictionType } from '@udm/shared';
import { findEdgeByDirection, findEdgeById, findNodeById } from '../../db/repositories/graph.repo.js';
import { findSiteByCode } from '../../db/repositories/site.repo.js';
import { findTemplateByCode } from '../../db/repositories/template.repo.js';
import { findVehicleByCode } from '../../db/repositories/vehicle.repo.js';
import { findNodeByCode } from '../../db/repositories/graph.repo.js';
import type { Db } from '../../db/index.js';

/** 校验失败：抛出的错误会被 Router 包成信封，`detail.fields` 里是字段级原因。 */
export function invalid(fields: Record<string, string>): DomainError {
  return new DomainError('VALIDATION.FAILED', undefined, { fields });
}

/** 编码唯一（§5 第 6 条）。`excludeId` 用于更新场景：自己不算冲突。 */
export function ensureCodeFree(
  db: Db,
  kind: 'site' | 'vehicle' | 'node' | 'template',
  code: string,
  excludeId?: string
): void {
  const existing =
    kind === 'site'
      ? findSiteByCode(db, code)
      : kind === 'vehicle'
        ? findVehicleByCode(db, code)
        : kind === 'template'
          ? findTemplateByCode(db, code)
          : findNodeByCode(db, code);
  if (existing && existing.id !== excludeId) {
    // 错误里带上冲突对象的 id：前端可以直接跳到那条记录，而不是让使用者自己去搜
    throw new DomainError('BASE.CODE_EXISTS', undefined, { code, kind, id: existing.id });
  }
}

/** 站点绑定的节点必须存在（§5 第 7 条）。 */
export function ensureNodeExists(db: Db, nodeId: string, field = 'nodeId'): void {
  if (!findNodeById(db, nodeId)) {
    throw new DomainError('NODE.NOT_FOUND', undefined, { [field]: nodeId });
  }
}

/** 边的两端节点必须存在（§5 第 8 条）。两端一次性判完再抛，避免来回两趟。 */
export function ensureEdgeEndpointsExist(db: Db, fromNodeId: string, toNodeId: string): void {
  const fields: Record<string, string> = {};
  if (!findNodeById(db, fromNodeId)) {
    fields['fromNodeId'] = fromNodeId;
  }
  if (!findNodeById(db, toNodeId)) {
    fields['toNodeId'] = toNodeId;
  }
  if (Object.keys(fields).length > 0) {
    throw new DomainError('NODE.NOT_FOUND', undefined, fields);
  }
}

/**
 * 方向对唯一（§5 第 10 条）。
 *
 * 复用 `BASE.CODE_EXISTS` 而非新增专用码：`code` 缺省由 `E_<from>_<to>` 推导，
 * 方向对重复与 code 重复是**同一件事**（D-33：同一概念只允许一个 code）。
 */
export function ensureDirectionFree(db: Db, fromNodeId: string, toNodeId: string, excludeId?: string): void {
  const existing = findEdgeByDirection(db, fromNodeId, toNodeId);
  if (existing && existing.id !== excludeId) {
    throw new DomainError('BASE.CODE_EXISTS', undefined, {
      code: existing.code,
      kind: 'edge',
      id: existing.id
    });
  }
}

/**
 * 禁行规则的目标必须存在（§5 第 11 条）。
 *
 * 目标可以是节点或边（多态引用，没有外键保护），因此**必须由服务层判**：
 * 少了这一步，一条指向不存在对象的规则会被安静地写进库，
 * 而它永远不可能生效 —— 使用者看到「规则已保存」，实际什么也没约束住。
 */
export function ensureRestrictionTargetExists(db: Db, type: RestrictionType, targetId: string): void {
  const target = type === 'node' ? findNodeById(db, targetId) : findEdgeById(db, targetId);
  if (!target) {
    // 用 MAP 域既有的「禁行目标不存在」，而不是新造一个 M2 专用码：
    // 两个调用点说的是同一件事（D-33：同一概念只允许一个 code）
    throw new DomainError('MAP.RESTRICTION_TARGET_NOT_FOUND', undefined, { targetId, type });
  }
}

/**
 * 时间窗的**跨字段**校验。
 *
 * 为什么不放在 `base-rules.ts`（那里只判单个字段能不能解析成时间）：
 * 更新时可能只传来 `endAt`，而 `startAt` 要用库里的旧值 —— 只有服务层拿得到这一对。
 * 反过来若只判传来的那一个，就会出现「把 endAt 改到 startAt 之前」这种
 * 通过校验、却被 DDL 的 `CHECK (end_at > start_at)` 拒掉的请求，
 * 报出来是 `SYS.INTERNAL`（一条看不出原因的 500），而不是可引导的字段级错误。
 */
export function ensureRestrictionWindow(startAt: string | null, endAt: string | null): void {
  if (startAt !== null && endAt !== null && !(endAt > startAt)) {
    throw invalid({ endAt: '结束时间必须晚于开始时间' });
  }
}

/** 启用/停用的目标值只允许这两个（`sites` / `nodes` / `edges` 共用）。 */
export const BASE_STATUSES: readonly EdgeStatus[] = ['enabled', 'disabled'];

export function ensureBaseStatus(status: EdgeStatus): void {
  if (!BASE_STATUSES.includes(status)) {
    throw invalid({ status: `取值必须是 ${BASE_STATUSES.join(' / ')} 之一` });
  }
}
