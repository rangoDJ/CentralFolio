import { Router } from "express";
import { registerUser, listAccounts, getHoldings, getLoginLink, getDividendForecast, toggleAccountActive, getTransactions } from "../controllers/snapTradeController.js";

const router = Router();

console.log('[SNAP] Registering SnapTrade routes...');
router.post("/register", registerUser);
router.get("/accounts", listAccounts);
router.get("/transactions", getTransactions);
console.log('[SNAP] Registered /transactions route');
router.patch("/accounts/:accountId/active", toggleAccountActive);
router.get("/holdings/:portfolioId/:accountId", getHoldings);
router.get("/dividends/forecast/:portfolioId/:accountId", getDividendForecast);
router.post("/login", getLoginLink);
console.log('[SNAP] SnapTrade routes registered');

export default router;
