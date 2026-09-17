import { Snaptrade, SnaptradeAuth, type CommercialApiKeyAuth } from "snaptrade-typescript-sdk";
import { listPortfolios, getPortfolio, Portfolio } from "../models/db.js";
import { logger } from "../utils/logger.js";

/**
 * CentralFolio authenticates with a clientId + consumerKey pair, which SDK v12
 * calls "commercial API key" mode. The mode is part of the client's type, so it
 * is named once here and flows everywhere the client is passed.
 */
export type SnapTradeClient = Snaptrade<CommercialApiKeyAuth>;

const clientCache = new Map<string, SnapTradeClient>();

export function clearSnapTradeClientCache() {
  clientCache.clear();
}

/**
 * Drops the cached client for one portfolio.
 *
 * The cache is keyed by portfolio id, but the client it holds is built from the
 * clientId/consumerKey those credentials had at the time. Editing a portfolio's
 * credentials therefore had no effect until the process restarted: every later
 * call kept signing with the superseded key and SnapTrade kept rejecting it. A
 * single typo in a pasted key became permanent, because correcting it in the UI
 * could not reach the client that was actually making the request.
 */
export function evictSnapTradeClientForPortfolio(id: number | string) {
  if (clientCache.delete(String(id))) {
    logger.debug('SnapTrade', `evictSnapTradeClientForPortfolio(${id}) — cached client dropped`);
  }
}

export function getSnapTradeClientForPortfolio(portfolioOrId?: Portfolio | number | string) {
  let portfolio: Portfolio | null = null;
  
  if (portfolioOrId && typeof portfolioOrId === 'object') {
    portfolio = portfolioOrId;
    logger.debug('SnapTrade', `getSnapTradeClientForPortfolio — using provided Portfolio object: "${portfolio.name}"`);
  } else if (portfolioOrId !== undefined) {
    logger.debug('SnapTrade', `getSnapTradeClientForPortfolio — looking up portfolio id=${portfolioOrId}`);
    portfolio = getPortfolio(portfolioOrId as (string | number));
  } else {
    logger.debug('SnapTrade', `getSnapTradeClientForPortfolio — no id provided, using first portfolio`);
    const all = listPortfolios();
    portfolio = all.length > 0 ? all[0] : null;
  }

  if (!portfolio || !portfolio.clientId || !portfolio.consumerKey) {
    logger.error('SnapTrade', `No valid credentials found for portfolioOrId=${JSON.stringify(portfolioOrId)}`);
    throw new Error("SnapTrade credentials not configured for this portfolio.");
  }

  const cacheKey = portfolio.id ? String(portfolio.id) : `${portfolio.clientId}:${portfolio.consumerKey}`;
  if (!clientCache.has(cacheKey)) {
    logger.debug('SnapTrade', `Building new client instance for portfolio "${portfolio.name}" (userId: ${portfolio.userId})`);
    clientCache.set(cacheKey, new Snaptrade({
      // v12 moved the credentials behind an explicit auth mode; they used to sit
      // at the top level of the config object.
      auth: SnaptradeAuth.commercialApiKey({
        clientId: portfolio.clientId,
        consumerKey: portfolio.consumerKey,
      }),
      baseOptions: {
        timeout: 15000,
      },
    }));
  } else {
    logger.debug('SnapTrade', `Reusing cached client instance for portfolio "${portfolio.name}"`);
  }

  return clientCache.get(cacheKey)!;
}

export async function listAllUsersAcrossPortfolios() {
  const portfolios = listPortfolios();
  logger.info('SnapTrade', `listAllUsersAcrossPortfolios — scanning ${portfolios.length} portfolio(s)`);
  const allUsers = new Set<string>();
  
  // Get unique pairs of (clientId, consumerKey) to avoid redundant calls to the same SnapTrade account
  const seenPairs = new Set<string>();

  for (const p of portfolios) {
    const pairKey = `${p.clientId}:${p.consumerKey}`;
    if (seenPairs.has(pairKey)) {
      logger.debug('SnapTrade', `Skipping duplicate credentials for portfolio "${p.name}"`);
      continue;
    }
    seenPairs.add(pairKey);

    try {
      logger.info('SnapTrade', `Listing users for portfolio "${p.name}"...`);
      const client = getSnapTradeClientForPortfolio(p);
      const response = await client.authentication.listSnapTradeUsers();
      const users = Array.isArray(response.data) ? response.data : [];
      logger.info('SnapTrade', `  → Found ${users.length} user(s) in "${p.name}"`);
      users.forEach(u => allUsers.add(u));
    } catch (err: any) {
      const body = err?.responseBody ?? err?.response?.data;
      logger.warn('SnapTrade', `Could not list users for portfolio "${p.name}": ${body?.detail || err.message}`);
    }
  }

  logger.info('SnapTrade', `listAllUsersAcrossPortfolios → ${allUsers.size} unique user(s) total`);
  return Array.from(allUsers);
}

export async function deleteUserFromPortfolios(userId: string) {
  const portfolios = listPortfolios();
  logger.info('SnapTrade', `deleteUserFromPortfolios("${userId}") — checking ${portfolios.length} portfolio(s)`);
  let deleted = false;
  let lastError: any = null;

  // Again, use unique pairs to avoid duplicate delete calls (though SnapTrade might handle it)
  const seenPairs = new Set<string>();

  for (const p of portfolios) {
    const pairKey = `${p.clientId}:${p.consumerKey}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    try {
      logger.info('SnapTrade', `Deleting user "${userId}" from portfolio "${p.name}"...`);
      const client = getSnapTradeClientForPortfolio(p);
      await client.authentication.deleteSnapTradeUser({ userId });
      deleted = true;
      logger.info('SnapTrade', `  → Deleted successfully from "${p.name}"`);
    } catch (err: any) {
      lastError = err;
      const body = err?.responseBody ?? err?.response?.data;
      logger.warn('SnapTrade', `  → Delete failed in "${p.name}": ${body?.detail || err.message}`);
    }
  }
  
  if (!deleted && lastError) {
    const body = lastError?.responseBody ?? lastError?.response?.data;
    logger.error('SnapTrade', `deleteSnapTradeUser failed for "${userId}": ${body?.detail || lastError.message}`);
    throw lastError;
  }
  return { success: deleted };
}

/**
 * Positions held in one account.
 *
 * SDK v12 removed `getUserAccountPositions`, which returned the positions
 * array directly. Its replacement, `getUserHoldings`, returns the whole
 * holdings payload with the positions nested inside and nullable. Unwrapping
 * it here keeps that detail in one place, and keeps every caller's contract —
 * an array of positions — unchanged.
 */
export async function fetchAccountPositions(
  portfolio: Portfolio,
  accountId: string,
): Promise<any[]> {
  const client = getSnapTradeClientForPortfolio(portfolio);
  const response = await client.accountInformation.getUserHoldings({
    userId: portfolio.userId,
    userSecret: portfolio.userSecret!,
    accountId: String(accountId),
  });
  return response.data?.positions ?? [];
}
