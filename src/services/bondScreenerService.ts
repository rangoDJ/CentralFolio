export interface BondItem {
  id: string;
  name: string;
  ticker: string;
  isin: string;
  issuer: string;
  issuerType: 'Government' | 'Corporate' | 'Municipal';
  couponType: 'Fixed' | 'Floating' | 'Discount';
  couponRatePct: number;
  couponFrequency: number; // 1, 2, 4, 12 times a year
  currentYieldPct: number;
  yieldToMaturityPct: number; // YTM
  durationYears: number;
  maturityDate: string;
  pricePct: number; // % of face value, e.g. 98.5%
  rating: string; // AAA, AA, A, BBB, etc.
  hasAmortization: boolean;
  currency: string;
}

const SAMPLE_BONDS: BondItem[] = [
  {
    id: 'us-t-10y',
    name: 'US Treasury 10-Year Note',
    ticker: 'US10Y',
    isin: 'US91282CDJ71',
    issuer: 'US Department of the Treasury',
    issuerType: 'Government',
    couponType: 'Fixed',
    couponRatePct: 4.25,
    couponFrequency: 2,
    currentYieldPct: 4.31,
    yieldToMaturityPct: 4.28,
    durationYears: 8.4,
    maturityDate: '2034-08-15',
    pricePct: 98.6,
    rating: 'AAA',
    hasAmortization: false,
    currency: 'USD'
  },
  {
    id: 'us-t-5y',
    name: 'US Treasury 5-Year Note',
    ticker: 'US5Y',
    isin: 'US91282CDK45',
    issuer: 'US Department of the Treasury',
    issuerType: 'Government',
    couponType: 'Fixed',
    couponRatePct: 4.125,
    couponFrequency: 2,
    currentYieldPct: 4.18,
    yieldToMaturityPct: 4.15,
    durationYears: 4.6,
    maturityDate: '2029-09-30',
    pricePct: 99.4,
    rating: 'AAA',
    hasAmortization: false,
    currency: 'USD'
  },
  {
    id: 'can-gov-10y',
    name: 'Government of Canada 10-Year Benchmark',
    ticker: 'CAN10Y',
    isin: 'CA135087M837',
    issuer: 'Government of Canada',
    issuerType: 'Government',
    couponType: 'Fixed',
    couponRatePct: 3.25,
    couponFrequency: 2,
    currentYieldPct: 3.32,
    yieldToMaturityPct: 3.29,
    durationYears: 8.7,
    maturityDate: '2034-12-01',
    pricePct: 98.9,
    rating: 'AAA',
    hasAmortization: false,
    currency: 'CAD'
  },
  {
    id: 'apple-corp-2030',
    name: 'Apple Inc. 3.25% Senior Notes',
    ticker: 'AAPL30',
    isin: 'US037833DV17',
    issuer: 'Apple Inc.',
    issuerType: 'Corporate',
    couponType: 'Fixed',
    couponRatePct: 3.25,
    couponFrequency: 2,
    currentYieldPct: 4.62,
    yieldToMaturityPct: 4.58,
    durationYears: 5.2,
    maturityDate: '2030-05-11',
    pricePct: 94.2,
    rating: 'AA+',
    hasAmortization: false,
    currency: 'USD'
  },
  {
    id: 'msft-corp-2032',
    name: 'Microsoft Corp. 3.30% Senior Notes',
    ticker: 'MSFT32',
    isin: 'US594918CH37',
    issuer: 'Microsoft Corp.',
    issuerType: 'Corporate',
    couponType: 'Fixed',
    couponRatePct: 3.30,
    couponFrequency: 2,
    currentYieldPct: 4.70,
    yieldToMaturityPct: 4.65,
    durationYears: 6.8,
    maturityDate: '2032-02-06',
    pricePct: 92.8,
    rating: 'AAA',
    hasAmortization: false,
    currency: 'USD'
  },
  {
    id: 'ry-sub-2031',
    name: 'Royal Bank of Canada Subordinated Floating Notes',
    ticker: 'RY31',
    isin: 'CA780087K123',
    issuer: 'Royal Bank of Canada',
    issuerType: 'Corporate',
    couponType: 'Floating',
    couponRatePct: 5.15,
    couponFrequency: 4,
    currentYieldPct: 5.18,
    yieldToMaturityPct: 5.22,
    durationYears: 4.9,
    maturityDate: '2031-11-24',
    pricePct: 99.8,
    rating: 'AA',
    hasAmortization: false,
    currency: 'CAD'
  },
  {
    id: 'on-muni-2033',
    name: 'Province of Ontario 4.05% Bond',
    ticker: 'ONT33',
    isin: 'CA683234TE29',
    issuer: 'Province of Ontario',
    issuerType: 'Municipal',
    couponType: 'Fixed',
    couponRatePct: 4.05,
    couponFrequency: 2,
    currentYieldPct: 4.15,
    yieldToMaturityPct: 4.12,
    durationYears: 7.9,
    maturityDate: '2033-06-02',
    pricePct: 98.5,
    rating: 'AA-',
    hasAmortization: false,
    currency: 'CAD'
  }
];

export interface BondFilterOptions {
  search?: string;
  issuerType?: string;
  couponType?: string;
  minYtm?: number;
  maxYtm?: number;
  maxDuration?: number;
  currency?: string;
}

export function screenBonds(options?: BondFilterOptions): BondItem[] {
  let list = [...SAMPLE_BONDS];

  if (options?.search) {
    const q = options.search.toLowerCase();
    list = list.filter(b =>
      b.name.toLowerCase().includes(q) ||
      b.ticker.toLowerCase().includes(q) ||
      b.issuer.toLowerCase().includes(q) ||
      b.isin.toLowerCase().includes(q)
    );
  }

  if (options?.issuerType && options.issuerType !== 'all') {
    list = list.filter(b => b.issuerType.toLowerCase() === options.issuerType!.toLowerCase());
  }

  if (options?.couponType && options.couponType !== 'all') {
    list = list.filter(b => b.couponType.toLowerCase() === options.couponType!.toLowerCase());
  }

  if (options?.minYtm != null) {
    list = list.filter(b => b.yieldToMaturityPct >= options.minYtm!);
  }

  if (options?.maxYtm != null) {
    list = list.filter(b => b.yieldToMaturityPct <= options.maxYtm!);
  }

  if (options?.maxDuration != null) {
    list = list.filter(b => b.durationYears <= options.maxDuration!);
  }

  if (options?.currency && options.currency !== 'all') {
    list = list.filter(b => b.currency.toUpperCase() === options.currency!.toUpperCase());
  }

  return list.sort((a, b) => b.yieldToMaturityPct - a.yieldToMaturityPct);
}
