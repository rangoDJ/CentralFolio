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
  accountBelongsToPortfolio,
  setAccountCustomName,
  saveCachedAccounts,
  clearAccountCache,
  clearAccountsForPortfolio,
  getCachedPositions,
  saveCachedPositions,
  clearPositionsForAccount,
  getAccountFetchTimestamps,
  updateLastPositionsFetch,
} from "../repositories/accountRepository.js";

export {
  getCachedDividendMetadata,
  saveCachedDividendMetadata,
  getAllCachedDividendMetadata,
  deleteCachedDividendMetadata,
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
  clearJwtSecretCache,
} from "../repositories/settingsRepository.js";

export {
  getCachedTransactions,
  saveCachedTransactions,
  clearTransactionCache,
  clearTransactionsForAccount,
} from "../repositories/transactionRepository.js";

export {
  getPortfolioTargets,
  setPortfolioTargets,
} from "../repositories/rebalanceRepository.js";

export {
  getJobState,
  saveJobState,
  addJobRun,
  getJobRuns,
} from "../repositories/jobRepository.js";

