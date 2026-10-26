import { getCachedPositions } from "../repositories/accountRepository.js";
import { getScopedAccounts } from "./accountScope.js";
import { getLatestRate } from "./fxService.js";

export interface EtfConstituent {
  symbol: string;
  name: string;
  weightPct: number; // e.g. 7.1 for 7.1%
  sector?: string;
}

// Built-in constituent profiles for popular index & dividend ETFs
const POPULAR_ETF_HOLDINGS: Record<string, EtfConstituent[]> = {
  VOO: [
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 7.2, sector: 'Technology' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 6.5, sector: 'Technology' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 6.1, sector: 'Technology' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 3.5, sector: 'Consumer Cyclical' },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 2.5, sector: 'Communication' },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Class A)', weightPct: 2.1, sector: 'Communication' },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', weightPct: 1.8, sector: 'Financial' },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 1.7, sector: 'Technology' },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', weightPct: 1.4, sector: 'Financial' },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 1.4, sector: 'Consumer Cyclical' },
  ],
  SPY: [
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 7.2, sector: 'Technology' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 6.5, sector: 'Technology' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 6.1, sector: 'Technology' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 3.5, sector: 'Consumer Cyclical' },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 2.5, sector: 'Communication' },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Class A)', weightPct: 2.1, sector: 'Communication' },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', weightPct: 1.8, sector: 'Financial' },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 1.7, sector: 'Technology' },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', weightPct: 1.4, sector: 'Financial' },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 1.4, sector: 'Consumer Cyclical' },
  ],
  VTI: [
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 6.1, sector: 'Technology' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 5.5, sector: 'Technology' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 5.2, sector: 'Technology' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 3.0, sector: 'Consumer Cyclical' },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 2.1, sector: 'Communication' },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Class A)', weightPct: 1.8, sector: 'Communication' },
    { symbol: 'BRK.B', name: 'Berkshire Hathaway Inc.', weightPct: 1.5, sector: 'Financial' },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 1.4, sector: 'Technology' },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', weightPct: 1.2, sector: 'Financial' },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 1.2, sector: 'Consumer Cyclical' },
  ],
  QQQ: [
    { symbol: 'AAPL', name: 'Apple Inc.', weightPct: 8.8, sector: 'Technology' },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', weightPct: 8.4, sector: 'Technology' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', weightPct: 7.9, sector: 'Technology' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.', weightPct: 5.4, sector: 'Consumer Cyclical' },
    { symbol: 'META', name: 'Meta Platforms Inc.', weightPct: 4.8, sector: 'Communication' },
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 4.5, sector: 'Technology' },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Class A)', weightPct: 2.7, sector: 'Communication' },
    { symbol: 'TSLA', name: 'Tesla Inc.', weightPct: 2.6, sector: 'Consumer Cyclical' },
    { symbol: 'COST', name: 'Costco Wholesale Corp.', weightPct: 2.4, sector: 'Consumer Defensive' },
    { symbol: 'NFLX', name: 'Netflix Inc.', weightPct: 2.1, sector: 'Communication' },
  ],
  SCHD: [
    { symbol: 'CSCO', name: 'Cisco Systems Inc.', weightPct: 4.2, sector: 'Technology' },
    { symbol: 'TXN', name: 'Texas Instruments Inc.', weightPct: 4.1, sector: 'Technology' },
    { symbol: 'AMGN', name: 'Amgen Inc.', weightPct: 4.1, sector: 'Healthcare' },
    { symbol: 'HD', name: 'The Home Depot Inc.', weightPct: 4.0, sector: 'Consumer Cyclical' },
    { symbol: 'PFE', name: 'Pfizer Inc.', weightPct: 3.9, sector: 'Healthcare' },
    { symbol: 'ABBV', name: 'AbbVie Inc.', weightPct: 3.8, sector: 'Healthcare' },
    { symbol: 'CVX', name: 'Chevron Corp.', weightPct: 3.8, sector: 'Energy' },
    { symbol: 'PEP', name: 'PepsiCo Inc.', weightPct: 3.7, sector: 'Consumer Defensive' },
    { symbol: 'MRK', name: 'Merck & Co. Inc.', weightPct: 3.7, sector: 'Healthcare' },
    { symbol: 'VZ', name: 'Verizon Communications Inc.', weightPct: 3.6, sector: 'Communication' },
  ],
  VYM: [
    { symbol: 'AVGO', name: 'Broadcom Inc.', weightPct: 4.3, sector: 'Technology' },
    { symbol: 'JPM', name: 'JPMorgan Chase & Co.', weightPct: 3.8, sector: 'Financial' },
    { symbol: 'XOM', name: 'Exxon Mobil Corp.', weightPct: 3.2, sector: 'Energy' },
    { symbol: 'PG', name: 'Procter & Gamble Co.', weightPct: 2.6, sector: 'Consumer Defensive' },
    { symbol: 'JNJ', name: 'Johnson & Johnson', weightPct: 2.5, sector: 'Healthcare' },
    { symbol: 'HD', name: 'The Home Depot Inc.', weightPct: 2.4, sector: 'Consumer Cyclical' },
    { symbol: 'ABBV', name: 'AbbVie Inc.', weightPct: 2.2, sector: 'Healthcare' },
    { symbol: 'WFC', name: 'Wells Fargo & Co.', weightPct: 1.9, sector: 'Financial' },
    { symbol: 'MRK', name: 'Merck & Co. Inc.', weightPct: 1.8, sector: 'Healthcare' },
    { symbol: 'CVX', name: 'Chevron Corp.', weightPct: 1.8, sector: 'Energy' },
  ],
  XEQT: [
    { symbol: 'ITOT', name: 'iShares Core S&P Total US Stock', weightPct: 45.2, sector: 'US Equity' },
    { symbol: 'XIC', name: 'iShares Core S&P/TSX Capped', weightPct: 25.1, sector: 'Canadian Equity' },
    { symbol: 'XEF', name: 'iShares Core MSCI EAFE IMI', weightPct: 24.8, sector: 'International' },
    { symbol: 'XEC', name: 'iShares Core MSCI Emerging Markets', weightPct: 4.9, sector: 'Emerging' },
  ],
  VEQT: [
    { symbol: 'VUN', name: 'Vanguard US Total Market', weightPct: 44.5, sector: 'US Equity' },
    { symbol: 'VCN', name: 'Vanguard FTSE Canada All Cap', weightPct: 30.2, sector: 'Canadian Equity' },
    { symbol: 'VIU', name: 'Vanguard FTSE Developed All Cap ex North America', weightPct: 18.1, sector: 'International' },
    { symbol: 'VEE', name: 'Vanguard FTSE Emerging Markets All Cap', weightPct: 7.2, sector: 'Emerging' },
  ],
  XIU: [
    { symbol: 'RY.TO', name: 'Royal Bank of Canada', weightPct: 8.2, sector: 'Financial' },
    { symbol: 'TD.TO', name: 'Toronto-Dominion Bank', weightPct: 6.5, sector: 'Financial' },
    { symbol: 'ENB.TO', name: 'Enbridge Inc.', weightPct: 4.8, sector: 'Energy' },
    { symbol: 'CP.TO', name: 'Canadian Pacific Kansas City', weightPct: 4.2, sector: 'Industrials' },
    { symbol: 'CNR.TO', name: 'Canadian National Railway', weightPct: 3.9, sector: 'Industrials' },
    { symbol: 'CNQ.TO', name: 'Canadian Natural Resources', weightPct: 3.8, sector: 'Energy' },
    { symbol: 'BMO.TO', name: 'Bank of Montreal', weightPct: 3.6, sector: 'Financial' },
    { symbol: 'BNS.TO', name: 'Bank of Nova Scotia', weightPct: 3.2, sector: 'Financial' },
  ]
};

