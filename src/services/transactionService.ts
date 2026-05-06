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

    // SnapTrade API returns activities (transactions)
    const response = await client.accountInformation.getUserAccount({
      userId: userId,
      userSecret: userSecret,
      accountId: accountId,
    });

    const account = response.data;

    if (!account || !account.id) {
      logger.warn('Transactions', `Account ${accountId} not found in SnapTrade response`);
      return [];
    }

    // Try to fetch activities/transactions
    let transactions: Transaction[] = [];

    // Check if account has activities data
    if (account.activities && Array.isArray(account.activities)) {
      logger.info('Transactions', `Found ${account.activities.length} activities for account ${accountId}`);

      transactions = account.activities.map((activity: any) => ({
        id: activity.id || `${accountId}-${Date.now()}-${Math.random()}`,
        symbol: activity.symbol,
        description: activity.description || activity.symbol || 'Transaction',
        type: activity.type || 'unknown',
        action: activity.action || 'unknown',
        units: activity.units || 0,
        price: activity.price || 0,
        amount: activity.amount || activity.price * activity.units || 0,
        date: activity.date || new Date().toISOString(),
        currencyCode: activity.currencyCode || 'CAD'
      }));
    } else {
      logger.debug('Transactions', `No activities data available for account ${accountId}`);
    }

    logger.info('Transactions', `Fetched ${transactions.length} transaction(s) for account ${accountId}`);
    return transactions;

  } catch (err: any) {
    const body = err?.responseBody ?? err?.response?.data;
    const errMsg = body?.detail || err.message || "Failed to fetch transactions";
    logger.warn('Transactions', `Failed to fetch transactions for account ${accountId}: ${errMsg}`);
    return [];
  }
}

export async function refreshAllTransactions(forceRefresh: boolean = false): Promise<void> {
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
            const isFresh = cachedTxns.length > 0 && (Date.now() - new Date(cachedTxns[0].cachedAt).getTime() < 24 * 60 * 60 * 1000);

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
