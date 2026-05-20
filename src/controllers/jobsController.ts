import { Request, Response } from "express";
import { getAllJobStatuses, getJobStatus, triggerJob } from "../services/schedulerService.js";
import { logger } from "../utils/logger.js";

export const listJobs = (req: Request, res: Response) => {
  res.json(getAllJobStatuses());
};

export const triggerJobHandler = (req: Request, res: Response) => {
  const { name } = req.params;
  const status = getJobStatus(name);
  if (!status) return res.status(404).json({ error: `Job "${name}" not found` });
  if (status.status === 'running') {
    return res.status(409).json({ error: `Job "${name}" is already running` });
  }
  const triggered = triggerJob(name, 'manual');
  logger.info('Jobs', `Manual trigger: "${name}" — success=${triggered}`);
  res.json({ success: triggered, name });
};
