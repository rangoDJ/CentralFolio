import { Request, Response } from "express";
import { getPortfolio, savePortfolio, listPortfolios } from "../models/db.js";
import { getSnapTradeClientForPortfolio } from "../services/snaptrade.js";
import { getDividendForecastForAccount } from "../services/dividendService.js";
import yahooFinance from "yahoo-finance2";


export const registerUser = async (req: Request, res: Response) => {
  const { portfolioId } = req.body;
  if (!portfolioId) {
    return res.status(400).json({ error: "Missing portfolioId" });
  }

  try {
    const portfolio = getPortfolio(portfolioId);
    if (!portfolio) {
      return res.status(404).json({ error: "Portfolio not found" });
    }

    if (portfolio.userSecret) {
      console.log(`User already registered for portfolio ${portfolio.name}. Skipping SnapTrade registration.`);
      return res.json({ success: true, userSecret: portfolio.userSecret, cached: true });
    }

    const client = getSnapTradeClientForPortfolio(portfolio);
    
    console.log(`Registering SnapTrade user for portfolio ${portfolio.name}: ${portfolio.userId} ...`);
    const registerResponse = await client.authentication.registerSnapTradeUser({
      userId: portfolio.userId,
    });
    
    const userSecret = registerResponse.data.userSecret;
    savePortfolio({ ...portfolio, userSecret });
    
    res.json({ success: true, userSecret });
  } catch (err: any) {
    const body = err?.responseBody ?? err?.response?.data;
    const detail = body?.detail || body?.message || "Registration failed";
    
    const portfolio = getPortfolio(portfolioId);
    if (detail.includes("Personal keys can only register one user") && portfolio?.userSecret) {
      return res.json({ success: true, userSecret: portfolio.userSecret, cached: true });
    }
    
    res.status(500).json({ error: detail });
  }
};

export const listAccounts = async (req: Request, res: Response) => {
  try {
    const portfolios = listPortfolios();
    const results = [];

    for (const portfolio of portfolios) {
      if (!portfolio.userSecret) {
        results.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          error: "Not registered",
          accounts: []
        });
        continue;
      }

      try {
        const client = getSnapTradeClientForPortfolio(portfolio);
        const response = await client.accountInformation.listUserAccounts({
          userId: portfolio.userId,
          userSecret: portfolio.userSecret,
        });

        results.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          accounts: response.data
        });
      } catch (err: any) {
        const body = err?.responseBody ?? err?.response?.data;
        results.push({
          portfolioId: portfolio.id,
          portfolioName: portfolio.name,
          error: body?.detail || "Failed to fetch accounts",
          accounts: []
        });
      }
    }
    
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch portfolios for accounts" });
  }
};

export const getHoldings = async (req: Request, res: Response) => {
  const { portfolioId, accountId } = req.params;
  console.log(`[API] GET /api/holdings - Portfolio: ${portfolioId}, Account: ${accountId}`);
  
  try {
    const portfolio = getPortfolio(portfolioId);
    if (!portfolio || !portfolio.userSecret) {
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }

    const client = getSnapTradeClientForPortfolio(portfolio);
    const response = await client.accountInformation.getUserAccountPositions({
      userId: portfolio.userId,
      userSecret: portfolio.userSecret,
      accountId: accountId,
    });

    console.log(`[API] Holdings fetched successfully for account: ${accountId}`);
    res.json(response.data);
  } catch (err: any) {
    const body = err?.responseBody ?? err?.response?.data;
    const detail = body?.detail || body?.message || err.message || "Failed to fetch holdings";
    console.error(`[API] SnapTrade Error for holdings (${accountId}):`, detail);
    res.status(500).json({ error: detail });
  }
};

export const getLoginLink = async (req: Request, res: Response) => {
  const { portfolioId } = req.body;
  if (!portfolioId) {
    return res.status(400).json({ error: "Missing portfolioId" });
  }

  try {
    const portfolio = getPortfolio(portfolioId);
    if (!portfolio || !portfolio.userSecret) {
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }

    const client = getSnapTradeClientForPortfolio(portfolio);
    const loginResponse = await client.authentication.loginSnapTradeUser({
      userId: portfolio.userId,
      userSecret: portfolio.userSecret,
    });
    
    const data = loginResponse.data as any;
    const loginUrl = `${data.redirectURI || data.redirectUri}&broker=WEALTHSIMPLETRADE`;
    res.json({ loginUrl });
  } catch (err: any) {
    const body = err?.responseBody ?? err?.response?.data;
    res.status(500).json({ error: body?.detail || "Login generation failed" });
  }
};

export const getDividendForecast = async (req: Request, res: Response) => {
  const { portfolioId, accountId } = req.params;
  console.log(`[API] GET /api/dividends/forecast - Portfolio: ${portfolioId}, Account: ${accountId}`);
  
  try {
    const portfolio = getPortfolio(portfolioId);
    if (!portfolio || !portfolio.userSecret) {
      return res.status(400).json({ error: "Portfolio not found or not registered" });
    }

    const forecast = await getDividendForecastForAccount(portfolio, accountId);

    console.log(`[API] Dividend forecast generated with ${forecast.length} events for account: ${accountId}`);
    res.json(forecast);
  } catch (err: any) {
    const body = err?.responseBody ?? err?.response?.data;
    const detail = body?.detail || body?.message || err.message || "Failed to generate forecast";
    console.error(`[API] SnapTrade Error for forecast (${accountId}):`, detail);
    res.status(500).json({ error: detail });
  }
};

