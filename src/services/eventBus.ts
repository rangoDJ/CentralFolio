import { EventEmitter } from "events";
import type { JobState } from "./schedulerService.js";
// Type-only — logger.ts imports emitLog (a value) from this module, so this
// module must never import a *value* back from logger.ts or the two would
// form a require cycle. A `type` import is erased at compile time and safe.
import type { LogEntry } from "../utils/logger.js";

/**
 * Domains of cached data the UI renders. When data in one of these changes,
 * the backend pushes a `data-changed` event so connected clients can refresh
 * the affected views (and anything derived from them) without a manual reload.
 */
export type DataDomain = 'holdings' | 'accounts' | 'transactions' | 'dividends' | 'targets' | 'priceHistory';

export interface DataChangedEvent {
  type: 'data-changed';
  domain: DataDomain;
}

export interface JobStatusEvent {
  type: 'job-status';
  job: JobState;
}

export interface LogEvent {
  type: 'log';
  entry: LogEntry;
}

export type BusEvent = DataChangedEvent | JobStatusEvent | LogEvent;
export type BusListener = (event: BusEvent) => void;

// A single process-wide emitter. Repositories/services publish to it; the SSE
// endpoint subscribes per connected client. No external deps → safe to import
// from anywhere (including repositories) without creating import cycles.
const emitter = new EventEmitter();
// Each SSE connection registers a listener; allow plenty of concurrent clients.
emitter.setMaxListeners(0);

const CHANNEL = 'bus';

export function emitDataChanged(domain: DataDomain): void {
  emitter.emit(CHANNEL, { type: 'data-changed', domain } as DataChangedEvent);
}

export function emitJobStatus(job: JobState): void {
  emitter.emit(CHANNEL, { type: 'job-status', job } as JobStatusEvent);
}

/** Broadcasts one log line to every connected SSE client (Settings → Logs). */
export function emitLog(entry: LogEntry): void {
  emitter.emit(CHANNEL, { type: 'log', entry } as LogEvent);
}

export function subscribe(listener: BusListener): void {
  emitter.on(CHANNEL, listener);
}

export function unsubscribe(listener: BusListener): void {
  emitter.off(CHANNEL, listener);
}
