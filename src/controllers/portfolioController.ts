import { Request, Response } from "express";
import { getPortfolio, listPortfolios, savePortfolio, deletePortfolio, Portfolio } from "../models/db.js";
import { getAllDividendsForAllPortfolios } from "../services/dividendService.js";

export const getPortfolios = (req: Request, res: Response) => {
  console.log("[API] GET /api/portfolios");
  const portfolios = listPortfolios();
  res.json(portfolios);
};

export const getAllDividends = async (req: Request, res: Response) => {
  console.log("[API] GET /api/portfolios/all-dividends");
  try {
    const allDividends = await getAllDividendsForAllPortfolios();
    res.json(allDividends);
  } catch (err: any) {
    console.error("[API] Failed to get all dividends:", err.message);
    res.status(500).json({ error: "Failed to fetch dividends", detail: err.message });
  }
};

export const createOrUpdatePortfolio = (req: Request, res: Response) => {
  const { id, name, clientId, consumerKey, userId, userSecret } = req.body;
  console.log(`[API] POST /api/portfolios - Name: ${name}, ID: ${id || 'NEW'}`);
  
  if (!name || !clientId || !consumerKey || !userId) {
    return res.status(400).json({ error: "Missing required fields: name, clientId, consumerKey, userId" });
  }

  const portfolio: Portfolio = {
    id: id ? Number(id) : undefined,
    name,
    clientId,
    consumerKey,
    userId,
    userSecret: userSecret || undefined
  };

  try {
    const savedId = savePortfolio(portfolio);
    res.json({ success: true, id: savedId });
  } catch (err: any) {
    console.error("[API] Failed to save portfolio:", err.message);
    res.status(500).json({ error: "Failed to save portfolio", detail: err.message });
  }
};

export const removePortfolio = (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    deletePortfolio(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete portfolio", detail: err.message });
  }
};
