/**
 * M2 领域服务的公共骨架。
 *
 * ## 为什么 `actor` 用 `shared` 的 `AuditContext` 而不是 `ipc/router.ts` 的 `RouteActor`
 *
 * 领域层**不得** import 传输层（`docs/module-M2-base-data.md` §3 边界约束 2）：
 * 一旦反向依赖，业务规则的正确性就与「请求是从哪个通道来的」绑在一起，
 * 将来增加 HTTP 通道或定时任务调用时，领域层会被迫跟着改。
 * `AuditContext` 只描述「谁在做什么」，两个通道都能构造。
 *
 * ## 统一事务纪律（§4）
 *
 * 每个写方法 = 一个 `tx()`，顺序固定为「读旧值 → 校验 → 写表 → 写审计」。
 * **`EventBus.emit` 不在这里**：它必须发生在事务提交**之后**，
 * 否则渲染层可能在数据可见之前就收到事件、按事件去重拉快照却读到旧值，
 * 于是出现「事件说我改了、快照还是旧的」这种自相矛盾的中间态。
 * 因此领域方法是纯同步的「写 + 返回新值」，事件由调用点（`ipc/api.ts`）在返回后发。
 */
import type { AuditContext } from '@udm/shared';
import type { Db } from '../../db/index.js';
import type { AuditActor } from '../../services/audit.js';

export interface CrudContext {
  db: Db;
  actor: AuditContext | null;
}

/**
 * `AuditContext` → 审计写入所需的 `AuditActor`。
 *
 * 两者的字段一一对应（含 `traceId`）—— 保留两个类型而不合并，
 * 是因为 `AuditContext` 属共享契约（HTTP 通道、定时任务都要构造它），
 * 而 `AuditActor` 只描述「写审计需要什么」。字段对不上时编译器会在这里报错，
 * 而那正是我们想要的：审计里少一个 traceId，事后按它查日志就会串不起来。
 */
export function toAuditActor(actor: AuditContext | null): AuditActor | null {
  if (!actor) {
    return null;
  }
  return { actorId: actor.actorId, actorName: actor.actorName, role: actor.role, traceId: actor.traceId };
}

/** M2 审计动作命名（`docs/module-M2-base-data.md` §7.1）。 */
export const BASE_ACTIONS = {
  create: 'create',
  update: 'update',
  enable: 'enable',
  disable: 'disable',
  /**
   * 人工报障（`fault`，`AGENTS.md` D-62）。
   *
   * 与 `disable` 的区别是**语义而不是存储**：停用是「这辆车不再投入使用」（D-07 软删），
   * 报障是「这辆车暂时坏了、修好就能回来」。两者都保留数据行，故不能共用一个动作名 ——
   * 事后按 `action='disable'` 查「谁把这辆车退役了」时，故障车不该混在里面。
   */
  fault: 'fault',
  /**
   * 物理删除（目前只有禁行规则用，`design.md` D-07 的唯一例外）。
   *
   * 与 `disable` 的区别是**行还在不在**：软删留痕在数据里，物理删除的痕迹只剩审计。
   * 因此这两者绝不能共用一个动作名 —— 事后按 `action='disable'` 查「谁停用了它」
   * 时，若物理删除也叫 `disable`，查询结果会包含一批「记录已经不存在」的行。
   */
  delete: 'delete'
} as const;
