/**
 * Bulk actions over a selection (PRD 10.1: low-risk items can be processed in bulk;
 * "high-risk actions do not enter one-click bulk approval by default").
 *
 * The bar computes which selected items exceed `maxBulkRisk` and refuses to send an
 * approval that would include them, unless the reviewer explicitly acknowledges
 * having opened each one. The core enforces the same rule (`E_RISK_POLICY`), so a
 * host that skips this component still cannot bulk-approve high risk silently.
 */
import { useEffect, useState, type ReactElement } from 'react';
import { RISK_ORDER, type ActionItem, type ActionProposal, type RiskLevel } from '@reviewkit/core';
import type { Translate } from '../i18n.js';

export interface BulkActionBarProps {
  proposal: ActionProposal;
  /** Selected item ids. */
  selected: readonly string[];
  /** Highest risk allowed in a bulk approval — usually `session.policy.bulkApproveMaxRisk`. */
  maxBulkRisk: RiskLevel;
  onApprove: (itemIds: string[], acknowledgeHighRisk: boolean) => void;
  onReject: (itemIds: string[]) => void;
  onClear: () => void;
  /** Focus the item so the reviewer can read it before acknowledging. */
  onReveal?: (itemId: string) => void;
  pending?: boolean;
  t: Translate;
}

function riskOf(item: ActionItem, proposal: ActionProposal): RiskLevel {
  return item.risk?.level ?? proposal.risk.level;
}

export function BulkActionBar({
  proposal,
  selected,
  maxBulkRisk,
  onApprove,
  onReject,
  onClear,
  onReveal,
  pending = false,
  t,
}: BulkActionBarProps): ReactElement | null {
  const [acknowledged, setAcknowledged] = useState(false);
  const selectedItems = proposal.items.filter((item) => selected.includes(item.id));
  const limit = RISK_ORDER.indexOf(maxBulkRisk);
  const risky = selectedItems.filter((item) => RISK_ORDER.indexOf(riskOf(item, proposal)) > limit);

  // Changing the selection invalidates a previous acknowledgement: the reviewer has
  // not seen the newly added items.
  const selectionKey = [...selected].sort().join(',');
  useEffect(() => setAcknowledged(false), [selectionKey]);

  if (selected.length === 0) return null;
  const blocked = risky.length > 0 && !acknowledged;

  return (
    <div className="rk-bulkbar" role="region" aria-label={t('label.items')}>
      <span className="rk-bulkbar__count">{t('label.selected', { count: selected.length })}</span>

      {risky.length > 0 ? (
        <div className="rk-bulkbar__risk">
          <p className="rk-notice rk-notice--warn" role="status">
            {t('notice.highRiskBlocked', { count: risky.length })}
          </p>
          <ul className="rk-bulkbar__risky">
            {risky.map((item) => (
              <li key={item.id}>
                {onReveal ? (
                  <button type="button" className="rk-button rk-button--link" onClick={() => onReveal(item.id)}>
                    <code>{item.id}</code>
                  </button>
                ) : (
                  <code>{item.id}</code>
                )}
              </li>
            ))}
          </ul>
          <label className="rk-field rk-field--inline">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>{t('action.acknowledgeHighRisk')}</span>
          </label>
        </div>
      ) : null}

      <div className="rk-bulkbar__actions">
        <button
          type="button"
          className="rk-button rk-button--primary"
          disabled={pending || blocked}
          aria-disabled={pending || blocked}
          onClick={() => onApprove([...selected], acknowledged)}
        >
          {t('action.approveSelected', { count: selected.length })}
        </button>
        <button
          type="button"
          className="rk-button rk-button--danger"
          disabled={pending}
          onClick={() => onReject([...selected])}
        >
          {t('action.rejectSelected', { count: selected.length })}
        </button>
        <button type="button" className="rk-button rk-button--ghost" disabled={pending} onClick={onClear}>
          {t('action.clearSelection')}
        </button>
      </div>
    </div>
  );
}
