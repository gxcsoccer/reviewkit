/**
 * Revisions, source-drift detection and invalidation.
 *
 * The rule this file enforces (PRD 10.3, 20): **any** change to an
 * execution-relevant field produces a new proposal version with a new content
 * hash, which makes every earlier approval unusable. Cosmetic changes (summary,
 * reason, risk note) do not bump the version.
 */
import type { Clock } from './clock.js';
import { canonicalEquals } from './canonical.js';
import { ReviewKitError } from './errors.js';
import { computeContentHash } from './hash.js';
import {
  type ActionItem,
  type ActionProposal,
  type ActionTarget,
  type ItemSource,
  type ItemOperation,
  type JsonValue,
  type RiskAssessment,
} from './types.js';

export interface ItemEdit {
  itemId: string;
  /** New execution payload for the item. `null` is a value; omit to leave unchanged. */
  after?: JsonValue;
  operation?: ItemOperation;
  source?: ItemSource;
  /** Reviewer note recorded against the edit. */
  note?: string;
}

export interface ProposalPatch {
  items?: ItemEdit[];
  target?: Partial<ActionTarget>;
  idempotencyKey?: string;
  /** Cosmetic: does not change the content hash. */
  summary?: string;
  /** Cosmetic: does not change the content hash. */
  reason?: string;
  /** Cosmetic: does not change the content hash. */
  risk?: RiskAssessment;
}

export interface ReviseResult {
  proposal: ActionProposal;
  /** True when the content hash changed, i.e. a new version was created. */
  revised: boolean;
  /** `items.<id>.after`, `target.system`, ... — the execution fields that moved. */
  changedFields: string[];
  previousVersion: number;
  previousContentHash: string;
}

export interface ReviseOptions {
  clock: Clock;
  /** Recorded on the new revision, e.g. "reviewer edited priority". */
  reason?: string;
}

function cloneItem(item: ActionItem): ActionItem {
  return { ...item };
}

/**
 * Apply a patch and, if execution-relevant content moved, return a new revision.
 * The input proposal is never mutated.
 */
export function reviseProposal(
  proposal: ActionProposal,
  patch: ProposalPatch,
  options: ReviseOptions,
): ReviseResult {
  const changedFields: string[] = [];
  const items = proposal.items.map(cloneItem);

  for (const edit of patch.items ?? []) {
    const index = items.findIndex((item) => item.id === edit.itemId);
    if (index === -1) {
      throw new ReviewKitError({
        code: 'E_NOT_FOUND',
        message: `Proposal ${proposal.id} has no item "${edit.itemId}"`,
        hint: 'Item ids come from proposal.items and are stable within a version.',
        details: { proposalId: proposal.id, itemId: edit.itemId, knownIds: items.map((i) => i.id) },
      });
    }
    const current = items[index]!;
    const next = cloneItem(current);
    let itemChanged = false;

    if ('after' in edit && !canonicalEquals(current.after, edit.after)) {
      next.editedFrom = current.editedFrom ?? {
        version: proposal.version,
        ...(current.after === undefined ? {} : { after: current.after }),
      };
      if (edit.after === undefined) delete next.after;
      else next.after = edit.after;
      changedFields.push(`items.${current.id}.after`);
      itemChanged = true;
    }
    if (edit.operation !== undefined && edit.operation !== current.operation) {
      next.operation = edit.operation;
      changedFields.push(`items.${current.id}.operation`);
      itemChanged = true;
    }
    if (edit.source !== undefined && !canonicalEquals(edit.source, current.source)) {
      next.source = edit.source;
      changedFields.push(`items.${current.id}.source`);
      itemChanged = true;
    }

    // Reviewer notes live on the decision, not on the executed payload.
    if (itemChanged) next.status = 'edited';
    items[index] = next;
  }

  const target: ActionTarget = { ...proposal.target };
  for (const [key, value] of Object.entries(patch.target ?? {})) {
    if (value === undefined) continue;
    const typedKey = key as keyof ActionTarget;
    if (target[typedKey] !== value) {
      target[typedKey] = value as string;
      changedFields.push(`target.${key}`);
    }
  }

  let idempotencyKey = proposal.idempotencyKey;
  if (patch.idempotencyKey !== undefined && patch.idempotencyKey !== idempotencyKey) {
    idempotencyKey = patch.idempotencyKey;
    changedFields.push('idempotencyKey');
  }

  const candidate: ActionProposal = {
    ...proposal,
    items,
    target,
    idempotencyKey,
    updatedAt: options.clock.iso(),
  };
  if (patch.summary !== undefined) candidate.summary = patch.summary;
  if (patch.reason !== undefined) candidate.reason = patch.reason;
  if (patch.risk !== undefined) candidate.risk = patch.risk;

  const nextHash = computeContentHash(candidate);
  const revised = nextHash !== proposal.contentHash;

  if (revised) {
    candidate.version = proposal.version + 1;
    candidate.contentHash = nextHash;
    candidate.revisionOf = {
      version: proposal.version,
      ...(options.reason ? { reason: options.reason } : {}),
    };
    // Approvals are bound to (version, hash); the previous execution attempt, if
    // any, no longer describes this content.
    if (candidate.execution && candidate.execution.status === 'not_started') delete candidate.execution;
  }

  return {
    proposal: candidate,
    revised,
    changedFields,
    previousVersion: proposal.version,
    previousContentHash: proposal.contentHash,
  };
}

