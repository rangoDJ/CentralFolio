import { Router } from "express";
import { getApiTokens, postApiToken, deleteApiToken } from "../controllers/apiTokenController.js";

const router = Router();

router.get("/tokens", getApiTokens);
router.post("/tokens", postApiToken);
router.delete("/tokens/:id", deleteApiToken);

export default router;
