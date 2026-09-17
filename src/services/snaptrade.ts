import { Snaptrade, SnaptradeAuth, type CommercialApiKeyAuth } from "snaptrade-typescript-sdk";
import { isPersonalKey, keyTypeOf } from "../utils/snapTradeKeyType.js";
import { listPortfolios, getPortfolio, Portfolio } from "../models/db.js";
import { logger, redactUrl } from "../utils/logger.js";

/**
 * The client type this app passes around.
 *
 * SDK v12 makes the auth mode part of the client's type, but both modes expose
 * the same operations and differ only in whether `userId`/`userSecret` are
 * accepted. The SDK drops those from the wire in personal mode even when they
 * are supplied, so every call site can pass them unconditionally and a single
 * type serves both. Naming it as the commercial type keeps request bodies —
 * order forms especially — fully type-checked at every call site.
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
  // The cache key carries the key type, and the caller does not know which mode
  // the cached client was built in — that may be the very thing being changed.
  // So drop every entry for this portfolio, whichever mode it was cached under.
  const suffix = `:${String(id)}`;
  let dropped = 0;
  for (const key of clientCache.keys()) {
    if (key.endsWith(suffix)) {
      clientCache.delete(key);
      dropped++;
    }
  }
  if (dropped > 0) {
    logger.debug('SnapTrade', `evictSnapTradeClientForPortfolio(${id}) — ${dropped} cached client(s) dropped`);
  }
}

/**
 * Log every outbound call to SnapTrade.
 *
 * Inbound requests to this app were logged; outbound ones were not, so a
 * bucket placing five orders showed the five decisions this app made and
 * nothing about the five calls it actually sent. When a brokerage rejects an
 * order, the log should say that a request went out, where to, and what came
 * back — not just that a catch block ran.
 *
 * Every API group shares one axios instance, so a single pair of interceptors
 * covers accounts, holdings, transactions, trading and connections alike.
 *
 * Only the method, path, status and duration are recorded. The SDK signs
 * requests with the consumer key and puts `userSecret` in the query string, so
 * the URL is redacted, and bodies are never logged — an order's details are
 * already logged by the code that decided to place it.
 */
function attachRequestLogging(client: SnapTradeClient): void {
  const axios = (client as any)?.accountInformation?.axios;
  if (!axios?.interceptors) {
    logger.warn('SnapTrade', 'Could not attach request logging — outbound calls will not appear in the log');
    return;
  }

  axios.interceptors.request.use((config: any) => {
    config.__startedAt = Date.now();
    return config;
  });

  axios.interceptors.response.use(
    (response: any) => {
      const ms = Date.now() - (response.config?.__startedAt ?? Date.now());
      const method = String(response.config?.method ?? 'get').toUpperCase();
      logger.info('SnapTradeAPI', `${method} ${redactUrl(response.config?.url ?? '?')} → ${response.status} (${ms}ms)`);
      return response;
    },
    (error: any) => {
      const ms = Date.now() - (error.config?.__startedAt ?? Date.now());
      const method = String(error.config?.method ?? 'get').toUpperCase();
      const status = error.response?.status ?? 'no response';
      // The brokerage's own reason for refusing, which is the useful part.
      const detail = error.response?.data?.detail ?? error.response?.data?.message ?? error.message ?? '';
      logger.warn('SnapTradeAPI', `${method} ${redactUrl(error.config?.url ?? '?')} → ${status} (${ms}ms) ${detail}`.trim());
      return Promise.reject(error);
    },
  );
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

  // Keyed by mode as well as identity: switching a connection from commercial
  // to personal must not reuse a client signing requests the old way.
  const cacheKey = `${keyTypeOf(portfolio)}:` +
    (portfolio.id ? String(portfolio.id) : `${portfolio.clientId}:${portfolio.consumerKey}`);
  if (!clientCache.has(cacheKey)) {
    logger.debug('SnapTrade', `Building new ${keyTypeOf(portfolio)} client for portfolio "${portfolio.name}" (userId: ${portfolio.userId})`);
    // The auth mode has to match the kind of key: a personal key signs its
    // requests differently and resolves the user from the key itself, so
    // building it as commercial makes every call fail authentication.
    const credentials = { clientId: portfolio.clientId, consumerKey: portfolio.consumerKey };
    const auth = isPersonalKey(portfolio)
      ? SnaptradeAuth.personalApiKey(credentials)
      : SnaptradeAuth.commercialApiKey(credentials);

    const client = new Snaptrade({
      auth,
      baseOptions: {
        timeout: 15000,
      },
    }) as SnapTradeClient;
    attachRequestLogging(client);
    clientCache.set(cacheKey, client);
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

    // Listing and deleting SnapTrade users are commercial-only operations; a
    // personal key has exactly one user, itself, and no API to manage it.
    if (isPersonalKey(p)) {
      logger.debug('SnapTrade', `Skipping "${p.name}" — personal keys have no user list`);
      continue;
    }

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

    if (isPersonalKey(p)) {
      logger.debug('SnapTrade', `Skipping "${p.name}" — a personal key's user cannot be deleted through the API`);
      continue;
    }

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
