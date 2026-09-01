/**
 * ReviewKit core domain types.
 *
 * Three objects carry the whole protocol:
 *
 *  - {@link ActionProposal}   what an agent wants to change (submitted by the host)
 *  - {@link ReviewDecision}   what a human decided about one exact proposal version
 *  - {@link ExecutionReceipt} what the host actually executed, reported back
 *
 * Nothing in this file depends on a browser, a framework or a model provider.
 */

export const SCHEMA_VERSION = '0.1' as const;
export type SchemaVersion = typeof SCHEMA_VERSION;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** `sha256:<64 lowercase hex chars>` */
export type ContentHash = string;

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Ordered weakest → strongest. Used for bulk-approval policy comparisons. */
export const RISK_ORDER: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'];

/** PRD 8.1 */
export type ProposalStatus =
  | 'draft'
  | 'pending_review'
  | 'reviewing'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled'
  | 'superseded'
  | 'invalidated';

/** PRD 8.2 */
export type ItemStatus = 'pending' | 'approved' | 'edited' | 'rejected' | 'invalidated';

/** PRD 8.3 */
export type ExecutionStatus =
  | 'not_started'
  | 'queued'
  | 'running'
  | 'partially_succeeded'
  | 'succeeded'
  | 'failed'
  | 'rolled_back';

/** PRD 6.2 */
export type DecisionKind = 'approve' | 'approve_with_edits' | 'reject' | 'defer' | 'cancel';

/** What kind of change a single item describes. Hosts may use their own strings. */
export type ItemOperation = 'create' | 'update' | 'delete' | 'send' | 'invoke' | (string & {});

/** Renderer hint. Custom renderers register their own kinds without forking core. */
export type ItemKind = 'json' | 'text' | 'table' | (string & {});

/**
 * Who did something. Authentication is the host's job (PRD 12.7): ReviewKit only
 * records an already-authenticated identity.
 */
export interface Identity {
  id: string;
  /** Display name. Rendered as untrusted text. */
  name?: string;
  kind?: 'user' | 'agent' | 'service' | 'system';
  email?: string;
  /** Free-form host attributes (team, locale, ...). Never used for authorization. */
  attributes?: Record<string, string>;
}

/** Where the change came from, so a reviewer can judge it (PRD 6.1). */
export interface Evidence {
  /** Short label, rendered as untrusted text. */
  label: string;
  /** Opaque reference into a host system (event batch id, document id, ...). */
  ref?: string;
  /** Optional http(s)/mailto link. Other schemes are dropped at render time. */
  url?: string;
  /** Optional short excerpt. Rendered as text, never as HTML. */
  snippet?: string;
  kind?: 'record' | 'event' | 'document' | 'metric' | 'link' | (string & {});
}

export interface RiskAssessment {
  level: RiskLevel;
  /** e.g. `bulk_write`, `pii`, `irreversible`, `money_movement` */
  tags?: string[];
  /** Why the level was chosen. Rendered as untrusted text. */
  note?: string;
}

/** The system that will be changed, and which snapshot the diff was built from. */
export interface ActionTarget {
  /** Logical system id, e.g. `crm`, `mailer`, `billing`. */
  system: string;
  /** Optional resource/collection, e.g. `contacts`. */
  resource?: string;
  /** e.g. `production`, `sandbox`. Shown prominently in the UI. */
  environment?: string;
  /**
   * Host's version of the source data the proposal was built from (PRD 12.10).
   * When the live value differs, the proposal is invalidated instead of executed.
   */
  sourceVersion?: string;
}

/** Per-item source version, for batches where each record has its own etag. */
export interface ItemSource {
  /** Stable reference to the source object, e.g. `crm:contact:c_1`. */
  ref: string;
  /** etag / updatedAt / row version. Compared before execution. */
  version?: string;
  fetchedAt?: string;
}

/**
 * One reviewable unit inside a proposal: one record, one message, one config key.
 *
 * `before`/`after` are the *execution payload*, not a pretty summary. Editing
 * `after`, `operation`, or `source` changes the content hash (PRD 10.3).
 */
