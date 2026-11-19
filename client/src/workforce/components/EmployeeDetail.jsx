import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, ErrorBox, Field, Loading, Modal, Table, useAction, useUi, MoneySpan } from './ui.jsx';
import PayslipBody, { printPayslip } from './Payslip.jsx';
import { fullDate, label, money, monthLabel, pct, todayDate } from '../format.js';

export function MarkPaidModal({ record, onClose }) {
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [run, busy] = useAction();
  const [f, setF] = useState({ paymentDate: todayDate(), paymentMethod: 'Bank Transfer', paymentReference: '', remarks: '' });
  const [key] = useState(() => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())));
  const submit = async (e) => {
    e.preventDefault();
    if (!(await confirm({ title: 'Record payment', message: `Record ${money(record.netSalary)} as PAID for ${record.fullName}?\nThis only records the payment status. No money is transferred.`, confirmText: 'Record as paid' }))) return;
    const r = await run(() => api.post(`/api/payroll/${record.id}/mark-paid`, f, { idempotencyKey: key }), 'Payment recorded.');
    if (r) { qc.invalidateQueries(); onClose(); }
  };
  return (
    <Modal title="Confirm payment record" onClose={onClose}>
      <div className="notice warning">This action only records payment status. It does <b>not</b> initiate a bank transfer.</div>
      <p><b>{record.fullName}</b> — <b>{money(record.netSalary)}</b> · {monthLabel(record.periodMonth)}</p>
      <form onSubmit={submit}>
        <div className="formgrid">
          <Field label="Payment date"><input type="date" value={f.paymentDate} onChange={(e) => setF({ ...f, paymentDate: e.target.value })} required /></Field>
          <Field label="Payment method"><select value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })}>{['Bank Transfer', 'Cash', 'Cheque', 'Mobile Wallet', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Payment reference"><input value={f.paymentReference} minLength={3} required placeholder="e.g. HBL-TRX-0012" onChange={(e) => setF({ ...f, paymentReference: e.target.value })} /></Field>
          <Field label="Remarks (optional)" full><input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </div>
        <div className="modalfoot"><button className="btn" type="submit" disabled={busy}>Record as paid</button></div>
      </form>
    </Modal>
  );
}

function AdjustModal({ record, onClose }) {
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const [f, setF] = useState({ bonus: record.bonusTotal, otherDeduction: record.otherDeductions, reason: '' });
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => api.post(`/api/payroll/${record.id}/bonus-deduction`, f), 'Pay adjustments saved and payroll recalculated.');
    if (r) { qc.invalidateQueries(); onClose(); }
  };
  return (
    <Modal title="Edit pay adjustments" onClose={onClose}>
      <div className="notice">Verified sales commission and active advance installments are calculated automatically and are not overridden here. Each change is stored as an authorised adjustment with your reason.</div>
      <form onSubmit={submit}>
        <div className="formgrid">
          <Field label="Performance / discretionary bonus (PKR)"><input type="number" min="0" step="0.01" value={f.bonus} onChange={(e) => setF({ ...f, bonus: e.target.value })} required /></Field>
          <Field label="Other authorised deduction (PKR)"><input type="number" min="0" step="0.01" value={f.otherDeduction} onChange={(e) => setF({ ...f, otherDeduction: e.target.value })} required /></Field>
          <Field label="Required reason / authorisation" full><textarea minLength={5} required value={f.reason} placeholder="What was changed and who authorised it?" onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
        <div className="modalfoot"><button className="btn" type="submit" disabled={busy}>Save salary adjustments</button></div>
      </form>
    </Modal>
  );
}

