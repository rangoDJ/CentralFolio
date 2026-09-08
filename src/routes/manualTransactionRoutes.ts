import { Router } from "express";
import {
  listManualTransactionsHandler,
  createManualTransactionHandler,
  updateManualTransactionHandler,
  deleteManualTransactionHandler,
  importManualTransactionsHandler,
  importTemplateHandler,
} from "../controllers/manualTransactionController.js";
import { validateBody } from "../middleware/validate.js";
import { manualTransactionSchema } from "../schemas/manualTransactionSchema.js";

const router = Router();

router.get("/", listManualTransactionsHandler);
// Registered before "/:id" so neither literal path is read as an id.
router.get("/template.csv", importTemplateHandler);
router.post("/import", importManualTransactionsHandler);

router.post("/", validateBody(manualTransactionSchema), createManualTransactionHandler);
router.patch("/:id", validateBody(manualTransactionSchema), updateManualTransactionHandler);
router.delete("/:id", deleteManualTransactionHandler);

export default router;
