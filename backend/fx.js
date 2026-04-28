const axios = require('axios');
const log = require('./logger');
const fxLog = log.make('fx');

let cachedRate = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60000; // 60 seconds

async function fetchBoCRate() {
  try {
    const response = await axios.get('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1');
    const observations = response.data.observations;
    if (observations && observations.length > 0) {
      return parseFloat(observations[observations.length - 1].FXUSDCAD.v);
    }
  } catch (error) {
    fxLog.error('Error fetching BoC FX rate', { error: error.message });
  }
  return null;
}

async function getFxRate() {
  const now = Date.now();
  if (cachedRate && (now - lastFetchTime < CACHE_DURATION)) {
    fxLog.verbose('FX rate served from cache', { rate: cachedRate, ageMs: now - lastFetchTime });
    return cachedRate;
  }

  fxLog.debug('Fetching FX rate from Bank of Canada');
  const rate = await fetchBoCRate();
  if (rate) {
    cachedRate = rate;
    lastFetchTime = now;
    fxLog.info('FX rate updated', { rate: cachedRate });
  } else {
    fxLog.warn('FX rate fetch failed, using last known rate or fallback', { lastKnown: cachedRate });
  }
  return cachedRate || null;
}

module.exports = { getFxRate };
