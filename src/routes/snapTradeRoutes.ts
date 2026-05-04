import { Router } from "express";
import { registerUser, listAccounts, getHoldings, getLoginLink, getDividendForecast } from "../controllers/snapTradeController.js";

const router = Router();

router.post("/register", registerUser);
router.get("/accounts", listAccounts);
router.get("/holdings/:portfolioId/:accountId", getHoldings);
router.get("/dividends/forecast/:portfolioId/:accountId", getDividendForecast);
router.post("/login", getLoginLink);

export default router;
