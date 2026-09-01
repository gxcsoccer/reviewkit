/**
 * Line- and word-level text diff (PRD 9.1: "Text: line or word level diff").
 *
 * Implementation notes:
 *  - common prefix/suffix are trimmed first, which is what makes real-world
 *    edits (a changed sentence in a long email) cheap;
 *  - the middle is diffed with an LCS table, bounded by `maxCells` so a
 *    pathological 5 MB payload degrades to a whole-block replace instead of
 *    freezing the tab (PRD 13: first interaction under one second).
 */

export type TextOp = 'equal' | 'insert' | 'delete';

export interface TextDiffLine {
  op: TextOp;
  /** 1-based line number in `before`, when the line exists there. */
  beforeLine?: number;
  /** 1-based line number in `after`, when the line exists there. */
  afterLine?: number;
  text: string;
  /** Word-level detail, present on paired delete/insert lines. */
  words?: TextDiffWord[];
}

export interface TextDiffWord {
  op: TextOp;
  text: string;
}

export interface TextDiffOptions {
  /** `line` returns line ops only; `word` also fills `words` on paired lines. Default `word`. */
  granularity?: 'line' | 'word';
  /** Upper bound on LCS table cells before falling back to replace-all. Default 4_000_000. */
  maxCells?: number;
}

export interface TextDiffResult {
  lines: TextDiffLine[];
  summary: { added: number; removed: number; unchanged: number; truncated: boolean };
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Generic LCS over tokens; returns ops in order. */
function lcsDiff<T>(a: readonly T[], b: readonly T[], maxCells: number): { ops: { op: TextOp; value: T }[]; truncated: boolean } {
  if (a.length === 0 && b.length === 0) return { ops: [], truncated: false };
  if (a.length === 0) return { ops: b.map((value) => ({ op: 'insert' as TextOp, value })), truncated: false };
  if (b.length === 0) return { ops: a.map((value) => ({ op: 'delete' as TextOp, value })), truncated: false };

  if ((a.length + 1) * (b.length + 1) > maxCells) {
    return {
      ops: [
        ...a.map((value) => ({ op: 'delete' as TextOp, value })),
        ...b.map((value) => ({ op: 'insert' as TextOp, value })),
      ],
      truncated: true,
    };
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + (j + 1)]! + 1
          : Math.max(table[(i + 1) * cols + j]!, table[i * cols + (j + 1)]!);
    }
  }

  const ops: { op: TextOp; value: T }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ op: 'equal', value: a[i]! });
      i++;
      j++;
    } else if (table[(i + 1) * cols + j]! >= table[i * cols + (j + 1)]!) {
      ops.push({ op: 'delete', value: a[i]! });
      i++;
    } else {
      ops.push({ op: 'insert', value: b[j]! });
      j++;
    }
  }
  while (i < a.length) ops.push({ op: 'delete', value: a[i++]! });
  while (j < b.length) ops.push({ op: 'insert', value: b[j++]! });
  return { ops, truncated: false };
}

/** Split into words while keeping whitespace/punctuation as their own tokens. */
export function tokenizeWords(text: string): string[] {
  return text.match(/(\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_])/gu) ?? [];
}

export function diffWords(before: string, after: string, maxCells = 250_000): TextDiffWord[] {
  const { ops } = lcsDiff(tokenizeWords(before), tokenizeWords(after), maxCells);
  // Merge neighbouring ops of the same kind so the DOM stays small.
  const merged: TextDiffWord[] = [];
  for (const { op, value } of ops) {
    const last = merged[merged.length - 1];
    if (last && last.op === op) last.text += value;
    else merged.push({ op, text: value });
  }
  return merged;
}

/**
 * Diff two blocks of text. Values that are not strings are stringified by the
 * caller (see `itemAsText`) so this stays a pure text function.
 */
export function diffText(before: string, after: string, options: TextDiffOptions = {}): TextDiffResult {
  const granularity = options.granularity ?? 'word';
  const maxCells = options.maxCells ?? 4_000_000;

  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  // Trim common prefix / suffix.
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midBefore = beforeLines.slice(prefix, beforeLines.length - suffix);
  const midAfter = afterLines.slice(prefix, afterLines.length - suffix);
  const { ops, truncated } = lcsDiff(midBefore, midAfter, maxCells);

  const lines: TextDiffLine[] = [];
  let beforeNo = 1;
  let afterNo = 1;

  for (let i = 0; i < prefix; i++) {
    lines.push({ op: 'equal', text: beforeLines[i]!, beforeLine: beforeNo++, afterLine: afterNo++ });
  }
  for (const { op, value } of ops) {
    if (op === 'equal') lines.push({ op, text: value, beforeLine: beforeNo++, afterLine: afterNo++ });
    else if (op === 'delete') lines.push({ op, text: value, beforeLine: beforeNo++ });
    else lines.push({ op, text: value, afterLine: afterNo++ });
  }
  for (let i = beforeLines.length - suffix; i < beforeLines.length; i++) {
    lines.push({ op: 'equal', text: beforeLines[i]!, beforeLine: beforeNo++, afterLine: afterNo++ });
  }

  if (granularity === 'word') attachWordDiffs(lines);

  return {
    lines,
    summary: {
      added: lines.filter((l) => l.op === 'insert').length,
      removed: lines.filter((l) => l.op === 'delete').length,
      unchanged: lines.filter((l) => l.op === 'equal').length,
      truncated,
    },
  };
}

/**
 * For each run of deletes immediately followed by inserts, pair them up 1:1 and
 * compute word-level detail — the common "this line was reworded" case.
 */
function attachWordDiffs(lines: TextDiffLine[]): void {
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.op !== 'delete') {
      i++;
      continue;
    }
    let d = i;
    while (d < lines.length && lines[d]!.op === 'delete') d++;
    let n = d;
    while (n < lines.length && lines[n]!.op === 'insert') n++;
    const deletes = lines.slice(i, d);
    const inserts = lines.slice(d, n);
    const pairs = Math.min(deletes.length, inserts.length);
    for (let p = 0; p < pairs; p++) {
      const del = deletes[p]!;
      const ins = inserts[p]!;
      const words = diffWords(del.text, ins.text);
      del.words = words.filter((w) => w.op !== 'insert');
      ins.words = words.filter((w) => w.op !== 'delete');
    }
    i = n === i ? i + 1 : n;
  }
}

/** Render any JSON value as reviewable text: strings verbatim, others pretty JSON. */
export function itemAsText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}
