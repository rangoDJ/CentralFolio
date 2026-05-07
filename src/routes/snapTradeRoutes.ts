import { Router } from "express";
import { registerUser, listAccounts, getHoldings, getLoginLink, getTradeLoginLink, getConnectionStatus, getDividendForecast, toggleAccountActive, renameAccount, getTransactions, placeTrade, invalidatePortfolioCache } from "../controllers/snapTradeController.js";

const router = Router();

router.post("/register", registerUser);
router.get("/accounts", listAccounts);
router.get("/transactions", getTransactions);
router.patch("/accounts/:accountId/active", toggleAccountActive);
router.patch("/accounts/:accountId/name", renameAccount);
router.post("/trade", placeTrade);
router.get("/holdings/:portfolioId/:accountId", getHoldings);
router.get("/dividends/forecast/:portfolioId/:accountId", getDividendForecast);
router.post("/login", getLoginLink);
router.post("/login/trade", getTradeLoginLink);
router.get("/connection-status/:portfolioId", getConnectionStatus);
router.post("/invalidate-cache/:portfolioId", invalidatePortfolioCache);

export default router;