/** Snapshot of live source data, as read by the host just before executing. */
export interface SourceSnapshot {
  /** Match by item id, or by `source.ref` when the host keys on refs. */
  itemId?: string;
  ref?: string;
  /** Current etag / row version in the source system. */
  version?: string;
  /** Current value, when the host can supply it (enables a real re-diff). */
  before?: JsonValue;
  /** Set when the source object no longer exists. */
  missing?: boolean;
}

export interface SourceCheckResult {
  /** Items whose source moved (or vanished) since the proposal was built. */
  changedItemIds: string[];
  drift: Array<{ itemId: string; expectedVersion?: string; actualVersion?: string; missing?: boolean }>;
  /** True when the proposal-level `target.sourceVersion` no longer matches. */
  targetDrift?: { expected?: string; actual?: string };
}

function matchSnapshot(item: ActionItem, snapshots: readonly SourceSnapshot[]): SourceSnapshot | undefined {
  return snapshots.find(
    (snapshot) =>
      (snapshot.itemId !== undefined && snapshot.itemId === item.id) ||
      (snapshot.ref !== undefined && item.source?.ref !== undefined && snapshot.ref === item.source.ref),
  );
}

/**
 * Compare a proposal against live source data (PRD 12.10).
 * Pure: callers decide whether to invalidate.
 */
export function checkSourceVersions(
  proposal: ActionProposal,
  snapshots: readonly SourceSnapshot[],
  currentTargetVersion?: string,
): SourceCheckResult {
  const result: SourceCheckResult = { changedItemIds: [], drift: [] };

  for (const item of proposal.items) {
    const snapshot = matchSnapshot(item, snapshots);
    if (!snapshot) continue;

    if (snapshot.missing) {
      result.changedItemIds.push(item.id);
      result.drift.push({ itemId: item.id, expectedVersion: item.source?.version, missing: true });
      continue;
    }
    const expected = item.source?.version;
    const versionMoved = snapshot.version !== undefined && expected !== undefined && snapshot.version !== expected;
    const valueMoved = snapshot.before !== undefined && !canonicalEquals(snapshot.before, item.before);
    if (versionMoved || valueMoved) {
      result.changedItemIds.push(item.id);
      const entry: { itemId: string; expectedVersion?: string; actualVersion?: string } = { itemId: item.id };
      if (expected !== undefined) entry.expectedVersion = expected;
      if (snapshot.version !== undefined) entry.actualVersion = snapshot.version;
      result.drift.push(entry);
    }
  }

  if (
    currentTargetVersion !== undefined &&
    proposal.target.sourceVersion !== undefined &&
    currentTargetVersion !== proposal.target.sourceVersion
  ) {
    result.targetDrift = { expected: proposal.target.sourceVersion, actual: currentTargetVersion };
  }

  return result;
}

