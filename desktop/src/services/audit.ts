import { randomUUID } from 'node:crypto';
import type { AuditResult, ObjectType } from '@udm/shared';
import { nowIso, type Db } from '../db/index.js';
import { insertAudit } from '../db/repositories/audit.repo.js';

export interface AuditInput {
  module: string;
  action: string;
  objectType?: ObjectType;
  objectId?: string;
  before?: unknown;
  after?: unknown;
  result?: AuditResult;
  message?: string;
  errorCode?: string;
  costMs?: number;
}

export interface AuditActor {
  actorId: string;
  actorName: string;
  role: string;
  traceId: string;
}

export function writeAudit(db: Db, actor: AuditActor | null, input: AuditInput): void {
  insertAudit(db, {
    id: randomUUID(),
    ts: nowIso(),
    actorId: actor?.actorId ?? null,
    actorName: actor?.actorName ?? null,
    role: (actor?.role as never) ?? null,
    module: input.module,
    action: input.action,
    objectType: input.objectType ?? null,
    objectId: input.objectId ?? null,
    before: input.before,
    after: input.after,
    result: input.result ?? 'success',
    message: input.message ?? null,
    errorCode: input.errorCode ?? null,
    costMs: input.costMs ?? 0,
    traceId: actor?.traceId ?? null
  });
}
