import { randomBytes } from 'node:crypto';
import type { Role, SessionUser } from '@udm/shared';

export interface SessionRecord {
  token: string;
  user: SessionUser;
  createdAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  create(user: SessionUser): SessionRecord {
    const token = `sess_${randomBytes(16).toString('hex')}`;
    const record: SessionRecord = { token, user, createdAt: Date.now() };
    this.sessions.set(token, record);
    return record;
  }

  get(token: string | undefined | null): SessionRecord | null {
    if (!token) {
      return null;
    }
    return this.sessions.get(token) ?? null;
  }

  destroy(token: string | undefined | null): boolean {
    if (!token) {
      return false;
    }
    return this.sessions.delete(token);
  }

  size(): number {
    return this.sessions.size;
  }

  roleOf(token: string | undefined | null): Role | null {
    return this.get(token)?.user.role ?? null;
  }
}
