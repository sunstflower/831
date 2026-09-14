import { existsSync, rmSync } from 'node:fs';
import { defaultDbPath, openDatabase } from '../db/index.js';
import { applyMigrations } from '../db/migrate.js';
import { countRows, seedDatabase } from '../db/seed.js';

const TABLES = [
  'users',
  'nodes',
  'edges',
  'sites',
  'vehicles',
  'restrictions',
  'task_templates',
  'tasks',
  'routes',
  'dispatch_plans',
  'dispatch_logs',
  'alerts',
  'audit_logs',
  'event_log',
  'vehicle_tracks',
  'settings'
];

function printCounts(db: ReturnType<typeof openDatabase>) {
  const counts = Object.fromEntries(TABLES.map((table) => [table, countRows(db, table)]));
  console.log(`[udm] rows: ${JSON.stringify(counts)}`);
}

function main() {
  const command = process.argv[2] ?? 'migrate';
  const dbPath = defaultDbPath();

  if (command === 'reset') {
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${dbPath}${suffix}`;
      if (existsSync(file)) {
        rmSync(file);
      }
    }
    console.log(`[udm] removed ${dbPath}`);
  }

  const db = openDatabase(dbPath);
  try {
    const applied = applyMigrations(db);
    console.log(`[udm] db=${dbPath}`);
    console.log(`[udm] migrations applied: ${applied.length === 0 ? 'none' : applied.join(', ')}`);
    if (command === 'seed' || command === 'reset' || command === 'migrate') {
      const seeded = seedDatabase(db);
      console.log(`[udm] seed changes: ${JSON.stringify(seeded)}`);
    }
    printCounts(db);
  } finally {
    db.close();
  }
}

main();
