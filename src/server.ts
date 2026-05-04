import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { listPortfolios, getPortfolio, savePortfolio, deletePortfolio, Portfolio } from "./db.js";
import { getSnapTradeClientForPortfolio, listAllUsersAcrossPortfolios, deleteUserFromPortfolios } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static(path.resolve(__dirname, "../public")));

// --- Portfolio Management ---

// Get all portfolios
app.get("/api/portfolios", (req, res) => {
  console.log("[API] GET /api/portfolios");
  const portfolios = listPortfolios();
  res.json(portfolios);
});

// Create or update a portfolio
app.post("/api/portfolios", (req, res) => {
  const { id, name, clientId, consumerKey, userId, userSecret } = req.body;
  console.log(`[API] POST /api/portfolios - Name: ${name}, ID: ${id || 'NEW'}`);
  
  if (!name || !clientId || !consumerKey || !userId) {
    return res.status(400).json({ error: "Missing required fields: name, clientId, consumerKey, userId" });
  }

  const portfolio: Portfolio = {
    id: id ? Number(id) : undefined,
    name,
    clientId,
    consumerKey,
    userId,
    userSecret: userSecret || undefined
  };

  try {
    const savedId = savePortfolio(portfolio);
    res.json({ success: true, id: savedId });
  } catch (err: any) {
    console.error("[API] Failed to save portfolio:", err.message);
    res.status(500).json({ error: "Failed to save portfolio", detail: err.message });
  }
});

// Delete a portfolio
app.delete("/api/portfolios/:id", (req, res) => {
  const { id } = req.params;
  try {
    deletePortfolio(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete portfolio", detail: err.message });
  }
});

// --- SnapTrade Operations ---

// Register user for a specific portfolio
app.post("/api/register", async (req, res) => {
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
    
    // Check if we have a secret locally if it's a "one user" error
    const portfolio = getPortfolio(portfolioId);
    if (detail.includes("Personal keys can only register one user") && portfolio?.userSecret) {
      return res.json({ success: true, userSecret: portfolio.userSecret, cached: true });
    }
    
    res.status(500).json({ error: detail });
  }
});

// List accounts grouped by portfolio
app.get("/api/accounts", async (req, res) => {
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
});

// Generate login link for a specific portfolio
app.post("/api/login", async (req, res) => {
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
    
    // We want Wealthsimple Trade specifically
    const data = loginResponse.data as any;
    const loginUrl = `${data.redirectURI || data.redirectUri}&broker=WEALTHSIMPLETRADE`;
    res.json({ loginUrl });
  } catch (err: any) {
    const body = err?.responseBody ?? err?.response?.data;
    res.status(500).json({ error: body?.detail || "Login generation failed" });
  }
});

// --- Admin / Debug ---

// Admin: List all users across all unique portfolios
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await listAllUsersAcrossPortfolios();
    res.json(users);
  } catch (err: any) {
    const detail = err.message || err;
    res.status(500).json({ error: "Failed to list users", detail });
  }
});

// Admin: Delete a specific user from any portfolio that matches
app.delete("/api/admin/users/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    await deleteUserFromPortfolios(userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete user", detail: err.message });
  }
});

// Admin: Wipe all users (Recovery)
app.post("/api/admin/wipe", async (req, res) => {
  try {
    const users = await listAllUsersAcrossPortfolios();
    console.log(`Wiping ${users.length} unique users...`);
    
    const results = {
      success: [] as string[],
      failed: [] as { userId: string, error: any }[]
    };

    for (const userId of users) {
      try {
        await deleteUserFromPortfolios(userId);
        results.success.push(userId);
      } catch (e: any) {
        results.failed.push({ userId, error: e.message || e });
      }
    }
    
    res.json({ 
      success: true, 
      wipedCount: results.success.length,
      failedCount: results.failed.length,
      details: results
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to initiate wipe", detail: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
