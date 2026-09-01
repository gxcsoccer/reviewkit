/**
 * Every failure a host can hit has a stable code, a human message and an
 * actionable `hint` (PRD 20: "interface errors must provide actionable
 * diagnostics"). Codes are documented in `docs/errors.md`.
 */

export type ReviewKitErrorCode =
  /** Input did not satisfy the Action Proposal / Decision / Receipt schema. */
  | 'E_VALIDATION'
  /** A value could not be canonicalized (NaN, Infinity, cycle, function, bigint). */
  | 'E_CANONICALIZE'
  /** The requested state transition is not allowed from the current status. */
  | 'E_INVALID_TRANSITION'
  /** Optimistic lock failure: someone else changed the proposal first. */
  | 'E_VERSION_CONFLICT'
  /** A supplied hash does not match the recomputed hash. Fail closed. */
  | 'E_HASH_MISMATCH'
  /** Decision points at a proposal version that is no longer current. */
  | 'E_STALE_DECISION'
  /** Proposal or item source data changed during review. */
  | 'E_SOURCE_CHANGED'
  /** Proposal is past `expiresAt`. */
  | 'E_EXPIRED'
  /** Referenced proposal / decision / receipt / item does not exist. */
  | 'E_NOT_FOUND'
  /** Bulk approval attempted to include items above the allowed risk level. */
  | 'E_RISK_POLICY'
  /** The host policy for "which items must be decided" was not satisfied. */
  | 'E_ITEM_POLICY'
  /** Execution is not allowed for the current proposal/decision state. */
  | 'E_NOT_EXECUTABLE'
  /** A second, conflicting execution was requested for one decision. */
  | 'E_DUPLICATE_EXECUTION'
  /** Storage adapter failed. */
  | 'E_STORE'
  /** Programming error inside a host callback or a renderer contract break. */
  | 'E_CONTRACT';

export interface ReviewKitErrorInit {
  code: ReviewKitErrorCode;
  message: string;
  /** What the caller should do next. Always populated for host-facing errors. */
  hint?: string;
  /** Structured context: ids, versions, hashes. Never raw business payloads. */
  details?: Record<string, unknown>;
  cause?: unknown;
  /** Relative docs anchor, e.g. `docs/errors.md#e_hash_mismatch`. */
  docs?: string;
}

export class ReviewKitError extends Error {
  override readonly name = 'ReviewKitError';
  readonly code: ReviewKitErrorCode;
  readonly hint: string | undefined;
  readonly details: Record<string, unknown>;
  readonly docs: string;

  constructor(init: ReviewKitErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.code = init.code;
    this.hint = init.hint;
    this.details = init.details ?? {};
    this.docs = init.docs ?? `docs/errors.md#${init.code.toLowerCase()}`;
  }

  /** Single-line diagnostic suitable for logs and error toasts. */
  override toString(): string {
    return `[${this.code}] ${this.message}${this.hint ? ` → ${this.hint}` : ''}`;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      hint: this.hint,
      details: this.details,
      docs: this.docs,
    };
  }
}

export function isReviewKitError(value: unknown): value is ReviewKitError {
  return value instanceof ReviewKitError;
}

export function reviewKitError(init: ReviewKitErrorInit): ReviewKitError {
  return new ReviewKitError(init);
}

/** A single schema problem, addressed by JSON path so UIs can highlight a field. */
export interface ValidationIssue {
  /** JSON pointer-ish path, e.g. `items[2].after`. */
  path: string;
  code: string;
  message: string;
  hint?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function validationError(issues: ValidationIssue[], what: string): ReviewKitError {
  const first = issues[0];
  const summary =
    issues.length === 1
      ? `${what} is invalid: ${first?.path || '<root>'} — ${first?.message}`
      : `${what} is invalid: ${issues.length} problems, first at ${first?.path || '<root>'} — ${first?.message}`;
  return new ReviewKitError({
    code: 'E_VALIDATION',
    message: summary,
    hint:
      first?.hint ??
      'Fix the listed paths, or run validateProposal()/validateDecision()/validateReceipt() before submitting.',
    details: { issues },
  });
}
