import { Request, Response } from "express";
import { getPortfolio, savePortfolio, listPortfolios, getCachedAccounts, saveCachedAccounts, getCachedPositions, saveCachedPositions, setAccountActive, getAccountActive, getCachedTransactions } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { getDividendForecastForAccount } from "../services/dividendService.js";
import { refreshAllTransactions } from "../services/transactionService.js";
import { logger } from "../utils/logger.js";

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
    const body = err?.responseBody ?? err?.response?.data;
    const detail = body?.detail || body?.message || "Registration failed";
    logger.error('SnapTrade', `registerUser failed for portfolioId=${portfolioId}: ${detail}`);
    
    const portfolio = getPortfolio(String(portfolioId));
    if (detail.includes("Personal keys can only register one user") && portfolio?.userSecret) {
      logger.warn('SnapTrade', `registerUser — already registered (SnapTrade error), returning existing secret`);
      return res.json({ success: true, userSecret: portfolio.userSecret, cached: true });
    }
    
    res.status(500).json({ error: detail });
  }
};

export const listAccounts = async (req: Request, res: Response) => {
  const forceRefresh = req.query.forceRefresh === 'true';
  const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  logger.info('SnapTrade', `GET /snapTrade/listAccounts — forceRefresh=${forceRefresh}`);

  try {
    const portfolios = listPortfolios();
    logger.info('SnapTrade', `listAccounts — processing ${portfolios.length} portfolio(s)`);
    const results = [];

    for (const portfolio of portfolios) {
      if (!portfolio.userSecret) {
        logger.warn('SnapTrade', `  "${portfolio.name}" — not registered (no userSecret), skipping`);
        results.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          error: "Not registered",
          accounts: []
        });
        continue;
      }

      try {
        // Check cache
        const cached = getCachedAccounts(portfolio.id!);
        const isFresh = cached.length > 0 && (Date.now() - new Date(cached[0].cachedAt).getTime() < TTL_MS);

        if (isFresh && !forceRefresh) {
          logger.info('SnapTrade', `  "${portfolio.name}" — cache HIT (${cached.length} accounts)`);
          results.push({
            portfolioId: portfolio.id,
            portfolioName: portfolio.name,
            accounts: cached.map((row: any) => ({ ...row, isActive: row.isActive === 1 || row.isActive === true })),
            cached: true
          });
          continue;
        }

        logger.info('SnapTrade', `  "${portfolio.name}" — cache MISS, fetching from SnapTrade API...`);
        const client = getSnapTradeClientForPortfolio(portfolio);

        const SNAPTRADE_TIMEOUT_MS = 15000;
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`SnapTrade request timed out after ${SNAPTRADE_TIMEOUT_MS / 1000}s`)), SNAPTRADE_TIMEOUT_MS)
        );

        const response = await Promise.race([
          client.accountInformation.listUserAccounts({
            userId: portfolio.userId,
            userSecret: portfolio.userSecret,
          }),
          timeoutPromise
        ]);

        const accountCount = Array.isArray(response.data) ? response.data.length : 0;
        logger.info('SnapTrade', `  "${portfolio.name}" — received ${accountCount} account(s), saving to cache`);

        // Save to cache (this preserves existing isActive flags for known accounts)
        saveCachedAccounts(portfolio.id!, response.data);

        // Re-read from cache so that isActive flags are embedded in the response
        const merged = getCachedAccounts(portfolio.id!);

        // Attach live data (balance, brokerage) from SnapTrade onto the cached rows
        const liveMap = new Map((response.data as any[]).map((a: any) => [a.id, a]));
        const accountsWithIsActive = merged.map((row: any) => ({
          ...(liveMap.get(row.id) ?? {}),
          isActive: row.isActive === 1 || row.isActive === true,
        }));

        results.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          accounts: accountsWithIsActive,
          cached: false
        });

      } catch (err: any) {
        const body = err?.responseBody ?? err?.response?.data;
        const errMsg = body?.detail || err.message || "Failed to fetch accounts";
        logger.warn('SnapTrade', `  "${portfolio.name}" — failed: ${errMsg}`);
        results.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          error: errMsg,
          accounts: []
        });
      }
    }

    const totalAccounts = results.reduce((s, r) => s + (r.accounts?.length ?? 0), 0);
    logger.info('SnapTrade', `listAccounts complete — ${results.length} portfolio(s), ${totalAccounts} total account(s)`);
    res.json(results);
  } catch (err: any) {
    logger.error('SnapTrade', `listAccounts fatal error: ${err.message}`);
    res.status(500).json({ error: "Failed to fetch portfolios for accounts" });
  }
};

