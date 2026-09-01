/**
 * Status, risk and operation badges.
 *
 * All labels come from the message pack; every host/agent string goes through
 * `sanitizeText` — a proposal is untrusted input (PRD 12.9).
 */
import type { ReactElement } from 'react';
import { sanitizeText, type ItemStatus, type ProposalStatus, type RiskAssessment, type RiskLevel } from '@reviewkit/core';
import { useTranslate } from '../context.js';
import type { MessageKey, Translate } from '../i18n.js';

export interface RiskBadgeProps {
  risk: RiskAssessment | RiskLevel;
  /** Show `risk.tags` next to the level. */
  showTags?: boolean;
  /** Provided by the parent to avoid one context read per badge. */
  t?: Translate;
}

export function RiskBadge({ risk, showTags = false, t: provided }: RiskBadgeProps): ReactElement {
  const fallback = useTranslate();
  const t = provided ?? fallback;
  const level = typeof risk === 'string' ? risk : risk.level;
  const tags = typeof risk === 'string' ? [] : (risk.tags ?? []);
  const note = typeof risk === 'string' ? undefined : risk.note;
  return (
    <span
      className={`rk-badge rk-badge--risk rk-badge--risk-${level}`}
      data-rk-risk={level}
      title={note ? sanitizeText(note) : undefined}
      aria-label={t('a11y.riskBadge', { risk: t(`risk.${level}`) })}
    >
      {t(`risk.${level}`)}
      {showTags && tags.length > 0 ? (
        <span className="rk-badge__tags">{tags.map((tag) => sanitizeText(tag)).join(', ')}</span>
      ) : null}
    </span>
  );
}

export function StatusBadge({ status, t: provided }: { status: ProposalStatus; t?: Translate }): ReactElement {
  const fallback = useTranslate();
  const t = provided ?? fallback;
  return (
    <span className={`rk-badge rk-badge--status rk-badge--status-${status}`} data-rk-status={status}>
      {t(`status.${status}`)}
    </span>
  );
}

export function ItemStatusBadge({ status, t: provided }: { status: ItemStatus; t?: Translate }): ReactElement {
  const fallback = useTranslate();
  const t = provided ?? fallback;
  return (
    <span className={`rk-badge rk-badge--item rk-badge--item-${status}`} data-rk-item-status={status}>
      {t(`itemStatus.${status}`)}
    </span>
  );
}

const OPERATION_KEYS: Record<string, MessageKey> = {
  create: 'operation.create',
  update: 'operation.update',
  delete: 'operation.delete',
  send: 'operation.send',
  invoke: 'operation.invoke',
};

/** `create` / `update` / `delete` / `send` / `invoke`, or the host's own verb as text. */
export function OperationTag({ operation, t: provided }: { operation: string; t?: Translate }): ReactElement {
  const fallback = useTranslate();
  const t = provided ?? fallback;
  const key = OPERATION_KEYS[operation];
  return (
    <span className={`rk-tag rk-tag--op rk-tag--op-${key ? operation : 'other'}`}>
      {key ? t(key) : sanitizeText(operation)}
    </span>
  );
}
