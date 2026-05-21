import { Router } from "express";
import { listJobs, triggerJobHandler, updateJobSchedule } from "../controllers/jobsController.js";

const router = Router();

router.get("/", listJobs);
router.post("/:name/trigger", triggerJobHandler);
router.patch("/:name/schedule", updateJobSchedule);

export default router;
