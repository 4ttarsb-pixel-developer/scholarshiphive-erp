import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadFile, qs } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Card, DemoTag, ErrorBox, Field, Header, Kpi, Kpis, Loading, Modal, MonthPicker, MoneySpan, Person, Table, useAction, useUi } from '../components/ui.jsx';
import { label, money, money2, pct, shortDate, todayDate } from '../format.js';

/** Exact commission rule from the brief: PKR = amount × % / 100 (half-up, 2 decimals). Server recomputes and is authoritative. */
function previewCommission(amount, rate) {
  const a = Number(amount); const r = Number(rate);
  if (!Number.isFinite(a) || !Number.isFinite(r) || a <= 0 || r < 0) return 0;
  return Math.round((a * r / 100 + Number.EPSILON) * 100) / 100;
}

export function SaleForm({ initial, onClose, onSaved }) {
  const { can, month } = useApp();
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const editing = !!initial;
  const employees = useQuery({ queryKey: ['employees', 'active'], queryFn: () => api.get('/api/employees') });
  const defaultDate = month === todayDate().slice(0, 7) ? todayDate() : `${month}-01`;
  const [f, setF] = useState(() => (initial ? {
    employeeId: String(initial.employeeId), saleReference: initial.saleReference, saleDate: initial.saleDate, saleAmount: initial.saleAmount,
    units: initial.units ?? '', commissionMethod: initial.commissionMethod, manualRatePercent: initial.commissionMethod === 'MANUAL_PERCENT' ? initial.appliedRatePercent : '',
    notes: initial.notes || '', verifyNow: false, isDemo: initial.isDemo,
  } : { employeeId: '', saleReference: '', saleDate: defaultDate, saleAmount: '', units: '1', commissionMethod: 'FIXED_EMPLOYEE', manualRatePercent: '', notes: '', verifyNow: false, isDemo: false }));
  const [error, setError] = useState('');
  const settings = useQuery({
    queryKey: ['commission-settings', f.employeeId],
    queryFn: () => api.get(`/api/commission-settings/${f.employeeId}`),
    enabled: !!f.employeeId,
  });
  const savedRate = settings.data?.fixedRatePercent;
  // A FIXED sale being edited keeps its historical applied rate unless the employee changes.
  const keepHistorical = editing && initial.commissionMethod === 'FIXED_EMPLOYEE' && f.commissionMethod === 'FIXED_EMPLOYEE' && String(initial.employeeId) === f.employeeId;
  const fixedRate = keepHistorical ? initial.appliedRatePercent : savedRate;
  const rate = f.commissionMethod === 'FIXED_EMPLOYEE' ? fixedRate : f.manualRatePercent;
  const commission = previewCommission(f.saleAmount, rate);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  useEffect(() => { setError(''); }, [f.employeeId, f.commissionMethod]);

  const submit = async (e) => {
    e.preventDefault();
    if (f.commissionMethod === 'FIXED_EMPLOYEE' && (fixedRate === null || fixedRate === undefined)) {
      setError('This employee has no fixed commission percentage yet. Set it in Commissions › Employee commission settings, or choose Manual Percentage.');
      return;
    }
    const body = {
      employeeId: Number(f.employeeId), saleReference: f.saleReference.trim(), saleDate: f.saleDate, saleAmount: f.saleAmount,
      units: f.units === '' ? null : Number(f.units), commissionMethod: f.commissionMethod, notes: f.notes, isDemo: f.isDemo,
      ...(f.commissionMethod === 'MANUAL_PERCENT' ? { manualRatePercent: f.manualRatePercent } : {}),
    };
    if (editing) body.version = initial.version;
    else body.verifyNow = f.verifyNow;
    const r = await run(() => (editing ? api.patch(`/api/revenue/${initial.id}`, body) : api.post('/api/revenue', body)),
      (res) => `${editing ? 'Sale updated' : 'Sale saved'} · ${res.saleReference}: commission ${money2(res.commissionAmount)} at ${res.appliedRatePercent}%${res.status === 'Verified' ? ' — payroll updated automatically.' : ' — counts once verified.'}`);
    if (r) { qc.invalidateQueries(); onSaved && onSaved(r); onClose(); }
  };

  return (
    <Modal title={editing ? `Edit sale ${initial.saleReference}` : 'Record a sale'} onClose={onClose} width={780}>
      <p className="sub">Both methods are a <b>percentage of the sale amount</b>. <b>Fixed Employee Commission</b> uses the employee’s saved percentage (read-only here); <b>Manual Percentage</b> lets you enter the rate for this sale.</p>
      <form onSubmit={submit}>
        <div className="formgrid">
          <Field label="Employee">
            <select value={f.employeeId} onChange={set('employeeId')} required>
              <option value="">Select employee…</option>
              {(employees.data || []).map((e) => <option key={e.id} value={e.id}>{e.fullName} — {e.employeeCode}{e.isDemo ? ' (DEMO)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Sale date"><input type="date" value={f.saleDate} onChange={set('saleDate')} required /></Field>
          <Field label="Unique reference number"><input value={f.saleReference} onChange={set('saleReference')} required minLength={3} maxLength={80} placeholder="e.g. CRM-ORDER-1234" readOnly={editing} className={editing ? 'readonly' : ''} /></Field>
          <Field label="Sale amount (PKR)"><input type="number" min="0.01" step="0.01" value={f.saleAmount} onChange={set('saleAmount')} required placeholder="100000" /></Field>
          <Field label="Number of sales (optional)"><input type="number" min="1" step="1" value={f.units} onChange={set('units')} /></Field>
          <Field label="Commission method">
            <select value={f.commissionMethod} onChange={set('commissionMethod')} aria-label="Commission method">
              <option value="FIXED_EMPLOYEE">Fixed Employee Commission</option>
              <option value="MANUAL_PERCENT">Manual Percentage</option>
            </select>
          </Field>
          {f.commissionMethod === 'FIXED_EMPLOYEE' ? (
            <Field label="Applied commission percentage (%)" hint={keepHistorical ? 'Historical rate of this sale (preserved)' : 'Loaded from the employee’s saved fixed rate'}>
              <input readOnly className="readonly" value={!f.employeeId ? '' : settings.isLoading ? 'Loading…' : fixedRate === null || fixedRate === undefined ? 'Not configured' : fixedRate} title="Saved employee fixed percentage (read-only)" />
            </Field>
          ) : (
            <Field label="Applied commission percentage (%)" hint="Any permitted percentage, up to 3 decimals">
              <input type="number" min="0" max="100" step="0.001" value={f.manualRatePercent} onChange={set('manualRatePercent')} required placeholder="e.g. 5" />
            </Field>
          )}
          <div className="field full"><span>Calculated commission (PKR)</span>
            <div className="notice good" style={{ margin: 0 }}>
              <span className="calc-preview">{money2(commission)}</span>
              <span className="tiny" style={{ marginLeft: 10 }}>{f.saleAmount ? `${money(f.saleAmount)} × ${rate === '' || rate === null || rate === undefined ? '—' : `${rate}%`} ÷ 100` : 'Enter a sale amount'}</span>
            </div>
          </div>
          <Field label="Notes (optional)" full><input value={f.notes} onChange={set('notes')} maxLength={1000} /></Field>
        </div>
        {!editing && (
          <div className="controls" style={{ marginTop: 12 }}>
            {can('revenue.verify') && <label className="inline-check"><input type="checkbox" checked={f.verifyNow} onChange={set('verifyNow')} /> Verify immediately (authorised test/demo entry — production sales should be verified by a reviewer)</label>}
            <label className="inline-check"><input type="checkbox" checked={f.isDemo} onChange={set('isDemo')} /> Mark as DEMO record</label>
          </div>
        )}
        {error && <div className="formerror">{error}</div>}
        <div className="modalfoot"><button className="btn" type="submit" disabled={busy || !f.employeeId}>{editing ? 'Save changes & recalculate' : 'Save sale'}</button></div>
      </form>
    </Modal>
  );
}

export default function Revenue() {
  const { month, setMonth, can } = useApp();
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [run] = useAction();
  const [filters, setFilters] = useState({ employeeId: 'all', status: '', search: '' });
  const [modal, setModal] = useState(null);
  const q = useQuery({ queryKey: ['revenue', month, filters.employeeId, filters.status], queryFn: () => api.get(`/api/revenue${qs({ month, employeeId: filters.employeeId, status: filters.status })}`) });
  const employees = useQuery({ queryKey: ['employees', 'active'], queryFn: () => api.get('/api/employees') });
  const rows = useMemo(() => (q.data || []).filter((s) => !filters.search || `${s.saleReference} ${s.employeeName} ${s.employeeCode}`.toLowerCase().includes(filters.search.toLowerCase())), [q.data, filters.search]);
  const verified = rows.filter((s) => s.status === 'Verified');
  const sum = (arr, k) => arr.reduce((a, s) => a + Number(s[k]), 0);

  const act = async (s, action) => {
    let reason = '';
    const needsReason = action !== 'verify';
    const ok = await confirm({
      title: `${action === 'verify' ? 'Verify' : action === 'reject' ? 'Reject' : 'Cancel / reverse'} sale ${s.saleReference}?`,
      danger: action !== 'verify',
      message: action === 'verify' ? `Commission ${money2(s.commissionAmount)} will be added to ${s.employeeName}'s Draft payroll.`
        : action === 'cancel' && s.status === 'Verified' ? 'The commission will be removed from Draft payroll. If this sale was already paid in approved payroll, a pending reversal adjustment is created in the next open month.' : 'This sale will not count towards commission.',
      children: needsReason ? <textarea style={{ marginTop: 10 }} placeholder="Reason (min 5 characters)" onChange={(e) => { reason = e.target.value; }} /> : null,
      confirmText: action === 'verify' ? 'Verify' : action === 'reject' ? 'Reject' : 'Cancel sale',
    });
    if (!ok) return;
    const r = await run(() => api.post(`/api/revenue/${s.id}/${action}`, needsReason ? { reason } : {}), action === 'verify' ? 'Sale verified — commission and payroll updated.' : 'Sale updated; Draft payroll recalculated.');
    if (r) qc.invalidateQueries();
  };

  return (
    <>
      <Header overline="Compensation / revenue" title="Revenue" subtitle="Sales linked to employees. Only Verified revenue earns commission." month={month}>
        <MonthPicker value={month} onChange={setMonth} />
        <button className="btn outline sm" onClick={() => downloadFile(`/api/revenue/export?month=${month}`, `revenue_${month}.csv`)}>Export CSV</button>
        {can('revenue.create') && <button className="btn sm" onClick={() => setModal({ type: 'new' })}>+ Record sale</button>}
      </Header>
      <ErrorBox error={q.error} />
      <Kpis>
        <Kpi label="Verified revenue" value={money(sum(verified, 'saleAmount'))} foot={`${verified.length} verified sale(s)`} />
        <Kpi label="Commission from verified" value={money(sum(verified, 'commissionAmount'))} foot="Flows into Draft payroll automatically" />
        <Kpi label="Pending verification" value={rows.filter((s) => s.status === 'Pending').length} foot={`${money(sum(rows.filter((s) => s.status === 'Pending'), 'commissionAmount'))} potential commission`} />
        <Kpi label="Rejected / cancelled" value={rows.filter((s) => ['Rejected', 'Cancelled'].includes(s.status)).length} foot="Never counted" />
      </Kpis>
      <Card title="Revenue register" sub="Each sale reference is unique in the database, so the same sale can never earn commission twice.">
        <div className="controls no-print">
          <Field label="Employee"><select value={filters.employeeId} onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })}><option value="all">All employees</option>{(employees.data || []).map((e) => <option key={e.id} value={e.id}>{e.fullName} — {e.employeeCode}</option>)}</select></Field>
          <Field label="Status"><select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">All</option>{['Pending', 'Verified', 'Rejected', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Search" grow><input value={filters.search} placeholder="Reference, employee name or code" onChange={(e) => setFilters({ ...filters, search: e.target.value })} /></Field>
          <button className="btn outline" onClick={() => setFilters({ employeeId: 'all', status: '', search: '' })}>Clear</button>
        </div>
        {q.isLoading ? <Loading /> : (
          <Table heads={['Date', 'Employee', 'Reference', 'Sale amount', 'Method', 'Applied %', 'Commission', 'Status', 'Action']}>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{shortDate(s.saleDate)}<div className="tiny">{s.saleDate}</div></td>
                <td><Person name={s.employeeName} code={s.employeeCode} /></td>
                <td className="mono">{s.saleReference}<DemoTag show={s.isDemo} />{s.verifiedAtEntry && <div className="tiny">verified at entry</div>}</td>
                <td><MoneySpan n={s.saleAmount} /></td>
                <td>{label(s.commissionMethod)}</td>
                <td>{pct(s.appliedRatePercent)}</td>
                <td><MoneySpan n={s.commissionAmount} cls={s.status === 'Verified' ? 'greentext' : ''} /></td>
                <td><Badge text={s.status} />{s.lockedInPayroll && <div className="tiny">🔒 in approved payroll</div>}{s.statusReason && <div className="tiny wrap" style={{ maxWidth: 180 }}>{s.statusReason}</div>}</td>
                <td className="nowrap">
                  {s.status === 'Pending' && can('revenue.verify') && <><button className="btn soft sm" onClick={() => act(s, 'verify')}>Verify</button> <button className="btn flat sm" onClick={() => act(s, 'reject')}>Reject</button></>}
                  {['Pending', 'Verified'].includes(s.status) && !s.lockedInPayroll && can('revenue.create') && <button className="btn flat sm" onClick={() => setModal({ type: 'edit', sale: s })}>Edit</button>}
                  {['Pending', 'Verified'].includes(s.status) && can('revenue.verify') && <button className="btn flat sm" onClick={() => act(s, 'cancel')}>Cancel</button>}
                  {['Rejected', 'Cancelled'].includes(s.status) && '—'}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <div className="notice">Sales are grouped by accounting month: a sale dated in September belongs to September payroll only. Editing a sale updates its single commission entry (never a duplicate). Sales already included in approved payroll are locked.</div>
      {modal?.type === 'new' && <SaleForm onClose={() => setModal(null)} />}
      {modal?.type === 'edit' && <SaleForm initial={modal.sale} onClose={() => setModal(null)} />}
    </>
  );
}
