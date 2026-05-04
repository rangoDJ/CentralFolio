import { Router } from "express";
import { getPortfolios, createOrUpdatePortfolio, removePortfolio, getAllDividends } from "../controllers/portfolioController.js";

const router = Router();

router.get("/", getPortfolios);
router.get("/all-dividends", getAllDividends);
router.post("/", createOrUpdatePortfolio);
router.delete("/:id", removePortfolio);

export default router;
