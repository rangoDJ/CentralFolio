import { logger } from "../utils/logger.js";

export type JobStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface JobState {
  name: string;
  label: string;
  status: JobStatus;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: number | null;
  intervalMs: number | null;
  defaultIntervalMs: number | null;
}

type JobFn = () => Promise<void>;

interface RegisteredJob {
  state: JobState;
  fn: JobFn;
  intervalTimer: ReturnType<typeof setInterval> | null;
  startupTimer: ReturnType<typeof setTimeout> | null;
}

const registry = new Map<string, RegisteredJob>();

// ── Internal helpers ───────────────────────────────────────────────────────────

function armInterval(job: RegisteredJob): void {
  if (job.intervalTimer) {
    clearInterval(job.intervalTimer);
    job.intervalTimer = null;
  }
  const ms = job.state.intervalMs;
  if (!ms) return;
  job.intervalTimer = setInterval(() => runJob(job, 'scheduled'), ms);
  job.state.nextRunAt = Date.now() + ms;
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

  try {
    await job.fn();
    job.state.status = 'completed';
    job.state.lastDurationMs = Date.now() - start;
    job.state.lastRunAt = start;
    if (job.state.intervalMs) job.state.nextRunAt = Date.now() + job.state.intervalMs;
    logger.info('Scheduler', `Job "${job.state.name}" completed in ${job.state.lastDurationMs}ms`);
  } catch (err: any) {
    job.state.status = 'failed';
    job.state.lastDurationMs = Date.now() - start;
    job.state.lastRunAt = start;
    job.state.lastError = err.message;
    if (job.state.intervalMs) job.state.nextRunAt = Date.now() + job.state.intervalMs;
    logger.error('Scheduler', `Job "${job.state.name}" failed after ${job.state.lastDurationMs}ms: ${err.message}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function registerJob(
  name: string,
  label: string,
  intervalMs: number | null,
  fn: JobFn,
  runOnStartup = false,
  startupDelayMs = 10_000
): void {
  const state: JobState = {
    name,
    label,
    status: 'idle',
    lastRunAt: null,
    lastDurationMs: null,
    lastError: null,
    nextRunAt: intervalMs ? Date.now() + (runOnStartup ? startupDelayMs : intervalMs) : null,
    intervalMs,
    defaultIntervalMs: intervalMs,
  };

  const job: RegisteredJob = { state, fn, intervalTimer: null, startupTimer: null };
  registry.set(name, job);

  if (runOnStartup) {
    job.startupTimer = setTimeout(() => {
      job.startupTimer = null;
      triggerJob(name, 'startup');
    }, startupDelayMs);
  }

  if (intervalMs) {
    // First scheduled run fires after one full interval (startup handled separately above)
    const firstFireMs = runOnStartup ? intervalMs : intervalMs;
    job.startupTimer = setTimeout(() => {
      job.startupTimer = null;
      armInterval(job);
    }, firstFireMs);
  }

  const intervalLabel = intervalMs ? `${Math.round(intervalMs / 3_600_000 * 10) / 10}h` : 'manual';
  logger.info('Scheduler', `Registered job "${name}" — interval=${intervalLabel} runOnStartup=${runOnStartup}`);
}

/**
 * Update a job's recurring interval on the fly.
 * Clears any pending timers and arms a new setInterval immediately.
 * Pass null to make the job manual-only.
 */
export function updateJobInterval(name: string, newIntervalMs: number | null): boolean {
  const job = registry.get(name);
  if (!job) {
    logger.warn('Scheduler', `updateJobInterval("${name}") — job not found`);
    return false;
  }

  // Cancel pending startup/first-fire timer
  if (job.startupTimer) {
    clearTimeout(job.startupTimer);
    job.startupTimer = null;
  }

  // Clear existing interval
  if (job.intervalTimer) {
    clearInterval(job.intervalTimer);
    job.intervalTimer = null;
  }

  job.state.intervalMs = newIntervalMs;
  job.state.nextRunAt = newIntervalMs ? Date.now() + newIntervalMs : null;

  if (newIntervalMs) armInterval(job);

  const label = newIntervalMs ? `${Math.round(newIntervalMs / 3_600_000 * 10) / 10}h` : 'manual';
  logger.info('Scheduler', `Job "${name}" interval updated → ${label}`);
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
