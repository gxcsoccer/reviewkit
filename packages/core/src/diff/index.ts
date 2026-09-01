/**
 * Diff facade. `analyzeItem` is what list views and renderers call: it picks the
 * right engine for an item's `kind` and returns a uniform change count so the
 * UI can say "12 fields across 3 records" without knowing the payload shape.
 */
import type { ActionItem } from '../types.js';
import { diffJson, summarizeJsonDiff, type JsonChange, type JsonDiffOptions } from './json.js';
import { diffTable, type TableDiff, type TableDiffOptions } from './table.js';
import { diffText, itemAsText, type TextDiffOptions, type TextDiffResult } from './text.js';

export * from './json.js';
export * from './table.js';
export * from './text.js';

export type ItemAnalysis =
  | { kind: 'json'; changes: JsonChange[]; changeCount: number; changedPaths: string[] }
  | { kind: 'text'; diff: TextDiffResult; changeCount: number; changedPaths: string[] }
  | { kind: 'table'; diff: TableDiff; changeCount: number; changedPaths: string[] };

export interface AnalyzeOptions {
  json?: JsonDiffOptions;
  text?: TextDiffOptions;
  table?: TableDiffOptions;
}

/**
 * Infer a renderer kind from the payload when the producer did not set one.
 * `text` for strings, `table` for arrays of flat records, `json` otherwise.
 */
export function inferItemKind(before: unknown, after: unknown): 'json' | 'text' | 'table' {
  const sample = after ?? before;
  if (typeof sample === 'string') return 'text';
  if (Array.isArray(sample)) {
    const records = sample.filter((row) => typeof row === 'object' && row !== null && !Array.isArray(row));
    if (records.length === sample.length && sample.length > 0) return 'table';
  }
  return 'json';
}

export function analyzeItem(item: ActionItem, options: AnalyzeOptions = {}): ItemAnalysis {
  const kind = item.kind === 'json' || item.kind === 'text' || item.kind === 'table'
    ? item.kind
    : inferItemKind(item.before, item.after);

  if (kind === 'text') {
    const diff = diffText(itemAsText(item.before), itemAsText(item.after), options.text);
    return {
      kind: 'text',
      diff,
      changeCount: diff.summary.added + diff.summary.removed,
      changedPaths: [],
    };
  }

  if (kind === 'table') {
    const diff = diffTable(item.before, item.after, options.table);
    const changedRows = diff.rows.filter((row) => row.kind !== 'unchanged');
    return {
      kind: 'table',
      diff,
      changeCount: changedRows.reduce((n, row) => n + Math.max(1, row.changedColumns.length), 0),
      changedPaths: changedRows.flatMap((row) => row.changedColumns.map((column) => `${row.key}.${column}`)),
    };
  }

  const changes = diffJson(item.before, item.after, options.json);
  const summary = summarizeJsonDiff(changes);
  return {
    kind: 'json',
    changes,
    changeCount: summary.added + summary.removed + summary.changed,
    changedPaths: summary.paths,
  };
}

/** Total number of concrete changes in a proposal — the "how much will change" number. */
export function countChanges(items: readonly ActionItem[], options?: AnalyzeOptions): number {
  return items.reduce((total, item) => total + analyzeItem(item, options).changeCount, 0);
}
