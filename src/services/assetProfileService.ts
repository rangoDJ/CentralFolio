import YahooFinance from "yahoo-finance2";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { toYahooSymbol } from "./priceHistoryService.js";
import { getProfile, upsertProfile, type AssetProfile } from "../repositories/assetProfileRepository.js";

const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

// Profiles change rarely — refresh at most every 30 days.
const PROFILE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FETCH_MIN_INTERVAL_MS = 400;
let lastFetchAt = 0;

const norm = (s: unknown) => String(s ?? "").toUpperCase().trim();
const inflight = new Map<string, Promise<AssetProfile | null>>();

function isFresh(p: AssetProfile | null): boolean {
  if (!p || !p.cachedAt) return false;
  const ts = new Date(p.cachedAt.replace(" ", "T") + "Z").getTime();
  return Date.now() - ts < PROFILE_TTL_MS;
}

async function fetchProfile(symbol: string): Promise<AssetProfile | null> {
  const yahooSymbol = toYahooSymbol(symbol);
  const elapsed = Date.now() - lastFetchAt;
  if (elapsed < FETCH_MIN_INTERVAL_MS) await sleep(FETCH_MIN_INTERVAL_MS - elapsed);
  lastFetchAt = Date.now();

  const r = await yahoo.quoteSummary(yahooSymbol, { modules: ["assetProfile", "price", "quoteType"] });
  const profile: AssetProfile = {
    symbol,
    name: (r as any)?.price?.shortName ?? (r as any)?.price?.longName ?? null,
    sector: (r as any)?.assetProfile?.sector ?? null,
    industry: (r as any)?.assetProfile?.industry ?? null,
    country: (r as any)?.assetProfile?.country ?? null,
    assetType: (r as any)?.quoteType?.quoteType ?? (r as any)?.price?.quoteType ?? null,
  };
  upsertProfile(profile);
  return profile;
}

/**
 * Ensure a symbol's profile is cached and reasonably fresh. Serves cached data
 * when fresh; fetches (and blocks) only when missing/stale. Failures fall back
 * to whatever is cached (possibly null).
 */
export async function ensureProfile(symbol: string): Promise<AssetProfile | null> {
  const key = norm(symbol);
  const cached = getProfile(key);
  if (isFresh(cached)) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const work = (async () => {
    try {
      return await fetchProfile(key);
    } catch (e: any) {
      logger.warn("AssetProfile", `fetchProfile(${key}) failed: ${e.message}`);
      return cached; // serve stale-or-null rather than throwing
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, work);
  return work;
}

/** Ensure profiles for many symbols (sequential to respect the rate limit). */
export async function ensureProfiles(symbols: string[]): Promise<Map<string, AssetProfile>> {
  const map = new Map<string, AssetProfile>();
  for (const s of symbols) {
    const p = await ensureProfile(s);
    if (p) map.set(norm(s), p);
  }
  return map;
}
