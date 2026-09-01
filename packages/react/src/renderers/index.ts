/**
 * The three renderers required by PRD 9.1, plus the contract custom renderers
 * implement. `defaultRenderers()` is what `ReviewKitProvider` and `ActionReview`
 * use when a host passes none.
 */
import { jsonRenderer, type JsonRendererOptions } from './json.js';
import { tableRenderer, type TableRendererOptions } from './table.js';
import { textRenderer, type TextRendererOptions } from './text.js';
import type { DiffRenderer } from './types.js';

export { jsonRenderer, type JsonRendererOptions } from './json.js';
export { tableRenderer, type TableRendererOptions, type TableRowFilter } from './table.js';
export { textRenderer, type TextRendererOptions } from './text.js';
export { resolveRenderer, type DiffRenderer, type DiffRendererContext } from './types.js';

export interface DefaultRendererOptions {
  json?: JsonRendererOptions;
  text?: TextRendererOptions;
  table?: TableRendererOptions;
}

/**
 * Order matters: the first renderer whose claim matches wins, and the JSON
 * renderer claims `'*'`, so it must come last.
 */
export function defaultRenderers(options: DefaultRendererOptions = {}): DiffRenderer[] {
  return [textRenderer(options.text), tableRenderer(options.table), jsonRenderer(options.json)];
}
