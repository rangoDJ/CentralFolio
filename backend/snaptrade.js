const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();
const log = require('./logger');
const snapLog = log.make('snaptrade-hmac');

const SNAPTRADE_BASE_URL = 'https://api.snaptrade.com/api/v1';

async function snapTradeRequest(method, path, queryParams = {}, body = null, userId = null, userSecret = null) {
  const SNAPTRADE_CLIENT_ID = process.env.SNAPTRADE_CLIENT_ID;
  const SNAPTRADE_CONSUMER_KEY = process.env.SNAPTRADE_CONSUMER_KEY;

  if (!SNAPTRADE_CLIENT_ID || !SNAPTRADE_CONSUMER_KEY) {
    throw new Error('SnapTrade credentials missing');
  }

  const timestamp = Math.round(Date.now() / 1000);
  
  const finalQueryParams = { ...queryParams, clientId: SNAPTRADE_CLIENT_ID, timestamp };
  
  if (userId && userSecret) {
    finalQueryParams.userId = userId;
    finalQueryParams.userSecret = userSecret;
  }

  const queryString = new URLSearchParams(finalQueryParams).toString();
  const fullPath = `${path}?${queryString}`;

  const sigObj = {
    content: body,
    path: `/api/v1${fullPath}`
  };

  const sigContent = JSON.stringify(sigObj);

  const signature = crypto
    .createHmac('sha256', SNAPTRADE_CONSUMER_KEY)
    .update(sigContent, 'utf-8')
    .digest('base64');

  const headers = {
    'Signature': signature,
    'Accept': 'application/json'
  };

  try {
    const response = await axios({
      method,
      url: `${SNAPTRADE_BASE_URL}${fullPath}`,
      data: body,
      headers
    });
    return response.data;
  } catch (error) {
    snapLog.error('SnapTrade API request failed', { path, status: error.response?.status, detail: error.response?.data || error.message });
    throw error;
  }
}

module.exports = { snapTradeRequest };
