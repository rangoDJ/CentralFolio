import { Snaptrade } from "snaptrade-typescript-sdk";
import { listPortfolios, getPortfolio, Portfolio } from "../models/db.js";

export function getSnapTradeClientForPortfolio(portfolioOrId?: Portfolio | number | string) {
  let portfolio: Portfolio | null = null;
  
  if (portfolioOrId && typeof portfolioOrId === 'object') {
    portfolio = portfolioOrId;
  } else if (portfolioOrId !== undefined) {
    portfolio = getPortfolio(portfolioOrId);
  } else {
    const all = listPortfolios();
    portfolio = all.length > 0 ? all[0] : null;
  }

  if (!portfolio || !portfolio.clientId || !portfolio.consumerKey) {
    throw new Error("SnapTrade credentials not configured for this portfolio.");
  }

  return new Snaptrade({
    clientId: portfolio.clientId,
    consumerKey: portfolio.consumerKey,
  });
}

export async function listAllUsersAcrossPortfolios() {
  const portfolios = listPortfolios();
  const allUsers = new Set<string>();
  
  // Get unique pairs of (clientId, consumerKey) to avoid redundant calls to the same SnapTrade account
  const seenPairs = new Set<string>();

  for (const p of portfolios) {
    const pairKey = `${p.clientId}:${p.consumerKey}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    try {
      const client = getSnapTradeClientForPortfolio(p);
      const response = await client.authentication.listSnapTradeUsers();
      if (Array.isArray(response.data)) {
        response.data.forEach(u => allUsers.add(u));
      }
    } catch (err: any) {
      const body = err?.responseBody ?? err?.response?.data;
      console.warn(`Could not list users for portfolio "${p.name}":`, body || err.message);
    }
  }
  return Array.from(allUsers);
}

export async function deleteUserFromPortfolios(userId: string) {
  const portfolios = listPortfolios();
  let deleted = false;
  let lastError: any = null;

  // Again, use unique pairs to avoid duplicate delete calls (though SnapTrade might handle it)
  const seenPairs = new Set<string>();

  for (const p of portfolios) {
    const pairKey = `${p.clientId}:${p.consumerKey}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    try {
      const client = getSnapTradeClientForPortfolio(p);
      await client.authentication.deleteSnapTradeUser({ userId });
      deleted = true;
    } catch (err: any) {
      lastError = err;
    }
  }
  
  if (!deleted && lastError) {
    const body = lastError?.responseBody ?? lastError?.response?.data;
    console.error(`SDK deleteSnapTradeUser failed for ${userId}:`, body || lastError.message);
    throw lastError;
  }
  return { success: deleted };
}
