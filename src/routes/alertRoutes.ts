import { Router } from "express";
import {
  listRulesHandler,
  saveRuleHandler,
  listAlertsHandler,
  evaluateHandler,
  acknowledgeHandler,
  acknowledgeAllHandler,
  clearAlertsHandler,
} from "../controllers/alertController.js";

const router = Router();

router.get("/", listAlertsHandler);
router.delete("/", clearAlertsHandler);

// Literal paths first, so none of them is read as an ":id".
router.get("/rules", listRulesHandler);
router.put("/rules/:type", saveRuleHandler);
router.post("/evaluate", evaluateHandler);
router.post("/acknowledge-all", acknowledgeAllHandler);

router.post("/:id/acknowledge", acknowledgeHandler);

export default router;
