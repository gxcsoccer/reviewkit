/**
 * ReviewSession — the headless orchestrator.
 *
 * It owns the invariants that are easy to get wrong when hand-rolling a review UI:
 *
 *  - illegal state transitions are refused, with a hint about what *is* legal;
 *  - every mutation is optimistically locked, so a second reviewer sees a conflict
 *     instead of silently overwriting the first;
 *  - editing an execution field creates a new revision and voids old approvals;
 *  - approvals are bound to (proposal id, version, content hash, approved subset);
 *  - one decision can never yield two execution requests;
 *  - receipts that report a different payload hash are rejected (fail closed);
 *  - expiry, cancellation and rejection all fail closed before execution.
 *
 * Everything is injected: store, clock, ids, logger, event emitter. Nothing here
 * performs I/O against a ReviewKit service, because there is none (PRD 12.1).
 */
import { systemClock, type Clock } from './clock.js';
import { createEventEmitter, type EventEmitter } from './events.js';
import { ReviewKitError } from './errors.js';
import { assertExecutable, buildApprovedPayload, verifyDecisionBinding, verifyReceipt } from './execution.js';
import { buildExecutionPayload, computePayloadHash } from './hash.js';
import { createIdGenerator, type IdGenerator } from './ids.js';
import { silentLogger, type Logger } from './logger.js';
import {
  assertExecutionTransition,
  assertItemTransition,
  assertTransition,
  deriveExecutionStatus,
  type ProposalOperation,
} from './machine.js';
import { normalizeProposal, type NormalizeOptions } from './normalize.js';
import { logDigest } from './redact.js';
import {
  checkSourceVersions,
  markItemsInvalidated,
  refreshSource as refreshSourceRevision,
  reviseProposal,
  type ItemEdit,
  type ProposalPatch,
  type SourceCheckResult,
  type SourceSnapshot,
} from './revise.js';
import { createMemoryStore } from './store/memory.js';
import type { ProposalPage, ProposalQuery, ReviewStore, StoredProposal } from './store/types.js';
import { assertValidReceipt } from './validate.js';
import {
  RISK_ORDER,
  SCHEMA_VERSION,
  type ActionProposal,
  type ExecutionReceipt,
  type ExecutionRequest,
  type Identity,
  type ItemDecision,
  type ItemStatus,
  type JsonObject,
  type ProposalInput,
  type ReviewDecision,
  type ReviewEvent,
  type ReviewEventName,
  type RiskLevel,
} from './types.js';

/** Host rules the core enforces. All have safe defaults. */
export interface ReviewPolicy {
  /**
   * Highest risk level allowed inside a *multi-item* approval.
   * Default `low`: higher-risk items must be approved individually, or with an
   * explicit acknowledgement (PRD 10.1, 20 — high risk is never hidden in a
   * bulk approve).
   */
  bulkApproveMaxRisk: RiskLevel;
  /** Require every item to be decided before the proposal can be approved. Default false. */
  requireAllItemsDecided: boolean;
  /** Allow approving a subset of items. Default true. */
  allowPartialApproval: boolean;
  /** Applied to submitted proposals that carry no `expiresAt`. */
  defaultTtlMs?: number;
}

const DEFAULT_POLICY: ReviewPolicy = {
  bulkApproveMaxRisk: 'low',
  requireAllItemsDecided: false,
  allowPartialApproval: true,
};

export interface ReviewSessionOptions {
  store?: ReviewStore;
  clock?: Clock;
  ids?: IdGenerator;
  logger?: Logger;
  emitter?: EventEmitter;
  policy?: Partial<ReviewPolicy>;
  /** Shorthand for `emitter.on('*', listener)`. */
  onEvent?: (event: ReviewEvent) => void | Promise<void>;
  /** Identity recorded when a call omits one. */
  defaultReviewer?: Identity;
  normalize?: NormalizeOptions;
}

/** Optimistic-lock expectations. Pass what the reviewer was looking at. */
export interface Expectation {
  version?: number;
  contentHash?: string;
  /** Store sequence from a previous read. */
  seq?: number;
}

export interface ActorOptions {
  reviewer?: Identity;
  expect?: Expectation;
}

export interface ApproveOptions extends ActorOptions {
  /** Approve only these items (partial approval). Defaults to every approvable item. */
  itemIds?: string[];
  note?: string;
  tags?: string[];
  /**
   * Required to include items above `policy.bulkApproveMaxRisk` in a multi-item
   * approval. The React UI only sets this after the reviewer expanded each
   * high-risk item.
   */
  acknowledgeHighRisk?: boolean;
}

export interface RejectOptions extends ActorOptions {
  reason?: { tags?: string[]; note?: string };
}

export interface DeferOptions extends ActorOptions {
  until?: string;
  ttlMs?: number;
  note?: string;
}

export interface SubmitResult {
  proposal: ActionProposal;
  /** False when an existing proposal with the same idempotency key was returned. */
  created: boolean;
}

export interface DecisionResult {
  proposal: ActionProposal;
  decision: ReviewDecision;
  /** False when an identical decision already existed and was returned as-is. */
  created: boolean;
}

export interface ReviseResultPublic {
  proposal: ActionProposal;
  revised: boolean;
  changedFields: string[];
  previousVersion: number;
  previousContentHash: string;
}

export interface SourceCheckOutcome {
  proposal: ActionProposal;
  drift: SourceCheckResult;
  invalidated: boolean;
}

export interface ReceiptOutcome {
  proposal: ActionProposal;
  receipt: ExecutionReceipt;
  /** False when this receipt id was already recorded (idempotent replay). */
  created: boolean;
}

export interface AuditTrail {
  proposal: ActionProposal;
  revisions: ActionProposal[];
  decisions: ReviewDecision[];
  receipts: ExecutionReceipt[];
  events: ReviewEvent[];
}

