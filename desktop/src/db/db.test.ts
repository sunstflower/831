import { describe, expect, it } from 'vitest';
import { all, openDatabase } from './index.js';
import { applyMigrations } from './migrate.js';
import { countRows, seedDatabase } from './seed.js';

function tableNames(): string[] {
  const db = openDatabase(':memory:');
  try {
    applyMigrations(db);
    return all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(
      (row) => row.name
    );
  } finally {
    db.close();
  }
}

describe('migrations', () => {
  it('applies 0001 once and is idempotent', () => {
    const db = openDatabase(':memory:');
    try {
      expect(applyMigrations(db)).toEqual([1]);
      expect(applyMigrations(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('creates all 17 business tables plus schema_version', () => {
    const names = tableNames();
    expect(names).toContain('schema_version');
    const business = names.filter((name) => name !== 'schema_version');
    expect(business).toHaveLength(17);
  });

  it('enforces enum check constraints', () => {
    const db = openDatabase(':memory:');
    applyMigrations(db);
    expect(() =>
      db.prepare(
        "INSERT INTO users (id, username, password_hash, role, display_name, status, created_at, updated_at) VALUES ('x','x','h','hacker','X','active','now','now')"
      ).run()
    ).toThrow();
    db.close();
  });
});

describe('seed', () => {
  it('is idempotent and fills demo data', () => {
    const db = openDatabase(':memory:');
    applyMigrations(db);
    seedDatabase(db);
    const first = {
      users: countRows(db, 'users'),
      nodes: countRows(db, 'nodes'),
      edges: countRows(db, 'edges'),
      sites: countRows(db, 'sites'),
      vehicles: countRows(db, 'vehicles'),
      settings: countRows(db, 'settings')
    };
    seedDatabase(db);
    const second = {
      users: countRows(db, 'users'),
      nodes: countRows(db, 'nodes'),
      edges: countRows(db, 'edges'),
      sites: countRows(db, 'sites'),
      vehicles: countRows(db, 'vehicles'),
      settings: countRows(db, 'settings')
    };
    expect(second).toEqual(first);
    expect(first.users).toBe(3);
    expect(first.nodes).toBe(12);
    expect(first.edges).toBe(34);
    expect(first.sites).toBe(3);
    expect(first.vehicles).toBe(3);
    expect(first.settings).toBeGreaterThanOrEqual(9);
    db.close();
  });
});
