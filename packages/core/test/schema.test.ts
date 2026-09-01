/**
 * The shipped JSON Schemas are the contract for non-JS hosts (PRD 9.1). This
 * suite validates *real* objects produced by the session against them, so the
 * schemas cannot drift away from `types.ts` unnoticed.
 *
 * ajv is a dev dependency only: @reviewkit/core itself has none.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv, type ValidateFunction } from 'ajv';
import { describe, expect, it } from 'vitest';
import {
  SCHEMA_COMPATIBILITY,
  SCHEMA_FILES,
  SCHEMA_IDS,
  SCHEMA_VERSION,
  buildExecutionPayload,
  computeContentHash,
  computePayloadHash,
  type ActionProposal,
  type ExecutionReceipt,
  type ReviewDecision,
} from '@reviewkit/core';
import { crmInput, testSession } from './helpers.js';

const schemaDir = fileURLToPath(new URL('../schema/', import.meta.url));
const load = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(file, `file://${schemaDir}`), 'utf8')) as Record<string, unknown>;

const proposalSchema = load('action-proposal.json');
const decisionSchema = load('review-decision.json');
const receiptSchema = load('execution-receipt.json');

const ajv = new Ajv({ allErrors: true, strict: true });
// `date-time` is the only format the schemas use; register it instead of pulling
// in ajv-formats, so the contract stays checkable with a bare validator.
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/);
const validators: Record<string, ValidateFunction> = {
  proposal: ajv.compile(proposalSchema),
  decision: ajv.compile(decisionSchema),
  receipt: ajv.compile(receiptSchema),
};

function assertValid(kind: keyof typeof validators, value: unknown): void {
  const validate = validators[kind]!;
  const ok = validate(value);
  expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
}

function errorsFor(kind: keyof typeof validators, value: unknown): string[] {
  const validate = validators[kind]!;
  validate(value);
  return (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message}`);
}

/** A full lifecycle, so every schema gets a realistic instance. */
async function lifecycle(): Promise<{
  proposal: ActionProposal;
  decision: ReviewDecision;
  receipt: ExecutionReceipt;
}> {
  const { session } = testSession();
  const { proposal: submittedProposal } = await session.submit(
    crmInput({
      traceId: 'trace_1',
      ttlMs: 3_600_000,
      evidence: [{ label: 'Campaign report', url: 'https://crm.example.com/reports/9', kind: 'link' }],
      redaction: { maskPaths: ['ssn'] },
      labels: { team: 'growth' },
    }),
  );

  const edited = await session.editItem(submittedProposal.id, {
    itemId: 'c_1',
    after: { id: 'c_1', name: 'Alice', priority: 'medium' },
  });
  const { decision } = await session.approve(edited.proposal.id);
  const request = await session.requestExecution(decision.id);

  const receipt: ExecutionReceipt = {
    schemaVersion: SCHEMA_VERSION,
    id: 'rcp_1',
    proposalId: request.proposalId,
    proposalVersion: request.proposalVersion,
    decisionId: request.decisionId,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    executedParamsHash: request.payloadHash,
    status: 'partially_succeeded',
    startedAt: '2026-09-01T10:00:05.000Z',
    finishedAt: '2026-09-01T10:00:09.000Z',
    results: [
      {
        itemId: 'c_1',
        status: 'succeeded',
        externalRef: { system: 'crm', id: 'crm_1', url: 'https://crm.example.com/c_1' },
      },
      { itemId: 'c_2', status: 'failed', error: { code: 'RATE_LIMIT', message: 'Too many writes', retryable: true } },
      { itemId: 'c_3', status: 'skipped' },
    ],
    evidence: [{ label: 'CRM audit log', url: 'https://crm.example.com/audit/1', kind: 'link' }],
    traceId: 'trace_1',
  };
  const { proposal, receipt: stored } = await session.recordReceipt(receipt);
  return { proposal, decision, receipt: stored };
}

