import { describe, expect, it } from 'vitest';
import {
  analyzeItem,
  countChanges,
  diffJson,
  diffTable,
  diffText,
  diffWords,
  inferItemKind,
  itemAsText,
  summarizeJsonDiff,
  tokenizeWords,
  type ActionItem,
} from '@reviewkit/core';

const item = (overrides: Partial<ActionItem>): ActionItem => ({
  id: 'i1',
  kind: 'json',
  operation: 'update',
  status: 'pending',
  ...overrides,
});

describe('json diff (PRD 9.1: field-level)', () => {
  it('reports added, removed and changed fields with usable paths', () => {
    const changes = diffJson(
      { name: 'Alice', priority: 'low', owner: { email: 'a@example.com' } },
      { name: 'Alice', priority: 'high', owner: { email: 'a@example.com', phone: '+1' } },
    );

    expect(changes.map((c) => [c.path, c.kind])).toEqual([
      ['owner.phone', 'added'],
      ['priority', 'changed'],
    ]);
    const summary = summarizeJsonDiff(changes);
    expect(summary).toMatchObject({ added: 1, changed: 1, removed: 0, unchanged: 0 });
    expect(summary.paths).toEqual(['owner.phone', 'priority']);
  });

  it('visits keys in sorted order so the same pair always diffs identically', () => {
    const a = diffJson({ z: 1, a: 1 }, { z: 2, a: 2 });
    const b = diffJson({ a: 1, z: 1 }, { a: 2, z: 2 });
    expect(a.map((c) => c.path)).toEqual(['a', 'z']);
    expect(a).toEqual(b);
  });

  it('descends into arrays by index', () => {
    const changes = diffJson({ tags: ['a', 'b'] }, { tags: ['a', 'c'] });
    expect(changes.map((c) => c.path)).toEqual(['tags[1]']);
    expect(changes[0]).toMatchObject({ segments: ['tags', 1], before: 'b', after: 'c', leaf: true });
  });

  it('bracket-quotes nested keys that are not identifiers, and keeps root keys bare', () => {
    const changes = diffJson({ 'x-id': 1, meta: { 'content-type': 'text' } }, { 'x-id': 2, meta: { 'content-type': 'html' } });
    // Root keys are labels in the UI, so they stay readable; nested keys must be
    // unambiguous because the path is also the addressing scheme.
    expect(changes.map((c) => c.path)).toEqual(['meta["content-type"]', 'x-id']);
    expect(changes[0]!.segments).toEqual(['meta', 'content-type']);
  });

  it('treats a missing field and a null field as different', () => {
    expect(diffJson({ a: 1 }, { a: 1, b: null }).map((c) => c.kind)).toEqual(['added']);
    expect(diffJson({ a: 1, b: null }, { a: 1 }).map((c) => c.kind)).toEqual(['removed']);
    expect(diffJson({ b: null }, { b: null })).toEqual([]);
  });

  it('names a whole-value replacement instead of rendering a blank label', () => {
    const changes = diffJson('before', 'after');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: '(root)', kind: 'changed', leaf: true });
  });

  it('reports a value whole once maxDepth is reached', () => {
    const changes = diffJson({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } }, { maxDepth: 2 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ path: 'a.b', kind: 'changed', leaf: false });
  });

  it('can include unchanged leaves for side-by-side views', () => {
    const changes = diffJson({ a: 1, b: 2 }, { a: 1, b: 3 }, { includeUnchanged: true });
    expect(changes.map((c) => [c.path, c.kind])).toEqual([
      ['a', 'unchanged'],
      ['b', 'changed'],
    ]);
    expect(summarizeJsonDiff(changes).paths).toEqual(['b']);
  });

  it('does not report reordered object keys or equal numbers as changes', () => {
    expect(diffJson({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toEqual([]);
  });
});

describe('text diff (PRD 9.1: line and word level)', () => {
  it('keeps line numbers for both sides', () => {
    const { lines, summary } = diffText('one\ntwo\nthree', 'one\ntwo point five\nthree');
    expect(summary).toMatchObject({ added: 1, removed: 1, unchanged: 2, truncated: false });
    expect(lines.map((l) => [l.op, l.beforeLine ?? null, l.afterLine ?? null])).toEqual([
      ['equal', 1, 1],
      ['delete', 2, null],
      ['insert', null, 2],
      ['equal', 3, 3],
    ]);
  });

  it('attaches word-level detail to a reworded line', () => {
    const { lines } = diffText('Dear Bob, thanks for your reply.', 'Dear Bob, thank you for your reply.');
    const removed = lines.find((l) => l.op === 'delete')!;
    const added = lines.find((l) => l.op === 'insert')!;

    expect(removed.words?.every((w) => w.op !== 'insert')).toBe(true);
    expect(added.words?.every((w) => w.op !== 'delete')).toBe(true);
    expect(added.words?.filter((w) => w.op === 'insert').map((w) => w.text).join('')).toContain('you');
    // Untouched text is shared, not re-rendered as a change.
    expect(removed.words?.find((w) => w.op === 'equal')?.text).toBe('Dear Bob, ');
  });

  it('skips word detail at line granularity', () => {
    const { lines } = diffText('alpha', 'beta', { granularity: 'line' });
    expect(lines.every((l) => l.words === undefined)).toBe(true);
  });

  it('handles pure insertion and pure deletion', () => {
    expect(diffText('', 'hello').summary).toMatchObject({ added: 1, removed: 0 });
    expect(diffText('hello', '').summary).toMatchObject({ added: 0, removed: 1 });
    expect(diffText('same', 'same').summary).toMatchObject({ added: 0, removed: 0, unchanged: 1 });
  });

  it('normalizes CRLF so a line-ending change is not a diff', () => {
    expect(diffText('a\r\nb', 'a\nb').summary).toMatchObject({ added: 0, removed: 0, unchanged: 2 });
  });

  it('degrades to replace-all instead of hanging on a huge payload', () => {
    const before = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
    const after = Array.from({ length: 400 }, (_, i) => `LINE ${i}`).join('\n');
    const { summary } = diffText(before, after, { maxCells: 1000 });
    expect(summary.truncated).toBe(true);
    expect(summary.added).toBe(400);
    expect(summary.removed).toBe(400);
  });

  it('tokenizes words, whitespace and punctuation separately', () => {
    expect(tokenizeWords('hi, there')).toEqual(['hi', ',', ' ', 'there']);
    expect(diffWords('a b', 'a c').map((w) => w.op)).toEqual(['equal', 'delete', 'insert']);
  });

  it('renders non-strings as pretty JSON for text review', () => {
    expect(itemAsText('raw')).toBe('raw');
    expect(itemAsText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(itemAsText(undefined)).toBe('');
    expect(itemAsText(null)).toBe('');
  });
});

describe('table diff (PRD 9.1: record and cell level)', () => {
  const before = [
    { id: 'c_1', name: 'Alice', priority: 'low' },
    { id: 'c_2', name: 'Bob', priority: 'low' },
    { id: 'c_3', name: 'Cleo', priority: 'medium' },
  ];

  it('matches rows by key and marks changed cells', () => {
    const diff = diffTable(before, [
      { id: 'c_2', name: 'Bob', priority: 'high' },
      { id: 'c_1', name: 'Alice', priority: 'low' },
      { id: 'c_3', name: 'Cleo', priority: 'medium' },
    ]);

    expect(diff.keyField).toBe('id');
    expect(diff.columns).toEqual(['id', 'name', 'priority']);
    // Reordering the result set is not "3 rows changed".
    expect(diff.summary).toMatchObject({ added: 0, removed: 0, changed: 1, unchanged: 2 });
    const changed = diff.rows.find((r) => r.kind === 'changed')!;
    expect(changed.key).toBe('c_2');
    expect(changed.changedColumns).toEqual(['priority']);
    expect(changed.cells.find((c) => c.column === 'priority')).toMatchObject({
      kind: 'changed',
      before: 'low',
      after: 'high',
    });
  });

  it('reports added and removed records', () => {
    const diff = diffTable(before.slice(0, 2), [before[0]!, { id: 'c_9', name: 'Zed', priority: 'high' }]);
    expect(diff.summary).toMatchObject({ added: 1, removed: 1, changed: 0, unchanged: 1 });
    expect(diff.rows.find((r) => r.kind === 'removed')?.key).toBe('c_2');
    expect(diff.rows.find((r) => r.kind === 'added')?.key).toBe('c_9');
    // Row order stays stable for the reviewer: existing rows first, new rows last.
    expect(diff.rows.map((r) => r.key)).toEqual(['c_1', 'c_2', 'c_9']);
  });

  it('puts the key column first and sorts the rest', () => {
    const diff = diffTable([{ zeta: 1, id: 'a', alpha: 2 }], [{ zeta: 1, id: 'a', alpha: 3 }]);
    expect(diff.columns).toEqual(['id', 'alpha', 'zeta']);
  });

  it('falls back to positional keys when no column is unique', () => {
    const diff = diffTable([{ label: 'x' }, { label: 'x' }], [{ label: 'x' }, { label: 'y' }]);
    expect(diff.keyField).toBe('__index__');
    expect(diff.rows.map((r) => r.key)).toEqual(['#1', '#2']);
    expect(diff.summary).toMatchObject({ changed: 1, unchanged: 1 });
  });

  it('accepts an explicit key and column order', () => {
    const diff = diffTable(
      [{ email: 'a@x.com', tier: 'free' }],
      [{ email: 'a@x.com', tier: 'pro' }],
      { key: 'email', columns: ['tier', 'email'] },
    );
    expect(diff.keyField).toBe('email');
    expect(diff.columns).toEqual(['tier', 'email']);
    expect(diff.rows[0]!.changedColumns).toEqual(['tier']);
  });

  it('treats a single object as a one-row table', () => {
    const diff = diffTable({ id: 'a', v: 1 }, { id: 'a', v: 2 });
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0]!.changedColumns).toEqual(['v']);
  });
});

