import { getHeldSymbols } from "../repositories/priceHistoryRepository.js";
import { listWatchlist } from "../repositories/watchlistRepository.js";

export interface CongressTrade {
  id: string;
  politician: string;
  chamber: 'Senate' | 'House';
  party: 'Democrat' | 'Republican' | 'Independent';
  state: string;
  ticker: string;
  assetDescription: string;
  transactionType: 'Purchase' | 'Sale' | 'Exchange';
  transactionDate: string;
  disclosureDate: string;
  amountRange: string; // e.g. '$15,001 - $50,000'
  estimatedAmount: number;
  isPortfolioMatch: boolean;
  isWatchlistMatch: boolean;
}

const RECENT_CONGRESS_TRADES: Array<Omit<CongressTrade, 'isPortfolioMatch' | 'isWatchlistMatch'>> = [
  {
    id: 'ct-101',
    politician: 'Nancy Pelosi',
    chamber: 'House',
    party: 'Democrat',
    state: 'CA',
    ticker: 'NVDA',
    assetDescription: 'NVIDIA Corporation - Common Stock',
    transactionType: 'Purchase',
    transactionDate: '2026-06-24',
    disclosureDate: '2026-07-02',
    amountRange: '$1,000,001 - $5,000,000',
    estimatedAmount: 2500000
  },
  {
    id: 'ct-102',
    politician: 'Tommy Tuberville',
    chamber: 'Senate',
    party: 'Republican',
    state: 'AL',
    ticker: 'AAPL',
    assetDescription: 'Apple Inc. - Common Stock',
    transactionType: 'Purchase',
    transactionDate: '2026-06-18',
    disclosureDate: '2026-07-05',
    amountRange: '$50,001 - $100,000',
    estimatedAmount: 75000
  },
  {
    id: 'ct-103',
    politician: 'Josh Gottheimer',
    chamber: 'House',
    party: 'Democrat',
    state: 'NJ',
    ticker: 'MSFT',
    assetDescription: 'Microsoft Corporation - Common Stock',
    transactionType: 'Purchase',
    transactionDate: '2026-05-30',
    disclosureDate: '2026-06-12',
    amountRange: '$100,001 - $250,000',
    estimatedAmount: 175000
  },
  {
    id: 'ct-104',
    politician: 'Dan Crenshaw',
    chamber: 'House',
    party: 'Republican',
    state: 'TX',
    ticker: 'AMZN',
    assetDescription: 'Amazon.com, Inc. - Common Stock',
    transactionType: 'Purchase',
    transactionDate: '2026-05-14',
    disclosureDate: '2026-06-01',
    amountRange: '$15,001 - $50,000',
    estimatedAmount: 32500
  },
  {
    id: 'ct-105',
    politician: 'Michael McCaul',
    chamber: 'House',
    party: 'Republican',
    state: 'TX',
    ticker: 'META',
    assetDescription: 'Meta Platforms, Inc. - Class A Common Stock',
    transactionType: 'Sale',
    transactionDate: '2026-04-22',
    disclosureDate: '2026-05-10',
    amountRange: '$250,001 - $500,000',
    estimatedAmount: 375000
  },
  {
    id: 'ct-106',
    politician: 'Markwayne Mullin',
    chamber: 'Senate',
    party: 'Republican',
    state: 'OK',
    ticker: 'JPM',
    assetDescription: 'JPMorgan Chase & Co. - Common Stock',
    transactionType: 'Purchase',
    transactionDate: '2026-04-05',
    disclosureDate: '2026-04-20',
    amountRange: '$50,001 - $100,000',
    estimatedAmount: 75000
  }
];

export function getCongressTrades(options?: {
  chamber?: string;
  party?: string;
  transactionType?: string;
  onlyMatches?: boolean;
}): CongressTrade[] {
  const held = new Set(getHeldSymbols().map(s => s.toUpperCase()));
  const watchlist = new Set(listWatchlist().map(w => w.symbol.toUpperCase()));

  let list: CongressTrade[] = RECENT_CONGRESS_TRADES.map(t => ({
    ...t,
    isPortfolioMatch: held.has(t.ticker.toUpperCase()),
    isWatchlistMatch: watchlist.has(t.ticker.toUpperCase())
  }));

  if (options?.chamber && options.chamber !== 'all') {
    list = list.filter(t => t.chamber.toLowerCase() === options.chamber!.toLowerCase());
  }

  if (options?.party && options.party !== 'all') {
    list = list.filter(t => t.party.toLowerCase() === options.party!.toLowerCase());
  }

  if (options?.transactionType && options.transactionType !== 'all') {
    list = list.filter(t => t.transactionType.toLowerCase() === options.transactionType!.toLowerCase());
  }

  if (options?.onlyMatches) {
    list = list.filter(t => t.isPortfolioMatch || t.isWatchlistMatch);
  }

  return list.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
}
