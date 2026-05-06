import { Router } from "express";
import { registerUser, listAccounts, getHoldings, getLoginLink, getDividendForecast, toggleAccountActive, getTransactions } from "../controllers/snapTradeController.js";

const router = Router();

router.post("/register", registerUser);
router.get("/accounts", listAccounts);
router.patch("/accounts/:accountId/active", toggleAccountActive);
router.get("/holdings/:portfolioId/:accountId", getHoldings);
router.get("/dividends/forecast/:portfolioId/:accountId", getDividendForecast);
router.get("/transactions", getTransactions);
router.post("/login", getLoginLink);

export default router;
