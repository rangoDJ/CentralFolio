import { Router } from "express";
import { getPortfolios, createOrUpdatePortfolio, removePortfolio, togglePortfolioTrading, getAllDividends, clearDividendCache } from "../controllers/portfolioController.js";

const router = Router();

router.get("/", getPortfolios);
router.get("/all-dividends", getAllDividends);
router.post("/clear-dividend-cache", clearDividendCache);
router.post("/", createOrUpdatePortfolio);
router.delete("/:id", removePortfolio);
router.patch("/:id/trading", togglePortfolioTrading);

export default router;
