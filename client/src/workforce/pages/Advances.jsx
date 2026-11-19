import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Card, DemoTag, ErrorBox, Field, Header, Kpi, Kpis, Loading, Modal, MoneySpan, Person, Table, useAction, useUi } from '../components/ui.jsx';
import { fullDate, money, monthLabel, todayDate, todayMonth } from '../format.js';

function AdvanceForm({ onClose }) {
  const { can } = useApp();
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const employees = useQuery({ queryKey: ['employees', 'active'], queryFn: () => api.get('/api/employees') });
  const [f, setF] = useState({ employeeId: '', amount: '10000', monthlyRecovery: '2500', advanceDate: todayDate(), recoveryStartMonth: todayMonth(), reason: '', approveNow: false });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const n = Number(f.amount) > 0 && Number(f.monthlyRecovery) > 0 ? Math.ceil(Number(f.amount) / Number(f.monthlyRecovery)) : 0;
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => api.post('/api/advances', { ...f, employeeId: Number(f.employeeId) }), f.approveNow ? 'Advance issued; installment added to Draft payroll.' : 'Advance request created (Pending).');
    if (r) { qc.invalidateQueries(); onClose(); }
  };
  return (
    <Modal title="Issue / request salary advance" onClose={onClose}>
      <p className="sub">Only Active (approved and disbursed) advances are recovered from salary — one installment per payroll month.</p>
      <form onSubmit={submit}>
        <div className="formgrid">
          <Field label="Employee"><select value={f.employeeId} onChange={set('employeeId')} required><option value="">Select…</option>{(employees.data || []).map((e) => <option key={e.id} value={e.id}>{e.fullName} — {e.employeeCode}</option>)}</select></Field>
          <Field label="Advance amount (PKR)"><input type="number" min="1" step="0.01" value={f.amount} onChange={set('amount')} required /></Field>
          <Field label="Monthly recovery (PKR)"><input type="number" min="1" step="0.01" value={f.monthlyRecovery} onChange={set('monthlyRecovery')} required /></Field>
          <Field label="Advance date"><input type="date" value={f.advanceDate} onChange={set('advanceDate')} required /></Field>
          <Field label="First recovery month"><input type="month" value={f.recoveryStartMonth} onChange={set('recoveryStartMonth')} required /></Field>
          <Field label="Repayment schedule"><input readOnly className="readonly" value={n ? `${n} installment(s) from ${monthLabel(f.recoveryStartMonth)}` : '—'} /></Field>
          <Field label="Reason" full><textarea value={f.reason} onChange={set('reason')} minLength={5} required /></Field>
        </div>
        {can('advances.approve') && <label className="inline-check" style={{ marginTop: 10 }}><input type="checkbox" checked={f.approveNow} onChange={set('approveNow')} /> Approve now — I confirm it was approved AND disbursed (no money is sent by this system)</label>}
        <div className="modalfoot"><button className="btn" type="submit" disabled={busy}>{f.approveNow ? 'Issue advance' : 'Create request'}</button></div>
      </form>
    </Modal>
  );
}

export default function Advances() {
  const { can } = useApp();
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [run] = useAction();
  const [modal, setModal] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const q = useQuery({ queryKey: ['advances'], queryFn: () => api.get('/api/advances') });
  const rows = q.data || [];
  const active = rows.filter((a) => a.status === 'Active');
  const decide = async (a, d) => {
    const ok = await confirm({ title: d === 'approve' ? 'Approve & disburse advance' : 'Reject advance', danger: d !== 'approve', message: d === 'approve' ? `Confirm ${money(a.amount)} for ${a.employeeName} was approved AND already disbursed? This system does not send funds.` : `Reject ${a.employeeName}'s advance request of ${money(a.amount)}?` });
    if (ok && await run(() => api.post(`/api/advances/${a.id}/${d}`), 'Advance updated; Draft payroll recalculated.')) qc.invalidateQueries();
  };
  return (
    <>
      <Header overline="Compensation / advances" title="Salary advances" subtitle="Issue advances and recover one installment per payroll. Balances update exactly once when payroll is approved.">
        {can('advances.manage') && <button className="btn sm" onClick={() => setModal(true)}>+ New advance</button>}
      </Header>
      <ErrorBox error={q.error} />
      <Kpis>
        <Kpi label="Outstanding balance" value={money(active.reduce((s, a) => s + Number(a.remainingBalance), 0))} foot={`${active.length} active advance(s)`} />
        <Kpi label="Monthly recovery" value={money(active.reduce((s, a) => s + Math.min(Number(a.monthlyRecovery), Number(a.remainingBalance)), 0))} foot="Next payroll installments" />
        <Kpi label="Pending requests" value={rows.filter((a) => a.status === 'Pending').length} foot="Do not affect salary" />
        <Kpi label="Settled" value={rows.filter((a) => a.status === 'Settled').length} foot="Fully recovered" />
      </Kpis>
      <Card title="Advance ledger" sub="Recovery history shows the approved payroll that posted each installment.">
        {q.isLoading ? <Loading /> : (
          <Table heads={['Employee', 'Date', 'Amount', 'Recovered', 'Balance', 'Installment', 'Starts', 'Status', 'Reason', 'Action']}>
            {rows.flatMap((a) => [
              <tr key={a.id}>
                <td><Person name={a.employeeName} code={a.employeeCode} demo={a.isDemo} /></td>
                <td>{fullDate(a.advanceDate)}</td><td><MoneySpan n={a.amount} /></td><td><MoneySpan n={a.recovered} cls="greentext" /></td>
                <td><MoneySpan n={a.remainingBalance} /></td><td><MoneySpan n={a.monthlyRecovery} /><div className="tiny">{a.installmentsRemaining} left</div></td>
                <td>{monthLabel(a.recoveryStartMonth)}</td><td><Badge text={a.status} /></td><td className="wrap" style={{ maxWidth: 220 }}>{a.reason}</td>
                <td className="nowrap">
                  {a.status === 'Pending' && can('advances.approve') ? <><button className="btn soft sm" onClick={() => decide(a, 'approve')}>Approve & disburse</button> <button className="btn flat sm" onClick={() => decide(a, 'reject')}>Reject</button></> : null}
                  {a.recoveries?.length > 0 && <button className="btn flat sm" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>{expanded === a.id ? 'Hide' : 'History'}</button>}
                </td>
              </tr>,
              expanded === a.id && (
                <tr key={`${a.id}-h`}><td colSpan={10} style={{ background: '#f9fbff' }}>
                  {a.recoveries.map((r, i) => <div key={i} className="tiny">• {monthLabel(r.period_month)} payroll recovered {money(r.amount)} → balance {money(r.balance_after)}</div>)}
                </td></tr>
              ),
            ])}
          </Table>
        )}
      </Card>
      <div className="notice">An advance is never deducted twice: each installment is tied to one approved payroll record by a database constraint. <DemoTag show={false} /></div>
      {modal && <AdvanceForm onClose={() => setModal(false)} />}
    </>
  );
}
