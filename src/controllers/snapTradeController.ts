import { Request, Response } from "express";
import { getPortfolio, savePortfolio, listPortfolios, getCachedAccounts, saveCachedAccounts, getCachedPositions, saveCachedPositions, setAccountActive, getAccountActive, accountBelongsToPortfolio, getCachedTransactions, setAccountCustomName } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { getDividendForecastForAccount } from "../services/dividendService.js";
import { refreshAllTransactions } from "../services/transactionService.js";
import { onAccountDeactivated, onBrokerageReconnected } from "../services/cacheService.js";
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
        // Check cache — also treat as miss if balance data is missing (old cache pre-balance migration)
        const cached = getCachedAccounts(portfolio.id!);
        const hasBalance = cached.some((r: any) => r.balance != null);
        const isFresh = cached.length > 0 && hasBalance && (Date.now() - new Date(cached[0].cachedAt).getTime() < TTL_MS);

        if (isFresh && !forceRefresh) {
          logger.info('SnapTrade', `  "${portfolio.name}" — cache HIT (${cached.length} accounts)`);
          // Augment cached accounts with position-based balance where SnapTrade balance is 0
          const augmented = cached.map((acc: any) => {
            const snapAmt = acc.balance?.total?.amount ?? 0;
            if (snapAmt > 0) return acc;
            const positionTotal = getCachedPositions(acc.id).reduce((s: number, p: any) => s + (p.marketValue || 0), 0);
            return { ...acc, balance: { total: { amount: positionTotal, currency: acc.balance?.total?.currency || 'CAD' } } };
          });
          results.push({
            portfolioId: portfolio.id,
            portfolioName: portfolio.name,
            accounts: augmented,
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
        const accountsWithIsActive = merged.map((row: any) => {
          const live = liveMap.get(row.id) ?? {};
          const snapBalance = live.balance?.total?.amount ?? 0;
          // SnapTrade often returns 0 for account balance — fall back to sum of cached positions
          const positionTotal = snapBalance > 0 ? snapBalance
            : getCachedPositions(row.id).reduce((s: number, p: any) => s + (p.marketValue || 0), 0);
          return {
            ...live,
            isActive: row.isActive === 1 || row.isActive === true,
            customName: row.customName || null,
            balance: { total: { amount: positionTotal, currency: live.balance?.total?.currency || 'CAD' } },
          };
        });

        results.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          accounts: accountsWithIsActive,
          cached: false
        });

      } catch (err: any) {
        const { log, client } = snapTradeError(err, "Failed to fetch accounts");
        logger.warn('SnapTrade', `  "${portfolio.name}" — failed: ${log}`);
        results.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          error: client,
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

  logger.info('SnapTrade', `GET /api/holdings — portfolio=${portfolioId} account=${accountId} forceRefresh=${forceRefresh}`);

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!portfolio || !portfolio.userSecret) {
      logger.warn('SnapTrade', `getHoldings — portfolio id=${portfolioId} not found or not registered`);
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }

    if (!accountBelongsToPortfolio(String(accountId), portfolioId)) {
      logger.warn('SnapTrade', `getHoldings — account ${accountId} does not belong to portfolio ${portfolioId}`);
      return res.status(403).json({ error: "Account does not belong to this portfolio" });
    }

    const isAccountActive = getAccountActive(String(accountId));
    if (isAccountActive === false) {
      logger.warn('SnapTrade', `getHoldings — account ${accountId} is disabled`);
      return res.status(400).json({ error: "Account is disabled" });
    }

    if (!forceRefresh) {
      // Serve from cache — background scheduler keeps data fresh
      const cached = getCachedPositions(String(accountId));
      logger.info('SnapTrade', `getHoldings — serving ${cached.length} cached position(s) for account ${accountId}`);
      return res.json(cached.map((p: any) => ({
        symbol: { symbol: { symbol: p.symbol }, description: p.description },
        symbolId: p.symbolId || null,
        units: p.units,
        price: p.price,
        marketValue: p.marketValue,
        cached: true
      })));
    }

    // forceRefresh — fetch live from SnapTrade
    logger.info('SnapTrade', `getHoldings — force refresh for account ${accountId}...`);
    const client = getSnapTradeClientForPortfolio(portfolio);
    const response = await client.accountInformation.getUserAccountPositions({
      userId: portfolio.userId,
      userSecret: portfolio.userSecret,
      accountId: String(accountId),
    });

    const posCount = Array.isArray(response.data) ? response.data.length : 0;
    logger.info('SnapTrade', `getHoldings — received ${posCount} position(s) for account ${accountId}`);
    saveCachedPositions(String(accountId), response.data);
    res.json(response.data);
  } catch (err: any) {
    const { log, client } = snapTradeError(err, "Failed to fetch holdings");
    logger.error('SnapTrade', `getHoldings failed for account ${accountId}: ${log}`);
    res.status(500).json({ error: client });
  }
};

