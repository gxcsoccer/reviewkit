/**
 * `ProposalList` — the review queue (PRD 10.1).
 *
 * Ordered by risk first, not by time: the default query sort is `-risk`, so the most
 * dangerous pending action is the one you see. Filters cover status, risk, action type
 * and business object, and bulk approval is offered only for items at or below the
 * session's `bulkApproveMaxRisk` — higher-risk rows cannot be selected for a one-click
 * bulk approve at all, they have to be opened (PRD 10.1, 20).
 */
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  RISK_ORDER,
  countChanges,
  sanitizeText,
  type ActionProposal,
  type ProposalQuery,
  type ProposalStatus,
  type ReviewSession,
  type RiskLevel,
} from '@reviewkit/core';
import { useOptionalReviewKit } from '../context.js';
import { createTranslate, en, resolveMessages, type MessageOverrides, type Translate } from '../i18n.js';
import { useAnnouncer, useProposalList, useSelection, toUiError, type UiError } from '../hooks.js';
import { RiskBadge, StatusBadge } from './badges.js';
import { ErrorBanner } from './ErrorBanner.js';

const ALL_STATUSES: readonly ProposalStatus[] = [
  'pending_review',
  'reviewing',
  'changes_requested',
  'approved',
  'rejected',
  'expired',
  'cancelled',
  'invalidated',
  'superseded',
  'draft',
];

/** Statuses shown when the host passes no `query.status`. */
const OPEN_STATUSES: readonly ProposalStatus[] = ['pending_review', 'reviewing', 'changes_requested'];

export interface ProposalListProps {
  session?: ReviewSession;
  /** Base query. Filter controls narrow it; `sort` defaults to risk-first. */
  query?: ProposalQuery;
  /** Called when a row is opened. */
  onSelect?: (proposalId: string, proposal: ActionProposal) => void;
  /** Highlights the open row. */
  selectedId?: string;
  /** Allow bulk approve/reject from the list. Default true. */
  bulkActions?: boolean;
  /** Hide the filter bar (a host may render its own). */
  showFilters?: boolean;
  locale?: string;
  messages?: MessageOverrides;
  className?: string;
}

