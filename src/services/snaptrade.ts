import { Snaptrade } from "snaptrade-typescript-sdk";
import { listPortfolios, getPortfolio, Portfolio } from "../models/db.js";
import { logger } from "../utils/logger.js";

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

  logger.debug('SnapTrade', `Built client for portfolio "${portfolio.name}" (userId: ${portfolio.userId})`);
  return new Snaptrade({
    clientId: portfolio.clientId,
    consumerKey: portfolio.consumerKey,
    baseOptions: {
      timeout: 15000,
    },
  });
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
