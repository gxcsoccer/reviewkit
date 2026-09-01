/**
 * The renderer contract (PRD 20: "adding a custom business renderer must not
 * require changing the core package").
 *
 * A renderer is a plain object: a name, a claim (`kinds` and/or `match`), and a
 * `render` function that receives everything it needs — the item, the proposal, a
 * precomputed diff analysis, the masking policy and the translator. Nothing in
 * `@reviewkit/core` or `@reviewkit/react` needs to know it exists.
 */
import type { ReactNode } from 'react';
import type { ActionItem, ActionProposal, ItemAnalysis, ItemKind, RedactionPolicy } from '@reviewkit/core';
import type { Translate } from '../i18n.js';

export interface DiffRendererContext {
  proposal: ActionProposal;
  item: ActionItem;
  /** Diff already computed by core, so renderers stay presentation-only. */
  analysis: ItemAnalysis;
  /** Masking policy in force. Renderers must call `maskData`/`isMasked` (PRD 12.4). */
  redaction: RedactionPolicy | undefined;
  /** "Only changed fields" view (PRD 10.2). */
  onlyChanges: boolean;
  t: Translate;
  locale: string;
}

export interface DiffRenderer {
  /** Stable identifier; also used as the React key and in dev diagnostics. */
  name: string;
  /** Item kinds this renderer handles. `'*'` claims everything. */
  kinds?: readonly (ItemKind | '*')[];
  /** Finer-grained claim (e.g. `item.meta.domain === 'invoice'`). Checked first. */
  match?: (item: ActionItem, proposal: ActionProposal) => boolean;
  render: (context: DiffRendererContext) => ReactNode;
}

/**
 * First renderer whose `match` accepts the item wins; otherwise the first whose
 * `kinds` includes the item kind; otherwise a `'*'` renderer. Returns undefined
 * when nothing claims the item — `DiffPanel` then falls back to the JSON renderer,
 * so an unknown `kind` degrades instead of rendering nothing.
 */
export function resolveRenderer(
  renderers: readonly DiffRenderer[],
  item: ActionItem,
  proposal: ActionProposal,
): DiffRenderer | undefined {
  for (const renderer of renderers) {
    if (renderer.match?.(item, proposal)) return renderer;
  }
  for (const renderer of renderers) {
    if (renderer.kinds?.includes(item.kind)) return renderer;
  }
  return renderers.find((renderer) => renderer.kinds?.includes('*'));
}
