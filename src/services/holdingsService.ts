import { getCachedAccounts, getCachedPositions, saveCachedPositions, getActiveAccountIds, listPortfolios } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "./snaptrade.js";
import { logger } from "../utils/logger.js";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function refreshAllHoldings(intervalMs: number, forceRefresh: boolean = false): Promise<void> {
  logger.info('Holdings', 'Starting holdings refresh cycle...');

  const portfolios = listPortfolios();
  const activeAccountIds = getActiveAccountIds();
  let processed = 0, skipped = 0, errors = 0;

  for (const portfolio of portfolios) {
    if (!portfolio.userSecret) {
      logger.debug('Holdings', `Skipping portfolio "${portfolio.name}" — not registered`);
      continue;
    }

    const client = getSnapTradeClientForPortfolio(portfolio);
    const accounts = getCachedAccounts(portfolio.id!);

    for (const account of accounts) {
      if (!activeAccountIds.has(account.id)) continue;

      try {
        const positions = getCachedPositions(account.id);
        const isFresh = positions.length > 0 &&
          (Date.now() - new Date(positions[0].cachedAt).getTime() < intervalMs);

        if (isFresh && !forceRefresh) {
          logger.debug('Holdings', `Account ${account.id} — cache fresh, skipping`);
          skipped++;
          continue;
        }

        logger.info('Holdings', `Refreshing positions for account ${account.id}...`);
        const response = await client.accountInformation.getUserAccountPositions({
          userId: portfolio.userId,
          userSecret: portfolio.userSecret!,
          accountId: account.id,
        });

        saveCachedPositions(account.id, response.data);
        processed++;

        await sleep(200);
      } catch (err: any) {
        const body = err?.responseBody ?? err?.response?.data;
        const errMsg = body?.detail || err.message || "Unknown error";
        logger.warn('Holdings', `Error refreshing account ${account.id}: ${errMsg}`);
        errors++;
      }
    }
  }

  logger.info('Holdings', `Holdings refresh complete — ${processed} refreshed, ${skipped} skipped, ${errors} errors`);
}
