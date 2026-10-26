import { Request, Response } from "express";
import {
  getAllCompositePortfolios,
  addCompositePortfolio,
  removeCompositePortfolio,
  cloneUserPortfolio
} from "../services/compositePortfolioService.js";
import { logger } from "../utils/logger.js";

export const listCompositePortfoliosHandler = async (req: Request, res: Response) => {
  try {
    const list = getAllCompositePortfolios();
    res.json(list);
  } catch (err: any) {
    logger.error("CompositePortfolio", `list failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const createCompositePortfolioHandler = async (req: Request, res: Response) => {
  const { name, description, color, memberPortfolioIds } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }
  try {
    const item = addCompositePortfolio(name, description, color, memberPortfolioIds || []);
    res.status(201).json(item);
  } catch (err: any) {
    logger.error("CompositePortfolio", `create failed: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
};

export const deleteCompositePortfolioHandler = async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid composite portfolio id" });
  }
  try {
    const ok = removeCompositePortfolio(id);
    if (!ok) return res.status(404).json({ error: "Composite portfolio not found" });
    res.json({ success: true, id });
  } catch (err: any) {
    logger.error("CompositePortfolio", `delete failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const clonePortfolioHandler = async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  const newName = req.body?.name ? String(req.body.name) : undefined;
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid portfolio id" });
  }
  try {
    const cloned = cloneUserPortfolio(id, newName);
    res.status(201).json(cloned);
  } catch (err: any) {
    logger.error("ClonePortfolio", `clone failed: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
};
