/**
 * Edit-then-approve (PRD 10.3).
 *
 * The reviewer edits the *execution payload* — the `after` value the host will
 * apply — not a summary. Saving goes through `session.editItem`, which creates a new
 * proposal version and a new content hash; the caller then shows
 * `notice.editedVersion`. Nothing is approved implicitly by saving.
 */
import { useEffect, useId, useState, type FormEvent, type ReactElement } from 'react';
import type { ActionItem, ItemEdit, JsonValue } from '@reviewkit/core';
import { useTranslate } from '../context.js';
import type { Translate } from '../i18n.js';

export interface FieldEditorProps {
  item: ActionItem;
  onSave: (edit: ItemEdit) => void | Promise<void>;
  onCancel: () => void;
  /** Disables the form while a save is in flight. */
  pending?: boolean;
  t?: Translate;
}

function toText(value: JsonValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export function FieldEditor({ item, onSave, onCancel, pending = false, t: providedT }: FieldEditorProps): ReactElement {
  const fallbackT = useTranslate();
  const t = providedT ?? fallbackT;
  const isText = typeof item.after === 'string' || (item.after === undefined && typeof item.before === 'string');
  const [text, setText] = useState(() => toText(item.after));
  const [note, setNote] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const fieldId = useId();

  // A save produced a new item object (new version): re-seed from it.
  useEffect(() => {
    setText(toText(item.after));
    setParseError(null);
  }, [item]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    let next: JsonValue;
    if (isText) {
      next = text;
    } else {
      try {
        next = JSON.parse(text) as JsonValue;
      } catch (cause) {
        setParseError(t('error.invalidJson', { message: cause instanceof Error ? cause.message : String(cause) }));
        return;
      }
    }
    setParseError(null);
    void onSave({ itemId: item.id, after: next, ...(note.trim() ? { note: note.trim() } : {}) });
  };

  return (
    <form className="rk-editor" onSubmit={submit} aria-describedby={parseError ? `${fieldId}-error` : undefined}>
      <label className="rk-field" htmlFor={`${fieldId}-after`}>
        <span className="rk-label">
          {t('label.after')} — {t('label.rawParams')}
        </span>
        <textarea
          id={`${fieldId}-after`}
          className="rk-textarea"
          value={text}
          spellCheck={false}
          rows={Math.min(24, Math.max(4, text.split('\n').length + 1))}
          onChange={(event) => setText(event.target.value)}
          aria-invalid={parseError ? true : undefined}
        />
      </label>
      <label className="rk-field" htmlFor={`${fieldId}-note`}>
        <span className="rk-label">{t('label.note')}</span>
        <input
          id={`${fieldId}-note`}
          className="rk-input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {parseError ? (
        <p className="rk-notice rk-notice--error" id={`${fieldId}-error`} role="alert">
          {parseError}
        </p>
      ) : null}
      <div className="rk-editor__actions">
        <button type="submit" className="rk-button rk-button--primary" disabled={pending}>
          {t('action.save')}
        </button>
        <button type="button" className="rk-button rk-button--ghost" onClick={onCancel} disabled={pending}>
          {t('action.cancel')}
        </button>
      </div>
    </form>
  );
}
