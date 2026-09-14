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
