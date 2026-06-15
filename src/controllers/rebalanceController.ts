import { Request, Response } from "express";
import { 
  getPortfolioTargets, 
  setPortfolioTargets, 
  getCachedAccounts, 
  getCachedPositions,
  getPortfolio,
  listPortfolios,
  Portfolio
} from "../models/db.js";
import { getUserPortfolioById } from "../repositories/userPortfolioRepository.js";
import { computeRebalance, RebalanceTrade } from "../services/rebalanceService.js";
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { logger } from "../utils/logger.js";
import { snapTradeError } from "../utils/snapTradeError.js";

const SYMBOL_RE = /^[A-Z0-9.:\-]{1,20}$/i;

export const getTargets = (req: Request, res: Response) => {
  const portfolioId = parseInt(req.params.id as string, 10);
  if (isNaN(portfolioId)) return res.status(400).json({ error: 'Invalid portfolio id' });

  try {
    const targets = getPortfolioTargets(portfolioId);
    res.json(targets);
  } catch (err: any) {
    logger.error('Rebalance', `getTargets failed for portfolio id=${portfolioId}: ${err.message}`);
    res.status(500).json({ error: 'Failed to fetch targets' });
  }
};

export const updateTargets = (req: Request, res: Response) => {
  const portfolioId = parseInt(req.params.id as string, 10);
  if (isNaN(portfolioId)) return res.status(400).json({ error: 'Invalid portfolio id' });

  const targets = req.body;
  if (!Array.isArray(targets)) {
    return res.status(400).json({ error: 'Targets must be an array' });
  }

  // Validate targets
  let sum = 0;
  for (const t of targets) {
    if (!t.symbol || !SYMBOL_RE.test(t.symbol)) {
      return res.status(400).json({ error: `Invalid symbol: ${t.symbol}` });
    }
    const pct = parseFloat(t.targetPct);
    if (isNaN(pct) || pct < 0 || pct > 1) {
      return res.status(400).json({ error: `Target percent for ${t.symbol} must be between 0.0 and 1.0` });
    }
    sum += pct;
  }

  // Allow a small tolerance for floating point summation errors
  if (targets.length > 0 && Math.abs(sum - 1.0) > 0.0001) {
    return res.status(400).json({ error: `Target allocations must sum to exactly 100% (currently ${(sum * 100).toFixed(1)}%)` });
  }

  try {
    const existing = getUserPortfolioById(portfolioId);
    if (!existing) return res.status(404).json({ error: 'User Portfolio not found' });

    setPortfolioTargets(portfolioId, targets.map(t => ({
      symbol: t.symbol.toUpperCase().trim(),
      targetPct: parseFloat(t.targetPct)
    })));

    res.json({ success: true, targets: getPortfolioTargets(portfolioId) });
  } catch (err: any) {
    logger.error('Rebalance', `updateTargets failed for portfolio id=${portfolioId}: ${err.message}`);
    res.status(500).json({ error: 'Failed to update targets' });
  }
};

export const getRebalanceSuggestions = (req: Request, res: Response) => {
  const portfolioId = parseInt(req.params.id as string, 10);
  if (isNaN(portfolioId)) return res.status(400).json({ error: 'Invalid portfolio id' });

  const mode = req.query.mode === 'full' ? 'full' : 'buy_only';

  try {
    const portfolio = getUserPortfolioById(portfolioId);
    if (!portfolio) return res.status(404).json({ error: 'User Portfolio not found' });

    const targets = getPortfolioTargets(portfolioId);
    if (targets.length === 0) {
      return res.json({ 
        portfolioName: portfolio.name,
        targetsConfigured: false, 
        accounts: [] 
      });
    }

    const accountIds = portfolio.accountIds || [];
    const activeAccountIds = new Set(accountIds);
    const parentPortfolios = listPortfolios();
    const accountsSuggestions = [];

    // Find accounts and compute rebalance per account
    for (const parent of parentPortfolios) {
      if (!parent.userSecret) continue;
      const cachedAccounts = getCachedAccounts(parent.id!);
      for (const account of cachedAccounts) {
        if (!activeAccountIds.has(account.id) || !account.isActive) continue;

        const positions = getCachedPositions(account.id);
        const cash = account.cashBalance || 0;
        const result = computeRebalance(positions, cash, targets, mode);

        accountsSuggestions.push({
          accountId: account.id,
          accountName: account.customName || account.name || 'Unnamed Account',
          currency: account.currency || 'USD',
          cash,
          totalValue: result.totalValue,
          assets: result.assets,
          trades: result.trades
        });
      }
    }

    res.json({
      portfolioName: portfolio.name,
      targetsConfigured: true,
      mode,
      accounts: accountsSuggestions
    });
  } catch (err: any) {
    logger.error('Rebalance', `getRebalanceSuggestions failed for portfolio id=${portfolioId}: ${err.message}`);
    res.status(500).json({ error: 'Failed to compute rebalance suggestions' });
  }
};

