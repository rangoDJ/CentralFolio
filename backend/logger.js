/**
 * Structured logger with configurable LOG_LEVEL.
 *
 * Levels (set via LOG_LEVEL env var):
 *   VERBOSE  – everything including fine-grained trace output
 *   DEBUG    – debug + info + warn + error
 *   INFO     – info + warn + error  (default)
 *   WARNING  – warn + error only
 *   ERROR    – errors only
 *
 * Output is newline-delimited JSON so Docker / log aggregators can parse it.
 * Each line: { ts, level, component, msg, ...extra }
 */

const LEVELS = { VERBOSE: 0, DEBUG: 1, INFO: 2, WARNING: 3, ERROR: 4 };

const raw = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
const ACTIVE_LEVEL = LEVELS[raw] ?? LEVELS.INFO;

if (LEVELS[raw] === undefined) {
  process.stderr.write(
    JSON.stringify({ ts: new Date().toISOString(), level: 'WARNING', component: 'logger',
      msg: `Unknown LOG_LEVEL="${process.env.LOG_LEVEL}", defaulting to INFO` }) + '\n'
  );
}

function write(levelStr, component, msg, extra = {}) {
  if (LEVELS[levelStr] < ACTIVE_LEVEL) return;

  const entry = {
    ts: new Date().toISOString(),
    level: levelStr,
    component,
    msg,
    ...extra
  };

  const line = JSON.stringify(entry) + '\n';
  if (LEVELS[levelStr] >= LEVELS.WARNING) {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

function makeLogger(component) {
  return {
    verbose: (msg, extra) => write('VERBOSE', component, msg, extra),
    debug:   (msg, extra) => write('DEBUG',   component, msg, extra),
    info:    (msg, extra) => write('INFO',    component, msg, extra),
    warn:    (msg, extra) => write('WARNING', component, msg, extra),
    error:   (msg, extra) => write('ERROR',   component, msg, extra),
  };
}

// Root logger — can also call makeLogger() for scoped loggers
const logger = makeLogger('app');
logger.make = makeLogger;
logger.activeLevel = raw;

module.exports = logger;
