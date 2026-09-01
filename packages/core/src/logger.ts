/**
 * Diagnostic logging that cannot leak business data by accident.
 *
 * PRD 12.4 / 20: logs must not print full proposal content. Rather than trusting
 * every call site, the logger *scrubs* its own fields: any key that usually holds
 * payload (`before`, `after`, `items`, `payload`, `summary`, `reason`, `evidence`)
 * is replaced with a shape marker such as `[object x12]`. Hosts that really want
 * payloads in their logs pass `allowPayload: true` explicitly.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogRecord {
  level: Exclude<LogLevel, 'silent'>;
  message: string;
  fields: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Logger with additional fields merged into every record. */
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Where records go. Default: `console`, prefixed with `[reviewkit]`. */
  sink?: (record: LogRecord) => void;
  /** Opt out of scrubbing. Off by default, on purpose. */
  allowPayload?: boolean;
  fields?: Record<string, unknown>;
}

const LEVELS: Record<Exclude<LogLevel, 'silent'>, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const PAYLOAD_KEYS = new Set([
  'before',
  'after',
  'items',
  'payload',
  'summary',
  'reason',
  'evidence',
  'data',
  'proposal',
  'decision',
  'receipt',
  'value',
]);

function shapeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[array x${value.length}]`;
  if (typeof value === 'object') return `[object x${Object.keys(value as object).length}]`;
  if (typeof value === 'string') return `[string ${value.length} chars]`;
  return `[${typeof value}]`;
}

function scrub(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = PAYLOAD_KEYS.has(key) ? shapeOf(value) : value;
  }
  return out;
}

function defaultSink(record: LogRecord): void {
  const line = `[reviewkit] ${record.message}`;
  const method = record.level === 'debug' ? 'log' : record.level;
  // eslint-disable-next-line no-console
  const fn = (console as unknown as Record<string, (...args: unknown[]) => void>)[method] ?? console.log;
  if (Object.keys(record.fields).length === 0) fn(line);
  else fn(line, record.fields);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'warn';
  const sink = options.sink ?? defaultSink;
  const base = options.fields ?? {};
  const allowPayload = options.allowPayload ?? false;

  const write = (recordLevel: Exclude<LogLevel, 'silent'>, message: string, fields?: Record<string, unknown>) => {
    if (level === 'silent' || LEVELS[recordLevel] < LEVELS[level]) return;
    const merged = { ...base, ...(fields ?? {}) };
    sink({ level: recordLevel, message, fields: allowPayload ? merged : scrub(merged) });
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger({ ...options, level, fields: { ...base, ...fields } }),
  };
}

/** Logger that swallows everything. Default inside tests and inside `session` when unset. */
export function silentLogger(): Logger {
  return createLogger({ level: 'silent' });
}
