import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Card, ErrorBox, Header, Kpi, Kpis, Loading, MonthPicker, Person, Table, useAction, useUi, Field } from '../components/ui.jsx';
import { shortDate, dateTime } from '../format.js';
import { CorrectionForm } from './Attendance.jsx';

const ISSUE = { MISSING_CHECKOUT: 'MissingCheckOut', MISSING_CHECKIN: 'MissingCheckIn', PENDING_LEAVE: 'PendingLeave', SEVERE_LATE: 'Severe late', PENDING_CORRECTION: 'Correction pending', PENDING_ADJUSTMENT: 'Adjustment pending', INVALID_SALARY: 'Invalid salary', NEGATIVE_NET: 'Negative net', PERIOD_OPEN: 'Period open', NO_WORKING_DAYS: 'No working days' };

export default function Exceptions() {
  const { month, setMonth, can, openEmployee, setTab } = useApp();
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [run] = useAction();
  const [modal, setModal] = useState(null);
  const q = useQuery({ queryKey: ['exceptions', month], queryFn: () => api.get(`/api/exceptions?month=${month}`) });
  const items = q.data?.items || [];
  const n = (code) => items.filter((i) => i.code === code).length;

  const reviewLate = async (i) => {
    let note = '';
    const ok = await confirm({ title: 'Manager exception review', message: `${i.employeeName} · ${shortDate(i.date)} · ${i.lateMinutes} minutes late.\nReviewing does not remove the configured deduction.`, children: <textarea style={{ marginTop: 10 }} placeholder="Investigation outcome and manager decision" onChange={(e) => { note = e.target.value; }} />, confirmText: 'Mark reviewed' });
    if (ok && await run(() => api.post('/api/attendance/review', { employeeId: i.employeeId, date: i.date, note }), 'Review saved. Configured deduction remains.')) qc.invalidateQueries();
  };
  const decideLeave = async (i) => {
    let decision = 'approve'; let payType = 'Paid'; let note = '';
    const ok = await confirm({
      title: 'Decide leave request', message: `${i.employeeName} · ${shortDate(i.date)}`,
      children: <div style={{ marginTop: 10 }}>
        <Field label="Decision"><select onChange={(e) => { decision = e.target.value; }}><option value="approve">Approve leave</option><option value="reject">Reject leave</option></select></Field>
        <Field label="If approved"><select onChange={(e) => { payType = e.target.value; }}><option value="Paid">Paid</option><option value="Unpaid">Unpaid</option></select></Field>
        <Field label="Reason (mandatory)"><textarea minLength={5} onChange={(e) => { note = e.target.value; }} /></Field>
      </div>, confirmText: 'Save decision',
    });
    if (ok && await run(() => api.post(`/api/leaves/${i.leaveRequestId}/${decision}`, { payType, note }), 'Leave decision saved; Draft salary updated.')) qc.invalidateQueries();
  };
  const decideCorrection = async (i, decision) => {
    if (await run(() => api.post(`/api/attendance/corrections/${i.correctionId}/decide`, { decision, note: `${decision} from exception queue` }), `Correction ${decision.toLowerCase()}.`)) qc.invalidateQueries();
  };

  const action = (i) => {
    if (i.code === 'SEVERE_LATE' && can('attendance.manage', 'attendance.approve_corrections')) return <button className="btn sm" onClick={() => reviewLate(i)}>Review</button>;
    if (i.code === 'PENDING_LEAVE' && i.leaveRequestId && can('leave.manage')) return <button className="btn soft sm" onClick={() => decideLeave(i)}>Decide</button>;
    if (i.code === 'PENDING_CORRECTION' && i.correctionId && can('attendance.approve_corrections')) return <><button className="btn soft sm" onClick={() => decideCorrection(i, 'Approved')}>Approve</button> <button className="btn flat sm" onClick={() => decideCorrection(i, 'Rejected')}>Reject</button></>;
    if (['MISSING_CHECKOUT', 'MISSING_CHECKIN'].includes(i.code) && can('attendance.manage', 'attendance.approve_corrections')) return <button className="btn soft sm" onClick={() => setModal(i)}>Correct</button>;
    if (i.code === 'INVALID_SALARY' && can('employees.manage')) return <button className="btn soft sm" onClick={() => setTab('employees')}>Set salary</button>;
    if (i.code === 'PENDING_ADJUSTMENT') return <button className="btn soft sm" onClick={() => setTab('payroll')}>Open payroll</button>;
    return can('payroll.view') ? <button className="btn flat sm" onClick={() => openEmployee(i.employeeId)}>Open</button> : '—';
  };
  return (
    <>
      <Header overline="Payroll workspace / exceptions" title="Exception queue" subtitle="Resolve risky attendance records before approving pay. Every item blocks that employee's payroll approval." month={month}>
        <MonthPicker value={month} onChange={setMonth} />
      </Header>
      <ErrorBox error={q.error} />
      <Kpis>
        <Kpi label="Open exceptions" value={items.length} foot="Attendance, leave or payroll items" />
        <Kpi label="Severe lateness" value={n('SEVERE_LATE')} foot="Manager note required" />
        <Kpi label="Missing punches" value={n('MISSING_CHECKOUT') + n('MISSING_CHECKIN')} foot="Correct the actual times" />
        <Kpi label="Pending decisions" value={n('PENDING_LEAVE') + n('PENDING_CORRECTION') + n('PENDING_ADJUSTMENT')} foot="Leave, corrections, adjustments" />
      </Kpis>
      <Card title="Open exceptions" sub="Severe-late review does not waive its penalty. Pending leave needs a decision. A missing punch needs a correction with a reason.">
        {q.isLoading ? <Loading /> : (
          <Table heads={['Date', 'Employee', 'Issue', 'Details', 'Action']} empty="✓ No open exceptions for this month.">
            {items.map((i, idx) => (
              <tr key={idx}>
                <td>{i.date ? shortDate(i.date) : '—'}</td>
                <td><Person name={i.employeeName} sub={i.department} code={i.employeeCode} demo={i.isDemo} /></td>
                <td><Badge text={ISSUE[i.code] || i.code} /></td>
                <td className="wrap" style={{ maxWidth: 360 }}>{i.message}{i.checkInAt && <div className="tiny">Check-in {dateTime(i.checkInAt)}</div>}{i.correctionReason && <div className="tiny">{i.correctionReason}</div>}</td>
                <td className="nowrap">{action(i)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {modal && <CorrectionForm employeeId={modal.employeeId} date={modal.date} onClose={() => setModal(null)} />}
    </>
  );
}
