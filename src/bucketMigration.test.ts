import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Dropping buy_buckets.cashValue rebuilds the table. SQLite's DROP TABLE on a
 * parent performs an implicit delete of its rows, so with foreign_keys ON it
 * would cascade through buy_bucket_items and silently empty every bucket.
 * This builds a database at the previous schema and checks the data survives.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bucket-migration-'));
process.env.DATA_DIR = dir;

// The schema as it stood before this migration, with a bucket and its symbols.
const seed = new Database(path.join(dir, 'snaptrade.db'));
seed.pragma('foreign_keys = ON');
seed.exec(`
  CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, appliedAt DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE buy_buckets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cashValue REAL NOT NULL,
    splitMode TEXT NOT NULL DEFAULT 'equal', createdAt DATETIME, updatedAt DATETIME);
  CREATE TABLE buy_bucket_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bucketId INTEGER NOT NULL REFERENCES buy_buckets(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL, name TEXT, weight REAL, position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(bucketId, symbol));
`);
seed.prepare(`INSERT INTO buy_buckets (id,name,cashValue,splitMode) VALUES (7,'Legacy',250,'weighted')`).run();
[['AAPL', 50], ['MSFT', 30], ['ENB.TO', 20]].forEach(([symbol, weight], i) => {
  seed.prepare(`INSERT INTO buy_bucket_items (bucketId,symbol,weight,position) VALUES (7,?,?,?)`).run(symbol, weight, i);
});
// Mark the earlier bucket migrations applied so only the rebuild runs here.
for (const name of ['buy_buckets.create', 'buy_bucket_items.create', 'buy_bucket_items.idx_bucketId']) {
  seed.prepare(`INSERT INTO schema_migrations (name) VALUES (?)`).run(name);
}
seed.close();

// Importing the module runs the migrations.
const { db } = await import('./models/database.js');

test('cashValue is gone from buy_buckets', () => {
  const cols = (db.prepare(`PRAGMA table_info(buy_buckets)`).all() as any[]).map(c => c.name);
  assert.ok(!cols.includes('cashValue'), `still present: ${cols.join(', ')}`);
  assert.deepEqual(cols.sort(), ['createdAt', 'id', 'name', 'splitMode', 'updatedAt']);
});

test('the bucket itself survives the rebuild', () => {
  const row = db.prepare(`SELECT id, name, splitMode FROM buy_buckets WHERE id = 7`).get() as any;
  assert.deepEqual(row, { id: 7, name: 'Legacy', splitMode: 'weighted' });
});

test('its symbols are not cascade-deleted by the rebuild', () => {
  const items = db.prepare(`SELECT symbol, weight FROM buy_bucket_items WHERE bucketId = 7 ORDER BY position`).all() as any[];
  assert.equal(items.length, 3, 'a cascading DROP TABLE would leave none');
  assert.deepEqual(items, [
    { symbol: 'AAPL', weight: 50 },
    { symbol: 'MSFT', weight: 30 },
    { symbol: 'ENB.TO', weight: 20 },
  ]);
});

test('foreign keys are back on afterwards', () => {
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('the cascade still works after the rebuild', () => {
  db.prepare(`DELETE FROM buy_buckets WHERE id = 7`).run();
  const left = db.prepare(`SELECT COUNT(*) AS c FROM buy_bucket_items WHERE bucketId = 7`).get() as any;
  assert.equal(left.c, 0, 'deleting a bucket should still remove its symbols');
});