export interface ActionItem {
  id: string;
  /** Renderer hint: `json` | `text` | `table` | custom. */
  kind: ItemKind;
  operation: ItemOperation;
  status: ItemStatus;
  /** One-line human summary. Not a substitute for the payload (PRD 10.2). */
  summary?: string;
  /** Current state in the host system. Absent for `create`. */
  before?: JsonValue;
  /** Proposed state. Absent for `delete`. */
  after?: JsonValue;
  risk?: RiskAssessment;
  source?: ItemSource;
  /** Host/agent metadata, e.g. confidence or rule id. Not execution input. */
  meta?: JsonObject;
  /** Set when a reviewer edited this item; points at the pre-edit payload. */
  editedFrom?: { version: number; after?: JsonValue };
  /** Set when the item was invalidated: why, and by which source version. */
  invalidation?: { reason: string; expectedVersion?: string; actualVersion?: string };
}

/** Progress of the host's execution attempt for one proposal (PRD 8.3). */
export interface ExecutionState {
  status: ExecutionStatus;
  requestId?: string;
  decisionId?: string;
  /** Hash of the payload ReviewKit handed to the host. */
  payloadHash?: ContentHash;
  startedAt?: string;
  finishedAt?: string;
  receiptIds?: string[];
  /** True when a receipt did not match the approved hash (fail-closed marker). */
  hashMismatch?: boolean;
}

/** Field masking policy (PRD 12.4, 20). Applied when rendering and when logging. */
export interface RedactionPolicy {
  /**
   * Dot paths inside item `before`/`after`, `*` matches one segment,
   * `**` matches any depth. Examples: `ssn`, `contact.email`, `*.token`, `**.password`.
   */
  maskPaths?: string[];
  /** Replacement text shown instead of the value. */
  mask?: string;
  /** Reveal on explicit user action in the UI. Default false. */
  revealable?: boolean;
}

export interface ActionProposal {
  schemaVersion: SchemaVersion;
  id: string;
  /** Content revision. Bumped whenever an execution-relevant field changes. */
  version: number;
  status: ProposalStatus;
  /** Namespaced action type, e.g. `crm.contact.update`. */
  type: string;
  subject: { type: string; count: number; label?: string };
  /** Human-readable summary. Never the only thing shown (PRD 10.2). */
  summary: string;
  /** The agent's stated reason. Untrusted text. */
  reason?: string;
  evidence?: Evidence[];
  risk: RiskAssessment;
  items: ActionItem[];
  target: ActionTarget;
  origin: {
    initiatedBy: Identity;
    agent?: string;
    agentRunId?: string;
    tool?: string;
  };
  /** Correlates agent run → review → execution (PRD 13 observability). */
  traceId?: string;
  createdAt: string;
  updatedAt?: string;
  expiresAt?: string;
  /** Stable across revisions; scopes execution idempotency. */
  idempotencyKey: string;
  /** SHA-256 over the canonical execution payload. See `computeContentHash`. */
  contentHash: ContentHash;
  /** Set on historical revisions that a newer version replaced. */
  supersededBy?: { id: string; version: number };
  /** Set when the proposal is a revision of an earlier one. */
  revisionOf?: { version: number; reason?: string };
  execution?: ExecutionState;
  redaction?: RedactionPolicy;
  labels?: Record<string, string>;
}

/** Per-item outcome recorded on a decision. */
export interface ItemDecision {
  itemId: string;
  status: Extract<ItemStatus, 'approved' | 'rejected' | 'edited'>;
  note?: string;
}

export interface ReviewDecision {
  schemaVersion: SchemaVersion;
  id: string;
  proposalId: string;
  /** The exact revision this decision is bound to (PRD 12.3). */
  proposalVersion: number;
  /** Hash of the whole proposal content at decision time. */
  contentHash: ContentHash;
  /**
   * Hash of the payload that may be executed — the approved subset only.
   * Absent for reject/defer/cancel. This is what a receipt must match.
   */
  approvedContentHash?: ContentHash;
  kind: DecisionKind;
  reviewer: Identity;
  decidedAt: string;
  /** Items the reviewer approved, in canonical order. */
  approvedItemIds?: string[];
  itemDecisions?: ItemDecision[];
  reason?: { tags?: string[]; note?: string };
  /** For `defer`. */
  deferUntil?: string;
  traceId?: string;
  /** Deduplicates execution requests derived from this decision. */
  idempotencyKey: string;
  /** True when at least one item was edited before approval (PRD 10.3). */
  editedBeforeApproval?: boolean;
}

/** What the host should execute. Produced only from an approved decision. */
export interface ExecutionPayloadItem {
  id: string;
  operation: ItemOperation;
  after?: JsonValue;
  source?: ItemSource;
}

