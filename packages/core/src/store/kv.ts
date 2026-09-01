/**
 * Generic {@link ReviewStore} over a 4-method key/value adapter.
 *
 * Powers the in-memory store, the localStorage store, and any host store that can
 * do `get/set/delete/keys`. Filtering and sorting happen in memory, which is the
 * right trade-off at v0.1 scale (500 items per proposal, PRD 13); a host with a
 * real database should implement `ReviewStore` directly instead.
 */
import { ReviewKitError } from '../errors.js';
import { RISK_ORDER, type ActionProposal, type ExecutionReceipt, type ExecutionRequest, type JsonValue, type ReviewDecision, type ReviewEvent } from '../types.js';
import type {
  KeyValueAdapter,
  ProposalPage,
  ProposalQuery,
  PutProposalOptions,
  ReviewStore,
  StoredProposal,
} from './types.js';

const KEY = {
  proposal: (id: string) => `rk:p:${id}`,
  proposalPrefix: 'rk:p:',
  revision: (id: string, version: number) => `rk:rev:${id}:${String(version).padStart(6, '0')}`,
  revisionPrefix: (id: string) => `rk:rev:${id}:`,
  decision: (id: string) => `rk:d:${id}`,
  decisionPrefix: 'rk:d:',
  request: (id: string) => `rk:x:${id}`,
  requestPrefix: 'rk:x:',
  receipt: (id: string) => `rk:r:${id}`,
  receiptPrefix: 'rk:r:',
  event: (proposalId: string, seq: string) => `rk:e:${proposalId}:${seq}`,
  eventPrefix: (proposalId: string) => `rk:e:${proposalId}:`,
  once: (scope: string, key: string) => `rk:once:${scope}:${key}`,
  all: 'rk:',
};

function parse<T>(raw: string | null, what: string, key: string): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new ReviewKitError({
      code: 'E_STORE',
      message: `Stored ${what} at ${key} is not valid JSON`,
      hint: 'The backing store contains data written by a different version or another app. Clear the namespace and retry.',
      details: { key },
      cause: error,
    });
  }
}