export default function EmployeeDetail({ employeeId, onClose }) {
  const { month, can, setTab } = useApp();
  const qc = useQueryClient();
  const { confirm, toast } = useUi();
  const [run, busy] = useAction();
  const [sub, setSub] = useState(null);
  const emp = useQuery({ queryKey: ['employee', employeeId], queryFn: () => api.get(`/api/employees/${employeeId}`), enabled: can('employees.view') });
  const pay = useQuery({ queryKey: ['payroll-employee', employeeId, month], queryFn: () => api.get(`/api/payroll/${employeeId}?month=${month}`), enabled: can('payroll.view') });
  const adv = useQuery({ queryKey: ['advances-employee', employeeId], queryFn: () => api.get(`/api/advances/employee/${employeeId}`), enabled: can('advances.view') });
  const r = pay.data;
  const e = emp.data;
  const open = r && !r.locked;
  const blockers = r?.blockers || [];

  const approve = async () => {
    if (!(await confirm({ title: 'Approve & lock salary', message: `Approve and lock ${r.fullName}'s ${monthLabel(r.periodMonth)} salary at ${money(r.netSalary)}?\nAn immutable snapshot is saved; later attendance or revenue changes will not alter it.`, confirmText: 'Approve & lock' }))) return;
    const res = await run(() => api.post('/api/payroll/approve-bulk', { ids: [r.id] }));
    if (res) {
      toast(res.blocked.length ? `Not approved: ${res.blocked[0].reason}` : 'Salary approved and locked.');
      qc.invalidateQueries();
    }
  };
  const submitReview = async () => { if (await run(() => api.post(`/api/payroll/${r.id}/submit`), 'Submitted for review.')) qc.invalidateQueries(); };

  return (
    <Modal title="Employee profile & salary review" onClose={onClose} width={860}
      footer={r && (
        <>
          <button className="btn outline" onClick={() => printPayslip(r)}>Print payslip</button>
          {open && r.status === 'Draft' && can('payroll.calculate') && <button className="btn soft" disabled={busy} onClick={submitReview}>Submit for review</button>}
          {open && ['Draft', 'UnderReview'].includes(r.status) && can('payroll.approve') && (
            <button className="btn" disabled={busy || blockers.length > 0 || Number(r.netSalary) < 0} onClick={approve} title={blockers.length ? 'Resolve blockers first' : ''}>Approve & lock</button>
          )}
          {r.status === 'Approved' && can('payroll.pay') && <button className="btn" onClick={() => setSub('paid')}>Mark paid</button>}
        </>
      )}>
      <ErrorBox error={pay.error || emp.error} />
      {(pay.isLoading || emp.isLoading) && <Loading />}
      {e && (
        <div className="grid22" style={{ marginBottom: 14 }}>
          <div className="mini-stat">
            <div className="kv">
              <span>Employee code</span><b>{e.employeeCode}</b>
              <span>Designation</span><b>{e.designation || '—'}</b>
              <span>Department</span><b>{e.department || '—'}</b>
              <span>Status</span><b>{e.employmentStatus}</b>
              <span>Joined</span><b>{fullDate(e.joiningDate)}</b>
            </div>
          </div>
          <div className="mini-stat">
            <div className="kv">
              <span>Base salary</span><b>{money(e.baseSalary)}</b>
              <span>Shift</span><b>{e.shiftName ? `${e.shiftName} (${e.shiftTiming})` : 'Company default'}</b>
              <span>Fixed commission</span><b>{pct(e.fixedCommissionPercent)}</b>
              <span>Attendance login</span><b>{e.username || 'Not linked'}</b>
              <span>Payroll status</span><b>{r ? label(r.status) : '—'}</b>
            </div>
          </div>
        </div>
      )}
      {r && (
        <>
          <div className={`notice ${blockers.length ? 'warning' : 'good'}`}>
            {r.locked ? `🔒 ${label(r.status)} — this payslip is a locked snapshot.` : blockers.length ? `⚠ ${blockers.length} blocker(s) must be resolved before approval.` : '✓ No open approval blockers for this employee.'}
            {blockers.length > 0 && <ul className="blockers">{blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul>}
            {(r.warnings || []).length > 0 && <ul className="warnings">{r.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>}
          </div>
          <div className="grid22" style={{ marginBottom: 12 }}>
            <div className="mini-stat"><span className="tiny">Revenue generated</span><strong>{money(r.revenueTotal)}</strong><small className="tiny">Verified sales in {monthLabel(r.periodMonth)}</small></div>
            <div className="mini-stat"><span className="tiny">Commission earned</span><strong className="greentext">{money(r.commissionTotal)}</strong><small className="tiny">{(r.commissions || []).length} verified sale(s)</small></div>
          </div>
          <PayslipBody record={r} />
          {(r.commissions || []).length > 0 && (
            <>
              <div className="divider" />
              <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Commissions included</h2>
              <Table heads={['Reference', 'Date', 'Method', 'Sale amount', 'Applied rate', 'Commission']}>
                {r.commissions.map((c) => (
                  <tr key={c.sale_reference}><td>{c.sale_reference}</td><td>{fullDate(c.sale_date)}</td><td>{label(c.commission_method)}</td>
                    <td><MoneySpan n={c.sale_amount} /></td><td>{pct(c.rate_percent)}</td><td><MoneySpan n={c.amount} cls="greentext" /></td></tr>
                ))}
              </Table>
            </>
          )}
          {adv.data && adv.data.length > 0 && (
            <>
              <div className="divider" />
              <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Salary advances</h2>
              <Table heads={['Date', 'Amount', 'Installment', 'Balance', 'Status']}>
                {adv.data.map((a) => <tr key={a.id}><td>{fullDate(a.advanceDate)}</td><td><MoneySpan n={a.amount} /></td><td><MoneySpan n={a.monthlyRecovery} /></td><td><MoneySpan n={a.remainingBalance} /></td><td><Badge text={a.status} /></td></tr>)}
              </Table>
            </>
          )}
          {open && (
            <>
              <div className="divider" />
              <div className="tiny">Bonus and additional deduction are editable with a reason. Verified sales and active advance installments are calculated automatically.</div>
              <div style={{ marginTop: 10 }} className="controls">
                {can('payroll.adjust') && <button className="btn outline sm" onClick={() => setSub('adjust')}>Edit bonus / deductions</button>}
                {can('attendance.view_all') && <button className="btn soft sm" onClick={() => { onClose(); setTab('attendance', { employeeId }); }}>Attendance details</button>}
              </div>
            </>
          )}
        </>
      )}
      {sub === 'adjust' && r && <AdjustModal record={r} onClose={() => setSub(null)} />}
      {sub === 'paid' && r && <MarkPaidModal record={r} onClose={() => setSub(null)} />}
    </Modal>
  );
}
