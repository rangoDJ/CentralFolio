const { Snaptrade } = require('snaptrade-typescript-sdk');
const log = require('../logger');
const db = require('../db');
const configManager = require('../configManager');

const snapLog = log.make('snaptrade');

function getCredentials(keyIndex = 1) {
  const userId = db.getSetting(`SNAPTRADE_USER_ID_${keyIndex}`) || (keyIndex === 1 ? db.getSetting('SNAPTRADE_USER_ID') : null);
  const userSecret = db.getSetting(`SNAPTRADE_USER_SECRET_${keyIndex}`) || (keyIndex === 1 ? db.getSetting('SNAPTRADE_USER_SECRET') : null);
  const clientId = db.getSetting(`SNAPTRADE_CLIENT_ID_${keyIndex}`) || (keyIndex === 1 ? db.getSetting('SNAPTRADE_CLIENT_ID') : '');

  // PERS- keys use the same value for both clientId and consumerKey (HMAC signing).
  // userId/userSecret are still separate registered credentials — same flow as regular keys.
  const isPersonal = !!(clientId && clientId.startsWith('PERS-'));

  return { userId, userSecret, isPersonal, clientId };
}

function getSnaptrade(keyIndex = 1) {
  const { clientId, isPersonal } = getCredentials(keyIndex);
  const consumerKey = db.getSetting(`SNAPTRADE_CONSUMER_KEY_${keyIndex}`) || (keyIndex === 1 ? db.getSetting('SNAPTRADE_CONSUMER_KEY') : '');

  // PERS- keys are self-signing: consumerKey === clientId
  const finalConsumerKey = isPersonal ? clientId : consumerKey;

  if (!clientId || (!isPersonal && !finalConsumerKey)) {
    snapLog.warn('SnapTrade client requested for unconfigured key index', { keyIndex });
  } else {
    const masked = clientId.substring(0, 4) + '...' + clientId.substring(clientId.length - 4);
    snapLog.debug('Initializing SnapTrade client', { keyIndex, clientId: masked, isPersonal });
  }

  return new Snaptrade({ clientId, consumerKey: finalConsumerKey });
}

function getKeyIndexForAccount(accountId) {
  if (!accountId) return 1;
  const accounts = db.getAllBrokerageAccounts();
  const acc = accounts.find(a => a.id === accountId);
  if (!acc) return 1;
  
  const conn = db.getConnectionById(acc.connection_id);
  return conn ? (conn.key_index || 1) : 1;
}

async function safeGetQuotes(userId, userSecret, accountId, symbols, keyIndex = 1) {
  snapLog.debug('Fetching quotes', { accountId, symbols, keyIndex });
  if (!userId) throw new Error('userId is required for quotes');
  const t0 = Date.now();
  try {
    const result = await getSnaptrade(keyIndex).trading.getUserAccountQuotes({
      userId, userSecret, symbols, accountId, useTicker: true
    });
    snapLog.verbose('Quotes fetched', { accountId, symbols, durationMs: Date.now() - t0, count: result.data?.length });
    return result;
  } catch (error) {
    snapLog.error('getUserAccountQuotes failed', {
      accountId, symbols, durationMs: Date.now() - t0,
      status: error.response?.status, detail: error.response?.data?.message || error.message
    });
    throw error;
  }
}

module.exports = { getSnaptrade, getCredentials, safeGetQuotes, getKeyIndexForAccount };
