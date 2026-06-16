import { db } from "../models/database.js";

export interface JobStateDB {
  name: string;
  status: string;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: number | null;
}

export interface JobRunDB {
  id?: number;
  jobName: string;
  triggerType: string;
  status: string;
  startedAt: number;
  durationMs: number | null;
  error: string | null;
  info: string | null;
}

// ── Prepared Statements ───────────────────────────────────────────────────────

const stmtGetJobState = db.prepare("SELECT * FROM job_states WHERE name = ?");

const stmtSaveJobState = db.prepare(`
  INSERT OR REPLACE INTO job_states (name, status, lastRunAt, lastDurationMs, lastError, nextRunAt)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const stmtAddJobRun = db.prepare(`
  INSERT INTO job_runs (jobName, triggerType, status, startedAt, durationMs, error, info)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetJobRuns = db.prepare("SELECT * FROM job_runs ORDER BY startedAt DESC LIMIT 50");

// ── Repository Functions ─────────────────────────────────────────────────────

export function getJobState(name: string): JobStateDB | null {
  const row = stmtGetJobState.get(name) as JobStateDB | undefined;
  return row || null;
}

export function saveJobState(state: JobStateDB): void {
  stmtSaveJobState.run(
    state.name,
    state.status,
    state.lastRunAt,
    state.lastDurationMs,
    state.lastError,
    state.nextRunAt
  );
}

export function addJobRun(run: JobRunDB): number {
  const info = stmtAddJobRun.run(
    run.jobName,
    run.triggerType,
    run.status,
    run.startedAt,
    run.durationMs,
    run.error,
    run.info
  );
  return Number(info.lastInsertRowid);
}

export function getJobRuns(): JobRunDB[] {
  return stmtGetJobRuns.all() as JobRunDB[];
}
