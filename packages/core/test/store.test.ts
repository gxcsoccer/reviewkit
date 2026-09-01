// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createLocalStorageStore,
  createMemoryAdapter,
  createMemoryStore,
  createKeyValueStore,
  createProposal,
  createWebStorageAdapter,
  type ActionProposal,
  type KeyValueAdapter,
  type ReviewStore,
} from '@reviewkit/core';
import { crmInput, expectError, testSession } from './helpers.js';

const proposalWith = (overrides: Parameters<typeof crmInput>[0] = {}): ActionProposal =>
  createProposal(crmInput(overrides));

describe('key/value store contract', () => {
  it('assigns a monotonic seq per proposal', async () => {
    const store = createMemoryStore();
    const proposal = proposalWith();

    const first = await store.putProposal(proposal);
    expect(first.seq).toBe(1);
    const second = await store.putProposal({ ...proposal, summary: 'edited' });
    expect(second.seq).toBe(2);
    expect((await store.getProposal(proposal.id))?.seq).toBe(2);
    expect(await store.getProposal('act_missing')).toBeNull();
  });

  it('rejects a stale write with an actionable conflict (PRD 8: optimistic locking)', async () => {
    const store = createMemoryStore();
    const proposal = proposalWith();
    await store.putProposal(proposal);
    await store.putProposal({ ...proposal, summary: 'someone else wrote' });

    const error = await expectError(
      () => store.putProposal({ ...proposal, summary: 'my stale write' }, { expectedSeq: 1 }),
      'E_VERSION_CONFLICT',
    );
    expect(error.details).toMatchObject({ expectedSeq: 1, actualSeq: 2, currentStatus: 'pending_review' });
  });

  it('supports create-only writes with expectedSeq: null', async () => {
    const store = createMemoryStore();
    const proposal = proposalWith();
    await store.putProposal(proposal, { expectedSeq: null });
    const error = await expectError(() => store.putProposal(proposal, { expectedSeq: null }), 'E_VERSION_CONFLICT');
    expect(error.message).toMatch(/already exists/);
  });

  it('filters, searches, sorts and pages the list', async () => {
    const store = createMemoryStore();
    await store.putProposal(
      createProposal({ ...crmInput(), id: 'act_low', risk: { level: 'low' }, createdAt: '2026-09-01T09:00:00.000Z' }),
    );
    await store.putProposal(
      createProposal({
        ...crmInput(),
        id: 'act_high',
        risk: { level: 'high' },
        createdAt: '2026-09-01T10:00:00.000Z',
        summary: 'Delete stale invoices',
        type: 'billing.invoice.delete',
      }),
    );
    await store.putProposal(
      createProposal({
        ...crmInput(),
        id: 'act_crit',
        risk: { level: 'critical' },
        createdAt: '2026-09-01T11:00:00.000Z',
      }),
    );

    // Default sort: highest risk first — the list exists to surface risk.
    const all = await store.listProposals();
    expect(all.items.map((r) => r.proposal.id)).toEqual(['act_crit', 'act_high', 'act_low']);
    expect(all.total).toBe(3);

    expect((await store.listProposals({ sort: 'createdAt' })).items.map((r) => r.proposal.id)).toEqual([
      'act_low',
      'act_high',
      'act_crit',
    ]);
    expect((await store.listProposals({ riskLevel: ['high', 'critical'] })).total).toBe(2);
    expect((await store.listProposals({ type: ['billing.invoice.delete'] })).items[0]?.proposal.id).toBe('act_high');
    expect((await store.listProposals({ search: 'INVOICES' })).items[0]?.proposal.id).toBe('act_high');
    expect((await store.listProposals({ status: ['approved'] })).total).toBe(0);

    const page = await store.listProposals({ limit: 2, offset: 1, sort: 'createdAt' });
    expect(page.items.map((r) => r.proposal.id)).toEqual(['act_high', 'act_crit']);
    expect(page.total).toBe(3);
  });

  it('finds proposals due to expire and ignores ones with no deadline', async () => {
    const store = createMemoryStore();
    await store.putProposal(createProposal({ ...crmInput(), id: 'act_soon', expiresAt: '2026-09-01T10:00:00.000Z' }));
    await store.putProposal(createProposal({ ...crmInput(), id: 'act_later', expiresAt: '2026-09-02T10:00:00.000Z' }));
    await store.putProposal(createProposal({ ...crmInput(), id: 'act_forever' }));

    const due = await store.listProposals({ expiresBefore: '2026-09-01T12:00:00.000Z' });
    expect(due.items.map((r) => r.proposal.id)).toEqual(['act_soon']);
  });

  it('keeps revisions ordered by version, even past nine', async () => {
    const store = createMemoryStore();
    const base = proposalWith();
    for (const version of [1, 2, 9, 10, 11]) {
      await store.putRevision({ ...base, version });
    }
    expect((await store.listRevisions(base.id)).map((p) => p.version)).toEqual([1, 2, 9, 10, 11]);
    expect(await store.listRevisions('act_other')).toEqual([]);
  });

  it('scopes decisions, requests, receipts and events to their proposal', async () => {
    const { session, clock } = testSession();
    const { proposal } = await session.submit(crmInput());
    const { decision } = await session.approve(proposal.id);
    const request = await session.requestExecution(decision.id);
    const store = session.store;

    expect((await store.listDecisions(proposal.id)).map((d) => d.id)).toEqual([decision.id]);
    expect(await store.listDecisions('act_other')).toEqual([]);
    expect(await store.getDecision(decision.id)).toMatchObject({ kind: 'approve' });
    expect(await store.findExecutionRequest(request.idempotencyKey)).toMatchObject({ id: request.id });
    expect(await store.findExecutionRequest('nope')).toBeNull();

    await store.putReceipt({
      schemaVersion: '0.1',
      id: 'rcp_1',
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      decisionId: decision.id,
      requestId: request.id,
      idempotencyKey: request.idempotencyKey,
      executedParamsHash: request.payloadHash,
      status: 'succeeded',
      startedAt: clock.iso(),
      finishedAt: clock.iso(),
      results: [],
    });
    expect((await store.listReceipts(proposal.id)).map((r) => r.id)).toEqual(['rcp_1']);
    expect(await store.listReceipts('act_other')).toEqual([]);

    const events = await store.listEvents(proposal.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.proposalId === proposal.id)).toBe(true);
  });

  it('appends events in emit order past the 9-event boundary', async () => {
    const store = createMemoryStore();
    const ids = Array.from({ length: 12 }, (_, i) => `evt_${i + 1}`);
    for (const id of ids) {
      await store.appendEvent({
        id,
        name: 'items.updated',
        at: '2026-09-01T10:00:00.000Z',
        proposalId: 'act_1',
        proposalVersion: 1,
        contentHash: `sha256:${'0'.repeat(64)}`,
        data: {},
      });
    }
    expect((await store.listEvents('act_1')).map((e) => e.id)).toEqual(ids);
  });

  it('creates an idempotency record exactly once per scope and key', async () => {
    const store = createMemoryStore();
    expect(await store.putOnce('submit', 'k1', 'first')).toEqual({ created: true, value: 'first' });
    expect(await store.putOnce('submit', 'k1', 'second')).toEqual({ created: false, value: 'first' });
    // Different scopes are independent.
    expect(await store.putOnce('approve', 'k1', 'other')).toEqual({ created: true, value: 'other' });
    expect(await store.getOnce('submit', 'k1')).toBe('first');
    expect(await store.getOnce('submit', 'missing')).toBeNull();
  });

  it('deletes and clears', async () => {
    const store = createMemoryStore();
    const proposal = proposalWith();
    await store.putProposal(proposal);
    await store.deleteProposal(proposal.id);
    expect(await store.getProposal(proposal.id)).toBeNull();

    await store.putProposal(proposal);
    await store.putOnce('submit', 'k', 1);
    await store.clear?.();
    expect((await store.listProposals()).total).toBe(0);
    expect(await store.getOnce('submit', 'k')).toBeNull();
  });

  it('reports corrupt stored data as E_STORE instead of a raw SyntaxError', async () => {
    const backing = new Map<string, string>([['rk:p:act_x', 'not json{']]);
    const store = createKeyValueStore(createMemoryAdapter(backing));
    const error = await expectError(() => store.getProposal('act_x'), 'E_STORE');
    expect(error.hint).toMatch(/Clear the namespace/);
  });

  it('awaits an async adapter, so a host store may hit the network', async () => {
    const map = new Map<string, string>();
    const slow: KeyValueAdapter = {
      get: async (key) => {
        await Promise.resolve();
        return map.get(key) ?? null;
      },
      set: async (key, value) => {
        await Promise.resolve();
        map.set(key, value);
      },
      delete: async (key) => {
        map.delete(key);
      },
      keys: async (prefix) => [...map.keys()].filter((key) => key.startsWith(prefix)),
    };

    const store: ReviewStore = createKeyValueStore(slow);
    const { session } = testSession({ store });
    const { proposal } = await session.submit(crmInput());
    const { decision } = await session.approve(proposal.id);
    expect(decision.proposalId).toBe(proposal.id);
    expect((await store.listProposals()).total).toBe(1);
  });
});

