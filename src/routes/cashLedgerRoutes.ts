import { Router } from "express";
import {
  listCashTransactionsHandler,
  getCashSummaryHandler,
  createCashTransactionHandler,
  deleteCashTransactionHandler
} from "../controllers/cashLedgerController.js";

const router = Router();

router.get("/transactions", listCashTransactionsHandler);
router.get("/summary", getCashSummaryHandler);
router.post("/transactions", createCashTransactionHandler);
router.delete("/transactions/:id", deleteCashTransactionHandler);

export default router;
