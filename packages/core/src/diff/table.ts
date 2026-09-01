/**
 * Record- and cell-level table diff (PRD 9.1: "Table: record and cell level
 * changes, bulk selection and filtering").
 *
 * Rows are matched by key (default `id`) rather than by position, so a reordered
 * result set does not read as "300 rows changed".
 */
import { canonicalEquals } from '../canonical.js';
import type { JsonObject, JsonValue } from '../types.js';
import type { ChangeKind } from './json.js';

export interface TableCellDiff {
  column: string;
  kind: ChangeKind;
  before?: JsonValue;
  after?: JsonValue;
}

export interface TableRowDiff {
  key: string;
  kind: ChangeKind;
  cells: TableCellDiff[];
  changedColumns: string[];
  before?: JsonObject;
  after?: JsonObject;
}

export interface TableDiff {
  columns: string[];
  keyField: string;
  rows: TableRowDiff[];
  summary: { added: number; removed: number; changed: number; unchanged: number };
}

export interface TableDiffOptions {
  /** Column used to pair rows. Auto-detected when omitted. */
  key?: string;
  /** Explicit column order; defaults to first-seen order across both sides. */
  columns?: string[];
}

const CANDIDATE_KEYS = ['id', 'key', 'uid', 'code', 'email', 'name'];

function toRows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) {
    return value.filter((row): row is JsonObject => typeof row === 'object' && row !== null && !Array.isArray(row));
  }
  if (typeof value === 'object' && value !== null) return [value as JsonObject];
  return [];
}

function detectKey(before: JsonObject[], after: JsonObject[], explicit?: string): string {
  if (explicit) return explicit;
  const rows = [...before, ...after];
  for (const candidate of CANDIDATE_KEYS) {
    const present = rows.every((row) => row[candidate] !== undefined && row[candidate] !== null);
    if (!present || rows.length === 0) continue;
    const beforeKeys = before.map((row) => String(row[candidate]));
    const afterKeys = after.map((row) => String(row[candidate]));
    const unique = new Set(beforeKeys).size === beforeKeys.length && new Set(afterKeys).size === afterKeys.length;
    if (unique) return candidate;
  }
  // No usable key: fall back to positional matching via a synthetic column.
  return '__index__';
}

function keyOf(row: JsonObject, keyField: string, index: number): string {
  if (keyField === '__index__') return `#${index + 1}`;
  const raw = row[keyField];
  return raw === undefined || raw === null ? `#${index + 1}` : String(raw);
}

/** Diff two record sets. Accepts arrays of objects, or a single object. */
export function diffTable(before: unknown, after: unknown, options: TableDiffOptions = {}): TableDiff {
  const beforeRows = toRows(before);
  const afterRows = toRows(after);
  const keyField = detectKey(beforeRows, afterRows, options.key);

  const columns =
    options.columns ??
    [...new Set([...beforeRows, ...afterRows].flatMap((row) => Object.keys(row)))].sort((a, b) => {
      // Key column first, then alphabetical: predictable, and the identity of a
      // row is always the left-most thing a reviewer reads.
      if (a === keyField) return -1;
      if (b === keyField) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });

  const beforeByKey = new Map<string, JsonObject>();
  beforeRows.forEach((row, index) => beforeByKey.set(keyOf(row, keyField, index), row));
  const afterByKey = new Map<string, JsonObject>();
  afterRows.forEach((row, index) => afterByKey.set(keyOf(row, keyField, index), row));

  // Order: before-side order first (stable for reviewers), then new rows.
  const orderedKeys = [...beforeByKey.keys(), ...[...afterByKey.keys()].filter((k) => !beforeByKey.has(k))];

  const rows: TableRowDiff[] = orderedKeys.map((key) => {
    const beforeRow = beforeByKey.get(key);
    const afterRow = afterByKey.get(key);

    if (!beforeRow && afterRow) {
      return {
        key,
        kind: 'added',
        after: afterRow,
        changedColumns: columns.filter((c) => afterRow[c] !== undefined),
        cells: columns.map((column) => ({ column, kind: 'added' as ChangeKind, after: afterRow[column] })),
      };
    }
    if (beforeRow && !afterRow) {
      return {
        key,
        kind: 'removed',
        before: beforeRow,
        changedColumns: columns.filter((c) => beforeRow[c] !== undefined),
        cells: columns.map((column) => ({ column, kind: 'removed' as ChangeKind, before: beforeRow[column] })),
      };
    }

    const b = beforeRow as JsonObject;
    const a = afterRow as JsonObject;
    const cells: TableCellDiff[] = columns.map((column) => {
      const beforeValue = b[column];
      const afterValue = a[column];
      let kind: ChangeKind = 'unchanged';
      if (beforeValue === undefined && afterValue !== undefined) kind = 'added';
      else if (beforeValue !== undefined && afterValue === undefined) kind = 'removed';
      else if (!canonicalEquals(beforeValue, afterValue)) kind = 'changed';
      return { column, kind, before: beforeValue, after: afterValue };
    });
    const changedColumns = cells.filter((cell) => cell.kind !== 'unchanged').map((cell) => cell.column);
    return {
      key,
      kind: changedColumns.length > 0 ? 'changed' : 'unchanged',
      cells,
      changedColumns,
      before: b,
      after: a,
    };
  });

  return {
    columns,
    keyField,
    rows,
    summary: {
      added: rows.filter((r) => r.kind === 'added').length,
      removed: rows.filter((r) => r.kind === 'removed').length,
      changed: rows.filter((r) => r.kind === 'changed').length,
      unchanged: rows.filter((r) => r.kind === 'unchanged').length,
    },
  };
}
