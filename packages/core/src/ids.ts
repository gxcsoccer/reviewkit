/**
 * Id generation. Injectable, because hosts usually want their own id scheme and
 * tests want stable output.
 *
 * Default format: `<prefix>_<time-base32><random-base32>` — lexicographically
 * sortable by creation time, no dependency on `uuid`.
 */
import type { Clock } from './clock.js';

export type IdKind = 'proposal' | 'decision' | 'request' | 'receipt' | 'event' | 'item';

export type IdGenerator = (kind: IdKind) => string;

const PREFIX: Record<IdKind, string> = {
  proposal: 'act',
  decision: 'dec',
  request: 'exr',
  receipt: 'rcp',
  event: 'evt',
  item: 'itm',
};

// Crockford base32 without I, L, O, U — avoids look-alike characters in ids that
// reviewers may read out loud or paste into a ticket.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBase32(value: number, length: number): string {
  let out = '';
  let n = value;
  for (let i = 0; i < length; i++) {
    out = ALPHABET[n % 32]! + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webcrypto?.getRandomValues) {
    webcrypto.getRandomValues(bytes);
    return bytes;
  }
  // Non-cryptographic fallback: ids are collision-avoidance handles, not secrets.
  for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

export function createIdGenerator(options: { clock?: Clock; random?: () => Uint8Array } = {}): IdGenerator {
  const random = options.random ?? (() => randomBytes(8));
  let lastTime = -1;
  let counter = 0;
  return (kind: IdKind) => {
    const nowMs = options.clock ? options.clock.now() : Date.now();
    if (nowMs === lastTime) counter += 1;
    else {
      lastTime = nowMs;
      counter = 0;
    }
    const bytes = random();
    let tail = '';
    for (const byte of bytes) tail += ALPHABET[byte % 32];
    return `${PREFIX[kind]}_${encodeBase32(nowMs, 10)}${encodeBase32(counter, 2)}${tail}`;
  };
}

/** Deterministic generator for tests and snapshot fixtures: `act_1`, `act_2`, ... */
export function createSequentialIdGenerator(): IdGenerator {
  const counters: Record<string, number> = {};
  return (kind: IdKind) => {
    counters[kind] = (counters[kind] ?? 0) + 1;
    return `${PREFIX[kind]}_${counters[kind]}`;
  };
}
