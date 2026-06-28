import { Router } from "express";
import { registerUser, getTransactions, getDividendForecast } from "../controllers/snapTradeController.js";
import { listAccounts, getHoldings } from "../controllers/holdingsController.js";
import { getLoginLink, getConnectionStatus, invalidatePortfolioCache } from "../controllers/connectionController.js";
import { toggleAccountActive, renameAccount } from "../controllers/accountController.js";
import { placeTrade, getTradeLoginLink } from "../controllers/tradingController.js";
import { validateBody } from "../middleware/validate.js";
import { tradeOrderSchema } from "../schemas/tradeSchema.js";

const router = Router();

router.post("/register", registerUser);
router.get("/accounts", listAccounts);
router.get("/transactions", getTransactions);
router.patch("/accounts/:accountId/active", toggleAccountActive);
router.patch("/accounts/:accountId/name", renameAccount);
router.post("/trade", validateBody(tradeOrderSchema), placeTrade);
router.get("/holdings/:portfolioId/:accountId", getHoldings);
router.get("/dividends/forecast/:portfolioId/:accountId", getDividendForecast);
router.post("/login", getLoginLink);
router.post("/login/trade", getTradeLoginLink);
router.get("/connection-status/:portfolioId", getConnectionStatus);
router.post("/invalidate-cache/:portfolioId", invalidatePortfolioCache);

export default router;
