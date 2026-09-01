/**
 * The four decisions a reviewer can take on a proposal: approve, edit-then-approve
 * (via the item editor, surfaced here as the "approve edited version" label),
 * reject, defer — plus "request changes".
 *
 * Rejection reasons combine preset tags with free text (PRD 10.4). The host decides
 * whether to hand the reason back to the agent; ReviewKit only records it.
 */
import { useId, useState, type ReactElement } from 'react';
import { sanitizeText } from '@reviewkit/core';
import type { MessageKey, Translate } from '../i18n.js';

/** Preset reason tags. Hosts may pass their own list. */
export const DEFAULT_REJECT_TAGS = [
  'wrong_scope',
  'wrong_data',
  'too_risky',
  'not_now',
  'duplicate',
  'policy',
  'other',
] as const;

export interface DecisionBarProps {
  t: Translate;
  /** Number of items that would be approved by the primary button. */
  approvableCount: number;
  /** Renders the primary button as "Approve edited version" (PRD 10.3). */
  edited?: boolean;
  rejectTags?: readonly string[];
  onApprove: (args: { note?: string }) => void;
  onReject: (reason: { tags?: string[]; note?: string }) => void;
  onDefer: (args: { until?: string; note?: string }) => void;
  onRequestChanges?: (reason: { tags?: string[]; note?: string }) => void;
  pending?: boolean;
  /** Nothing can be decided; the bar renders the reason instead of buttons. */
  disabledReason?: string | null;
}

type Panel = 'none' | 'reject' | 'defer';

export function DecisionBar({
  t,
  approvableCount,
  edited = false,
  rejectTags = DEFAULT_REJECT_TAGS,
  onApprove,
  onReject,
  onDefer,
  onRequestChanges,
  pending = false,
  disabledReason = null,
}: DecisionBarProps): ReactElement {
  const [panel, setPanel] = useState<Panel>('none');
  const [tags, setTags] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [until, setUntil] = useState('');
  const ids = useId();

  if (disabledReason) {
    return (
      <div className="rk-decision rk-decision--readonly" role="status">
        <p className="rk-notice rk-notice--muted">{disabledReason}</p>
      </div>
    );
  }

  const label = (tag: string): string =>
    (DEFAULT_REJECT_TAGS as readonly string[]).includes(tag)
      ? t(`rejectTag.${tag}` as MessageKey)
      : sanitizeText(tag);

  const reset = (): void => {
    setPanel('none');
    setTags([]);
    setNote('');
    setUntil('');
  };

  const reason = (): { tags?: string[]; note?: string } => ({
    ...(tags.length > 0 ? { tags } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  });

  return (
    <div className="rk-decision">
      <div className="rk-decision__buttons">
        <button
          type="button"
          className="rk-button rk-button--primary"
          disabled={pending || approvableCount === 0}
          onClick={() => onApprove({ ...(note.trim() ? { note: note.trim() } : {}) })}
          data-rk-action="approve"
        >
          {edited ? t('action.approveEdited') : t('action.approve')}
          {approvableCount > 0 ? ` (${approvableCount})` : ''}
        </button>
        <button
          type="button"
          className="rk-button rk-button--danger"
          disabled={pending}
          aria-expanded={panel === 'reject'}
          onClick={() => setPanel(panel === 'reject' ? 'none' : 'reject')}
          data-rk-action="reject"
        >
          {t('action.reject')}
        </button>
        <button
          type="button"
          className="rk-button"
          disabled={pending}
          aria-expanded={panel === 'defer'}
          onClick={() => setPanel(panel === 'defer' ? 'none' : 'defer')}
          data-rk-action="defer"
        >
          {t('action.defer')}
        </button>
        {onRequestChanges ? (
          <button
            type="button"
            className="rk-button"
            disabled={pending}
            onClick={() => onRequestChanges(reason())}
            data-rk-action="request-changes"
          >
            {t('action.requestChanges')}
          </button>
        ) : null}
      </div>

      {panel === 'reject' ? (
        <form
          className="rk-decision__panel"
          onSubmit={(event) => {
            event.preventDefault();
            onReject(reason());
            reset();
          }}
        >
          <fieldset className="rk-fieldset">
            <legend className="rk-label">{t('label.rejectReason')}</legend>
            <div className="rk-tags">
              {rejectTags.map((tag) => (
                <label className="rk-field rk-field--inline" key={tag}>
                  <input
                    type="checkbox"
                    checked={tags.includes(tag)}
                    onChange={() =>
                      setTags((previous) =>
                        previous.includes(tag) ? previous.filter((x) => x !== tag) : [...previous, tag],
                      )
                    }
                  />
                  <span>{label(tag)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="rk-field" htmlFor={`${ids}-reject-note`}>
            <span className="rk-label">{t('label.note')}</span>
            <textarea
              id={`${ids}-reject-note`}
              className="rk-textarea"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="rk-decision__panel-actions">
            <button type="submit" className="rk-button rk-button--danger" disabled={pending}>
              {t('action.reject')}
            </button>
            <button type="button" className="rk-button rk-button--ghost" onClick={reset} disabled={pending}>
              {t('action.cancel')}
            </button>
          </div>
        </form>
      ) : null}

      {panel === 'defer' ? (
        <form
          className="rk-decision__panel"
          onSubmit={(event) => {
            event.preventDefault();
            onDefer({
              ...(until ? { until: new Date(until).toISOString() } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            });
            reset();
          }}
        >
          <label className="rk-field" htmlFor={`${ids}-defer-until`}>
            <span className="rk-label">{t('label.deferUntil')}</span>
            <input
              id={`${ids}-defer-until`}
              className="rk-input"
              type="datetime-local"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
          <label className="rk-field" htmlFor={`${ids}-defer-note`}>
            <span className="rk-label">{t('label.note')}</span>
            <input
              id={`${ids}-defer-note`}
              className="rk-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="rk-decision__panel-actions">
            <button type="submit" className="rk-button" disabled={pending}>
              {t('action.defer')}
            </button>
            <button type="button" className="rk-button rk-button--ghost" onClick={reset} disabled={pending}>
              {t('action.cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
