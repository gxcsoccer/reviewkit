/**
 * Acceptance tests for the review lifecycle. Each `it` title names the PRD §20
 * criterion it covers, so `docs/acceptance.md` can point straight at it.
 */
import { describe, expect, it } from 'vitest';
import {
  computePayloadHash,
  createProposal,
  prepareExecution,
  SCHEMA_VERSION,
  type ExecutionReceipt,
  type ReviewEvent,
} from '@reviewkit/core';
import { AGENT, REVIEWER, crmInput, expectError, testSession } from './helpers.js';

async function submitted(options?: Parameters<typeof testSession>[0]) {
  const { session, clock } = testSession(options);
  const { proposal } = await session.submit(crmInput());
  return { session, clock, proposal };
}

/** What a well-behaved host reports back after executing an approved request. */
function receiptFor(
  request: { id: string; proposalId: string; proposalVersion: number; decisionId: string; idempotencyKey: string; payloadHash: string; payload: { items: { id: string }[] } },
  overrides: Partial<ExecutionReceipt> = {},
): ExecutionReceipt {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'rcp_1',
    proposalId: request.proposalId,
    proposalVersion: request.proposalVersion,
    decisionId: request.decisionId,
    requestId: request.id,
    idempotencyKey: request.idempotencyKey,
    executedParamsHash: request.payloadHash,
    status: 'succeeded',
    startedAt: '2026-09-01T10:00:05.000Z',
    finishedAt: '2026-09-01T10:00:07.000Z',
    results: request.payload.items.map((item) => ({
      itemId: item.id,
      status: 'succeeded' as const,
      externalRef: { system: 'crm', id: `crm_${item.id}`, url: `https://crm.example.com/${item.id}` },
    })),
    evidence: [{ label: 'CRM audit log', url: 'https://crm.example.com/audit/1', kind: 'link' }],
    ...overrides,
  };
}

describe('submitting a proposal', () => {
  it('accepts the PRD 11.1 before/after shape and pairs records by id', async () => {
    const { proposal } = await submitted();
    expect(proposal.status).toBe('pending_review');
    expect(proposal.items).toHaveLength(3);
    expect(proposal.items.map((item) => item.operation)).toEqual(['update', 'update', 'update']);
    expect(proposal.items[0]!.before).toMatchObject({ id: 'c_1', priority: 'low' });
    expect(proposal.items[0]!.after).toMatchObject({ id: 'c_1', priority: 'high' });
    expect(proposal.subject).toEqual({ type: 'contact', count: 3 });
    expect(proposal.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('is idempotent: the same idempotency key never queues twice', async () => {
    const { session } = testSession();
    const first = await session.submit(crmInput({ idempotencyKey: 'batch-42' }));
    const second = await session.submit(crmInput({ idempotencyKey: 'batch-42' }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.proposal.id).toBe(first.proposal.id);
    expect((await session.list()).total).toBe(1);
  });

  it('rejects a proposal whose contentHash was tampered with in transit', async () => {
    const { session } = testSession();
    const proposal = createProposal(crmInput());
    const tampered = {
      ...proposal,
      items: proposal.items.map((item) => ({ ...item, after: { ...(item.after as object), priority: 'critical' } })),
    };
    await expectError(() => session.submit(tampered), 'E_HASH_MISMATCH');
  });
});

describe('reviewing', () => {
  it('shows raw params and a diff, not just a summary (PRD 20)', async () => {
    const { proposal } = await submitted();
    for (const item of proposal.items) {
      expect(item.after).toBeTypeOf('object');
      expect(item.before).toBeTypeOf('object');
    }
  });

  it('records approve as a decision bound to (version, contentHash, approved subset)', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id, { reviewer: REVIEWER });
    expect(decision.kind).toBe('approve');
    expect(decision.proposalVersion).toBe(proposal.version);
    expect(decision.contentHash).toBe(proposal.contentHash);
    expect(decision.approvedItemIds).toHaveLength(3);
    expect(decision.approvedContentHash).toMatch(/^sha256:/);
    expect((await session.get(proposal.id)).status).toBe('approved');
  });

  it('supports partial approval without touching the other items', async () => {
    const { session, proposal } = await submitted();
    const [first, , third] = proposal.items;
    const { decision, proposal: approved } = await session.approve(proposal.id, {
      itemIds: [first!.id, third!.id],
    });
    expect(decision.approvedItemIds).toEqual([first!.id, third!.id].sort());
    expect(approved.items.map((item) => item.status)).toEqual(['approved', 'pending', 'approved']);

    const { payload } = prepareExecution(approved, decision);
    expect(payload.items.map((item) => item.id)).toEqual([first!.id, third!.id].sort());
  });

  it('records a reject decision and stops execution', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.reject(proposal.id, { reason: { tags: ['wrong_data'], note: 'stale' } });
    expect(decision.kind).toBe('reject');
    expect(decision.approvedContentHash).toBeUndefined();
    expect((await session.get(proposal.id)).status).toBe('rejected');
    await expectError(() => session.requestExecution(decision.id), 'E_NOT_EXECUTABLE');
  });

  it('defers back to the queue with a resume time', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.defer(proposal.id, { ttlMs: 3_600_000, note: 'ask sales' });
    expect(decision.deferUntil).toBe('2026-09-01T11:00:00.000Z');
    expect((await session.get(proposal.id)).status).toBe('pending_review');
    await expectError(() => session.requestExecution(decision.id), 'E_NOT_EXECUTABLE');
  });

  it('detects a second reviewer racing on the same proposal', async () => {
    const { session, proposal } = await submitted();
    const record = await session.getRecord(proposal.id);
    await session.approve(proposal.id);
    const error = await expectError(
      () => session.reject(proposal.id, { expect: { seq: record.seq } }),
      'E_VERSION_CONFLICT',
    );
    expect(error.hint).toMatch(/reload/i);
  });
});

