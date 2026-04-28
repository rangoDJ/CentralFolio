const axios = require('axios');

const cache = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function fetchFromYahoo(ticker) {
  const { data } = await axios.get(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`,
    {
      params: { events: 'div', range: '3y', interval: '1mo' },
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CentralFolio/1.0)' }
    }
  );
  const divMap = data?.chart?.result?.[0]?.events?.dividends;
  if (!divMap) return null;
  const divs = Object.values(divMap).sort((a, b) => a.date - b.date);
  return divs.length > 0 ? divs : null;
}

function inferFrequency(divs) {
  if (divs.length < 2) return 4;
  const recent = divs.slice(-6);
  const gaps = recent.slice(1).map((d, i) => (d.date - recent[i].date) / 86400);
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (avg < 40)  return 12;  // monthly
  if (avg < 110) return 4;   // quarterly
  if (avg < 220) return 2;   // semi-annual
  return 1;                   // annual
}

// Project the next `count` pay dates from the last known date at the inferred interval
function projectNextDates(lastMs, frequency, count = 14) {
  const intervalDays = Math.round(365 / frequency);
  const dates = [];
  let next = new Date(lastMs);
  for (let i = 0; i < count; i++) {
    next = new Date(next);
    next.setDate(next.getDate() + intervalDays);
    dates.push(next.toISOString().split('T')[0]);
  }
  return dates;
}

async function getDividendData(symbol) {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  // Try bare symbol first, then with .TO suffix for TSX-listed securities
  let divs = null;
  for (const ticker of [symbol, `${symbol}.TO`]) {
    try {
      divs = await fetchFromYahoo(ticker);
      if (divs) break;
    } catch (_) { /* try next */ }
  }

  if (!divs) {
    cache.set(symbol, { data: null, ts: Date.now() });
    return null;
  }

  const last = divs[divs.length - 1];
  const frequency = inferFrequency(divs);

  const data = {
    lastAmount: last.amount,
    lastPayDate: new Date(last.date * 1000).toISOString().split('T')[0],
    frequency,
    annualPerShare: parseFloat((last.amount * frequency).toFixed(6)),
    nextPayDates: projectNextDates(last.date * 1000, frequency),
    recentHistory: divs.slice(-8).map(d => ({
      date: new Date(d.date * 1000).toISOString().split('T')[0],
      amount: d.amount
    }))
  };

  cache.set(symbol, { data, ts: Date.now() });
  return data;
}

module.exports = { getDividendData };
