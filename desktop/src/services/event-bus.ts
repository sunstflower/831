import { randomUUID } from 'node:crypto';
import { nowIso, run, type Db } from '../db/index.js';

export interface EventTargetLike {
  isDestroyed?(): boolean;
  send(channel: string, payload: unknown): void;
}

export class EventBus {
  private readonly targets = new Set<EventTargetLike>();

  constructor(private readonly db: Db) {}

  attach(target: EventTargetLike): void {
    this.targets.add(target);
  }

  detach(target: EventTargetLike): void {
    this.targets.delete(target);
  }

  emit(type: string, payload: Record<string, unknown> = {}, object?: { type: string; id: string }): number {
    const result = run(
      this.db,
      'INSERT INTO event_log (id, ts, type, object_type, object_id, payload) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), nowIso(), type, object?.type ?? null, object?.id ?? null, JSON.stringify(payload)]
    );
    const eventSeq = Number(result.lastInsertRowid ?? 0);
    const message = { type, payload, eventSeq };
    for (const target of [...this.targets]) {
      if (target.isDestroyed?.()) {
        this.targets.delete(target);
        continue;
      }
      target.send('udm:event', message);
    }
    return eventSeq;
  }
}
