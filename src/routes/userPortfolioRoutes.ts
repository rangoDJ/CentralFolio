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
} from "../controllers/rebalanceController.js";

const router = Router();

router.get("/", listUserPortfolios);
router.post("/", createUserPortfolioHandler);
router.patch("/:id", updateUserPortfolioHandler);
router.delete("/:id", deleteUserPortfolioHandler);
router.put("/:id/accounts", setPortfolioAccountsHandler);

// Rebalancing routes
router.get("/:id/targets", getTargets);
router.put("/:id/targets", updateTargets);
router.get("/:id/rebalance", getRebalanceSuggestions);
router.post("/:id/rebalance/execute", executeRebalance);

export default router;
