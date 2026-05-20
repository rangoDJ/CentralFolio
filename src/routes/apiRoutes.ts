import { Router } from "express";
import portfolioRoutes from "./portfolioRoutes.js";
import snapTradeRoutes from "./snapTradeRoutes.js";
import adminRoutes from "./adminRoutes.js";
import jobRoutes from "./jobRoutes.js";

const router = Router();

// Sub-routes
router.use("/portfolios", portfolioRoutes);
router.use("/admin", adminRoutes);
router.use("/jobs", jobRoutes);
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
