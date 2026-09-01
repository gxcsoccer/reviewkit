/**
 * Review state machine (PRD 8): three independent layers so "approved" can never
 * be mistaken for "executed successfully".
 *
 *   proposal status  — draft → pending_review → reviewing → approved/rejected/...
 *   item status      — pending → approved | edited | rejected | invalidated
 *   execution status — not_started → queued → running → succeeded | partially_succeeded | failed | rolled_back
 *
 * Every transition is total and explicit: unknown combinations throw
 * E_INVALID_TRANSITION with the list of operations that *are* allowed.
 */
import { ReviewKitError } from './errors.js';
import type { ExecutionStatus, ItemStatus, ProposalStatus } from './types.js';

export type ProposalOperation =
  | 'update'
  | 'submit'
  | 'startReview'
  | 'edit'
  | 'updateItems'
  | 'approve'
  | 'reject'
  | 'defer'
  | 'requestChanges'
  | 'createRevision'
  | 'cancel'
  | 'expire'
  | 'supersede'
  | 'invalidate'
  | 'refreshSource'
  | 'requestExecution'
  | 'recordExecution';

/**
 * `from status → operation → next status`.
 * An operation mapped to the same status is legal but does not move the proposal
 * (e.g. `requestExecution` on an approved proposal).
 */
const TRANSITIONS: Record<ProposalStatus, Partial<Record<ProposalOperation, ProposalStatus>>> = {
  draft: {
    update: 'draft',
    edit: 'draft',
    updateItems: 'draft',
    submit: 'pending_review',
    cancel: 'cancelled',
  },
  pending_review: {
    startReview: 'reviewing',
    reject: 'rejected',
    requestChanges: 'changes_requested',
    cancel: 'cancelled',
    expire: 'expired',
    invalidate: 'invalidated',
    supersede: 'superseded',
  },
  reviewing: {
    edit: 'reviewing',
    updateItems: 'reviewing',
    startReview: 'reviewing',
    approve: 'approved',
    reject: 'rejected',
    defer: 'pending_review',
    requestChanges: 'changes_requested',
    cancel: 'cancelled',
    expire: 'expired',
    invalidate: 'invalidated',
    supersede: 'superseded',
  },
  changes_requested: {
    createRevision: 'pending_review',
    cancel: 'cancelled',
    expire: 'expired',
    invalidate: 'invalidated',
    supersede: 'superseded',
  },
  approved: {
    // Content edits are deliberately *not* allowed here: an approved proposal is
    // frozen. Reopen it with `invalidate` or fork it with `createRevision`.
    requestExecution: 'approved',
    recordExecution: 'approved',
    cancel: 'cancelled',
    expire: 'expired',
    invalidate: 'invalidated',
    supersede: 'superseded',
  },
  rejected: {
    createRevision: 'pending_review',
    supersede: 'superseded',
  },
  expired: {
    createRevision: 'pending_review',
    supersede: 'superseded',
  },
  cancelled: {},
  superseded: {},
  invalidated: {
    refreshSource: 'pending_review',
    createRevision: 'pending_review',
    cancel: 'cancelled',
    expire: 'expired',
    supersede: 'superseded',
  },
};

const READ_ONLY: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['cancelled', 'superseded']);

/** Statuses from which no operation can produce a new execution. */
const NOT_EXECUTABLE: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>([
  'draft',
  'pending_review',
  'reviewing',
  'changes_requested',
  'rejected',
  'expired',
  'cancelled',
  'superseded',
  'invalidated',
]);

export function allowedOperations(status: ProposalStatus): ProposalOperation[] {
  return Object.keys(TRANSITIONS[status]) as ProposalOperation[];
}

export function isReadOnlyStatus(status: ProposalStatus): boolean {
  return READ_ONLY.has(status);
}

/** PRD 20: expired, cancelled and rejected proposals must never execute. */
export function isExecutableStatus(status: ProposalStatus): boolean {
  return !NOT_EXECUTABLE.has(status);
}

export function canTransition(status: ProposalStatus, operation: ProposalOperation): boolean {
  return TRANSITIONS[status][operation] !== undefined;
}

export function nextStatus(status: ProposalStatus, operation: ProposalOperation): ProposalStatus | undefined {
  return TRANSITIONS[status][operation];
}

/**
 * Resolve `status --operation--> next`, or throw a diagnostic that tells the
 * caller what they could have done instead.
 */