const IDEMPOTENCY_SCOPE = {
  submit: 'submit',
  approve: 'approve',
  execution: 'execution-request',
  receipt: 'receipt',
} as const;

export interface ReviewSession {
  readonly store: ReviewStore;
  readonly policy: ReviewPolicy;
  readonly clock: Clock;

  submit(input: ProposalInput | ActionProposal): Promise<SubmitResult>;
  saveDraft(input: ProposalInput): Promise<ActionProposal>;
  get(id: string): Promise<ActionProposal>;
  getRecord(id: string): Promise<StoredProposal>;
  tryGet(id: string): Promise<ActionProposal | null>;
  list(query?: ProposalQuery): Promise<ProposalPage>;

  startReview(id: string, options?: ActorOptions): Promise<ActionProposal>;
  setItemStatus(
    id: string,
    itemIds: string[],
    status: Extract<ItemStatus, 'pending' | 'approved' | 'rejected'>,
    options?: ActorOptions & { acknowledgeHighRisk?: boolean },
  ): Promise<ActionProposal>;
  editItem(id: string, edit: ItemEdit, options?: ActorOptions): Promise<ReviseResultPublic>;
  revise(id: string, patch: ProposalPatch, options?: ActorOptions & { reason?: string }): Promise<ReviseResultPublic>;

  approve(id: string, options?: ApproveOptions): Promise<DecisionResult>;
  reject(id: string, options?: RejectOptions): Promise<DecisionResult>;
  defer(id: string, options?: DeferOptions): Promise<DecisionResult>;
  requestChanges(id: string, options?: RejectOptions): Promise<ActionProposal>;
  cancel(id: string, options?: ActorOptions & { reason?: string }): Promise<ActionProposal>;
  expire(id: string): Promise<ActionProposal>;
  sweepExpired(): Promise<string[]>;
  createRevision(
    id: string,
    patch?: ProposalPatch,
    options?: ActorOptions & { reason?: string },
  ): Promise<ActionProposal>;

  checkSource(
    id: string,
    snapshots: readonly SourceSnapshot[],
    options?: { currentTargetVersion?: string; invalidate?: boolean },
  ): Promise<SourceCheckOutcome>;
  refreshSource(
    id: string,
    snapshots: readonly SourceSnapshot[],
    options?: ActorOptions & { currentTargetVersion?: string; reason?: string; dropMissingItems?: boolean },
  ): Promise<ActionProposal>;

  requestExecution(decisionId: string): Promise<ExecutionRequest>;
  markExecutionStarted(requestId: string): Promise<ActionProposal>;
  recordReceipt(receipt: ExecutionReceipt): Promise<ReceiptOutcome>;

  audit(id: string): Promise<AuditTrail>;
  on(name: ReviewEventName | '*', listener: (event: ReviewEvent) => void | Promise<void>): () => void;
}

