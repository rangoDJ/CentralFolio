import { Request, Response } from "express";
import { getAllJobStatuses, getJobStatus, triggerJob, updateJobInterval } from "../services/schedulerService.js";
import { setSetting } from "../models/db.js";
import { logger } from "../utils/logger.js";

export const listJobs = (req: Request, res: Response) => {
  res.json(getAllJobStatuses());
};

export const updateJobSchedule = (req: Request, res: Response) => {
  const { name } = req.params;
  const { intervalHours } = req.body;

  const status = getJobStatus(name);
  if (!status) return res.status(404).json({ error: `Job "${name}" not found` });

  const h = parseFloat(intervalHours);
  if (isNaN(h) || h < 0) {
    return res.status(400).json({ error: 'intervalHours must be a non-negative number (0 = manual only)' });
  }
  if (h > 0 && h < 0.1) {
    return res.status(400).json({ error: 'intervalHours must be at least 0.1 (6 minutes) or 0 for manual-only' });
  }

  const newIntervalMs = h === 0 ? null : Math.round(h * 3_600_000);
  setSetting(`job_${name}_interval_hours`, String(h));
  updateJobInterval(name, newIntervalMs);

  logger.info('Jobs', `Schedule updated: "${name}" → ${h === 0 ? 'manual' : h + 'h'}`);
  res.json({ success: true, name, intervalHours: h, intervalMs: newIntervalMs });
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
