import { Router } from "express";
import { portfolioHistoryHandler, diversificationHandler } from "../controllers/analyticsController.js";

const router = Router();

router.get("/portfolio-history", portfolioHistoryHandler);
router.get("/diversification", diversificationHandler);

export default router;