export interface ExecutionPayload {
  schemaVersion: SchemaVersion;
  type: string;
  target: ActionTarget;
  idempotencyKey: string;
  items: ExecutionPayloadItem[];
}

export interface ExecutionRequest {
  schemaVersion: SchemaVersion;
  id: string;
  proposalId: string;
  proposalVersion: number;
  decisionId: string;
  contentHash: ContentHash;
  payload: ExecutionPayload;
  /** Must equal the receipt's `executedParamsHash` or the result is rejected. */
  payloadHash: ContentHash;
  idempotencyKey: string;
  createdAt: string;
  traceId?: string;
}

export interface ExternalRef {
  system: string;
  id: string;
  /** Optional http(s) link. Sanitized before rendering. */
  url?: string;
  label?: string;
}

export interface ItemExecutionResult {
  itemId: string;
  status: 'succeeded' | 'failed' | 'skipped' | 'rolled_back';
  externalRef?: ExternalRef;
  error?: { code: string; message: string; retryable?: boolean };
  finishedAt?: string;
}

export interface ExecutionReceipt {
  schemaVersion: SchemaVersion;
  id: string;
  proposalId: string;
  proposalVersion: number;
  decisionId: string;
  requestId?: string;
  idempotencyKey: string;
  /** Hash of the parameters the host really sent (PRD 6.3, 12.3). */
  executedParamsHash: ContentHash;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt?: string;
  results?: ItemExecutionResult[];
  error?: { code: string; message: string; retryable?: boolean };
  rollback?: { status: 'succeeded' | 'failed' | 'partial'; note?: string; at?: string };
  evidence?: Evidence[];
  traceId?: string;
}

/* ------------------------------------------------------------------ *
 * Inputs (what hosts hand to ReviewKit before normalization)
 * ------------------------------------------------------------------ */

export interface ActionItemInput {
  id?: string;
  kind?: ItemKind;
  operation?: ItemOperation;
  status?: ItemStatus;
  summary?: string;
  before?: JsonValue;
  after?: JsonValue;
  risk?: RiskAssessment;
  source?: ItemSource;
  meta?: JsonObject;
}

/**
 * Loose proposal input. Accepts either explicit `items`, or the top-level
 * `before`/`after` shape from the PRD example (§11.1), which is also what the
 * Playground pastes.
 */
export interface ProposalInput {
  id?: string;
  version?: number;
  status?: Extract<ProposalStatus, 'draft' | 'pending_review'>;
  type: string;
  subject?: { type: string; count?: number; label?: string };
  summary?: string;
  reason?: string;
  evidence?: Evidence[];
  risk?: RiskAssessment | RiskLevel;
  items?: ActionItemInput[];
  /** Convenience shape: one object per record, or a single object/string. */
  before?: JsonValue;
  after?: JsonValue;
  /** Key used to pair `before`/`after` records. Default `id`. */
  keyField?: string;
  target?: Partial<ActionTarget> & { system?: string };
  origin?: { initiatedBy?: Identity; agent?: string; agentRunId?: string; tool?: string };
  traceId?: string;
  createdAt?: string;
  expiresAt?: string;
  /** Milliseconds from now; ignored when `expiresAt` is given. */
  ttlMs?: number;
  idempotencyKey?: string;
  contentHash?: ContentHash;
  redaction?: RedactionPolicy;
  labels?: Record<string, string>;
}

/* ------------------------------------------------------------------ *
 * Events (PRD 11.3)
 * ------------------------------------------------------------------ */

export type ReviewEventName =
  | 'proposal.submitted'
  | 'review.started'
  | 'proposal.revised'
  | 'proposal.deferred'
  | 'proposal.changes_requested'
  | 'proposal.invalidated'
  | 'proposal.expired'
  | 'proposal.cancelled'
  | 'items.updated'
  | 'decision.approved'
  | 'decision.rejected'
  | 'execution.requested'
  | 'execution.started'
  | 'execution.completed'
  | 'execution.rejected';

/**
 * Events carry ids, versions, hashes and counts — never full payloads
 * (PRD 12.4 / 20: logs must not print whole proposals).
 */
export interface ReviewEvent<TData extends JsonObject = JsonObject> {
  id: string;
  name: ReviewEventName;
  at: string;
  proposalId: string;
  proposalVersion: number;
  contentHash?: ContentHash;
  traceId?: string;
  actor?: Pick<Identity, 'id' | 'kind'>;
  data: TData;
}

export type EventListener = (event: ReviewEvent) => void | Promise<void>;
