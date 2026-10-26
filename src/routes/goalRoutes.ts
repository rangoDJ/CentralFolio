import { Router } from "express";
import {
  listGoalsHandler,
  createGoalHandler,
  updateGoalHandler,
  deleteGoalHandler,
} from "../controllers/goalController.js";

const router = Router();

router.get("/", listGoalsHandler);
router.post("/", createGoalHandler);
router.put("/:id", updateGoalHandler);
router.delete("/:id", deleteGoalHandler);

export default router;
