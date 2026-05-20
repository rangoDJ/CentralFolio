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
}

type JobFn = () => Promise<void>;

interface RegisteredJob {
  state: JobState;
  fn: JobFn;
  timer: ReturnType<typeof setInterval> | null;
}

const registry = new Map<string, RegisteredJob>();

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
  };

  const job: RegisteredJob = { state, fn, timer: null };
  registry.set(name, job);

  if (runOnStartup) {
    setTimeout(() => triggerJob(name, 'startup'), startupDelayMs);
  }

  if (intervalMs) {
    const firstDelay = runOnStartup ? intervalMs : intervalMs;
    setTimeout(() => {
      runJob(job, 'scheduled');
      job.timer = setInterval(() => runJob(job, 'scheduled'), intervalMs);
    }, runOnStartup ? intervalMs : intervalMs);
  }

  logger.info('Scheduler', `Registered job "${name}" — interval=${intervalMs ? intervalMs / 1000 / 60 + 'min' : 'manual'} runOnStartup=${runOnStartup}`);
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
    if (job.state.intervalMs) {
      job.state.nextRunAt = Date.now() + job.state.intervalMs;
    }
    logger.info('Scheduler', `Job "${job.state.name}" completed in ${job.state.lastDurationMs}ms`);
  } catch (err: any) {
    job.state.status = 'failed';
    job.state.lastDurationMs = Date.now() - start;
    job.state.lastRunAt = start;
    job.state.lastError = err.message;
    if (job.state.intervalMs) {
      job.state.nextRunAt = Date.now() + job.state.intervalMs;
    }
    logger.error('Scheduler', `Job "${job.state.name}" failed after ${job.state.lastDurationMs}ms: ${err.message}`);
  }
}

export function triggerJob(name: string, trigger = 'manual'): boolean {
  const job = registry.get(name);
  if (!job) {
    logger.warn('Scheduler', `triggerJob("${name}") — job not found`);
    return false;
  }
  // Fire and forget — does not block caller
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
