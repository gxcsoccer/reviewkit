/**
 * Hooks over a headless `ReviewSession`.
 *
 * The session is the source of truth; hooks only mirror it into React state and
 * re-read after every emitted event, so two components showing the same proposal
 * never disagree. Nothing here holds a derived copy of a proposal across an edit —
 * an edit produces a new version, and the next read returns it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  isReviewKitError,
  type ActionProposal,
  type AuditTrail,
  type ExecutionRequest,
  type ItemEdit,
  type ProposalInput,
  type ProposalQuery,
  type ReviewDecision,
  type ReviewEvent,
  type ReviewSession,
  type SourceSnapshot,
  type StoredProposal,
} from '@reviewkit/core';

/** Anything the UI can show in an error banner. */
export interface UiError {
  code: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
  docs?: string;
}

export function toUiError(error: unknown): UiError {
  if (isReviewKitError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
      details: error.details,
      docs: error.docs,
    };
  }
  if (error instanceof Error) return { code: 'E_UNKNOWN', message: error.message };
  return { code: 'E_UNKNOWN', message: String(error) };
}

/* ------------------------------------------------------------------ *
 * Live reads
 * ------------------------------------------------------------------ */

export interface ProposalState {
  record: StoredProposal | null;
  proposal: ActionProposal | null;
  loading: boolean;
  error: UiError | null;
  reload: () => Promise<void>;
}

/**
 * One proposal, kept in sync with the session. Re-reads on every event for that
 * proposal id, which also covers changes made by other components or by the host.
 */
export function useProposal(session: ReviewSession, proposalId: string | undefined): ProposalState {
  const [record, setRecord] = useState<StoredProposal | null>(null);
  const [loading, setLoading] = useState(Boolean(proposalId));
  const [error, setError] = useState<UiError | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!proposalId) {
      setRecord(null);
      setLoading(false);
      return;
    }
    try {
      const next = await session.store.getProposal(proposalId);
      if (!alive.current) return;
      setRecord(next);
      setError(null);
    } catch (cause) {
      if (alive.current) setError(toUiError(cause));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [session, proposalId]);

  useEffect(() => {
    setLoading(Boolean(proposalId));
    void reload();
    if (!proposalId) return;
    return session.on('*', (event) => {
      if (event.proposalId === proposalId) void reload();
    });
  }, [session, proposalId, reload]);

  return { record, proposal: record?.proposal ?? null, loading, error, reload };
}

export interface ProposalListState {
  items: StoredProposal[];
  total: number;
  loading: boolean;
  error: UiError | null;
  reload: () => Promise<void>;
}

/** A queried page of proposals, refreshed on any session event. */
export function useProposalList(session: ReviewSession, query?: ProposalQuery): ProposalListState {
  const [items, setItems] = useState<StoredProposal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UiError | null>(null);
  const alive = useRef(true);
  // Queries are usually inline object literals; compare by value, not identity.
  const queryKey = JSON.stringify(query ?? {});

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const page = await session.list(JSON.parse(queryKey) as ProposalQuery);
      if (!alive.current) return;
      setItems(page.items);
      setTotal(page.total);
      setError(null);
    } catch (cause) {
      if (alive.current) setError(toUiError(cause));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [session, queryKey]);

  useEffect(() => {
    void reload();
    return session.on('*', () => void reload());
  }, [session, reload]);

  return { items, total, loading, error, reload };
}

export interface AuditState {
  audit: AuditTrail | null;
  loading: boolean;
  error: UiError | null;
  reload: () => Promise<void>;
}

/**
 * Decisions, revisions, receipts and events for one proposal — what the detail view
 * needs to show execution truth and the "which version was approved" trail.
 */
export function useAudit(session: ReviewSession, proposalId: string | undefined): AuditState {
  const [audit, setAudit] = useState<AuditTrail | null>(null);
  const [loading, setLoading] = useState(Boolean(proposalId));
  const [error, setError] = useState<UiError | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!proposalId) {
      setAudit(null);
      setLoading(false);
      return;
    }
    try {
      const next = await session.audit(proposalId);
      if (!alive.current) return;
      setAudit(next);
      setError(null);
    } catch (cause) {
      if (alive.current) {
        setAudit(null);
        setError(toUiError(cause));
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [session, proposalId]);

  useEffect(() => {
    void reload();
    if (!proposalId) return;
    return session.on('*', (event) => {
      if (event.proposalId === proposalId) void reload();
    });
  }, [session, proposalId, reload]);

  return { audit, loading, error, reload };
}

