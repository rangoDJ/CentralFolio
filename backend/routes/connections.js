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
  try {
    const allConnections = db.getAllConnections();
    const grouped = [];
    
    // Support up to 3 SnapTrade keys, grouping connections for the frontend
    for (let i = 1; i <= 3; i++) {
      const keyConns = allConnections.filter(c => c.key_index === i);
      grouped.push({
        keyIndex: i,
        connections: keyConns
      });
    }
    
    res.json(grouped);
  } catch (error) {
    connLog.error('Failed to get connections', { error: error.message });
    res.status(500).json({ error: 'Failed to retrieve connections' });
  }
});

// DELETE /api/connections/:id
router.delete('/:id', async (req, res) => {
  const authorizationId = req.params.id;
  const connection = db.getConnectionById(authorizationId);
  const keyIndex = connection ? connection.key_index : 1;

  const { userId, userSecret } = getCredentials(keyIndex);
  if (!userId || !userSecret) {
    return res.status(401).json({ error: 'SnapTrade user not authenticated for this connection' });
  }

  try {
    try {
      await getSnaptrade(keyIndex).connections.removeBrokerageAuthorization({ authorizationId, userId, userSecret });
    } catch (apiErr) {
      const is404 = apiErr.response?.status === 404 || apiErr.message?.includes('404');
      if (!is404) throw apiErr;
      connLog.info('Connection already deleted from SnapTrade, cleaning up locally', { authorizationId });
    }

    db.db.prepare('DELETE FROM connections WHERE id = ?').run(authorizationId);
    db.db.prepare('DELETE FROM brokerage_accounts WHERE connection_id = ?').run(authorizationId);
    connLog.info('Connection deleted', { authorizationId, keyIndex });
    res.json({ success: true });
  } catch (error) {
    connLog.error('Failed to delete connection', { error: error.message, detail: error.response?.data });
    res.status(500).json({ error: 'Failed to delete connection', detail: error.response?.data || error.message });
  }
});

// POST /api/connections/sync
router.post('/sync', async (_req, res) => {
  try {
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
    const keyIndex = parseInt(req.body?.keyIndex || '1');
    const { clientId, consumerKey } = getCredentials(keyIndex);

    if (!clientId || !consumerKey) {
      return res.status(400).json({ error: `SnapTrade credentials not configured for key index ${keyIndex}.` });
    }

    // Settings are stored as SNAPTRADE_USER_ID_1, SNAPTRADE_USER_ID_2, etc.
    const userIdKey = keyIndex === 1 ? 'SNAPTRADE_USER_ID' : `SNAPTRADE_USER_ID_${keyIndex}`;
    const userSecretKey = keyIndex === 1 ? 'SNAPTRADE_USER_SECRET' : `SNAPTRADE_USER_SECRET_${keyIndex}`;

    let userId = db.getSetting(userIdKey);
    let userSecret = db.getSetting(userSecretKey);

    if (!userId || !userSecret) {
      if (!userId) userId = 'centralfolio-' + crypto.randomUUID();
      snapLog.info(`Registering new SnapTrade user for key ${keyIndex}`);
      const regResponse = await getSnaptrade(keyIndex).authentication.registerSnapTradeUser({ userId });
      userSecret = regResponse.data.userSecret;
      db.setSetting(userIdKey, userId);
      db.setSetting(userSecretKey, userSecret);
    }

    const redirectBase = req.headers.origin || 'http://localhost:5173';
    const loginParams = {
      userId, userSecret,
      customRedirect: `${redirectBase}/settings`,
      connectionType: 'trade'
    };
    if (req.body?.broker) loginParams.broker = req.body.broker;

    const loginResponse = await getSnaptrade(keyIndex).authentication.loginSnapTradeUser(loginParams);
    const redirectURI =
      loginResponse.data?.redirectURI?.redirectURI ||
      loginResponse.data?.redirectURI?.href ||
      loginResponse.data?.redirectURI ||
      loginResponse.data?.loginRedirectURI?.redirectURI;

    if (!redirectURI) {
      snapLog.error('Missing redirectURI in SnapTrade response', { data: loginResponse.data });
      return res.status(500).json({ error: 'No redirectURI found in SnapTrade response', raw: loginResponse.data });
    }

    snapLog.info('SnapTrade link generated', { keyIndex });
    res.json({ redirectURI });
  } catch (error) {
    const errorData = error.response?.data || error.message;
    snapLog.error('Link generation failed', { detail: errorData });
    res.status(500).json({ error: 'Failed to generate link', detail: errorData });
  }
});

module.exports = router;
