/**
 * @reviewkit/core — headless human review for agent actions.
 *
 * No React, no network, no cloud. Start here:
 *
 * ```ts
 * import { createReviewSession } from '@reviewkit/core';
 *
 * const session = createReviewSession({ defaultReviewer: { id: 'u_1', kind: 'user' } });
 * const { proposal } = await session.submit({
 *   type: 'crm.contact.update',
 *   before: [{ id: 'c_1', priority: 'low' }],
 *   after:  [{ id: 'c_1', priority: 'high' }],
 * });
 * const { decision } = await session.approve(proposal.id);
 * const request = await session.requestExecution(decision.id);   // fail-closed payload
 * ```
 */

/* Types and protocol */
export * from './types.js';
export * from './errors.js';
export {
  SCHEMA_COMPATIBILITY,
  SCHEMA_FILES,
  SCHEMA_IDS,
  type SchemaName,
} from './schema.js';

/* Determinism primitives */
export { canonicalEquals, canonicalize } from './canonical.js';
export { sha256Bytes, sha256Hex, toHex } from './sha256.js';
export {
  assertContentHash,
  buildExecutionPayload,
  computeApprovedHash,
  computeContentHash,
  computePayloadHash,
  digest,
  hashEquals,
  isContentHash,
} from './hash.js';
export { fixedClock, systemClock, type Clock } from './clock.js';
export { createIdGenerator, createSequentialIdGenerator, type IdGenerator, type IdKind } from './ids.js';

/* State model */
export {
  allowedOperations,
  assertExecutionTransition,
  assertItemTransition,
  assertTransition,
  canTransition,
  canTransitionExecution,
  canTransitionItem,
  deriveExecutionStatus,
  isExecutableStatus,
  isReadOnlyStatus,
  nextStatus,
  type ProposalOperation,
} from './machine.js';

/* Building, validating and revising proposals */
export { createProposal, isActionProposal, normalizeProposal, type NormalizeOptions } from './normalize.js';
export {
  LIMITS,
  assertValidDecision,
  assertValidProposal,
  assertValidReceipt,
  formatIssues,
  validateDecision,
  validateProposal,
  validateReceipt,
  type ValidateOptions,
} from './validate.js';
export {
  checkSourceVersions,
  markItemsInvalidated,
  refreshSource,
  reviseProposal,
  type ItemEdit,
  type ProposalPatch,
  type ReviseOptions,
  type ReviseResult,
  type SourceCheckResult,
  type SourceSnapshot,
} from './revise.js';

/* Diff / renderer input */
export * from './diff/index.js';

/* Execution gate */
export {
  assertExecutable,
  assertMatchesApproval,
  buildApprovedPayload,
  prepareExecution,
  verifyDecisionBinding,
  verifyReceipt,
  type ExecutableOptions,
} from './execution.js';

/* Safety helpers used by renderers and hosts */
export { formatValue, sanitizeText, sanitizeUrl } from './sanitize.js';
export {
  DEFAULT_MASK,
  isMasked,
  logDigest,
  maskData,
  maskedPaths,
  pathMatches,
  pathSegments,
  type ProposalLogDigest,
} from './redact.js';
export {
  createLogger,
  silentLogger,
  type LogLevel,
  type LogRecord,
  type Logger,
  type LoggerOptions,
} from './logger.js';
export { createEventEmitter, type EventEmitter, type EventEmitterOptions } from './events.js';

/* Storage */
export * from './store/index.js';

/* Orchestration */
export {
  createReviewSession,
  type ActorOptions,
  type ApproveOptions,
  type AuditTrail,
  type DecisionResult,
  type DeferOptions,
  type Expectation,
  type ReceiptOutcome,
  type RejectOptions,
  type ReviewPolicy,
  type ReviewSession,
  type ReviewSessionOptions,
  type ReviseResultPublic,
  type SourceCheckOutcome,
  type SubmitResult,
} from './session.js';

export { ContentHashType, IdentityType, RiskLevelType, isStandardSchema } from "./ark.js";
