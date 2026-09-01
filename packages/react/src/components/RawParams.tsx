/**
 * Raw parameter disclosure (PRD 10.2: "the reviewer must be able to expand the raw
 * structured parameters"; "never show only the agent's natural-language summary
 * while hiding the actual parameters").
 *
 * What is shown is the *execution payload* — exactly what the host will receive —
 * rendered as text inside `<pre>`, with masked fields replaced. Masking is display
 * only: the hash below is computed over the real payload.
 */
import { useState, type ReactElement } from 'react';
import {
  buildExecutionPayload,
  computePayloadHash,
  maskData,
  type ActionItem,
  type ActionProposal,
  type JsonValue,
  type RedactionPolicy,
} from '@reviewkit/core';
import { useOptionalReviewKit, useTranslate } from '../context.js';
import type { Translate } from '../i18n.js';

export interface RawParamsProps {
  proposal: ActionProposal;
  /** Restrict to one item; omit for the whole proposal payload. */
  item?: ActionItem;
  /** Only these items (e.g. the approved subset). */
  itemIds?: readonly string[];
  redaction?: RedactionPolicy;
  /** Start expanded. Default false. */
  defaultOpen?: boolean;
  t?: Translate;
}

export function RawParams({
  proposal,
  item,
  itemIds,
  redaction,
  defaultOpen = false,
  t: providedT,
}: RawParamsProps): ReactElement {
  const context = useOptionalReviewKit();
  const fallbackT = useTranslate();
  const t = providedT ?? fallbackT;
  const [open, setOpen] = useState(defaultOpen);
  const policy = redaction ?? proposal.redaction ?? context?.redaction;

  const payload = buildExecutionPayload(proposal, item ? [item.id] : itemIds);
  const hash = computePayloadHash(payload);
  const shown = maskData(payload as unknown as JsonValue, policy) ?? payload;

  return (
    <details
      className="rk-raw"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="rk-raw__summary">{open ? t('action.hideRaw') : t('action.showRaw')}</summary>
      <p className="rk-notice rk-notice--muted">{t('notice.rawParams')}</p>
      <pre className="rk-raw__pre" tabIndex={0} aria-label={t('label.rawParams')}>
        {JSON.stringify(shown, null, 2)}
      </pre>
      <p className="rk-raw__hash">
        <span className="rk-label">{t('label.contentHash')}:</span> <code>{hash}</code>
      </p>
    </details>
  );
}
