/**
 * Error banner (PRD 20: "interface errors must give actionable diagnostics").
 *
 * Shows the stable code, the message, the `hint` — the "what to do next" line every
 * `ReviewKitError` carries — and the structured details, which hold ids, versions
 * and hashes only, never business payloads.
 */
import type { ReactElement } from 'react';
import { useTranslate } from '../context.js';
import type { Translate } from '../i18n.js';
import type { UiError } from '../hooks.js';

export interface ErrorBannerProps {
  error: UiError | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  t?: Translate;
}

export function ErrorBanner({ error, onDismiss, onRetry, t: provided }: ErrorBannerProps): ReactElement | null {
  const fallback = useTranslate();
  const t = provided ?? fallback;
  if (!error) return null;

  const details = Object.entries(error.details ?? {}).filter(([, value]) => value !== undefined);

  return (
    <div className="rk-banner rk-banner--error" role="alert">
      <div className="rk-banner__head">
        <strong className="rk-banner__title">{t('error.title')}</strong>
        <code className="rk-banner__code">{error.code}</code>
      </div>
      <p className="rk-banner__message">{error.message}</p>
      {error.hint ? (
        <p className="rk-banner__hint">
          <strong>{t('error.hint')}:</strong> {error.hint}
        </p>
      ) : null}
      {details.length > 0 ? (
        <details className="rk-banner__details">
          <summary>{t('error.details')}</summary>
          <dl className="rk-kv">
            {details.map(([key, value]) => (
              <div className="rk-kv__pair" key={key}>
                <dt>{key}</dt>
                <dd>
                  <code>{typeof value === 'string' ? value : JSON.stringify(value)}</code>
                </dd>
              </div>
            ))}
          </dl>
          {error.docs ? <p className="rk-banner__docs">{error.docs}</p> : null}
        </details>
      ) : null}
      <div className="rk-banner__actions">
        {onRetry ? (
          <button type="button" className="rk-button rk-button--ghost" onClick={onRetry}>
            {t('action.retry')}
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="rk-button rk-button--ghost" onClick={onDismiss}>
            {t('action.dismiss')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
