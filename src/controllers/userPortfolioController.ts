import { Request, Response } from "express";
import {
  getAllUserPortfolios,
  createUserPortfolio,
  updateUserPortfolio,
  deleteUserPortfolio,
  setUserPortfolioAccounts,
  getUserPortfolioById,
} from "../repositories/userPortfolioRepository.js";
import { logger } from "../utils/logger.js";

export const listUserPortfolios = (req: Request, res: Response) => {
  res.json(getAllUserPortfolios());
};

export const createUserPortfolioHandler = (req: Request, res: Response) => {
  const { name, description, color } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const portfolio = createUserPortfolio(name.trim(), description ?? null, color ?? '#7c3aed');
  logger.info('UserPortfolios', `Created: "${portfolio.name}" (id=${portfolio.id})`);
  res.status(201).json(portfolio);
};

export const updateUserPortfolioHandler = (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { name, description, color } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const existing = getUserPortfolioById(id);
  if (!existing) return res.status(404).json({ error: 'Portfolio not found' });

  const updated = updateUserPortfolio(id, name.trim(), description ?? null, color ?? existing.color);
  logger.info('UserPortfolios', `Updated: id=${id} → "${name}"`);
  res.json(updated);
};

export const deleteUserPortfolioHandler = (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const deleted = deleteUserPortfolio(id);
  if (!deleted) return res.status(404).json({ error: 'Portfolio not found' });

  logger.info('UserPortfolios', `Deleted: id=${id}`);
  res.json({ success: true });
};

export const setPortfolioAccountsHandler = (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const existing = getUserPortfolioById(id);
  if (!existing) return res.status(404).json({ error: 'Portfolio not found' });

  const { accountIds } = req.body;
  if (!Array.isArray(accountIds)) return res.status(400).json({ error: 'accountIds must be an array' });

  setUserPortfolioAccounts(id, accountIds.filter(a => typeof a === 'string'));
  logger.info('UserPortfolios', `Updated accounts for id=${id}: [${accountIds.join(', ')}]`);
  res.json(getUserPortfolioById(id));
};