describe('editing before approval (PRD 10.3, 20)', () => {
  it('creates a new version and a new hash when an execution field is edited', async () => {
    const { session, proposal } = await submitted();
    const item = proposal.items[0]!;
    const result = await session.editItem(proposal.id, {
      itemId: item.id,
      after: { id: 'c_1', name: 'Alice', priority: 'medium' },
    });

    expect(result.revised).toBe(true);
    expect(result.proposal.version).toBe(proposal.version + 1);
    expect(result.proposal.contentHash).not.toBe(proposal.contentHash);
    expect(result.changedFields).toEqual([`items.${item.id}.after`]);
    expect(result.proposal.items[0]!.status).toBe('edited');
    expect(result.proposal.items[0]!.editedFrom?.after).toMatchObject({ priority: 'high' });
  });

  it('does not bump the version for cosmetic edits', async () => {
    const { session, proposal } = await submitted();
    const result = await session.revise(proposal.id, { summary: 'Reworded for the reviewer' });
    expect(result.revised).toBe(false);
    expect(result.proposal.version).toBe(proposal.version);
    expect(result.proposal.contentHash).toBe(proposal.contentHash);
  });

  it('makes an approval of the old version unusable', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);

    // Reopen the frozen proposal, then edit it.
    await session.checkSource(proposal.id, [{ itemId: proposal.items[0]!.id, missing: false, version: 'v2' }], {
      currentTargetVersion: 'snap-2',
    });
    const refreshed = await session.refreshSource(
      proposal.id,
      [{ itemId: proposal.items[0]!.id, before: { id: 'c_1', name: 'Alice', priority: 'medium' }, version: 'v2' }],
      { currentTargetVersion: 'snap-2' },
    );
    expect(refreshed.version).toBeGreaterThan(decision.proposalVersion);

    const error = await expectError(() => session.requestExecution(decision.id), 'E_NOT_EXECUTABLE');
    expect(error.details.status).toBe('pending_review');
  });

  it('marks the decision approve_with_edits when the reviewer changed something', async () => {
    const { session, proposal } = await submitted();
    const item = proposal.items[0]!;
    const edited = await session.editItem(proposal.id, {
      itemId: item.id,
      after: { id: 'c_1', name: 'Alice', priority: 'medium' },
    });
    const { decision } = await session.approve(edited.proposal.id);
    expect(decision.kind).toBe('approve_with_edits');
    expect(decision.editedBeforeApproval).toBe(true);
    expect(decision.itemDecisions?.find((d) => d.itemId === item.id)?.status).toBe('edited');
  });
});