export function assertTransition(
  status: ProposalStatus,
  operation: ProposalOperation,
  context: { proposalId?: string; version?: number } = {},
): ProposalStatus {
  const next = TRANSITIONS[status][operation];
  if (next === undefined) {
    const allowed = allowedOperations(status);
    throw new ReviewKitError({
      code: 'E_INVALID_TRANSITION',
      message: `Cannot ${operation} a proposal in status "${status}"`,
      hint:
        allowed.length === 0
          ? `"${status}" is terminal. Submit a new proposal built from current source data instead.`
          : `From "${status}" you can: ${allowed.join(', ')}.`,
      details: { ...context, status, operation, allowed },
    });
  }
  return next;
}

/* ------------------------------------------------------------------ *
 * Item statuses (PRD 8.2)
 * ------------------------------------------------------------------ */

const ITEM_TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  pending: ['pending', 'approved', 'edited', 'rejected', 'invalidated'],
  approved: ['approved', 'pending', 'edited', 'rejected', 'invalidated'],
  edited: ['edited', 'pending', 'approved', 'rejected', 'invalidated'],
  rejected: ['rejected', 'pending', 'approved', 'edited', 'invalidated'],
  // Only a source refresh clears an invalidated item; a reviewer cannot approve
  // stale data by clicking twice.
  invalidated: ['invalidated', 'pending'],
};

export function canTransitionItem(from: ItemStatus, to: ItemStatus): boolean {
  return ITEM_TRANSITIONS[from].includes(to);
}

export function assertItemTransition(from: ItemStatus, to: ItemStatus, itemId: string): void {
  if (!canTransitionItem(from, to)) {
    throw new ReviewKitError({
      code: 'E_INVALID_TRANSITION',
      message: `Item ${itemId} cannot move from "${from}" to "${to}"`,
      hint:
        from === 'invalidated'
          ? 'Refresh the source data first (session.refreshSource) — invalidated items must be re-diffed before they can be approved.'
          : `Allowed next statuses: ${ITEM_TRANSITIONS[from].join(', ')}.`,
      details: { itemId, from, to, allowed: ITEM_TRANSITIONS[from] },
    });
  }
}

/* ------------------------------------------------------------------ *
 * Execution statuses (PRD 8.3)
 * ------------------------------------------------------------------ */

const EXECUTION_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  // A host that executes inline (prepareExecution + its own API call) may report a
  // terminal receipt without ever queueing, so those jumps are legal.
  not_started: ['queued', 'running', 'succeeded', 'partially_succeeded', 'failed'],
  queued: ['running', 'failed', 'succeeded', 'partially_succeeded', 'queued'],
  running: ['succeeded', 'partially_succeeded', 'failed', 'running'],
  // Retrying the failed slice of a batch is a P1 feature; the state machine
  // already permits it so the P1 UI does not need a core change.
  partially_succeeded: ['running', 'queued', 'partially_succeeded', 'succeeded', 'failed', 'rolled_back'],
  succeeded: ['rolled_back'],
  failed: ['queued', 'running', 'failed', 'rolled_back'],
  rolled_back: [],
};

export function canTransitionExecution(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return EXECUTION_TRANSITIONS[from].includes(to);
}

export function assertExecutionTransition(from: ExecutionStatus, to: ExecutionStatus, proposalId: string): void {
  if (!canTransitionExecution(from, to)) {
    throw new ReviewKitError({
      code: 'E_INVALID_TRANSITION',
      message: `Execution for proposal ${proposalId} cannot move from "${from}" to "${to}"`,
      hint:
        EXECUTION_TRANSITIONS[from].length === 0
          ? `"${from}" is a terminal execution status.`
          : `Allowed next statuses: ${EXECUTION_TRANSITIONS[from].join(', ')}.`,
      details: { proposalId, from, to, allowed: EXECUTION_TRANSITIONS[from] },
    });
  }
}

/** Derive the batch-level execution status from per-item results (PRD 10.5). */
export function deriveExecutionStatus(
  results: readonly { status: 'succeeded' | 'failed' | 'skipped' | 'rolled_back' }[],
): ExecutionStatus {
  if (results.length === 0) return 'failed';
  const succeeded = results.filter((r) => r.status === 'succeeded').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const rolledBack = results.filter((r) => r.status === 'rolled_back').length;
  if (rolledBack === results.length) return 'rolled_back';
  if (failed === 0 && succeeded > 0 && succeeded === results.length) return 'succeeded';
  if (succeeded === 0) return 'failed';
  return 'partially_succeeded';
}