export function ProposalList({
  session: providedSession,
  query,
  onSelect,
  selectedId,
  bulkActions = true,
  showFilters = true,
  locale,
  messages: overrides,
  className,
}: ProposalListProps): ReactElement {
  const context = useOptionalReviewKit();
  const session = providedSession ?? context?.session;
  if (!session) throw new Error(en['error.noProvider']);

  const t: Translate = useMemo(() => {
    if (!locale && !overrides && context) return context.t;
    if (!locale && !overrides) return createTranslate(en);
    return createTranslate(resolveMessages(locale ?? context?.locale, overrides));
  }, [locale, overrides, context]);

  const [statuses, setStatuses] = useState<readonly ProposalStatus[]>(query?.status ?? OPEN_STATUSES);
  const [risks, setRisks] = useState<readonly RiskLevel[]>(query?.riskLevel ?? []);
  const [type, setType] = useState<string>('');
  const [subjectType, setSubjectType] = useState<string>('');
  const [search, setSearch] = useState<string>(query?.search ?? '');
  const [sort, setSort] = useState<NonNullable<ProposalQuery['sort']>>(query?.sort ?? '-risk');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const { message: announcement, announce } = useAnnouncer();

  const effectiveQuery: ProposalQuery = {
    ...query,
    ...(statuses.length > 0 ? { status: [...statuses] } : {}),
    ...(risks.length > 0 ? { riskLevel: [...risks] } : {}),
    ...(type ? { type: [type] } : {}),
    ...(subjectType ? { subjectType: [subjectType] } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    sort,
  };

  const { items, total, loading, error: listError, reload } = useProposalList(session, effectiveQuery);
  const proposals = items.map((record) => record.proposal);
  const listParentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: proposals.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });

  const maxBulkRisk = session.policy.bulkApproveMaxRisk;
  const limit = RISK_ORDER.indexOf(maxBulkRisk);
  const bulkEligible = proposals.filter(
    (proposal) => RISK_ORDER.indexOf(proposal.risk.level) <= limit && proposal.status !== 'approved',
  );
  const blockedByRisk = proposals.filter((proposal) => RISK_ORDER.indexOf(proposal.risk.level) > limit);
  const selection = useSelection(bulkEligible.map((proposal) => proposal.id));

  // Options offered by the type/subject filters, taken from what is actually loaded.
  const typeOptions = [...new Set(proposals.map((proposal) => proposal.type))].sort();
  const subjectOptions = [...new Set(proposals.map((proposal) => proposal.subject.type))].sort();

  const runBulk = async (kind: 'approve' | 'reject'): Promise<void> => {
    setBusy(true);
    setError(null);
    let done = 0;
    try {
      for (const id of selection.selected) {
        if (kind === 'approve') await session.approve(id);
        else await session.reject(id, { reason: { tags: ['bulk'] } });
        done += 1;
      }
      announce(
        kind === 'approve' ? t('notice.approved', { count: done, version: 1 }) : t('notice.rejected'),
      );
      selection.clear();
    } catch (cause) {
      setError(toUiError(cause));
      announce(t('error.title'));
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const toggle = <T,>(list: readonly T[], value: T): T[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  return (
    <section className={['rk-list', className].filter(Boolean).join(' ')} aria-label={t('a11y.proposalList')}>
      <div className="rk-sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {showFilters ? (
        <div className="rk-list__filters" role="group" aria-label={t('label.filters')}>
          <div className="rk-chips" role="group" aria-label={t('label.status')}>
            {ALL_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                className={`rk-chip ${statuses.includes(status) ? 'rk-chip--on' : ''}`}
                aria-pressed={statuses.includes(status)}
                onClick={() => setStatuses((previous) => toggle(previous, status))}
              >
                {t(`status.${status}`)}
              </button>
            ))}
          </div>
          <div className="rk-chips" role="group" aria-label={t('label.risk')}>
            {RISK_ORDER.map((level) => (
              <button
                key={level}
                type="button"
                className={`rk-chip rk-chip--risk-${level} ${risks.includes(level) ? 'rk-chip--on' : ''}`}
                aria-pressed={risks.includes(level)}
                onClick={() => setRisks((previous) => toggle(previous, level))}
              >
                {t(`risk.${level}`)}
              </button>
            ))}
          </div>
          <div className="rk-list__selects">
            <label className="rk-field rk-field--inline">
              <span className="rk-sr-only">{t('label.proposal')}</span>
              <select className="rk-select" value={type} onChange={(event) => setType(event.target.value)}>
                <option value="">{t('label.proposal')}: {t('action.allFields')}</option>
                {typeOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="rk-field rk-field--inline">
              <span className="rk-sr-only">{t('label.impact')}</span>
              <select
                className="rk-select"
                value={subjectType}
                onChange={(event) => setSubjectType(event.target.value)}
              >
                <option value="">{t('label.impact')}: {t('action.allFields')}</option>
                {subjectOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="rk-field rk-field--inline">
              <span className="rk-sr-only">{t('label.search')}</span>
              <input
                className="rk-input"
                type="search"
                value={search}
                placeholder={t('label.search')}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="rk-field rk-field--inline">
              <span className="rk-sr-only">{t('label.risk')}</span>
              <select
                className="rk-select"
                value={sort}
                onChange={(event) => setSort(event.target.value as NonNullable<ProposalQuery['sort']>)}
              >
                <option value="-risk">{t('label.risk')} ↓</option>
                <option value="risk">{t('label.risk')} ↑</option>
                <option value="createdAt">{t('label.created')} ↑</option>
                <option value="-createdAt">{t('label.created')} ↓</option>
                <option value="expiresAt">{t('label.expires')} ↑</option>
              </select>
            </label>
          </div>
        </div>
      ) : null}

      <ErrorBanner error={error ?? listError} t={t} onDismiss={() => setError(null)} onRetry={() => void reload()} />

      {loading && proposals.length === 0 ? <p className="rk-notice rk-notice--muted">{t('notice.loading')}</p> : null}
      {!loading && proposals.length === 0 ? (
        <p className="rk-notice rk-notice--muted">{t('notice.noProposals')}</p>
      ) : null}

      {proposals.length > 0 ? (
        <div ref={listParentRef} className="rk-list__scroller" style={{ maxHeight: 480, overflow: "auto", minHeight: Math.min(rowVirtualizer.getTotalSize(), 480) }}>
        <table className="rk-list__table">
          <caption className="rk-sr-only">{t('a11y.proposalList')}</caption>
          <thead>
            <tr>
              {bulkActions ? (
                <th scope="col" className="rk-list__select">
                  <input
                    type="checkbox"
                    checked={selection.allSelected && bulkEligible.length > 0}
                    disabled={bulkEligible.length === 0}
                    aria-label={t('action.selectAll')}
                    onChange={() => (selection.allSelected ? selection.clear() : selection.selectAll())}
                  />
                </th>
              ) : null}
              <th scope="col">{t('label.summary')}</th>
              <th scope="col">{t('label.impact')}</th>
              <th scope="col">{t('label.changes')}</th>
              <th scope="col">{t('label.risk')}</th>
              <th scope="col">{t('label.status')}</th>
              <th scope="col">{t('label.created')}</th>
              <th scope="col">{t('label.expires')}</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((proposal) => {
              const eligible = bulkEligible.some((candidate) => candidate.id === proposal.id);
              return (
                <tr
                  key={proposal.id}
                  className={`rk-list__row ${selectedId === proposal.id ? 'rk-list__row--open' : ''}`}
                  data-rk-proposal-id={proposal.id}
                  data-rk-risk={proposal.risk.level}
                  data-rk-status={proposal.status}
                >
                  {bulkActions ? (
                    <td className="rk-list__select">
                      <input
                        type="checkbox"
                        checked={selection.has(proposal.id)}
                        disabled={!eligible || busy}
                        aria-label={t('a11y.selectItem', { id: proposal.id })}
                        title={eligible ? undefined : t('notice.highRiskBlocked', { count: 1 })}
                        onChange={() => selection.toggle(proposal.id)}
                      />
                    </td>
                  ) : null}
                  <th scope="row" className="rk-list__summary">
                    {onSelect ? (
                      <button
                        type="button"
                        className="rk-button rk-button--link"
                        onClick={() => onSelect(proposal.id, proposal)}
                      >
                        {sanitizeText(proposal.summary)}
                      </button>
                    ) : (
                      sanitizeText(proposal.summary)
                    )}
                    <code className="rk-list__type">{sanitizeText(proposal.type)}</code>
                  </th>
                  <td>
                    {proposal.subject.count} {sanitizeText(proposal.subject.label ?? proposal.subject.type)}
                  </td>
                  <td>{countChanges(proposal.items)}</td>
                  <td>
                    <RiskBadge risk={proposal.risk} t={t} />
                  </td>
                  <td>
                    <StatusBadge status={proposal.status} t={t} />
                  </td>
                  <td>
                    <time dateTime={proposal.createdAt}>{proposal.createdAt.slice(0, 16).replace('T', ' ')}</time>
                  </td>
                  <td>
                    {proposal.expiresAt ? (
                      <time dateTime={proposal.expiresAt}>{proposal.expiresAt.slice(0, 16).replace('T', ' ')}</time>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      ) : null}

      <p className="rk-list__total">
        {t('label.rows')}: {proposals.length}/{total}
      </p>

      {bulkActions && selection.count > 0 ? (
        <div className="rk-bulkbar" role="region" aria-label={t('label.decision')}>
          <span className="rk-bulkbar__count">{t('label.selected', { count: selection.count })}</span>
          {blockedByRisk.length > 0 ? (
            <p className="rk-notice rk-notice--warn">
              {t('notice.highRiskBlocked', { count: blockedByRisk.length })}
            </p>
          ) : null}
          <div className="rk-bulkbar__actions">
            <button
              type="button"
              className="rk-button rk-button--primary"
              disabled={busy}
              onClick={() => void runBulk('approve')}
            >
              {t('action.approveSelected', { count: selection.count })}
            </button>
            <button
              type="button"
              className="rk-button rk-button--danger"
              disabled={busy}
              onClick={() => void runBulk('reject')}
            >
              {t('action.rejectSelected', { count: selection.count })}
            </button>
            <button type="button" className="rk-button rk-button--ghost" disabled={busy} onClick={selection.clear}>
              {t('action.clearSelection')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
