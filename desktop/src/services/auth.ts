import { DomainError, permissionsOf, type LoginResult, type SessionUser } from '@udm/shared';
import { nowIso, type Db } from '../db/index.js';
import { findByUsername, touchLastLogin } from '../db/repositories/users.repo.js';
import { verifyPassword } from './password.js';
import type { SessionStore } from './session.js';
import { writeAudit } from './audit.js';

export function toSessionUser(row: {
  id: string;
  username: string;
  role: SessionUser['role'];
  display_name: string;
}): SessionUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name,
    permissions: permissionsOf(row.role)
  };
}

export function login(
  db: Db,
  sessions: SessionStore,
  credentials: { username: string; password: string },
  traceId: string
): LoginResult {
  const user = findByUsername(db, credentials.username);
  if (!user) {
    writeAudit(db, null, {
      module: 'auth',
      action: 'login',
      objectType: 'user',
      objectId: credentials.username,
      result: 'failure',
      errorCode: 'AUTH.LOGIN_FAILED',
      message: '用户名或密码错误'
    });
    throw new DomainError('AUTH.LOGIN_FAILED');
  }
  if (user.status !== 'active') {
    writeAudit(db, null, {
      module: 'auth',
      action: 'login',
      objectType: 'user',
      objectId: user.id,
      result: 'failure',
      errorCode: 'AUTH.USER_DISABLED'
    });
    throw new DomainError('AUTH.USER_DISABLED');
  }
  if (!verifyPassword(credentials.password, user.password_hash)) {
    writeAudit(db, null, {
      module: 'auth',
      action: 'login',
      objectType: 'user',
      objectId: user.id,
      result: 'failure',
      errorCode: 'AUTH.LOGIN_FAILED'
    });
    throw new DomainError('AUTH.LOGIN_FAILED');
  }

  const sessionUser = toSessionUser(user);
  const record = sessions.create(sessionUser);
  const at = nowIso();
  touchLastLogin(db, user.id, at);
  writeAudit(db, { actorId: user.id, actorName: user.username, role: user.role, traceId }, {
    module: 'auth',
    action: 'login',
    objectType: 'user',
    objectId: user.id,
    result: 'success'
  });
  return { token: record.token, user: sessionUser };
}
