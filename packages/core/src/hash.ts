/**
 * Content hashing — the mechanism that keeps "what was approved" equal to
 * "what gets executed" (PRD 3.3, 12.3, 20).
 *
 * ## What is hashed
 *
 * Only **execution-relevant** fields. Editing a summary, a reason or an evidence
 * label does not invalidate an approval; editing anything that changes the call
 * the host will make does:
 *
 *   schemaVersion, type, target{system,resource,environment,sourceVersion},
 *   idempotencyKey, and for every item: id, operation, after, source{ref,version}
 *
 * Item `before` is deliberately excluded from the *execution* payload: it is
 * review context, and source drift is caught by `source.version` plus
 * `checkSourceVersions()` instead. `status`, `risk`, `summary` and `meta` are
 * review metadata and are excluded too.
 *
 * ## Stability contract
 *
 * The payload shape above is part of the public schema. Any change to it is a
 * breaking change and gets a new `schemaVersion` plus a migration note
 * (see `docs/migration.md`).
 */
import { canonicalize } from './canonical.js';
import { ReviewKitError } from './errors.js';
import { sha256Hex } from './sha256.js';
import {
  SCHEMA_VERSION,
  type ActionItem,
  type ActionProposal,
  type ContentHash,
  type ExecutionPayload,
  type ExecutionPayloadItem,
  type JsonValue,
} from './types.js';

const HASH_PREFIX = 'sha256:';
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** `sha256:<hex>` digest of arbitrary canonicalizable data. */
export function digest(value: unknown): ContentHash {
  return HASH_PREFIX + sha256Hex(canonicalize(value));
}

export function isContentHash(value: unknown): value is ContentHash {
  return typeof value === 'string' && HASH_RE.test(value);
}

/** Constant-time-ish equality. Hashes are public, so this is about correctness, not secrecy. */
export function hashEquals(a: string | undefined, b: string | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && a === b;
}

function payloadItem(item: ActionItem): ExecutionPayloadItem {
  const out: ExecutionPayloadItem = { id: item.id, operation: item.operation };
  if (item.after !== undefined) out.after = item.after as JsonValue;
  if (item.source) {
    out.source = item.source.version === undefined
      ? { ref: item.source.ref }
      : { ref: item.source.ref, version: item.source.version };
  }
  return out;
}

/** Items in canonical order: sorted by id, so selection order cannot change a hash. */
function sortItems(items: ExecutionPayloadItem[]): ExecutionPayloadItem[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The exact payload a host should execute.
 *
 * @param itemIds when given, only these items are included (partial approval).
 */
export function buildExecutionPayload(
  proposal: ActionProposal,
  itemIds?: readonly string[],
): ExecutionPayload {
  const allow = itemIds ? new Set(itemIds) : null;
  const selected = proposal.items.filter((item) => (allow ? allow.has(item.id) : true));

  if (allow) {
    const missing = [...allow].filter((id) => !proposal.items.some((item) => item.id === id));
    if (missing.length > 0) {
      throw new ReviewKitError({
        code: 'E_NOT_FOUND',
        message: `Proposal ${proposal.id} has no item(s): ${missing.join(', ')}`,
        hint: 'Item ids must come from proposal.items; they change when a revision is created.',
        details: { proposalId: proposal.id, missing },
      });
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    type: proposal.type,
    target: proposal.target,
    idempotencyKey: proposal.idempotencyKey,
    items: sortItems(selected.map(payloadItem)),
  };
}

/** Hash of an execution payload. This is what a receipt must echo back. */
export function computePayloadHash(payload: ExecutionPayload): ContentHash {
  return digest(payload);
}

/**
 * Hash of the full proposal content (all items). Stored on `proposal.contentHash`
 * and bound into every decision.
 */
export function computeContentHash(proposal: ActionProposal): ContentHash {
  return computePayloadHash(buildExecutionPayload(proposal));
}

/** Hash of the approved subset — what `assertExecutable` and receipts compare. */
export function computeApprovedHash(
  proposal: ActionProposal,
  itemIds: readonly string[],
): ContentHash {
  return computePayloadHash(buildExecutionPayload(proposal, itemIds));
}

/**
 * Recompute and verify a hash the caller believes to be current.
 * Used on every state transition that could race with an edit.
 */
export function assertContentHash(proposal: ActionProposal, expected: ContentHash | undefined): void {
  if (expected === undefined) return;
  const actual = computeContentHash(proposal);
  if (actual !== expected) {
    throw new ReviewKitError({
      code: 'E_HASH_MISMATCH',
      message: `Content hash mismatch for proposal ${proposal.id} v${proposal.version}`,
      hint:
        'The proposal content changed since you read it. Reload the proposal, show the reviewer the new diff, and confirm again.',
      details: { proposalId: proposal.id, version: proposal.version, expected, actual },
    });
  }
}
