/**
 * Hand-written validators for the three public objects.
 *
 * Why not a schema library at runtime: core must stay dependency-free and the
 * error messages must be *actionable* (PRD 20). The JSON Schema files in
 * `schema/` describe the same shapes for non-JS consumers, and a test validates
 * fixtures against both so they cannot drift.
 */
import { canonicalize } from './canonical.js';
import { isContentHash } from './hash.js';
import { SCHEMA_VERSION } from './types.js';
import type { ValidationIssue, ValidationResult } from './errors.js';
import { validationError } from './errors.js';
import type { ActionProposal, ExecutionReceipt, ReviewDecision } from './types.js';

/** PRD 13: 500 items / 5 MB per proposal for v0.1. */
export const LIMITS = {
  maxItems: 500,
  maxBytes: 5 * 1024 * 1024,
  maxSummaryLength: 2000,
  maxIdempotencyKeyLength: 200,
} as const;

export interface ValidateOptions {
  limits?: Partial<typeof LIMITS>;
  /** Skip the (linear) payload size check when the caller already knows the size. */
  skipSizeCheck?: boolean;
}

const PROPOSAL_STATUSES = new Set([
  'draft',
  'pending_review',
  'reviewing',
  'changes_requested',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'superseded',
  'invalidated',
]);
const ITEM_STATUSES = new Set(['pending', 'approved', 'edited', 'rejected', 'invalidated']);
const RISK_LEVELS = new Set(['low', 'medium', 'high', 'critical']);
const DECISION_KINDS = new Set(['approve', 'approve_with_edits', 'reject', 'defer', 'cancel']);
const EXECUTION_STATUSES = new Set([
  'not_started',
  'queued',
  'running',
  'partially_succeeded',
  'succeeded',
  'failed',
  'rolled_back',
]);
const RESULT_STATUSES = new Set(['succeeded', 'failed', 'skipped', 'rolled_back']);

class Issues {
  readonly list: ValidationIssue[] = [];

  add(path: string, code: string, message: string, hint?: string): void {
    this.list.push(hint === undefined ? { path, code, message } : { path, code, message, hint });
  }

  requireString(value: unknown, path: string, hint?: string): boolean {
    if (typeof value !== 'string' || value.trim() === '') {
      this.add(path, 'required_string', `${path} must be a non-empty string`, hint);
      return false;
    }
    return true;
  }

  requireIsoDate(value: unknown, path: string): void {
    if (value === undefined) return;
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      this.add(path, 'invalid_datetime', `${path} must be an ISO-8601 timestamp`, 'Use new Date().toISOString().');
    }
  }

  requireEnum(value: unknown, allowed: Set<string>, path: string): void {
    if (typeof value !== 'string' || !allowed.has(value)) {
      this.add(
        path,
        'invalid_enum',
        `${path} must be one of: ${[...allowed].join(', ')} (received ${JSON.stringify(value)})`,
      );
    }
  }
}

function checkSchemaVersion(issues: Issues, value: unknown, path: string): void {
  if (value !== SCHEMA_VERSION) {
    issues.add(
      path,
      'schema_version',
      `Unsupported schemaVersion ${JSON.stringify(value)}; this build speaks "${SCHEMA_VERSION}"`,
      'See docs/migration.md for how to upgrade payloads between schema versions.',
    );
  }
}

