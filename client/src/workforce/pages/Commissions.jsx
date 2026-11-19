import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Card, ErrorBox, Field, Header, Kpi, Kpis, Loading, MonthPicker, MoneySpan, Person, Table, useAction, DemoTag } from '../components/ui.jsx';
import { dateTime, label, money, pct, shortDate } from '../format.js';
import { SaleForm } from './Revenue.jsx';

function SettingsCard() {
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const employees = useQuery({ queryKey: ['employees', 'active'], queryFn: () => api.get('/api/employees') });
  const [employeeId, setEmployeeId] = useState('');
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { if (!employeeId && employees.data?.length) setEmployeeId(String(employees.data[0].id)); }, [employees.data, employeeId]);
  const s = useQuery({ queryKey: ['commission-settings', employeeId], queryFn: () => api.get(`/api/commission-settings/${employeeId}`), enabled: !!employeeId });
  useEffect(() => { setRate(s.data?.fixedRatePercent ?? ''); setReason(''); }, [s.data]);
  const save = async (e) => {
    e.preventDefault();
    const r = await run(() => api.put(`/api/commission-settings/${employeeId}`, { fixedRatePercent: rate, reason }), `Fixed commission saved: ${rate}%. New sales use it automatically; existing sales keep their original rate.`);
    if (r) { qc.invalidateQueries(); setReason(''); }
  };
  return (
    <Card title="Employee commission settings" sub="Set each employee's fixed percentage once. Future sales with “Fixed Employee Commission” load it automatically and read-only.">
      <form className="controls" onSubmit={save}>
        <Field label="Employee"><select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>{(employees.data || []).map((e) => <option key={e.id} value={e.id}>{e.fullName} — {e.employeeCode}</option>)}</select></Field>
        <Field label="Current fixed rate"><input readOnly className="readonly" value={s.data ? (s.data.fixedRatePercent === null ? 'Not set' : `${s.data.fixedRatePercent}%`) : ''} /></Field>
        <Field label="New fixed commission percentage (%)"><input type="number" min="0" max="100" step="0.001" value={rate} onChange={(e) => setRate(e.target.value)} required /></Field>
        <Field label="Reason (required)" grow><input value={reason} minLength={5} required placeholder="e.g. Annual review approved by CEO" onChange={(e) => setReason(e.target.value)} /></Field>
        <button className="btn" type="submit" disabled={busy || !employeeId}>Save employee commission</button>
      </form>
      {s.data?.history?.length > 0 && (
        <Table heads={['Changed', 'From', 'To', 'By', 'Reason']}>
          {s.data.history.map((h, i) => <tr key={i}><td>{dateTime(h.changed_at)}</td><td>{pct(h.old_rate)}</td><td><b>{pct(h.new_rate)}</b></td><td>{h.changed_by || '—'}</td><td className="wrap">{h.reason}</td></tr>)}
        </Table>
      )}
    </Card>
  );
}

export default function Commissions() {
  const { month, setMonth, can, openEmployee } = useApp();
  const [newSale, setNewSale] = useState(false);
  const q = useQuery({ queryKey: ['commissions', month], queryFn: () => api.get(`/api/commissions?month=${month}`) });
  const summary = q.data?.summary || [];
  const entries = q.data?.entries || [];
  const total = summary.reduce((a, s) => a + Number(s.earnedCommission), 0);
  return (
    <>
      <Header overline="Compensation / commissions" title="Commission management" subtitle="Employee-wise percentage commission, calculated automatically in PKR from verified revenue." month={month}>
        <MonthPicker value={month} onChange={setMonth} />
        {can('revenue.create') && <button className="btn sm" onClick={() => setNewSale(true)}>+ Record sale</button>}
      </Header>
      <ErrorBox error={q.error} />
      <Kpis>
        <Kpi label="Verified commissions" value={money(total)} foot="Automatically added to salary" />
        <Kpi label="Pending verification" value={summary.reduce((a, s) => a + s.pendingSales, 0)} foot="Do not affect salary yet" />
        <Kpi label="Verified sale records" value={entries.length} foot="Only verified records count" />
        <Kpi label="Commission earners" value={summary.filter((s) => Number(s.earnedCommission) > 0).length} foot="Employees with verified sales" />
      </Kpis>
      {can('commission.settings') && <SettingsCard />}
      <Card title="Commission by employee" sub="Same figures as the employee's Draft payroll and payslip.">
        {q.isLoading ? <Loading /> : (
          <Table heads={['Employee', 'Fixed rate', 'Verified sales', 'Verified revenue', 'Earned commission', 'Pending', '']}>
            {summary.map((s) => (
              <tr key={s.employeeId}>
                <td><Person name={s.fullName} sub={s.department} code={s.employeeCode} demo={s.isDemo} /></td>
                <td>{pct(s.fixedRatePercent)}</td><td>{s.verifiedSales}</td><td><MoneySpan n={s.verifiedRevenue} /></td>
                <td><MoneySpan n={s.earnedCommission} cls="greentext" /></td>
                <td>{s.pendingSales ? `${s.pendingSales} (${money(s.pendingCommission)})` : '—'}</td>
                <td>{can('payroll.view') && <button className="btn soft sm" onClick={() => openEmployee(s.employeeId)}>Payroll →</button>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Verified commission entries" sub="Each entry stores the rate applied at the time of sale; later rate changes never rewrite history.">
        <Table heads={['Date', 'Employee', 'Reference', 'Method', 'Sale amount', 'Applied %', 'Commission']}>
          {entries.map((s) => (
            <tr key={s.id}><td>{shortDate(s.saleDate)}</td><td>{s.employeeName} · {s.employeeCode}</td><td className="mono">{s.saleReference}<DemoTag show={s.isDemo} /></td>
              <td>{label(s.commissionMethod)}</td><td><MoneySpan n={s.saleAmount} /></td><td>{pct(s.appliedRatePercent)}</td><td><MoneySpan n={s.commissionAmount} cls="greentext" /></td></tr>
          ))}
        </Table>
      </Card>
      {newSale && <SaleForm onClose={() => setNewSale(false)} />}
    </>
  );
}
