/**
 * Callback events (PRD 9.1 "idempotency keys and callback events", 11.3).
 *
 * Two guarantees hosts rely on:
 *
 *  1. **Idempotent delivery** — an event id is delivered at most once per
 *     listener, so a retried webhook or a double-mounted React tree cannot
 *     produce two "execution requested" side effects.
 *  2. **Listener isolation** — a throwing listener never breaks a state
 *     transition; the error is routed to `onError`.
 */
import type { EventListener, ReviewEvent, ReviewEventName } from './types.js';

export interface EventEmitter {
  emit(event: ReviewEvent): Promise<void>;
  /** Subscribe to one event name, or `'*'` for all. Returns an unsubscribe function. */
  on(name: ReviewEventName | '*', listener: EventListener): () => void;
  /** Number of event ids remembered for deduplication. */
  seenCount(): number;
}

export interface EventEmitterOptions {
  onError?: (error: unknown, event: ReviewEvent) => void;
  /** Remember this many event ids for deduplication. Default 500. */
  dedupeWindow?: number;
  listeners?: Partial<Record<ReviewEventName | '*', EventListener[]>>;
}

export function createEventEmitter(options: EventEmitterOptions = {}): EventEmitter {
  const dedupeWindow = options.dedupeWindow ?? 500;
  const listeners = new Map<string, Set<EventListener>>();
  // Insertion-ordered set doubles as an LRU queue.
  const delivered = new Set<string>();

  for (const [name, fns] of Object.entries(options.listeners ?? {})) {
    for (const fn of fns ?? []) {
      const set = listeners.get(name) ?? new Set();
      set.add(fn);
      listeners.set(name, set);
    }
  }

  const remember = (id: string): boolean => {
    if (delivered.has(id)) return false;
    delivered.add(id);
    if (delivered.size > dedupeWindow) {
      const oldest = delivered.values().next();
      if (!oldest.done) delivered.delete(oldest.value);
    }
    return true;
  };

  return {
    async emit(event) {
      if (!remember(event.id)) return;
      const targets = [...(listeners.get(event.name) ?? []), ...(listeners.get('*') ?? [])];
      for (const listener of targets) {
        try {
          await listener(event);
        } catch (error) {
          options.onError?.(error, event);
        }
      }
    },
    on(name, listener) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => {
        set.delete(listener);
      };
    },
    seenCount: () => delivered.size,
  };
}