export function validateProposal(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const limits = { ...LIMITS, ...options.limits };
  const issues = new Issues();

  if (typeof input !== 'object' || input === null) {
    issues.add('', 'not_an_object', 'Proposal must be an object');
    return { valid: false, issues: issues.list };
  }
  const p = input as Partial<ActionProposal> & Record<string, unknown>;

  checkSchemaVersion(issues, p.schemaVersion, 'schemaVersion');
  issues.requireString(p.id, 'id');
  issues.requireString(p.type, 'type', 'Use a namespaced action type such as "crm.contact.update".');
  issues.requireString(p.summary, 'summary', 'One line a reviewer can read in the list view.');
  issues.requireString(p.idempotencyKey, 'idempotencyKey', 'Stable per logical action; reused across revisions.');
  issues.requireEnum(p.status, PROPOSAL_STATUSES, 'status');
  issues.requireIsoDate(p.createdAt, 'createdAt');
  issues.requireIsoDate(p.updatedAt, 'updatedAt');
  issues.requireIsoDate(p.expiresAt, 'expiresAt');

  if (typeof p.version !== 'number' || !Number.isInteger(p.version) || p.version < 1) {
    issues.add('version', 'invalid_version', 'version must be an integer >= 1');
  }
  if (typeof p.summary === 'string' && p.summary.length > limits.maxSummaryLength) {
    issues.add('summary', 'too_long', `summary must be <= ${limits.maxSummaryLength} characters`);
  }
  if (typeof p.idempotencyKey === 'string' && p.idempotencyKey.length > limits.maxIdempotencyKeyLength) {
    issues.add('idempotencyKey', 'too_long', `idempotencyKey must be <= ${limits.maxIdempotencyKeyLength} characters`);
  }

  if (typeof p.subject !== 'object' || p.subject === null) {
    issues.add('subject', 'required_object', 'subject must be { type, count }');
  } else {
    issues.requireString(p.subject.type, 'subject.type');
    if (typeof p.subject.count !== 'number' || !Number.isInteger(p.subject.count) || p.subject.count < 0) {
      issues.add('subject.count', 'invalid_count', 'subject.count must be a non-negative integer');
    }
  }

  if (typeof p.risk !== 'object' || p.risk === null) {
    issues.add('risk', 'required_object', 'risk must be { level, tags? }');
  } else {
    issues.requireEnum(p.risk.level, RISK_LEVELS, 'risk.level');
    if (p.risk.tags !== undefined && !Array.isArray(p.risk.tags)) {
      issues.add('risk.tags', 'invalid_array', 'risk.tags must be an array of strings');
    }
  }

  if (typeof p.target !== 'object' || p.target === null) {
    issues.add('target', 'required_object', 'target must be { system, ... }');
  } else {
    issues.requireString(p.target.system, 'target.system', 'Which system will change, e.g. "crm".');
  }

  if (typeof p.origin !== 'object' || p.origin === null) {
    issues.add('origin', 'required_object', 'origin must be { initiatedBy: { id } }');
  } else if (typeof p.origin.initiatedBy !== 'object' || p.origin.initiatedBy === null) {
    issues.add('origin.initiatedBy', 'required_object', 'origin.initiatedBy must be an authenticated identity');
  } else {
    issues.requireString(p.origin.initiatedBy.id, 'origin.initiatedBy.id');
  }

  if (!Array.isArray(p.items)) {
    issues.add('items', 'required_array', 'items must be an array of ActionItem');
  } else {
    if (p.items.length === 0) {
      issues.add('items', 'empty_items', 'A proposal must contain at least one item', 'Nothing to review otherwise.');
    }
    if (p.items.length > limits.maxItems) {
      issues.add(
        'items',
        'too_many_items',
        `A proposal may contain at most ${limits.maxItems} items (received ${p.items.length})`,
        'Split the batch into several proposals; v0.1 targets 500 items per proposal.',
      );
    }
    const seen = new Set<string>();
    p.items.forEach((item, index) => {
      const path = `items[${index}]`;
      if (typeof item !== 'object' || item === null) {
        issues.add(path, 'not_an_object', `${path} must be an object`);
        return;
      }
      if (issues.requireString(item.id, `${path}.id`)) {
        if (seen.has(item.id)) {
          issues.add(`${path}.id`, 'duplicate_id', `Duplicate item id "${item.id}"`, 'Item ids must be unique inside a proposal — they key the execution payload.');
        }
        seen.add(item.id);
      }
      issues.requireString(item.kind, `${path}.kind`, 'Renderer hint: "json", "text", "table" or a custom kind.');
      issues.requireString(item.operation, `${path}.operation`);
      issues.requireEnum(item.status, ITEM_STATUSES, `${path}.status`);
      if (item.before === undefined && item.after === undefined) {
        issues.add(path, 'empty_item', `${path} must define before, after, or both`);
      }
      if (item.operation === 'create' && item.after === undefined) {
        issues.add(`${path}.after`, 'missing_after', 'operation "create" requires an after value');
      }
      if (item.operation === 'delete' && item.before === undefined) {
        issues.add(`${path}.before`, 'missing_before', 'operation "delete" requires a before value');
      }
      if (item.risk !== undefined) issues.requireEnum(item.risk?.level, RISK_LEVELS, `${path}.risk.level`);
      if (item.source !== undefined) issues.requireString(item.source?.ref, `${path}.source.ref`);
      try {
        canonicalize(item.before);
        canonicalize(item.after);
      } catch (error) {
        issues.add(
          path,
          'not_serializable',
          `${path} payload is not JSON-serializable: ${(error as Error).message}`,
          'Remove functions, bigints, NaN/Infinity and cycles before submitting.',
        );
      }
    });
  }

  if (p.contentHash !== undefined && !isContentHash(p.contentHash)) {
    issues.add(
      'contentHash',
      'invalid_hash',
      'contentHash must look like "sha256:<64 hex chars>"',
      'Let ReviewKit compute it (createProposal/session.submit) instead of writing it by hand.',
    );
  }

  if (!options.skipSizeCheck && Array.isArray(p.items)) {
    try {
      const bytes = canonicalize(p.items).length;
      if (bytes > limits.maxBytes) {
        issues.add(
          'items',
          'too_large',
          `Proposal payload is ${(bytes / 1024 / 1024).toFixed(1)} MB; the v0.1 limit is ${(limits.maxBytes / 1024 / 1024).toFixed(0)} MB`,
          'Trim unchanged fields from before/after, or split the proposal.',
        );
      }
    } catch {
      // Serialization problems are already reported per item.
    }
  }

  return { valid: issues.list.length === 0, issues: issues.list };
}

