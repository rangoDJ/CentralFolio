import { Router } from "express";
import { listJobs, triggerJobHandler, updateJobSchedule, listJobHistory } from "../controllers/jobsController.js";

const router = Router();

router.get("/", listJobs);
router.get("/history", listJobHistory);
router.post("/:name/trigger", triggerJobHandler);
router.patch("/:name/schedule", updateJobSchedule);

export default router;
