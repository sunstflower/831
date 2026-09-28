import type { Role, UserStatus } from '@udm/shared';
import { all, get, run, type Db } from '../index.js';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  display_name: string;
  status: UserStatus;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export function findByUsername(db: Db, username: string): UserRow | undefined {
  return get<UserRow>(db, 'SELECT * FROM users WHERE username = ?', [username]);
}

export function findById(db: Db, id: string): UserRow | undefined {
  return get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', [id]);
}

export function listUsers(
  db: Db,
  options: { keyword?: string; page: number; pageSize: number; role?: Role; status?: UserStatus }
): { records: UserRow[]; total: number } {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (options.keyword) {
    clauses.push('(username LIKE ? OR display_name LIKE ?)');
    params.push(`%${options.keyword}%`, `%${options.keyword}%`);
  }
  if (options.role) {
    clauses.push('role = ?');
    params.push(options.role);
  }
  if (options.status) {
    clauses.push('status = ?');
    params.push(options.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = Number(get<{ total: number }>(db, `SELECT COUNT(*) AS total FROM users ${where}`, params)?.total ?? 0);
  const offset = (options.page - 1) * options.pageSize;
  const records = all<UserRow>(
    db,
    `SELECT * FROM users ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
    [...params, options.pageSize, offset]
  );
  return { records, total };
}

export function touchLastLogin(db: Db, id: string, at: string): void {
  run(db, 'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [at, at, id]);
}

export interface UserWriteRow {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  displayName: string;
  at: string;
  createdBy: string | null;
}

export function insertUser(db: Db, row: UserWriteRow): void {
  run(
    db,
    `INSERT INTO users (id, username, password_hash, role, display_name, status, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [row.id, row.username, row.passwordHash, row.role, row.displayName, row.at, row.at, row.createdBy]
  );
}

export interface UserEditPatch {
  displayName?: string;
  role?: Role;
  status?: UserStatus;
}

export function updateUserRow(db: Db, id: string, patch: UserEditPatch, at: string): void {
  const sets: string[] = ['updated_at = ?'];
  const params: Array<string | null> = [at];
  if (patch.displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(patch.displayName);
  }
  if (patch.role !== undefined) {
    sets.push('role = ?');
    params.push(patch.role);
  }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
  }
  params.push(id);
  run(db, `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function updatePasswordHash(db: Db, id: string, hash: string, at: string): void {
  run(db, 'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [hash, at, id]);
}

/**
 * 还有几个**启用的管理员**（可排除某个 id）。
 *
 * 用途只有一个：拦住「把最后一个管理员禁用或降级」—— 那会让系统再也无法管理，
 * 而恢复只能去手工改数据库。这是一个**跨行**约束，仓库层是它唯一能被表达的地方。
 */
export function countActiveAdmins(db: Db, excludeId?: string): number {
  const row = get<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total FROM users
     WHERE role = 'admin' AND status = 'active' AND (? IS NULL OR id <> ?)`,
    [excludeId ?? null, excludeId ?? null]
  );
  return Number(row?.total ?? 0);
}
