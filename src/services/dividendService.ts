import YahooFinance from "yahoo-finance2";

import { Portfolio, listPortfolios } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "./snaptrade.js";

const yahooFinance = new YahooFinance();

export interface DividendEvent {
  symbol: string;
  date: string;
  amount: number;
  amountPerShare: number;
  units: number;
  name: string;
  portfolioName?: string;
  accountName?: string;
  accountId?: string;
}

export async function getDividendForecastForAccount(portfolio: Portfolio, accountId: string): Promise<DividendEvent[]> {
  try {
    const client = getSnapTradeClientForPortfolio(portfolio);
    
    // 1. Get current holdings
    const positionsResponse = await client.accountInformation.getUserAccountPositions({
      userId: portfolio.userId,
      userSecret: portfolio.userSecret!,
      accountId: accountId,
    });
    const positions = positionsResponse.data;

    const forecast: DividendEvent[] = [];
    const now = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(now.getFullYear() - 1);
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(now.getFullYear() + 1);

    // 2. For each holding, fetch historical dividends and project them
    for (const position of positions) {
      const symbolInfo = (position.symbol as any)?.symbol;
      const symbol = symbolInfo?.symbol;
      const units = position.units || 0;

      if (!symbol || units <= 0) continue;

      try {
        // Fetch last 12 months of dividends using chart() to project the next 12 months
        const chartResult = await yahooFinance.chart(symbol, {
          period1: oneYearAgo.toISOString().split('T')[0],
          interval: '1d'
        });

        const history = chartResult.events?.dividends;

        if (history && history.length > 0) {
          // Find latest dividend amount to use for all future projections of this stock
          const latestDiv = [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
          const amountPerShare = latestDiv.amount;

          for (const div of history) {
            const pastDate = new Date(div.date);
            const futureDate = new Date(pastDate);
            futureDate.setFullYear(futureDate.getFullYear() + 1);

            // If the projected date is in the future (within next 12 months)
            if (futureDate >= now && futureDate <= oneYearFromNow) {
              forecast.push({
                symbol,
                date: futureDate.toISOString(),
                amount: amountPerShare * units,
                amountPerShare,
                units,
                name: symbolInfo?.description || symbol
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[Forecast] Failed to fetch dividends for ${symbol}:`, err);
      }
    }


    return forecast.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  } catch (err: any) {
    console.error(`[DividendService] Error for account ${accountId}:`, err.message);
    throw err;
  }
}

export async function getAllDividendsForAllPortfolios(): Promise<any[]> {
  const portfolios = listPortfolios();
  const results = [];

  for (const portfolio of portfolios) {
    if (!portfolio.userSecret) continue;

    try {
      const client = getSnapTradeClientForPortfolio(portfolio);
      const accountsResponse = await client.accountInformation.listUserAccounts({
        userId: portfolio.userId,
        userSecret: portfolio.userSecret,
      });

      for (const acc of accountsResponse.data) {
        try {
          const dividends = await getDividendForecastForAccount(portfolio, acc.id);
          results.push({
            portfolioName: portfolio.name,
            accountName: acc.name,
            accountId: acc.id,
            dividends: dividends
          });
        } catch (err: any) {
          results.push({
            portfolioName: portfolio.name,
            accountName: acc.name,
            accountId: acc.id,
            error: err.message,
            dividends: []
          });
        }
      }
    } catch (err: any) {
      console.error(`[DividendService] Failed to fetch accounts for portfolio ${portfolio.name}:`, err.message);
    }
  }

  return results;
}
