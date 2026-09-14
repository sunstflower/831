import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { all, migrationsDir, nowIso, run, tx, type Db } from './index.js';

const MIGRATION_FILE = /^(\d{4})_.+\.sql$/;

export function applyMigrations(db: Db, dir: string = migrationsDir()): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at  TEXT NOT NULL
  );`);

  const applied = new Set(
    all<{ version: number }>(db, 'SELECT version FROM schema_version').map((row) => row.version)
  );
  const files = readdirSync(dir)
    .filter((file) => MIGRATION_FILE.test(file))
    .sort();

  const newlyApplied: number[] = [];
  for (const file of files) {
    const version = Number(file.slice(0, 4));
    if (applied.has(version)) {
      continue;
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    tx(db, () => {
      db.exec(sql);
      run(db, 'INSERT INTO schema_version (version, description, applied_at) VALUES (?, ?, ?)', [
        version,
        file,
        nowIso()
      ]);
    });
    newlyApplied.push(version);
  }
  return newlyApplied;
}
