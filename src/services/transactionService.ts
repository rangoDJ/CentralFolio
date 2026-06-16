import { getCachedAccounts, getCachedTransactions, saveCachedTransactions, getActiveAccountIds, listPortfolios, saveCachedAccounts, getAccountFetchTimestamps } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "./snaptrade.js";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import { randomUUID } from "crypto";

export interface Transaction {
  id: string;
  symbol?: string;
  description: string;
  type: string;
  action: string;
  units: number;
  price: number;
  amount: number;
  date: string;
  currencyCode: string;
  accountId?: string;
  portfolioName?: string;
  accountName?: string;
  accountId_unused?: string; // naming fix or whatever is needed
}

// Page size and an absolute safety cap so a misbehaving broker can't loop forever.
const TXN_PAGE_LIMIT = 1000;
const TXN_MAX_RECORDS = 100_000;

export async function fetchTransactionsForAccount(accountId: string, portfolioId: number | string, userId: string, userSecret: string, sinceDate?: string): Promise<Transaction[]> {
  try {
    logger.info('Transactions', sinceDate
      ? `Fetching transactions for account=${accountId} since ${sinceDate} (incremental)...`
      : `Fetching full transaction history for account=${accountId}...`);

    const client = getSnapTradeClientForPortfolio(portfolioId);

    // First sync: omit start/end dates — per the SnapTrade API the range then
    // defaults to the first/last transaction it knows (max history). On later
    // syncs we pass `sinceDate` to fetch only the recent delta. Either way we page
    // through all results (default page size 1000).
    const activities: any[] = [];
    let offset = 0;

    // Keep paging while each page comes back full; a short/empty page is the end.
    // Driven by page fullness (not pagination.total) so a missing total can't
    // truncate the history.
    while (activities.length < TXN_MAX_RECORDS) {
      const response = await client.accountInformation.getAccountActivities({
        accountId,
        userId,
        userSecret,
        ...(sinceDate ? { startDate: sinceDate } : {}),
        offset,
        limit: TXN_PAGE_LIMIT,
      });

      // Response shape: { data: [...], pagination: { offset, limit, total } }
      const raw = response.data as any;
      const page = Array.isArray(raw) ? raw : (raw?.data ?? raw?.activities ?? []);
      activities.push(...page);
      const total = raw?.pagination?.total ?? raw?.pagination?.total_count;

      logger.info('Transactions', `  account ${accountId}: fetched ${activities.length}${total != null ? '/' + total : ''}`);

      // Stop on the last (short/empty) page; otherwise advance and keep paging.
      if (page.length < TXN_PAGE_LIMIT) break;
      offset += page.length;
      await sleep(150); // be gentle with the API between pages
    }

    logger.info('Transactions', `Got ${activities.length} total activities for account ${accountId}`);

    const transactions: Transaction[] = activities.map((activity: any) => {
      // symbol is a nested object: { symbol: "HHIS.TO", description: "...", ... }
      const symbolObj = activity.symbol;
      const symbolStr = symbolObj?.symbol || symbolObj?.raw_symbol || null;
      const description = symbolObj?.description || activity.description || symbolStr || 'Transaction';
      const currency = activity.currency?.code || 'CAD';
      // type is an object: { code: "BUY", description: "Buy" }
      const typeCode = activity.type?.code || activity.type || 'unknown';

      return {
        id: activity.id || randomUUID(),
        symbol: symbolStr,
        description,
        type: typeCode,
        action: typeCode,
        units: activity.units ?? null,
        price: activity.price ?? null,
        amount: activity.amount ?? 0,
        date: activity.trade_date || activity.settlement_date || new Date().toISOString(),
        currencyCode: currency,
      };
    });

    return transactions;

  } catch (err: any) {
    const body = err?.responseBody ?? err?.response?.data;
    const errMsg = body?.detail || err.message || "Failed to fetch transactions";
    logger.warn('Transactions', `Failed to fetch transactions for account ${accountId}: ${errMsg}`);
    return [];
  }
}