function matchesQuery(proposal: ActionProposal, query: ProposalQuery): boolean {
  if (query.status && !query.status.includes(proposal.status)) return false;
  if (query.riskLevel && !query.riskLevel.includes(proposal.risk.level)) return false;
  if (query.type && !query.type.includes(proposal.type)) return false;
  if (query.subjectType && !query.subjectType.includes(proposal.subject.type)) return false;
  if (query.expiresBefore) {
    if (!proposal.expiresAt) return false;
    if (Date.parse(proposal.expiresAt) > Date.parse(query.expiresBefore)) return false;
  }
  if (query.search) {
    const needle = query.search.toLowerCase();
    const haystack = [proposal.id, proposal.summary, proposal.type, proposal.subject.label ?? '']
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function compare(a: ActionProposal, b: ActionProposal, sort: ProposalQuery['sort']): number {
  const created = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  const risk = RISK_ORDER.indexOf(a.risk.level) - RISK_ORDER.indexOf(b.risk.level);
  switch (sort) {
    case 'createdAt':
      return created;
    case '-createdAt':
      return -created;
    case 'risk':
      return risk || created;
    case 'expiresAt': {
      const ax = a.expiresAt ? Date.parse(a.expiresAt) : Number.POSITIVE_INFINITY;
      const bx = b.expiresAt ? Date.parse(b.expiresAt) : Number.POSITIVE_INFINITY;
      return ax - bx || created;
    }
    case '-risk':
    default:
      // Highest risk first, then oldest — PRD 10.1: the list exists to surface risk.
      return -risk || created;
  }
}

export function createKeyValueStore(adapter: KeyValueAdapter): ReviewStore {
  const readJson = async <T>(key: string, what: string): Promise<T | null> =>
    parse<T>(await adapter.get(key), what, key);

  const readAll = async <T>(prefix: string, what: string): Promise<T[]> => {
    const keys = await adapter.keys(prefix);
    const out: T[] = [];
    for (const key of [...keys].sort()) {
      const value = await readJson<T>(key, what);
      if (value !== null) out.push(value);
    }
    return out;
  };

  return {
    async getProposal(id) {
      return readJson<StoredProposal>(KEY.proposal(id), 'proposal');
    },

    async putProposal(proposal, options: PutProposalOptions = {}) {
      const key = KEY.proposal(proposal.id);
      const current = await readJson<StoredProposal>(key, 'proposal');

      if (options.expectedSeq !== undefined) {
        const actual = current?.seq ?? null;
        if (options.expectedSeq !== actual) {
          throw new ReviewKitError({
            code: 'E_VERSION_CONFLICT',
            message:
              options.expectedSeq === null
                ? `Proposal ${proposal.id} already exists`
                : `Proposal ${proposal.id} was modified by someone else (expected seq ${options.expectedSeq}, found ${String(actual)})`,
            hint: 'Re-read the proposal, show the reviewer what changed, and ask them to confirm again (PRD 8: optimistic locking).',
            details: {
              proposalId: proposal.id,
              expectedSeq: options.expectedSeq,
              actualSeq: actual,
              currentVersion: current?.proposal.version,
              currentStatus: current?.proposal.status,
            },
          });
        }
      }

      const record: StoredProposal = { proposal, seq: (current?.seq ?? 0) + 1 };
      await adapter.set(key, JSON.stringify(record));
      return record;
    },

    async listProposals(query = {}) {
      const records = await readAll<StoredProposal>(KEY.proposalPrefix, 'proposal');
      const matched = records.filter((record) => matchesQuery(record.proposal, query));
      matched.sort((a, b) => compare(a.proposal, b.proposal, query.sort));
      const offset = query.offset ?? 0;
      const limit = query.limit ?? matched.length;
      return { items: matched.slice(offset, offset + limit), total: matched.length } satisfies ProposalPage;
    },

    async deleteProposal(id) {
      await adapter.delete(KEY.proposal(id));
    },

    async putRevision(proposal) {
      await adapter.set(KEY.revision(proposal.id, proposal.version), JSON.stringify(proposal));
    },

    async listRevisions(proposalId) {
      return readAll<ActionProposal>(KEY.revisionPrefix(proposalId), 'revision');
    },

    async putDecision(decision) {
      await adapter.set(KEY.decision(decision.id), JSON.stringify(decision));
      return decision;
    },

    async getDecision(id) {
      return readJson<ReviewDecision>(KEY.decision(id), 'decision');
    },

    async listDecisions(proposalId) {
      const all = await readAll<ReviewDecision>(KEY.decisionPrefix, 'decision');
      return all
        .filter((decision) => decision.proposalId === proposalId)
        .sort((a, b) => Date.parse(a.decidedAt) - Date.parse(b.decidedAt));
    },

    async putExecutionRequest(request) {
      await adapter.set(KEY.request(request.id), JSON.stringify(request));
      return request;
    },

    async getExecutionRequest(id) {
      return readJson<ExecutionRequest>(KEY.request(id), 'execution request');
    },

    async findExecutionRequest(idempotencyKey) {
      const all = await readAll<ExecutionRequest>(KEY.requestPrefix, 'execution request');
      return all.find((request) => request.idempotencyKey === idempotencyKey) ?? null;
    },

    async putReceipt(receipt) {
      await adapter.set(KEY.receipt(receipt.id), JSON.stringify(receipt));
      return receipt;
    },

    async getReceipt(id) {
      return readJson<ExecutionReceipt>(KEY.receipt(id), 'receipt');
    },

    async listReceipts(proposalId) {
      const all = await readAll<ExecutionReceipt>(KEY.receiptPrefix, 'receipt');
      return all
        .filter((receipt) => receipt.proposalId === proposalId)
        .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    },

    async appendEvent(event) {
      // Key includes a zero-padded ordinal so `keys()` sorting equals emit order.
      const existing = await adapter.keys(KEY.eventPrefix(event.proposalId));
      const seq = String(existing.length + 1).padStart(6, '0');
      await adapter.set(KEY.event(event.proposalId, `${seq}:${event.id}`), JSON.stringify(event));
    },

    async listEvents(proposalId) {
      return readAll<ReviewEvent>(KEY.eventPrefix(proposalId), 'event');
    },

    async putOnce(scope, key, value) {
      const storeKey = KEY.once(scope, key);
      const existing = await readJson<{ value: JsonValue }>(storeKey, 'idempotency record');
      if (existing !== null) return { created: false, value: existing.value };
      await adapter.set(storeKey, JSON.stringify({ value }));
      return { created: true, value };
    },

    async getOnce(scope, key) {
      const existing = await readJson<{ value: JsonValue }>(KEY.once(scope, key), 'idempotency record');
      return existing === null ? null : existing.value;
    },

    async clear() {
      for (const key of await adapter.keys(KEY.all)) await adapter.delete(key);
    },
  };
}
