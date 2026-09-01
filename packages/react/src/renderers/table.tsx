/**
 * Table renderer (PRD 9.1: "Table: record and cell level changes, bulk selection
 * and filtering").
 *
 * One row per record, one cell per column, changed cells highlighted. Rows can be
 * filtered (all / changed / added / removed / text match) and selected; selection
 * is reported through `onSelectionChange` so a host can act on a subset of records
 * without the renderer knowing anything about the host's domain.
 */
import { useMemo, useState } from 'react';
import { DEFAULT_MASK, diffTable, formatValue, isMasked, type TableRowDiff } from '@reviewkit/core';
import type { DiffRenderer, DiffRendererContext } from './types.js';

export type TableRowFilter = 'all' | 'changed' | 'added' | 'removed';

export interface TableRendererOptions {
  /** Column used to pair rows. Auto-detected when omitted. */
  key?: string;
  /** Explicit column order. */
  columns?: string[];
  /** Rows rendered before the "show all" affordance. Default 50 (PRD 13: fast first paint). */
  pageSize?: number;
  /** Called with the selected record keys whenever selection changes. */
  onSelectionChange?: (itemId: string, keys: string[]) => void;
  /** Hide the selection column entirely. */
  selectable?: boolean;
}

function matchesFilter(row: TableRowDiff, filter: TableRowFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'changed') return row.kind !== 'unchanged';
  return row.kind === filter;
}

function TableDiffView({
  context,
  options,
}: {
  context: DiffRendererContext;
  options: TableRendererOptions;
}): React.ReactElement {
  const { item, analysis, redaction, onlyChanges, t } = context;
  const pageSize = options.pageSize ?? 50;
  const selectable = options.selectable ?? true;
  const mask = redaction?.mask ?? DEFAULT_MASK;

  const diff = useMemo(
    () =>
      analysis.kind === 'table'
        ? analysis.diff
        : diffTable(item.before, item.after, {
            ...(options.key === undefined ? {} : { key: options.key }),
            ...(options.columns === undefined ? {} : { columns: options.columns }),
          }),
    [analysis, item.before, item.after, options.key, options.columns],
  );

  const [filter, setFilter] = useState<TableRowFilter>(onlyChanges ? 'changed' : 'all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return diff.rows.filter((row) => {
      if (!matchesFilter(row, filter)) return false;
      if (!needle) return true;
      const haystack = [row.key, ...diff.columns.map((column) => formatValue(row.after?.[column] ?? row.before?.[column]))]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [diff, filter, query]);

  const visible = expanded ? rows : rows.slice(0, pageSize);

  const applySelection = (next: Set<string>): void => {
    setSelected(next);
    options.onSelectionChange?.(item.id, [...next]);
  };

  const toggleRow = (key: string): void => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    applySelection(next);
  };

  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.key));

  // Row-qualified path, so both `email` and `**.email` style patterns match
  // (see core's `pathMatches`). Masking is display-only; the payload keeps the value.
  const cellText = (row: TableRowDiff, column: string, side: 'before' | 'after'): string => {
    const source = side === 'before' ? row.before : row.after;
    const value = source?.[column];
    if (value === undefined) return '—';
    if (isMasked(`${row.key}.${column}`, redaction)) return mask;
    return formatValue(value, 120) || '""';
  };

  return (
    <div className="rk-diff rk-diff--table">
      <div className="rk-table-toolbar">
        <label className="rk-field rk-field--inline">
          <span className="rk-sr-only">{t('label.filters')}</span>
          <select
            className="rk-select"
            value={filter}
            onChange={(event) => setFilter(event.target.value as TableRowFilter)}
            aria-label={t('label.filters')}
          >
            <option value="changed">{t('action.onlyChanges')}</option>
            <option value="all">{t('action.allFields')}</option>
            <option value="added">{t('change.added')}</option>
            <option value="removed">{t('change.removed')}</option>
          </select>
        </label>
        <label className="rk-field rk-field--inline">
          <span className="rk-sr-only">{t('label.search')}</span>
          <input
            className="rk-input"
            type="search"
            value={query}
            placeholder={t('label.search')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="rk-table-toolbar__summary">
          {t('label.rows')}: {rows.length}/{diff.rows.length}
          {selectable && selected.size > 0 ? ` · ${t('label.selected', { count: selected.size })}` : ''}
        </span>
        {selectable && selected.size > 0 ? (
          <button type="button" className="rk-button rk-button--ghost" onClick={() => applySelection(new Set())}>
            {t('action.clearSelection')}
          </button>
        ) : null}
      </div>

      <table className="rk-table">
        <caption className="rk-sr-only">{t('a11y.diff')}</caption>
        <thead>
          <tr>
            {selectable ? (
              <th scope="col" className="rk-table__select">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  aria-label={t('action.selectAll')}
                  onChange={() =>
                    applySelection(allVisibleSelected ? new Set() : new Set(visible.map((row) => row.key)))
                  }
                />
              </th>
            ) : null}
            <th scope="col">{diff.keyField === '__index__' ? '#' : diff.keyField}</th>
            {diff.columns
              .filter((column) => column !== diff.keyField)
              .map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.key} data-rk-change={row.kind} className={`rk-table__row rk-table__row--${row.kind}`}>
              {selectable ? (
                <td className="rk-table__select">
                  <input
                    type="checkbox"
                    checked={selected.has(row.key)}
                    aria-label={t('a11y.selectItem', { id: row.key })}
                    onChange={() => toggleRow(row.key)}
                  />
                </td>
              ) : null}
              <th scope="row">
                <code className="rk-path">{row.key}</code>
              </th>
              {diff.columns
                .filter((column) => column !== diff.keyField)
                .map((column) => {
                  const cell = row.cells.find((candidate) => candidate.column === column);
                  const kind = cell?.kind ?? 'unchanged';
                  return (
                    <td key={column} data-rk-change={kind} className={`rk-table__cell rk-table__cell--${kind}`}>
                      {kind === 'changed' ? (
                        <>
                          <span className="rk-cell-before">{cellText(row, column, 'before')}</span>
                          <span className="rk-cell-arrow" aria-hidden="true">
                            →
                          </span>
                          <span className="rk-cell-after">{cellText(row, column, 'after')}</span>
                        </>
                      ) : (
                        <span>{cellText(row, column, row.kind === 'removed' ? 'before' : 'after')}</span>
                      )}
                    </td>
                  );
                })}
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 ? <p className="rk-empty">{t('change.unchanged')}</p> : null}
      {!expanded && rows.length > visible.length ? (
        <button type="button" className="rk-button rk-button--ghost" onClick={() => setExpanded(true)}>
          {t('label.rows')}: {visible.length}/{rows.length} — {t('action.open')}
        </button>
      ) : null}
    </div>
  );
}

/** Record/cell-level table renderer with row filtering and bulk selection. */
export function tableRenderer(options: TableRendererOptions = {}): DiffRenderer {
  return {
    name: 'table',
    kinds: ['table'],
    render: (context) => <TableDiffView context={context} options={options} />,
  };
}
