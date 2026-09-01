/**
 * One reviewable item: what it does, its diff, and its per-item decisions.
 *
 * The header states the operation, the risk and the change count before any prose,
 * and the agent's `summary` is shown as a secondary line — never as a replacement
 * for the payload (PRD 10.2).
 */
import { useState, type ReactElement, type Ref } from 'react';
import {
  sanitizeText,
  type ActionItem,
  type ActionProposal,
  type ItemAnalysis,
  type ItemEdit,
  type RedactionPolicy,
} from '@reviewkit/core';
import type { Translate } from '../i18n.js';
import type { DiffRenderer } from '../renderers/index.js';
import { ItemStatusBadge, OperationTag, RiskBadge } from './badges.js';
import { DiffPanel } from './DiffPanel.js';
import { FieldEditor } from './FieldEditor.js';
import { RawParams } from './RawParams.js';

export interface ItemCardProps {
  proposal: ActionProposal;
  item: ActionItem;
  analysis: ItemAnalysis;
  t: Translate;
  renderers?: readonly DiffRenderer[];
  redaction?: RedactionPolicy;
  onlyChanges?: boolean;
  showRaw?: boolean;
  /** Bulk selection. Omit both to hide the checkbox. */
  selected?: boolean;
  onToggleSelected?: (itemId: string) => void;
  /** Per-item decisions; omitted while the proposal is read-only. */
  onApprove?: (itemId: string) => void;
  onReject?: (itemId: string) => void;
  onEdit?: (edit: ItemEdit) => void | Promise<void>;
  pending?: boolean;
  /** Roving focus (PRD 9.1 keyboard operation). */
  focused?: boolean;
  cardRef?: Ref<HTMLLIElement>;
  /** Controlled edit mode, so a keyboard shortcut in the parent can open it. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

export function ItemCard({
  proposal,
  item,
  analysis,
  t,
  renderers,
  redaction,
  onlyChanges = true,
  showRaw = false,
  selected,
  onToggleSelected,
  onApprove,
  onReject,
  onEdit,
  pending = false,
  focused = false,
  cardRef,
  editing,
  onEditingChange,
}: ItemCardProps): ReactElement {
  const [localEditing, setLocalEditing] = useState(false);
  const isEditing = editing ?? localEditing;
  const setEditing = (next: boolean): void => {
    setLocalEditing(next);
    onEditingChange?.(next);
  };

  const wasEdited = item.status === 'edited' || item.editedFrom !== undefined;

  return (
    <li
      ref={cardRef}
      className={[
        'rk-item',
        `rk-item--${item.status}`,
        focused ? 'rk-item--focused' : '',
        selected ? 'rk-item--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-rk-item-id={item.id}
      data-rk-item-status={item.status}
      data-rk-risk={item.risk?.level ?? proposal.risk.level}
      tabIndex={focused ? 0 : -1}
      aria-selected={selected === undefined ? undefined : selected}
    >
      <div className="rk-item__head">
        {onToggleSelected ? (
          <input
            type="checkbox"
            className="rk-item__check"
            checked={selected ?? false}
            aria-label={t('a11y.selectItem', { id: item.id })}
            onChange={() => onToggleSelected(item.id)}
          />
        ) : null}
        <div className="rk-item__title">
          <OperationTag operation={item.operation} t={t} />
          <code className="rk-item__id">{item.id}</code>
          {item.risk ? <RiskBadge risk={item.risk} showTags t={t} /> : null}
          <ItemStatusBadge status={item.status} t={t} />
          <span className="rk-item__count">
            {t('label.changes')}: {analysis.changeCount}
          </span>
          {wasEdited ? <span className="rk-tag rk-tag--edited">{t('itemStatus.edited')}</span> : null}
        </div>
        <div className="rk-item__actions">
          {onEdit ? (
            <button
              type="button"
              className="rk-button rk-button--ghost"
              onClick={() => setEditing(!isEditing)}
              disabled={pending}
              aria-expanded={isEditing}
            >
              {t('action.edit')}
            </button>
          ) : null}
          {onApprove ? (
            <button
              type="button"
              className="rk-button rk-button--small"
              onClick={() => onApprove(item.id)}
              disabled={pending}
            >
              {t('action.approve')}
            </button>
          ) : null}
          {onReject ? (
            <button
              type="button"
              className="rk-button rk-button--small rk-button--danger"
              onClick={() => onReject(item.id)}
              disabled={pending}
            >
              {t('action.reject')}
            </button>
          ) : null}
        </div>
      </div>

      {item.summary ? <p className="rk-item__summary">{sanitizeText(item.summary)}</p> : null}

      {item.invalidation ? (
        <p className="rk-notice rk-notice--warn" role="status">
          {t('notice.sourceChanged')}
          {item.invalidation.expectedVersion || item.invalidation.actualVersion ? (
            <>
              {' '}
              <code>
                {sanitizeText(item.invalidation.expectedVersion ?? '?')} →{' '}
                {sanitizeText(item.invalidation.actualVersion ?? '?')}
              </code>
            </>
          ) : null}
        </p>
      ) : null}

      {isEditing && onEdit ? (
        <FieldEditor
          item={item}
          pending={pending}
          t={t}
          onCancel={() => setEditing(false)}
          onSave={async (edit) => {
            await onEdit(edit);
            setEditing(false);
          }}
        />
      ) : (
        <DiffPanel
          proposal={proposal}
          item={item}
          analysis={analysis}
          renderers={renderers}
          redaction={redaction}
          onlyChanges={onlyChanges}
          t={t}
        />
      )}

      {showRaw ? <RawParams proposal={proposal} item={item} redaction={redaction} t={t} defaultOpen /> : null}
      {item.source ? (
        <p className="rk-item__source">
          <span className="rk-label">{t('label.target')}:</span> <code>{sanitizeText(item.source.ref)}</code>
          {item.source.version ? <code className="rk-item__etag">@{sanitizeText(item.source.version)}</code> : null}
        </p>
      ) : null}
    </li>
  );
}
