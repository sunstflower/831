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
