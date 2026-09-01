/**
 * Field masking (PRD 12.4, 20: "sensitive fields can be configured to be
 * masked", "logs must not print full proposal content").
 *
 * Masking is a *display and logging* concern: the execution payload — and
 * therefore the content hash — always keeps the real values, otherwise the host
 * would execute masked data. `maskData()` is called by renderers; `logDigest()`
 * is what the logger prints.
 *
 * Pattern syntax, matched against dot paths (`owner.email`, `contacts.0.ssn`):
 *   `ssn`            single segment, no wildcard → matches any field named `ssn` at any depth
 *   `owner.email`    exact path
 *   `*.token`        `*` matches exactly one segment
 *   `payload.**`     `**` matches zero or more segments
 */
import type { ActionProposal, JsonValue, RedactionPolicy } from './types.js';

export const DEFAULT_MASK = '••••••';

/** `a.b[0].c` and `a.b.0.c` both normalize to `['a','b','0','c']`. */
export function pathSegments(path: string): string[] {
  if (!path || path === '(root)') return [];
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\["([^"]*)"\]/g, '.$1')
    .split('.')
    .filter((segment) => segment !== '');
}

function matchSegments(segments: readonly string[], pattern: readonly string[]): boolean {
  // Iterative wildcard match: `**` may consume any number of segments.
  let s = 0;
  let p = 0;
  let starS = -1;
  let starP = -1;
  while (s < segments.length) {
    const pat = pattern[p];
    if (p < pattern.length && (pat === '*' || pat === segments[s])) {
      s++;
      p++;
    } else if (p < pattern.length && pat === '**') {
      starP = p++;
      starS = s;
    } else if (starP !== -1) {
      p = starP + 1;
      s = ++starS;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '**') p++;
  return p === pattern.length;
}

export function pathMatches(path: string, pattern: string): boolean {
  const segments = pathSegments(path);
  const patternSegments = pathSegments(pattern);
  if (patternSegments.length === 1 && !pattern.includes('*')) {
    // Convenience: a bare field name masks that field wherever it appears.
    return segments[segments.length - 1] === patternSegments[0];
  }
  return matchSegments(segments, patternSegments);
}

export function isMasked(path: string, policy: RedactionPolicy | undefined): boolean {
  if (!policy?.maskPaths?.length) return false;
  return policy.maskPaths.some((pattern) => pathMatches(path, pattern));
}

/**
 * Deep copy of `value` with masked leaves replaced by the mask string.
 * Structure (keys, array lengths) is preserved so the diff shape still reads.
 */
export function maskData(value: JsonValue | undefined, policy: RedactionPolicy | undefined, basePath = ''): JsonValue | undefined {
  if (!policy?.maskPaths?.length || value === undefined) return value;
  const mask = policy.mask ?? DEFAULT_MASK;

  const walk = (current: JsonValue, path: string): JsonValue => {
    if (path !== '' && isMasked(path, policy)) return mask;
    if (Array.isArray(current)) return current.map((entry, i) => walk(entry, path ? `${path}.${i}` : String(i)));
    if (current !== null && typeof current === 'object') {
      const out: Record<string, JsonValue> = {};
      for (const [key, entry] of Object.entries(current)) {
        out[key] = walk(entry as JsonValue, path ? `${path}.${key}` : key);
      }
      return out;
    }
    return current;
  };

  return walk(value, basePath);
}

/** Which of a proposal's changed paths are masked — used to warn "3 masked fields changed". */
export function maskedPaths(paths: readonly string[], policy: RedactionPolicy | undefined): string[] {
  if (!policy?.maskPaths?.length) return [];
  return paths.filter((path) => isMasked(path, policy));
}

/**
 * The only proposal shape that may be logged by default: ids, versions, hashes
 * and counts. No business payload, no summaries, no reasons.
 */
export interface ProposalLogDigest extends Record<string, unknown> {
  proposalId: string;
  version: number;
  status: string;
  type: string;
  target: string;
  itemCount: number;
  riskLevel: string;
  contentHash: string;
  traceId?: string;
  expiresAt?: string;
}

export function logDigest(proposal: ActionProposal): ProposalLogDigest {
  const digest: ProposalLogDigest = {
    proposalId: proposal.id,
    version: proposal.version,
    status: proposal.status,
    type: proposal.type,
    target: [proposal.target.system, proposal.target.resource].filter(Boolean).join('/'),
    itemCount: proposal.items.length,
    riskLevel: proposal.risk.level,
    contentHash: proposal.contentHash,
  };
  if (proposal.traceId) digest.traceId = proposal.traceId;
  if (proposal.expiresAt) digest.expiresAt = proposal.expiresAt;
  return digest;
}
