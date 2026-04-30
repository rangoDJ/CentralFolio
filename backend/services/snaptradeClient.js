const { Snaptrade } = require('snaptrade-typescript-sdk');
const log = require('../logger');
const db = require('../db');
const configManager = require('../configManager');

const snapLog = log.make('snaptrade');

function getCredentials(keyIndex = 1) {
  let userId = db.getSetting(`SNAPTRADE_USER_ID_${keyIndex}`) || (keyIndex === 1 ? db.getSetting('SNAPTRADE_USER_ID') : null);
  let userSecret = db.getSetting(`SNAPTRADE_USER_SECRET_${keyIndex}`) || (keyIndex === 1 ? db.getSetting('SNAPTRADE_USER_SECRET') : null);

  // Prioritize DB settings over ENV to resolve credential shadowing
  const dbClientId = db.getSetting(`SNAPTRADE_CLIENT_ID_${keyIndex}`) || (keyIndex === 1 ? db.getSetting('SNAPTRADE_CLIENT_ID') : '');
  const envClientId = process.env[`SNAPTRADE_CLIENT_ID_${keyIndex}`] || (keyIndex === 1 ? process.env.SNAPTRADE_CLIENT_ID : '');
  const clientId = dbClientId || envClientId;
  
  // Detection logic:
  // 1. If clientId starts with PERS-, it's a personal integration
  // 2. If userId starts with PERS-, it's a personal integration (common user configuration)
  const isPersonal = (clientId && clientId.startsWith('PERS-')) || (userId && userId.startsWith('PERS-'));

  if (isPersonal) {
    const personalKey = (userId && userId.startsWith('PERS-')) ? userId : clientId;
    // For personal integrations, SnapTrade often expects the PERS key as BOTH the Client ID and the Consumer Key
    return { userId: personalKey, userSecret: userSecret || '', isPersonal: true, clientId: personalKey };
  }

  return { userId, userSecret, isPersonal: false, clientId };
}

function getSnaptrade(keyIndex = 1) {
  const { clientId, isPersonal, userId } = getCredentials(keyIndex);
  
  const dbConsumerKey = db.getSetting(`SNAPTRADE_CONSUMER_KEY_${keyIndex}`) || (keyIndex === 1 ? db.getSetting('SNAPTRADE_CONSUMER_KEY') : '');
  const envConsumerKey = process.env[`SNAPTRADE_CONSUMER_KEY_${keyIndex}`] || (keyIndex === 1 ? process.env.SNAPTRADE_CONSUMER_KEY : '');
  const consumerKey = dbConsumerKey || envConsumerKey;
  
  // For personal integrations, we use the PERS key as BOTH clientId and consumerKey.
  const finalConsumerKey = isPersonal ? clientId : consumerKey;

  if (!clientId || (!isPersonal && !finalConsumerKey)) {
    snapLog.warn('SnapTrade client requested for unconfigured key index', { keyIndex });
  } else {
    // Masked logging for diagnostics
    const maskedClient = clientId.substring(0, 4) + '...' + clientId.substring(clientId.length - 4);
    const maskedUser = userId ? (userId.substring(0, 4) + '...' + userId.substring(userId.length - 4)) : 'NONE';
    snapLog.debug('Initializing SnapTrade client', { keyIndex, clientId: maskedClient, userId: maskedUser, isPersonal });
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