export function getEtfConstituents(symbol: string): EtfConstituent[] {
  const clean = symbol.toUpperCase().replace(/\.TO$/, '');
  return POPULAR_ETF_HOLDINGS[clean] ?? POPULAR_ETF_HOLDINGS[symbol.toUpperCase()] ?? [];
}

export interface EtfOverlapComparison {
  etfA: string;
  etfB: string;
  overlapPct: number; // 0 - 100
  overlappingHoldings: Array<{
    symbol: string;
    name: string;
    weightA: number;
    weightB: number;
    minWeight: number;
  }>;
  uniqueToA: EtfConstituent[];
  uniqueToB: EtfConstituent[];
}

export function computeEtfOverlap(etfA: string, etfB: string): EtfOverlapComparison {
  const holdingsA = getEtfConstituents(etfA);
  const holdingsB = getEtfConstituents(etfB);

  const mapB = new Map<string, EtfConstituent>();
  for (const h of holdingsB) {
    mapB.set(h.symbol.toUpperCase(), h);
  }

  const overlapping: EtfOverlapComparison['overlappingHoldings'] = [];
  const uniqueToA: EtfConstituent[] = [];
  let totalOverlap = 0;

  for (const hA of holdingsA) {
    const sym = hA.symbol.toUpperCase();
    const hB = mapB.get(sym);
    if (hB) {
      const minW = Math.min(hA.weightPct, hB.weightPct);
      totalOverlap += minW;
      overlapping.push({
        symbol: sym,
        name: hA.name,
        weightA: hA.weightPct,
        weightB: hB.weightPct,
        minWeight: Math.round(minW * 10) / 10
      });
    } else {
      uniqueToA.push(hA);
    }
  }

  const mapA = new Map<string, EtfConstituent>();
  for (const h of holdingsA) {
    mapA.set(h.symbol.toUpperCase(), h);
  }
  const uniqueToB = holdingsB.filter(hB => !mapA.has(hB.symbol.toUpperCase()));

  // Sort overlapping by highest weight
  overlapping.sort((a, b) => b.minWeight - a.minWeight);

  return {
    etfA: etfA.toUpperCase(),
    etfB: etfB.toUpperCase(),
    overlapPct: Math.round(totalOverlap * 10) / 10,
    overlappingHoldings: overlapping,
    uniqueToA,
    uniqueToB
  };
}

