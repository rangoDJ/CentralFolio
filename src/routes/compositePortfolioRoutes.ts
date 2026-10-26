import { Router } from "express";
import {
  listCompositePortfoliosHandler,
  createCompositePortfolioHandler,
  deleteCompositePortfolioHandler,
  clonePortfolioHandler
} from "../controllers/compositePortfolioController.js";

const router = Router();

router.get("/", listCompositePortfoliosHandler);
router.post("/", createCompositePortfolioHandler);
router.delete("/:id", deleteCompositePortfolioHandler);
router.post("/:id/clone", clonePortfolioHandler);

export default router;
