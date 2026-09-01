/**
 * Input normalization: turn the loose shape a host or adapter produces into a
 * complete, hashed {@link ActionProposal}.
 *
 * Two input styles are supported on purpose:
 *
 *  1. explicit `items` — what production hosts and adapters emit;
 *  2. top-level `before` / `after` — the PRD §11.1 shape, and what the Playground
 *     pastes. Records are paired by `keyField` (default `id`), so a 300-row batch
 *     becomes 300 independently reviewable items with no extra work.
 */
import type { Clock } from './clock.js';
import { systemClock } from './clock.js';
import { inferItemKind } from './diff/index.js';
import { computeContentHash, digest, isContentHash } from './hash.js';
import { ReviewKitError } from './errors.js';
import { assertValidProposal, type ValidateOptions } from './validate.js';
import {
  SCHEMA_VERSION,
  type ActionItem,
  type ActionItemInput,
  type ActionProposal,
  type Identity,
  type ItemOperation,
  type JsonObject,
  type JsonValue,
  type ProposalInput,
  type ProposalStatus,
  type RiskAssessment,
} from './types.js';

export interface NormalizeOptions {
  clock?: Clock;
  /** Status of the produced proposal. Default `pending_review`. */
  status?: Extract<ProposalStatus, 'draft' | 'pending_review'>;
  /** Applied when the input has neither `expiresAt` nor `ttlMs`. */
  defaultTtlMs?: number;
  /** Identity recorded as the initiator when the input omits one. */
  defaultInitiator?: Identity;
  /** Run schema validation before returning. Default true. */
  validate?: boolean;
  validateOptions?: ValidateOptions;
}

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function asRecords(value: JsonValue | undefined): JsonValue[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function keyOf(record: JsonValue | undefined, keyField: string): string | undefined {
  if (!isRecord(record)) return undefined;
  const raw = record[keyField];
  if (raw === undefined || raw === null) return undefined;
  return String(raw);
}

function inferOperation(before: JsonValue | undefined, after: JsonValue | undefined): ItemOperation {
  if (before === undefined) return 'create';
  if (after === undefined) return 'delete';
  return 'update';
}

function normalizeRisk(risk: ProposalInput['risk']): RiskAssessment {
  if (risk === undefined) return { level: 'medium' };
  if (typeof risk === 'string') return { level: risk };
  return risk;
}

/** Pair `before`/`after` collections into items, matching on `keyField`. */
function itemsFromBeforeAfter(input: ProposalInput): ActionItemInput[] {
  const keyField = input.keyField ?? 'id';
  const before = asRecords(input.before);
  const after = asRecords(input.after);

  if (!before && !after) return [];

  // Single non-record payloads (a string body, a config object) → one item.
  const singleSide = before ?? after ?? [];
  if (singleSide.length === 1 && !isRecord(singleSide[0])) {
    return [{ before: before?.[0], after: after?.[0] }];
  }

  const beforeByKey = new Map<string, JsonValue>();
  const beforePositional: JsonValue[] = [];
  (before ?? []).forEach((record) => {
    const key = keyOf(record, keyField);
    if (key === undefined) beforePositional.push(record);
    else beforeByKey.set(key, record);
  });

  const items: ActionItemInput[] = [];
  const usedKeys = new Set<string>();
  let positional = 0;

  (after ?? []).forEach((record, index) => {
    const key = keyOf(record, keyField);
    if (key === undefined) {
      const match = beforePositional[positional++];
      items.push({ id: `i${index + 1}`, before: match, after: record });
      return;
    }
    usedKeys.add(key);
    const match = beforeByKey.get(key);
    items.push({ id: key, before: match, after: record });
  });

  // before-only records are deletions.
  for (const [key, record] of beforeByKey) {
    if (!usedKeys.has(key)) items.push({ id: key, before: record });
  }
  for (let i = positional; i < beforePositional.length; i++) {
    items.push({ id: `i${items.length + 1}`, before: beforePositional[i] });
  }

  return items;
}

function normalizeItem(input: ActionItemInput, index: number, keyField: string): ActionItem {
  const id =
    input.id ??
    keyOf(input.after, keyField) ??
    keyOf(input.before, keyField) ??
    `i${index + 1}`;

  const item: ActionItem = {
    id,
    kind: input.kind ?? inferItemKind(input.before, input.after),
    operation: input.operation ?? inferOperation(input.before, input.after),
    status: input.status ?? 'pending',
  };
  if (input.summary !== undefined) item.summary = input.summary;
  if (input.before !== undefined) item.before = input.before;
  if (input.after !== undefined) item.after = input.after;
  if (input.risk !== undefined) item.risk = input.risk;
  if (input.source !== undefined) item.source = input.source;
  if (input.meta !== undefined) item.meta = input.meta;
  return item;
}

function pluralize(word: string, count: number): string {
  if (count === 1) return word;
  if (/(s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** `crm.contact.update` → `{ system: 'crm', subject: 'contact', verb: 'update' }` */
function parseType(type: string): { system: string; subject: string; verb: string } {
  const parts = type.split(/[.:/]/).filter(Boolean);
  return {
    system: parts[0] ?? 'unknown',
    subject: parts.length >= 2 ? parts[parts.length - 2]! : (parts[0] ?? 'record'),
    verb: parts.length >= 1 ? parts[parts.length - 1]! : 'change',
  };
}

/**
 * Build a complete proposal from loose input. Pure apart from the injected clock:
 * same input + same clock ⇒ same proposal, same hash.
 */
export function createProposal(input: ProposalInput, options: NormalizeOptions = {}): ActionProposal {
  const clock = options.clock ?? systemClock();
  const keyField = input.keyField ?? 'id';

  const itemInputs = input.items && input.items.length > 0 ? input.items : itemsFromBeforeAfter(input);
  if (itemInputs.length === 0) {
    throw new ReviewKitError({
      code: 'E_VALIDATION',
      message: 'Cannot create a proposal with no items',
      hint: 'Pass `items: [...]`, or a top-level `before`/`after` pair (see docs/concepts.md#action-proposal).',
      details: { type: input.type },
    });
  }

  const items = itemInputs.map((item, index) => normalizeItem(item, index, keyField));
  const parsed = parseType(input.type ?? '');
  const subjectType = input.subject?.type ?? parsed.subject;
  const createdAt = input.createdAt ?? clock.iso();

  const expiresAt =
    input.expiresAt ??
    (input.ttlMs !== undefined
      ? new Date(Date.parse(createdAt) + input.ttlMs).toISOString()
      : options.defaultTtlMs !== undefined
        ? new Date(Date.parse(createdAt) + options.defaultTtlMs).toISOString()
        : undefined);

  // Derived before the id and the content hash: the key is part of both. Two
  // proposals with identical payloads but different idempotency keys are different
  // proposals, and must not collide in the store.
  const idempotencyKey =
    input.idempotencyKey ??
    `${input.type}:${digest({ items: items.map((i) => ({ id: i.id, operation: i.operation, after: i.after })) }).slice(7, 23)}`;

  const draft: ActionProposal = {
    schemaVersion: SCHEMA_VERSION,
    id:
      input.id ??
      `act_${digest({ type: input.type, items, createdAt, idempotencyKey, expiresAt: expiresAt ?? null }).slice(7, 27)}`,
    version: input.version ?? 1,
    status: options.status ?? input.status ?? 'pending_review',
    type: input.type,
    subject: {
      type: subjectType,
      count: input.subject?.count ?? items.length,
      ...(input.subject?.label ? { label: input.subject.label } : {}),
    },
    summary:
      input.summary ??
      `${parsed.verb.charAt(0).toUpperCase()}${parsed.verb.slice(1)} ${items.length} ${pluralize(subjectType, items.length)}`,
    risk: normalizeRisk(input.risk),
    items,
    target: {
      system: input.target?.system ?? parsed.system,
      ...(input.target?.resource ? { resource: input.target.resource } : {}),
      ...(input.target?.environment ? { environment: input.target.environment } : {}),
      ...(input.target?.sourceVersion ? { sourceVersion: input.target.sourceVersion } : {}),
    },
    origin: {
      initiatedBy:
        input.origin?.initiatedBy ?? options.defaultInitiator ?? { id: 'agent', kind: 'agent', name: 'Agent' },
      ...(input.origin?.agent ? { agent: input.origin.agent } : {}),
      ...(input.origin?.agentRunId ? { agentRunId: input.origin.agentRunId } : {}),
      ...(input.origin?.tool ? { tool: input.origin.tool } : {}),
    },
    createdAt,
    idempotencyKey,
    contentHash: '',
  };

  if (input.reason !== undefined) draft.reason = input.reason;
  if (input.evidence !== undefined) draft.evidence = input.evidence;
  if (input.traceId !== undefined) draft.traceId = input.traceId;
  if (expiresAt !== undefined) draft.expiresAt = expiresAt;
  if (input.redaction !== undefined) draft.redaction = input.redaction;
  if (input.labels !== undefined) draft.labels = input.labels;

  draft.contentHash = computeContentHash(draft);

  if (input.contentHash !== undefined && isContentHash(input.contentHash) && input.contentHash !== draft.contentHash) {
    throw new ReviewKitError({
      code: 'E_HASH_MISMATCH',
      message: 'Provided contentHash does not match the normalized proposal content',
      hint:
        'Omit contentHash and let ReviewKit compute it. If you hash proposals yourself, hash buildExecutionPayload(proposal) — see docs/concepts.md#content-hash.',
      details: { provided: input.contentHash, computed: draft.contentHash, proposalId: draft.id },
    });
  }

  if (options.validate !== false) assertValidProposal(draft, options.validateOptions);
  return draft;
}

/** True when the value already looks like a normalized proposal. */
export function isActionProposal(value: unknown): value is ActionProposal {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ActionProposal>;
  return (
    candidate.schemaVersion === SCHEMA_VERSION &&
    typeof candidate.id === 'string' &&
    typeof candidate.version === 'number' &&
    Array.isArray(candidate.items) &&
    isContentHash(candidate.contentHash)
  );
}

/**
 * Accept either a proposal or loose input. An existing proposal is re-hashed and
 * the result must match the hash it arrived with: a payload that was edited in
 * transit (or by hand) is rejected rather than quietly re-blessed.
 */
export function normalizeProposal(
  input: ProposalInput | ActionProposal,
  options: NormalizeOptions = {},
): ActionProposal {
  if (isActionProposal(input)) {
    const recomputed = computeContentHash(input);
    if (recomputed !== input.contentHash) {
      throw new ReviewKitError({
        code: 'E_HASH_MISMATCH',
        message: `Proposal ${input.id} v${input.version} carries a contentHash that does not match its content`,
        hint:
          'Do not edit proposal payloads in place. Use session.editItem() (which creates a new revision), or drop contentHash to have it recomputed.',
        details: { proposalId: input.id, version: input.version, declared: input.contentHash, computed: recomputed },
      });
    }
    if (options.validate !== false) assertValidProposal(input, options.validateOptions);
    return input;
  }
  return createProposal(input as ProposalInput, options);
}
