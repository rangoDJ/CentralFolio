import { Router } from "express";
import portfolioRoutes from "./portfolioRoutes.js";
import snapTradeRoutes from "./snapTradeRoutes.js";
import adminRoutes from "./adminRoutes.js";

const router = Router();

// Sub-routes
router.use("/portfolios", portfolioRoutes);
router.use("/admin", adminRoutes);
router.use("/", snapTradeRoutes); // Mount at root of /api since it has its own prefixes

// Catch-all for /api/* routes that didn't match
router.use((req, res) => {
  console.log(`[API] 404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: "API route not found",
    method: req.method,
    path: req.originalUrl 
  });
});

export default router;
