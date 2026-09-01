/**
 * Deterministic JSON serialization (PRD 9.1: "deterministic serialization,
 * version and SHA-256 content hash").
 *
 * Follows RFC 8785 (JCS) for the subset ReviewKit needs:
 *  - object keys sorted by UTF-16 code unit
 *  - no insignificant whitespace
 *  - numbers via ECMAScript `Number::toString` (`JSON.stringify`), `-0` → `0`
 *  - strings escaped exactly like `JSON.stringify`
 *  - `undefined` object members omitted; `undefined` array slots → `null`
 *
 * Anything that cannot be represented deterministically throws E_CANONICALIZE
 * instead of silently hashing to something surprising.
 */
import { ReviewKitError } from './errors.js';

function fail(path: string, what: string, hint: string): never {
  throw new ReviewKitError({
    code: 'E_CANONICALIZE',
    message: `Cannot canonicalize ${what} at ${path || '<root>'}`,
    hint,
    details: { path, kind: what },
  });
}

function writeValue(value: unknown, out: string[], path: string, seen: Set<object>): void {
  if (value === null) {
    out.push('null');
    return;
  }

  const t = typeof value;

  if (t === 'string') {
    out.push(JSON.stringify(value));
    return;
  }

  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      fail(path, `the non-finite number ${String(n)}`, 'Replace NaN/Infinity with null or a string before hashing.');
    }
    // JSON.stringify(-0) is already "0"; normalize explicitly for clarity.
    out.push(Object.is(n, -0) ? '0' : JSON.stringify(n));
    return;
  }

  if (t === 'boolean') {
    out.push(value ? 'true' : 'false');
    return;
  }

  if (t === 'bigint') {
    fail(path, 'a bigint', 'Convert bigints to string or number before hashing (JSON has no bigint).');
  }

  if (t === 'function' || t === 'symbol') {
    fail(path, `a ${t}`, 'Remove functions and symbols from proposal payloads; they are not serializable.');
  }

  if (t === 'undefined') {
    // Only reachable for array slots; object members are filtered out earlier.
    out.push('null');
    return;
  }

  const obj = value as Record<string, unknown>;

  if (seen.has(obj)) {
    fail(path, 'a circular reference', 'Break the cycle (structuredClone-able data only).');
  }

  if (typeof (obj as { toJSON?: unknown }).toJSON === 'function') {
    const primitive = (obj as { toJSON: (key?: string) => unknown }).toJSON();
    writeValue(primitive, out, path, seen);
    return;
  }

  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      out.push('[');
      for (let i = 0; i < obj.length; i++) {
        if (i > 0) out.push(',');
        writeValue(obj[i], out, `${path}[${i}]`, seen);
      }
      out.push(']');
      return;
    }

    // Sort by UTF-16 code unit order, as required by RFC 8785.
    const keys = Object.keys(obj).sort();
    out.push('{');
    let first = true;
    for (const key of keys) {
      const member = obj[key];
      if (member === undefined) continue; // matches JSON.stringify
      if (typeof member === 'function' || typeof member === 'symbol') continue;
      if (!first) out.push(',');
      first = false;
      out.push(JSON.stringify(key), ':');
      writeValue(member, out, path ? `${path}.${key}` : key, seen);
    }
    out.push('}');
  } finally {
    seen.delete(obj);
  }
}

/**
 * Canonical JSON text for `value`. Two structurally equal values always produce
 * the identical string, regardless of key insertion order.
 */
export function canonicalize(value: unknown): string {
  const out: string[] = [];
  writeValue(value, out, '', new Set());
  return out.join('');
}

/**
 * Structural equality via canonical form. Cheap enough for proposal-sized data
 * and avoids "did the reviewer really change anything?" false positives.
 */
export function canonicalEquals(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}
