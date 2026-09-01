import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildExecutionPayload,
  canonicalEquals,
  canonicalize,
  computeContentHash,
  computePayloadHash,
  createProposal,
  digest,
  fixedClock,
  isContentHash,
  sha256Hex,
} from '@reviewkit/core';
import { expectError } from './helpers.js';

const clock = () => fixedClock('2026-09-01T10:00:00.000Z');

const baseInput = () => ({
  type: 'crm.contact.update',
  before: [{ id: 'c_1', priority: 'low', owner: 'ada' }],
  after: [{ id: 'c_1', priority: 'high', owner: 'ada' }],
  origin: { initiatedBy: { id: 'agent_1', kind: 'agent' as const } },
});

describe('sha256', () => {
  it('matches node:crypto for the standard vectors', () => {
    for (const input of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000)]) {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }
  });

  it('matches node:crypto for multi-byte UTF-8', () => {
    for (const input of ['价格调整', 'é', '🙈🙉🙊', 'naïve café — ¥1,234']) {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }
  });

  it('produces prefixed, lowercase-hex content hashes', () => {
    const hash = digest({ a: 1 });
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(isContentHash(hash)).toBe(true);
    expect(isContentHash('sha256:nope')).toBe(false);
    expect(isContentHash(hash.slice(7))).toBe(false);
  });
});

describe('canonicalize', () => {
  it('is independent of key insertion order', () => {
    expect(canonicalize({ b: 1, a: { d: 4, c: 3 } })).toBe(canonicalize({ a: { c: 3, d: 4 }, b: 1 }));
    expect(digest({ b: 1, a: 2 })).toBe(digest({ a: 2, b: 1 }));
  });

  it('preserves array order (arrays are values, not sets)', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it('distinguishes absent from null', () => {
    expect(canonicalEquals({ a: 1 }, { a: 1, b: null })).toBe(false);
  });

  it('normalises -0 and rejects values JSON cannot round-trip', async () => {
    expect(canonicalize(-0)).toBe('0');
    await expectError(() => canonicalize(Number.NaN), 'E_CANONICALIZE');
    await expectError(() => canonicalize(Number.POSITIVE_INFINITY), 'E_CANONICALIZE');
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    await expectError(() => canonicalize(cycle), 'E_CANONICALIZE');
  });
});

describe('content hash payload', () => {
  it('covers execution fields and ignores presentation fields', () => {
    const proposal = createProposal(baseInput(), { clock: clock() });
    const cosmetic = { ...proposal, summary: 'totally different wording', reason: 'because' };
    expect(computeContentHash(cosmetic)).toBe(proposal.contentHash);
  });

  it('changes when any executed field changes', () => {
    const proposal = createProposal(baseInput(), { clock: clock() });
    const item = proposal.items[0]!;

    const editedAfter = {
      ...proposal,
      items: [{ ...item, after: { id: 'c_1', priority: 'critical', owner: 'ada' } }],
    };
    const editedOperation = { ...proposal, items: [{ ...item, operation: 'delete' }] };
    const editedTarget = { ...proposal, target: { ...proposal.target, system: 'other' } };
    const editedKey = { ...proposal, idempotencyKey: 'different' };

    for (const variant of [editedAfter, editedOperation, editedTarget, editedKey]) {
      expect(computeContentHash(variant)).not.toBe(proposal.contentHash);
    }
  });

  it('ignores `before`, which is review context rather than an instruction', () => {
    const proposal = createProposal(baseInput(), { clock: clock() });
    const item = proposal.items[0]!;
    const rebased = { ...proposal, items: [{ ...item, before: { id: 'c_1', priority: 'medium' } }] };
    expect(computeContentHash(rebased)).toBe(proposal.contentHash);
  });

  it('hashes an item subset independently of item ordering', () => {
    const proposal = createProposal(
      {
        ...baseInput(),
        before: [{ id: 'c_1', v: 1 }, { id: 'c_2', v: 1 }, { id: 'c_3', v: 1 }],
        after: [{ id: 'c_1', v: 2 }, { id: 'c_2', v: 2 }, { id: 'c_3', v: 2 }],
      },
      { clock: clock() },
    );
    const ids = proposal.items.map((item) => item.id);
    const forward = computePayloadHash(buildExecutionPayload(proposal, [ids[0]!, ids[2]!]));
    const reversed = computePayloadHash(buildExecutionPayload(proposal, [ids[2]!, ids[0]!]));
    expect(forward).toBe(reversed);
    expect(forward).not.toBe(proposal.contentHash);
  });

  it('refuses to build a payload for an unknown item id', async () => {
    const proposal = createProposal(baseInput(), { clock: clock() });
    await expectError(() => buildExecutionPayload(proposal, ['nope']), 'E_NOT_FOUND');
  });
});
