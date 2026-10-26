export interface TransactionRecord {
  id?: number | string;
  accountId?: string;
  symbol: string;
  description?: string;
  type: string; // 'BUY' | 'SELL' | 'DIVIDEND' | 'DIVIDEND_REINVESTMENT' etc.
  action?: string;
  units?: number;
  price?: number;
  amount?: number;
  date: string;
  currencyCode?: string;
}

export interface ClosedPosition {
  symbol: string;
  currency: string;
  totalSharesSold: number;
  remainingShares: number;
  costBasis: number;
  proceeds: number;
  realizedGain: number;
  realizedGainPct: number;
  dividends: number;
  totalProfit: number;
  totalRoiPct: number;
  openDate: string;
  closeDate: string;
  holdingDays: number;
  isClosed: boolean;
}

export interface ClosedPositionsSummary {
  totalRealizedGain: number;
  totalDividends: number;
  totalProfit: number;
  closedCount: number;
  winCount: number;
  lossCount: number;
  winRatePct: number;
  avgHoldingDays: number;
}

export interface ClosedPositionsResult {
  positions: ClosedPosition[];
  summary: ClosedPositionsSummary;
}

interface PositionTracker {
  symbol: string;
  currency: string;
  openUnits: number;
  totalCostBasis: number;
  soldUnits: number;
  soldCostBasis: number;
  soldProceeds: number;
  dividends: number;
  firstBuyDate: string | null;
  lastSellDate: string | null;
}

function parseDateIso(d: string): string {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return d.slice(0, 10);
  }
}

function isBuy(type: string, action?: string): boolean {
  const t = (type || '').toUpperCase();
  const a = (action || '').toUpperCase();
  return t === 'BUY' || a === 'BUY';
}

function isSell(type: string, action?: string): boolean {
  const t = (type || '').toUpperCase();
  const a = (action || '').toUpperCase();
  return t === 'SELL' || a === 'SELL';
}

function isDividend(type: string, action?: string): boolean {
  const t = (type || '').toUpperCase();
  const a = (action || '').toUpperCase();
  return t.includes('DIV') || a.includes('DIV');
}

export function calculateClosedPositions(
  transactions: TransactionRecord[],
  options: { includePartiallyClosed?: boolean } = {}
): ClosedPositionsResult {
  if (!transactions || transactions.length === 0) {
    return {
      positions: [],
      summary: {
        totalRealizedGain: 0,
        totalDividends: 0,
        totalProfit: 0,
        closedCount: 0,
        winCount: 0,
        lossCount: 0,
        winRatePct: 0,
        avgHoldingDays: 0,
      },
    };
  }

  // Sort chronological
  const sorted = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const trackers = new Map<string, PositionTracker>();

  for (const tx of sorted) {
    const symbol = (tx.symbol || '').toUpperCase().trim();
    if (!symbol) continue;

    let tr = trackers.get(symbol);
    if (!tr) {
      tr = {
        symbol,
        currency: tx.currencyCode || 'USD',
        openUnits: 0,
        totalCostBasis: 0,
        soldUnits: 0,
        soldCostBasis: 0,
        soldProceeds: 0,
        dividends: 0,
        firstBuyDate: null,
        lastSellDate: null,
      };
      trackers.set(symbol, tr);
    }

    const txDate = parseDateIso(tx.date);
    const units = Math.abs(tx.units || 0);
    const price = Math.abs(tx.price || 0);
    const amount = Math.abs(tx.amount || 0);

    if (isBuy(tx.type, tx.action) && units > 0) {
      const cost = amount > 0 ? amount : units * price;
      tr.openUnits += units;
      tr.totalCostBasis += cost;
      if (!tr.firstBuyDate) tr.firstBuyDate = txDate;
    } else if (isSell(tx.type, tx.action) && units > 0) {
      const proceeds = amount > 0 ? amount : units * price;
      const currentAvgCost = tr.openUnits > 0 ? tr.totalCostBasis / tr.openUnits : price;
      const soldCost = units * currentAvgCost;

      tr.soldUnits += units;
      tr.soldCostBasis += soldCost;
      tr.soldProceeds += proceeds;
      tr.openUnits = Math.max(0, tr.openUnits - units);
      tr.totalCostBasis = Math.max(0, tr.totalCostBasis - soldCost);
      tr.lastSellDate = txDate;
    } else if (isDividend(tx.type, tx.action)) {
      tr.dividends += amount;
    }
  }

  const positions: ClosedPosition[] = [];

  for (const tr of trackers.values()) {
    if (tr.soldUnits <= 0) continue;

    const isFullyClosed = tr.openUnits < 0.0001;
    if (!isFullyClosed && !options.includePartiallyClosed) continue;

    const realizedGain = tr.soldProceeds - tr.soldCostBasis;
    const realizedGainPct = tr.soldCostBasis > 0 ? (realizedGain / tr.soldCostBasis) * 100 : 0;
    const totalProfit = realizedGain + tr.dividends;
    const totalRoiPct = tr.soldCostBasis > 0 ? (totalProfit / tr.soldCostBasis) * 100 : 0;

    let holdingDays = 0;
    if (tr.firstBuyDate && tr.lastSellDate) {
      const t1 = new Date(tr.firstBuyDate).getTime();
      const t2 = new Date(tr.lastSellDate).getTime();
      holdingDays = Math.max(1, Math.round((t2 - t1) / (1000 * 60 * 60 * 24)));
    }

    positions.push({
      symbol: tr.symbol,
      currency: tr.currency,
      totalSharesSold: Math.round(tr.soldUnits * 10000) / 10000,
      remainingShares: Math.round(tr.openUnits * 10000) / 10000,
      costBasis: Math.round(tr.soldCostBasis * 100) / 100,
      proceeds: Math.round(tr.soldProceeds * 100) / 100,
      realizedGain: Math.round(realizedGain * 100) / 100,
      realizedGainPct: Math.round(realizedGainPct * 100) / 100,
      dividends: Math.round(tr.dividends * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
      totalRoiPct: Math.round(totalRoiPct * 100) / 100,
      openDate: tr.firstBuyDate || '—',
      closeDate: tr.lastSellDate || '—',
      holdingDays,
      isClosed: isFullyClosed,
    });
  }

  // Sort by close date descending
  positions.sort((a, b) => b.closeDate.localeCompare(a.closeDate));

  const totalRealizedGain = Math.round(positions.reduce((s, p) => s + p.realizedGain, 0) * 100) / 100;
  const totalDividends = Math.round(positions.reduce((s, p) => s + p.dividends, 0) * 100) / 100;
  const totalProfit = Math.round((totalRealizedGain + totalDividends) * 100) / 100;
  const closedCount = positions.length;
  const winCount = positions.filter(p => p.realizedGain > 0).length;
  const lossCount = positions.filter(p => p.realizedGain < 0).length;
  const winRatePct = closedCount > 0 ? Math.round((winCount / closedCount) * 1000) / 10 : 0;
  const avgHoldingDays = closedCount > 0 ? Math.round(positions.reduce((s, p) => s + p.holdingDays, 0) / closedCount) : 0;

  return {
    positions,
    summary: {
      totalRealizedGain,
      totalDividends,
      totalProfit,
      closedCount,
      winCount,
      lossCount,
      winRatePct,
      avgHoldingDays,
    },
  };
}