export const getConnectionStatus = async (req: Request, res: Response) => {
  const { portfolioId } = req.params;

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!portfolio || !portfolio.userSecret) {
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }

    const client = getSnapTradeClientForPortfolio(portfolio);
    const response = await client.connections.listBrokerageAuthorizations({
      userId: portfolio.userId,
      userSecret: portfolio.userSecret,
    });

    const auths = Array.isArray(response.data) ? response.data : [];
    // Return the highest-privilege connection type across all authorizations
    const hasTradeAuth = auths.some((a: any) => a.type === 'trade');
    const connectionType = hasTradeAuth ? 'trade' : (auths.length > 0 ? 'read' : 'none');
    logger.info('SnapTrade', `getConnectionStatus — portfolio=${portfolioId} type=${connectionType} (${auths.length} auth(s))`);
    res.json({ connectionType, authorizations: auths.length });
  } catch (err: any) {
    const { log, client } = snapTradeError(err, "Failed to fetch connection status");
    logger.error('SnapTrade', `getConnectionStatus failed for portfolioId=${portfolioId}: ${log}`);
    res.status(500).json({ error: client });
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
    const { log, client } = snapTradeError(err, "Login generation failed");
    logger.error('SnapTrade', `getLoginLink failed for portfolioId=${portfolioId}: ${log}`);
    res.status(500).json({ error: client });
  }
};

