const { Router } = require('express');
const log = require('../logger');
const db = require('../db');
const { syncTransactions } = require('../services/txService');

const router = Router();
const txLog = log.make('transactions');

// POST /api/transactions/sync
router.post('/sync', async (_req, res) => {
  const result = await syncTransactions();
  if (!result.success) return res.status(500).json(result);
  res.json(result);
});

// GET /api/transactions
router.get('/', (req, res) => {
  const { category, limit, offset, account_id } = req.query;
  try {
    const parsedLimit = Math.min(parseInt(limit, 10) || 100, 500);
    const parsedOffset = parseInt(offset, 10) || 0;
    const rows = db.getTransactions({
      category: category || null,
      account_id: account_id || null,
      limit: parsedLimit,
      offset: parsedOffset
    });
    res.json({ data: rows, limit: parsedLimit, offset: parsedOffset, hasMore: rows.length === parsedLimit });
  } catch (e) {
    txLog.error('Failed to fetch transactions', { error: e.message });
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// PATCH /api/transactions/:id
router.patch('/:id', (req, res) => {
  const { category } = req.body;
  if (!category) return res.status(400).json({ error: 'category required' });
  try {
    db.updateTransactionCategory(req.params.id, category);
    txLog.info('Transaction category updated', { id: req.params.id, category });
    res.json({ success: true });
  } catch (e) {
    txLog.error('Failed to update transaction', { id: req.params.id, error: e.message });
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

module.exports = router;
