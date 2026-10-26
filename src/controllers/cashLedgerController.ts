import { Request, Response } from "express";
import {
  getCashTransactions,
  recordCashTransaction,
  removeCashTransaction,
  computeCashSummary
} from "../services/cashLedgerService.js";
import { logger } from "../utils/logger.js";

export const listCashTransactionsHandler = async (req: Request, res: Response) => {
  const portfolioId = req.query.portfolioId ? parseInt(String(req.query.portfolioId), 10) : undefined;
  const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
  const currency = req.query.currency ? String(req.query.currency) : undefined;

  try {
    const list = getCashTransactions({ portfolioId, accountId, currency });
    res.json(list);
  } catch (err: any) {
    logger.error("CashLedger", `list failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const getCashSummaryHandler = async (req: Request, res: Response) => {
  const portfolioId = req.query.portfolioId ? parseInt(String(req.query.portfolioId), 10) : undefined;
  const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
  const baseCurrency = req.query.baseCurrency ? String(req.query.baseCurrency) : undefined;

  try {
    const summary = computeCashSummary({ portfolioId, accountId, baseCurrency });
    res.json(summary);
  } catch (err: any) {
    logger.error("CashLedger", `summary failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const createCashTransactionHandler = async (req: Request, res: Response) => {
  const { portfolioId, accountId, type, amount, currency, targetAmount, targetCurrency, exchangeRate, date, note, doNotAdjust } = req.body;
  if (!type || amount == null || !currency || !date) {
    return res.status(400).json({ error: "Missing required fields: type, amount, currency, date" });
  }

  try {
    const item = recordCashTransaction({
      portfolioId: portfolioId ? Number(portfolioId) : null,
      accountId: accountId ? String(accountId) : null,
      type,
      amount: Number(amount),
      currency: String(currency),
      targetAmount: targetAmount != null ? Number(targetAmount) : null,
      targetCurrency: targetCurrency ? String(targetCurrency) : null,
      exchangeRate: exchangeRate != null ? Number(exchangeRate) : null,
      date: String(date),
      note: note ? String(note) : null,
      doNotAdjust: Boolean(doNotAdjust)
    });
    res.status(201).json(item);
  } catch (err: any) {
    logger.error("CashLedger", `create failed: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
};

export const deleteCashTransactionHandler = async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid cash transaction id" });
  }
  try {
    const ok = removeCashTransaction(id);
    if (!ok) return res.status(404).json({ error: "Cash transaction not found" });
    res.json({ success: true, id });
  } catch (err: any) {
    logger.error("CashLedger", `delete failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};
