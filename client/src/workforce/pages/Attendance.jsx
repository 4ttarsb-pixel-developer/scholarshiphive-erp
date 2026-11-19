import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadFile, qs } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Card, ErrorBox, Field, Header, Loading, Modal, MonthPicker, Person, Table, useAction, useUi } from '../components/ui.jsx';
import { dateTime, label, readableTime, shortDate } from '../format.js';

const STATUSES = ['Present', 'Late', 'Absent', 'PaidLeave', 'UnpaidLeave', 'PendingLeave', 'MissingCheckIn', 'MissingCheckOut', 'Holiday', 'WeeklyOff'];

export function CorrectionForm({ record, employeeId, date, onClose }) {
  const { can } = useApp();
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const canApprove = can('attendance.approve_corrections');
  const employees = useQuery({ queryKey: ['employees', 'active'], queryFn: () => api.get('/api/employees') });
  const [f, setF] = useState({
    employeeId: String(record?.employeeId || employeeId || ''), attendanceDate: record?.date || date || '',
    requestedStatus: record ? (['Present', 'Late', 'MissingCheckIn', 'MissingCheckOut'].includes(record.status) ? 'Present' : ['Absent', 'PaidLeave', 'UnpaidLeave', 'Holiday', 'WeeklyOff'].includes(record.status) ? record.status : 'Present') : 'Present',
    checkIn: record?.checkIn || '', checkOut: record?.checkOut || '', reason: '', autoApprove: canApprove,
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { ...f, employeeId: Number(f.employeeId) };
    if (body.requestedStatus !== 'Present') { delete body.checkIn; delete body.checkOut; }
    if (!body.checkIn) delete body.checkIn;
    if (!body.checkOut) delete body.checkOut;
    const r = await run(() => api.post('/api/attendance/corrections', body), f.autoApprove ? 'Attendance corrected; Draft payroll recalculated.' : 'Correction submitted for approval (blocks payroll until decided).');
    if (r) { qc.invalidateQueries(); onClose(); }
  };
  return (
    <Modal title={record ? 'Correct attendance record' : 'Add / correct attendance'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="formgrid">
          <Field label="Employee"><select value={f.employeeId} onChange={set('employeeId')} disabled={!!record} required><option value="">Select…</option>{(employees.data || []).map((e) => <option key={e.id} value={e.id}>{e.fullName} — {e.employeeCode}</option>)}</select></Field>
          <Field label="Date (shift date)"><input type="date" value={f.attendanceDate} onChange={set('attendanceDate')} readOnly={!!record} required /></Field>
          <Field label="Corrected status">
            <select value={f.requestedStatus} onChange={set('requestedStatus')}>
              <option value="Present">Present (with times)</option><option value="Absent">Absent</option><option value="PaidLeave">Paid leave</option>
              <option value="UnpaidLeave">Unpaid leave</option><option value="Holiday">Holiday</option><option value="WeeklyOff">Weekly off</option>
              <option value="Recompute">Revert to system calculation</option>
            </select>
          </Field>
          {f.requestedStatus === 'Present' && <>
            <Field label="Actual check-in (HH:MM)" hint={f.autoApprove ? 'Required to apply' : 'Leave empty to flag a missing punch'}><input type="time" value={f.checkIn} onChange={set('checkIn')} required={f.autoApprove} /></Field>
            <Field label="Actual check-out (HH:MM)" hint="Overnight shifts handled automatically"><input type="time" value={f.checkOut} onChange={set('checkOut')} /></Field>
          </>}
          <Field label="Correction reason / remarks (required)" full><textarea value={f.reason} onChange={set('reason')} required minLength={5} /></Field>
        </div>
        {canApprove && <label className="inline-check" style={{ marginTop: 10 }}><input type="checkbox" checked={f.autoApprove} onChange={set('autoApprove')} /> Apply immediately (I am authorised to approve corrections)</label>}
        <div className="modalfoot"><button className="btn" type="submit" disabled={busy}>{f.autoApprove ? 'Save attendance correction' : 'Submit correction request'}</button></div>
      </form>
      <p className="tiny">The server recalculates lateness, worked time and the employee's Draft payroll. Approved or paid months cannot be corrected here — use a payroll adjustment.</p>
    </Modal>
  );
}

function PendingCorrections() {
  const { can } = useApp();
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [run] = useAction();
  const q = useQuery({ queryKey: ['corrections', 'Pending'], queryFn: () => api.get('/api/attendance/corrections?status=Pending') });
  if (!q.data?.length) return null;
  const decide = async (c, decision) => {
    let note = ''; let checkIn = '';
    const ok = await confirm({
      title: `${decision === 'Approved' ? 'Approve' : 'Reject'} correction for ${c.employeeName} (${c.attendanceDate})`,
      message: `${label(c.requestedStatus)} · ${c.reason}`, danger: decision === 'Rejected',
      children: <div style={{ marginTop: 10 }}>{decision === 'Approved' && c.requestedStatus === 'Present' && !c.requestedCheckIn && <input type="time" style={{ marginBottom: 8 }} onChange={(e) => { checkIn = e.target.value; }} aria-label="Actual check-in" />}<input placeholder="Decision note" onChange={(e) => { note = e.target.value; }} /></div>,
    });
    if (!ok) return;
    if (await run(() => api.post(`/api/attendance/corrections/${c.id}/decide`, { decision, note, ...(checkIn ? { checkIn } : {}) }), `Correction ${decision.toLowerCase()}.`)) qc.invalidateQueries();
  };
  return (
    <Card title="Pending attendance corrections" sub="Each pending correction blocks that employee's payroll approval.">
      <Table heads={['Date', 'Employee', 'Requested', 'Times', 'Reason', 'Requested by', 'Action']}>
        {q.data.map((c) => (
          <tr key={c.id}><td>{c.attendanceDate}</td><td>{c.employeeName}</td><td>{label(c.requestedStatus)}</td>
            <td>{c.requestedCheckIn ? dateTime(c.requestedCheckIn) : '—'}</td><td className="wrap">{c.reason}</td><td>{c.requestedBy}</td>
            <td>{can('attendance.approve_corrections') ? <><button className="btn soft sm" onClick={() => decide(c, 'Approved')}>Approve</button> <button className="btn flat sm" onClick={() => decide(c, 'Rejected')}>Reject</button></> : 'Awaiting approver'}</td></tr>
        ))}
      </Table>
    </Card>
  );
}

function LiveCard() {
  const q = useQuery({ queryKey: ['attendance-live'], queryFn: () => api.get('/api/attendance/live'), refetchInterval: 30000 });
  const rows = q.data || [];
  return (
    <Card title="Today from the Attendance app" sub="Check-ins and check-outs appear here automatically.">
      <Table heads={['Employee', 'Login', 'Check-in', 'Check-out', 'Actual office time', 'Network away', 'Status']} empty="No check-ins yet today">
        {rows.map((r) => <tr key={r.id}><td>{r.employeeName}{!r.employeeCode && <span className="tag gray" style={{ marginLeft: 6 }}>unmapped</span>}</td><td>{r.username}</td><td>{readableTime(r.checkInLocal)}</td><td>{r.checkOutLocal ? readableTime(r.checkOutLocal) : '—'}</td><td>{r.actualOfficeTimeText}</td><td>{r.networkAwayText}</td><td><Badge text={r.status === 'Active' ? 'Present' : r.status} /></td></tr>)}
      </Table>
    </Card>
  );
}

export default function Attendance() {
  const { month, setMonth, can, pageArgs } = useApp();
  const qc = useQueryClient();
  const [run] = useAction();
  const { confirm } = useUi();
  const [employeeId, setEmployeeId] = useState(pageArgs.employeeId ? String(pageArgs.employeeId) : 'all');
  const [date, setDate] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState(null);
  useEffect(() => { setPage(0); }, [employeeId, date, status, month]);
  const employees = useQuery({ queryKey: ['employees', 'active'], queryFn: () => api.get('/api/employees') });
  const q = useQuery({ queryKey: ['attendance', month, employeeId, date, status], queryFn: () => api.get(`/api/attendance${qs({ month, employeeId, date, status })}`) });
  const rows = q.data?.records || [];
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const shown = useMemo(() => rows.slice(page * 50, page * 50 + 50), [rows, page]);
  const review = async (r) => {
    let note = '';
    const ok = await confirm({ title: 'Manager exception review', message: `${r.employeeName} · ${shortDate(r.date)} · check-in ${readableTime(r.checkIn)} · ${r.lateMinutes} minutes late.\nReviewing does not remove any configured deduction.`, children: <textarea style={{ marginTop: 10 }} placeholder="Review note (mandatory)" onChange={(e) => { note = e.target.value; }} />, confirmText: 'Mark reviewed' });
    if (ok && await run(() => api.post('/api/attendance/review', { employeeId: r.employeeId, date: r.date, note }), 'Review saved.')) qc.invalidateQueries();
  };
  return (
    <>
      <Header overline="Payroll workspace / attendance" title="Attendance ledger" subtitle={`Official daily attendance calculated on the server from Attendance-app check-ins (${q.data?.period ? `${q.data.period.start_date} → ${q.data.period.end_date}` : ''}).`} month={month}>
        <MonthPicker value={month} onChange={setMonth} />
        <button className="btn outline sm" onClick={() => downloadFile(`/api/attendance/export${qs({ month, employeeId })}`, `attendance_${month}.csv`)}>Export attendance CSV</button>
      </Header>
      <ErrorBox error={q.error} />
      <LiveCard />
      <PendingCorrections />
      <Card title="Daily attendance" sub="Lateness uses the configured grace period and shift. Use correction with a mandatory reason to amend a record.">
        <div className="controls no-print">
          <Field label="Employee"><select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}><option value="all">All employees</option>{(employees.data || []).map((e) => <option key={e.id} value={e.id}>{e.fullName} — {e.employeeCode}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field>
          <button className="btn outline" onClick={() => { setEmployeeId('all'); setDate(''); setStatus(''); }}>Clear</button>
          {can('attendance.manage', 'attendance.approve_corrections') && <button className="btn" onClick={() => setModal({})}>+ Add or correct</button>}
        </div>
        {q.isLoading ? <Loading /> : (
          <Table heads={['Date', 'Employee', 'Status', 'Shift', 'Check-in', 'Check-out', 'Worked', 'Late', 'Leave', 'Exception', 'Action']}>
            {shown.map((r) => {
              const severe = r.lateMinutes >= 60 && ['Late', 'Present'].includes(r.status) && !r.reviewed;
              return (
                <tr key={r.id}>
                  <td>{shortDate(r.date)}<div className="tiny">{r.date}</div></td>
                  <td><Person name={r.employeeName} sub={r.department} code={r.employeeCode} demo={r.isDemo} /></td>
                  <td><Badge text={r.status} />{r.isOverridden && <div className="tiny" title={r.correctionReason}>corrected</div>}</td>
                  <td className="tiny">{r.shiftName}<div>{r.scheduledStart}–{r.scheduledEnd}</div></td>
                  <td>{r.checkIn ? readableTime(r.checkIn) : ['Present', 'Late', 'MissingCheckIn', 'MissingCheckOut'].includes(r.status) ? 'No punch' : '—'}</td>
                  <td>{r.checkOut ? readableTime(r.checkOut) : '—'}</td>
                  <td>{r.workedSeconds ? r.workedText : '—'}</td>
                  <td>{r.lateMinutes} min</td>
                  <td>{r.leaveStatus ? <Badge text={r.leaveStatus === 'Approved' ? `${r.leavePayType} leave` : r.leaveStatus} /> : '—'}</td>
                  <td>{r.hasPendingCorrection ? <Badge text="Correction pending" /> : severe ? <Badge text="Severe late" /> : ['MissingCheckIn', 'MissingCheckOut', 'PendingLeave'].includes(r.status) ? <Badge text={r.status} /> : r.reviewed ? <Badge text="Reviewed" /> : '—'}</td>
                  <td className="nowrap">
                    {can('attendance.manage', 'attendance.approve_corrections') && <button className="btn flat sm" onClick={() => setModal({ record: r })}>Edit</button>}
                    {severe && can('attendance.manage', 'attendance.approve_corrections') && <button className="btn soft sm" onClick={() => review(r)}>Review</button>}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
        <div className="row no-print" style={{ marginTop: 14 }}>
          <span className="tiny">Showing {rows.length ? page * 50 + 1 : 0}–{Math.min((page + 1) * 50, rows.length)} of {rows.length} records · Page {page + 1} of {pages}</span>
          <div className="controls" style={{ margin: 0 }}>
            <button className="btn outline sm" disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button>
            <button className="btn outline sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        </div>
      </Card>
      {modal && <CorrectionForm record={modal.record} onClose={() => setModal(null)} />}
    </>
  );
}