describe('source drift (PRD 12.10, 20)', () => {
  it('auto-invalidates and re-diffs when the source data changed under review', async () => {
    const { session, proposal } = await submitted();
    const item = proposal.items[1]!;

    const { drift, invalidated, proposal: after } = await session.checkSource(proposal.id, [
      { itemId: item.id, version: 'etag-2', before: { id: 'c_2', name: 'Bob', priority: 'critical' } },
    ]);

    expect(invalidated).toBe(true);
    expect(drift.changedItemIds).toEqual([item.id]);
    expect(after.status).toBe('invalidated');
    expect(after.items[1]!.status).toBe('invalidated');
    expect(after.items[1]!.invalidation?.reason).toBe('source_changed');

    const refreshed = await session.refreshSource(proposal.id, [
      { itemId: item.id, version: 'etag-2', before: { id: 'c_2', name: 'Bob', priority: 'critical' } },
    ]);
    expect(refreshed.status).toBe('pending_review');
    expect(refreshed.items[1]!.status).toBe('pending');
    expect(refreshed.items[1]!.before).toMatchObject({ priority: 'critical' });
    expect(refreshed.version).toBe(proposal.version + 1);
  });

  it('refuses to approve an invalidated item', async () => {
    const { session, proposal } = await submitted();
    const item = proposal.items[0]!;
    await session.checkSource(proposal.id, [{ itemId: item.id, missing: true }]);
    const error = await expectError(() => session.approve(proposal.id, { itemIds: [item.id] }), 'E_SOURCE_CHANGED');
    expect(error.hint).toMatch(/refreshSource/);
  });

  it('blocks execution when an approved item is invalidated afterwards', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);
    const item = proposal.items[0]!;

    // The host re-read the row just before executing and found a different value.
    await session.checkSource(proposal.id, [
      { itemId: item.id, before: { id: 'c_1', name: 'Alice', priority: 'critical' } },
    ]);

    const error = await expectError(() => session.requestExecution(decision.id), 'E_NOT_EXECUTABLE');
    expect(error.details.status).toBe('invalidated');
  });

  it('detects drift by source version when the host tracks etags', async () => {
    const { session } = testSession();
    const { proposal } = await session.submit({
      ...crmInput(),
      before: undefined,
      after: undefined,
      items: [
        {
          id: 'c_1',
          before: { id: 'c_1', priority: 'low' },
          after: { id: 'c_1', priority: 'high' },
          source: { ref: 'crm:contact:c_1', version: 'etag-1' },
        },
      ],
    });

    // Matched by `source.ref`, without the host knowing our item ids.
    const { drift, invalidated } = await session.checkSource(proposal.id, [
      { ref: 'crm:contact:c_1', version: 'etag-2' },
    ]);

    expect(invalidated).toBe(true);
    expect(drift.drift[0]).toMatchObject({ itemId: 'c_1', expectedVersion: 'etag-1', actualVersion: 'etag-2' });
  });

  it('reports proposal-level target drift', async () => {
    const { session, proposal } = await submitted();
    const { drift } = await session.checkSource(proposal.id, [], { currentTargetVersion: 'snap-2' });
    expect(drift.targetDrift).toEqual({ expected: 'snap-1', actual: 'snap-2' });
  });
});

describe('bulk operations (PRD 10.1, 20)', () => {
  it('processes low-risk items in bulk', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);
    expect(decision.approvedItemIds).toHaveLength(3);
  });

  it('never hides a high-risk item inside a bulk approve', async () => {
    const { session } = testSession();
    const input = crmInput();
    const { proposal } = await session.submit({
      ...input,
      items: [
        { id: 'i1', after: { id: 'c_1', priority: 'high' }, risk: { level: 'low' } },
        { id: 'i2', after: { id: 'c_2', priority: 'high' }, risk: { level: 'high' }, summary: 'Deletes billing owner' },
      ],
      before: undefined,
      after: undefined,
    });

    const error = await expectError(() => session.approve(proposal.id), 'E_RISK_POLICY');
    expect(error.details.blockedItemIds).toEqual(['i2']);
    expect(error.hint).toMatch(/individually/);

    // The escape hatches: one at a time, or an explicit acknowledgement.
    const single = await session.approve(proposal.id, { itemIds: ['i2'] });
    expect(single.decision.approvedItemIds).toEqual(['i2']);

    const { session: s2 } = testSession();
    const { proposal: p2 } = await s2.submit({ ...input, idempotencyKey: 'other', items: undefined });
    const ack = await s2.approve(p2.id, { acknowledgeHighRisk: true });
    expect(ack.decision.approvedItemIds).toHaveLength(3);
  });

  it('honours a stricter bulk risk ceiling from policy', async () => {
    const { session } = testSession({ policy: { bulkApproveMaxRisk: 'critical' } });
    const { proposal } = await session.submit(
      crmInput({ items: [{ id: 'i1', risk: { level: 'high' }, after: { a: 1 } }, { id: 'i2', risk: { level: 'critical' }, after: { a: 2 } }], before: undefined, after: undefined }),
    );
    const { decision } = await session.approve(proposal.id);
    expect(decision.approvedItemIds).toEqual(['i1', 'i2']);
  });

  it('can require every item to be decided first', async () => {
    const { session } = testSession({ policy: { requireAllItemsDecided: true } });
    const { proposal } = await session.submit(crmInput());
    const error = await expectError(
      () => session.approve(proposal.id, { itemIds: [proposal.items[0]!.id] }),
      'E_ITEM_POLICY',
    );
    expect(error.details.pendingItemIds).toHaveLength(2);
  });

  it('bulk-rejects items and refuses to approve nothing', async () => {
    const { session, proposal } = await submitted();
    await session.setItemStatus(proposal.id, proposal.items.map((item) => item.id), 'rejected');
    const error = await expectError(() => session.approve(proposal.id), 'E_ITEM_POLICY');
    expect(error.hint).toMatch(/rejected or invalidated/);
  });
});

