/**
 * 用户管理（M1 的写路径，`docs/api.md` §3.1.4 - §3.1.7）。
 *
 * ## 两条「别把自己锁在门外」的护栏
 *
 *   1. **禁止禁用自己**：契约明写（§3.1.7）。误操作后当前会话仍有效，
 *      但刷新就再也登不进来 —— 而使用者往往正是在「清理账号」时点错自己那一行。
 *   2. **禁止禁用/降级最后一个启用的管理员**：这一条契约里没有，
 *      但它比第 1 条更致命 —— 系统里没有管理员之后，用户管理页对谁都不可见，
 *      只能去手工改数据库。判据是 `countActiveAdmins(excludeId)`。
 *
 * ## 密码
 *
 * 只有「重置」与「改自己的密码」两条写入路径，都走 `hashPassword`；
 * 任何审计快照里都**不得**出现密码或哈希 —— 审计是长期留存的文件，
 * 而密码哈希写进去等于把它复制到一个没人会去轮换的位置。
 */
import { randomUUID } from 'node:crypto';
import { DomainError, ROLES, type Role, type SessionUser, type UserListItem, type UserStatus } from '@udm/shared';
import { nowIso, tx, type Db } from '../../db/index.js';
import {
  countActiveAdmins,
  findById as findUserRowById,
  findByUsername,
  insertUser,
  listUsers,
  updatePasswordHash,
  updateUserRow,
  type UserRow
} from '../../db/repositories/users.repo.js';
import { hashPassword, verifyPassword } from '../../services/password.js';
import { writeAudit } from '../../services/audit.js';
import { toAuditActor, type CrudContext } from '../base/context.js';
import { invalid } from '../base/validate.js';

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 32;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function toUserItem(row: UserRow): UserListItem {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at
  };
}

export function listUserItems(
  db: Db,
  query: { keyword?: string; page: number; pageSize: number; role?: Role; status?: UserStatus }
): { records: UserListItem[]; total: number } {
  const { records, total } = listUsers(db, query);
  return { records: records.map(toUserItem), total };
}

function readUsername(raw: Record<string, unknown>): string {
  const value = raw['username'];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid({ username: '必填' });
  }
  const trimmed = value.trim();
  if (trimmed.length > 32) {
    throw invalid({ username: '长度不能超过 32' });
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw invalid({ username: '只能包含字母、数字、下划线与短横线' });
  }
  return trimmed;
}

function readPassword(raw: Record<string, unknown>, field: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid({ [field]: '必填' });
  }
  if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
    throw invalid({ [field]: `长度必须在 ${PASSWORD_MIN}-${PASSWORD_MAX} 之间` });
  }
  return value;
}

function readDisplayName(raw: Record<string, unknown>): string {
  const value = raw['displayName'];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalid({ displayName: '必填' });
  }
  const trimmed = value.trim();
  if (trimmed.length > 100) {
    throw invalid({ displayName: '长度不能超过 100' });
  }
  return trimmed;
}

function readRole(raw: Record<string, unknown>): Role {
  const value = raw['role'];
  if (typeof value !== 'string' || !(ROLES as readonly string[]).includes(value)) {
    throw invalid({ role: `取值必须是 ${ROLES.join(' / ')} 之一` });
  }
  return value as Role;
}

function readStatus(raw: Record<string, unknown>): UserStatus {
  const value = raw['status'];
  if (value !== 'active' && value !== 'disabled') {
    throw invalid({ status: '取值必须是 active / disabled 之一' });
  }
  return value;
}

function requireUser(ctx: CrudContext, id: string): UserRow {
  const row = findUserRowById(ctx.db, id);
  if (!row) {
    throw new DomainError('USER.NOT_FOUND', undefined, { id });
  }
  return row;
}

/**
 * 幂等审计用的用户快照。
 *
 * **不含 `password_hash`**：这不是「顺手少写一个字段」，而是这条服务里
 * 唯一一处必须显式列举字段的地方 —— 用 `{ ...row }` 会把哈希写进审计。
 */
function userSnapshot(row: UserRow): Record<string, unknown> {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status
  };
}

export function createUser(ctx: CrudContext, raw: Record<string, unknown>): UserListItem {
  const username = readUsername(raw);
  const password = readPassword(raw, 'password');
  const displayName = readDisplayName(raw);
  const role = readRole(raw);
  return tx(ctx.db, () => {
    if (findByUsername(ctx.db, username)) {
      throw new DomainError('USER.NAME_EXISTS', undefined, { username });
    }
    const at = nowIso();
    const id = randomUUID();
    insertUser(ctx.db, {
      id,
      username,
      passwordHash: hashPassword(password),
      role,
      displayName,
      at,
      createdBy: ctx.actor?.actorName ?? null
    });
    const created = requireUser(ctx, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'user',
      action: 'create',
      objectType: 'user',
      objectId: id,
      after: userSnapshot(created)
    });
    return toUserItem(created);
  });
}

