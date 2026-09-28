import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_SCHEMA, type AuditContext } from '@udm/shared';
import { openDatabase, type Db } from '../../db/index.js';
import { applyMigrations } from '../../db/migrate.js';
import { seedDatabase } from '../../db/seed.js';
import { listAudit } from '../../db/repositories/audit.repo.js';
import { getSettings, parseSettingsValues } from '../../db/repositories/settings.repo.js';
import { updateSettings, validateSettingValue } from './settings.service.js';

/**
 * M10 设置写。
 *
 * 校验判据的**唯一作者是 schema**（`SETTINGS_SCHEMA`），因此这里既断言合法路径，
 * 也逐类断言非法路径（越界数字 / 不在选项里的枚举 / 未知键），
 * 并且锁死「一批里有一个非法 → 整批不生效」。
 */
const actor: AuditContext = { actorId: 'seed-admin', actorName: 'admin', role: 'admin', traceId: 't-set' };

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

describe('settings.service', () => {
  let db: Db;
  beforeEach(() => {
    db = setup();
  });

  it('校验判据来自 schema：数字越界 / 枚举不在选项 / 类型不符都给出原因', () => {
    const numberItem = SETTINGS_SCHEMA.find((item) => item.key === 'task.timeoutToleranceS')!;
    expect(validateSettingValue(numberItem, 60)).toBeNull();
    expect(validateSettingValue(numberItem, -1)).toMatch(/不能小于/);
    expect(validateSettingValue(numberItem, 999999)).toMatch(/不能大于/);
    expect(validateSettingValue(numberItem, '60')).toMatch(/必须是有限数字/);

    const selectItem = SETTINGS_SCHEMA.find((item) => item.key === 'dispatch.defaultStrategy')!;
    expect(validateSettingValue(selectItem, 'hungarian')).toBeNull();
    expect(validateSettingValue(selectItem, 'genetic2')).toMatch(/取值必须是/);
  });

  it('写入生效值并返回本次改动的键；库里的值也真的变了', () => {
    const result = updateSettings({ db, actor }, { 'monitor.refreshIntervalMs': 500, 'ui.theme': 'dark' });
    expect(result.updatedKeys.sort()).toEqual(['monitor.refreshIntervalMs', 'ui.theme']);
    expect(result.values['monitor.refreshIntervalMs']).toBe(500);
    expect(parseSettingsValues(getSettings(db))['ui.theme']).toBe('dark');
  });

  it('一批里有一个键非法 → 整批拒绝，另一个合法键也不生效（不做半批）', () => {
    const before = parseSettingsValues(getSettings(db))['ui.theme'];
    expect(() => updateSettings({ db, actor }, { 'ui.theme': 'dark', 'task.timeoutToleranceS': -5 })).toThrowError();
    expect(parseSettingsValues(getSettings(db))['ui.theme']).toBe(before);
  });

  it('未知键 → SETTINGS.KEY_NOT_FOUND，并附上已知键清单（便于发现拼错）', () => {
    try {
      updateSettings({ db, actor }, { 'monitor.refreshInterval': 500 });
      throw new Error('应当报错');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('SETTINGS.KEY_NOT_FOUND');
      const detail = (error as { detail?: { known?: string[] } }).detail;
      expect(detail?.known).toContain('monitor.refreshIntervalMs');
    }
  });

  it('空 updates → VALIDATION.FAILED（不是静默成功）', () => {
    expectFieldError(() => updateSettings({ db, actor }, {}), 'updates', /至少要给出一个设置项/);
  });

  it('写审计：before/after 只含本次改动的键', () => {
    updateSettings({ db, actor }, { 'ui.theme': 'dark' });
    const { records } = listAudit(db, { page: 1, pageSize: 10, module: 'settings' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: 'update', object_id: 'ui.theme', trace_id: 't-set' });
  });
});