export function validateDecision(input: unknown): ValidationResult {
  const issues = new Issues();
  if (typeof input !== 'object' || input === null) {
    issues.add('', 'not_an_object', 'Decision must be an object');
    return { valid: false, issues: issues.list };
  }
  const d = input as Partial<ReviewDecision> & Record<string, unknown>;

  checkSchemaVersion(issues, d.schemaVersion, 'schemaVersion');
  issues.requireString(d.id, 'id');
  issues.requireString(d.proposalId, 'proposalId');
  issues.requireString(d.idempotencyKey, 'idempotencyKey');
  issues.requireEnum(d.kind, DECISION_KINDS, 'kind');
  issues.requireIsoDate(d.decidedAt, 'decidedAt');
  if (typeof d.proposalVersion !== 'number' || !Number.isInteger(d.proposalVersion) || d.proposalVersion < 1) {
    issues.add('proposalVersion', 'invalid_version', 'proposalVersion must be an integer >= 1');
  }
  if (!isContentHash(d.contentHash)) {
    issues.add(
      'contentHash',
      'invalid_hash',
      'contentHash must be the "sha256:<hex>" hash of the reviewed proposal version',
      'A decision that is not bound to a hash cannot be verified before execution (PRD 12.3).',
    );
  }
  if (d.kind === 'approve' || d.kind === 'approve_with_edits') {
    if (!isContentHash(d.approvedContentHash)) {
      issues.add(
        'approvedContentHash',
        'invalid_hash',
        'An approving decision must carry approvedContentHash',
        'Produce decisions via session.approve() so the approved subset is hashed for you.',
      );
    }
    if (!Array.isArray(d.approvedItemIds) || d.approvedItemIds.length === 0) {
      issues.add('approvedItemIds', 'required_array', 'An approving decision must list at least one approved item id');
    }
  }
  if (d.kind === 'defer') issues.requireIsoDate(d.deferUntil, 'deferUntil');
  if (typeof d.reviewer !== 'object' || d.reviewer === null) {
    issues.add('reviewer', 'required_object', 'reviewer must be an authenticated identity');
  } else {
    issues.requireString(d.reviewer.id, 'reviewer.id', 'The host authenticates reviewers; ReviewKit only records who they were.');
  }
  return { valid: issues.list.length === 0, issues: issues.list };
}