export const getTradeLoginLink = async (req: Request, res: Response) => {
  const { portfolioId, redirectUrl } = req.body;
  logger.info('SnapTrade', `POST /snapTrade/loginLink/trade — portfolioId=${portfolioId}`);

  if (!portfolioId) {
    return res.status(400).json({ error: "Missing portfolioId" });
  }

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!portfolio || !portfolio.userSecret) {
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }

    const client = getSnapTradeClientForPortfolio(portfolio);

    // Find the existing authorization ID so SnapTrade upgrades it rather than creating a new read-only one
    let reconnectAuthId: string | undefined;
    try {
      const authsResp = await client.connections.listBrokerageAuthorizations({
        userId: portfolio.userId,
        userSecret: portfolio.userSecret,
      });
      const auths = Array.isArray(authsResp.data) ? authsResp.data : [];
      if (auths.length > 0) reconnectAuthId = (auths[0] as any).id;
      logger.info('SnapTrade', `getTradeLoginLink — reconnecting auth id=${reconnectAuthId ?? 'none'}`);
    } catch (_) { /* proceed without reconnect param */ }

    logger.info('SnapTrade', `getTradeLoginLink — generating trade-enabled URL for "${portfolio.name}"`);
    const loginResponse = await client.authentication.loginSnapTradeUser({
      userId: portfolio.userId,
      userSecret: portfolio.userSecret,
      connectionType: 'trade' as any,
      ...(reconnectAuthId ? { reconnect: reconnectAuthId } : {}),
      ...(redirectUrl ? { customRedirect: String(redirectUrl) } : {}),
    });

    const data = loginResponse.data as any;
    const loginUrl = `${data.redirectURI || data.redirectUri}&broker=WEALTHSIMPLETRADE`;
    logger.info('SnapTrade', `getTradeLoginLink — generated trade URL for "${portfolio.name}"`);
    res.json({ loginUrl });
  } catch (err: any) {
    const { log, client } = snapTradeError(err, "Trade login generation failed");
    logger.error('SnapTrade', `getTradeLoginLink failed for portfolioId=${portfolioId}: ${log}`);
    res.status(500).json({ error: client });
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

export const renameAccount = (req: Request, res: Response) => {
  const { accountId } = req.params;
  const { name } = req.body;

  if (typeof name !== 'string' || !name.trim()) {
    logger.warn('SnapTrade', `renameAccount — missing or invalid 'name' in body for account ${accountId}`);
    return res.status(400).json({ error: "Body must contain { name: string }" });
  }

  if (getAccountActive(String(accountId)) === null) {
    logger.warn('SnapTrade', `renameAccount — account ${accountId} not found`);
    return res.status(404).json({ error: "Account not found" });
  }

  try {
    setAccountCustomName(String(accountId), name.trim());
    logger.info('SnapTrade', `renameAccount — account ${accountId} renamed to "${name.trim()}"`);
    res.json({ success: true, accountId, name: name.trim() });
  } catch (err: any) {
    logger.error('SnapTrade', `renameAccount failed for ${accountId}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const toggleAccountActive = (req: Request, res: Response) => {
  const { accountId } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== 'boolean') {
    logger.warn('SnapTrade', `toggleAccountActive — missing or invalid 'isActive' boolean in body for account ${accountId}`);
    return res.status(400).json({ error: "Body must contain { isActive: boolean }" });
  }

  if (getAccountActive(String(accountId)) === null) {
    logger.warn('SnapTrade', `toggleAccountActive — account ${accountId} not found`);
    return res.status(404).json({ error: "Account not found" });
  }

  try {
    setAccountActive(String(accountId), isActive);
    if (!isActive) {
      onAccountDeactivated(String(accountId));
    }
    logger.info('SnapTrade', `toggleAccountActive — account ${accountId} set to ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
    res.json({ success: true, accountId, isActive });
  } catch (err: any) {
    logger.error('SnapTrade', `toggleAccountActive failed for ${accountId}: ${err.message}`);
    res.status(500).json({ error: err.message });
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
          results.push({
            portfolioId: portfolio.id,
            portfolioName: portfolio.name,
            accountId: account.id,
            accountName: displayName,
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

export const invalidatePortfolioCache = (req: Request, res: Response) => {
  const { portfolioId } = req.params;
  logger.info('SnapTrade', `POST /snapTrade/invalidate-cache/${portfolioId} — frontend-triggered reconnect invalidation`);
  try {
    onBrokerageReconnected(String(portfolioId));
    res.json({ success: true });
  } catch (err: any) {
    logger.error('SnapTrade', `invalidatePortfolioCache failed for ${portfolioId}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

const VALID_ACTIONS     = ['BUY', 'SELL'] as const;
const VALID_ORDER_TYPES = ['Market', 'Limit'] as const;
const VALID_TIF         = ['Day', 'GTC'] as const;

export const placeTrade = async (req: Request, res: Response) => {
  const { portfolioId, accountId, ticker, action, orderType, units, notional_value, price, timeInForce } = req.body;

  if (!portfolioId || !accountId || !ticker || !action || !orderType) {
    logger.warn('SnapTrade', 'placeTrade — missing required fields');
    return res.status(400).json({ error: "Missing required fields: portfolioId, accountId, ticker, action, orderType" });
  }
  if (!units && !notional_value) {
    return res.status(400).json({ error: "Provide either units or notional_value" });
  }
  if (units && notional_value) {
    return res.status(400).json({ error: "Provide units or notional_value, not both" });
  }

  // ── Field validation ───────────────────────────────────────────────────────
  let unitsNum: number | undefined;
  let notionalNum: number | undefined;

  if (units != null) {
    unitsNum = Number(units);
    if (!Number.isFinite(unitsNum) || unitsNum <= 0) {
      return res.status(400).json({ error: "units must be a positive number" });
    }
  } else {
    notionalNum = Number(notional_value);
    if (!Number.isFinite(notionalNum) || notionalNum <= 0) {
      return res.status(400).json({ error: "notional_value must be a positive number" });
    }
    // SnapTrade only supports notional with Market + Day
    if (orderType !== 'Market') {
      return res.status(400).json({ error: "notional_value orders must use orderType Market" });
    }
  }

  if (!(VALID_ACTIONS as readonly string[]).includes(action)) {
    return res.status(400).json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
  }

  if (!(VALID_ORDER_TYPES as readonly string[]).includes(orderType)) {
    return res.status(400).json({ error: `orderType must be one of: ${VALID_ORDER_TYPES.join(', ')}` });
  }

  const tif = notionalNum != null ? 'Day' : (timeInForce || 'Day');
  if (!(VALID_TIF as readonly string[]).includes(tif)) {
    return res.status(400).json({ error: `timeInForce must be one of: ${VALID_TIF.join(', ')}` });
  }

  if (orderType === 'Limit') {
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      return res.status(400).json({ error: "price must be a positive number for Limit orders" });
    }
  }

  if (typeof ticker !== 'string' || !/^[A-Za-z0-9.:\-]{1,20}$/.test(ticker.trim())) {
    return res.status(400).json({ error: "ticker contains invalid characters or is too long" });
  }
  // ──────────────────────────────────────────────────────────────────────────

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!portfolio || !portfolio.userSecret) {
      logger.warn('SnapTrade', `placeTrade — portfolio id=${portfolioId} not found or not registered`);
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }

    if (!portfolio.tradingEnabled) {
      logger.warn('SnapTrade', `placeTrade — trading not enabled for portfolio id=${portfolioId}`);
      return res.status(403).json({ error: "Trading is not enabled for this portfolio" });
    }

    if (!accountBelongsToPortfolio(String(accountId), portfolioId)) {
      logger.warn('SnapTrade', `placeTrade — account ${accountId} does not belong to portfolio ${portfolioId}`);
      return res.status(403).json({ error: "Account does not belong to this portfolio" });
    }

    const client = getSnapTradeClientForPortfolio(portfolio);
    const qtyDesc = notionalNum != null ? `notional=$${notionalNum}` : `${unitsNum} units`;
    logger.info('SnapTrade', `placeTrade — ${action} ${qtyDesc} ticker="${ticker}" account="${accountId}" orderType="${orderType}" tif="${tif}"`);

    const orderBody: any = {
      userId: portfolio.userId,
      userSecret: portfolio.userSecret!,
      account_id: String(accountId),
      action,
      order_type: orderType,
      time_in_force: tif,
      symbol: ticker.trim(),
      universal_symbol_id: null,
    };
    if (notionalNum != null) {
      orderBody.notional_value = { amount: notionalNum, currency: 'USD' };
    } else {
      orderBody.units = unitsNum;
    }
    if (orderType === 'Limit') {
      orderBody.price = Number(price);
    }

    const response = await (client as any).trading.placeForceOrder(orderBody);
    logger.info('SnapTrade', `placeTrade — order placed successfully for account ${accountId}`);
    res.json({ success: true, order: response.data });
  } catch (err: any) {
    const { log, client } = snapTradeError(err, "Order placement failed");
    logger.error('SnapTrade', `placeTrade failed for account ${accountId}: ${log}`);
    res.status(500).json({ error: client });
  }
};
