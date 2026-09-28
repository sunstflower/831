import { SETTINGS_SCHEMA, settingsDefaults } from '@udm/shared';
import { all, nowIso, run, type Db } from '../index.js';

export function getSettings(db: Db): Record<string, string> {
  const rows = all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const defaults = settingsDefaults();
  const result: Record<string, string> = {};
  for (const item of SETTINGS_SCHEMA) {
    result[item.key] = JSON.stringify(defaults[item.key]);
  }
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function upsertSetting(db: Db, key: string, value: unknown, updatedBy: string): void {
  run(
    db,
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [key, JSON.stringify(value), nowIso(), updatedBy]
  );
}

/**
 * 把 `getSettings` 返回的「全字符串」映射还原为**带类型的值**。
 *
 * 为什么放在仓库层而不是 `ipc/api.ts`（它原先就在那里）：`settings.value` 列是 TEXT，
 * 存的是 `JSON.stringify(后)的值`；「存进去要序列化、读出来要反序列化」是**同一件事的两端**，
 * 分居两处就会在改存储格式时只改一半（本文件的 `upsertSetting` 负责那一端）。
 *
 * 解析失败时**原样返回字符串**，不抛错：`settings` 表可能被手工 SQL 或旧版本写坏，
 * 而「某个设置项读不出来」不该让整个设置页打不开 —— 让使用者看到原始值再改，
 * 比看到一片空白可诊断得多。
 */
export function parseSettingsValues(raw: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    try {
      result[key] = JSON.parse(value);
    } catch {
      result[key] = value;
    }
  }
  return result;
}
