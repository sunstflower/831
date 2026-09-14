import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { seedDatabase } from '../db/seed.js';
import { login } from '../services/auth.js';
import { EventBus } from '../services/event-bus.js';
import { SessionStore } from '../services/session.js';
import { createApiRoutes } from './api.js';
import { createRouter } from './router.js';

function setup() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  const sessions = new SessionStore();
  const bus = new EventBus(db);
  const router = createRouter(createApiRoutes({ db, sessions, bus }), { db, sessions });
  return { db, sessions, router };
}

describe('ipc router', () => {
  it('serves public health', async () => {
    const { db, router } = setup();
    const result = await router.invoke({ path: '/api/health' });
    expect(result.code).toBe(0);
    if (result.code === 0) {
      expect(result.data).toMatchObject({ status: 'ok', db: true });
    }
    db.close();
  });

  it('rejects unknown routes with API.ROUTE_NOT_FOUND', async () => {
    const { db, router } = setup();
    const result = await router.invoke({ path: '/api/nope' });
    expect(result).toMatchObject({ code: 'API.ROUTE_NOT_FOUND', source: 'validation' });
    db.close();
  });

  it('requires a session for protected routes', async () => {
    const { db, router } = setup();
    const result = await router.invoke({ path: '/api/users' });
    expect(result).toMatchObject({ code: 'AUTH.REQUIRED' });
    db.close();
  });

  it('enforces permissions server-side', async () => {
    const { db, sessions, router } = setup();
    const monitor = login(db, sessions, { username: 'monitor', password: 'monitor123' }, 't-1');
    const denied = await router.invoke({ path: '/api/users', token: monitor.token });
    expect(denied).toMatchObject({ code: 'AUTH.FORBIDDEN' });

    const admin = login(db, sessions, { username: 'admin', password: 'admin123' }, 't-2');
    const allowed = await router.invoke({ path: '/api/users', token: admin.token });
    expect(allowed.code).toBe(0);
    db.close();
  });

  it('returns settings for dispatcher but blocks writes-less roles from schema? (settings:read allowed)', async () => {
    const { db, sessions, router } = setup();
    const dispatcher = login(db, sessions, { username: 'dispatcher', password: 'dispatcher123' }, 't-3');
    const settings = await router.invoke({ path: '/api/settings', token: dispatcher.token });
    expect(settings.code).toBe(0);
    if (settings.code === 0) {
      expect(settings.data).toMatchObject({ 'dispatch.defaultStrategy': 'greedy' });
    }
    db.close();
  });
});
