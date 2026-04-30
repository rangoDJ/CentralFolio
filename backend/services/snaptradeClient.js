const { Snaptrade } = require('snaptrade-typescript-sdk');
const log = require('../logger');
const db = require('../db');
const configManager = require('../configManager');

const snapLog = log.make('snaptrade');

function getSnaptrade(keyIndex = 1) {
  const settings = configManager.getSettings();
  const clientId = process.env[`SNAPTRADE_CLIENT_ID_${keyIndex}`] || (keyIndex === 1 ? process.env.SNAPTRADE_CLIENT_ID : '') || '';
  const consumerKey = process.env[`SNAPTRADE_CONSUMER_KEY_${keyIndex}`] || (keyIndex === 1 ? process.env.SNAPTRADE_CONSUMER_KEY : '') || '';
  
  if (!clientId || !consumerKey) {
    snapLog.warn('SnapTrade client requested for unconfigured key index', { keyIndex });
  }
  
  return new Snaptrade({ clientId, consumerKey });
}

function getCredentials(keyIndex = 1) {
  let userId = db.getSetting(`SNAPTRADE_USER_ID_${keyIndex}`) || (keyIndex === 1 ? db.getSetting('SNAPTRADE_USER_ID') : null);
  let userSecret = db.getSetting(`SNAPTRADE_USER_SECRET_${keyIndex}`) || (keyIndex === 1 ? db.getSetting('SNAPTRADE_USER_SECRET') : null);

  const settings = configManager.getSettings();
  const clientId = settings[`SNAPTRADE_CLIENT_ID_${keyIndex}`] || (keyIndex === 1 ? settings.SNAPTRADE_CLIENT_ID : '') || '';
  const isPersonal = clientId.startsWith('PERS-');

  return isPersonal
    ? { userId: clientId, userSecret: userSecret || '', isPersonal: true }
    : { userId, userSecret, isPersonal: false };
}

async function safeGetQuotes(userId, userSecret, accountId, symbols) {
  snapLog.debug('Fetching quotes', { accountId, symbols });
  if (!userId) throw new Error('userId is required for quotes');
  const t0 = Date.now();
  try {
    const result = await getSnaptrade().trading.getUserAccountQuotes({
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

module.exports = { getSnaptrade, getCredentials, safeGetQuotes };