export function validateReceipt(input: unknown): ValidationResult {
  const issues = new Issues();
  if (typeof input !== 'object' || input === null) {
    issues.add('', 'not_an_object', 'Receipt must be an object');
    return { valid: false, issues: issues.list };
  }
  const r = input as Partial<ExecutionReceipt> & Record<string, unknown>;

  checkSchemaVersion(issues, r.schemaVersion, 'schemaVersion');
  issues.requireString(r.id, 'id');
  issues.requireString(r.proposalId, 'proposalId');
  issues.requireString(r.decisionId, 'decisionId');
  issues.requireString(r.idempotencyKey, 'idempotencyKey');
  issues.requireEnum(r.status, EXECUTION_STATUSES, 'status');
  issues.requireIsoDate(r.startedAt, 'startedAt');
  issues.requireIsoDate(r.finishedAt, 'finishedAt');
  if (typeof r.proposalVersion !== 'number' || !Number.isInteger(r.proposalVersion) || r.proposalVersion < 1) {
    issues.add('proposalVersion', 'invalid_version', 'proposalVersion must be an integer >= 1');
  }
  if (!isContentHash(r.executedParamsHash)) {
    issues.add(
      'executedParamsHash',
      'invalid_hash',
      'executedParamsHash must be the "sha256:<hex>" hash of the parameters you really executed',
      'Compute it with computePayloadHash(payload) on the payload your executor received.',
    );
  }
  if (r.results !== undefined) {
    if (!Array.isArray(r.results)) {
      issues.add('results', 'required_array', 'results must be an array of per-item outcomes');
    } else {
      r.results.forEach((result, index) => {
        const path = `results[${index}]`;
        if (typeof result !== 'object' || result === null) {
          issues.add(path, 'not_an_object', `${path} must be an object`);
          return;
        }
        issues.requireString(result.itemId, `${path}.itemId`);
        issues.requireEnum(result.status, RESULT_STATUSES, `${path}.status`);
        if (result.status === 'failed' && !result.error) {
          issues.add(
            `${path}.error`,
            'missing_error',
            'A failed item must carry an error { code, message }',
            'Reviewers need the real failure reason, not just a red badge (PRD 10.5).',
          );
        }
      });
    }
  }
  return { valid: issues.list.length === 0, issues: issues.list };
}

export function assertValidProposal(input: unknown, options?: ValidateOptions): asserts input is ActionProposal {
  const result = validateProposal(input, options);
  if (!result.valid) throw validationError(result.issues, 'Action Proposal');
}

export function assertValidDecision(input: unknown): asserts input is ReviewDecision {
  const result = validateDecision(input);
  if (!result.valid) throw validationError(result.issues, 'Review Decision');
}

export function assertValidReceipt(input: unknown): asserts input is ExecutionReceipt {
  const result = validateReceipt(input);
  if (!result.valid) throw validationError(result.issues, 'Execution Receipt');
}

/** Multi-line, copy-pasteable diagnostic. Used by the Playground and CLI examples. */
export function formatIssues(result: ValidationResult): string {
  if (result.valid) return 'valid';
  return result.issues
    .map((issue) => `• ${issue.path || '<root>'} [${issue.code}] ${issue.message}${issue.hint ? `\n    → ${issue.hint}` : ''}`)
    .join('\n');
}
