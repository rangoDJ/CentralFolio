import { Request, Response } from "express";
import { getOrders, cancelOrder } from "../services/orderHistoryService.js";
import { getPortfolio, accountBelongsToPortfolio } from "../models/db.js";
import { logger } from "../utils/logger.js";
import { isPortfolioConnected } from "../utils/snapTradeKeyType.js";
import { snapTradeError } from "../utils/snapTradeError.js";

interface ValidatedCancelBody {
  portfolioId: string;
  accountId: string;
  brokerageOrderId: string;
}

export const listOrdersHandler = async (req: Request, res: Response) => {
  const state = req.query.state === "open" || req.query.state === "executed" ? req.query.state : "all";
  const days = Number(req.query.days);

  try {
    res.json(await getOrders({
      state,
      days: Number.isFinite(days) && days > 0 ? days : undefined,
    }));
  } catch (err: any) {
    const { log, client, status } = snapTradeError(err, "Failed to read orders");
    logger.error("Orders", `listOrders failed: ${log}`);
    res.status(status).json({ error: client });
  }
};

/**
 * Cancel a working order.
 *
 * The same ownership checks placing an order goes through: cancelling is a
 * write against a brokerage account, and an accountId from the page is not
 * evidence that the account belongs to the connection it was sent with.
 */
export const cancelOrderHandler = async (req: Request, res: Response) => {
  const { portfolioId, accountId, brokerageOrderId } = req.body as ValidatedCancelBody;

  try {
    const portfolio = getPortfolio(String(portfolioId));
    if (!isPortfolioConnected(portfolio)) {
      return res.status(400).json({ error: "Connection not found or not registered" });
    }
    if (!portfolio.tradingEnabled) {
      return res.status(403).json({ error: "Trading is not enabled for this connection" });
    }
    if (!accountBelongsToPortfolio(String(accountId), portfolioId)) {
      return res.status(403).json({ error: "Account does not belong to this connection" });
    }

    const result = await cancelOrder(portfolio, String(accountId), brokerageOrderId);
    logger.info("Orders", `Cancelled ${brokerageOrderId} in account ${accountId}`);
    res.json({ success: true, order: result });
  } catch (err: any) {
    const { log, client, status } = snapTradeError(err, "Could not cancel the order");
    logger.error("Orders", `cancelOrder failed for ${brokerageOrderId}: ${log}`);
    res.status(status).json({ error: client });
  }
};
