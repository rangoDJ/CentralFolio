import { Request, Response } from "express";
import {
  getAllCorporateActions,
  addCorporateAction,
  removeCorporateAction
} from "../services/corporateActionService.js";
import { logger } from "../utils/logger.js";

export const listCorporateActionsHandler = async (req: Request, res: Response) => {
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
  try {
    const list = getAllCorporateActions(symbol);
    res.json(list);
  } catch (err: any) {
    logger.error("CorporateAction", `list failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const createCorporateActionHandler = async (req: Request, res: Response) => {
  const { symbol, eventType, ratio, date, spinoffSymbol, notes } = req.body;
  if (!symbol || !eventType || !ratio || !date) {
    return res.status(400).json({ error: "Missing required fields: symbol, eventType, ratio, date" });
  }
  try {
    const item = addCorporateAction({
      symbol,
      eventType,
      ratio: Number(ratio),
      date,
      spinoffSymbol,
      notes
    });
    res.status(201).json(item);
  } catch (err: any) {
    logger.error("CorporateAction", `create failed: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
};

export const deleteCorporateActionHandler = async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid corporate action id" });
  }
  try {
    const ok = removeCorporateAction(id);
    if (!ok) return res.status(404).json({ error: "Corporate action not found" });
    res.json({ success: true, id });
  } catch (err: any) {
    logger.error("CorporateAction", `delete failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};
