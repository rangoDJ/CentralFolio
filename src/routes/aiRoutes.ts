import { Router } from "express";
import { chatHandler, testConnectionHandler } from "../controllers/aiController.js";

const router = Router();

router.post("/chat", chatHandler);
router.post("/test", testConnectionHandler);

export default router;