describe('browser local state (PRD 9.1, 13: survives a refresh)', () => {
  it('keeps review state across a reload of the same origin', async () => {
    window.localStorage.clear();

    const first = testSession({ store: createLocalStorageStore({ namespace: 'rk-test' }) });
    const { proposal } = await first.session.submit(crmInput());
    await first.session.setItemStatus(proposal.id, ['c_1'], 'approved');

    // A new session over the same storage = the page was refreshed.
    const second = testSession({ store: createLocalStorageStore({ namespace: 'rk-test' }) });
    const reloaded = await second.session.get(proposal.id);
    expect(reloaded.status).toBe('reviewing');
    expect(reloaded.items.find((item) => item.id === 'c_1')?.status).toBe('approved');
    expect(reloaded.contentHash).toBe(proposal.contentHash);

    // …and the audit trail is still there.
    const audit = await second.session.audit(proposal.id);
    expect(audit.events.map((event) => event.name)).toEqual([
      'proposal.submitted',
      'review.started',
      'items.updated',
    ]);
  });

  it('namespaces keys so two apps can share an origin', async () => {
    window.localStorage.clear();
    const a = testSession({ store: createLocalStorageStore({ namespace: 'app-a' }) });
    const b = testSession({ store: createLocalStorageStore({ namespace: 'app-b' }) });

    const { proposal } = await a.session.submit(crmInput());
    expect(await b.session.tryGet(proposal.id)).toBeNull();
    expect([...Object.keys(window.localStorage)].some((key) => key.startsWith('app-a:rk:p:'))).toBe(true);
  });

  it('works over sessionStorage', async () => {
    const store = createLocalStorageStore({ storage: window.sessionStorage, namespace: 'rk-session' });
    const { session } = testSession({ store });
    const { proposal } = await session.submit(crmInput());
    expect(await session.tryGet(proposal.id)).not.toBeNull();
  });

  it('points a server-side caller at createMemoryStore() when Web Storage is absent', async () => {
    vi.stubGlobal('localStorage', undefined);
    try {
      const error = await expectError(() => createWebStorageAdapter(), 'E_STORE');
      expect(error.hint).toMatch(/createMemoryStore/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('turns a quota failure into E_STORE with a hint about payload size', async () => {
    const full: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => null,
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      },
    };

    const store = createLocalStorageStore({ storage: full });
    const error = await expectError(() => store.putProposal(proposalWith()), 'E_STORE');
    expect(error.message).toContain('QuotaExceededError');
    expect(error.hint).toMatch(/quota/i);
    expect(error.details.bytes).toBeGreaterThan(0);
  });
});

describe('storage is replaceable by a host (PRD 9.1)', () => {
  it('drives a full review through a 4-method adapter written by a host', async () => {
    const rows = new Map<string, string>();
    let writes = 0;
    const hostAdapter: KeyValueAdapter = {
      get: (key) => rows.get(key) ?? null,
      set: (key, value) => {
        writes += 1;
        rows.set(key, value);
      },
      delete: (key) => void rows.delete(key),
      keys: (prefix) => [...rows.keys()].filter((key) => key.startsWith(prefix)),
    };

    const { session } = testSession({ store: createKeyValueStore(hostAdapter) });
    const { proposal } = await session.submit(crmInput());
    const { decision } = await session.approve(proposal.id);
    const request = await session.requestExecution(decision.id);

    expect(request.payloadHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(writes).toBeGreaterThan(0);
    // Nothing left the process: every byte is in the host's own map.
    expect([...rows.keys()].every((key) => key.startsWith('rk:'))).toBe(true);
  });
});