export function updateUser(ctx: CrudContext, id: string, raw: Record<string, unknown>): UserListItem {
  return tx(ctx.db, () => {
    const before = requireUser(ctx, id);
    const patch: { displayName?: string; role?: Role; status?: UserStatus } = {};
    if (raw['displayName'] !== undefined) {
      patch.displayName = readDisplayName(raw);
    }
    if (raw['role'] !== undefined) {
      patch.role = readRole(raw);
    }
    if (raw['status'] !== undefined) {
      patch.status = readStatus(raw);
    }
    if (Object.keys(patch).length === 0) {
      throw invalid({ displayName: '至少要给出一个要改的字段' });
    }
    if (patch.status === 'disabled') {
      assertNotSelf(ctx, id, '禁用');
      assertNotLastAdmin(ctx, id, '禁用', 'status');
    }
    if (patch.role !== undefined && patch.role !== 'admin') {
      assertNotLastAdmin(ctx, id, '降级', 'role');
    }
    updateUserRow(ctx.db, id, patch, nowIso());
    const after = requireUser(ctx, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'user',
      action: 'update',
      objectType: 'user',
      objectId: id,
      before: userSnapshot(before),
      after: userSnapshot(after)
    });
    return toUserItem(after);
  });
}

function assertNotSelf(ctx: CrudContext, id: string, verb: string): void {
  if (ctx.actor?.actorId === id) {
    throw invalid({ status: `不能${verb}当前登录的账号` });
  }
}

/**
 * 「最后一个启用的管理员」护栏。
 *
 * `field` 必须由调用点给出：禁用时报在 `status` 上、降级时报在 `role` 上。
 * 早先这里一律报在 `role` 上，于是「禁用」被拒时前端把标红画到了角色下拉框 ——
 * 而使用者根本没碰过那个字段（字段级错误指错地方比不给还难排查）。
 */
function assertNotLastAdmin(ctx: CrudContext, id: string, verb: string, field: 'role' | 'status'): void {
  const target = findUserRowById(ctx.db, id);
  if (!target || target.role !== 'admin' || target.status !== 'active') {
    return;
  }
  if (countActiveAdmins(ctx.db, id) === 0) {
    throw invalid({ [field]: `不能${verb}最后一个启用的管理员` });
  }
}

/** 启停（`PATCH /api/users/{id}/status`）。与 `updateUser` 分开是因为权限与语义都不同。 */
export function setUserStatus(ctx: CrudContext, id: string, raw: Record<string, unknown>): UserListItem {
  return tx(ctx.db, () => {
    const before = requireUser(ctx, id);
    const status = readStatus(raw);
    if (status === 'disabled') {
      assertNotSelf(ctx, id, '禁用');
      assertNotLastAdmin(ctx, id, '禁用', 'status');
    }
    updateUserRow(ctx.db, id, { status }, nowIso());
    const after = requireUser(ctx, id);
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'user',
      action: status === 'disabled' ? 'disable' : 'enable',
      objectType: 'user',
      objectId: id,
      before: userSnapshot(before),
      after: userSnapshot(after)
    });
    return toUserItem(after);
  });
}

/** 管理员重置他人密码（`POST /api/users/{id}/reset-password`）。 */
export function resetUserPassword(ctx: CrudContext, id: string, raw: Record<string, unknown>): { id: string } {
  const password = readPassword(raw, 'password');
  return tx(ctx.db, () => {
    requireUser(ctx, id);
    updatePasswordHash(ctx.db, id, hashPassword(password), nowIso());
    // 重置密码的审计只记「做了这件事」，不记新密码
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'user',
      action: 'reset-password',
      objectType: 'user',
      objectId: id
    });
    return { id };
  });
}

/** 修改本人密码（`PUT /api/users/me/password`）。 */
export function changeOwnPassword(
  ctx: CrudContext,
  actor: SessionUser,
  raw: Record<string, unknown>
): { id: string } {
  const oldPassword = readPassword(raw, 'oldPassword');
  const newPassword = readPassword(raw, 'newPassword');
  if (oldPassword === newPassword) {
    throw invalid({ newPassword: '新密码不能与原密码相同' });
  }
  return tx(ctx.db, () => {
    const row = requireUser(ctx, actor.id);
    if (!verifyPassword(oldPassword, row.password_hash)) {
      writeAudit(ctx.db, toAuditActor(ctx.actor), {
        module: 'user',
        action: 'change-password',
        objectType: 'user',
        objectId: actor.id,
        result: 'failure',
        errorCode: 'AUTH.OLD_PASSWORD_WRONG'
      });
      throw new DomainError('AUTH.OLD_PASSWORD_WRONG');
    }
    updatePasswordHash(ctx.db, actor.id, hashPassword(newPassword), nowIso());
    writeAudit(ctx.db, toAuditActor(ctx.actor), {
      module: 'user',
      action: 'change-password',
      objectType: 'user',
      objectId: actor.id
    });
    return { id: actor.id };
  });
}
