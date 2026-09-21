import { randomUUID } from 'node:crypto';
import { hasPermission, type Permission, type Role } from '@udm/shared';
import { nowIso, run, type Db } from '../db/index.js';

export interface EventTargetLike {
  isDestroyed?(): boolean;
  send(channel: string, payload: unknown): void;
}

/**
 * 事件类型 → 接收方必须具备的权限点。
 *
 * 与 D-08「权限校验双轨制」配套（落地口径见 D-32）：接口层做了服务端强制校验，
 * 事件通道**不能**绕过它。
 * 未列出的类型默认视为「已登录即可收」（如 `map.updated` 只是刷新信号，不含业务对象）；
 * 若要新增含业务对象的事件，**必须**在此登记，`event-bus.test.ts` 会断言
 * 「所有已声明的领域事件都有权限映射」。
 */
export const EVENT_PERMISSIONS: Record<string, Permission> = {
  'task.changed': 'task:read',
  'vehicle.changed': 'monitor:read',
  'alert.created': 'alert:read',
  'alert.updated': 'alert:read',
  'execution.progress': 'monitor:read',
  'settings.changed': 'settings:read'
};

interface AttachedTarget {
  target: EventTargetLike;
  /** 绑定在该窗口上的会话令牌；`null` 表示尚未登录（只能收公开事件）。 */
  token: string | null;
}

/** 供 EventBus 判定权限的最小会话接口（避免与 SessionStore 循环依赖）。 */
export interface EventSessionLookup {
  roleOf(token: string | null | undefined): Role | null;
}

export class EventBus {
  private readonly targets = new Map<EventTargetLike, AttachedTarget>();

  /**
   * `sessions` 为**必填**：省略它会让所有登记了权限的事件被静默丢弃
   * （deny-by-default），排查成本远高于编译期报错。
   */
  constructor(
    private readonly db: Db,
    private readonly sessions: EventSessionLookup
  ) {}

  /**
   * 绑定一个窗口。
   *
   * `token` 可后置（登录后由路由调用 `bindSession` 补上）：窗口创建早于登录，
   * 此时先以「未登录」登记，登录成功后再升权，登出则降权。
   */
  attach(target: EventTargetLike, token: string | null = null): void {
    this.targets.set(target, { target, token });
  }

  /** 窗口登录成功（或会话续期）后对齐其权限身份。 */
  bindSession(target: EventTargetLike, token: string | null): void {
    const entry = this.targets.get(target);
    if (entry) {
      entry.token = token;
    }
  }

  detach(target: EventTargetLike): void {
    this.targets.delete(target);
  }

  /** 判定某个目标是否有权接收该事件。 */
  private canReceive(entry: AttachedTarget, type: string): boolean {
    const permission = EVENT_PERMISSIONS[type];
    if (!permission) {
      return true;
    }
    // 未登录窗口不得收到任何登记过权限的事件。
    const role = this.sessions.roleOf(entry.token);
    if (!role) {
      return false;
    }
    return hasPermission(role, permission);
  }

  emit(type: string, payload: Record<string, unknown> = {}, object?: { type: string; id: string }): number {
    const result = run(
      this.db,
      'INSERT INTO event_log (id, ts, type, object_type, object_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), nowIso(), type, object?.type ?? null, object?.id ?? null, JSON.stringify(payload)]
    );
    const eventSeq = Number(result.lastInsertRowid ?? 0);
    const message = { type, payload, eventSeq };
    for (const entry of [...this.targets.values()]) {
      const { target } = entry;
      if (target.isDestroyed?.()) {
        this.targets.delete(target);
        continue;
      }
      // 审计/事件日志照写（服务端真相），但**只推送给有权接收的窗口**。
      if (this.canReceive(entry, type)) {
        target.send('udm:event', message);
      }
    }
    return eventSeq;
  }
}
