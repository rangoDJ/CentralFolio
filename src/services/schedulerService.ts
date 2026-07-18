import cron from "node-cron";
import { logger } from "../utils/logger.js";
import { emitJobStatus } from "./eventBus.js";
import { getJobState, saveJobState, addJobRun } from "../models/db.js";
import { sendWebhookNotification } from "./notificationService.js";

export type JobStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface JobState {
  name: string;
  label: string;
  status: JobStatus;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: number | null;
  /** The raw cron expression, or null for manual-only jobs */
  cronExpression: string | null;
  /** Kept for UI compatibility — derived from the cron expression when set */
  intervalMs: number | null;
  defaultIntervalMs: number | null;
}

type JobFn = (trigger: string) => Promise<string | void> | string | void;

interface RegisteredJob {
  state: JobState;
  fn: JobFn;
  task: any | null;
  startupTimer: ReturnType<typeof setTimeout> | null;
}

const registry = new Map<string, RegisteredJob>();

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert hours → a cron expression that fires every N hours.
 * Fractional hours (< 1) are converted to minutes.
 * Returns null for 0 (manual-only).
 */
export function hoursToCron(hours: number): string | null {
  if (!hours || hours <= 0) return null;
  if (hours < 1) {
    const minutes = Math.max(1, Math.min(59, Math.round(hours * 60)));
    return `*/${minutes} * * * *`;
  }
  if (hours < 24) {
    const roundedHours = Math.max(1, Math.min(23, Math.round(hours)));
    return `0 */${roundedHours} * * *`;
  }
  const days = Math.max(1, Math.round(hours / 24));
  return `0 0 */${days} * *`;
}

function nextRunFromCron(expression: string): number {
  // node-cron does not expose the next-run date, so we approximate:
  // parse the fields if they follow step patterns or daily/weekly bounds.
  try {
    const parts = expression.split(' ');
    const minutePart = parts[0];
    const hourPart   = parts[1];
    const now = Date.now();

    if (minutePart === '0' && hourPart === '0' && parts[2].startsWith('*/')) {
      const d = parseInt(parts[2].slice(2), 10);
      return now + d * 24 * 60 * 60 * 1000;
    }
    if (minutePart === '0' && hourPart === '0' && parts[2] === '*') {
      return now + 24 * 60 * 60 * 1000;
    }
    if (minutePart === '0' && hourPart.startsWith('*/')) {
      const h = parseInt(hourPart.slice(2), 10);
      return now + h * 60 * 60 * 1000;
    }
    if (minutePart.startsWith('*/')) {
      const m = parseInt(minutePart.slice(2), 10);
      return now + m * 60 * 1000;
    }
  } catch (_) {}
  return Date.now() + 60 * 60 * 1000; // fallback: 1h
}

