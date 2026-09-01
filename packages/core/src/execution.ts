/**
 * The gate between "approved" and "executed" (PRD 12.3, 20).
 *
 * These are pure functions so a host can call them anywhere — including on a
 * server, right before the outbound API call — without building a session:
 *
 * ```ts
 * assertExecutable(proposal, decision, { now: Date.now() });
 * const receiptHash = computePayloadHash(payloadYouAreAboutToSend);
 * assertMatchesApproval(decision, receiptHash);   // fail closed
 * ```
 */
import { ReviewKitError } from './errors.js';
import { buildExecutionPayload, computePayloadHash } from './hash.js';
import { isExecutableStatus } from './machine.js';
import {
  SCHEMA_VERSION,
  type ActionProposal,
  type ContentHash,
  type ExecutionPayload,
  type ExecutionReceipt,
  type ExecutionRequest,
  type ReviewDecision,
} from './types.js';

export interface ExecutableOptions {
  /** Milliseconds since epoch, for the expiry check. Default: `Date.now()`. */
  now?: number;
}

/**
 * Verify that a decision still describes this exact proposal revision.
 * This is the check that stops "you approved v2, we executed v3".
 */
export function verifyDecisionBinding(proposal: ActionProposal, decision: ReviewDecision): void {
  if (decision.proposalId !== proposal.id) {
    throw new ReviewKitError({
      code: 'E_CONTRACT',
      message: `Decision ${decision.id} belongs to proposal ${decision.proposalId}, not ${proposal.id}`,
      hint: 'Load the decision by proposal id, or pass the matching pair.',
      details: { decisionId: decision.id, decisionProposalId: decision.proposalId, proposalId: proposal.id },
    });
  }
  if (decision.proposalVersion !== proposal.version) {
    throw new ReviewKitError({
      code: 'E_STALE_DECISION',
      message: `Decision ${decision.id} approved v${decision.proposalVersion}, but the current proposal is v${proposal.version}`,
      hint: 'The proposal was edited after this approval. Ask the reviewer to approve the current version (the UI shows the new diff).',
      details: {
        proposalId: proposal.id,
        decisionId: decision.id,
        approvedVersion: decision.proposalVersion,
        currentVersion: proposal.version,
      },
    });
  }
  if (decision.contentHash !== proposal.contentHash) {
    throw new ReviewKitError({
      code: 'E_HASH_MISMATCH',
      message: `Decision ${decision.id} is bound to a different content hash than proposal ${proposal.id} v${proposal.version}`,
      hint: 'Content changed without a version bump — do not execute. Re-submit the proposal through ReviewKit so it is re-hashed.',
      details: {
        proposalId: proposal.id,
        decisionId: decision.id,
        approvedHash: decision.contentHash,
        currentHash: proposal.contentHash,
      },
    });
  }
}

/**
 * Full pre-execution check. Throws unless this decision may be executed against
 * this proposal right now.
 */
export function assertExecutable(
  proposal: ActionProposal,
  decision: ReviewDecision,
  options: ExecutableOptions = {},
): void {
  const now = options.now ?? Date.now();

  if (decision.kind !== 'approve' && decision.kind !== 'approve_with_edits') {
    throw new ReviewKitError({
      code: 'E_NOT_EXECUTABLE',
      message: `Decision ${decision.id} is "${decision.kind}", which never authorizes execution`,
      hint: 'Only approve / approve_with_edits decisions can be executed.',
      details: { decisionId: decision.id, kind: decision.kind },
    });
  }

  if (proposal.status !== 'approved' || !isExecutableStatus(proposal.status)) {
    throw new ReviewKitError({
      code: 'E_NOT_EXECUTABLE',
      message: `Proposal ${proposal.id} is "${proposal.status}" and must not be executed`,
      hint:
        proposal.status === 'invalidated'
          ? 'Source data changed during review. Refresh the source, re-diff, and have the reviewer approve again.'
          : 'Only proposals in status "approved" may execute (PRD 20: expired, cancelled and rejected must fail closed).',
      details: { proposalId: proposal.id, status: proposal.status },
    });
  }

  verifyDecisionBinding(proposal, decision);

  if (proposal.expiresAt && Date.parse(proposal.expiresAt) <= now) {
    throw new ReviewKitError({
      code: 'E_EXPIRED',
      message: `Proposal ${proposal.id} expired at ${proposal.expiresAt}`,
      hint: 'Create a new revision from current source data and review it again.',
      details: { proposalId: proposal.id, expiresAt: proposal.expiresAt, now: new Date(now).toISOString() },
    });
  }

  const approvedIds = decision.approvedItemIds ?? [];
  if (approvedIds.length === 0) {
    throw new ReviewKitError({
      code: 'E_NOT_EXECUTABLE',
      message: `Decision ${decision.id} approved zero items`,
      hint: 'Nothing to execute. Approve at least one item, or reject the proposal.',
      details: { decisionId: decision.id },
    });
  }

  const invalidated = proposal.items.filter((item) => approvedIds.includes(item.id) && item.status === 'invalidated');
  if (invalidated.length > 0) {
    throw new ReviewKitError({
      code: 'E_SOURCE_CHANGED',
      message: `${invalidated.length} approved item(s) were invalidated after approval`,
      hint: 'Refresh source data (session.refreshSource) and review the affected items again.',
      details: { proposalId: proposal.id, itemIds: invalidated.map((item) => item.id) },
    });
  }

  // The approved subset must still hash to what the reviewer approved.
  const currentApprovedHash = computePayloadHash(buildExecutionPayload(proposal, approvedIds));
  if (decision.approvedContentHash !== currentApprovedHash) {
    throw new ReviewKitError({
      code: 'E_HASH_MISMATCH',
      message: `Approved payload for decision ${decision.id} no longer hashes to the approved value`,
      hint: 'Do not execute. Re-read the proposal and ask the reviewer to approve the current content.',
      details: {
        proposalId: proposal.id,
        decisionId: decision.id,
        approvedHash: decision.approvedContentHash,
        currentHash: currentApprovedHash,
      },
    });
  }
}

