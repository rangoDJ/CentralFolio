import { listManualAssets, ManualAsset } from "../repositories/manualAssetRepository.js";
import { convertToBase } from "./fxService.js";

export interface ManualAssetSlice {
  key: string;
  value: number;
  pct: number;
}

export interface ManualAssetSummary {
  totalValueBase: number;
  baseCurrency: string;
  count: number;
  byCategory: ManualAssetSlice[];
  byCurrency: ManualAssetSlice[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function toSlices(map: Map<string, number>, total: number): ManualAssetSlice[] {
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, value: round2(value), pct: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Aggregates manual assets by category and currency, then converts everything
 * into a single base currency (the dominant currency among the assets) so a
 * true net-worth total can be shown alongside brokerage holdings.
 * Pure (exported for tests) — takes assets as input rather than reading the DB.
 */
export async function summarizeManualAssets(assets: Pick<ManualAsset, "category" | "value" | "currency">[]): Promise<ManualAssetSummary> {
  const byCategoryNative = new Map<string, number>();
  const byCurrencyNative = new Map<string, number>();

  for (const a of assets) {
    byCategoryNative.set(a.category, (byCategoryNative.get(a.category) ?? 0) + a.value);
    byCurrencyNative.set(a.currency, (byCurrencyNative.get(a.currency) ?? 0) + a.value);
  }

  const baseCurrency = byCurrencyNative.size
    ? Array.from(byCurrencyNative.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : "CAD";

  const totalValueBase = await convertToBase(byCurrencyNative, baseCurrency);

  // Category totals need the same FX conversion, split by the currency each
  // category's assets are actually held in.
  const byCategoryCurrency = new Map<string, Map<string, number>>();
  for (const a of assets) {
    if (!byCategoryCurrency.has(a.category)) byCategoryCurrency.set(a.category, new Map());
    const m = byCategoryCurrency.get(a.category)!;
    m.set(a.currency, (m.get(a.currency) ?? 0) + a.value);
  }
  const byCategoryBase = new Map<string, number>();
  for (const [category, amounts] of byCategoryCurrency) {
    byCategoryBase.set(category, await convertToBase(amounts, baseCurrency));
  }

  return {
    totalValueBase: round2(totalValueBase),
    baseCurrency,
    count: assets.length,
    byCategory: toSlices(byCategoryBase, totalValueBase),
    byCurrency: toSlices(byCurrencyNative, Array.from(byCurrencyNative.values()).reduce((s, v) => s + v, 0)),
  };
}

export function getManualAssetSummary(): Promise<ManualAssetSummary> {
  return summarizeManualAssets(listManualAssets());
}
