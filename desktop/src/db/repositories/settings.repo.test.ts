import { SETTINGS_SCHEMA, settingsDefaults } from '@udm/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, run } from '../index.js';
import { applyMigrations } from '../migrate.js';
import { getSettings, parseSettingsValues, upsertSetting } from './settings.repo.js';

function setup() {
  const db = openDatabase(':memory:');
  applyMigrations(db);
  return db;
}

describe('parseSettingsValues', () => {
  it('把 JSON 文本还原为原类型（数字仍是数字、布尔仍是布尔）', () => {
    const parsed = parseSettingsValues({
      number: '20',
      bool: 'true',
      text: '"AGV"',
      object: '{"a":1}',
      array: '[1,2]'
    });
    expect(parsed).toEqual({ number: 20, bool: true, text: 'AGV', object: { a: 1 }, array: [1, 2] });
  });

  it('不是合法 JSON 的值原样保留，不抛错（坏一行不该让整页打不开）', () => {
    const parsed = parseSettingsValues({ broken: 'not json', empty: '' });
    expect(parsed).toEqual({ broken: 'not json', empty: '' });
  });
});

describe('getSettings', () => {
  it('空库时给出 SETTINGS_SCHEMA 的全量默认值', () => {
    const db = setup();
    const raw = getSettings(db);
    // 键集合必须与契约一致：少一个键，前端读到的就是 undefined
    expect(Object.keys(raw).sort()).toEqual(SETTINGS_SCHEMA.map((item) => item.key).sort());
    expect(parseSettingsValues(raw)).toEqual(settingsDefaults());
  });

  it('库里的值覆盖默认值，未改动的项仍是默认值', () => {
    const db = setup();
    const target = SETTINGS_SCHEMA[0];
    if (!target) {
      throw new Error('SETTINGS_SCHEMA 为空，测试前提不成立');
    }
    upsertSetting(db, target.key, 'changed-by-test', 'seed-admin');

    const parsed = parseSettingsValues(getSettings(db));
    expect(parsed[target.key]).toBe('changed-by-test');

    // 其余项不受影响（覆盖是逐键的，不是整表替换）
    const others = SETTINGS_SCHEMA.filter((item) => item.key !== target.key);
    const defaults = settingsDefaults();
    for (const item of others) {
      expect(parsed[item.key], item.key).toEqual(defaults[item.key]);
    }
  });

  it('同一键重复写入时是更新而非插入（ON CONFLICT 分支）', () => {
    const db = setup();
    const target = SETTINGS_SCHEMA[0];
    if (!target) {
      throw new Error('SETTINGS_SCHEMA 为空，测试前提不成立');
    }
    upsertSetting(db, target.key, 1, 'seed-admin');
    upsertSetting(db, target.key, 2, 'seed-admin');
    const rows = db.prepare('SELECT COUNT(*) AS n FROM settings WHERE key = ?').get(target.key) as {
      n: number;
    };
    expect(rows.n).toBe(1);
    expect(parseSettingsValues(getSettings(db))[target.key]).toBe(2);
  });

  it('表里存在 schema 之外的键时也照常返回（不静默丢弃）', () => {
    // 旧版本遗留或手工写入的键：丢弃它会让使用者以为设置消失了
    const db = setup();
    run(db, 'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)', [
      'legacy.key',
      '"kept"',
      '2026-09-26T00:00:00.000Z',
      'seed-admin'
    ]);
    expect(parseSettingsValues(getSettings(db))['legacy.key']).toBe('kept');
  });
});
