import { DomainError } from '@udm/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, run } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { login } from './auth.js';
import { SessionStore } from './session.js';

function freshDb() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  return db;
}

describe('auth login', () => {
  it('returns token and permission list for valid credentials', () => {
    const db = freshDb();
    const sessions = new SessionStore();
    const result = login(db, sessions, { username: 'admin', password: 'admin123' }, 'trace-1');
    expect(result.token).toMatch(/^sess_/);
    expect(result.user.role).toBe('admin');
    expect(result.user.permissions).toContain('user:manage');
    expect(sessions.get(result.token)?.user.username).toBe('admin');
    db.close();
  });

  it('rejects a wrong password with AUTH.LOGIN_FAILED', () => {
    const db = freshDb();
    const sessions = new SessionStore();
    let error: unknown;
    try {
      login(db, sessions, { username: 'admin', password: 'nope' }, 'trace-2');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('AUTH.LOGIN_FAILED');
    db.close();
  });

  it('rejects a disabled account', () => {
    const db = freshDb();
    run(db, "UPDATE users SET status = 'disabled' WHERE username = 'monitor'");
    const sessions = new SessionStore();
    expect(() => login(db, sessions, { username: 'monitor', password: 'monitor123' }, 'trace-3')).toThrowError(
      /账号已被禁用/
    );
    db.close();
  });
});