describe('renderer dispatch', () => {
  it('infers a kind from the payload', () => {
    expect(inferItemKind(undefined, 'a string')).toBe('text');
    expect(inferItemKind(undefined, [{ id: 1 }, { id: 2 }])).toBe('table');
    expect(inferItemKind(undefined, { id: 1 })).toBe('json');
    expect(inferItemKind(undefined, [1, 2, 3])).toBe('json');
    expect(inferItemKind(undefined, [])).toBe('json');
    // Falls back to `before` for deletions.
    expect(inferItemKind('gone', undefined)).toBe('text');
  });

  it('routes each item kind to its engine with a uniform change count', () => {
    const json = analyzeItem(item({ before: { a: 1 }, after: { a: 2 } }));
    expect(json.kind === 'json' && json.changedPaths).toEqual(['a']);
    expect(json.changeCount).toBe(1);

    const text = analyzeItem(item({ kind: 'text', before: 'a\nb', after: 'a\nB' }));
    expect(text.kind).toBe('text');
    expect(text.changeCount).toBe(2); // one line removed, one added

    const table = analyzeItem(
      item({ kind: 'table', before: [{ id: 1, v: 'a' }], after: [{ id: 1, v: 'b' }] }),
    );
    expect(table.kind).toBe('table');
    expect(table.changeCount).toBe(1);
    expect(table.changedPaths).toEqual(['1.v']);
  });

  it('honours an explicit kind over inference', () => {
    // A table payload the producer wants reviewed as raw JSON.
    const analysis = analyzeItem(item({ kind: 'json', before: [{ id: 1 }], after: [{ id: 2 }] }));
    expect(analysis.kind).toBe('json');
  });

  it('counts every change in a proposal for the "how much will change" number', () => {
    const items = [
      item({ id: 'i1', before: { a: 1 }, after: { a: 2 } }),
      item({ id: 'i2', kind: 'table', before: [{ id: 1, v: 'a', w: 1 }], after: [{ id: 1, v: 'b', w: 2 }] }),
    ];
    expect(countChanges(items)).toBe(3);
  });

  it('counts an added or removed record as one change even with no cell detail', () => {
    const analysis = analyzeItem(item({ kind: 'table', before: [], after: [{ id: 1 }] }));
    expect(analysis.changeCount).toBe(1);
  });
});
