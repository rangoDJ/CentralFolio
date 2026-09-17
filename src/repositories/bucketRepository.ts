import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

/**
 * Buy buckets: a named set of symbols bought together for one cash amount.
 *
 * A bucket holds only what the user decided — the symbols, how to divide the
 * money, and how much. The account is deliberately not stored: the same bucket
 * is meant to be run into a TFSA this month and an RRSP the next, so the
 * account(s) are chosen at the moment it is run.
 */

export type SplitMode = "equal" | "weighted";

export interface BucketItem {
  symbol: string;
  name: string | null;
  /** Percent of the bucket, used only when splitMode is 'weighted'. */
  weight: number | null;
}

export interface Bucket {
  id: number;
  name: string;
  cashValue: number;
  splitMode: SplitMode;
  items: BucketItem[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BucketInput {
  name: string;
  cashValue: number;
  splitMode: SplitMode;
  items: BucketItem[];
}

const stmtListBuckets = db.prepare(
  "SELECT id, name, cashValue, splitMode, createdAt, updatedAt FROM buy_buckets ORDER BY name COLLATE NOCASE"
);
const stmtGetBucket = db.prepare(
  "SELECT id, name, cashValue, splitMode, createdAt, updatedAt FROM buy_buckets WHERE id = ?"
);
const stmtListItems = db.prepare(
  "SELECT symbol, name, weight FROM buy_bucket_items WHERE bucketId = ? ORDER BY position, id"
);
const stmtInsertBucket = db.prepare(
  "INSERT INTO buy_buckets (name, cashValue, splitMode) VALUES (?, ?, ?)"
);
const stmtUpdateBucket = db.prepare(
  "UPDATE buy_buckets SET name = ?, cashValue = ?, splitMode = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?"
);
const stmtDeleteBucket = db.prepare("DELETE FROM buy_buckets WHERE id = ?");
const stmtDeleteItems = db.prepare("DELETE FROM buy_bucket_items WHERE bucketId = ?");
const stmtInsertItem = db.prepare(
  "INSERT INTO buy_bucket_items (bucketId, symbol, name, weight, position) VALUES (?, ?, ?, ?, ?)"
);

function hydrate(row: any): Bucket {
  return {
    id: row.id,
    name: row.name,
    cashValue: row.cashValue,
    splitMode: row.splitMode === "weighted" ? "weighted" : "equal",
    items: stmtListItems.all(row.id) as BucketItem[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listBuckets(): Bucket[] {
  const rows = stmtListBuckets.all() as any[];
  logger.debug("Buckets", `listBuckets → ${rows.length} bucket(s)`);
  return rows.map(hydrate);
}

export function getBucket(id: number): Bucket | null {
  const row = stmtGetBucket.get(id) as any;
  return row ? hydrate(row) : null;
}

// Items are rewritten wholesale rather than diffed: a bucket is a handful of
// symbols, and replacing them in the same transaction as the bucket row keeps
// the two from ever disagreeing.
const writeItems = db.transaction((bucketId: number, items: BucketItem[]) => {
  stmtDeleteItems.run(bucketId);
  items.forEach((item, i) => {
    stmtInsertItem.run(bucketId, item.symbol, item.name ?? null, item.weight ?? null, i);
  });
});

export function createBucket(input: BucketInput): Bucket {
  const create = db.transaction(() => {
    const res = stmtInsertBucket.run(input.name, input.cashValue, input.splitMode);
    const id = Number(res.lastInsertRowid);
    writeItems(id, input.items);
    return id;
  });
  const id = create();
  logger.info("Buckets", `Created "${input.name}" — ${input.items.length} symbol(s), ${input.splitMode}, ${input.cashValue}`);
  return getBucket(id)!;
}

export function updateBucket(id: number, input: BucketInput): Bucket | null {
  if (!stmtGetBucket.get(id)) return null;
  const update = db.transaction(() => {
    stmtUpdateBucket.run(input.name, input.cashValue, input.splitMode, id);
    writeItems(id, input.items);
  });
  update();
  logger.info("Buckets", `Updated #${id} — "${input.name}" (${input.items.length} symbol(s))`);
  return getBucket(id);
}

export function deleteBucket(id: number): boolean {
  const res = stmtDeleteBucket.run(id);
  logger.info("Buckets", `Deleted #${id} — ${res.changes} row(s)`);
  return res.changes > 0;
}
