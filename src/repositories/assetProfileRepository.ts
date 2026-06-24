import { db } from "../models/database.js";

export interface AssetProfile {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  assetType: string | null;
  cachedAt?: string;
}

const stmtGet = db.prepare(`SELECT * FROM asset_profiles WHERE symbol = ?`);
const stmtGetAll = db.prepare(`SELECT * FROM asset_profiles`);

const stmtUpsert = db.prepare(`
  INSERT INTO asset_profiles (symbol, name, sector, industry, country, assetType, provider, cachedAt)
  VALUES (@symbol, @name, @sector, @industry, @country, @assetType, 'yahoo', CURRENT_TIMESTAMP)
  ON CONFLICT(symbol) DO UPDATE SET
    name      = excluded.name,
    sector    = excluded.sector,
    industry  = excluded.industry,
    country   = excluded.country,
    assetType = excluded.assetType,
    provider  = excluded.provider,
    cachedAt  = CURRENT_TIMESTAMP
`);

export function getProfile(symbol: string): AssetProfile | null {
  return (stmtGet.get(symbol) as AssetProfile | undefined) ?? null;
}

export function getAllProfiles(): AssetProfile[] {
  return stmtGetAll.all() as AssetProfile[];
}

export function getProfilesMap(symbols: string[]): Map<string, AssetProfile> {
  const map = new Map<string, AssetProfile>();
  for (const s of symbols) {
    const p = getProfile(s);
    if (p) map.set(s, p);
  }
  return map;
}

export function upsertProfile(p: AssetProfile): void {
  stmtUpsert.run({
    symbol: p.symbol,
    name: p.name ?? null,
    sector: p.sector ?? null,
    industry: p.industry ?? null,
    country: p.country ?? null,
    assetType: p.assetType ?? null,
  });
}
