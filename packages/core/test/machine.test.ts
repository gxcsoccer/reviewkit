import { describe, expect, it } from 'vitest';
import {
  allowedOperations,
  assertItemTransition,
  assertTransition,
  canTransition,
  deriveExecutionStatus,
  isExecutableStatus,
  type ProposalStatus,
} from '@reviewkit/core';
import { expectError } from './helpers.js';

const ALL_STATUSES: ProposalStatus[] = [
  'draft',
  'pending_review',
  'reviewing',
  'changes_requested',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'superseded',
  'invalidated',
];

describe('proposal transitions (PRD 8.1)', () => {
  it('follows the happy path', () => {
    expect(assertTransition('draft', 'submit')).toBe('pending_review');
    expect(assertTransition('pending_review', 'startReview')).toBe('reviewing');
    expect(assertTransition('reviewing', 'approve')).toBe('approved');
    expect(assertTransition('approved', 'requestExecution')).toBe('approved');
  });

  it('never approves from outside review', async () => {
    for (const status of ALL_STATUSES) {
      if (status === 'reviewing') continue;
      expect(canTransition(status, 'approve')).toBe(false);
    }
    const error = await expectError(() => assertTransition('pending_review', 'approve'), 'E_INVALID_TRANSITION');
    expect(error.hint).toContain('startReview');
  });

  it('freezes approved content: edits must go through invalidate or createRevision', () => {
    expect(canTransition('approved', 'edit')).toBe(false);
    expect(canTransition('approved', 'updateItems')).toBe(false);
    expect(canTransition('approved', 'invalidate')).toBe(true);
  });

  it('treats cancelled and superseded as terminal', async () => {
    for (const status of ['cancelled', 'superseded'] as const) {
      expect(allowedOperations(status)).toEqual([]);
      const error = await expectError(() => assertTransition(status, 'startReview'), 'E_INVALID_TRANSITION');
      expect(error.hint).toMatch(/terminal/i);
    }
  });

  it('marks non-approved statuses as non-executable (PRD 20)', () => {
    for (const status of ALL_STATUSES) {
      expect(isExecutableStatus(status)).toBe(status === 'approved');
    }
  });

  it('lists the legal alternatives in every rejection', async () => {
    const error = await expectError(() => assertTransition('rejected', 'approve'), 'E_INVALID_TRANSITION');
    expect(error.details.allowed).toEqual(allowedOperations('rejected'));
    expect(error.hint).toContain('createRevision');
  });

  it('only lets invalidated proposals return through a source refresh or revision', () => {
    expect(allowedOperations('invalidated').sort()).toEqual(
      ['cancel', 'createRevision', 'expire', 'refreshSource', 'supersede'].sort(),
    );
    expect(canTransition('invalidated', 'approve')).toBe(false);
  });
});

describe('item transitions (PRD 8.2)', () => {
  it('lets a reviewer flip a decision before approving the proposal', () => {
    expect(() => assertItemTransition('approved', 'rejected', 'i1')).not.toThrow();
    expect(() => assertItemTransition('rejected', 'approved', 'i1')).not.toThrow();
  });

  it('never approves an invalidated item without a refresh first', async () => {
    const error = await expectError(() => assertItemTransition('invalidated', 'approved', 'i1'), 'E_INVALID_TRANSITION');
    expect(error.hint).toMatch(/refreshSource/);
  });
});

describe('execution status derivation (PRD 10.5)', () => {
  it('distinguishes full success, partial success and failure', () => {
    expect(deriveExecutionStatus([{ status: 'succeeded' }, { status: 'succeeded' }])).toBe('succeeded');
    expect(deriveExecutionStatus([{ status: 'succeeded' }, { status: 'failed' }])).toBe('partially_succeeded');
    expect(deriveExecutionStatus([{ status: 'failed' }, { status: 'failed' }])).toBe('failed');
    expect(deriveExecutionStatus([{ status: 'rolled_back' }])).toBe('rolled_back');
    expect(deriveExecutionStatus([])).toBe('failed');
  });

  it('does not call a batch with skipped items a full success', () => {
    expect(deriveExecutionStatus([{ status: 'succeeded' }, { status: 'skipped' }])).toBe('partially_succeeded');
  });
});
