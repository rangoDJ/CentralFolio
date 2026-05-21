import { Router } from "express";
import {
  listUserPortfolios,
  createUserPortfolioHandler,
  updateUserPortfolioHandler,
  deleteUserPortfolioHandler,
  setPortfolioAccountsHandler,
} from "../controllers/userPortfolioController.js";

const router = Router();

router.get("/", listUserPortfolios);
router.post("/", createUserPortfolioHandler);
router.patch("/:id", updateUserPortfolioHandler);
router.delete("/:id", deleteUserPortfolioHandler);
router.put("/:id/accounts", setPortfolioAccountsHandler);

export default router;