/** Payload + hash for an approved decision. Call `assertExecutable` first. */
export function buildApprovedPayload(
  proposal: ActionProposal,
  decision: ReviewDecision,
): { payload: ExecutionPayload; payloadHash: ContentHash } {
  const payload = buildExecutionPayload(proposal, decision.approvedItemIds ?? []);
  return { payload, payloadHash: computePayloadHash(payload) };
}

/**
 * Fail-closed comparison of "what I am about to execute" against
 * "what was approved" (PRD 20).
 */
export function assertMatchesApproval(
  decision: ReviewDecision,
  actualParamsHash: ContentHash,
  context: { requestId?: string; proposalId?: string } = {},
): void {
  const expected = decision.approvedContentHash;
  if (expected === undefined) {
    throw new ReviewKitError({
      code: 'E_NOT_EXECUTABLE',
      message: `Decision ${decision.id} carries no approved payload hash`,
      hint: 'Only approve / approve_with_edits decisions can be executed.',
      details: { decisionId: decision.id, kind: decision.kind, ...context },
    });
  }
  if (expected !== actualParamsHash) {
    throw new ReviewKitError({
      code: 'E_HASH_MISMATCH',
      message: 'Executed parameters do not match the approved parameters',
      hint:
        'Fail closed: do not execute (or roll back). Something modified the payload between approval and execution — compare buildApprovedPayload(proposal, decision).payload against what your executor received.',
      details: { decisionId: decision.id, approvedHash: expected, actualHash: actualParamsHash, ...context },
    });
  }
}

/** Verify a returned receipt against the request it claims to answer. */
export function verifyReceipt(
  receipt: ExecutionReceipt,
  reference: { decision: ReviewDecision; request?: ExecutionRequest },
): void {
  const { decision, request } = reference;
  if (receipt.decisionId !== decision.id) {
    throw new ReviewKitError({
      code: 'E_CONTRACT',
      message: `Receipt ${receipt.id} references decision ${receipt.decisionId}, expected ${decision.id}`,
      details: { receiptId: receipt.id, decisionId: decision.id },
    });
  }
  const expectedHash = request?.payloadHash ?? decision.approvedContentHash;
  if (expectedHash !== receipt.executedParamsHash) {
    throw new ReviewKitError({
      code: 'E_HASH_MISMATCH',
      message: `Receipt ${receipt.id} reports parameters that were not the approved ones`,
      hint:
        'The host executed something other than the approved payload. Treat the execution as unauthorized: alert, and roll back if the action was reversible.',
      details: {
        receiptId: receipt.id,
        decisionId: decision.id,
        expectedHash,
        reportedHash: receipt.executedParamsHash,
        requestId: request?.id,
      },
    });
  }
  if (request && receipt.idempotencyKey !== request.idempotencyKey) {
    throw new ReviewKitError({
      code: 'E_CONTRACT',
      message: `Receipt ${receipt.id} has idempotency key "${receipt.idempotencyKey}", expected "${request.idempotencyKey}"`,
      hint: 'Echo back the request idempotency key so retries can be de-duplicated.',
      details: { receiptId: receipt.id, requestId: request.id },
    });
  }
}

/**
 * Convenience for hosts that execute inline: computes the payload hash of what
 * they are about to send and checks it in one call.
 */
export function prepareExecution(
  proposal: ActionProposal,
  decision: ReviewDecision,
  options: ExecutableOptions = {},
): { payload: ExecutionPayload; payloadHash: ContentHash; schemaVersion: typeof SCHEMA_VERSION } {
  assertExecutable(proposal, decision, options);
  const { payload, payloadHash } = buildApprovedPayload(proposal, decision);
  assertMatchesApproval(decision, payloadHash, { proposalId: proposal.id });
  return { payload, payloadHash, schemaVersion: SCHEMA_VERSION };
}
