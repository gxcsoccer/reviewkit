/**
 * `ActionReview` — the single-proposal review surface (PRD 11.2).
 *
 * Layout follows PRD 10.2 exactly: *what will happen* and *how many objects* come
 * first, then the diff, then the agent's reason and evidence. The raw execution
 * parameters are always one disclosure away; the agent's summary never replaces them.
 *
 * It works two ways:
 *
 * ```tsx
 * // standalone: no provider, no store setup — the 10-minute path from PRD 20
 * <ActionReview proposal={proposal} onDecision={saveDecision} />
 *
 * // shared session (list + detail, host store, custom policy)
 * <ActionReview proposalId={id} />
 * ```
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import {
  analyzeItem,
  createReviewSession,
  isReadOnlyStatus,
  sanitizeText,
  sanitizeUrl,
  type ActionItem,
  type ActionProposal,
  type ExecutionReceipt,
  type ExecutionRequest,
  type Identity,
  type ItemAnalysis,
  type ProposalInput,
  type RedactionPolicy,
  type ReviewDecision,
  type ReviewSession,
} from '@reviewkit/core';
import { useOptionalReviewKit } from '../context.js';
import { createTranslate, en, resolveMessages, type MessageOverrides, type Translate } from '../i18n.js';
import {
  toUiError,
  useAnnouncer,
  useAudit,
  useProposal,
  useReviewActions,
  useRovingIndex,
  useSelection,
  useSubmittedProposal,
  type UiError,
} from '../hooks.js';
import type { DiffRenderer } from '../renderers/index.js';
import { RiskBadge, StatusBadge } from './badges.js';
import { BulkActionBar } from './BulkActionBar.js';
import { DecisionBar } from './DecisionBar.js';
import { ErrorBanner } from './ErrorBanner.js';
import { ExecutionResultPanel } from './ExecutionResultPanel.js';
import { ItemCard } from './ItemCard.js';
import { RawParams } from './RawParams.js';

export interface ActionReviewProps {
  /** A proposal (or the loose input shape) to review. Submitted into the session once. */
  proposal?: ActionProposal | ProposalInput;
  /** Review something already stored in the session. Takes precedence over `proposal`. */
  proposalId?: string;
  /** Defaults to the provider's session, or a private in-memory one. */
  session?: ReviewSession;
  /** Custom renderers, tried before the built-in three. */
  renderers?: readonly DiffRenderer[];
  reviewer?: Identity;
  redaction?: RedactionPolicy;
  locale?: string;
  messages?: MessageOverrides;
  /** Preset rejection reason tags (PRD 10.4). */
  rejectTags?: readonly string[];
  /** Called after every decision, with the decision and the proposal it is bound to. */
  onDecision?: (decision: ReviewDecision, proposal: ActionProposal) => void | Promise<void>;
  /**
   * Hand the fail-closed payload to the host. Return an `ExecutionReceipt` (or a
   * promise of one) and it is recorded, so the result panel shows host truth.
   */
  onRequestExecution?: (
    request: ExecutionRequest,
    decision: ReviewDecision,
  ) => void | ExecutionReceipt | Promise<void | ExecutionReceipt>;
  onRevised?: (proposal: ActionProposal, previousVersion: number) => void | Promise<void>;
  onError?: (error: UiError) => void;
  /** Start in the "all fields" view instead of "only changed fields". */
  defaultView?: 'changes' | 'all';
  /** Hide per-item approve/reject buttons and the selection checkboxes. */
  disableItemDecisions?: boolean;
  className?: string;
}

interface ViewState {
  onlyChanges: boolean;
  onlyHighRisk: boolean;
  onlyProblems: boolean;
  showRaw: boolean;
}

const DECIDABLE_ITEM_STATUSES = new Set(['pending', 'approved', 'edited']);

function isProblem(item: ActionItem): boolean {
  return item.status === 'invalidated' || item.status === 'rejected' || item.invalidation !== undefined;
}

function isHighRisk(item: ActionItem, proposal: ActionProposal): boolean {
  const level = item.risk?.level ?? proposal.risk.level;
  return level === 'high' || level === 'critical';
}

