import { expect } from 'vitest';
import {
  createSequentialIdGenerator,
  createReviewSession,
  fixedClock,
  isReviewKitError,
  type Identity,
  type ProposalInput,
  type ReviewKitErrorCode,
  type ReviewSessionOptions,
} from '@reviewkit/core';

export const REVIEWER: Identity = { id: 'u_ada', name: 'Ada', kind: 'user' };
export const AGENT: Identity = { id: 'agent_1', name: 'Cleanup bot', kind: 'agent' };

/**
 * Assert that a call fails with a specific ReviewKit error code, and that the
 * error carries an actionable hint (PRD 20: "errors are actionable").
 */
export async function expectError(
  fn: () => unknown | Promise<unknown>,
  code: ReviewKitErrorCode,
): Promise<Error & { code: ReviewKitErrorCode; hint?: string; details: Record<string, unknown> }> {
  let thrown: unknown;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) {
    throw new Error(`Expected ${code} but the call resolved successfully`);
  }
  if (!isReviewKitError(thrown)) {
    throw new Error(`Expected a ReviewKitError (${code}) but got: ${String(thrown)}`);
  }
  expect(thrown.code, `wrong error code — message was: ${thrown.message}`).toBe(code);
  expect(thrown.hint, `${code} must explain what to do next`).toBeTruthy();
  return thrown;
}

/** A session with a frozen clock and predictable ids. */
export function testSession(options: Partial<ReviewSessionOptions> = {}) {
  const clock = fixedClock('2026-09-01T10:00:00.000Z');
  const session = createReviewSession({
    clock,
    ids: createSequentialIdGenerator(),
    defaultReviewer: REVIEWER,
    ...options,
  });
  return { session, clock };
}

/** A 3-record bulk CRM update, the running example from the PRD. */
export function crmInput(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    type: 'crm.contact.update',
    summary: 'Raise priority for 3 contacts with recent activity',
    reason: 'All three replied to the September campaign.',
    risk: { level: 'low', tags: ['bulk_write'] },
    target: { system: 'crm', resource: 'contacts', environment: 'production', sourceVersion: 'snap-1' },
    origin: { initiatedBy: AGENT, agent: 'cleanup-bot', agentRunId: 'run_1' },
    before: [
      { id: 'c_1', name: 'Alice', priority: 'low' },
      { id: 'c_2', name: 'Bob', priority: 'low' },
      { id: 'c_3', name: 'Cleo', priority: 'medium' },
    ],
    after: [
      { id: 'c_1', name: 'Alice', priority: 'high' },
      { id: 'c_2', name: 'Bob', priority: 'high' },
      { id: 'c_3', name: 'Cleo', priority: 'high' },
    ],
    ...overrides,
  };
}