export async function refreshAllTransactions(forceRefresh: boolean = false, intervalMs: number = 24 * 60 * 60 * 1000, fullHistory: boolean = false): Promise<{ processedCount: number; errorCount: number }> {
  let processedCount = 0;
  let errorCount = 0;
  try {
    logger.info('Transactions', `Starting transaction refresh cycle${fullHistory ? ' (full history)' : ''}...`);

    const portfolios = listPortfolios();
    let activeAccountIds = getActiveAccountIds();

    for (const portfolio of portfolios) {
      if (!portfolio.userSecret) {
        logger.debug('Transactions', `Skipping portfolio "${portfolio.name}" — not registered`);
        continue;
      }

      try {
        let cachedAccounts = getCachedAccounts(portfolio.id!);

        if (cachedAccounts.length === 0) {
          try {
            logger.info('Transactions', `No cached accounts for portfolio "${portfolio.name}" — proactively fetching from SnapTrade...`);
            const client = getSnapTradeClientForPortfolio(portfolio);
            const accsResponse = await client.accountInformation.listUserAccounts({
              userId: portfolio.userId,
              userSecret: portfolio.userSecret!,
            });
            const fetchedAccounts = Array.isArray(accsResponse.data) ? accsResponse.data : [];
            if (fetchedAccounts.length > 0) {
              saveCachedAccounts(portfolio.id!, fetchedAccounts);
              cachedAccounts = getCachedAccounts(portfolio.id!);
              activeAccountIds = getActiveAccountIds();
            }
          } catch (err: any) {
            const body = err?.responseBody ?? err?.response?.data;
            const errMsg = body?.detail || err.message || "Unknown error";
            logger.warn('Transactions', `Failed to proactively fetch accounts for portfolio "${portfolio.name}": ${errMsg}`);
            errorCount++;
            continue;
          }
        }

        const accountPromises = cachedAccounts.map(async (account) => {
          // Only process active accounts
          if (!activeAccountIds.has(account.id)) {
            logger.debug('Transactions', `Skipping inactive account ${account.id}`);
            return;
          }

          try {
            logger.debug('Transactions', `Processing account ${account.id} from portfolio "${portfolio.name}"`);

            // Check cache TTL (24 hours)
            const timestamps = getAccountFetchTimestamps(account.id);
            const lastFetch = timestamps?.lastTransactionsFetch;
            const lastFetchTime = lastFetch ? new Date(lastFetch.replace(' ', 'T') + 'Z').getTime() : 0;
            const isFresh = lastFetchTime > 0 && (Date.now() - lastFetchTime < intervalMs);

            if (isFresh && !forceRefresh) {
              logger.debug('Transactions', `  Account ${account.id} — cache is fresh, skipping`);
              return;
            }

            // Incremental: if we already have history cached, only fetch since the
            // most recent cached transaction (minus a 7-day overlap for late-posted
            // items). First sync (no cache) — or an explicit fullHistory request
            // (the manual Refresh) — pulls the entire history.
            let sinceDate: string | undefined;
            if (!fullHistory) {
              const latest = getCachedTransactions(account.id, 1)[0];
              if (latest?.date) {
                const d = new Date(latest.date);
                if (!isNaN(d.getTime())) {
                  d.setUTCDate(d.getUTCDate() - 7);
                  sinceDate = d.toISOString().split('T')[0];
                }
              }
            }

            const transactions = await fetchTransactionsForAccount(
              account.id,
              portfolio.id!,
              portfolio.userId,
              portfolio.userSecret,
              sinceDate
            );

            saveCachedTransactions(account.id, transactions);
            processedCount++;
          } catch (err: any) {
            logger.warn('Transactions', `Error processing account ${account.id}: ${err.message}`);
            errorCount++;
          }
        });

        await Promise.all(accountPromises);
      } catch (err: any) {
        logger.warn('Transactions', `Error processing portfolio "${portfolio.name}": ${err.message}`);
        errorCount++;
      }
    }

    logger.info('Transactions', `Transaction refresh complete — processed ${processedCount} account(s), ${errorCount} error(s)`);
  } catch (err: any) {
    logger.error('Transactions', `refreshAllTransactions fatal error: ${err.message}`);
    errorCount++;
  }
  return { processedCount, errorCount };
}
