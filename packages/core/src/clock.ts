/**
 * Time is injected, never read ambiently. Expiry, defer windows and audit
 * timestamps all flow through here so tests (and replays) are deterministic.
 */
export interface Clock {
  /** Milliseconds since epoch. */
  now(): number;
  /** ISO-8601 string for `now()`. */
  iso(): string;
}

export function systemClock(): Clock {
  return {
    now: () => Date.now(),
    iso: () => new Date().toISOString(),
  };
}

/** Test/replay helper: a clock the caller advances by hand. */
export function fixedClock(startMs: number | string): Clock & { advance(ms: number): void; set(ms: number | string): void } {
  let current = typeof startMs === 'string' ? Date.parse(startMs) : startMs;
  return {
    now: () => current,
    iso: () => new Date(current).toISOString(),
    advance: (ms: number) => {
      current += ms;
    },
    set: (ms: number | string) => {
      current = typeof ms === 'string' ? Date.parse(ms) : ms;
    },
  };
}
