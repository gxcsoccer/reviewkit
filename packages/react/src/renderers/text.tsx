/**
 * Text renderer (PRD 9.1: "Text: line or word level diff").
 *
 * Unified line view with word-level highlighting inside reworded lines — the
 * shape reviewers already know from code review. Text is rendered into text nodes
 * only: agent-provided markup is data, never markup (PRD 12.9, 20).
 */
import { diffText, itemAsText, sanitizeText, type TextDiffLine } from '@reviewkit/core';
import type { DiffRenderer, DiffRendererContext } from './types.js';

export interface TextRendererOptions {
  /** `word` also highlights inside a changed line. Default `word`. */
  granularity?: 'line' | 'word';
  /** Lines of unchanged context kept around each change in the "only changes" view. Default 2. */
  contextLines?: number;
  /** Guard against pathological payloads; see core's `diffText`. */
  maxCells?: number;
}

const SIGN: Record<TextDiffLine['op'], string> = { equal: ' ', insert: '+', delete: '-' };

/** Keep `contextLines` unchanged lines around every change; collapse the rest. */
function windowed(lines: TextDiffLine[], contextLines: number): Array<TextDiffLine | 'gap'> {
  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.op === 'equal') return;
    for (let i = index - contextLines; i <= index + contextLines; i++) {
      if (i >= 0 && i < lines.length) keep.add(i);
    }
  });
  if (keep.size === lines.length) return lines;

  const out: Array<TextDiffLine | 'gap'> = [];
  let gapOpen = false;
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      out.push(line);
      gapOpen = false;
    } else if (!gapOpen) {
      out.push('gap');
      gapOpen = true;
    }
  });
  return out;
}

function TextDiffView({
  context,
  options,
}: {
  context: DiffRendererContext;
  options: TextRendererOptions;
}): React.ReactElement {
  const { item, analysis, onlyChanges, t } = context;
  const granularity = options.granularity ?? 'word';
  const contextLines = options.contextLines ?? 2;

  const diff =
    analysis.kind === 'text'
      ? analysis.diff
      : diffText(itemAsText(item.before), itemAsText(item.after), {
          granularity,
          ...(options.maxCells === undefined ? {} : { maxCells: options.maxCells }),
        });

  const rows = onlyChanges ? windowed(diff.lines, contextLines) : diff.lines;

  if (diff.lines.length === 0) {
    return <p className="rk-empty">{t('change.unchanged')}</p>;
  }

  return (
    <div className="rk-diff rk-diff--text" role="group" aria-label={t('a11y.diff')}>
      {diff.summary.truncated ? <p className="rk-notice rk-notice--warn">{t('label.diff')}: {diff.summary.added + diff.summary.removed}</p> : null}
      <ol className="rk-text-diff">
        {rows.map((row, index) =>
          row === 'gap' ? (
            <li key={`gap-${index}`} className="rk-text-diff__gap" aria-hidden="true">
              ⋯
            </li>
          ) : (
            <li key={`${row.op}-${row.beforeLine ?? 'x'}-${row.afterLine ?? 'x'}-${index}`} className={`rk-text-diff__line rk-text-diff__line--${row.op}`} data-rk-change={row.op}>
              <span className="rk-text-diff__gutter" aria-hidden="true">
                {row.beforeLine ?? ''}
              </span>
              <span className="rk-text-diff__gutter" aria-hidden="true">
                {row.afterLine ?? ''}
              </span>
              <span className="rk-text-diff__sign">{SIGN[row.op]}</span>
              <span className="rk-text-diff__text">
                {granularity === 'word' && row.words ? (
                  row.words.map((word, wordIndex) => (
                    <span key={wordIndex} className={`rk-word rk-word--${word.op}`}>
                      {sanitizeText(word.text)}
                    </span>
                  ))
                ) : (
                  sanitizeText(row.text)
                )}
              </span>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

/** Line/word-level text renderer. Claims `text` items. */
export function textRenderer(options: TextRendererOptions = {}): DiffRenderer {
  return {
    name: 'text',
    kinds: ['text'],
    render: (context) => <TextDiffView context={context} options={options} />,
  };
}
