import { Router } from "express";
import { listUsers, deleteUser, wipeAllUsers, getSettings, updateSettings, clearCache } from "../controllers/adminController.js";

const router = Router();

router.get("/users", listUsers);
router.delete("/users/:userId", deleteUser);
router.post("/wipe", wipeAllUsers);
router.post("/clear-cache", clearCache);
router.get("/settings", getSettings);
router.post("/settings", updateSettings);

export default router;
