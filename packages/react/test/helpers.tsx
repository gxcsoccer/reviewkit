/**
 * Shared setup for the React tests.
 *
 * Every test drives a real `ReviewSession` — an in-memory one with a frozen clock and
 * sequential ids — so what the UI shows is whatever the headless core actually decided.
 * Nothing here stubs the session.
 */
import { expect } from 'vitest';
import {
  computePayloadHash,
  createReviewSession,
  createSequentialIdGenerator,
  fixedClock,
  type ActionProposal,
  type ExecutionReceipt,
  type ExecutionRequest,
  type Identity,
  type ItemExecutionResult,
  type ProposalInput,
  type ReviewSession,
  type ReviewSessionOptions,
} from '@reviewkit/core';

export const NOW = '2026-09-01T10:00:00.000Z';
export const REVIEWER: Identity = { id: 'u_ada', name: 'Ada', kind: 'user' };
export const AGENT: Identity = { id: 'agent_1', name: 'Cleanup bot', kind: 'agent' };

export function testSession(options: Partial<ReviewSessionOptions> = {}): {
  session: ReviewSession;
  clock: ReturnType<typeof fixedClock>;
} {
  const clock = fixedClock(NOW);
  const session = createReviewSession({
    clock,
    ids: createSequentialIdGenerator(),
    defaultReviewer: REVIEWER,
    ...options,
  });
  return { session, clock };
}

/** The PRD's running example: a 3-record bulk CRM update. */
export function crmInput(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    type: 'crm.contact.update',
    summary: 'Raise priority for 3 contacts with recent activity',
    reason: 'All three replied to the September campaign.',
    risk: { level: 'low', tags: ['bulk_write'] },
    target: { system: 'crm', resource: 'contacts', environment: 'production', sourceVersion: 'snap-1' },
    origin: { initiatedBy: AGENT, agent: 'cleanup-bot', agentRunId: 'run_1' },
    before: [
      { id: 'c_1', name: 'Alice', priority: 'low', email: 'alice@example.com' },
      { id: 'c_2', name: 'Bob', priority: 'low', email: 'bob@example.com' },
      { id: 'c_3', name: 'Cleo', priority: 'medium', email: 'cleo@example.com' },
    ],
    after: [
      { id: 'c_1', name: 'Alice', priority: 'high', email: 'alice@example.com' },
      { id: 'c_2', name: 'Bob', priority: 'high', email: 'bob@example.com' },
      { id: 'c_3', name: 'Cleo', priority: 'high', email: 'cleo@example.com' },
    ],
    ...overrides,
  };
}

/** A single JSON item, handy when one card is enough. */
export function singleInput(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    type: 'crm.contact.update',
    summary: 'Raise priority for Alice',
    risk: { level: 'medium' },
    origin: { initiatedBy: AGENT },
    items: [
      {
        id: 'c_1',
        kind: 'json',
        operation: 'update',
        before: { name: 'Alice', priority: 'low' },
        after: { name: 'Alice', priority: 'high' },
      },
    ],
    ...overrides,
  };
}

/**
 * A host receipt that matches the request's payload hash, so it is accepted.
 * Pass `results` to model partial success (PRD 10.5).
 */
export function receiptFor(
  request: ExecutionRequest,
  overrides: Partial<ExecutionReceipt> & { results?: ItemExecutionResult[] } = {},
): ExecutionReceipt {
  const results = overrides.results;
  const status =
    overrides.status ??
    (results
      ? results.every((result) => result.status === 'succeeded')
        ? 'succeeded'
        : results.some((result) => result.status === 'succeeded')
          ? 'partially_succeeded'
          : 'failed'
      : 'succeeded');
  return {
    schemaVersion: '0.1',
    id: `rcpt_${request.id}`,
    proposalId: request.proposalId,
    proposalVersion: request.proposalVersion,
    decisionId: request.decisionId,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    executedParamsHash: request.payloadHash,
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides,
    status,
    ...(results ? { results } : {}),
  };
}

/** A receipt whose parameters do not match the approval — must fail closed. */
export function tamperedReceipt(request: ExecutionRequest): ExecutionReceipt {
  return {
    ...receiptFor(request),
    executedParamsHash: computePayloadHash({ tampered: true } as never),
  };
}

/** Reads the rendered order of a set of selectors, for layout-order assertions. */
export function domOrder(root: ParentNode, selectors: readonly string[]): string[] {
  const found = selectors.flatMap((selector) => {
    const element = root.querySelector(selector);
    return element ? [{ selector, element }] : [];
  });
  return found
    .sort((a, b) =>
      a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
    .map((entry) => entry.selector);
}

/** Fails with the proposal's status attached, which is usually the missing context. */
export function expectStatus(proposal: ActionProposal, status: ActionProposal['status']): void {
  expect(proposal.status, `proposal ${proposal.id} version ${proposal.version}`).toBe(status);
}
