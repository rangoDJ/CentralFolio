import { Request, Response } from "express";
import {
  getCachedAccounts,
  getCachedPositions,
  getActiveAccountIds,
  listPortfolios,
} from "../models/db.js";
import { getUserPortfolioById } from "../repositories/userPortfolioRepository.js";
import { comparePortfolios, resolveCompareRates, ComparePortfolioInput } from "../services/portfolioCompareService.js";
import { logger } from "../utils/logger.js";

// A comparison table is only readable up to a handful of columns, and each id
// costs a full account+position walk — cap it rather than let a long query
// string fan out unbounded work.
const MAX_PORTFOLIOS = 8;

/** Parse the comma-separated `ids` query param into unique positive integers. */
function parseIds(raw: unknown): number[] | null {
  if (typeof raw !== "string") return null;
  const ids: number[] = [];
  for (const part of raw.split(",")) {
    const s = part.trim();
    if (!s) continue;
    const n = Number(s);
    if (!Number.isInteger(n) || n <= 0) return null;
    if (!ids.includes(n)) ids.push(n);
  }
  return ids.length > 0 ? ids : null;
}

// GET /api/user-portfolios/compare?ids=1,2,3
// Symbol-by-portfolio matrix: which of the selected portfolios hold each
// symbol, at what size, and which don't (the buy candidates). Amounts are
// converted into one base currency so mixed-currency portfolios total up.
export const comparePortfoliosHandler = async (req: Request, res: Response) => {
  if (req.query.ids == null || String(req.query.ids).trim() === "") {
    return res.status(400).json({ error: "ids is required — a comma-separated list of portfolio ids" });
  }
  const ids = parseIds(req.query.ids);
  if (!ids) {
    return res.status(400).json({ error: "ids must be a comma-separated list of positive integers" });
  }
  if (ids.length > MAX_PORTFOLIOS) {
    return res.status(400).json({ error: `Compare at most ${MAX_PORTFOLIOS} portfolios at a time` });
  }

  logger.info("Compare", `GET /api/user-portfolios/compare ids=${ids.join(",")}`);

  try {
    // Account → owning SnapTrade credential group, so each account carries the
    // parent portfolio id and its tradingEnabled flag needed to place a buy.
    const activeIds = getActiveAccountIds();
    const accountIndex = new Map<string, { account: any; parentId: string; tradingEnabled: boolean }>();
    for (const parent of listPortfolios()) {
      for (const account of getCachedAccounts(parent.id!)) {
        accountIndex.set(account.id, {
          account,
          parentId: String(parent.id),
          tradingEnabled: !!parent.tradingEnabled,
        });
      }
    }

    const inputs: ComparePortfolioInput[] = [];
    for (const id of ids) {
      const portfolio = getUserPortfolioById(id);
      if (!portfolio) return res.status(404).json({ error: `Portfolio ${id} not found` });

      const accounts = (portfolio.accountIds ?? [])
        .filter(accountId => activeIds.has(accountId))
        .map(accountId => {
          const entry = accountIndex.get(accountId);
          if (!entry) return null;
          const { account, parentId, tradingEnabled } = entry;
          return {
            accountId,
            accountName: account.customName || account.name || "Unnamed Account",
            parentPortfolioId: parentId,
            tradingEnabled,
            currency: account.currency || "USD",
            cash: account.cashBalance || 0,
            positions: getCachedPositions(accountId),
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);

      inputs.push({ id: portfolio.id, name: portfolio.name, color: portfolio.color, accounts });
    }

    const rates = await resolveCompareRates(inputs);
    res.json(comparePortfolios(inputs, rates));
  } catch (err: any) {
    logger.error("Compare", `comparePortfolios failed for ids=${ids.join(",")}: ${err.message}`);
    res.status(500).json({ error: "Failed to compare portfolios" });
  }
};
