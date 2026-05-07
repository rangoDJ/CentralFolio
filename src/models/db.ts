/**
 * Barrel re-export — preserves all existing import paths.
 * New code should import directly from the relevant repository:
 *   import { getPortfolio } from "../repositories/portfolioRepository.js"
 */

export { db as default } from "./database.js";

export type { Portfolio } from "../repositories/portfolioRepository.js";
export {
  listPortfolios,
  getPortfolio,
  savePortfolio,
  deletePortfolio,
  setPortfolioTradingEnabled,
} from "../repositories/portfolioRepository.js";

export {
  getCachedAccounts,
  getActiveAccountIds,
  setAccountActive,
  getAccountActive,
  setAccountCustomName,
  saveCachedAccounts,
  clearAccountCache,
  clearAccountsForPortfolio,
  getCachedPositions,
  saveCachedPositions,
  clearPositionsForAccount,
} from "../repositories/accountRepository.js";

export {
  getCachedDividendMetadata,
  saveCachedDividendMetadata,
  clearDividendMetadataCache,
  getDividendProviders,
  setDividendProviders,
} from "../repositories/dividendRepository.js";

export {
  getSetting,
  setSetting,
  listSettings,
  getPasswordHash,
  setPasswordHash,
  getJwtSecret,
} from "../repositories/settingsRepository.js";

export {
  getCachedTransactions,
  saveCachedTransactions,
  clearTransactionCache,
  clearTransactionsForAccount,
} from "../repositories/transactionRepository.js";

// ── Backward compat ───────────────────────────────────────────────────────────

export { listPortfolios as getSettings_deprecated } from "../repositories/portfolioRepository.js";

/** @deprecated Use listPortfolios() instead */
export function getSettings() {
  const all = listPortfolios();
  return all.length > 0 ? all[0] : null;
}

/** @deprecated Use clearAccountCache() + clearDividendMetadataCache() instead */
export function clearCache() {
  clearAccountCache();
  clearDividendMetadataCache();
}