/** Mark the listed items `invalidated`, recording why. Does not change the hash. */
export function markItemsInvalidated(
  proposal: ActionProposal,
  drift: SourceCheckResult,
  reason = 'source_changed',
): ActionProposal {
  const byItem = new Map(drift.drift.map((entry) => [entry.itemId, entry]));
  return {
    ...proposal,
    items: proposal.items.map((item) => {
      const entry = byItem.get(item.id);
      if (!entry) return item;
      const invalidation: NonNullable<ActionItem['invalidation']> = { reason };
      if (entry.expectedVersion !== undefined) invalidation.expectedVersion = entry.expectedVersion;
      if (entry.actualVersion !== undefined) invalidation.actualVersion = entry.actualVersion;
      return { ...item, status: 'invalidated', invalidation };
    }),
  };
}

/**
 * Re-base a proposal on fresh source data: `before` values are replaced, source
 * versions updated, item statuses reset to `pending`, and the diff is therefore
 * recomputed by any renderer. Produces a new version whenever content moved.
 */
export function refreshSource(
  proposal: ActionProposal,
  snapshots: readonly SourceSnapshot[],
  options: ReviseOptions & { currentTargetVersion?: string; dropMissingItems?: boolean },
): ReviseResult {
  const items: ActionItem[] = [];
  for (const item of proposal.items) {
    const snapshot = matchSnapshot(item, snapshots);
    if (snapshot?.missing && options.dropMissingItems) continue;
    if (!snapshot) {
      items.push(item.status === 'invalidated' ? { ...item, status: 'pending' } : item);
      continue;
    }
    const next: ActionItem = { ...item, status: 'pending' };
    delete next.invalidation;
    if (snapshot.before !== undefined) next.before = snapshot.before;
    if (snapshot.version !== undefined) {
      next.source = { ...(item.source ?? { ref: snapshot.ref ?? item.id }), version: snapshot.version };
    }
    if (snapshot.missing) {
      next.status = 'invalidated';
      next.invalidation = { reason: 'source_missing' };
    }
    items.push(next);
  }

  if (items.length === 0) {
    throw new ReviewKitError({
      code: 'E_SOURCE_CHANGED',
      message: `Every item in proposal ${proposal.id} disappeared from the source system`,
      hint: 'Cancel the proposal and ask the agent to plan again from current data.',
      details: { proposalId: proposal.id },
    });
  }

  const target =
    options.currentTargetVersion === undefined
      ? proposal.target
      : { ...proposal.target, sourceVersion: options.currentTargetVersion };

  const candidate: ActionProposal = {
    ...proposal,
    items,
    target,
    updatedAt: options.clock.iso(),
  };

  const changedFields = items
    .filter((item, index) => !canonicalEquals(item, proposal.items[index]))
    .map((item) => `items.${item.id}`);

  const nextHash = computeContentHash(candidate);
  // A refresh bumps the version whenever *anything* the reviewer sees moved —
  // including `before`, which is review context and not part of the hash. Older
  // decisions are bound to (version, hash) and therefore become stale, so a
  // pre-refresh approval can never be replayed against re-based data.
  const revised = nextHash !== proposal.contentHash || changedFields.length > 0;
  if (revised) {
    candidate.version = proposal.version + 1;
    candidate.contentHash = nextHash;
    candidate.revisionOf = { version: proposal.version, reason: options.reason ?? 'source_refreshed' };
  }

  return {
    proposal: candidate,
    revised,
    changedFields,
    previousVersion: proposal.version,
    previousContentHash: proposal.contentHash,
  };
}
