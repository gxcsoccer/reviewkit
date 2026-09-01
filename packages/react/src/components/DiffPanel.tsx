/**
 * Renders one item's before/after comparison with the renderer that claims it.
 *
 * Dispatch is data-driven (`resolveRenderer`), so a host adds a business renderer by
 * passing one more object — no fork of core or of this package (PRD 20). A renderer
 * that throws is contained by a boundary: one broken custom renderer must not take
 * the whole review page down with it.
 */
import { Component, useMemo, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import {
  analyzeItem,
  maskedPaths,
  type ActionItem,
  type ActionProposal,
  type AnalyzeOptions,
  type ItemAnalysis,
  type RedactionPolicy,
} from '@reviewkit/core';
import { useOptionalReviewKit, useTranslate } from '../context.js';
import type { Translate } from '../i18n.js';
import { defaultRenderers, resolveRenderer, type DiffRenderer } from '../renderers/index.js';

export interface DiffPanelProps {
  proposal: ActionProposal;
  item: ActionItem;
  /** Overrides the provider's renderers. Built-ins are appended as a fallback. */
  renderers?: readonly DiffRenderer[];
  /** "Only changed fields" view (PRD 10.2). Default true. */
  onlyChanges?: boolean;
  /** Falls back to `proposal.redaction`. */
  redaction?: RedactionPolicy;
  /** Precomputed by the parent when it already needed the analysis. */
  analysis?: ItemAnalysis;
  analyzeOptions?: AnalyzeOptions;
  t?: Translate;
  locale?: string;
}

interface BoundaryProps {
  rendererName: string;
  t: Translate;
  children: ReactNode;
}

class RendererBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console, not the logger: this is a developer-facing contract break, and the
    // message must not carry payload values.
    // eslint-disable-next-line no-console
    console.error(`[reviewkit] renderer "${this.props.rendererName}" threw`, error.message, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="rk-banner rk-banner--error" role="alert">
          <div className="rk-banner__head">
            <strong className="rk-banner__title">{this.props.t('error.title')}</strong>
            <code className="rk-banner__code">E_CONTRACT</code>
          </div>
          <p className="rk-banner__message">
            Renderer &ldquo;{this.props.rendererName}&rdquo; threw: {this.state.error.message}
          </p>
          <p className="rk-banner__hint">
            <strong>{this.props.t('error.hint')}:</strong> A renderer must be a pure function of its context. Check{' '}
            <code>render()</code> for assumptions about the payload shape; use the raw parameters view meanwhile.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function DiffPanel({
  proposal,
  item,
  renderers,
  onlyChanges = true,
  redaction,
  analysis: providedAnalysis,
  analyzeOptions,
  t: providedT,
  locale: providedLocale,
}: DiffPanelProps): ReactElement {
  const context = useOptionalReviewKit();
  const fallbackT = useTranslate();
  const t = providedT ?? fallbackT;
  const locale = providedLocale ?? context?.locale ?? 'en';
  const policy = redaction ?? proposal.redaction ?? context?.redaction;

  const analysis = useMemo(
    () => providedAnalysis ?? analyzeItem(item, analyzeOptions),
    [providedAnalysis, item, analyzeOptions],
  );

  const pool = useMemo<readonly DiffRenderer[]>(() => {
    const custom = renderers ?? context?.renderers ?? [];
    // Always keep a claim of last resort so an unknown `kind` degrades to JSON
    // instead of rendering nothing.
    return custom.some((renderer) => renderer.kinds?.includes('*')) ? custom : [...custom, ...defaultRenderers()];
  }, [renderers, context]);

  const renderer = resolveRenderer(pool, item, proposal);
  const masked = maskedPaths(analysis.changedPaths, policy);

  return (
    <div className="rk-diff-panel" data-rk-kind={analysis.kind} data-rk-renderer={renderer?.name}>
      {masked.length > 0 ? (
        <p className="rk-notice rk-notice--muted">{t('label.masked', { count: masked.length })}</p>
      ) : null}
      <RendererBoundary rendererName={renderer?.name ?? 'none'} t={t}>
        {renderer?.render({
          proposal,
          item,
          analysis,
          redaction: policy,
          onlyChanges,
          t,
          locale,
        })}
      </RendererBoundary>
    </div>
  );
}
