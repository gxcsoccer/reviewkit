/**
 * Storage interface (PRD 9.1: "browser local state storage interface, replaceable
 * with a host implementation").
 *
 * Two ways to plug in:
 *
 *  - implement {@link KeyValueAdapter} (4 methods) and pass it to
 *    `createKeyValueStore()` — enough for localStorage, Redis, a KV table;
 *  - implement {@link ReviewStore} directly when your database can do
 *    compare-and-set and filtering better than the generic layer.
 *
 * Everything is async so a host store can hit the network. Nothing here talks to
 * a ReviewKit service: there isn't one (PRD 12.1).
 */
import type {
  ActionProposal,
  ExecutionReceipt,
  ExecutionRequest,
  JsonValue,
  ProposalStatus,
  ReviewDecision,
  ReviewEvent,
  RiskLevel,
} from '../types.js';

/** A proposal plus its optimistic-lock token. */
export interface StoredProposal {
  proposal: ActionProposal;
  /** Monotonic per-proposal write counter. Pass it back to detect races. */
  seq: number;
}

export interface ProposalQuery {
  status?: ProposalStatus[];
  riskLevel?: RiskLevel[];
  type?: string[];
  subjectType?: string[];
  /** Case-insensitive substring match over id, summary, type and subject label. */
  search?: string;
  /** Only proposals whose `expiresAt` is at or before this ISO timestamp. */
  expiresBefore?: string;
  limit?: number;
  offset?: number;
  /** Default `-risk`: highest risk first, then oldest (PRD 10.1). */
  sort?: 'createdAt' | '-createdAt' | 'risk' | '-risk' | 'expiresAt';
}

export interface ProposalPage {
  items: StoredProposal[];
  /** Total matches before `limit`/`offset`. */
  total: number;
}

export interface PutProposalOptions {
  /**
   * Expected current `seq`. `null` means "must not exist yet".
   * A mismatch throws E_VERSION_CONFLICT (PRD 8: optimistic locking).
   */
  expectedSeq?: number | null;
}

export interface ReviewStore {
  getProposal(id: string): Promise<StoredProposal | null>;
  putProposal(proposal: ActionProposal, options?: PutProposalOptions): Promise<StoredProposal>;
  listProposals(query?: ProposalQuery): Promise<ProposalPage>;
  deleteProposal(id: string): Promise<void>;

  /** Archive of superseded revisions, for audit and "jump to latest version". */
  putRevision(proposal: ActionProposal): Promise<void>;
  listRevisions(proposalId: string): Promise<ActionProposal[]>;

  putDecision(decision: ReviewDecision): Promise<ReviewDecision>;
  getDecision(id: string): Promise<ReviewDecision | null>;
  listDecisions(proposalId: string): Promise<ReviewDecision[]>;

  putExecutionRequest(request: ExecutionRequest): Promise<ExecutionRequest>;
  getExecutionRequest(id: string): Promise<ExecutionRequest | null>;
  findExecutionRequest(idempotencyKey: string): Promise<ExecutionRequest | null>;

  putReceipt(receipt: ExecutionReceipt): Promise<ExecutionReceipt>;
  getReceipt(id: string): Promise<ExecutionReceipt | null>;
  listReceipts(proposalId: string): Promise<ExecutionReceipt[]>;

  appendEvent(event: ReviewEvent): Promise<void>;
  listEvents(proposalId: string): Promise<ReviewEvent[]>;

  /**
   * Idempotency ledger. `putOnce` must be atomic per (scope, key):
   * the first caller gets `created: true`, later callers get the stored value.
   */
  putOnce(scope: string, key: string, value: JsonValue): Promise<{ created: boolean; value: JsonValue }>;
  getOnce(scope: string, key: string): Promise<JsonValue | null>;

  /** Optional: wipe everything. Used by tests and the Playground reset button. */
  clear?(): Promise<void>;
}

/** Minimal backing store. Sync or async — both are awaited. */
export interface KeyValueAdapter {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  /** All keys starting with `prefix`. */
  keys(prefix: string): Promise<string[]> | string[];
}
