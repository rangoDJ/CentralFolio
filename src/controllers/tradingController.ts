import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { getPortfolio, accountBelongsToPortfolio, getAccountActive, getCachedAccounts } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { placeBrokerageOrder } from "../services/orderPlacement.js";
import { refreshAccountBalances } from "../services/accountBalanceService.js";
import { checkOrderCash } from "../services/cashCheck.js";
import { logger } from "../utils/logger.js";
import { isPortfolioConnected } from "../utils/snapTradeKeyType.js";
import { snapTradeError } from "../utils/snapTradeError.js";
import { safeRedirect } from "../utils/safeRedirect.js";
import type { TradeOrder } from "../schemas/tradeSchema.js";

// Orders are staged on a POST (preview), then actually placed only on a second
// POST with the returned confirmation token. This ensures a live financial
// order is never the direct, unintended result of a single request.
const CONFIRM_TTL_MS = 60_000;
const pendingOrders = new Map<string, { order: TradeOrder; portfolioId: string; expiresAt: number }>();

function prunePendingOrders(now: number) {
  for (const [key, p] of pendingOrders) {
    if (now > p.expiresAt) pendingOrders.delete(key);
  }
}

export const getTradeLoginLink = async (req: Request, res: Response) => {
  const { portfolioId, redirectUrl } = req.body;
  logger.info('SnapTrade', `POST /snapTrade/loginLink/trade — portfolioId=${portfolioId}`);

  if (!portfolioId) {
    return res.status(400).json({ error: "Missing portfolioId" });
  }

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!isPortfolioConnected(portfolio)) {
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

    const customRedirect = safeRedirect(req, redirectUrl);
    if (redirectUrl && !customRedirect) {
      logger.warn('SnapTrade', `getTradeLoginLink — rejected redirectUrl (host does not match ${req.hostname})`);
    }

    logger.info('SnapTrade', `getTradeLoginLink — generating trade-enabled URL for "${portfolio.name}"`);
    const loginResponse = await client.authentication.loginSnapTradeUser({
      userId: portfolio.userId,
      userSecret: portfolio.userSecret,
      connectionType: 'trade' as any,
      ...(reconnectAuthId ? { reconnect: reconnectAuthId } : {}),
      ...(customRedirect ? { customRedirect, immediateRedirect: true } : {}),
    });

    const data = loginResponse.data as any;
    const loginUrl = data.redirectURI || data.redirectUri;
    if (!loginUrl) throw new Error('SnapTrade did not return a redirect URL');
    logger.info('SnapTrade', `getTradeLoginLink — generated trade URL for "${portfolio.name}"`);
    res.json({ loginUrl });
  } catch (err: any) {
    const { log, client, status } = snapTradeError(err, "Trade login generation failed");
    logger.error('SnapTrade', `getTradeLoginLink failed for portfolioId=${portfolioId}: ${log}`);
    res.status(status).json({ error: client });
  }
};

export const placeTrade = async (req: Request, res: Response) => {
  // Body is validated + normalized by validateBody(tradeOrderSchema) on the route.
  const { portfolioId, accountId, ticker, action, orderType, units, notional_value, price, timeInForce } =
    req.body as TradeOrder;

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!isPortfolioConnected(portfolio)) {
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

    // Re-read the balance from the broker before staging. Same rule as a bucket
    // run: the funding decision is never made on a cached figure, and a balance
    // that cannot be verified is not treated as sufficient.
    const balances = await refreshAccountBalances([String(portfolioId)]);
    if (balances.failures.length > 0) {
      logger.warn('SnapTrade', `placeTrade — balance check failed for portfolio ${portfolioId}, nothing staged`);
      return res.status(502).json({
        error: "Could not verify your cash balance with the brokerage, so no order was placed. " +
               balances.failures.map(f => f.error).join("; "),
        balanceCheckFailed: true,
      });
    }

    const cash = checkOrderCash({
      portfolioId, accountId: String(accountId), symbol: ticker,
      action, orderType, units, notionalValue: notional_value, price,
    });
    if (!cash.sufficient) {
      logger.warn('SnapTrade', `placeTrade — insufficient cash in ${accountId}, nothing staged`);
      return res.status(400).json({ error: cash.message, insufficientCash: true, cashCheck: cash });
    }

    // Step 1 — stage the order and hand back a confirmation token. The order is
    // placed only after /trade/confirm is called with that token (TTL-bound).
    const now = Date.now();
    prunePendingOrders(now);
    const order: TradeOrder = { portfolioId, accountId, ticker, action, orderType, units, notional_value, price, timeInForce };
    const confirmationToken = randomUUID();
    pendingOrders.set(confirmationToken, { order, portfolioId: String(portfolioId), expiresAt: now + CONFIRM_TTL_MS });

    const qtyDesc = notional_value != null ? `notional=$${notional_value}` : `${units} units`;
    logger.info('SnapTrade', `placeTrade — staged ${action} ${qtyDesc} ticker="${ticker}" account="${accountId}" awaiting confirmation`);
    res.json({
      success: true,
      requiresConfirmation: true,
      confirmationToken,
      preview: { portfolioId, accountId, ticker: ticker.trim(), action, orderType, units, notional_value, price },
      cashCheck: cash,
    });
  } catch (err: any) {
    const { log, status } = snapTradeError(err, "Order staging failed");
    logger.error('SnapTrade', `placeTrade failed for account ${accountId}: ${log}`);
    res.status(status).json({ error: "Failed to stage order" });
  }
};

export const confirmTrade = async (req: Request, res: Response) => {
  const { confirmationToken } = req.body;
  const now = Date.now();
  prunePendingOrders(now);

  const pending = confirmationToken ? pendingOrders.get(confirmationToken) : undefined;
  if (!pending || now > pending.expiresAt) {
    return res.status(400).json({ error: "Confirmation token missing, expired, or already used" });
  }

  const { order, portfolioId } = pending;
  const { accountId, ticker, action, orderType, units, notional_value, price, timeInForce } = order;
  pendingOrders.delete(confirmationToken); // single-use

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!isPortfolioConnected(portfolio)) {
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }
    if (!portfolio.tradingEnabled) {
      return res.status(403).json({ error: "Trading is not enabled for this portfolio" });
    }
    if (!accountBelongsToPortfolio(String(accountId), portfolioId)) {
      return res.status(403).json({ error: "Account does not belong to this portfolio" });
    }

    const placed = await placeBrokerageOrder(portfolio, {
      accountId: String(accountId),
      symbol: ticker,
      action,
      orderType,
      timeInForce,
      units,
      notionalValue: notional_value,
      price,
    });
    logger.info('SnapTrade', `placeTrade — order placed successfully for account ${accountId}`);
    res.json({ success: true, order: placed });
  } catch (err: any) {
    const { log, client, status } = snapTradeError(err, "Order placement failed");
    logger.error('SnapTrade', `placeTrade failed for account ${accountId}: ${log}`);
    res.status(status).json({ error: client });
  }
};
