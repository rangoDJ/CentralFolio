import { Request, Response } from "express";
import { searchSymbols } from "../services/symbolSearchService.js";

export const searchSymbolsHandler = async (req: Request, res: Response) => {
  const query = String(req.query.q ?? "").trim();
  if (query.length === 0) return res.json([]);
  res.json(await searchSymbols(query, 10));
};