export interface XRayCompanyExposure {
  symbol: string;
  name: string;
  sector?: string;
  directValue: number;
  indirectValue: number;
  totalValue: number;
  portfolioWeightPct: number;
  foundInEtfs: string[];
}

export function computePortfolioXRay(allowedAccountIds?: Set<string> | null, baseCurrency = 'CAD'): {
  totalPortfolioValue: number;
  topCompanyExposures: XRayCompanyExposure[];
} {
  const accounts = getScopedAccounts(allowedAccountIds);
  const companyMap = new Map<string, {
    name: string;
    sector?: string;
    directValue: number;
    indirectValue: number;
    foundInEtfs: Set<string>;
  }>();

  let totalPortfolioValue = 0;

  for (const acct of accounts) {
    const positions = getCachedPositions(acct.id);
    const curr = (acct.currency ?? "CAD").toUpperCase();
    const fx = curr === baseCurrency ? 1 : (getLatestRate(curr, baseCurrency) || 1);

    for (const pos of positions) {
      if (!pos.symbol) continue;
      const sym = pos.symbol.toUpperCase();
      const val = (pos.marketValue ?? 0) * fx;
      totalPortfolioValue += val;

      const constituents = getEtfConstituents(sym);
      if (constituents.length > 0) {
        // It's an ETF: distribute value to constituents
        for (const c of constituents) {
          const cSym = c.symbol.toUpperCase();
          const indirectVal = val * (c.weightPct / 100);
          if (!companyMap.has(cSym)) {
            companyMap.set(cSym, {
              name: c.name,
              sector: c.sector,
              directValue: 0,
              indirectValue: 0,
              foundInEtfs: new Set()
            });
          }
          const rec = companyMap.get(cSym)!;
          rec.indirectValue += indirectVal;
          rec.foundInEtfs.add(sym);
        }
      } else {
        // Direct single stock position
        if (!companyMap.has(sym)) {
          companyMap.set(sym, {
            name: pos.description || sym,
            sector: undefined,
            directValue: 0,
            indirectValue: 0,
            foundInEtfs: new Set()
          });
        }
        const rec = companyMap.get(sym)!;
        rec.directValue += val;
      }
    }
  }

  const exposures: XRayCompanyExposure[] = [];
  for (const [sym, data] of companyMap.entries()) {
    const totalVal = data.directValue + data.indirectValue;
    const weight = totalPortfolioValue > 0 ? (totalVal / totalPortfolioValue) * 100 : 0;
    exposures.push({
      symbol: sym,
      name: data.name,
      sector: data.sector,
      directValue: Math.round(data.directValue * 100) / 100,
      indirectValue: Math.round(data.indirectValue * 100) / 100,
      totalValue: Math.round(totalVal * 100) / 100,
      portfolioWeightPct: Math.round(weight * 10) / 10,
      foundInEtfs: Array.from(data.foundInEtfs)
    });
  }

  exposures.sort((a, b) => b.totalValue - a.totalValue);

  return {
    totalPortfolioValue: Math.round(totalPortfolioValue * 100) / 100,
    topCompanyExposures: exposures.slice(0, 30)
  };
}
