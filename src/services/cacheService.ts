import { getCachedAccounts, clearAccountsForPortfolio, clearPositionsForAccount, clearAccountCache } from "../repositories/accountRepository.js";
import { clearTransactionsForAccount, clearTransactionCache } from "../repositories/transactionRepository.js";
import { clearDividendMetadataCache } from "../repositories/dividendRepository.js";
import { clearDividendMemoryCache } from "./dividendService.js";
import { logger } from "../utils/logger.js";

/**
 * Called after a portfolio row is deleted.
 * Purges all cached accounts, positions, and transactions that belonged to it.
 */
export function onPortfolioDeleted(portfolioId: number | string) {
  logger.info('Cache', `onPortfolioDeleted(portfolio=${portfolioId}) — purging related caches`);
  const accounts = getCachedAccounts(portfolioId);
  for (const acc of accounts) {
    clearTransactionsForAccount(acc.id);
  }
  clearAccountsForPortfolio(portfolioId);
  logger.info('Cache', `onPortfolioDeleted — cleared ${accounts.length} account(s) with their positions and transactions`);
}

/**
 * Called when an account is toggled inactive.
 * Clears stale positions and transactions so the scheduler picks fresh data if it's ever re-activated.
 */
export function onAccountDeactivated(accountId: string) {
  logger.info('Cache', `onAccountDeactivated(account=${accountId}) — clearing positions and transactions`);
  clearPositionsForAccount(accountId);
  clearTransactionsForAccount(accountId);
}

/**
 * Called after a brokerage reconnect completes.
 * Forces fresh account and position data on next load by wiping the portfolio's cached accounts.
 */
export function onBrokerageReconnected(portfolioId: number | string) {
  logger.info('Cache', `onBrokerageReconnected(portfolio=${portfolioId}) — invalidating account and position caches`);
  const accounts = getCachedAccounts(portfolioId);
  for (const acc of accounts) {
    clearPositionsForAccount(acc.id);
    clearTransactionsForAccount(acc.id);
  }
  clearAccountsForPortfolio(portfolioId);
  logger.info('Cache', `onBrokerageReconnected — cleared ${accounts.length} account(s)`);
}

/**
 * Nuclear option — wipes every cache tier including in-memory dividend state.
 * Exposed via the admin API for emergency resets.
 */
export function clearAllCaches() {
  logger.warn('Cache', 'clearAllCaches() — wiping ALL caches');
  clearAccountCache();
  clearTransactionCache();
  clearDividendMetadataCache();
  clearDividendMemoryCache();
  logger.warn('Cache', 'clearAllCaches() — done');
}