describe('shipped JSON Schemas', () => {
  it('are valid draft-07 schemas with the documented $id', () => {
    expect(proposalSchema.$id).toBe(SCHEMA_IDS.actionProposal);
    expect(decisionSchema.$id).toBe(SCHEMA_IDS.reviewDecision);
    expect(receiptSchema.$id).toBe(SCHEMA_IDS.executionReceipt);
    for (const schema of [proposalSchema, decisionSchema, receiptSchema]) {
      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('are reachable through the package exports map', () => {
    expect(Object.values(SCHEMA_FILES)).toEqual([
      '@reviewkit/core/schema/action-proposal.json',
      '@reviewkit/core/schema/review-decision.json',
      '@reviewkit/core/schema/execution-receipt.json',
    ]);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      exports: Record<string, unknown>;
      files: string[];
    };
    for (const specifier of Object.values(SCHEMA_FILES)) {
      expect(pkg.exports[specifier.replace('@reviewkit/core', '.')]).toBeTruthy();
    }
    expect(pkg.files).toContain('schema');
  });

  it('accept the objects the session actually produces', async () => {
    const { proposal, decision, receipt } = await lifecycle();
    assertValid('proposal', proposal);
    assertValid('decision', decision);
    assertValid('receipt', receipt);
  });

  it('accept a minimal proposal and every status', async () => {
    const { session } = testSession();
    const { proposal } = await session.submit({
      type: 'x.y.update',
      before: { id: 'a', v: 1 },
      after: { id: 'a', v: 2 },
    });
    assertValid('proposal', proposal);

    const definitions = proposalSchema.definitions as Record<string, { enum?: string[] } | undefined>;
    const statuses = definitions.proposalStatus?.enum ?? [];
    expect(statuses).toContain('pending_review');
    for (const status of statuses) {
      assertValid('proposal', { ...proposal, status });
    }
  });
});

describe('schema rejections are specific', () => {
  it('rejects a malformed content hash', async () => {
    const { proposal } = await lifecycle();
    expect(errorsFor('proposal', { ...proposal, contentHash: 'deadbeef' }).join()).toMatch(/contentHash/);
    expect(errorsFor('proposal', { ...proposal, contentHash: `sha256:${'z'.repeat(64)}` }).join()).toMatch(/pattern/);
  });

  it('rejects unknown top-level fields, so typos are caught at the boundary', async () => {
    const { proposal } = await lifecycle();
    expect(errorsFor('proposal', { ...proposal, sumary: 'typo' }).join()).toMatch(/additional properties/i);
  });

  it('rejects a proposal with no items and an unknown status', async () => {
    const { proposal } = await lifecycle();
    expect(errorsFor('proposal', { ...proposal, items: [] }).join()).toMatch(/fewer than 1 items/);
    expect(errorsFor('proposal', { ...proposal, status: 'half_approved' }).join()).toMatch(/equal to one of/);
  });

  it('requires an approving decision to carry the approved hash and items', async () => {
    const { decision } = await lifecycle();
    assertValid('decision', decision);

    const { approvedContentHash, ...withoutHash } = decision;
    expect(approvedContentHash).toBeTruthy();
    expect(errorsFor('decision', withoutHash).join()).toMatch(/approvedContentHash/);
    expect(errorsFor('decision', { ...decision, approvedItemIds: [] }).join()).toMatch(/fewer than 1 items/);

    // A rejection needs neither.
    const rejection: ReviewDecision = {
      ...withoutHash,
      kind: 'reject',
      reason: { tags: ['wrong_scope'], note: 'Wrong contacts' },
    };
    delete (rejection as { approvedItemIds?: string[] }).approvedItemIds;
    delete (rejection as { itemDecisions?: unknown }).itemDecisions;
    assertValid('decision', rejection);
  });

  it('requires a receipt to bind a decision and the executed parameters', async () => {
    const { receipt } = await lifecycle();
    for (const field of ['decisionId', 'executedParamsHash', 'proposalVersion', 'idempotencyKey'] as const) {
      const partial = { ...receipt };
      delete (partial as Record<string, unknown>)[field];
      expect(errorsFor('receipt', partial).join(), field).toMatch(new RegExp(field));
    }
    expect(errorsFor('receipt', { ...receipt, status: 'kinda_worked' }).join()).toMatch(/equal to one of/);
    expect(
      errorsFor('receipt', {
        ...receipt,
        results: [{ itemId: 'c_1', status: 'succeeded', externalRef: { system: 'crm' } }],
      }).join(),
    ).toMatch(/id/);
  });

  it('keeps hashes stable across additive 0.1.x fields (PRD 9.1 migration)', async () => {
    const { proposal } = await lifecycle();
    expect(SCHEMA_COMPATIBILITY).toEqual({ version: '0.1', additiveOnly: true, hashStableAcross: '0.1.x' });

    // A future display-only field, added by a newer producer: hash unchanged, so
    // an approval taken before the upgrade is still executable after it.
    const withFutureFields: ActionProposal = {
      ...proposal,
      labels: { ...proposal.labels, note: 'new in 0.1.3' },
      summary: 'Reworded by a newer producer',
    };
    expect(computePayloadHash(buildExecutionPayload(withFutureFields))).toBe(
      computePayloadHash(buildExecutionPayload(proposal)),
    );
    assertValid('proposal', { ...withFutureFields, contentHash: computeContentHash(withFutureFields) });
  });
});
