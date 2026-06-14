import { Request, Response } from "express";
import { getPortfolio } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { onBrokerageReconnected } from "../services/cacheService.js";
import { logger } from "../utils/logger.js";
import { snapTradeError } from "../utils/snapTradeError.js";

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
    const loginUrl = data.redirectURI || data.redirectUri;
    if (!loginUrl) throw new Error('SnapTrade did not return a redirect URL');
    logger.info('SnapTrade', `getLoginLink — generated URL for "${portfolio.name}"`);
    res.json({ loginUrl });
  } catch (err: any) {
    const { log, client } = snapTradeError(err, "Login generation failed");
    logger.error('SnapTrade', `getLoginLink failed for portfolioId=${portfolioId}: ${log}`);
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
