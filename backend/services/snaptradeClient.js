const { Snaptrade } = require('snaptrade-typescript-sdk');
const log = require('../logger');
const db = require('../db');
const configManager = require('../configManager');

const snapLog = log.make('snaptrade');

function getSnaptrade() {
  const clientId = process.env.SNAPTRADE_CLIENT_ID || '';
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY || '';
  return new Snaptrade({ clientId, consumerKey });
}

function getCredentials() {
  let userId = db.getSetting('SNAPTRADE_USER_ID');
  let userSecret = db.getSetting('SNAPTRADE_USER_SECRET');

  const settings = configManager.getSettings();
  const clientId = process.env.SNAPTRADE_CLIENT_ID || settings.SNAPTRADE_CLIENT_ID || '';
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
