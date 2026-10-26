import { Request, Response } from "express";
import { listGoals, getGoal, createGoal, updateGoal, deleteGoal, seedDefaultGoalsIfEmpty, type GoalInput } from "../repositories/goalRepository.js";
import { getScopedAccounts } from "../services/accountScope.js";
import { getCachedPositions } from "../models/db.js";
import { getAllDividendsFromCacheOnly } from "../services/dividendService.js";
import { logger } from "../utils/logger.js";

function parseAccountIds(raw: unknown): Set<string> | null {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  return ids.length > 0 ? new Set(ids) : null;
}

export const listGoalsHandler = async (req: Request, res: Response) => {
  try {
    seedDefaultGoalsIfEmpty();
    const goals = listGoals();
    const allowedIds = parseAccountIds(req.query.accountIds);

    // Compute portfolio metrics to enrich goals with current progress
    let totalNetWorth = 0;
    for (const acct of getScopedAccounts(allowedIds)) {
      for (const pos of getCachedPositions(acct.id)) {
        const val = pos.marketValue ?? (pos.units ?? 0) * (pos.price ?? 0);
        totalNetWorth += (val || 0);
      }
    }

    let annualDividendIncome = 0;
    try {
      const divAccounts = await getAllDividendsFromCacheOnly();
      for (const acct of divAccounts) {
        if (allowedIds && !allowedIds.has(acct.accountId)) continue;
        for (const div of (acct.dividends || [])) {
          annualDividendIncome += (div.amountCAD ?? div.amount ?? 0);
        }
      }
    } catch (e: any) {
      logger.warn("Goals", `Failed to fetch dividend summary for goals: ${e.message}`);
    }

    const monthlyDividendIncome = annualDividendIncome / 12;

    const enriched = goals.map(g => {
      let currentVal = 0;
      if (g.targetType === 'monthly_income') {
        currentVal = monthlyDividendIncome;
      } else if (g.targetType === 'annual_income') {
        currentVal = annualDividendIncome;
      } else {
        currentVal = totalNetWorth;
      }

      const progressPct = g.targetAmount > 0 ? Math.min(100, Math.round((currentVal / g.targetAmount) * 100)) : 0;
      const remaining = Math.max(0, g.targetAmount - currentVal);

      return {
        ...g,
        currentAmount: Math.round(currentVal * 100) / 100,
        progressPct,
        remaining: Math.round(remaining * 100) / 100,
        isAchieved: currentVal >= g.targetAmount,
      };
    });

    res.json({
      goals: enriched,
      metrics: {
        totalNetWorth: Math.round(totalNetWorth * 100) / 100,
        annualDividendIncome: Math.round(annualDividendIncome * 100) / 100,
        monthlyDividendIncome: Math.round(monthlyDividendIncome * 100) / 100,
      }
    });
  } catch (err: any) {
    logger.error("Goals", `listGoals failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const createGoalHandler = (req: Request, res: Response) => {
  const { name, targetType, targetAmount, targetDate, notes } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: "Goal name is required" });
  }
  if (!['monthly_income', 'annual_income', 'net_worth'].includes(targetType)) {
    return res.status(400).json({ error: "Invalid targetType. Must be monthly_income, annual_income, or net_worth" });
  }
  const amt = Number(targetAmount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: "targetAmount must be a positive number" });
  }

  try {
    const goal = createGoal({
      name: name.trim(),
      targetType,
      targetAmount: amt,
      targetDate,
      notes,
    });
    res.status(201).json(goal);
  } catch (err: any) {
    logger.error("Goals", `createGoal failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const updateGoalHandler = (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid goal id" });
  }

  try {
    const updated = updateGoal(id, req.body);
    if (!updated) {
      return res.status(404).json({ error: "Goal not found" });
    }
    res.json(updated);
  } catch (err: any) {
    logger.error("Goals", `updateGoal failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

export const deleteGoalHandler = (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid goal id" });
  }

  try {
    const ok = deleteGoal(id);
    if (!ok) {
      return res.status(404).json({ error: "Goal not found" });
    }
    res.json({ success: true, id });
  } catch (err: any) {
    logger.error("Goals", `deleteGoal failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};