export function ActionReview({
  proposal: input,
  proposalId: providedId,
  session: providedSession,
  renderers,
  reviewer,
  redaction,
  locale,
  messages: overrides,
  rejectTags,
  onDecision,
  onRequestExecution,
  onRevised,
  onError,
  defaultView = 'changes',
  disableItemDecisions = false,
  className,
}: ActionReviewProps): ReactElement {
  const context = useOptionalReviewKit();

  // Standalone mode owns a private in-memory session so the component works with no
  // setup at all (PRD 20: "no cloud service required").
  const ownSession = useMemo(
    () => createReviewSession({ ...(reviewer ? { defaultReviewer: reviewer } : {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once, on purpose
    [],
  );
  const session = providedSession ?? context?.session ?? ownSession;

  const t: Translate = useMemo(() => {
    if (!locale && !overrides && context) return context.t;
    if (!locale && !overrides) return createTranslate(en);
    return createTranslate(resolveMessages(locale ?? context?.locale, overrides));
  }, [locale, overrides, context]);

  const submitted = useSubmittedProposal(session, providedId ? undefined : input);
  const proposalId = providedId ?? submitted.proposalId;

  const { proposal, loading, error: loadError } = useProposal(session, proposalId);
  const { audit } = useAudit(session, proposalId);
  const { message: announcement, announce } = useAnnouncer();
  const [localError, setLocalError] = useState<UiError | null>(null);

  const actions = useReviewActions(session, proposalId, {
    ...(onDecision ? { onDecision } : {}),
    ...(onRevised ? { onRevised } : {}),
    ...(onError ? { onError } : {}),
  });

  const [view, setView] = useState<ViewState>({
    onlyChanges: defaultView === 'changes',
    onlyHighRisk: false,
    onlyProblems: false,
    showRaw: false,
  });
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  /* ---------------- derived ---------------- */

  const items = proposal?.items ?? [];
  const analyses = useMemo(() => {
    const map = new Map<string, ItemAnalysis>();
    for (const item of items) map.set(item.id, analyzeItem(item));
    return map;
    // Recompute when the content changes — a new version means new payloads.
  }, [proposal?.id, proposal?.contentHash, items]);

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (view.onlyHighRisk && proposal && !isHighRisk(item, proposal)) return false;
        if (view.onlyProblems && !isProblem(item)) return false;
        return true;
      }),
    [items, view.onlyHighRisk, view.onlyProblems, proposal],
  );

  const selectableIds = useMemo(
    () => visibleItems.filter((item) => DECIDABLE_ITEM_STATUSES.has(item.status)).map((item) => item.id),
    [visibleItems],
  );
  const selection = useSelection(selectableIds);
  const roving = useRovingIndex(visibleItems.length);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const navigated = useRef(false);
  const started = useRef<string | null>(null);

  const approvableIds = useMemo(
    () => items.filter((item) => DECIDABLE_ITEM_STATUSES.has(item.status)).map((item) => item.id),
    [items],
  );
  const edited = items.some((item) => item.editedFrom !== undefined || item.status === 'edited');
  const readOnly = proposal ? isReadOnlyStatus(proposal.status) : false;
  const expired = proposal?.status === 'expired';
  const invalidated = items.some((item) => item.invalidation !== undefined);

  /** The decision that may still be executed: approving, and bound to this version. */
  const executableDecision = useMemo(() => {
    if (!proposal || !audit) return null;
    const candidates = audit.decisions.filter(
      (decision) =>
        (decision.kind === 'approve' || decision.kind === 'approve_with_edits') &&
        decision.proposalVersion === proposal.version &&
        decision.contentHash === proposal.contentHash,
    );
    return candidates.length > 0 ? (candidates[candidates.length - 1] ?? null) : null;
  }, [proposal, audit]);

  const executionStarted = Boolean(proposal?.execution && proposal.execution.status !== 'not_started');

  /* ---------------- effects ---------------- */

  // Entering the detail view is the "review started" moment (PRD 11.3).
  useEffect(() => {
    if (!proposal || started.current === proposal.id) return;
    if (proposal.status !== 'pending_review') return;
    started.current = proposal.id;
    void actions.startReview();
    // `actions` is recreated on each pending/error change; the ref guard is what
    // keeps this to one call per proposal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal?.id, proposal?.status]);

  // Move DOM focus only after an actual keyboard navigation, never on first paint.
  useEffect(() => {
    if (!navigated.current) return;
    itemRefs.current[roving.index]?.focus();
  }, [roving.index]);

  /* ---------------- handlers ---------------- */

  const announceDecision = useCallback(
    (decision: ReviewDecision | null, count: number, version: number) => {
      if (!decision) return;
      if (decision.kind === 'reject') announce(t('notice.rejected'));
      else if (decision.kind === 'defer') announce(t('notice.deferred'));
      else announce(t('notice.approved', { count, version }));
    },
    [announce, t],
  );

  const approve = useCallback(
    async (itemIds?: string[], options: { acknowledgeHighRisk?: boolean; note?: string } = {}) => {
      if (!proposal) return;
      const decision = await actions.approve({
        ...(itemIds ? { itemIds } : {}),
        ...(options.acknowledgeHighRisk ? { acknowledgeHighRisk: true } : {}),
        ...(options.note ? { note: options.note } : {}),
      });
      announceDecision(decision, itemIds?.length ?? approvableIds.length, proposal.version);
      if (decision) selection.clear();
    },
    [actions, announceDecision, approvableIds.length, proposal, selection],
  );

  const rejectItems = useCallback(
    async (itemIds: string[]) => {
      await actions.setItemStatus(itemIds, 'rejected');
      selection.clear();
    },
    [actions, selection],
  );

  const execute = useCallback(async () => {
    if (!executableDecision) return;
    setLocalError(null);
    const request = await actions.requestExecution(executableDecision.id);
    if (!request) return;
    try {
      const receipt = await onRequestExecution?.(request, executableDecision);
      if (receipt) await session.recordReceipt(receipt);
    } catch (cause) {
      const uiError = toUiError(cause);
      setLocalError(uiError);
      onError?.(uiError);
    }
  }, [actions, executableDecision, onError, onRequestExecution, session]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName ?? '';
    if (target?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (roving.onKeyDown(event)) {
      navigated.current = true;
      event.preventDefault();
      return;
    }

    const focusedItem = visibleItems[roving.index];
    const key = event.key.toLowerCase();

    if ((key === 'x' || event.key === ' ') && focusedItem && selectableIds.includes(focusedItem.id)) {
      selection.toggle(focusedItem.id);
      event.preventDefault();
      return;
    }
    if (key === 'a' && !readOnly) {
      void approve(selection.count > 0 ? [...selection.selected] : undefined);
      event.preventDefault();
      return;
    }
    if (key === 'r' && !readOnly) {
      if (selection.count > 0) void rejectItems([...selection.selected]);
      else void actions.reject();
      event.preventDefault();
      return;
    }
    if (key === 'd' && !readOnly) {
      void actions.defer();
      event.preventDefault();
      return;
    }
    if (key === 'e' && focusedItem && !readOnly) {
      setEditingItemId((previous) => (previous === focusedItem.id ? null : focusedItem.id));
      event.preventDefault();
      return;
    }
    if (key === 'p') {
      setView((previous) => ({ ...previous, showRaw: !previous.showRaw }));
      event.preventDefault();
      return;
    }
    if (event.key === '?') {
      setShowKeyboardHelp((previous) => !previous);
      event.preventDefault();
    }
  };

  /* ---------------- render ---------------- */

  if (!proposal) {
    return (
      <section className={['rk-review', className].filter(Boolean).join(' ')}>
        <ErrorBanner error={submitted.error ?? loadError} t={t} />
        {!submitted.error && !loadError ? (
          <p className="rk-notice rk-notice--muted">{loading ? t('notice.loading') : t('notice.noProposals')}</p>
        ) : null}
      </section>
    );
  }

  const readOnlyReason = expired
    ? t('notice.expired')
    : readOnly
      ? t('notice.readOnly', { status: t(`status.${proposal.status}`) })
      : null;

  const changeCount = [...analyses.values()].reduce((total, analysis) => total + analysis.changeCount, 0);

  return (
    <section
      className={['rk-review', className].filter(Boolean).join(' ')}
      data-rk-proposal-id={proposal.id}
      data-rk-status={proposal.status}
      data-rk-version={proposal.version}
      onKeyDown={onKeyDown}
      aria-label={t('label.proposal')}
    >
      <div className="rk-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {/* PRD 10.2: what will happen, and how many objects — before anything else. */}
      <header className="rk-review__head">
        <div className="rk-review__badges">
          <RiskBadge risk={proposal.risk} showTags t={t} />
          <StatusBadge status={proposal.status} t={t} />
          <code className="rk-review__type">{sanitizeText(proposal.type)}</code>
          {proposal.target.environment ? (
            <span className="rk-tag rk-tag--env">{sanitizeText(proposal.target.environment)}</span>
          ) : null}
        </div>
        <h2 className="rk-review__summary">{sanitizeText(proposal.summary)}</h2>
        <p className="rk-review__impact">
          <strong>{t('label.impact')}:</strong> {proposal.subject.count}{' '}
          {sanitizeText(proposal.subject.label ?? proposal.subject.type)} · {t('label.changes')}: {changeCount} ·{' '}
          {t('label.items')}: {items.length}
        </p>
        <dl className="rk-kv rk-review__meta">
          <div className="rk-kv__pair">
            <dt>{t('label.target')}</dt>
            <dd>
              <code>{sanitizeText([proposal.target.system, proposal.target.resource].filter(Boolean).join('/'))}</code>
            </dd>
          </div>
          <div className="rk-kv__pair">
            <dt>{t('label.initiatedBy')}</dt>
            <dd>{sanitizeText(proposal.origin.initiatedBy.name ?? proposal.origin.initiatedBy.id)}</dd>
          </div>
          <div className="rk-kv__pair">
            <dt>{t('label.created')}</dt>
            <dd>
              <time dateTime={proposal.createdAt}>{proposal.createdAt}</time>
            </dd>
          </div>
          {proposal.expiresAt ? (
            <div className="rk-kv__pair">
              <dt>{t('label.expires')}</dt>
              <dd>
                <time dateTime={proposal.expiresAt}>{proposal.expiresAt}</time>
              </dd>
            </div>
          ) : null}
          <div className="rk-kv__pair">
            <dt>{t('label.version')}</dt>
            <dd>
              v{proposal.version} <code className="rk-hash">{proposal.contentHash}</code>
            </dd>
          </div>
        </dl>
      </header>

      {/* Notices, strongest first. */}
      {edited ? (
        <p className="rk-notice rk-notice--info" role="status" data-rk-notice="edited">
          {t('notice.editedVersion', { version: proposal.version, hash: proposal.contentHash })}
        </p>
      ) : null}
      {invalidated ? (
        <p className="rk-notice rk-notice--warn" role="status" data-rk-notice="source-changed">
          {t('notice.sourceChanged')}
        </p>
      ) : null}
      {readOnlyReason ? (
        <p className="rk-notice rk-notice--muted" role="status" data-rk-notice="read-only">
          {readOnlyReason}
        </p>
      ) : null}

      <ErrorBanner error={actions.error} t={t} onDismiss={actions.clearError} />
      <ErrorBanner error={localError} t={t} onDismiss={() => setLocalError(null)} />

      {/* Views (PRD 10.2). */}
      <div className="rk-review__views" role="group" aria-label={t('label.filters')}>
        <button
          type="button"
          className={`rk-toggle ${view.onlyChanges ? 'rk-toggle--on' : ''}`}
          aria-pressed={view.onlyChanges}
          onClick={() => setView((previous) => ({ ...previous, onlyChanges: !previous.onlyChanges }))}
        >
          {view.onlyChanges ? t('action.onlyChanges') : t('action.allFields')}
        </button>
        <button
          type="button"
          className={`rk-toggle ${view.onlyHighRisk ? 'rk-toggle--on' : ''}`}
          aria-pressed={view.onlyHighRisk}
          onClick={() => setView((previous) => ({ ...previous, onlyHighRisk: !previous.onlyHighRisk }))}
        >
          {t('action.onlyHighRisk')}
        </button>
        <button
          type="button"
          className={`rk-toggle ${view.onlyProblems ? 'rk-toggle--on' : ''}`}
          aria-pressed={view.onlyProblems}
          onClick={() => setView((previous) => ({ ...previous, onlyProblems: !previous.onlyProblems }))}
        >
          {t('action.onlyProblems')}
        </button>
        <button
          type="button"
          className={`rk-toggle ${view.showRaw ? 'rk-toggle--on' : ''}`}
          aria-pressed={view.showRaw}
          onClick={() => setView((previous) => ({ ...previous, showRaw: !previous.showRaw }))}
        >
          {view.showRaw ? t('action.hideRaw') : t('action.showRaw')}
        </button>
      </div>

      {/* The exact payload, always reachable — never only the agent's words. */}
      <RawParams proposal={proposal} redaction={redaction} t={t} defaultOpen={view.showRaw} />

      {items.length === 0 ? (
        <p className="rk-notice rk-notice--muted">{t('notice.noItems')}</p>
      ) : (
        <ol className="rk-items" aria-label={t('a11y.itemList')}>
          {visibleItems.map((item, index) => {
            const analysis = analyses.get(item.id) ?? analyzeItem(item);
            const decidable = !readOnly && !disableItemDecisions && DECIDABLE_ITEM_STATUSES.has(item.status);
            return (
              <ItemCard
                key={item.id}
                proposal={proposal}
                item={item}
                analysis={analysis}
                t={t}
                renderers={renderers}
                redaction={redaction}
                onlyChanges={view.onlyChanges}
                showRaw={view.showRaw}
                pending={actions.pending}
                focused={index === roving.index}
                cardRef={(element) => {
                  itemRefs.current[index] = element;
                }}
                editing={editingItemId === item.id}
                onEditingChange={(editing) => setEditingItemId(editing ? item.id : null)}
                {...(decidable
                  ? {
                      selected: selection.has(item.id),
                      onToggleSelected: () => {
                        navigated.current = false;
                        selection.toggle(item.id);
                      },
                      onApprove: (itemId: string) => void approve([itemId]),
                      onReject: (itemId: string) => void rejectItems([itemId]),
                      onEdit: async (edit) => {
                        const next = await actions.editItem(edit);
                        if (next) announce(t('notice.editedVersion', { version: next.version, hash: next.contentHash }));
                      },
                    }
                  : {})}
              />
            );
          })}
        </ol>
      )}

      {!readOnly && !disableItemDecisions ? (
        <BulkActionBar
          proposal={proposal}
          selected={selection.selected}
          maxBulkRisk={session.policy.bulkApproveMaxRisk}
          pending={actions.pending}
          t={t}
          onApprove={(itemIds, acknowledgeHighRisk) => void approve(itemIds, { acknowledgeHighRisk })}
          onReject={(itemIds) => void rejectItems(itemIds)}
          onClear={selection.clear}
          onReveal={(itemId) => {
            const index = visibleItems.findIndex((item) => item.id === itemId);
            if (index >= 0) {
              navigated.current = true;
              roving.setIndex(index);
            }
          }}
        />
      ) : null}

      {/* Reason and evidence come after the payload, on purpose. */}
      {proposal.reason ? (
        <section className="rk-review__reason">
          <h3 className="rk-h3">{t('label.reason')}</h3>
          <p>{sanitizeText(proposal.reason)}</p>
        </section>
      ) : null}
      {proposal.evidence && proposal.evidence.length > 0 ? (
        <section className="rk-review__evidence">
          <h3 className="rk-h3">{t('label.evidence')}</h3>
          <ul className="rk-evidence__list">
            {proposal.evidence.map((entry, index) => {
              const href = entry.url ? sanitizeUrl(entry.url) : null;
              return (
                <li key={`${entry.label}-${index}`}>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer noopener">
                      {sanitizeText(entry.label)}
                    </a>
                  ) : (
                    sanitizeText(entry.label)
                  )}
                  {entry.ref ? <code className="rk-evidence__ref">{sanitizeText(entry.ref)}</code> : null}
                  {entry.snippet ? <span className="rk-evidence__snippet">{sanitizeText(entry.snippet)}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <DecisionBar
        t={t}
        approvableCount={approvableIds.length}
        edited={edited}
        {...(rejectTags ? { rejectTags } : {})}
        pending={actions.pending}
        disabledReason={readOnlyReason}
        onApprove={({ note }) => void approve(undefined, note ? { note } : {})}
        onReject={(reason) => {
          void (async () => {
            const decision = await actions.reject(reason);
            announceDecision(decision, 0, proposal.version);
          })();
        }}
        onDefer={(args) => {
          void (async () => {
            const decision = await actions.defer(args);
            announceDecision(decision, 0, proposal.version);
          })();
        }}
        onRequestChanges={(reason) => {
          void (async () => {
            await actions.requestChanges(reason);
            announce(t('notice.changesRequested'));
          })();
        }}
      />

      {executableDecision && !executionStarted ? (
        <div className="rk-execute">
          <p className="rk-notice rk-notice--info">
            {t('notice.approved', { count: executableDecision.approvedItemIds?.length ?? 0, version: proposal.version })}
          </p>
          <RawParams
            proposal={proposal}
            itemIds={executableDecision.approvedItemIds}
            redaction={redaction}
            t={t}
          />
          <button
            type="button"
            className="rk-button rk-button--primary"
            disabled={actions.pending}
            onClick={() => void execute()}
            data-rk-action="execute"
          >
            {t('action.execute')}
          </button>
        </div>
      ) : null}

      <ExecutionResultPanel proposal={proposal} receipts={audit?.receipts ?? []} t={t} />

      <details
        className="rk-keyboard"
        open={showKeyboardHelp}
        onToggle={(event) => setShowKeyboardHelp((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>{t('label.keyboard')}</summary>
        <ul className="rk-keyboard__list">
          <li>{t('keyboard.navigate')}</li>
          <li>{t('keyboard.select')}</li>
          <li>{t('keyboard.approve')}</li>
          <li>{t('keyboard.reject')}</li>
          <li>{t('keyboard.defer')}</li>
          <li>{t('keyboard.edit')}</li>
          <li>{t('keyboard.raw')}</li>
        </ul>
      </details>
    </section>
  );
}
