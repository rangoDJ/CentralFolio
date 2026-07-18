import { db } from "../models/database.js";
import { logger } from "../utils/logger.js";

export interface ManualAsset {
  id: number;
  name: string;
  category: string;
  value: number;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManualAssetInput {
  name: string;
  category: string;
  value: number;
  currency: string;
  notes?: string | null;
}

const stmtList = db.prepare(
  `SELECT id, name, category, value, currency, notes, createdAt, updatedAt FROM manual_assets ORDER BY value DESC`
);
const stmtGet = db.prepare(
  `SELECT id, name, category, value, currency, notes, createdAt, updatedAt FROM manual_assets WHERE id = ?`
);
const stmtInsert = db.prepare(
  `INSERT INTO manual_assets (name, category, value, currency, notes) VALUES (?, ?, ?, ?, ?)`
);
const stmtUpdate = db.prepare(
  `UPDATE manual_assets SET name = ?, category = ?, value = ?, currency = ?, notes = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`
);
const stmtDelete = db.prepare(`DELETE FROM manual_assets WHERE id = ?`);

export function listManualAssets(): ManualAsset[] {
  return stmtList.all() as ManualAsset[];
}

export function getManualAsset(id: number): ManualAsset | null {
  return (stmtGet.get(id) as ManualAsset | undefined) ?? null;
}

export function createManualAsset(input: ManualAssetInput): ManualAsset {
  const res = stmtInsert.run(input.name, input.category, input.value, input.currency, input.notes ?? null);
  logger.info("ManualAssets", `Created "${input.name}" (${input.category}) — ${input.currency} ${input.value}`);
  return getManualAsset(Number(res.lastInsertRowid))!;
}

export function updateManualAsset(id: number, input: ManualAssetInput): ManualAsset | null {
  const res = stmtUpdate.run(input.name, input.category, input.value, input.currency, input.notes ?? null, id);
  if (res.changes === 0) return null;
  logger.info("ManualAssets", `Updated #${id} — "${input.name}"`);
  return getManualAsset(id);
}

export function deleteManualAsset(id: number): boolean {
  const res = stmtDelete.run(id);
  if (res.changes > 0) logger.info("ManualAssets", `Deleted #${id}`);
  return res.changes > 0;
}
