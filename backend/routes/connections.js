const { Router } = require('express');
const crypto = require('crypto');
const log = require('../logger');
const db = require('../db');
const { getSnaptrade, getCredentials } = require('../services/snaptradeClient');
const { performSync } = require('../services/syncService');

const router = Router();
const connLog = log.make('connections');
const snapLog = log.make('snaptrade');

// GET /api/connections
router.get('/', async (_req, res) => {
  const { userId, userSecret } = getCredentials();
  if (userId && userSecret) {
    try {
      const authorizationsResponse = await getSnaptrade().connections.listBrokerageAuthorizations({ userId, userSecret });
      const authorizations = authorizationsResponse.data;
      if (Array.isArray(authorizations)) {
        for (const auth of authorizations) {
          db.upsertConnection(auth.id, auth.brokerage?.name || 'Unknown', 'CONNECTED');
        }
      }
    } catch (e) {
      connLog.warn('Auto-sync failed on GET /api/connections', { error: e.message });
    }
  }
  res.json(db.getAllConnections());
});

// DELETE /api/connections/:id
router.delete('/:id', async (req, res) => {
  const { userId, userSecret } = getCredentials();
  if (!userId || !userSecret) {
    return res.status(401).json({ error: 'SnapTrade user not authenticated' });
  }

  const authorizationId = req.params.id;
  try {
    try {
      await getSnaptrade().connections.removeBrokerageAuthorization({ authorizationId, userId, userSecret });
    } catch (apiErr) {
      const is404 = apiErr.response?.status === 404 || apiErr.message?.includes('404');
      if (!is404) throw apiErr;
      connLog.info('Connection already deleted from SnapTrade, cleaning up locally', { authorizationId });
    }

    db.db.prepare('DELETE FROM connections WHERE id = ?').run(authorizationId);
    db.db.prepare('DELETE FROM brokerage_accounts WHERE connection_id = ?').run(authorizationId);
    connLog.info('Connection deleted', { authorizationId });
    res.json({ success: true });
  } catch (error) {
    connLog.error('Failed to delete connection', { error: error.message, detail: error.response?.data });
    res.status(500).json({ error: 'Failed to delete connection', detail: error.response?.data || error.message });
  }
});

// POST /api/connections/sync
router.post('/sync', async (_req, res) => {
  try {
    if (!process.env.SNAPTRADE_CLIENT_ID || !process.env.SNAPTRADE_CONSUMER_KEY) {
      db.upsertConnection('mock_ws_1', 'Wealthsimple (Mock)', 'CONNECTED');
      return res.json({ success: true, message: 'Mock sync completed due to missing credentials.', authorizations: [] });
    }
    const result = await performSync();
    if (!result.success) return res.status(500).json(result);
    res.json(result);
  } catch (err) {
    connLog.error('Manual sync failed', { error: err.message, detail: err.response?.data });
    res.status(500).json({ error: 'Failed to sync with SnapTrade.' });
  }
});

// POST /api/snaptrade/link
router.post('/snaptrade/link', async (req, res) => {
  try {
    const clientId = process.env.SNAPTRADE_CLIENT_ID || '';
    const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY || '';

    if (!clientId || !consumerKey) {
      return res.json({ redirectURI: '#mock-redirect-no-credentials' });
    }

    let userId = db.getSetting('SNAPTRADE_USER_ID');
    let userSecret = db.getSetting('SNAPTRADE_USER_SECRET');

    if (!userId || !userSecret) {
      if (!userId) userId = 'centralfolio-' + crypto.randomUUID();
      snapLog.info('Registering new SnapTrade user');
      const regResponse = await getSnaptrade().authentication.registerSnapTradeUser({ userId });
      userSecret = regResponse.data.userSecret;
      db.setSetting('SNAPTRADE_USER_ID', userId);
      db.setSetting('SNAPTRADE_USER_SECRET', userSecret);
    }

    const redirectBase = req.headers.origin || 'http://localhost:5173';
    const loginParams = {
      userId, userSecret,
      customRedirect: `${redirectBase}/settings`,
      connectionType: 'trade'
    };
    if (req.body?.broker) loginParams.broker = req.body.broker;

    const loginResponse = await getSnaptrade().authentication.loginSnapTradeUser(loginParams);
    const redirectURI =
      loginResponse.data?.redirectURI?.redirectURI ||
      loginResponse.data?.redirectURI?.href ||
      loginResponse.data?.redirectURI ||
      loginResponse.data?.loginRedirectURI?.redirectURI;

    if (!redirectURI) {
      snapLog.error('Missing redirectURI in SnapTrade response', { data: loginResponse.data });
      return res.status(500).json({ error: 'No redirectURI found in SnapTrade response', raw: loginResponse.data });
    }

    snapLog.info('SnapTrade link generated');
    res.json({ redirectURI });
  } catch (error) {
    const errorData = error.response?.data || error.message;
    snapLog.error('Link generation failed', { detail: errorData });
    res.status(500).json({ error: 'Failed to generate link', detail: errorData });
  }
});

module.exports = router;
