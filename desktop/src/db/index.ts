import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSyncImpl, type DatabaseSync } from './sqlite.js';

export type Db = DatabaseSync;
export type SqlParam = string | number | bigint | null | Uint8Array;

export function nowIso(): string {
  return new Date().toISOString();
}

export function defaultDbPath(): string {
  if (process.env.UDM_DB_PATH) {
    return process.env.UDM_DB_PATH;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const desktopRoot = resolve(here, '..', '..');
  return resolve(desktopRoot, '.data', 'app.db');
}

export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', 'migrations');
}

export function openDatabase(file: string = defaultDbPath()): Db {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSyncImpl(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

function normalize(value: SqlParam | boolean | undefined): SqlParam {
  if (value === undefined) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value;
}

export function run(db: Db, sql: string, params: SqlParam[] = []) {
  return db.prepare(sql).run(...params.map(normalize));
}

export function get<T>(db: Db, sql: string, params: SqlParam[] = []): T | undefined {
  return db.prepare(sql).get(...params.map(normalize)) as T | undefined;
}

export function all<T>(db: Db, sql: string, params: SqlParam[] = []): T[] {
  return db.prepare(sql).all(...params.map(normalize)) as T[];
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
