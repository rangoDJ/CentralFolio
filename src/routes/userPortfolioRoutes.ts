import { Router } from "express";
import {
  listUserPortfolios,
  createUserPortfolioHandler,
  updateUserPortfolioHandler,
  deleteUserPortfolioHandler,
  setPortfolioAccountsHandler,
} from "../controllers/userPortfolioController.js";
import {
  getTargets,
  updateTargets,
  getRebalanceSuggestions,
  executeRebalance,
  confirmRebalance,
} from "../controllers/rebalanceController.js";
import { comparePortfoliosHandler } from "../controllers/portfolioCompareController.js";
import { validateBody } from "../middleware/validate.js";
import { confirmOrderSchema } from "../schemas/tradeSchema.js";

const router = Router();

router.get("/", listUserPortfolios);
// Registered before the ":id" routes so "compare" is never read as an id.
router.get("/compare", comparePortfoliosHandler);
router.post("/", createUserPortfolioHandler);
router.patch("/:id", updateUserPortfolioHandler);
router.delete("/:id", deleteUserPortfolioHandler);
router.put("/:id/accounts", setPortfolioAccountsHandler);

// Rebalancing routes
router.get("/:id/targets", getTargets);
router.put("/:id/targets", updateTargets);
router.get("/:id/rebalance", getRebalanceSuggestions);
router.post("/:id/rebalance/execute", executeRebalance);
router.post("/:id/rebalance/confirm", validateBody(confirmOrderSchema), confirmRebalance);

export default router;
