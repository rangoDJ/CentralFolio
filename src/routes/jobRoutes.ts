import { Router } from "express";
import { listJobs, triggerJobHandler } from "../controllers/jobsController.js";

const router = Router();

router.get("/", listJobs);
router.post("/:name/trigger", triggerJobHandler);

export default router;