describe('execution (PRD 12.3, 20)', () => {
  it('hands the host exactly the approved payload', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);
    const request = await session.requestExecution(decision.id);

    expect(request.payloadHash).toBe(decision.approvedContentHash);
    expect(computePayloadHash(request.payload)).toBe(request.payloadHash);
    expect(request.payload.items).toHaveLength(3);
    expect(request.payload.items[0]).toEqual({
      id: proposal.items[0]!.id,
      operation: 'update',
      after: { id: 'c_1', name: 'Alice', priority: 'high' },
    });
    expect((await session.get(proposal.id)).execution?.status).toBe('queued');
  });

  it('never produces a second execution request for one decision', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);
    const first = await session.requestExecution(decision.id);
    const second = await session.requestExecution(decision.id);
    expect(second.id).toBe(first.id);
    expect(second.payloadHash).toBe(first.payloadHash);
  });

  it('de-duplicates a double-clicked approve', async () => {
    const { session, proposal } = await submitted();
    const [a, b] = await Promise.all([session.approve(proposal.id), session.approve(proposal.id)]);
    expect(new Set([a.decision.id, b.decision.id]).size).toBe(1);
    expect((await session.audit(proposal.id)).decisions).toHaveLength(1);
  });

  it('fails closed when the executed parameters do not match the approval', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);
    const request = await session.requestExecution(decision.id);

    const lying = receiptFor(request, {
      executedParamsHash: computePayloadHash({ ...request.payload, items: [] }),
    });
    const error = await expectError(() => session.recordReceipt(lying), 'E_HASH_MISMATCH');
    expect(error.hint).toMatch(/unauthorized|roll back/i);

    const after = await session.get(proposal.id);
    expect(after.execution?.status).toBe('failed');
    expect(after.execution?.hashMismatch).toBe(true);
  });

  it('records a matching receipt with external evidence', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);
    const request = await session.requestExecution(decision.id);
    await session.markExecutionStarted(request.id);

    const { proposal: done, created } = await session.recordReceipt(receiptFor(request));
    expect(created).toBe(true);
    expect(done.execution?.status).toBe('succeeded');
    expect(done.execution?.hashMismatch).toBe(false);
    expect(done.execution?.receiptIds).toEqual(['rcp_1']);

    const audit = await session.audit(proposal.id);
    expect(audit.receipts[0]!.evidence?.[0]!.url).toBe('https://crm.example.com/audit/1');
    expect(audit.receipts[0]!.results?.[0]!.externalRef?.id).toMatch(/^crm_/);
  });

  it('distinguishes succeeded from failed items on partial success', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);
    const request = await session.requestExecution(decision.id);

    const partial = receiptFor(request, {
      status: 'partially_succeeded',
      results: [
        { itemId: request.payload.items[0]!.id, status: 'succeeded', externalRef: { system: 'crm', id: 'crm_1' } },
        {
          itemId: request.payload.items[1]!.id,
          status: 'failed',
          error: { code: 'RATE_LIMIT', message: 'Too many requests', retryable: true },
        },
        { itemId: request.payload.items[2]!.id, status: 'skipped' },
      ],
    });

    const { proposal: done } = await session.recordReceipt(partial);
    expect(done.execution?.status).toBe('partially_succeeded');

    const [receipt] = (await session.audit(proposal.id)).receipts;
    expect(receipt!.results?.filter((r) => r.status === 'succeeded')).toHaveLength(1);
    expect(receipt!.results?.find((r) => r.status === 'failed')?.error?.retryable).toBe(true);
  });

  it('ignores a replayed receipt instead of double-applying it', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);
    const request = await session.requestExecution(decision.id);
    await session.recordReceipt(receiptFor(request));
    const replay = await session.recordReceipt(receiptFor(request));
    expect(replay.created).toBe(false);
    expect((await session.get(proposal.id)).execution?.receiptIds).toEqual(['rcp_1']);
  });

  it('rejects a receipt that echoes the wrong idempotency key', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);
    const request = await session.requestExecution(decision.id);
    await expectError(
      () => session.recordReceipt(receiptFor(request, { idempotencyKey: 'someone-elses-key' })),
      'E_CONTRACT',
    );
  });
});

