import { Router } from "express";
import { portfolioHistoryHandler, diversificationHandler, stockRatingsHandler, riskHandler, taxHandler, attributionHandler, realizedGainsHandler } from "../controllers/analyticsController.js";

const router = Router();

router.get("/portfolio-history", portfolioHistoryHandler);
router.get("/diversification", diversificationHandler);
router.get("/stock-ratings", stockRatingsHandler);
router.get("/risk", riskHandler);
router.get("/tax", taxHandler);
router.get("/attribution", attributionHandler);
router.get("/realized-gains", realizedGainsHandler);

export default router;
