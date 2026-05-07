import { getCachedAccounts, getCachedTransactions, saveCachedTransactions, getActiveAccountIds, listPortfolios } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "./snaptrade.js";
import { logger } from "../utils/logger.js";

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
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchTransactionsForAccount(accountId: string, portfolioId: number | string, userId: string, userSecret: string): Promise<Transaction[]> {
  try {
    logger.info('Transactions', `Fetching transactions for account=${accountId}...`);

    const client = getSnapTradeClientForPortfolio(portfolioId);

    // Use date range: last 2 years — SnapTrade recommends providing startDate/endDate
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const response = await client.accountInformation.getAccountActivities({
      accountId,
      userId,
      userSecret,
      startDate,
      endDate,
    });

    // Response shape: { data: [...], pagination: { total_count, limit, offset } }
    const raw = response.data as any;
    const activities = Array.isArray(raw) ? raw : (raw?.data ?? raw?.activities ?? []);
    logger.info('Transactions', `Got ${activities.length} activities for account ${accountId} (startDate=${startDate}, endDate=${endDate}, total=${raw?.pagination?.total_count ?? raw?.totalCount ?? 'N/A'})`);

    const transactions: Transaction[] = activities.map((activity: any) => {
      // symbol is a nested object: { symbol: "HHIS.TO", description: "...", ... }
      const symbolObj = activity.symbol;
      const symbolStr = symbolObj?.symbol || symbolObj?.raw_symbol || null;
      const description = symbolObj?.description || activity.description || symbolStr || 'Transaction';
      const currency = activity.currency?.code || 'CAD';
      // type is an object: { code: "BUY", description: "Buy" }
      const typeCode = activity.type?.code || activity.type || 'unknown';

      return {
        id: activity.id || `${accountId}-${Date.now()}-${Math.random()}`,
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

export async function refreshAllTransactions(forceRefresh: boolean = false, intervalMs: number = 24 * 60 * 60 * 1000): Promise<void> {
  try {
    logger.info('Transactions', 'Starting transaction refresh cycle...');

    const portfolios = listPortfolios();
    const activeAccountIds = getActiveAccountIds();

    let processedCount = 0;
    let errorCount = 0;

    for (const portfolio of portfolios) {
      if (!portfolio.userSecret) {
        logger.debug('Transactions', `Skipping portfolio "${portfolio.name}" — not registered`);
        continue;
      }

      try {
        const cachedAccounts = getCachedAccounts(portfolio.id!);

        for (const account of cachedAccounts) {
          // Only process active accounts
          if (!activeAccountIds.has(account.id)) {
            logger.debug('Transactions', `Skipping inactive account ${account.id}`);
            continue;
          }

          try {
            logger.debug('Transactions', `Processing account ${account.id} from portfolio "${portfolio.name}"`);

            // Check cache TTL (24 hours)
            const cachedTxns = getCachedTransactions(account.id);
            const isFresh = cachedTxns.length > 0 && (Date.now() - new Date(cachedTxns[0].cachedAt).getTime() < intervalMs);

            if (isFresh && !forceRefresh) {
              logger.debug('Transactions', `  Account ${account.id} — cache is fresh, skipping`);
              continue;
            }

            const transactions = await fetchTransactionsForAccount(
              account.id,
              portfolio.id!,
              portfolio.userId,
              portfolio.userSecret
            );

            if (transactions.length > 0) {
              saveCachedTransactions(account.id, transactions);
              processedCount++;
            }

            // Rate limiting - avoid hammering SnapTrade API
            await sleep(100);

          } catch (err: any) {
            logger.warn('Transactions', `Error processing account ${account.id}: ${err.message}`);
            errorCount++;
          }
        }
      } catch (err: any) {
        logger.warn('Transactions', `Error processing portfolio "${portfolio.name}": ${err.message}`);
        errorCount++;
      }
    }

    logger.info('Transactions', `Transaction refresh complete — processed ${processedCount} account(s), ${errorCount} error(s)`);
  } catch (err: any) {
    logger.error('Transactions', `refreshAllTransactions fatal error: ${err.message}`);
  }
}
