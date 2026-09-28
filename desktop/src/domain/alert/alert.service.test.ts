import { beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS, type AuditContext } from '@udm/shared';
import { openDatabase, run, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { seedDatabase } from '../../db/seed.js';
import { listAudit } from '../../db/repositories/audit.repo.js';
import { createAlert, getAlertDetail, listAlerts, runAlertAction } from './alert.service.js';

/**
 * M8 告警领域服务。
 *
 * 锁三件事：
 *   1. **状态机**：`new → acknowledged → resolved → archived`，越级迁移一律拒绝；
 *   2. **必填信息不丢**：`resolve` 的处置结论缺失时报字段级错误（那是这条告警唯一的知识）；
 *   3. **去重窗口**：同对象同类型在窗口内只落一条，且**不重复写审计**。
 */
const actor: AuditContext = { actorId: 'seed-admin', actorName: 'admin', role: 'admin', traceId: 't-alert' };

function setup(): Db {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  seedDatabase(db);
  return db;
}

describe('alert.service · 状态机', () => {
  let db: Db;
  beforeEach(() => {
    db = setup();
  });

  it('new → acknowledged → resolved → archived 走完全程，并记下操作者与时间', () => {
    const id = SEED_IDS.demoAlert;
    const acked = runAlertAction({ db, actor }, id, 'acknowledge', { note: '看到告警' });
    expect(acked.status).toBe('acknowledged');
    expect(acked.transition).toEqual({ from: 'new', to: 'acknowledged' });
    expect(acked.ackBy).toBe('admin');
    expect(acked.ackAt).toBeTruthy();

    const resolved = runAlertAction({ db, actor }, id, 'resolve', { resolution: '已重启车辆并恢复心跳' });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution).toBe('已重启车辆并恢复心跳');
    expect(resolved.resolveBy).toBe('admin');

    const archived = runAlertAction({ db, actor }, id, 'archive', { note: '归档' });
    expect(archived.status).toBe('archived');
    expect(archived.archivedBy).toBe('admin');
    // 归档不该抹掉处置结论（`resolution` 是这条告警留下的知识）
    expect(archived.resolution).toBe('已重启车辆并恢复心跳');
  });

  it('越级迁移被拒：未认领就想关闭 → ALERT.STATE_CONFLICT，且 detail 说明当前与期望状态', () => {
    const result = () => runAlertAction({ db, actor }, SEED_IDS.demoAlert, 'resolve', { resolution: '直接关掉' });
    expect(result).toThrowError(/只允许在 acknowledged \/ processing 时执行/);
    try {
      result();
    } catch (error) {
      expect((error as { code?: string }).code).toBe('ALERT.STATE_CONFLICT');
    }
  });

  it('已归档的告警不能再确认（终态没有出边）', () => {
    runAlertAction({ db, actor }, SEED_IDS.demoAlert, 'archive', {});
    expect(() => runAlertAction({ db, actor }, SEED_IDS.demoAlert, 'acknowledge', {})).toThrowError(/当前状态 archived/);
  });

  it('resolve 缺处置结论 → VALIDATION.FAILED（字段级），不会写成一条空结论', () => {
    runAlertAction({ db, actor }, SEED_IDS.demoAlert, 'acknowledge', {});
    try {
      runAlertAction({ db, actor }, SEED_IDS.demoAlert, 'resolve', {});
      throw new Error('应当报错');
    } catch (error) {
      const detail = (error as { detail?: { fields?: Record<string, string> } }).detail;
      expect(detail?.fields?.['resolution']).toBeTruthy();
      expect((error as { code?: string }).code).toBe('VALIDATION.FAILED');
    }
  });

  it('不存在的 id → ALERT.NOT_FOUND（而不是静默成功）', () => {
    expect(() => runAlertAction({ db, actor }, 'alert-missing', 'acknowledge', {})).toThrowError(/告警不存在/);
  });

  it('每次状态操作写一条审计，且带前后状态', () => {
    runAlertAction({ db, actor }, SEED_IDS.demoAlert, 'acknowledge', { note: '接手' });
    const { records } = listAudit(db, { page: 1, pageSize: 10, module: 'alert' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: 'acknowledge', object_id: SEED_IDS.demoAlert, trace_id: 't-alert' });
  });
});

describe('alert.service · 列表与去重', () => {
  let db: Db;
  beforeEach(() => {
    db = setup();
  });

  it('列表带筛选（level / status 多值），且详情给出建议下一步', () => {
    const list = listAlerts(db, { level: 'warning', page: 1, pageSize: 10 });
    expect(list.total).toBe(1);
    const detail = getAlertDetail(db, SEED_IDS.demoAlert);
    expect(detail.type).toBe('vehicle_offline');
    // 建议来自 `shared` 的常量表（唯一作者），不是详情里现编的
    expect(detail.suggestedNextSteps.length).toBeGreaterThan(0);
    // 关联对象：DRN-01 是真实存在的车
    expect(detail.related.vehicle).toMatchObject({ id: SEED_IDS.vehicleDrone });
  });

  it('同对象同类型在去重窗口内只落一条', () => {
    const first = createAlert({ db, actor }, {
      type: 'vehicle_offline',
      level: 'warning',
      objectType: 'vehicle',
      objectId: SEED_IDS.vehicleDrone,
      message: 'DRN-01 心跳超时'
    });
    const second = createAlert({ db, actor }, {
      type: 'vehicle_offline',
      level: 'warning',
      objectType: 'vehicle',
      objectId: SEED_IDS.vehicleDrone,
      message: 'DRN-01 心跳超时'
    });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    // 全库仍只有 seed 的那一条 + 本次新建的一条
    expect(listAlerts(db, { page: 1, pageSize: 50 }).total).toBe(2);
  });

  it('去重窗口可配为 0（关闭去重）：此时每次调用都新增一条', () => {
    run(
      db,
      "UPDATE settings SET value = '0' WHERE key = 'alert.dedupeWindowS'"
    );
    const input = {
      type: 'data_error' as const,
      level: 'info' as const,
      objectType: 'system' as const,
      objectId: null,
      message: '导入校验失败'
    };
    const first = createAlert({ db, actor }, input);
    const second = createAlert({ db, actor }, input);
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(false);
    expect(second.id).not.toBe(first.id);
  });
});