export function createReviewSession(options: ReviewSessionOptions = {}): ReviewSession {
  const store = options.store ?? createMemoryStore();
  const clock = options.clock ?? systemClock();
  const ids = options.ids ?? createIdGenerator({ clock });
  const logger = options.logger ?? silentLogger();
  const policy: ReviewPolicy = { ...DEFAULT_POLICY, ...options.policy };
  const emitter =
    options.emitter ??
    createEventEmitter({
      onError: (error, event) =>
        logger.warn('event listener threw', { event: event.name, error: String(error) }),
    });

  if (options.onEvent) emitter.on('*', options.onEvent);

  /* ---------------- helpers ---------------- */

  /**
   * Serialize this session's writes per proposal.
   *
   * Two clicks on Approve, or a React StrictMode double effect, fire genuinely
   * concurrently; without this, both would read the same `seq`, both would pass the
   * idempotency check, and one would lose a write. Cross-process safety still comes
   * from `expectedSeq` — this only removes races inside one session instance.
   *
   * Non-reentrant: locked methods must never call another locked method.
   */
  const locks = new Map<string, { tail: Promise<unknown>; waiting: number }>();
  const locked = async <T>(proposalId: string, work: () => Promise<T>): Promise<T> => {
    const entry = locks.get(proposalId) ?? { tail: Promise.resolve(), waiting: 0 };
    entry.waiting += 1;
    locks.set(proposalId, entry);
    const current = entry.tail.then(work, work); // run regardless of the previous outcome
    entry.tail = current.catch(() => undefined);
    try {
      return await current;
    } finally {
      entry.waiting -= 1;
      if (entry.waiting === 0 && locks.get(proposalId) === entry) locks.delete(proposalId);
    }
  };

  const emit = async (
    name: ReviewEventName,
    proposal: ActionProposal,
    data: JsonObject = {},
    actor?: Identity,
  ): Promise<void> => {
    const event: ReviewEvent = {
      id: ids('event'),
      name,
      at: clock.iso(),
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      contentHash: proposal.contentHash,
      data,
    };
    if (proposal.traceId) event.traceId = proposal.traceId;
    if (actor) event.actor = actor.kind === undefined ? { id: actor.id } : { id: actor.id, kind: actor.kind };
    await store.appendEvent(event);
    await emitter.emit(event);
    logger.debug(`event ${name}`, { ...logDigest(proposal), event: name });
  };

  const load = async (id: string): Promise<StoredProposal> => {
    const record = await store.getProposal(id);
    if (!record) {
      throw new ReviewKitError({
        code: 'E_NOT_FOUND',
        message: `No proposal with id "${id}"`,
        hint: 'Submit it first (session.submit) or check the id — ids are case-sensitive.',
        details: { proposalId: id },
      });
    }
    return record;
  };

  const checkExpectation = (record: StoredProposal, expect: Expectation | undefined): void => {
    if (!expect) return;
    const { proposal, seq } = record;
    const mismatch =
      (expect.version !== undefined && expect.version !== proposal.version) ||
      (expect.contentHash !== undefined && expect.contentHash !== proposal.contentHash) ||
      (expect.seq !== undefined && expect.seq !== seq);
    if (mismatch) {
      throw new ReviewKitError({
        code: 'E_VERSION_CONFLICT',
        message: `Proposal ${proposal.id} changed while you were reviewing it`,
        hint: 'Reload the proposal, show the reviewer what changed, and ask them to confirm again (PRD 8: last writer must see the conflict).',
        details: {
          proposalId: proposal.id,
          expected: expect,
          actual: { version: proposal.version, contentHash: proposal.contentHash, seq },
        },
      });
    }
  };

  /** Expire lazily: any interaction with an overdue proposal closes it first. */
  const enforceExpiry = async (record: StoredProposal): Promise<StoredProposal> => {
    const { proposal } = record;
    if (!proposal.expiresAt) return record;
    if (Date.parse(proposal.expiresAt) > clock.now()) return record;
    if (proposal.status === 'expired' || !canDo(proposal, 'expire')) {
      if (proposal.status !== 'expired') return record;
      throw expiredError(proposal);
    }
    const expired: ActionProposal = {
      ...proposal,
      status: assertTransition(proposal.status, 'expire', { proposalId: proposal.id }),
      updatedAt: clock.iso(),
    };
    const saved = await store.putProposal(expired, { expectedSeq: record.seq });
    await emit('proposal.expired', expired, { expiresAt: expired.expiresAt ?? null });
    throw expiredError(saved.proposal);
  };

  const expiredError = (proposal: ActionProposal): ReviewKitError =>
    new ReviewKitError({
      code: 'E_EXPIRED',
      message: `Proposal ${proposal.id} expired at ${proposal.expiresAt}`,
      hint: 'Expired proposals are read-only. Create a new revision from current source data (session.createRevision).',
      details: { proposalId: proposal.id, expiresAt: proposal.expiresAt },
    });

  const canDo = (proposal: ActionProposal, operation: ProposalOperation): boolean => {
    try {
      assertTransition(proposal.status, operation, { proposalId: proposal.id });
      return true;
    } catch {
      return false;
    }
  };

  const optionsDefaultReviewer = (): Identity => {
    if (options.defaultReviewer) return options.defaultReviewer;
    throw new ReviewKitError({
      code: 'E_CONTRACT',
      message: 'No reviewer identity supplied',
      hint:
        'Pass `reviewer: { id, name }` on the call, or set `defaultReviewer` when creating the session. ReviewKit records identities but never authenticates them (PRD 12.7).',
    });
  };

  const effectiveRisk = (proposal: ActionProposal, itemId: string): RiskLevel => {
    const item = proposal.items.find((candidate) => candidate.id === itemId);
    return item?.risk?.level ?? proposal.risk.level;
  };

  /**
   * PRD 10.1 / 20: high-risk items are never swept into a bulk approval by
   * default. One-at-a-time approval is always allowed; the UI is what forces the
   * reviewer to expand the item first.
   */
  const enforceBulkRiskPolicy = (
    proposal: ActionProposal,
    itemIds: readonly string[],
    acknowledged: boolean | undefined,
  ): void => {
    if (itemIds.length <= 1 || acknowledged) return;
    const ceiling = RISK_ORDER.indexOf(policy.bulkApproveMaxRisk);
    const blocked = itemIds.filter((id) => RISK_ORDER.indexOf(effectiveRisk(proposal, id)) > ceiling);
    if (blocked.length === 0) return;
    throw new ReviewKitError({
      code: 'E_RISK_POLICY',
      message: `${blocked.length} of ${itemIds.length} items exceed the bulk-approval risk ceiling "${policy.bulkApproveMaxRisk}"`,
      hint:
        'Approve those items individually after opening them, or pass acknowledgeHighRisk: true once the reviewer has actually seen each one.',
      details: {
        proposalId: proposal.id,
        ceiling: policy.bulkApproveMaxRisk,
        blockedItemIds: blocked,
        blockedRisks: blocked.map((id) => effectiveRisk(proposal, id)),
      },
    });
  };

  const applyItemStatuses = (
    proposal: ActionProposal,
    itemIds: readonly string[],
    status: ItemStatus,
  ): ActionProposal => {
    const wanted = new Set(itemIds);
    return {
      ...proposal,
      items: proposal.items.map((item) => {
        if (!wanted.has(item.id)) return item;
        if (item.status === status) return item;
        assertItemTransition(item.status, status, item.id);
        return { ...item, status };
      }),
    };
  };

  const transition = (proposal: ActionProposal, operation: ProposalOperation): ActionProposal => ({
    ...proposal,
    status: assertTransition(proposal.status, operation, { proposalId: proposal.id, version: proposal.version }),
    updatedAt: clock.iso(),
  });

  /** Move `pending_review` → `reviewing` implicitly, so hosts need one call, not two. */
  const ensureReviewing = async (
    record: StoredProposal,
    reviewer: Identity,
  ): Promise<StoredProposal> => {
    if (record.proposal.status !== 'pending_review') return record;
    const next = transition(record.proposal, 'startReview');
    const saved = await store.putProposal(next, { expectedSeq: record.seq });
    await emit('review.started', saved.proposal, { reviewer: reviewer.id }, reviewer);
    return saved;
  };

  /* ---------------- implementation ---------------- */

  /**
   * `impl` methods assume the caller already holds the per-proposal lock. The
   * exported `session` below wraps the mutating ones; use `impl.x` internally to
   * avoid deadlocking on a non-reentrant lock.
   */
  const impl: ReviewSession = {
    store,
    policy,
    clock,

    async submit(input) {
      const normalizeOptions: NormalizeOptions = {
        clock,
        ...options.normalize,
      };
      if (policy.defaultTtlMs !== undefined && normalizeOptions.defaultTtlMs === undefined) {
        normalizeOptions.defaultTtlMs = policy.defaultTtlMs;
      }
      const normalized = normalizeProposal(input, normalizeOptions);

      return locked(normalized.id, async () => {
        // Same idempotency key ⇒ same logical action; return the stored proposal
        // instead of creating a duplicate queue entry.
        const ledger = await store.putOnce(IDEMPOTENCY_SCOPE.submit, normalized.idempotencyKey, normalized.id);
        if (!ledger.created) {
          const existing = await store.getProposal(String(ledger.value));
          if (existing) {
            logger.info('submit deduplicated', {
              ...logDigest(existing.proposal),
              idempotencyKey: normalized.idempotencyKey,
            });
            return { proposal: existing.proposal, created: false };
          }
        }

        const proposal =
          normalized.status === 'draft'
            ? transition(normalized, 'submit')
            : { ...normalized, status: normalized.status };
        const saved = await store.putProposal(proposal);
        await emit(
          'proposal.submitted',
          saved.proposal,
          { itemCount: saved.proposal.items.length, riskLevel: saved.proposal.risk.level },
          saved.proposal.origin.initiatedBy,
        );
        logger.info('proposal submitted', logDigest(saved.proposal));
        return { proposal: saved.proposal, created: true };
      });
    },

    async saveDraft(input) {
      const draft = normalizeProposal(input, { clock, ...options.normalize, status: 'draft' });
      const saved = await store.putProposal(draft);
      return saved.proposal;
    },

    async get(id) {
      return (await load(id)).proposal;
    },

    async getRecord(id) {
      return load(id);
    },

    async tryGet(id) {
      const record = await store.getProposal(id);
      return record?.proposal ?? null;
    },

    async list(query) {
      return store.listProposals(query);
    },

    async startReview(id, actorOptions = {}) {
      const record = await enforceExpiry(await load(id));
      checkExpectation(record, actorOptions.expect);
      const reviewer = actorOptions.reviewer ?? optionsDefaultReviewer();
      if (record.proposal.status === 'reviewing') return record.proposal;
      const next = transition(record.proposal, 'startReview');
      const saved = await store.putProposal(next, { expectedSeq: record.seq });
      await emit('review.started', saved.proposal, { reviewer: reviewer.id }, reviewer);
      return saved.proposal;
    },

    async setItemStatus(id, itemIds, status, actorOptions = {}) {
      const record0 = await enforceExpiry(await load(id));
      checkExpectation(record0, actorOptions.expect);
      const reviewer = actorOptions.reviewer ?? optionsDefaultReviewer();
      const record = await ensureReviewing(record0, reviewer);

      if (status === 'approved') {
        enforceBulkRiskPolicy(record.proposal, itemIds, actorOptions.acknowledgeHighRisk);
      }

      const withStatuses = applyItemStatuses(record.proposal, itemIds, status);
      const next = transition(withStatuses, 'updateItems');
      const saved = await store.putProposal(next, { expectedSeq: record.seq });
      await emit('items.updated', saved.proposal, { itemIds: itemIds.length, status }, reviewer);
      return saved.proposal;
    },

    async editItem(id, edit, actorOptions = {}) {
      // `impl.revise`, not `session.revise`: this method already holds the lock.
      return impl.revise(id, { items: [edit] }, { ...actorOptions, reason: 'reviewer_edit' });
    },

    async revise(id, patch, actorOptions = {}) {
      const record0 = await enforceExpiry(await load(id));
      checkExpectation(record0, actorOptions.expect);
      const reviewer = actorOptions.reviewer ?? optionsDefaultReviewer();
      const record = await ensureReviewing(record0, reviewer);

      const result = reviseProposal(record.proposal, patch, {
        clock,
        ...(actorOptions.reason ? { reason: actorOptions.reason } : {}),
      });
      const next = transition(result.proposal, 'edit');
      const saved = await store.putProposal(next, { expectedSeq: record.seq });

      if (result.revised) {
        // Keep the pre-edit revision for the audit trail and "you approved v1" UX.
        await store.putRevision({ ...record.proposal, supersededBy: { id: saved.proposal.id, version: saved.proposal.version } });
        await emit(
          'proposal.revised',
          saved.proposal,
          {
            previousVersion: result.previousVersion,
            previousContentHash: result.previousContentHash,
            changedFields: result.changedFields,
          },
          reviewer,
        );
        logger.info('proposal revised', {
          ...logDigest(saved.proposal),
          previousVersion: result.previousVersion,
          changedFields: result.changedFields.length,
        });
      }

      return {
        proposal: saved.proposal,
        revised: result.revised,
        changedFields: result.changedFields,
        previousVersion: result.previousVersion,
        previousContentHash: result.previousContentHash,
      };
    },

    async approve(id, approveOptions = {}) {
      const record0 = await enforceExpiry(await load(id));
      checkExpectation(record0, approveOptions.expect);
      const reviewer = approveOptions.reviewer ?? optionsDefaultReviewer();
      const record = await ensureReviewing(record0, reviewer);
      const proposal = record.proposal;

      const approvable = proposal.items.filter(
        (item) => item.status !== 'invalidated' && item.status !== 'rejected',
      );
      const itemIds = approveOptions.itemIds ?? approvable.map((item) => item.id);

      if (itemIds.length === 0) {
        throw new ReviewKitError({
          code: 'E_ITEM_POLICY',
          message: `Nothing to approve in proposal ${proposal.id}`,
          hint:
            'Every item is rejected or invalidated. Reject the proposal, or refresh source data for invalidated items.',
          details: { proposalId: proposal.id, itemStatuses: proposal.items.map((item) => item.status) },
        });
      }

      const unknown = itemIds.filter((itemId) => !proposal.items.some((item) => item.id === itemId));
      if (unknown.length > 0) {
        throw new ReviewKitError({
          code: 'E_NOT_FOUND',
          message: `Cannot approve unknown item(s): ${unknown.join(', ')}`,
          hint: 'Item ids change when a revision is created — re-read proposal.items before approving.',
          details: { proposalId: proposal.id, unknown },
        });
      }

      const invalidated = itemIds.filter(
        (itemId) => proposal.items.find((item) => item.id === itemId)?.status === 'invalidated',
      );
      if (invalidated.length > 0) {
        throw new ReviewKitError({
          code: 'E_SOURCE_CHANGED',
          message: `${invalidated.length} item(s) are invalidated and cannot be approved`,
          hint: 'Refresh the source data (session.refreshSource) so the reviewer sees a current diff first.',
          details: { proposalId: proposal.id, itemIds: invalidated },
        });
      }

      if (!policy.allowPartialApproval && itemIds.length !== proposal.items.length) {
        throw new ReviewKitError({
          code: 'E_ITEM_POLICY',
          message: 'Partial approval is disabled by policy',
          hint: 'Approve all items, or enable `allowPartialApproval` on the session policy.',
          details: { proposalId: proposal.id, approved: itemIds.length, total: proposal.items.length },
        });
      }

      if (policy.requireAllItemsDecided) {
        const undecided = proposal.items.filter(
          (item) => item.status === 'pending' && !itemIds.includes(item.id),
        );
        if (undecided.length > 0) {
          throw new ReviewKitError({
            code: 'E_ITEM_POLICY',
            message: `${undecided.length} item(s) are still pending`,
            hint: 'Decide every item (approve or reject) before approving the proposal, or relax `requireAllItemsDecided`.',
            details: { proposalId: proposal.id, pendingItemIds: undecided.map((item) => item.id) },
          });
        }
      }

      enforceBulkRiskPolicy(proposal, itemIds, approveOptions.acknowledgeHighRisk);

      const approvedPayload = buildExecutionPayload(proposal, itemIds);
      const approvedContentHash = computePayloadHash(approvedPayload);
      const edited = proposal.items.some((item) => item.status === 'edited' && itemIds.includes(item.id));

      // A double-click, a React StrictMode double effect and a retried request all
      // produce the same key, and therefore the same single decision.
      const dedupeKey = `${proposal.id}:${proposal.version}:${proposal.contentHash}:${approvedContentHash}:${reviewer.id}`;
      const ledger = await store.putOnce(IDEMPOTENCY_SCOPE.approve, dedupeKey, ids('decision'));
      const decisionId = String(ledger.value);
      if (!ledger.created) {
        const existing = await store.getDecision(decisionId);
        if (existing) {
          logger.info('approve deduplicated', { ...logDigest(proposal), decisionId });
          return { proposal, decision: existing, created: false };
        }
      }

      const itemDecisions: ItemDecision[] = proposal.items
        .filter((item) => itemIds.includes(item.id))
        .map((item) => ({ itemId: item.id, status: item.status === 'edited' ? 'edited' : 'approved' }));

      const decision: ReviewDecision = {
        schemaVersion: SCHEMA_VERSION,
        id: decisionId,
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        contentHash: proposal.contentHash,
        approvedContentHash,
        kind: edited ? 'approve_with_edits' : 'approve',
        reviewer,
        decidedAt: clock.iso(),
        approvedItemIds: [...itemIds].sort(),
        itemDecisions,
        idempotencyKey: `${proposal.idempotencyKey}:v${proposal.version}:${approvedContentHash.slice(7, 23)}`,
        editedBeforeApproval: edited,
      };
      if (proposal.traceId) decision.traceId = proposal.traceId;
      if (approveOptions.note !== undefined || approveOptions.tags !== undefined) {
        decision.reason = {
          ...(approveOptions.tags ? { tags: approveOptions.tags } : {}),
          ...(approveOptions.note !== undefined ? { note: approveOptions.note } : {}),
        };
      }

      const withItems = applyItemStatuses(proposal, itemIds, 'approved');
      const approved = transition(withItems, 'approve');
      const withExecution: ActionProposal = {
        ...approved,
        execution: { status: 'not_started', decisionId: decision.id, payloadHash: approvedContentHash },
      };

      await store.putDecision(decision);
      const saved = await store.putProposal(withExecution, { expectedSeq: record.seq });
      await emit(
        'decision.approved',
        saved.proposal,
        {
          decisionId: decision.id,
          approvedItems: itemIds.length,
          totalItems: proposal.items.length,
          approvedContentHash,
          kind: decision.kind,
        },
        reviewer,
      );
      logger.info('decision approved', {
        ...logDigest(saved.proposal),
        decisionId: decision.id,
        approvedItems: itemIds.length,
      });
      return { proposal: saved.proposal, decision, created: true };
    },

    async reject(id, rejectOptions = {}) {
      const record0 = await enforceExpiry(await load(id));
      checkExpectation(record0, rejectOptions.expect);
      const reviewer = rejectOptions.reviewer ?? optionsDefaultReviewer();
      const proposal = record0.proposal;

      const decision: ReviewDecision = {
        schemaVersion: SCHEMA_VERSION,
        id: ids('decision'),
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        contentHash: proposal.contentHash,
        kind: 'reject',
        reviewer,
        decidedAt: clock.iso(),
        idempotencyKey: `${proposal.idempotencyKey}:v${proposal.version}:reject`,
      };
      if (rejectOptions.reason) decision.reason = rejectOptions.reason;
      if (proposal.traceId) decision.traceId = proposal.traceId;

      const rejectableIds = proposal.items
        .filter((item) => item.status !== 'invalidated')
        .map((item) => item.id);
      const rejected = transition(applyItemStatuses(proposal, rejectableIds, 'rejected'), 'reject');

      await store.putDecision(decision);
      const saved = await store.putProposal(rejected, { expectedSeq: record0.seq });
      await emit(
        'decision.rejected',
        saved.proposal,
        {
          decisionId: decision.id,
          tags: rejectOptions.reason?.tags ?? [],
          hasNote: Boolean(rejectOptions.reason?.note),
        },
        reviewer,
      );
      return { proposal: saved.proposal, decision, created: true };
    },

    async defer(id, deferOptions = {}) {
      const record0 = await enforceExpiry(await load(id));
      checkExpectation(record0, deferOptions.expect);
      const reviewer = deferOptions.reviewer ?? optionsDefaultReviewer();
      const record = await ensureReviewing(record0, reviewer);
      const proposal = record.proposal;

      const until =
        deferOptions.until ??
        new Date(clock.now() + (deferOptions.ttlMs ?? 60 * 60 * 1000)).toISOString();

      const decision: ReviewDecision = {
        schemaVersion: SCHEMA_VERSION,
        id: ids('decision'),
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        contentHash: proposal.contentHash,
        kind: 'defer',
        reviewer,
        decidedAt: clock.iso(),
        deferUntil: until,
        idempotencyKey: `${proposal.idempotencyKey}:v${proposal.version}:defer:${until}`,
      };
      if (deferOptions.note !== undefined) decision.reason = { note: deferOptions.note };
      if (proposal.traceId) decision.traceId = proposal.traceId;

      const deferred = transition(proposal, 'defer');
      await store.putDecision(decision);
      const saved = await store.putProposal(deferred, { expectedSeq: record.seq });
      await emit('proposal.deferred', saved.proposal, { decisionId: decision.id, until }, reviewer);
      return { proposal: saved.proposal, decision, created: true };
    },

    async requestChanges(id, changeOptions = {}) {
      const record = await enforceExpiry(await load(id));
      checkExpectation(record, changeOptions.expect);
      const reviewer = changeOptions.reviewer ?? optionsDefaultReviewer();
      const next = transition(record.proposal, 'requestChanges');
      const saved = await store.putProposal(next, { expectedSeq: record.seq });
      await emit(
        'proposal.changes_requested',
        saved.proposal,
        { tags: changeOptions.reason?.tags ?? [], hasNote: Boolean(changeOptions.reason?.note) },
        reviewer,
      );
      return saved.proposal;
    },

    async cancel(id, cancelOptions = {}) {
      const record = await load(id);
      checkExpectation(record, cancelOptions.expect);
      const next = transition(record.proposal, 'cancel');
      const saved = await store.putProposal(next, { expectedSeq: record.seq });
      await emit('proposal.cancelled', saved.proposal, { reason: cancelOptions.reason ?? null });
      return saved.proposal;
    },

    async expire(id) {
      const record = await load(id);
      const next = transition(record.proposal, 'expire');
      const saved = await store.putProposal(next, { expectedSeq: record.seq });
      await emit('proposal.expired', saved.proposal, { expiresAt: saved.proposal.expiresAt ?? null });
      return saved.proposal;
    },

    async sweepExpired() {
      const nowIso = new Date(clock.now()).toISOString();
      const page = await store.listProposals({
        expiresBefore: nowIso,
        status: ['pending_review', 'reviewing', 'changes_requested', 'approved', 'invalidated'],
      });
      const expired: string[] = [];
      for (const record of page.items) {
        try {
          // The locked wrapper, deliberately: sweeping holds no lock of its own,
          // so each expire serializes against concurrent reviewer actions.
          await session.expire(record.proposal.id);
          expired.push(record.proposal.id);
        } catch (error) {
          logger.warn('could not expire proposal', {
            proposalId: record.proposal.id,
            error: String(error),
          });
        }
      }
      return expired;
    },

    async createRevision(id, patch = {}, revisionOptions = {}) {
      const record = await load(id);
      checkExpectation(record, revisionOptions.expect);
      const base = record.proposal;

      const result = reviseProposal(base, patch, {
        clock,
        reason: revisionOptions.reason ?? 'new_revision',
      });
      // A revision always advances the version, even when the payload is identical:
      // the point is that the previous decision no longer applies.
      const revised: ActionProposal = result.revised
        ? result.proposal
        : {
            ...result.proposal,
            version: base.version + 1,
            revisionOf: { version: base.version, reason: revisionOptions.reason ?? 'new_revision' },
          };
      const reset: ActionProposal = {
        ...revised,
        status: assertTransition(base.status, 'createRevision', { proposalId: base.id }),
        items: revised.items.map((item) =>
          item.status === 'invalidated' ? item : { ...item, status: 'pending' },
        ),
        updatedAt: clock.iso(),
      };
      delete reset.execution;

      await store.putRevision({ ...base, supersededBy: { id: base.id, version: reset.version } });
      const saved = await store.putProposal(reset, { expectedSeq: record.seq });
      await emit('proposal.submitted', saved.proposal, {
        revisionOf: base.version,
        itemCount: saved.proposal.items.length,
      });
      return saved.proposal;
    },

    async checkSource(id, snapshots, checkOptions = {}) {
      const record = await load(id);
      const drift = checkSourceVersions(record.proposal, snapshots, checkOptions.currentTargetVersion);
      const hasDrift = drift.changedItemIds.length > 0 || drift.targetDrift !== undefined;
      if (!hasDrift || checkOptions.invalidate === false) {
        return { proposal: record.proposal, drift, invalidated: false };
      }

      const marked = markItemsInvalidated(record.proposal, drift);
      const next = canDo(marked, 'invalidate') ? transition(marked, 'invalidate') : { ...marked, updatedAt: clock.iso() };
      const saved = await store.putProposal(next, { expectedSeq: record.seq });
      await emit('proposal.invalidated', saved.proposal, {
        changedItems: drift.changedItemIds.length,
        targetDrift: drift.targetDrift ? 1 : 0,
      });
      logger.warn('proposal invalidated: source data changed', {
        ...logDigest(saved.proposal),
        changedItems: drift.changedItemIds.length,
      });
      return { proposal: saved.proposal, drift, invalidated: true };
    },

    async refreshSource(id, snapshots, refreshOptions = {}) {
      const record = await load(id);
      checkExpectation(record, refreshOptions.expect);
      const base = record.proposal;

      const result = refreshSourceRevision(base, snapshots, {
        clock,
        reason: refreshOptions.reason ?? 'source_refreshed',
        ...(refreshOptions.currentTargetVersion !== undefined
          ? { currentTargetVersion: refreshOptions.currentTargetVersion }
          : {}),
        ...(refreshOptions.dropMissingItems !== undefined
          ? { dropMissingItems: refreshOptions.dropMissingItems }
          : {}),
      });

      const next: ActionProposal = {
        ...result.proposal,
        status: canDo(base, 'refreshSource')
          ? assertTransition(base.status, 'refreshSource', { proposalId: base.id })
          : base.status,
        updatedAt: clock.iso(),
      };
      delete next.execution;

      if (result.revised) {
        await store.putRevision({ ...base, supersededBy: { id: base.id, version: next.version } });
      }
      const saved = await store.putProposal(next, { expectedSeq: record.seq });
      await emit('proposal.revised', saved.proposal, {
        previousVersion: result.previousVersion,
        previousContentHash: result.previousContentHash,
        changedFields: result.changedFields,
        reason: 'source_refreshed',
      });
      return saved.proposal;
    },

    async requestExecution(decisionId) {
      const decision = await store.getDecision(decisionId);
      if (!decision) {
        throw new ReviewKitError({
          code: 'E_NOT_FOUND',
          message: `No decision with id "${decisionId}"`,
          hint: 'Pass the id returned by session.approve().',
          details: { decisionId },
        });
      }
      const record = await load(decision.proposalId);
      // Move a lapsed proposal to `expired` first, so the stored status matches
      // what we are about to refuse (PRD 20: expired approvals cannot execute).
      await enforceExpiry(record);
      const proposal = record.proposal;

      // Fail closed on state, version, hash, expiry and invalidated items.
      assertExecutable(proposal, decision, { now: clock.now() });

      const { payload, payloadHash } = buildApprovedPayload(proposal, decision);

      // One decision ⇒ at most one execution request, forever (PRD 20).
      const ledger = await store.putOnce(IDEMPOTENCY_SCOPE.execution, decision.idempotencyKey, ids('request'));
      const requestId = String(ledger.value);
      if (!ledger.created) {
        const existing = await store.getExecutionRequest(requestId);
        if (existing) {
          if (existing.payloadHash !== payloadHash) {
            throw new ReviewKitError({
              code: 'E_DUPLICATE_EXECUTION',
              message: `Decision ${decision.id} already has execution request ${existing.id} for a different payload`,
              hint: 'Do not execute. The proposal changed after the first request; approve the current version instead.',
              details: {
                decisionId: decision.id,
                requestId: existing.id,
                firstHash: existing.payloadHash,
                currentHash: payloadHash,
              },
            });
          }
          logger.info('execution request deduplicated', {
            ...logDigest(proposal),
            requestId: existing.id,
            decisionId: decision.id,
          });
          return existing;
        }
      }

      const request: ExecutionRequest = {
        schemaVersion: SCHEMA_VERSION,
        id: requestId,
        proposalId: proposal.id,
        proposalVersion: proposal.version,
        decisionId: decision.id,
        contentHash: proposal.contentHash,
        payload,
        payloadHash,
        idempotencyKey: decision.idempotencyKey,
        createdAt: clock.iso(),
      };
      if (proposal.traceId) request.traceId = proposal.traceId;

      await store.putExecutionRequest(request);
      const queued: ActionProposal = {
        ...proposal,
        execution: {
          status: 'queued',
          requestId: request.id,
          decisionId: decision.id,
          payloadHash,
        },
        updatedAt: clock.iso(),
      };
      const saved = await store.putProposal(transition(queued, 'requestExecution'), { expectedSeq: record.seq });
      await emit('execution.requested', saved.proposal, {
        requestId: request.id,
        decisionId: decision.id,
        items: payload.items.length,
        payloadHash,
      });
      return request;
    },

    async markExecutionStarted(requestId) {
      const request = await store.getExecutionRequest(requestId);
      if (!request) {
        throw new ReviewKitError({
          code: 'E_NOT_FOUND',
          message: `No execution request with id "${requestId}"`,
          hint: 'Call session.requestExecution(decisionId) first.',
          details: { requestId },
        });
      }
      const record = await load(request.proposalId);
      const proposal = record.proposal;
      const current = proposal.execution?.status ?? 'not_started';
      if (current === 'running') return proposal;
      assertExecutionTransition(current, 'running', proposal.id);

      const next: ActionProposal = {
        ...proposal,
        execution: {
          ...(proposal.execution ?? { status: 'queued' }),
          status: 'running',
          requestId: request.id,
          decisionId: request.decisionId,
          payloadHash: request.payloadHash,
          startedAt: clock.iso(),
        },
        updatedAt: clock.iso(),
      };
      const saved = await store.putProposal(next, { expectedSeq: record.seq });
      await emit('execution.started', saved.proposal, {
        requestId: request.id,
        idempotencyKey: request.idempotencyKey,
        payloadHash: request.payloadHash,
      });
      return saved.proposal;
    },

    async recordReceipt(receipt) {
      assertValidReceipt(receipt);
      const record = await load(receipt.proposalId);
      const proposal = record.proposal;

      const decision = await store.getDecision(receipt.decisionId);
      if (!decision) {
        throw new ReviewKitError({
          code: 'E_NOT_FOUND',
          message: `Receipt ${receipt.id} references unknown decision ${receipt.decisionId}`,
          hint: 'Receipts must echo the decisionId from the execution request.',
          details: { receiptId: receipt.id, decisionId: receipt.decisionId },
        });
      }

      // Replaying the same receipt id (webhook retry) must not double-apply.
      const existingReceipt = await store.getReceipt(receipt.id);
      if (existingReceipt) {
        logger.info('receipt deduplicated', { ...logDigest(proposal), receiptId: receipt.id });
        return { proposal, receipt: existingReceipt, created: false };
      }

      const request = receipt.requestId ? await store.getExecutionRequest(receipt.requestId) : undefined;
      verifyDecisionBinding(proposal, decision);

      try {
        verifyReceipt(receipt, request ? { decision, request } : { decision });
      } catch (error) {
        // Fail closed *and* leave a visible trace: the UI must never show a
        // mismatched execution as an approved success (PRD 20).
        const flagged: ActionProposal = {
          ...proposal,
          execution: {
            ...(proposal.execution ?? { status: 'not_started' }),
            status: 'failed',
            hashMismatch: true,
            finishedAt: clock.iso(),
            receiptIds: [...(proposal.execution?.receiptIds ?? []), receipt.id],
          },
          updatedAt: clock.iso(),
        };
        await store.putReceipt(receipt);
        const saved = await store.putProposal(flagged, { expectedSeq: record.seq });
        await emit('execution.rejected', saved.proposal, {
          receiptId: receipt.id,
          reportedHash: receipt.executedParamsHash,
          expectedHash: request?.payloadHash ?? decision.approvedContentHash ?? null,
        });
        logger.error('receipt rejected: executed parameters did not match the approval', {
          ...logDigest(saved.proposal),
          receiptId: receipt.id,
        });
        throw error;
      }

      const status = receipt.status ?? deriveExecutionStatus(receipt.results ?? []);
      assertExecutionTransition(proposal.execution?.status ?? 'not_started', status, proposal.id);
      const next: ActionProposal = {
        ...proposal,
        execution: {
          ...(proposal.execution ?? { status: 'not_started' }),
          status,
          ...(receipt.requestId ?? proposal.execution?.requestId
            ? { requestId: receipt.requestId ?? proposal.execution?.requestId }
            : {}),
          decisionId: receipt.decisionId,
          payloadHash: receipt.executedParamsHash,
          finishedAt: receipt.finishedAt ?? clock.iso(),
          receiptIds: [...(proposal.execution?.receiptIds ?? []), receipt.id],
          hashMismatch: false,
        },
        updatedAt: clock.iso(),
      };

      await store.putReceipt(receipt);
      const saved = await store.putProposal(next, { expectedSeq: record.seq });
      await emit('execution.completed', saved.proposal, {
        receiptId: receipt.id,
        status,
        succeeded: (receipt.results ?? []).filter((r) => r.status === 'succeeded').length,
        failed: (receipt.results ?? []).filter((r) => r.status === 'failed').length,
        evidence: (receipt.evidence ?? []).length,
      });
      logger.info('execution recorded', { ...logDigest(saved.proposal), receiptId: receipt.id, status });
      return { proposal: saved.proposal, receipt, created: true };
    },

    async audit(id) {
      const record = await load(id);
      const [revisions, decisions, receipts, events] = await Promise.all([
        store.listRevisions(id),
        store.listDecisions(id),
        store.listReceipts(id),
        store.listEvents(id),
      ]);
      return { proposal: record.proposal, revisions, decisions, receipts, events };
    },

    on(name, listener) {
      return emitter.on(name, listener);
    },
  };

  /* ---------------- public API ---------------- */

  /**
   * Every state-changing entry point runs under the proposal's write lock, so a
   * double-clicked button inside one session cannot produce two decisions or two
   * execution requests. Cross-process safety is a different problem, solved by
   * `expectedSeq` compare-and-set in the store.
   *
   * Reads, `submit` (which locks internally, once it knows the id) and
   * `sweepExpired` (which calls the locked `expire` per proposal) stay unwrapped.
   */
  const session: ReviewSession = {
    ...impl,

    startReview: (id, actorOptions) => locked(id, () => impl.startReview(id, actorOptions)),
    setItemStatus: (id, itemIds, status, actorOptions) =>
      locked(id, () => impl.setItemStatus(id, itemIds, status, actorOptions)),
    editItem: (id, edit, actorOptions) => locked(id, () => impl.editItem(id, edit, actorOptions)),
    revise: (id, patch, actorOptions) => locked(id, () => impl.revise(id, patch, actorOptions)),
    approve: (id, approveOptions) => locked(id, () => impl.approve(id, approveOptions)),
    reject: (id, rejectOptions) => locked(id, () => impl.reject(id, rejectOptions)),
    defer: (id, deferOptions) => locked(id, () => impl.defer(id, deferOptions)),
    requestChanges: (id, changeOptions) => locked(id, () => impl.requestChanges(id, changeOptions)),
    cancel: (id, cancelOptions) => locked(id, () => impl.cancel(id, cancelOptions)),
    expire: (id) => locked(id, () => impl.expire(id)),
    createRevision: (id, patch, revisionOptions) => locked(id, () => impl.createRevision(id, patch, revisionOptions)),
    checkSource: (id, snapshots, checkOptions) => locked(id, () => impl.checkSource(id, snapshots, checkOptions)),
    refreshSource: (id, snapshots, refreshOptions) =>
      locked(id, () => impl.refreshSource(id, snapshots, refreshOptions)),

    // Keyed by decision / request / receipt: resolve the proposal id first so the
    // lock is the same one the reviewer-facing calls take.
    requestExecution: async (decisionId) => {
      const decision = await store.getDecision(decisionId);
      return locked(decision?.proposalId ?? `decision:${decisionId}`, () => impl.requestExecution(decisionId));
    },
    markExecutionStarted: async (requestId) => {
      const request = await store.getExecutionRequest(requestId);
      return locked(request?.proposalId ?? `request:${requestId}`, () => impl.markExecutionStarted(requestId));
    },
    // `?? ''` only matters for a malformed receipt: impl.recordReceipt validates
    // it and throws, and an unshared lock key keeps that path from serializing.
    recordReceipt: (receipt) => locked(receipt?.proposalId ?? '', () => impl.recordReceipt(receipt)),
  };

  return session;
}
