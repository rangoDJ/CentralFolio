import { Router } from "express";
import { portfolioHistoryHandler, diversificationHandler, stockRatingsHandler } from "../controllers/analyticsController.js";

const router = Router();

router.get("/portfolio-history", portfolioHistoryHandler);
router.get("/diversification", diversificationHandler);
router.get("/stock-ratings", stockRatingsHandler);

export default router;
