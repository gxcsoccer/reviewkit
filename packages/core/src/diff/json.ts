/**
 * Field-level JSON diff (PRD 9.1: "JSON: field-level add, delete and modify").
 *
 * Pure and deterministic: keys are visited in sorted order, so the same pair of
 * objects always yields the same change list — which is what makes
 * "only show changed fields" views and snapshot tests stable.
 */
import { canonicalEquals } from '../canonical.js';
import type { JsonValue } from '../types.js';

export type ChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

export interface JsonChange {
  /** Human/CSS-friendly path, e.g. `owner.email` or `tags[2]`. */
  path: string;
  /** Structured path for programmatic access. */
  segments: (string | number)[];
  kind: ChangeKind;
  before?: JsonValue;
  after?: JsonValue;
  /** True when the value is a scalar (renderers show scalars inline). */
  leaf: boolean;
}

export interface JsonDiffOptions {
  /** Include `unchanged` leaves. Default false — reviewers want the delta first. */
  includeUnchanged?: boolean;
  /** Stop descending after this depth; deeper values are reported whole. Default 12. */
  maxDepth?: number;
}

export interface JsonDiffSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  /** Changed/added/removed paths, in diff order. */
  paths: string[];
}

const isPlainObject = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: unknown): boolean => value === null || typeof value !== 'object';

function joinPath(parent: string, segment: string | number): string {
  if (typeof segment === 'number') return `${parent}[${segment}]`;
  if (!parent) return segment;
  // Bracket-quote keys that are not plain identifiers so paths stay unambiguous.
  return /^[A-Za-z_$][\w$]*$/.test(segment) ? `${parent}.${segment}` : `${parent}["${segment}"]`;
}

function walk(
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  segments: (string | number)[],
  path: string,
  depth: number,
  options: Required<JsonDiffOptions>,
  out: JsonChange[],
): void {
  const beforeMissing = before === undefined;
  const afterMissing = after === undefined;

  if (beforeMissing && afterMissing) return;

  if (beforeMissing) {
    out.push({ path, segments, kind: 'added', after, leaf: isScalar(after) });
    return;
  }
  if (afterMissing) {
    out.push({ path, segments, kind: 'removed', before, leaf: isScalar(before) });
    return;
  }

  if (canonicalEquals(before, after)) {
    if (options.includeUnchanged) {
      out.push({ path, segments, kind: 'unchanged', before, after, leaf: isScalar(before) });
    }
    return;
  }

  const canDescend =
    depth < options.maxDepth &&
    ((isPlainObject(before) && isPlainObject(after)) || (Array.isArray(before) && Array.isArray(after)));

  if (!canDescend) {
    out.push({ path, segments, kind: 'changed', before, after, leaf: isScalar(before) && isScalar(after) });
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let i = 0; i < length; i++) {
      walk(before[i], after[i], [...segments, i], joinPath(path, i), depth + 1, options, out);
    }
    return;
  }

  const beforeObj = before as Record<string, JsonValue>;
  const afterObj = after as Record<string, JsonValue>;
  const keys = [...new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])].sort();
  for (const key of keys) {
    walk(beforeObj[key], afterObj[key], [...segments, key], joinPath(path, key), depth + 1, options, out);
  }
}

/** Flat list of field-level changes between two JSON values. */
export function diffJson(
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  options: JsonDiffOptions = {},
): JsonChange[] {
  const resolved: Required<JsonDiffOptions> = {
    includeUnchanged: options.includeUnchanged ?? false,
    maxDepth: options.maxDepth ?? 12,
  };
  const out: JsonChange[] = [];
  walk(before, after, [], '', 0, resolved, out);
  // A whole-value replacement reports itself with an empty path; name it so UIs
  // never render a blank field label.
  for (const change of out) {
    if (change.path === '') change.path = '(root)';
  }
  return out;
}

export function summarizeJsonDiff(changes: readonly JsonChange[]): JsonDiffSummary {
  const summary: JsonDiffSummary = { added: 0, removed: 0, changed: 0, unchanged: 0, paths: [] };
  for (const change of changes) {
    summary[change.kind] += 1;
    if (change.kind !== 'unchanged') summary.paths.push(change.path);
  }
  return summary;
}
