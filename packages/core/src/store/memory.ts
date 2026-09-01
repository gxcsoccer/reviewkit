/**
 * In-memory store. The default when a host passes nothing — good for tests,
 * server-side request scope, and the "first proposal in 10 minutes" path.
 */
import { createKeyValueStore } from './kv.js';
import type { KeyValueAdapter, ReviewStore } from './types.js';

export function createMemoryAdapter(seed?: Map<string, string>): KeyValueAdapter {
  const map = seed ?? new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    delete: (key) => {
      map.delete(key);
    },
    keys: (prefix) => [...map.keys()].filter((key) => key.startsWith(prefix)),
  };
}

export function createMemoryStore(): ReviewStore {
  return createKeyValueStore(createMemoryAdapter());
}
