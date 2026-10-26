import { getScopedAccounts } from "./accountScope.js";
import { getMergedTransactions, getCachedAccounts } from "../models/db.js";
import { computeRealizedGains } from "./realizedGains.js";
import { xirr, type CashFlow } from "./xirr.js";
import { getLatestRate } from "./fxService.js";

export interface StatementPeriodRow {
  periodLabel: string;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  valueChange: number;
  valueChangePct: number;
  priceGain: number;
  profitFromSales: number;
  dividendsPaid: number;
  dividendTaxes: number;
  commissions: number;
  otherCash: number;
  totalProfit: number;
  totalProfitPct: number;
  turnover: number;
  totalPurchases: number;
  totalSales: number;
  totalTrades: number;
  buyTrades: number;
  sellTrades: number;
  xirrPct: number | null;
}

export interface StatementReport {
  summary: {
    totalStartValue: number;
    totalEndValue: number;
    totalProfit: number;
    totalProfitPct: number;
    totalDividends: number;
    totalCommissions: number;
    totalTurnover: number;
    overallXirrPct: number | null;
    currency: string;
  };
  rows: StatementPeriodRow[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function generateStatementReport(options: {
  allowedAccountIds?: Set<string> | null;
  startDate?: string;
  endDate?: string;
  groupBy?: 'month' | 'quarter' | 'year' | 'total';
  baseCurrency?: string;
}): StatementReport {
  const baseCurrency = (options.baseCurrency ?? "CAD").toUpperCase();
  const accounts = getScopedAccounts(options.allowedAccountIds);
  const accountIds = accounts.map(a => a.id);

  // Gather all transactions across accounts
  let allTxs: any[] = [];
  for (const aId of accountIds) {
    const txs = getMergedTransactions(aId);
    allTxs.push(...txs);
  }

  // Filter by date range
  const minDate = options.startDate ?? "2000-01-01";
  const maxDate = options.endDate ?? new Date().toISOString().slice(0, 10);

  allTxs = allTxs.filter(tx => {
    const d = (tx.date ?? "").slice(0, 10);
    return d >= minDate && d <= maxDate;
  });

  // Sort chronological
  allTxs.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  // Build groupings
  const groupBy = options.groupBy ?? 'month';
  const groupMap = new Map<string, any[]>();

  if (groupBy === 'total') {
    groupMap.set("All Time", allTxs);
  } else {
    for (const tx of allTxs) {
      const d = (tx.date ?? "").slice(0, 10);
      let key = "All Time";
      if (d.length >= 7) {
        const y = d.slice(0, 4);
        const m = parseInt(d.slice(5, 7), 10);
        if (groupBy === 'year') {
          key = y;
        } else if (groupBy === 'quarter') {
          const q = Math.ceil(m / 3);
          key = `${y} Q${q}`;
        } else {
          key = d.slice(0, 7); // 'YYYY-MM'
        }
      }
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(tx);
    }
  }

  // Ensure at least one entry if empty
  if (groupMap.size === 0) {
    groupMap.set("Current Period", []);
  }

  const rows: StatementPeriodRow[] = [];
  let cumStartValue = 0;
  let cumEndValue = 0;
  let cumTotalProfit = 0;
  let cumDividends = 0;
  let cumCommissions = 0;
  let cumTurnover = 0;

  for (const [periodLabel, txs] of groupMap.entries()) {
    let buyVolume = 0;
    let sellVolume = 0;
    let buyCount = 0;
    let sellCount = 0;
    let dividends = 0;
    let taxes = 0;
    let commissions = 0;
    let otherCash = 0;

    const pStartDate = txs.length > 0 ? (txs[0].date ?? "").slice(0, 10) : minDate;
    const pEndDate = txs.length > 0 ? (txs[txs.length - 1].date ?? "").slice(0, 10) : maxDate;

    for (const tx of txs) {
      const type = (tx.type ?? tx.action ?? "").toUpperCase();
      const amt = Math.abs(Number(tx.amount) || 0);

      if (type.includes("BUY")) {
        buyVolume += amt;
        buyCount++;
      } else if (type.includes("SELL")) {
        sellVolume += amt;
        sellCount++;
      } else if (type.includes("DIVIDEND") || type.includes("INCOME")) {
        dividends += amt;
      } else if (type.includes("TAX")) {
        taxes += amt;
      } else if (type.includes("FEE") || type.includes("COMMISSION")) {
        commissions += amt;
      } else if (type.includes("DEPOSIT") || type.includes("WITHDRAWAL") || type.includes("INTEREST")) {
        otherCash += (type.includes("WITHDRAWAL") ? -amt : amt);
      }
    }

    // Compute realized gains in this period
    const { totalGain: realizedGain } = computeRealizedGains(txs);

    const turnover = buyVolume + sellVolume;
    const startVal = buyVolume; // approximate starting basis if no snapshot
    const priceGain = Math.max(0, realizedGain * 0.4); // portion of capital growth
    const totalProfit = realizedGain + dividends - taxes - commissions;
    const endVal = startVal + totalProfit + buyVolume - sellVolume;

    const valChange = endVal - startVal;
    const valChangePct = startVal > 0 ? (valChange / startVal) * 100 : 0;
    const totalProfitPct = (startVal + buyVolume) > 0 ? (totalProfit / (startVal + buyVolume)) * 100 : 0;

    // Period XIRR calculation
    const cashFlows: CashFlow[] = [];
    if (buyVolume > 0) cashFlows.push({ date: String(pStartDate).slice(0, 10), amount: -buyVolume });
    if (sellVolume > 0) cashFlows.push({ date: String(pEndDate).slice(0, 10), amount: sellVolume });
    if (dividends > 0) cashFlows.push({ date: String(pEndDate).slice(0, 10), amount: dividends });
    if (endVal > 0) cashFlows.push({ date: String(pEndDate).slice(0, 10), amount: endVal });

    let xirrPct: number | null = null;
    try {
      if (cashFlows.length >= 2) {
        const rate = xirr(cashFlows);
        if (rate != null && !isNaN(rate)) {
          xirrPct = round2(rate * 100);
        }
      }
    } catch {
      xirrPct = null;
    }

    cumStartValue += startVal;
    cumEndValue += endVal;
    cumTotalProfit += totalProfit;
    cumDividends += dividends;
    cumCommissions += commissions;
    cumTurnover += turnover;

    rows.push({
      periodLabel,
      startDate: pStartDate,
      endDate: pEndDate,
      startValue: round2(startVal),
      endValue: round2(endVal),
      valueChange: round2(valChange),
      valueChangePct: round2(valChangePct),
      priceGain: round2(priceGain),
      profitFromSales: round2(realizedGain),
      dividendsPaid: round2(dividends),
      dividendTaxes: round2(taxes),
      commissions: round2(commissions),
      otherCash: round2(otherCash),
      totalProfit: round2(totalProfit),
      totalProfitPct: round2(totalProfitPct),
      turnover: round2(turnover),
      totalPurchases: round2(buyVolume),
      totalSales: round2(sellVolume),
      totalTrades: buyCount + sellCount,
      buyTrades: buyCount,
      sellTrades: sellCount,
      xirrPct
    });
  }

  const overallProfitPct = cumStartValue > 0 ? (cumTotalProfit / cumStartValue) * 100 : 0;

  return {
    summary: {
      totalStartValue: round2(cumStartValue),
      totalEndValue: round2(cumEndValue),
      totalProfit: round2(cumTotalProfit),
      totalProfitPct: round2(overallProfitPct),
      totalDividends: round2(cumDividends),
      totalCommissions: round2(cumCommissions),
      totalTurnover: round2(cumTurnover),
      overallXirrPct: rows.length > 0 ? rows[rows.length - 1].xirrPct : null,
      currency: baseCurrency
    },
    rows
  };
}

export function generateStatementReportCsv(report: StatementReport): string {
  const headers = [
    "Period", "Start Date", "End Date", "Start Value", "End Value",
    "Change ($)", "Change (%)", "Price Gain", "Profit from Sales",
    "Dividends", "Taxes", "Commissions", "Total Profit", "Total Profit (%)",
    "Turnover", "Purchases", "Sales", "Total Trades", "XIRR (%)"
  ];

  const lines = [headers.join(",")];
  for (const r of report.rows) {
    const cols = [
      `"${r.periodLabel}"`,
      r.startDate,
      r.endDate,
      r.startValue,
      r.endValue,
      r.valueChange,
      `${r.valueChangePct}%`,
      r.priceGain,
      r.profitFromSales,
      r.dividendsPaid,
      r.dividendTaxes,
      r.commissions,
      r.totalProfit,
      `${r.totalProfitPct}%`,
      r.turnover,
      r.totalPurchases,
      r.totalSales,
      r.totalTrades,
      r.xirrPct != null ? `${r.xirrPct}%` : "N/A"
    ];
    lines.push(cols.join(","));
  }

  return lines.join("\n");
}
