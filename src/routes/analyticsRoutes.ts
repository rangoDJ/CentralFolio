import { Router } from "express";
import { portfolioHistoryHandler, diversificationHandler, stockRatingsHandler, riskHandler, taxHandler, attributionHandler, realizedGainsHandler, t5008Handler, t5008CsvHandler } from "../controllers/analyticsController.js";

const router = Router();

router.get("/portfolio-history", portfolioHistoryHandler);
router.get("/diversification", diversificationHandler);
router.get("/stock-ratings", stockRatingsHandler);
router.get("/risk", riskHandler);
router.get("/tax", taxHandler);
router.get("/attribution", attributionHandler);
router.get("/realized-gains", realizedGainsHandler);
// Registered before the JSON route so ".csv" is not swallowed as a path param.
router.get("/t5008.csv", t5008CsvHandler);
router.get("/t5008", t5008Handler);

export default router;
