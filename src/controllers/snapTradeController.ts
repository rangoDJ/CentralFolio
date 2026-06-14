import { Request, Response } from "express";
import { getPortfolio, savePortfolio, listPortfolios, getCachedAccounts, getCachedPositions, getCachedTransactions, accountBelongsToPortfolio, getAccountActive } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { getDividendForecastForAccount } from "../services/dividendService.js";
import { refreshAllTransactions } from "../services/transactionService.js";
import { logger } from "../utils/logger.js";

/**
 * Extracts a safe client-facing message from a SnapTrade SDK error.
 * Logs the full detail server-side; never returns raw SDK internals to the client.
 */
function snapTradeError(err: any, clientFallback: string): { log: string; client: string } {
  const body = err?.responseBody ?? err?.response?.data;
  const log = body?.detail || body?.message || err?.message || 'unknown error';
  const client = body?.detail || clientFallback;
  return { log, client };
}

export const registerUser = async (req: Request, res: Response) => {
  const { portfolioId } = req.body;
  logger.info('SnapTrade', `POST /snapTrade/registerUser — portfolioId=${portfolioId}`);

  if (!portfolioId) {
    logger.warn('SnapTrade', 'registerUser — missing portfolioId in body');
    return res.status(400).json({ error: "Missing portfolioId" });
  }

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!portfolio) {
      logger.warn('SnapTrade', `registerUser — portfolio id=${portfolioId} not found`);
      return res.status(404).json({ error: "Portfolio not found" });
    }

    if (portfolio.userSecret) {
      logger.info('SnapTrade', `registerUser — "${portfolio.name}" already registered, returning cached secret`);
      return res.json({ success: true, userSecret: portfolio.userSecret, cached: true });
    }

    const client = getSnapTradeClientForPortfolio(portfolio);
    logger.info('SnapTrade', `Registering user "${portfolio.userId}" for portfolio "${portfolio.name}"...`);
    const registerResponse = await client.authentication.registerSnapTradeUser({
      userId: portfolio.userId,
    });

    const userSecret = registerResponse.data.userSecret;
    savePortfolio({ ...portfolio, userSecret });
    logger.info('SnapTrade', `registerUser — "${portfolio.name}" registered successfully`);

    res.json({ success: true, userSecret });
  } catch (err: any) {
    const { log, client } = snapTradeError(err, "Registration failed");
    logger.error('SnapTrade', `registerUser failed for portfolioId=${portfolioId}: ${log}`);

    const portfolio = getPortfolio(String(portfolioId));
    if (log.includes("Personal keys can only register one user") && portfolio?.userSecret) {
      logger.warn('SnapTrade', `registerUser — already registered (SnapTrade error), returning existing secret`);
      return res.json({ success: true, userSecret: portfolio.userSecret, cached: true });
    }

    res.status(500).json({ error: client });
  }
};

export const getTransactions = async (req: Request, res: Response) => {
  const forceRefresh = req.query.forceRefresh === 'true';
  logger.info('SnapTrade', `GET /snapTrade/transactions — forceRefresh=${forceRefresh}`);

  try {
    // Only hit SnapTrade on forceRefresh — otherwise serve from cache
    if (forceRefresh) {
      await refreshAllTransactions(true);
    }

    const portfolios = listPortfolios();
    const results = [];

    for (const portfolio of portfolios) {
      if (!portfolio.userSecret) {
        logger.debug('SnapTrade', `  "${portfolio.name}" — not registered, skipping`);
        continue;
      }

      try {
        const cachedAccounts = getCachedAccounts(portfolio.id!);

        for (const account of cachedAccounts) {
          const transactions = getCachedTransactions(account.id);
          const displayName = account.customName || account.name;

          // Build symbol → units map from cached positions so the frontend
          // can infer share count for dividend rows where SnapTrade omits it
          const positions = getCachedPositions(account.id);
          const positionsBySymbol: Record<string, number> = {};
          for (const p of positions) {
            if (p.symbol && p.units != null) positionsBySymbol[p.symbol] = p.units;
          }

          results.push({
            portfolioId: portfolio.id,
            portfolioName: portfolio.name,
            accountId: account.id,
            accountName: displayName,
            positionsBySymbol,
            transactions: transactions.map((txn: any) => ({
              ...txn,
              portfolioName: portfolio.name,
              accountName: displayName,
              accountId: account.id
            }))
          });
        }
      } catch (err: any) {
        logger.warn('SnapTrade', `Error fetching transactions for portfolio "${portfolio.name}": ${err.message}`);
      }
    }

    const totalTransactions = results.reduce((sum, r) => sum + (r.transactions?.length ?? 0), 0);
    logger.info('SnapTrade', `getTransactions complete — ${totalTransactions} total transaction(s)`);
    res.json(results);
  } catch (err: any) {
    logger.error('SnapTrade', `getTransactions fatal error: ${err.message}`);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
};

export const getDividendForecast = async (req: Request, res: Response) => {
  const { portfolioId, accountId } = req.params;
  const forceRefresh = req.query.forceRefresh === 'true';
  logger.info('SnapTrade', `GET /api/dividends/forecast — portfolio=${portfolioId} account=${accountId} forceRefresh=${forceRefresh}`);

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!portfolio || !portfolio.userSecret) {
      logger.warn('SnapTrade', `getDividendForecast — portfolio id=${portfolioId} not found or not registered`);
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }

    if (!accountBelongsToPortfolio(String(accountId), portfolioId)) {
      logger.warn('SnapTrade', `getDividendForecast — account ${accountId} does not belong to portfolio ${portfolioId}`);
      return res.status(403).json({ error: "Account does not belong to this portfolio" });
    }

    const isAccountActive = getAccountActive(String(accountId));
    if (isAccountActive === false) {
      logger.warn('SnapTrade', `getDividendForecast — account ${accountId} is disabled, skipping forecast`);
      return res.status(400).json({ error: "Account is disabled" });
    }

    const start = Date.now();
    const forecast = await getDividendForecastForAccount(portfolio, String(accountId), forceRefresh);

    logger.info('SnapTrade', `getDividendForecast — ${forecast.length} event(s) for account ${accountId} in ${Date.now() - start}ms`);
    res.json(forecast);
  } catch (err: any) {
    const { log, client } = snapTradeError(err, "Failed to generate forecast");
    logger.error('SnapTrade', `getDividendForecast failed for account ${accountId}: ${log}`);
    res.status(500).json({ error: client });
  }
};
