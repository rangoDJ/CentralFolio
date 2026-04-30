const { Router } = require('express');
const crypto = require('crypto');
const log = require('../logger');
const db = require('../db');
const { getSnaptrade, getCredentials } = require('../services/snaptradeClient');
const { performSync } = require('../services/syncService');

const router = Router();
const connLog = log.make('connections');
const snapLog = log.make('snaptrade');

// GET /api/connections — grouped by key, empty groups omitted
router.get('/', async (_req, res) => {
  try {
    const allConnections = db.getAllConnections();
    const byKey = {};
    for (const c of allConnections) {
      const k = c.key_index || 1;
      if (!byKey[k]) byKey[k] = [];
      byKey[k].push(c);
    }
    const grouped = Object.entries(byKey).map(([k, conns]) => ({
      keyIndex: Number(k),
      connections: conns
    }));
    res.json(grouped);
  } catch (error) {
    connLog.error('Failed to get connections', { error: error.message });
    res.status(500).json({ error: 'Failed to retrieve connections' });
  }
});

// PATCH /api/connections/:id — rename a connection
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const { displayName } = req.body;

  if (displayName === undefined) {
    return res.status(400).json({ error: 'displayName is required' });
  }

  const connection = db.getConnectionById(id);
  if (!connection) {
    return res.status(404).json({ error: 'Connection not found' });
  }

  try {
    db.updateConnectionDisplayName(id, displayName);
    connLog.info('Connection renamed', { id, displayName });
    res.json({ success: true, id, displayName });
  } catch (err) {
    connLog.error('Failed to rename connection', { id, error: err.message });
    res.status(500).json({ error: 'Failed to rename connection' });
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

// POST /api/connections/:keyIndex/oauth
router.post('/:keyIndex/oauth', async (req, res) => {
  try {
    const keyIndex = parseInt(req.params.keyIndex || '1');
    const { userId, userSecret, isPersonal, clientId } = getCredentials(keyIndex);

    if (!clientId) {
      return res.status(400).json({ error: `SnapTrade credentials not configured for key index ${keyIndex}.` });
    }

    // For personal integrations, we don't need to register or get a login link
    // They just use the PERS key directly. However, the SnapTrade SDK might still
    // be used for non-personal parts of the flow if needed.
    // But usually personal integrations don't use the "Link" flow.
    if (isPersonal) {
      return res.status(400).json({ error: 'Personal integrations do not use the OAuth link flow. Use your PERS key directly.' });
    }

    // Settings are stored as SNAPTRADE_USER_ID_1, SNAPTRADE_USER_ID_2, etc.
    const userIdKey = keyIndex === 1 ? 'SNAPTRADE_USER_ID' : `SNAPTRADE_USER_ID_${keyIndex}`;
    const userSecretKey = keyIndex === 1 ? 'SNAPTRADE_USER_SECRET' : `SNAPTRADE_USER_SECRET_${keyIndex}`;

    let currentUserId = userId;
    let currentUserSecret = userSecret;

    if (!currentUserId || !currentUserSecret) {
      if (!currentUserId) currentUserId = 'centralfolio-' + crypto.randomUUID();
      snapLog.info(`Registering new SnapTrade user for key ${keyIndex}`);
      const regResponse = await getSnaptrade(keyIndex).authentication.registerSnapTradeUser({ userId: currentUserId });
      currentUserSecret = regResponse.data.userSecret;
      db.setSetting(userIdKey, currentUserId);
      db.setSetting(userSecretKey, currentUserSecret);
    }

    const redirectBase = req.headers.origin || 'http://localhost:5173';
    const loginParams = {
      userId: currentUserId, 
      userSecret: currentUserSecret,
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
