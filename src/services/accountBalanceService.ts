import { listPortfolios, saveCachedAccounts } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "./snaptrade.js";
import { logger } from "../utils/logger.js";
import { snapTradeError } from "../utils/snapTradeError.js";

/**
 * Pull account balances straight from the broker, bypassing the cache.
 *
 * Used where a stale balance would be actively harmful — deciding whether an
 * account can fund a set of orders. Everywhere else the cached balance and its
 * TTL are fine; this costs a live call per connection.
 */

export interface BalanceRefreshResult {
  /** Connections whose balances are now current. */
  refreshed: string[];
  /** Connections that could not be reached, with the broker's reason. */
  failures: Array<{ portfolioId: string; error: string }>;
}

export async function refreshAccountBalances(portfolioIds: string[]): Promise<BalanceRefreshResult> {
  const wanted = new Set(portfolioIds.map(String));
  const result: BalanceRefreshResult = { refreshed: [], failures: [] };

  await Promise.all(listPortfolios()
    .filter(p => wanted.has(String(p.id)))
    .map(async portfolio => {
      const id = String(portfolio.id);
      if (!portfolio.userSecret) {
        result.failures.push({ portfolioId: id, error: "Connection is not registered" });
        return;
      }
      try {
        const client = getSnapTradeClientForPortfolio(portfolio);
        const response = await client.accountInformation.listUserAccounts({
          userId: portfolio.userId,
          userSecret: portfolio.userSecret,
        });
        saveCachedAccounts(portfolio.id!, response.data as any[]);
        logger.info("Balances", `Refreshed ${(response.data as any[]).length} account(s) for "${portfolio.name}"`);
        result.refreshed.push(id);
      } catch (err: any) {
        const { log, client } = snapTradeError(err, "Could not reach the brokerage");
        logger.warn("Balances", `Refresh failed for "${portfolio.name}": ${log}`);
        result.failures.push({ portfolioId: id, error: client });
      }
    }));

  return result;
}
