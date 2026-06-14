import { Request, Response } from "express";
import { getPortfolio, accountBelongsToPortfolio, getAccountActive, getCachedPositions, saveCachedPositions, getCachedAccounts, saveCachedAccounts } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { logger } from "../utils/logger.js";
import { SNAPTRADE_CACHE_TTL_MS } from "../utils/constants.js";
import { listPortfolios } from "../models/db.js";
import { snapTradeError } from "../utils/snapTradeError.js";

export const listAccounts = async (req: Request, res: Response) => {
  const forceRefresh = req.query.forceRefresh === 'true';
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
        const isFresh = cached.length > 0 && hasBalance && (Date.now() - new Date(cached[0].cachedAt).getTime() < SNAPTRADE_CACHE_TTL_MS);

        if (isFresh && !forceRefresh) {
          logger.info('SnapTrade', `  "${portfolio.name}" — cache HIT (${cached.length} accounts)`);
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

        const response = await client.accountInformation.listUserAccounts({
          userId: portfolio.userId,
          userSecret: portfolio.userSecret,
        });

        const accountCount = Array.isArray(response.data) ? response.data.length : 0;
        logger.info('SnapTrade', `  "${portfolio.name}" — received ${accountCount} account(s), saving to cache`);

        saveCachedAccounts(portfolio.id!, response.data);
        const merged = getCachedAccounts(portfolio.id!);
        const liveMap = new Map((response.data as any[]).map((a: any) => [a.id, a]));
        const accountsWithIsActive = merged.map((row: any) => {
          const live = liveMap.get(row.id) ?? {};
          const snapBalance = live.balance?.total?.amount ?? 0;
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