async function runJob(job: RegisteredJob, trigger: string): Promise<void> {
  if (job.state.status === 'running') {
    logger.warn('Scheduler', `Job "${job.state.name}" already running — skipping ${trigger} trigger`);
    return;
  }

  const start = Date.now();
  job.state.status = 'running';
  job.state.lastError = null;
  logger.info('Scheduler', `Job "${job.state.name}" started (${trigger})`);
  saveJobState({
    name: job.state.name,
    status: 'running',
    lastRunAt: job.state.lastRunAt,
    lastDurationMs: job.state.lastDurationMs,
    lastError: null,
    nextRunAt: job.state.nextRunAt
  });
  emitJobStatus(job.state);

  try {
    const result = await job.fn(trigger);
    job.state.status = 'completed';
    job.state.lastDurationMs = Date.now() - start;
    job.state.lastRunAt = start;
    if (job.state.cronExpression) {
      job.state.nextRunAt = nextRunFromCron(job.state.cronExpression);
    }
    logger.info('Scheduler', `Job "${job.state.name}" completed in ${job.state.lastDurationMs}ms`);

    saveJobState({
      name: job.state.name,
      status: 'completed',
      lastRunAt: start,
      lastDurationMs: job.state.lastDurationMs,
      lastError: null,
      nextRunAt: job.state.nextRunAt
    });

    addJobRun({
      jobName: job.state.name,
      triggerType: trigger,
      status: 'completed',
      startedAt: start,
      durationMs: job.state.lastDurationMs,
      error: null,
      info: typeof result === 'string' ? result : null
    });
  } catch (err: any) {
    job.state.status = 'failed';
    job.state.lastDurationMs = Date.now() - start;
    job.state.lastRunAt = start;
    job.state.lastError = err.message;
    if (job.state.cronExpression) {
      job.state.nextRunAt = nextRunFromCron(job.state.cronExpression);
    }
    logger.error('Scheduler', `Job "${job.state.name}" failed after ${job.state.lastDurationMs}ms: ${err.message}`);

    saveJobState({
      name: job.state.name,
      status: 'failed',
      lastRunAt: start,
      lastDurationMs: job.state.lastDurationMs,
      lastError: err.message,
      nextRunAt: job.state.nextRunAt
    });

    addJobRun({
      jobName: job.state.name,
      triggerType: trigger,
      status: 'failed',
      startedAt: start,
      durationMs: job.state.lastDurationMs,
      error: err.message,
      info: null
    });

    void sendWebhookNotification(
      `${job.state.label} failed`,
      `Trigger: ${trigger} · Error: ${err.message}`
    );
  }
  emitJobStatus(job.state);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a recurring job with a cron expression.
 * Also accepts intervalMs for backwards-compat (converts to a cron expression).
 */
export function registerJob(
  name: string,
  label: string,
  intervalMs: number | null,
  fn: JobFn,
  runOnStartup = false,
  startupDelayMs = 10_000
): void {
  // Convert ms → hours → cron expression
  const hours = intervalMs ? intervalMs / (60 * 60 * 1000) : 0;
  const cronExpression = hoursToCron(hours);

  const persisted = getJobState(name);

  const state: JobState = {
    name,
    label,
    status: 'idle',
    lastRunAt: persisted?.lastRunAt ?? null,
    lastDurationMs: persisted?.lastDurationMs ?? null,
    lastError: persisted?.lastError ?? null,
    nextRunAt: cronExpression ? nextRunFromCron(cronExpression) : null,
    cronExpression,
    intervalMs,
    defaultIntervalMs: intervalMs,
  };

  saveJobState({
    name: state.name,
    status: state.status,
    lastRunAt: state.lastRunAt,
    lastDurationMs: state.lastDurationMs,
    lastError: state.lastError,
    nextRunAt: state.nextRunAt
  });

  const job: RegisteredJob = { state, fn, task: null, startupTimer: null };
  registry.set(name, job);

  // Schedule the recurring cron task
  if (cronExpression) {
    job.task = cron.schedule(cronExpression, () => runJob(job, 'scheduled'));
  }

  // Optional startup run with a delay
  if (runOnStartup) {
    job.startupTimer = setTimeout(() => {
      job.startupTimer = null;
      triggerJob(name, 'startup');
    }, startupDelayMs);
  }

  const intervalLabel = cronExpression ?? 'manual';
  logger.info('Scheduler', `Registered job "${name}" — cron="${intervalLabel}" runOnStartup=${runOnStartup}`);
}

/**
 * Update a job's recurring interval on the fly.
 * Pass null (or 0 hours) to make the job manual-only.
 * For UI compatibility, accepts ms value like the old API.
 */
export function updateJobInterval(name: string, newIntervalMs: number | null): boolean {
  const job = registry.get(name);
  if (!job) {
    logger.warn('Scheduler', `updateJobInterval("${name}") — job not found`);
    return false;
  }

  // Cancel any pending startup timer
  if (job.startupTimer) {
    clearTimeout(job.startupTimer);
    job.startupTimer = null;
  }

  // Stop the existing cron task
  if (job.task) {
    job.task.stop();
    job.task = null;
  }

  const hours = newIntervalMs ? newIntervalMs / (60 * 60 * 1000) : 0;
  const cronExpression = hoursToCron(hours);

  job.state.intervalMs = newIntervalMs;
  job.state.cronExpression = cronExpression;
  job.state.nextRunAt = cronExpression ? nextRunFromCron(cronExpression) : null;

  saveJobState({
    name: job.state.name,
    status: job.state.status,
    lastRunAt: job.state.lastRunAt,
    lastDurationMs: job.state.lastDurationMs,
    lastError: job.state.lastError,
    nextRunAt: job.state.nextRunAt
  });

  if (cronExpression) {
    job.task = cron.schedule(cronExpression, () => runJob(job, 'scheduled'));
  }

  const label = cronExpression ?? 'manual';
  logger.info('Scheduler', `Job "${name}" interval updated → cron="${label}"`);
  return true;
}

export function triggerJob(name: string, trigger = 'manual'): boolean {
  const job = registry.get(name);
  if (!job) {
    logger.warn('Scheduler', `triggerJob("${name}") — job not found`);
    return false;
  }
  runJob(job, trigger).catch(() => {});
  return true;
}

export function getJobStatus(name: string): JobState | null {
  return registry.get(name)?.state ?? null;
}

export function getAllJobStatuses(): JobState[] {
  return Array.from(registry.values()).map(j => j.state);
}

export function isJobRunning(name: string): boolean {
  return registry.get(name)?.state.status === 'running';
}
