import { Router } from "express";
import portfolioRoutes from "./portfolioRoutes.js";
import snapTradeRoutes from "./snapTradeRoutes.js";
import adminRoutes from "./adminRoutes.js";
import jobRoutes from "./jobRoutes.js";
import userPortfolioRoutes from "./userPortfolioRoutes.js";
import { streamEvents } from "../controllers/eventsController.js";

const router = Router();

// Live updates (Server-Sent Events). Mounted before the catch-all 404.
router.get("/events", streamEvents);

// Sub-routes
router.use("/portfolios", portfolioRoutes);
router.use("/admin", adminRoutes);
router.use("/jobs", jobRoutes);
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
