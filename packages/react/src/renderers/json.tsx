/**
 * JSON renderer (PRD 9.1: "JSON: field-level add, delete and modify").
 *
 * Renders a three-column table — field, before, after — one row per changed leaf.
 * Values are printed with `formatValue`, which strips control characters; nothing
 * is ever injected as HTML (PRD 12.9).
 */
import { DEFAULT_MASK, diffJson, formatValue, isMasked, type JsonChange } from '@reviewkit/core';
import type { DiffRenderer, DiffRendererContext } from './types.js';

export interface JsonRendererOptions {
  /** Show unchanged leaves even in the "only changed fields" view. Default false. */
  includeUnchanged?: boolean;
  /** Truncate each printed value at this length. Default 240. */
  maxValueLength?: number;
}

function JsonDiffTable({
  context,
  options,
}: {
  context: DiffRendererContext;
  options: JsonRendererOptions;
}): React.ReactElement {
  const { item, analysis, redaction, onlyChanges, t } = context;
  const maxValueLength = options.maxValueLength ?? 240;
  const mask = redaction?.mask ?? DEFAULT_MASK;

  const changes: JsonChange[] =
    analysis.kind === 'json' && onlyChanges && !options.includeUnchanged
      ? analysis.changes
      : diffJson(item.before, item.after, { includeUnchanged: true });

  const show = (change: JsonChange, side: 'before' | 'after'): string => {
    const value = side === 'before' ? change.before : change.after;
    if (value === undefined) return '—';
    // Masking is display-only: the execution payload keeps the real value.
    if (isMasked(change.path, redaction)) return mask;
    return formatValue(value, maxValueLength) || '""';
  };

  if (changes.length === 0) {
    return <p className="rk-empty">{t('change.unchanged')}</p>;
  }

  return (
    <table className="rk-diff rk-diff--json">
      <caption className="rk-sr-only">{t('a11y.diff')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('label.field')}</th>
          <th scope="col">{t('label.before')}</th>
          <th scope="col">{t('label.after')}</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((change) => (
          <tr key={change.path} data-rk-change={change.kind} className={`rk-diff__row rk-diff__row--${change.kind}`}>
            <th scope="row">
              <code className="rk-path">{change.path}</code>
              {isMasked(change.path, redaction) ? (
                <span className="rk-tag rk-tag--masked">{mask}</span>
              ) : null}
            </th>
            <td className="rk-diff__before">
              <span>{show(change, 'before')}</span>
            </td>
            <td className="rk-diff__after">
              <span>{show(change, 'after')}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Field-level JSON renderer. Claims `json` items, and anything unclaimed. */
export function jsonRenderer(options: JsonRendererOptions = {}): DiffRenderer {
  return {
    name: 'json',
    kinds: ['json', '*'],
    render: (context) => <JsonDiffTable context={context} options={options} />,
  };
}
