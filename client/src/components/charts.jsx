import { useEffect, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, LineChart, AreaChart, Area, BarChart } from 'recharts';
import { axisMoney, money, monthName } from '../lib/format.js';
import { ChartColumn, ChartBar, ChartLine, ChartArea, ChartPie, ChartColumnStacked } from 'lucide-react';
import { Legend as RLegend } from 'recharts';

/** Reads the current theme colours so charts switch between light and neon automatically. */
export function useColors() {
  const read = () => {
    const s = getComputedStyle(document.documentElement);
    const g = k => s.getPropertyValue(k).trim();
    return { c1: g('--chart-1'), c2: g('--chart-2'), c3: g('--chart-3'), c4: g('--chart-4'), c5: g('--chart-5'), c6: g('--chart-6'), grid: g('--grid'), muted: g('--muted'), surface: g('--surface'), dark: document.documentElement.getAttribute('data-theme') === 'dark' };
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setC(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return c;
}
export const palette = c => [c.c1, c.c2, c.c3, c.c4, c.c5, c.c6];

const tip = { formatter: v => money(v), labelFormatter: l => (/^\d{4}-\d{2}$/.test(l) ? monthName(l) : l) };
const mLabel = v => (/^\d{4}-\d{2}$/.test(v) ? monthName(v, true) : v);
const glow = (c, color) => (c.dark ? { filter: `drop-shadow(0 0 4px ${color})` } : undefined);

/** bars: [{key,label,color}], lines: [{key,label,color}] */
export function BarsLines({ data, bars = [], lines = [], height = 280, xKey = 'month', yFormatter = axisMoney, percentAxis }) {
  const c = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickFormatter={mLabel} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickFormatter={yFormatter} tickLine={false} axisLine={false} width={56} />
        {percentAxis && <YAxis yAxisId="pct" orientation="right" tickFormatter={v => v + '%'} tickLine={false} axisLine={false} width={40} />}
        <Tooltip {...tip} formatter={(v, n, p) => (p?.dataKey === 'rate' ? v + '%' : money(v))} cursor={{ fill: c.grid }} />
        {bars.map(b => <Bar key={b.key} dataKey={b.key} name={b.label} fill={b.color} radius={[4, 4, 0, 0]} maxBarSize={18} style={glow(c, b.color)} />)}
        {lines.map(l => <Line key={l.key} yAxisId={l.pct ? 'pct' : 0} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} strokeWidth={2.4} dot={{ r: 3 }} style={glow(c, l.color)} />)}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, height = 220, center, centerSub, onSelect, active }) {
  const c = useColors();
  const colors = data.map((d, i) => d.color || palette(c)[i % 6]);
  const total = data.reduce((a, d) => a + Number(d.value || 0), 0);
  return (
    <div style={{ position: 'relative', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={total ? data : [{ name: 'No data', value: 1 }]} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" animationDuration={600} paddingAngle={total ? 2 : 0} stroke="none"
            onClick={total && onSelect ? (d => onSelect(d?.payload || d)) : undefined} cursor={total && onSelect ? 'pointer' : undefined}>
            {(total ? data : [{}]).map((d, i) => <Cell key={i} fill={total ? colors[i] : c.grid} opacity={active && total && String(d.id ?? d.name) !== String(active) ? 0.35 : 1} style={total ? glow(c, colors[i]) : undefined} />)}
          </Pie>
          {total > 0 && <Tooltip formatter={v => money(v)} />}
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
        <div><div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{center}</div><div className="small muted">{centerSub}</div></div>
      </div>
    </div>
  );
}

export function TrendLine({ data, dataKey, color, height = 220, xKey = 'month', percent, area }) {
  const c = useColors();
  const col = color || c.c2;
  const Chart = area ? AreaChart : LineChart;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 10, right: 10, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickFormatter={mLabel} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickFormatter={percent ? v => v + '%' : axisMoney} tickLine={false} axisLine={false} width={48} domain={percent ? [0, 100] : ['auto', 'auto']} />
        <Tooltip formatter={v => (percent ? v + '%' : money(v))} labelFormatter={tip.labelFormatter} />
        {area ? <Area type="monotone" dataKey={dataKey} stroke={col} fill={col} fillOpacity={0.15} strokeWidth={2.4} style={glow(c, col)} />
          : <Line type="monotone" dataKey={dataKey} stroke={col} strokeWidth={2.6} dot={{ r: 3.5, fill: col }} style={glow(c, col)} />}
      </Chart>
    </ResponsiveContainer>
  );
}

export function SimpleBars({ data, keys, height = 240, xKey = 'month', stacked }) {
  const c = useColors();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickFormatter={mLabel} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={56} />
        <Tooltip {...tip} cursor={{ fill: c.grid }} />
        {keys.map(k => <Bar key={k.key} dataKey={k.key} name={k.label} fill={k.color} stackId={stacked ? 'a' : undefined} radius={stacked ? 0 : [4, 4, 0, 0]} maxBarSize={22} style={glow(c, k.color)} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal share bars (Revenue by package/country). Click a row to filter when onSelect is given. */
export function ShareList({ items, colorIndex = 0, render, onSelect, active }) {
  const c = useColors();
  const pal = palette(c);
  const max = Math.max(1, ...items.map(i => Number(i.value)));
  if (!items.length) return <div className="muted small" style={{ padding: '18px 0', textAlign: 'center' }}>No data for this period</div>;
  return items.map((it, i) => (
    <div key={(it.id ?? '') + it.name} className={`share-row ${onSelect ? 'clickable' : ''} ${active && String(it.id ?? it.name) === String(active) ? 'on' : ''} ${active && String(it.id ?? it.name) !== String(active) ? 'dim' : ''}`}
      style={{ padding: '8px 0' }} onClick={onSelect ? () => onSelect(it) : undefined} role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined}
      onKeyDown={onSelect ? e => { if (e.key === 'Enter') onSelect(it); } : undefined}>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: '.84rem' }}>
        <span className="row" style={{ gap: 8 }}>{render ? render(it) : it.name}</span>
        <span className="mono"><b>{money(it.value)}</b>{it.share !== undefined && <span className="muted" style={{ marginLeft: 8 }}>{it.share}%</span>}</span>
      </div>
      <div className="bar"><span style={{ width: `${(Number(it.value) / max) * 100}%`, background: pal[(i + colorIndex) % 6], color: pal[(i + colorIndex) % 6] }} /></div>
    </div>
  ));
}

// ═════════ v4: one chart, many looks (column / row / line / area / stacked / pie) ═════════

export const CHART_TYPES = [
  { value: 'column', label: 'Column chart', icon: ChartColumn },
  { value: 'row', label: 'Row (horizontal bar) chart', icon: ChartBar },
  { value: 'line', label: 'Line chart', icon: ChartLine },
  { value: 'area', label: 'Area chart', icon: ChartArea },
  { value: 'stacked', label: 'Stacked column chart', icon: ChartColumnStacked },
  { value: 'pie', label: 'Pie chart', icon: ChartPie },
];

export function ChartTypePicker({ value, onChange, allow }) {
  const list = allow ? CHART_TYPES.filter(t => allow.includes(t.value)) : CHART_TYPES;
  return (
    <div className="chart-types" role="radiogroup" aria-label="Chart type">
      {list.map(t => <button key={t.value} type="button" role="radio" aria-checked={value === t.value} className={value === t.value ? 'on' : ''} title={t.label} aria-label={t.label} onClick={() => onChange(t.value)}><t.icon /></button>)}
    </div>
  );
}

/**
 * series: [{ key, label, color }]; data rows have xKey + one value per series key.
 * type 'pie' shows each series' value from the LAST row (position) unless pieData is given.
 */
export function FlexChart({ data, series, type = 'column', xKey = 'label', height = 300, pieData, legend = true }) {
  const c = useColors();
  const pal = palette(c);
  // CSS variables (var(--chart-3)) are turned into real colours so SVG + glow work in every browser
  const resolve = col => { if (!col || !String(col).startsWith('var(')) return col; const k = String(col).slice(4, -1).trim(); return getComputedStyle(document.documentElement).getPropertyValue(k).trim() || col; };
  void c.dark; // re-render on theme change (useColors) also refreshes resolved colours
  const cols = series.map((s, i) => ({ ...s, color: resolve(s.color) || pal[i % 6] }));
  const tipMoney = { formatter: v => money(v), cursor: { fill: c.grid } };
  if (!data?.length && !pieData?.length) return <div className="muted small" style={{ padding: '40px 0', textAlign: 'center' }}>No data for this period</div>;
  if (type === 'pie') {
    const last = data?.[data.length - 1] || {};
    const pd = (pieData || cols.map(s => ({ name: s.label, value: Math.max(0, Number(last[s.key] || 0)), color: s.color }))).map(d => ({ ...d, color: resolve(d.color) })).filter(d => d.value > 0);
    const total = pd.reduce((a, d) => a + d.value, 0);
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 10 }}>
        <Donut data={pd} height={height - 60} center={money(total, { short: true })} centerSub="Total" />
        <div className="legend" style={{ justifyContent: 'center' }}>{pd.map((d, i) => <span key={d.name}><i style={{ background: d.color || pal[i % 6] }} />{d.name} · {total ? Math.round((d.value / total) * 1000) / 10 : 0}%</span>)}</div>
      </div>
    );
  }
  const common = { data, margin: { top: 10, right: 12, left: type === 'row' ? 10 : -6, bottom: 0 } };
  const lg = legend && cols.length > 1 ? <RLegend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} /> : null;
  if (type === 'line' || type === 'area') {
    const Chart = type === 'area' ? AreaChart : LineChart;
    return (
      <ResponsiveContainer width="100%" height={height}>
        <Chart {...common}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
          <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={56} />
          <Tooltip formatter={v => money(v)} />
          {lg}
          {cols.map(s => (type === 'area'
            ? <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.14} strokeWidth={2.2} style={glow(c, s.color)} />
            : <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.4} dot={{ r: 2.5 }} activeDot={{ r: 5 }} style={glow(c, s.color)} />))}
        </Chart>
      </ResponsiveContainer>
    );
  }
  const row = type === 'row';
  const stacked = type === 'stacked';
  return (
    <ResponsiveContainer width="100%" height={row ? Math.max(height, 34 + data.length * (22 + cols.length * 6)) : height}>
      <BarChart {...common} layout={row ? 'vertical' : 'horizontal'}>
        <CartesianGrid vertical={row} horizontal={!row} strokeDasharray="3 3" />
        {row ? <><XAxis type="number" tickFormatter={axisMoney} tickLine={false} axisLine={false} /><YAxis type="category" dataKey={xKey} tickLine={false} axisLine={false} width={86} /></>
          : <><XAxis dataKey={xKey} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={6} /><YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={56} /></>}
        <Tooltip {...tipMoney} />
        {lg}
        {cols.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? 'a' : undefined} maxBarSize={row ? 16 : 22}
          radius={stacked ? (i === cols.length - 1 ? [4, 4, 0, 0] : 0) : row ? [0, 4, 4, 0] : [4, 4, 0, 0]} style={glow(c, s.color)} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}
