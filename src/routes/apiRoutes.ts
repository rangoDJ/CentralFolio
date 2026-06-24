import { Router } from "express";
import portfolioRoutes from "./portfolioRoutes.js";
import snapTradeRoutes from "./snapTradeRoutes.js";
import adminRoutes from "./adminRoutes.js";
import jobRoutes from "./jobRoutes.js";
import analyticsRoutes from "./analyticsRoutes.js";
import userPortfolioRoutes from "./userPortfolioRoutes.js";
import { stockDetailHandler, priceHistoryHandler } from "../controllers/stockController.js";

const router = Router();

// Stock detail page data (Snowball-derived asset info).
router.get("/stock/:symbol", stockDetailHandler);

// Daily price history (Yahoo-sourced, cached in SQLite).
router.get("/stock/:symbol/history", priceHistoryHandler);

// Sub-routes
router.use("/portfolios", portfolioRoutes);
router.use("/admin", adminRoutes);
router.use("/jobs", jobRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/user-portfolios", userPortfolioRoutes);
router.use("/", snapTradeRoutes);

// Catch-all for /api/* routes that didn't match
router.use((req, res) => {
  res.status(404).json({
    error: "API route not found",
    method: req.method,
    path: req.originalUrl
  });
});

export default router;
