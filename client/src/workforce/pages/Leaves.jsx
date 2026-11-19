import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Card, ErrorBox, Field, Header, Kpi, Kpis, Loading, Modal, Person, Table, useAction, useUi } from '../components/ui.jsx';
import { dateTime, fullDate, todayDate } from '../format.js';

export function LeaveForm({ onClose, self }) {
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const employees = useQuery({ queryKey: ['employees', 'active'], queryFn: () => api.get('/api/employees'), enabled: !self });
  const [f, setF] = useState({ employeeId: '', leaveType: 'Full-Day Leave', startDate: todayDate(), endDate: todayDate(), halfDay: false, reason: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { ...f, endDate: f.halfDay ? f.startDate : f.endDate, employeeId: self ? undefined : Number(f.employeeId) };
    const r = await run(() => api.post(self ? '/api/me/leaves' : '/api/leaves', body), 'Leave request submitted (Pending).');
    if (r) { qc.invalidateQueries(); onClose(); }
  };
  return (
    <Modal title={self ? 'Apply for leave' : 'Record leave request'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="formgrid">
          {!self && <Field label="Employee"><select value={f.employeeId} onChange={set('employeeId')} required><option value="">Select…</option>{(employees.data || []).map((e) => <option key={e.id} value={e.id}>{e.fullName} — {e.employeeCode}</option>)}</select></Field>}
          <Field label="Leave type"><select value={f.leaveType} onChange={(e) => setF({ ...f, leaveType: e.target.value, halfDay: e.target.value === 'Half-Day Leave' })}>{['Full-Day Leave', 'Half-Day Leave', 'Sick Leave', 'Casual Leave', 'Annual Leave', 'Emergency Leave'].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="From"><input type="date" value={f.startDate} onChange={set('startDate')} required /></Field>
          {!f.halfDay && <Field label="To"><input type="date" value={f.endDate} min={f.startDate} onChange={set('endDate')} required /></Field>}
          <Field label="Reason" full><textarea value={f.reason} onChange={set('reason')} required minLength={3} /></Field>
        </div>
        <div className="modalfoot"><button className="btn" type="submit" disabled={busy}>Submit request</button></div>
      </form>
    </Modal>
  );
}

export default function Leaves() {
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [run] = useAction();
  const [status, setStatus] = useState('Pending');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const q = useQuery({ queryKey: ['leaves', status, search], queryFn: () => api.get(`/api/leaves${qs({ status, search })}`) });
  const all = useQuery({ queryKey: ['leaves', 'all-counts'], queryFn: () => api.get('/api/leaves') });
  const rows = q.data || [];
  const count = (s) => (all.data || []).filter((l) => l.status === s).length;
  const decide = async (l, decision) => {
    let payType = 'Paid'; let note = '';
    const ok = await confirm({
      title: `${decision === 'approve' ? 'Approve' : 'Reject'} leave — ${l.employeeName}`,
      message: `${l.leaveType} · ${fullDate(l.startDate)}${l.endDate !== l.startDate ? ` → ${fullDate(l.endDate)}` : ''} (${l.days} day(s))\nReason: ${l.reason || '—'}`,
      danger: decision === 'reject',
      children: <div style={{ marginTop: 12 }}>
        {decision === 'approve' && <Field label="Pay type"><select defaultValue="Paid" onChange={(e) => { payType = e.target.value; }}><option value="Paid">Paid leave (counts against monthly allowance)</option><option value="Unpaid">Unpaid leave (one day's pay deducted)</option></select></Field>}
        <Field label={decision === 'approve' ? 'Note (optional)' : 'Reason (required)'}><input onChange={(e) => { note = e.target.value; }} /></Field>
      </div>,
      confirmText: decision === 'approve' ? 'Approve leave' : 'Reject leave',
    });
    if (!ok) return;
    if (await run(() => api.post(`/api/leaves/${l.id}/${decision}`, { payType, note }), 'Leave decision saved; attendance and Draft payroll updated.')) qc.invalidateQueries();
  };
  return (
    <>
      <Header overline="Payroll workspace / leave" title="Leave management" subtitle="Requests from the Attendance app and HR. Decisions update attendance and Draft payroll immediately.">
        <button className="btn sm" onClick={() => setModal(true)}>+ Record leave</button>
      </Header>
      <ErrorBox error={q.error} />
      <Kpis>
        <Kpi label="Pending decisions" value={count('Pending')} foot="Block payroll approval for those days" />
        <Kpi label="Approved" value={count('Approved')} foot="Paid or unpaid as decided" />
        <Kpi label="Rejected" value={count('Rejected')} foot="Day becomes Absent if not attended" />
        <Kpi label="Cancelled" value={count('Cancelled')} foot="Withdrawn requests" />
      </Kpis>
      <Card title="Leave requests">
        <div className="pill-tabs">{['Pending', 'Approved', 'Rejected', 'Cancelled', ''].map((s) => <button key={s || 'all'} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{s || 'All'}</button>)}</div>
        <div className="controls"><Field label="Search" grow><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Employee name, code or username" /></Field></div>
        {q.isLoading ? <Loading /> : (
          <Table heads={['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Source', 'Status', 'Decided', 'Action']}>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>{l.employeeId ? <Person name={l.employeeName} code={l.employeeCode} /> : <span>{l.username} <span className="tag gray">unmapped login</span></span>}</td>
                <td>{l.leaveType}</td>
                <td>{fullDate(l.startDate)}{l.endDate !== l.startDate && <> → {fullDate(l.endDate)}</>}</td>
                <td>{l.days}</td>
                <td className="wrap" style={{ maxWidth: 260 }}>{l.reason || '—'}</td>
                <td className="tiny">{l.source}</td>
                <td><Badge text={l.status === 'Approved' ? `${l.payType} leave` : l.status} /></td>
                <td className="tiny">{l.decidedAt ? `${dateTime(l.decidedAt)} · ${l.decidedBy || ''}` : '—'}{l.decisionNote && <div className="wrap">{l.decisionNote}</div>}</td>
                <td className="nowrap">{l.status === 'Pending' ? <><button className="btn soft sm" onClick={() => decide(l, 'approve')}>Approve</button> <button className="btn flat sm" onClick={() => decide(l, 'reject')}>Reject</button></> : '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <div className="notice">Approved paid leave beyond the monthly allowance (Policy Settings) is deducted as unpaid. Leave for months whose payroll is already approved is refused; use a payroll adjustment instead.</div>
      {modal && <LeaveForm onClose={() => setModal(false)} />}
    </>
  );
}
