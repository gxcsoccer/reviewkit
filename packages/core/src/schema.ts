/**
 * JSON Schema (draft-07) for the three wire objects.
 *
 * The schemas ship as plain `.json` files so non-JS hosts (Python agents, Go
 * services) can validate proposals without a TypeScript toolchain:
 *
 * ```
 * node -e "console.log(require.resolve('@reviewkit/core/schema/action-proposal.json'))"
 * ```
 *
 * or, in an ESM app:
 *
 * ```ts
 * import schema from '@reviewkit/core/schema/action-proposal.json' with { type: 'json' };
 * ```
 *
 * Runtime validation inside JS should use {@link validateProposal} and friends
 * from `./validate.js` — they need no extra dependency and return the same
 * actionable diagnostics the UI shows.
 */

/** Canonical `$id` of each shipped schema. */
export const SCHEMA_IDS = {
  actionProposal: 'https://reviewkit.dev/schema/0.1/action-proposal.json',
  reviewDecision: 'https://reviewkit.dev/schema/0.1/review-decision.json',
  executionReceipt: 'https://reviewkit.dev/schema/0.1/execution-receipt.json',
} as const;

/** Subpath exports, for `require.resolve` / `import.meta.resolve`. */
export const SCHEMA_FILES = {
  actionProposal: '@reviewkit/core/schema/action-proposal.json',
  reviewDecision: '@reviewkit/core/schema/review-decision.json',
  executionReceipt: '@reviewkit/core/schema/execution-receipt.json',
} as const;

export type SchemaName = keyof typeof SCHEMA_IDS;

/**
 * Compatibility rules for 0.1.x (PRD 9.1 "migration strategy"):
 *
 *  - within `0.1.x`, only *additive* optional fields are introduced;
 *  - unknown fields are rejected by the JSON Schemas (`additionalProperties: false`)
 *    but tolerated by `validateProposal`, so a newer producer can talk to an older
 *    consumer as long as the required core is present;
 *  - `schemaVersion` is compared exactly by `validate*`: a `0.2` object is refused
 *    with E_SCHEMA_VERSION rather than silently half-understood;
 *  - content hashes cover only the fields listed in `hash.ts`. New optional display
 *    fields therefore never change an existing hash, so pending approvals survive a
 *    ReviewKit upgrade.
 */
export const SCHEMA_COMPATIBILITY = {
  version: '0.1',
  additiveOnly: true,
  hashStableAcross: '0.1.x',
} as const;
