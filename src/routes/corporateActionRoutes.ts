import { Router } from "express";
import {
  listCorporateActionsHandler,
  createCorporateActionHandler,
  deleteCorporateActionHandler
} from "../controllers/corporateActionController.js";

const router = Router();

router.get("/", listCorporateActionsHandler);
router.post("/", createCorporateActionHandler);
router.delete("/:id", deleteCorporateActionHandler);

export default router;
