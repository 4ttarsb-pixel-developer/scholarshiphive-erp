// Shared pieces for Assets, Liabilities and Capital pages: filters, up/down badges, the balance-sheet loader.
import { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus, Droplets, Droplet, Mountain } from 'lucide-react';
import { useLoad } from '../../lib/auth.jsx';
import { qs } from '../../lib/api.js';
import { Card, DateRange, Segmented } from '../../components/ui.jsx';
import { ChartTypePicker, FlexChart } from '../../components/charts.jsx';
import { money } from '../../lib/format.js';

export const LIQ = {
  high: { label: 'High liquid assets', short: 'High liquid', icon: Droplets, color: 'var(--cyan)', hint: 'Cash or turns into cash within days' },
  medium: { label: 'Medium liquid assets', short: 'Medium liquid', icon: Droplet, color: 'var(--orange)', hint: 'Turns into cash within weeks or months' },
  low: { label: 'Low / illiquid assets', short: 'Low / illiquid', icon: Mountain, color: 'var(--purple)', hint: 'Long-term — hard to sell quickly' },
};
export const GROUPS = [{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }, { value: 'quarter', label: 'Quarterly' }, { value: 'year', label: 'Yearly' }];

const pad = n => String(n).padStart(2, '0');
export function last12() {
  const d = new Date();
  const y = d.getMonth() === 11 ? d.getFullYear() : d.getFullYear() - 1;
  const m = d.getMonth() === 11 ? 1 : d.getMonth() + 2;
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: `${y}-${pad(m)}-01`, to: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}` };
}

function readLS(k, f) { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } }
function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

/** Date range + grouping + chart type, remembered per page on this device. */
export function useAnalyticsState(key, defaults = {}) {
  const [s, setS] = useState(() => ({ ...last12(), group: 'month', chart: 'stacked', ...defaults, ...readLS(`sh_an_${key}`, {}) }));
  const set = patch => setS(o => { const n = { ...o, ...patch }; writeLS(`sh_an_${key}`, { group: n.group, chart: n.chart, from: n.from, to: n.to }); return n; });
  return [s, set];
}

export function AnalyticsToolbar({ state, set, charts, right }) {
  return (
    <Card pad={false} className="filter-card">
      <div className="an-toolbar">
        <DateRange from={state.from} to={state.to} onChange={(from, to) => set({ from, to })} />
        <Segmented value={state.group} onChange={g => set({ group: g })} options={GROUPS} />
        <div className="spacer" />
        <ChartTypePicker value={state.chart} onChange={c => set({ chart: c })} allow={charts} />
        {right}
      </div>
    </Card>
  );
}

export function useOverview(state, deps = []) {
  return useLoad(`/finance/overview${qs({ from: state.from, to: state.to, group: state.group })}`, deps);
}

/** ↑ 12.5% / ↓ 3% badge. invert = going up is bad (liabilities). */
export function Delta({ pct, invert, amount }) {
  const v = Number(pct || 0);
  const dir = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
  const I = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
  return <span className={`delta ${dir} ${invert ? 'invert' : ''}`} title={amount !== undefined ? money(amount) : undefined}><I />{Math.abs(v)}%</span>;
}

/** Chart card with a title, and the selected chart type. */
export function ChartCard({ title, subtitle, data, series, type, height = 300, pieData, actions }) {
  return (
    <Card title={title} subtitle={subtitle} actions={actions}>
      <FlexChart data={data} series={series} type={type} height={height} pieData={pieData} />
    </Card>
  );
}

/** Period table: one row per period, with up/down vs the previous period. */
export function PeriodTable({ series, cols, changeKey, invert }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead><tr><th>Period</th>{cols.map(c => <th key={c.key} className="num">{c.label}</th>)}{changeKey && <th className="num">Up / down</th>}</tr></thead>
        <tbody>
          {series.length ? [...series].reverse().map(r => (
            <tr key={r.key}><td>{r.label}</td>{cols.map(c => <td key={c.key} className="num">{money(r[c.key])}</td>)}{changeKey && <td className="num"><Delta pct={r[changeKey]} invert={invert} /></td>}</tr>
          )) : <tr><td colSpan={cols.length + 2} className="tbl-empty">No data for this period</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