export const getHoldings = async (req: Request, res: Response) => {
  const { portfolioId, accountId } = req.params;
  const forceRefresh = req.query.forceRefresh === 'true';
  const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  logger.info('SnapTrade', `GET /api/holdings — portfolio=${portfolioId} account=${accountId} forceRefresh=${forceRefresh}`);

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!portfolio || !portfolio.userSecret) {
      logger.warn('SnapTrade', `getHoldings — portfolio id=${portfolioId} not found or not registered`);
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }

    // Check if account is active
    const isAccountActive = getAccountActive(String(accountId));
    if (isAccountActive === false) {
      logger.warn('SnapTrade', `getHoldings — account ${accountId} is disabled, skipping sync`);
      return res.status(400).json({ error: "Account is disabled" });
    }

    // Check cache
    const cached = getCachedPositions(String(accountId));
    const isFresh = cached.length > 0 && (Date.now() - new Date(cached[0].cachedAt).getTime() < TTL_MS);

    if (isFresh && !forceRefresh) {
      logger.info('SnapTrade', `getHoldings — cache HIT for account ${accountId} (${cached.length} position(s))`);
      const mapped = cached.map(p => ({
        symbol: { symbol: { symbol: p.symbol }, description: p.description },
        units: p.units,
        price: p.price,
        marketValue: p.marketValue,
        cached: true
      }));
      return res.json(mapped);
    }

    logger.info('SnapTrade', `getHoldings — cache MISS for account ${accountId}, fetching fresh positions...`);
    const client = getSnapTradeClientForPortfolio(portfolio);
    const response = await client.accountInformation.getUserAccountPositions({
      userId: portfolio.userId,
      userSecret: portfolio.userSecret,
      accountId: String(accountId),
    });

    const posCount = Array.isArray(response.data) ? response.data.length : 0;
    logger.info('SnapTrade', `getHoldings — received ${posCount} position(s) for account ${accountId}, saving to cache`);
    saveCachedPositions(String(accountId), response.data);
    res.json(response.data);
  } catch (err: any) {
    const body = err?.responseBody ?? err?.response?.data;
    const detail = body?.detail || body?.message || err.message || "Failed to fetch holdings";
    logger.error('SnapTrade', `getHoldings failed for account ${accountId}: ${detail}`);
    res.status(500).json({ error: detail });
  }
};

export const getLoginLink = async (req: Request, res: Response) => {
  const { portfolioId } = req.body;
  logger.info('SnapTrade', `POST /snapTrade/loginLink — portfolioId=${portfolioId}`);

  if (!portfolioId) {
    logger.warn('SnapTrade', 'getLoginLink — missing portfolioId');
    return res.status(400).json({ error: "Missing portfolioId" });
  }

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!portfolio || !portfolio.userSecret) {
      logger.warn('SnapTrade', `getLoginLink — portfolio id=${portfolioId} not found or not registered`);
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }

    const client = getSnapTradeClientForPortfolio(portfolio);
    logger.info('SnapTrade', `getLoginLink — generating login URL for "${portfolio.name}" (userId: ${portfolio.userId})`);
    const loginResponse = await client.authentication.loginSnapTradeUser({
      userId: portfolio.userId,
      userSecret: portfolio.userSecret,
    });
    
    const data = loginResponse.data as any;
    const loginUrl = `${data.redirectURI || data.redirectUri}&broker=WEALTHSIMPLETRADE`;
    logger.info('SnapTrade', `getLoginLink — generated URL for "${portfolio.name}"`);
    res.json({ loginUrl });
  } catch (err: any) {
    const body = err?.responseBody ?? err?.response?.data;
    const detail = body?.detail || "Login generation failed";
    logger.error('SnapTrade', `getLoginLink failed for portfolioId=${portfolioId}: ${detail}`);
    res.status(500).json({ error: detail });
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

    // Check if account is active
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
    const body = err?.responseBody ?? err?.response?.data;
    const detail = body?.detail || body?.message || err.message || "Failed to generate forecast";
    logger.error('SnapTrade', `getDividendForecast failed for account ${accountId}: ${detail}`);
    res.status(500).json({ error: detail });
  }
};

export const toggleAccountActive = (req: Request, res: Response) => {
  const { accountId } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    logger.warn('SnapTrade', `toggleAccountActive — missing or invalid 'isActive' boolean in body for account ${accountId}`);
    return res.status(400).json({ error: "Body must contain { isActive: boolean }" });
  }

  try {
    setAccountActive(String(accountId), isActive);
    logger.info('SnapTrade', `toggleAccountActive — account ${accountId} set to ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
    res.json({ success: true, accountId, isActive });
  } catch (err: any) {
    logger.error('SnapTrade', `toggleAccountActive failed for ${accountId}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const getTransactions = async (req: Request, res: Response) => {
  console.log('[HANDLER] getTransactions called!');
  const forceRefresh = req.query.forceRefresh === 'true';
  logger.info('SnapTrade', `GET /snapTrade/transactions — forceRefresh=${forceRefresh}`);

  try {
    // Trigger transaction refresh
    await refreshAllTransactions(forceRefresh);

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
          results.push({
            portfolioId: portfolio.id,
            portfolioName: portfolio.name,
            accountId: account.id,
            accountName: account.name,
            transactions: transactions.map((txn: any) => ({
              ...txn,
              portfolioName: portfolio.name,
              accountName: account.name,
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
