import { Router } from "express";
import { getAuthStatus, setup, login, changePassword } from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/status", getAuthStatus);
router.post("/setup", setup);
router.post("/login", login);
router.post("/change-password", requireAuth, changePassword);

export default router;
