import { Router } from "express";
import { listUsers, deleteUser, wipeAllUsers, getSettings, updateSettings, clearCache, purgeData, testNotification } from "../controllers/adminController.js";

const router = Router();

router.get("/users", listUsers);
router.delete("/users/:userId", deleteUser);
router.post("/wipe", wipeAllUsers);
router.post("/purge-data", purgeData);
router.post("/clear-cache", clearCache);
router.get("/settings", getSettings);
router.post("/settings", updateSettings);
router.post("/test-notification", testNotification);

export default router;