describe('fail-closed lifecycle (PRD 20)', () => {
  it('will not execute an expired approval', async () => {
    const { session, clock } = testSession();
    const { proposal } = await session.submit(crmInput({ ttlMs: 60_000 }));
    const { decision } = await session.approve(proposal.id);

    clock.advance(120_000);
    const error = await expectError(() => session.requestExecution(decision.id), 'E_EXPIRED');
    expect(error.details.expiresAt).toBe('2026-09-01T10:01:00.000Z');
    expect((await session.get(proposal.id)).status).toBe('expired');
  });

  it('expires lazily on the next interaction and blocks approval', async () => {
    const { session, clock } = testSession();
    const { proposal } = await session.submit(crmInput({ ttlMs: 1000 }));
    clock.advance(5000);
    await expectError(() => session.approve(proposal.id), 'E_EXPIRED');
    expect((await session.get(proposal.id)).status).toBe('expired');
  });

  it('will not execute a cancelled proposal', async () => {
    const { session, proposal } = await submitted();
    const { decision } = await session.approve(proposal.id);
    await session.cancel(proposal.id, { reason: 'campaign pulled' });
    await expectError(() => session.requestExecution(decision.id), 'E_NOT_EXECUTABLE');
  });

  it('sweeps a queue of overdue proposals', async () => {
    const { session, clock } = testSession();
    await session.submit(crmInput({ idempotencyKey: 'a', ttlMs: 1000 }));
    await session.submit(crmInput({ idempotencyKey: 'b', ttlMs: 10 ** 7 }));
    clock.advance(5000);
    expect(await session.sweepExpired()).toHaveLength(1);
  });
});

describe('audit trail and events (PRD 11.3)', () => {
  it('emits the documented lifecycle events, payload-free', async () => {
    const seen: ReviewEvent[] = [];
    const { session } = testSession({ onEvent: (event) => void seen.push(event) });
    const { proposal } = await session.submit(crmInput());
    const { decision } = await session.approve(proposal.id);
    const request = await session.requestExecution(decision.id);
    await session.markExecutionStarted(request.id);
    await session.recordReceipt(receiptFor(request));

    expect(seen.map((event) => event.name)).toEqual([
      'proposal.submitted',
      'review.started',
      'decision.approved',
      'execution.requested',
      'execution.started',
      'execution.completed',
    ]);

    const serialized = JSON.stringify(seen);
    expect(serialized).not.toContain('Alice');
    expect(serialized).not.toContain('priority');
    for (const event of seen) {
      expect(event.proposalId).toBe(proposal.id);
      expect(event.proposalVersion).toBe(1);
    }
  });

  it('keeps every revision, decision and receipt for the audit trail', async () => {
    const { session, proposal } = await submitted();
    await session.editItem(proposal.id, { itemId: proposal.items[0]!.id, after: { id: 'c_1', priority: 'medium' } });
    const { decision } = await session.approve(proposal.id);
    const request = await session.requestExecution(decision.id);
    await session.recordReceipt(receiptFor(request));

    const audit = await session.audit(proposal.id);
    expect(audit.revisions).toHaveLength(1);
    expect(audit.revisions[0]!.version).toBe(1);
    expect(audit.decisions).toHaveLength(1);
    expect(audit.receipts).toHaveLength(1);
    expect(audit.events.map((event) => event.name)).toContain('proposal.revised');
    expect(audit.proposal.origin.initiatedBy.id).toBe(AGENT.id);
    expect(audit.decisions[0]!.reviewer.id).toBe(REVIEWER.id);
  });

  it('requires a reviewer identity but never authenticates it', async () => {
    const { session } = testSession({ defaultReviewer: undefined });
    const { proposal } = await session.submit(crmInput());
    await expectError(() => session.approve(proposal.id), 'E_CONTRACT');
    const { decision } = await session.approve(proposal.id, { reviewer: { id: 'u_9', kind: 'user' } });
    expect(decision.reviewer.id).toBe('u_9');
  });
});
