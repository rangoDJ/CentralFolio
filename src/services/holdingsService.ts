import { getCachedAccounts, getCachedPositions, saveCachedPositions, getActiveAccountIds, listPortfolios, saveCachedAccounts, getAccountFetchTimestamps } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "./snaptrade.js";
import { logger } from "../utils/logger.js";
import { mapWithConcurrency } from "../utils/concurrency.js";

// Max account position fetches in flight at once, to stay within SnapTrade rate limits.
const ACCOUNT_FETCH_CONCURRENCY = 4;

export async function refreshAllHoldings(intervalMs: number, forceRefresh: boolean = false): Promise<{ processed: number; skipped: number; skippedInactive: number; errors: number; newHoldings: number }> {
  logger.info('Holdings', 'Starting holdings refresh cycle...');

  const portfolios = listPortfolios();
  let activeAccountIds = getActiveAccountIds();
  let processed = 0, skipped = 0, skippedInactive = 0, errors = 0, newHoldings = 0;

  for (const portfolio of portfolios) {
    if (!portfolio.userSecret) {
      logger.debug('Holdings', `Skipping portfolio "${portfolio.name}" — not registered`);
      continue;
    }

    const client = getSnapTradeClientForPortfolio(portfolio);
    let accounts = getCachedAccounts(portfolio.id!);

    if (accounts.length === 0) {
      try {
        logger.info('Holdings', `No cached accounts for portfolio "${portfolio.name}" — proactively fetching from SnapTrade...`);
        const accsResponse = await client.accountInformation.listUserAccounts({
          userId: portfolio.userId,
          userSecret: portfolio.userSecret!,
        });
        const fetchedAccounts = Array.isArray(accsResponse.data) ? accsResponse.data : [];
        if (fetchedAccounts.length > 0) {
          saveCachedAccounts(portfolio.id!, fetchedAccounts);
          accounts = getCachedAccounts(portfolio.id!);
          activeAccountIds = getActiveAccountIds();
        }
      } catch (err: any) {
        const body = err?.responseBody ?? err?.response?.data;
        const errMsg = body?.detail || err.message || "Unknown error";
        logger.warn('Holdings', `Failed to proactively fetch accounts for portfolio "${portfolio.name}": ${errMsg}`);
        errors++;
        continue;
      }
    }

    await mapWithConcurrency(accounts, ACCOUNT_FETCH_CONCURRENCY, async (account) => {
      if (!activeAccountIds.has(account.id)) {
        skippedInactive++;
        return;
      }

      try {
        const timestamps = getAccountFetchTimestamps(account.id);
        const lastFetch = timestamps?.lastPositionsFetch;
        const lastFetchTime = lastFetch ? new Date(lastFetch.replace(' ', 'T') + 'Z').getTime() : 0;
        const isFresh = lastFetchTime > 0 && (Date.now() - lastFetchTime < intervalMs);

        if (isFresh && !forceRefresh) {
          logger.debug('Holdings', `Account ${account.id} — cache fresh, skipping`);
          skipped++;
          return;
        }

        logger.info('Holdings', `Refreshing positions for account ${account.id}...`);
        const prevSymbols = new Set(getCachedPositions(account.id).map((p: any) => p.symbol).filter(Boolean));

        const response = await client.accountInformation.getUserAccountPositions({
          userId: portfolio.userId,
          userSecret: portfolio.userSecret!,
          accountId: account.id,
        });

        saveCachedPositions(account.id, response.data);

        const freshSymbols = (Array.isArray(response.data) ? response.data : [])
          .map((p: any) => p.instrument?.symbol || p.instrument?.raw_symbol || p.symbol?.symbol || p.symbol)
          .filter(Boolean);
        const brandNew = freshSymbols.filter((s: string) => !prevSymbols.has(s)).length;
        newHoldings += brandNew;
        processed++;
      } catch (err: any) {
        const body = err?.responseBody ?? err?.response?.data;
        const errMsg = body?.detail || err.message || "Unknown error";
        logger.warn('Holdings', `Error refreshing account ${account.id}: ${errMsg}`);
        errors++;
      }
    });
  }

  logger.info('Holdings', `Holdings refresh complete — ${processed} refreshed, ${skipped} skipped (cache fresh), ${skippedInactive} skipped (inactive), ${newHoldings} new holding(s), ${errors} errors`);
  return { processed, skipped, skippedInactive, errors, newHoldings };
}
