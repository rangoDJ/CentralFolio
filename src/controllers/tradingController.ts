import { Request, Response } from "express";
import { getPortfolio, accountBelongsToPortfolio, getAccountActive, getCachedAccounts } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { logger } from "../utils/logger.js";
import { snapTradeError } from "../utils/snapTradeError.js";
import type { TradeOrder } from "../schemas/tradeSchema.js";

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
    const loginUrl = data.redirectURI || data.redirectUri;
    if (!loginUrl) throw new Error('SnapTrade did not return a redirect URL');
    logger.info('SnapTrade', `getTradeLoginLink — generated trade URL for "${portfolio.name}"`);
    res.json({ loginUrl });
  } catch (err: any) {
    const { log, client } = snapTradeError(err, "Trade login generation failed");
    logger.error('SnapTrade', `getTradeLoginLink failed for portfolioId=${portfolioId}: ${log}`);
    res.status(500).json({ error: client });
  }
};

export const placeTrade = async (req: Request, res: Response) => {
  // Body is validated + normalized by validateBody(tradeOrderSchema) on the route.
  const { portfolioId, accountId, ticker, action, orderType, units, notional_value, price, timeInForce } =
    req.body as TradeOrder;

  const unitsNum = units;
  const notionalNum = notional_value;
  // Notional orders are always Day; otherwise honour the requested TIF (default Day).
  const tif = notionalNum != null ? 'Day' : (timeInForce || 'Day');

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
      const accounts = getCachedAccounts(portfolioId);
      const acc = accounts.find(a => a.id === String(accountId));
      const currency = acc?.currency || 'USD';
      orderBody.notional_value = { amount: notionalNum, currency };
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
