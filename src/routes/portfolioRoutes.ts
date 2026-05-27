import { Router } from "express";
import { getPortfolios, createOrUpdatePortfolio, removePortfolio, togglePortfolioTrading, getAllDividends, getDividendMetadata, clearDividendCache, aiFetchDividendMetadataHandler, manualSaveDividendMetadataHandler, deleteDividendMetadataHandler } from "../controllers/portfolioController.js";

const router = Router();

router.get("/", getPortfolios);
router.get("/all-dividends", getAllDividends);
router.get("/dividend-metadata", getDividendMetadata);
router.post("/clear-dividend-cache", clearDividendCache);
router.post("/dividend-metadata/:symbol/ai-fetch", aiFetchDividendMetadataHandler);
router.put("/dividend-metadata/:symbol", manualSaveDividendMetadataHandler);
router.delete("/dividend-metadata/:symbol", deleteDividendMetadataHandler);
router.post("/", createOrUpdatePortfolio);
router.delete("/:id", removePortfolio);
router.patch("/:id/trading", togglePortfolioTrading);

export default router;
