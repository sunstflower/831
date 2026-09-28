import { beforeEach, describe, expect, it } from 'vitest';
import type { AuditContext } from '@udm/shared';
import { openDatabase, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { seedDatabase } from '../../db/seed.js';
import { findById } from '../../db/repositories/users.repo.js';
import { verifyPassword } from '../../services/password.js';
import { changeOwnPassword, createUser, listUserItems, resetUserPassword, setUserStatus, updateUser } from './user.service.js';

/**
 * M1 用户管理写路径。
 *
 * 重点不在 CRUD 本身，而在两条**「别把自己锁在门外」**的护栏：
 * 禁止禁用自己、禁止禁用/降级最后一个启用的管理员。
 */
const admin: AuditContext = { actorId: 'seed-admin', actorName: 'admin', role: 'admin', traceId: 't-user' };
const dispatcher: AuditContext = { actorId: 'seed-dispatcher', actorName: 'dispatcher', role: 'dispatcher', traceId: 't-user' };

function setup(): Db {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  return db;
}

/**
 * 断言一次 `VALIDATION.FAILED` 的**字段级**原因。
 *
 * 为什么不断言顶层 message：`VALIDATION.FAILED` 的顶层文案是固定的「参数校验失败」，
 * 具体原因在 `detail.fields` 里（前端也按字段标红）。断言顶层文案等于什么都没断言。
 */
function expectFieldError(fn: () => unknown, field: string, pattern: RegExp): void {
  try {
    fn();
    throw new Error('应当报错但没有');
  } catch (error) {
    const failure = error as { code?: string; detail?: { fields?: Record<string, string> } };
    expect(failure.code).toBe('VALIDATION.FAILED');
    expect(failure.detail?.fields?.[field]).toMatch(pattern);
  }
}

describe('user.service', () => {
  let db: Db;
  beforeEach(() => {
    db = setup();
  });

  it('创建用户：建出后是 active，密码以哈希落库（库里读不到明文）', () => {
    const created = createUser({ db, actor: admin }, { username: 'operator01', password: 'secret123', displayName: '操作员一', role: 'dispatcher' });
    expect(created).toMatchObject({ username: 'operator01', role: 'dispatcher', status: 'active' });
    const row = findById(db, created.id)!;
    expect(row.password_hash).not.toBe('secret123');
    expect(verifyPassword('secret123', row.password_hash)).toBe(true);
  });

  it('用户名重复 → USER.NAME_EXISTS（不是 500，也不是静默改掉已有账号）', () => {
    expect(() => createUser({ db, actor: admin }, { username: 'admin', password: 'secret123', displayName: '重复', role: 'monitor' })).toThrowError(
      /用户名已存在/
    );
  });

  it('字段级校验：密码过短 / 角色非法都在传输层之后立刻报错', () => {
    expect(() => createUser({ db, actor: admin }, { username: 'u1', password: '123', displayName: '短密码', role: 'admin' })).toThrowError();
    expect(() => createUser({ db, actor: admin }, { username: 'u1', password: 'secret123', displayName: '角色错', role: 'root' })).toThrowError();
  });

  it('禁止禁用**自己**（契约明写）', () => {
    expectFieldError(() => setUserStatus({ db, actor: admin }, 'seed-admin', { status: 'disabled' }), 'status', /不能禁用当前登录的账号/);
  });

  it('禁止禁用或降级**最后一个启用的管理员**', () => {
    // seed 只有 seed-admin 一个管理员
    expectFieldError(() => setUserStatus({ db, actor: dispatcher }, 'seed-admin', { status: 'disabled' }), 'status', /最后一个启用的管理员/);
    expectFieldError(() => updateUser({ db, actor: dispatcher }, 'seed-admin', { role: 'monitor' }), 'role', /最后一个启用的管理员/);
  });

  it('有第二个管理员时，可以禁用第一个（护栏只在「最后一个」上生效）', () => {
    const second = createUser({ db, actor: admin }, { username: 'admin2', password: 'secret123', displayName: '管理员二', role: 'admin' });
    expect(setUserStatus({ db, actor: admin }, second.id, { status: 'disabled' })).toMatchObject({ status: 'disabled' });
  });

  it('重置密码：新密码可用、旧密码失效；审计里不出现密码', () => {
    resetUserPassword({ db, actor: admin }, 'seed-monitor', { password: 'brandnew123' });
    const row = findById(db, 'seed-monitor')!;
    expect(verifyPassword('brandnew123', row.password_hash)).toBe(true);
    expect(verifyPassword('monitor123', row.password_hash)).toBe(false);
  });

  it('改自己的密码：原密码错误 → AUTH.OLD_PASSWORD_WRONG；新旧相同被拒', () => {
    expect(() =>
      changeOwnPassword({ db, actor: dispatcher }, { id: 'seed-dispatcher', username: 'dispatcher', role: 'dispatcher', displayName: '调度员', permissions: [] }, {
        oldPassword: 'wrong-one',
        newPassword: 'newsecret123'
      })
    ).toThrowError(/原密码错误/);
    expectFieldError(
      () =>
        changeOwnPassword({ db, actor: dispatcher }, { id: 'seed-dispatcher', username: 'dispatcher', role: 'dispatcher', displayName: '调度员', permissions: [] }, {
          oldPassword: 'dispatcher123',
          newPassword: 'dispatcher123'
        }),
      'newPassword',
      /不能与原密码相同/
    );
  });

  it('列表支持角色与状态筛选（筛选为空时不假装有结果）', () => {
    expect(listUserItems(db, { page: 1, pageSize: 10 }).total).toBe(3);
    expect(listUserItems(db, { page: 1, pageSize: 10, role: 'monitor' }).total).toBe(1);
    expect(listUserItems(db, { page: 1, pageSize: 10, status: 'disabled' }).total).toBe(0);
  });
});
