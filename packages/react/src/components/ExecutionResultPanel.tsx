/**
 * Execution results as reported by the host (PRD 10.5).
 *
 * Everything here comes from `ExecutionReceipt`s — the host's own account of what
 * happened — never from the agent's narration. Bulk actions always distinguish
 * all-succeeded / partially-succeeded / all-failed, and each item shows the external
 * reference or error the host returned.
 */
import type { ReactElement } from 'react';
import {
  sanitizeText,
  sanitizeUrl,
  type ActionProposal,
  type Evidence,
  type ExecutionReceipt,
  type ExecutionStatus,
  type ExternalRef,
  type ItemExecutionResult,
} from '@reviewkit/core';
import { useTranslate } from '../context.js';
import type { Translate } from '../i18n.js';

export interface ExecutionResultPanelProps {
  proposal: ActionProposal;
  receipts: readonly ExecutionReceipt[];
  t?: Translate;
}

function ExternalRefLink({ ref: reference }: { ref: ExternalRef }): ReactElement {
  const href = reference.url ? sanitizeUrl(reference.url) : null;
  const text = `${sanitizeText(reference.system)}:${sanitizeText(reference.label ?? reference.id)}`;
  if (!href) return <code className="rk-extref">{text}</code>;
  return (
    <a className="rk-extref rk-extref--link" href={href} target="_blank" rel="noreferrer noopener">
      {text}
    </a>
  );
}

function EvidenceList({ evidence, t }: { evidence: readonly Evidence[]; t: Translate }): ReactElement {
  return (
    <div className="rk-evidence">
      <span className="rk-label">{t('label.evidence')}</span>
      <ul className="rk-evidence__list">
        {evidence.map((entry, index) => {
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
    </div>
  );
}

const ITEM_STATUS_KEYS = {
  succeeded: 'exec.itemSucceeded',
  failed: 'exec.itemFailed',
  skipped: 'exec.itemSkipped',
  rolled_back: 'exec.rolled_back',
} as const;

export function ExecutionResultPanel({
  proposal,
  receipts,
  t: providedT,
}: ExecutionResultPanelProps): ReactElement | null {
  const fallbackT = useTranslate();
  const t = providedT ?? fallbackT;
  const execution = proposal.execution;
  const latest = receipts.length > 0 ? receipts[receipts.length - 1] : undefined;
  const status: ExecutionStatus = latest?.status ?? execution?.status ?? 'not_started';

  if (!execution && receipts.length === 0) return null;

  const results: ItemExecutionResult[] = receipts.flatMap((receipt) => receipt.results ?? []);
  const counts = results.reduce(
    (totals, result) => {
      if (result.status === 'succeeded') totals.succeeded += 1;
      else if (result.status === 'failed') totals.failed += 1;
      else if (result.status === 'skipped') totals.skipped += 1;
      return totals;
    },
    { succeeded: 0, failed: 0, skipped: 0 },
  );

  return (
    <section className="rk-exec" data-rk-exec-status={status} aria-label={t('label.executionResult')}>
      <header className="rk-exec__head">
        <h3 className="rk-exec__title">{t('label.executionResult')}</h3>
        <span className={`rk-badge rk-badge--exec rk-badge--exec-${status}`}>{t(`exec.${status}`)}</span>
        {results.length > 0 ? <span className="rk-exec__counts">{t('exec.counts', counts)}</span> : null}
      </header>

      {execution?.hashMismatch ? (
        <p className="rk-banner rk-banner--error" role="alert">
          {t('exec.hashMismatch')}
        </p>
      ) : null}

      {latest?.error ? (
        <p className="rk-notice rk-notice--error" role="alert">
          <code>{sanitizeText(latest.error.code)}</code> {sanitizeText(latest.error.message)}
          {latest.error.retryable ? <span className="rk-tag">{t('action.retry')}</span> : null}
        </p>
      ) : null}

      {results.length > 0 ? (
        <table className="rk-exec__table">
          <thead>
            <tr>
              <th scope="col">{t('label.items')}</th>
              <th scope="col">{t('label.status')}</th>
              <th scope="col">{t('label.externalRef')}</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => (
              <tr key={`${result.itemId}-${result.status}`} data-rk-result={result.status}>
                <th scope="row">
                  <code>{sanitizeText(result.itemId)}</code>
                </th>
                <td>
                  <span className={`rk-badge rk-badge--result rk-badge--result-${result.status}`}>
                    {t(ITEM_STATUS_KEYS[result.status])}
                  </span>
                  {result.error ? (
                    <span className="rk-exec__error">
                      <code>{sanitizeText(result.error.code)}</code> {sanitizeText(result.error.message)}
                    </span>
                  ) : null}
                </td>
                <td>{result.externalRef ? <ExternalRefLink ref={result.externalRef} /> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {latest?.rollback ? (
        <p className="rk-exec__rollback">{t('exec.rollback', { status: latest.rollback.status })}</p>
      ) : null}

      {latest?.evidence && latest.evidence.length > 0 ? <EvidenceList evidence={latest.evidence} t={t} /> : null}

      {latest ? (
        <dl className="rk-kv rk-exec__meta">
          <div className="rk-kv__pair">
            <dt>{t('label.decision')}</dt>
            <dd>
              <code>{sanitizeText(latest.decisionId)}</code>
            </dd>
          </div>
          <div className="rk-kv__pair">
            <dt>{t('label.contentHash')}</dt>
            <dd>
              <code>{latest.executedParamsHash}</code>
            </dd>
          </div>
          <div className="rk-kv__pair">
            <dt>{t('label.created')}</dt>
            <dd>
              <time dateTime={latest.startedAt}>{latest.startedAt}</time>
            </dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}
