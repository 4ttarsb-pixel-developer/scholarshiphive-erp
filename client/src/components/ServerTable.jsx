import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Inbox, Loader2 } from 'lucide-react';
import { money } from '../lib/format.js';

/**
 * Table whose paging / sorting happens on the server.
 * data: { rows, total, page, pages, limit, sort, dir }
 * columns: [{ key, label, sort (server sort key), render(row), money, align, width, className }]
 */
export default function ServerTable({
  columns, data, loading, query, onQuery, onRowClick, empty = 'No records found.', footer, selectable, selected, onSelect, canSelect,
  pageSizes = [10, 25, 50, 100], skeletonRows = 6, compact, maxHeight,
}) {
  const rows = data?.rows || [];
  const total = data?.total || 0;
  const page = data?.page || query?.page || 1;
  const pages = data?.pages || 1;
  const limit = data?.limit || query?.limit || 25;
  const sort = data?.sort || query?.sort;
  const dir = data?.dir || query?.dir;
  const sel = selected || new Set();
  const selectableRows = selectable ? rows.filter(r => !canSelect || canSelect(r)) : [];
  const allOn = selectableRows.length > 0 && selectableRows.every(r => sel.has(r.id));
  const toggleAll = () => {
    const next = new Set(sel);
    if (allOn) selectableRows.forEach(r => next.delete(r.id)); else selectableRows.forEach(r => next.add(r.id));
    onSelect?.(next);
  };
  const toggle = (r, e) => {
    e.stopPropagation();
    const next = new Set(sel);
    if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
    onSelect?.(next);
  };
  const clickSort = c => {
    if (!c.sort || !onQuery) return;
    onQuery({ sort: c.sort, dir: sort === c.sort && dir === 'desc' ? 'asc' : 'desc' });
  };
  const colCount = columns.length + (selectable ? 1 : 0);
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(total, page * limit);
  const nums = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  const first = !data && loading;

  return (
    <div className="st">
      <div className="table-wrap st-wrap" style={maxHeight ? { maxHeight } : undefined}>
        <table className={`tbl ${compact ? 'tbl-compact' : ''}`}>
          <thead>
            <tr>
              {selectable && <th className="chk"><input type="checkbox" aria-label="Select all on this page" checked={allOn} onChange={toggleAll} disabled={!selectableRows.length} /></th>}
              {columns.map(c => (
                <th key={c.key} style={{ width: c.width }} className={`${c.className || ''} ${c.money || c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : ''} ${c.sort ? 'sortable' : ''} ${sort === c.sort && c.sort ? 'sorted' : ''}`}
                  onClick={() => clickSort(c)} aria-sort={sort === c.sort ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.label}{c.sort && <span className="sort-ind">{sort === c.sort ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {first ? Array.from({ length: skeletonRows }, (_, i) => (
              <tr key={'s' + i}>{Array.from({ length: colCount }, (__, j) => <td key={j}><div className="skel" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} /></td>)}</tr>
            )) : rows.length ? rows.map(r => {
              const can = selectable && (!canSelect || canSelect(r));
              return (
                <tr key={r.id ?? r.ref_no} className={`${onRowClick ? 'clickable' : ''} ${sel.has(r.id) ? 'selected' : ''}`} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                  {selectable && <td className="chk" onClick={e => e.stopPropagation()}>{can ? <input type="checkbox" aria-label={`Select ${r.ref_no || r.id}`} checked={sel.has(r.id)} onChange={e => toggle(r, e)} /> : null}</td>}
                  {columns.map(c => <td key={c.key} className={`${c.money || c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : c.wrap ? 'wrap' : ''} ${c.className || ''}`}>{c.render ? c.render(r) : c.money ? money(r[c.key]) : (r[c.key] ?? '—')}</td>)}
                </tr>
              );
            }) : <tr><td colSpan={colCount} className="tbl-empty"><Inbox />{empty}</td></tr>}
          </tbody>
          {footer && rows.length > 0 && <tfoot>{footer(data)}</tfoot>}
        </table>
      </div>
      {loading && data && <div className="st-overlay" aria-hidden="true"><Loader2 /></div>}
      {onQuery && (
        <div className="pager">
          <span>{total ? <>Showing <b dir="ltr">{from.toLocaleString()}–{to.toLocaleString()}</b> of <b>{total.toLocaleString()}</b></> : 'No records'}</span>
          <div className="row" style={{ gap: 6 }}>
            <label className="row small" style={{ gap: 6 }}>Rows
              <select className="pg-size" value={limit} onChange={e => onQuery({ limit: Number(e.target.value) })} aria-label="Rows per page">
                {pageSizes.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="pages">
              <button type="button" className="pg" disabled={page <= 1} onClick={() => onQuery({ page: 1 })} aria-label="First page"><ChevronsLeft size={14} /></button>
              <button type="button" className="pg" disabled={page <= 1} onClick={() => onQuery({ page: page - 1 })} aria-label="Previous page"><ChevronLeft size={14} /></button>
              {nums.map(n => <button type="button" key={n} className={`pg ${n === page ? 'on' : ''}`} onClick={() => onQuery({ page: n })} aria-current={n === page ? 'page' : undefined}>{n}</button>)}
              <button type="button" className="pg" disabled={page >= pages} onClick={() => onQuery({ page: page + 1 })} aria-label="Next page"><ChevronRight size={14} /></button>
              <button type="button" className="pg" disabled={page >= pages} onClick={() => onQuery({ page: pages })} aria-label="Last page"><ChevronsRight size={14} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** In-card tab buttons (from the Revenue Manager design) with counts. */
export function CardTabs({ value, onChange, tabs, right }) {
  return (
    <div className="ctabs" role="tablist">
      {tabs.map(t => (
        <button type="button" role="tab" aria-selected={value === t.value} key={t.value} className={`ctab ${value === t.value ? 'on' : ''} ${t.tone ? 'tone-' + t.tone : ''}`} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon size={15} />}{t.label}{t.count !== undefined && <span className="n">{t.count}</span>}
        </button>
      ))}
      {right && <div className="ctabs-right">{right}</div>}
    </div>
  );
}

/** Active-filter chips; click to remove one. */
export function FilterChips({ items, onClear }) {
  const list = items.filter(i => i.value);
  if (!list.length) return null;
  return (
    <div className="drill">
      <span className="muted">Filtered by:</span>
      {list.map(i => <button type="button" key={i.key} className="drill-chip" onClick={() => i.onRemove()} title="Remove this filter">{i.label}: {i.value} <span aria-hidden="true">×</span></button>)}
      {onClear && list.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>Clear all</button>}
    </div>
  );
}
