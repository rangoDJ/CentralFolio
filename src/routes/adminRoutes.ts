import { Router } from "express";
import { listUsers, deleteUser, wipeAllUsers } from "../controllers/adminController.js";

const router = Router();

router.get("/users", listUsers);
router.delete("/users/:userId", deleteUser);
router.post("/wipe", wipeAllUsers);

export default router;