/** Session events, newest last, for timelines and host-side logging. */
export function useReviewEvents(session: ReviewSession, limit = 50): ReviewEvent[] {
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  useEffect(() => {
    return session.on('*', (event) => {
      setEvents((previous) => [...previous, event].slice(-limit));
    });
  }, [session, limit]);
  return events;
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export interface ReviewActionCallbacks {
  onDecision?: (decision: ReviewDecision, proposal: ActionProposal) => void | Promise<void>;
  onRevised?: (proposal: ActionProposal, previousVersion: number) => void | Promise<void>;
  onError?: (error: UiError) => void;
}

export interface ApproveArgs {
  itemIds?: string[];
  note?: string;
  tags?: string[];
  acknowledgeHighRisk?: boolean;
}

export interface ReviewActions {
  startReview: () => Promise<void>;
  setItemStatus: (itemIds: string[], status: 'pending' | 'approved' | 'rejected') => Promise<void>;
  editItem: (edit: ItemEdit) => Promise<ActionProposal | null>;
  approve: (args?: ApproveArgs) => Promise<ReviewDecision | null>;
  reject: (reason?: { tags?: string[]; note?: string }) => Promise<ReviewDecision | null>;
  defer: (args?: { until?: string; note?: string }) => Promise<ReviewDecision | null>;
  requestChanges: (reason?: { tags?: string[]; note?: string }) => Promise<void>;
  refreshSource: (snapshots: readonly SourceSnapshot[]) => Promise<void>;
  /** Resolves to the fail-closed payload to hand the host, or null if it was refused. */
  requestExecution: (decisionId: string) => Promise<ExecutionRequest | null>;
  /** True while any action is in flight — disable buttons on this. */
  pending: boolean;
  error: UiError | null;
  clearError: () => void;
}

/**
 * Wraps session mutations with pending/error state and host callbacks. Every
 * action swallows the throw and surfaces a `UiError` instead: a refused approval
 * is an expected outcome in a review UI, not a crash.
 */
export function useReviewActions(
  session: ReviewSession,
  proposalId: string | undefined,
  callbacks: ReviewActionCallbacks = {},
): ReviewActions {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const handlers = useRef(callbacks);
  handlers.current = callbacks;

  const run = useCallback(
    async <T>(work: (id: string) => Promise<T>): Promise<T | null> => {
      if (!proposalId) return null;
      setPending(true);
      setError(null);
      try {
        return await work(proposalId);
      } catch (cause) {
        const uiError = toUiError(cause);
        setError(uiError);
        handlers.current.onError?.(uiError);
        return null;
      } finally {
        setPending(false);
      }
    },
    [proposalId],
  );

  const actions = useMemo<ReviewActions>(
    () => ({
      pending,
      error,
      clearError: () => setError(null),

      startReview: async () => {
        await run((id) => session.startReview(id));
      },

      setItemStatus: async (itemIds, status) => {
        await run((id) => session.setItemStatus(id, itemIds, status));
      },

      editItem: async (edit) => {
        const result = await run((id) => session.editItem(id, edit));
        if (result) {
          await handlers.current.onRevised?.(result.proposal, result.previousVersion);
          return result.proposal;
        }
        return null;
      },

      approve: async (args = {}) => {
        const result = await run((id) =>
          session.approve(id, {
            ...(args.itemIds ? { itemIds: args.itemIds } : {}),
            ...(args.note ? { note: args.note } : {}),
            ...(args.tags ? { tags: args.tags } : {}),
            ...(args.acknowledgeHighRisk ? { acknowledgeHighRisk: true } : {}),
          }),
        );
        if (!result) return null;
        await handlers.current.onDecision?.(result.decision, result.proposal);
        return result.decision;
      },

      reject: async (reason) => {
        const result = await run((id) => session.reject(id, reason ? { reason } : {}));
        if (!result) return null;
        await handlers.current.onDecision?.(result.decision, result.proposal);
        return result.decision;
      },

      defer: async (args = {}) => {
        const result = await run((id) =>
          session.defer(id, {
            ...(args.until ? { until: args.until } : {}),
            ...(args.note ? { note: args.note } : {}),
          }),
        );
        if (!result) return null;
        await handlers.current.onDecision?.(result.decision, result.proposal);
        return result.decision;
      },

      requestChanges: async (reason) => {
        await run((id) => session.requestChanges(id, reason ? { reason } : {}));
      },

      refreshSource: async (snapshots) => {
        await run((id) => session.refreshSource(id, snapshots));
      },

      requestExecution: (decisionId) => run(() => session.requestExecution(decisionId)),
    }),
    [session, run, pending, error],
  );

  return actions;
}

/* ------------------------------------------------------------------ *
 * Standalone bootstrap
 * ------------------------------------------------------------------ */

/**
 * Submits `input` into `session` once and returns its id.
 *
 * Already-normalized proposals and inputs carrying an `idempotencyKey` are
 * deduplicated by the session, so a StrictMode double-effect or a re-render with a
 * fresh object literal cannot create a second proposal.
 */
export function useSubmittedProposal(
  session: ReviewSession,
  input: ProposalInput | ActionProposal | undefined,
): { proposalId: string | undefined; error: UiError | null } {
  const [proposalId, setProposalId] = useState<string | undefined>(
    input && 'contentHash' in input && input.id ? input.id : undefined,
  );
  const [error, setError] = useState<UiError | null>(null);
  // Identity that must change before we submit again. Object identity is not it:
  // callers pass literals.
  const identity = input ? (input.id ?? input.idempotencyKey ?? `${input.type}:${input.items?.length ?? 0}`) : '';

  useEffect(() => {
    if (!input) {
      setProposalId(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { proposal } = await session.submit(input);
        if (!cancelled) {
          setProposalId(proposal.id);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(toUiError(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `identity`, not object identity
  }, [session, identity]);

  return { proposalId, error };
}

/* ------------------------------------------------------------------ *
 * Selection and announcements
 * ------------------------------------------------------------------ */

export interface Selection {
  selected: readonly string[];
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  set: (ids: readonly string[]) => void;
  selectAll: () => void;
  clear: () => void;
  allSelected: boolean;
  count: number;
}

/** Bulk selection over a stable id list. Ids that disappear are dropped. */
export function useSelection(ids: readonly string[]): Selection {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const key = ids.join('\u0000');

  useEffect(() => {
    const present = new Set(key.split('\u0000'));
    setSelected((previous) => {
      const next = previous.filter((id) => present.has(id));
      return next.length === previous.length ? previous : next;
    });
  }, [key]);

  return useMemo(() => {
    const set = new Set(selected);
    return {
      selected,
      count: selected.length,
      allSelected: ids.length > 0 && ids.every((id) => set.has(id)),
      has: (id: string) => set.has(id),
      toggle: (id: string) =>
        setSelected((previous) => (previous.includes(id) ? previous.filter((x) => x !== id) : [...previous, id])),
      set: (next: readonly string[]) => setSelected([...next]),
      selectAll: () => setSelected([...ids]),
      clear: () => setSelected([]),
    };
  }, [selected, ids]);
}

/**
 * Polite live-region text. Components render `<div role="status" aria-live="polite">`
 * with `message`, so screen readers hear the outcome of a decision (PRD 9.1 a11y).
 */
export function useAnnouncer(): { message: string; announce: (message: string) => void } {
  const [message, setMessage] = useState('');
  const announce = useCallback((next: string) => {
    // Re-announce identical text by briefly clearing the region.
    setMessage((previous) => (previous === next ? `${next}\u200b` : next));
  }, []);
  return { message, announce };
}

/**
 * Roving keyboard focus over a list (PRD 9.1: "keyboard operation").
 * `j`/`k` and the arrow keys move; the caller decides what focus means.
 */
export function useRovingIndex(length: number): {
  index: number;
  setIndex: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
} {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex((previous) => (previous >= length ? Math.max(0, length - 1) : previous));
  }, [length]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>): boolean => {
      const key = event.key;
      if (key === 'ArrowDown' || key === 'j') {
        setIndex((previous) => Math.min(length - 1, previous + 1));
        return true;
      }
      if (key === 'ArrowUp' || key === 'k') {
        setIndex((previous) => Math.max(0, previous - 1));
        return true;
      }
      if (key === 'Home') {
        setIndex(0);
        return true;
      }
      if (key === 'End') {
        setIndex(Math.max(0, length - 1));
        return true;
      }
      return false;
    },
    [length],
  );

  return { index, setIndex, onKeyDown };
}
