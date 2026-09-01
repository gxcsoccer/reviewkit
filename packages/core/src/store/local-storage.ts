/**
 * Browser local state store (PRD 9.1, 13: state survives a page refresh).
 *
 * Notes for hosts:
 *  - business data stays in the browser; nothing is sent anywhere (PRD 12.1);
 *  - `localStorage` is synchronous and origin-scoped, so this is safe for a single
 *    tab. Multi-tab or multi-reviewer setups need a host store with real
 *    compare-and-set — the optimistic-lock errors are the same either way;
 *  - a quota error is reported as E_STORE with an actionable hint instead of a
 *    raw DOMException.
 */
import { ReviewKitError } from '../errors.js';
import { createKeyValueStore } from './kv.js';
import type { KeyValueAdapter, ReviewStore } from './types.js';

export interface LocalStorageStoreOptions {
  /** Key prefix, so several apps can share an origin. Default `reviewkit`. */
  namespace?: string;
  /** Defaults to `globalThis.localStorage`; pass `sessionStorage` or a shim. */
  storage?: Storage;
}

export function createWebStorageAdapter(options: LocalStorageStoreOptions = {}): KeyValueAdapter {
  const namespace = options.namespace ?? 'reviewkit';
  const storage = options.storage ?? (globalThis as { localStorage?: Storage }).localStorage;

  if (!storage) {
    throw new ReviewKitError({
      code: 'E_STORE',
      message: 'No Web Storage available',
      hint: 'Pass `storage` explicitly, or use createMemoryStore() on the server / in non-DOM environments.',
    });
  }

  const full = (key: string) => `${namespace}:${key}`;

  return {
    get: (key) => storage.getItem(full(key)),
    set: (key, value) => {
      try {
        storage.setItem(full(key), value);
      } catch (error) {
        throw new ReviewKitError({
          code: 'E_STORE',
          message: `Web Storage rejected a write (${(error as Error).name})`,
          hint:
            'Usually the 5 MB quota. Trim before/after payloads, keep fewer proposals client-side, or swap in a host store (docs/api-core.md#stores).',
          details: { key: full(key), bytes: value.length },
          cause: error,
        });
      }
    },
    delete: (key) => storage.removeItem(full(key)),
    keys: (prefix) => {
      const out: string[] = [];
      const search = full(prefix);
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null && key.startsWith(search)) out.push(key.slice(namespace.length + 1));
      }
      return out;
    },
  };
}

export function createLocalStorageStore(options: LocalStorageStoreOptions = {}): ReviewStore {
  return createKeyValueStore(createWebStorageAdapter(options));
}