export const executeRebalance = async (req: Request, res: Response) => {
  const portfolioId = parseInt(req.params.id as string, 10);
  if (isNaN(portfolioId)) return res.status(400).json({ error: 'Invalid portfolio id' });

  const { trades } = req.body;
  if (!Array.isArray(trades)) {
    return res.status(400).json({ error: 'trades must be an array' });
  }

  try {
    const portfolio = getUserPortfolioById(portfolioId);
    if (!portfolio) return res.status(404).json({ error: 'User Portfolio not found' });

    // Only accounts that are actually part of this user-portfolio may be traded here.
    const allowedAccountIds = new Set(portfolio.accountIds || []);

    const parentPortfolios = listPortfolios();
    const accountToParentMap = new Map<string, { parent: Portfolio; account: any }>();

    for (const parent of parentPortfolios) {
      const cachedAccounts = getCachedAccounts(parent.id!);
      for (const account of cachedAccounts) {
        accountToParentMap.set(account.id, { parent, account });
      }
    }

    const results = [];
    logger.info('Rebalance', `Executing rebalance trades for portfolio id=${portfolioId} (${trades.length} trade(s))`);

    for (const t of trades) {
      const { accountId, symbol, action, amount } = t;

      // ── Per-trade validation (mirrors placeTrade guards) ───────────────────
      if (!accountId || !allowedAccountIds.has(accountId)) {
        results.push({ trade: t, success: false, error: 'Account does not belong to this portfolio' });
        continue;
      }
      if (typeof symbol !== 'string' || !SYMBOL_RE.test(symbol.trim())) {
        results.push({ trade: t, success: false, error: 'Invalid or missing symbol' });
        continue;
      }
      if (action !== 'BUY' && action !== 'SELL') {
        results.push({ trade: t, success: false, error: "action must be 'BUY' or 'SELL'" });
        continue;
      }
      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        results.push({ trade: t, success: false, error: 'amount must be a positive number' });
        continue;
      }

      const mapping = accountToParentMap.get(accountId);

      if (!mapping) {
        results.push({ trade: t, success: false, error: 'Account not found or not registered' });
        continue;
      }

      const { parent, account } = mapping;

      if (!parent.tradingEnabled) {
        results.push({ trade: t, success: false, error: `Trading is disabled for portfolio "${parent.name}"` });
        continue;
      }

      try {
        const client = getSnapTradeClientForPortfolio(parent);
        const qtyDesc = `$${amountNum}`;
        logger.info('SnapTrade', `placeTrade (Rebalance) — ${action} ${qtyDesc} ticker="${symbol}" account="${accountId}"`);

        const orderBody: any = {
          userId: parent.userId,
          userSecret: parent.userSecret!,
          account_id: accountId,
          action,
          order_type: 'Market',
          time_in_force: 'Day',
          symbol: symbol.trim(),
          universal_symbol_id: null,
          notional_value: { amount: amountNum, currency: account.currency || 'USD' }
        };

        const response = await (client as any).trading.placeForceOrder(orderBody);
        results.push({ trade: t, success: true, order: response.data });
      } catch (err: any) {
        const { log, client } = snapTradeError(err, 'Order placement failed');
        logger.error('SnapTrade', `placeTrade (Rebalance) failed for account ${accountId}: ${log}`);
        results.push({ trade: t, success: false, error: client });
      }
    }

    const successfulCount = results.filter(r => r.success).length;
    logger.info('Rebalance', `Rebalance execution complete — ${successfulCount} of ${results.length} trades succeeded`);
    res.json({ success: true, results });
  } catch (err: any) {
    logger.error('Rebalance', `executeRebalance failed: ${err.message}`);
    res.status(500).json({ error: 'Failed to execute rebalance trades' });
  }
};
