import { describe, expect, it } from 'vitest';
import { SessionStore } from './session.js';
import { EVENT_PERMISSIONS, EventBus, type EventTargetLike } from './event-bus.js';
import { openDatabase } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import type { SessionUser } from '@udm/shared';

/**
 * 事件通道的权限边界（ISS-009 / D-08）。
 *
 * 接口层已做服务端强制校验；`EventBus` 若无条件群发，就等于开了一条绕过
 * 权限的旁路：任何窗口都能收到与其角色无关的业务对象事件。
 */
function user(role: SessionUser['role']): SessionUser {
  return { id: `u-${role}`, username: role, role, displayName: role, permissions: [] };
}

function setup() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  const sessions = new SessionStore();
  const bus = new EventBus(db, sessions);
  const sent: { type: string; payload: unknown }[] = [];
  const target: EventTargetLike = { send: (_c, payload) => sent.push(payload as never) };
  return { db, sessions, bus, target, sent };
}

describe('EventBus · 按会话权限过滤', () => {
  it('未登录窗口收不到登记了权限的事件', () => {
    const { bus, target, sent, db } = setup();
    bus.attach(target);
    bus.emit('alert.created', { alertId: 'a1' });
    expect(sent).toEqual([]);
    db.close();
  });

  it('monitor 收得到告警，收不到设置变更', () => {
    const { bus, target, sent, sessions, db } = setup();
    const session = sessions.create(user('monitor'));
    bus.attach(target, session.token);

    bus.emit('alert.created', { alertId: 'a1' });
    bus.emit('settings.changed', { key: 'monitor.refreshIntervalMs' });

    expect(sent.map((m) => m.type)).toEqual(['alert.created']);
    db.close();
  });

  it('dispatcher 收得到任务与车辆事件', () => {
    const { bus, target, sent, sessions, db } = setup();
    const session = sessions.create(user('dispatcher'));
    bus.attach(target, session.token);

    bus.emit('task.changed', { taskId: 't1' });
    bus.emit('vehicle.changed', { vehicleId: 'v1' });
    bus.emit('alert.updated', { alertId: 'a1' });

    expect(sent.map((m) => m.type)).toEqual(['task.changed', 'vehicle.changed', 'alert.updated']);
    db.close();
  });

  it('登出后立即降权，收不到后续业务事件', () => {
    const { bus, target, sent, sessions, db } = setup();
    const session = sessions.create(user('admin'));
    bus.attach(target, session.token);
    bus.emit('task.changed', { taskId: 't1' });
    expect(sent).toHaveLength(1);

    sessions.destroy(session.token); // 等价于登出
    bus.emit('task.changed', { taskId: 't2' });
    expect(sent).toHaveLength(1);
    db.close();
  });

  it('无权限映射的事件（如 map.updated 刷新信号）仍放行给已登录窗口', () => {
    const { bus, target, sent, sessions, db } = setup();
    const session = sessions.create(user('monitor'));
    bus.attach(target, session.token);

    bus.emit('map.updated', { reason: 'login' });

    expect(sent.map((m) => m.type)).toEqual(['map.updated']);
    db.close();
  });

  it('事件照常落 event_log（服务端真相不受过滤影响）', () => {
    const { bus, target, db } = setup();
    bus.attach(target); // 未登录
    const seq = bus.emit('alert.created', { alertId: 'a1' });
    expect(seq).toBeGreaterThan(0);
    const row = db.prepare('SELECT COUNT(*) AS n FROM event_log WHERE type = ?').get('alert.created') as { n: number };
    expect(row.n).toBe(1);
    db.close();
  });

  it('已销毁的窗口被移除，不再发送', () => {
    const { bus, sessions, sent, db } = setup();
    const session = sessions.create(user('admin'));
    let destroyed = false;
    const target: EventTargetLike = {
      isDestroyed: () => destroyed,
      send: (_c, payload) => sent.push(payload as never)
    };
    bus.attach(target, session.token);
    destroyed = true;
    bus.emit('task.changed', { taskId: 't1' });
    expect(sent).toEqual([]);
    db.close();
  });

  it('每个已声明的领域事件都登记了权限点（防止新增事件漏配）', () => {
    // 与 docs/api.md §4 的事件表同源；新增事件必须同时改这里与 EVENT_PERMISSIONS
    const documented = [
      'task.changed',
      'vehicle.changed',
      'alert.created',
      'alert.updated',
      'execution.progress',
      'settings.changed'
    ];
    for (const type of documented) {
      expect(EVENT_PERMISSIONS[type], `${type} 缺少权限映射`).toBeTruthy();
    }
  });
});
