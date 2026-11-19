import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Card, ErrorBox, Header, Loading, Modal, MonthPicker, Table, useAction } from '../components/ui.jsx';
import PayslipBody, { printPayslip } from '../components/Payslip.jsx';
import { fullDate, money, monthLabel, readableTime, shortDate, pct } from '../format.js';
import { LeaveForm } from './Leaves.jsx';

/** Employee self-service: own attendance, leave and payslips (read-only salary). */
export default function SelfService({ onLogout, embedded }) {
  const { month, setMonth, user } = useApp();
  const qc = useQueryClient();
  const [run] = useAction();
  const [modal, setModal] = useState(null);
  const q = useQuery({ queryKey: ['me-overview', month], queryFn: () => api.get(`/api/me/overview?month=${month}`), retry: false });
  const slips = useQuery({ queryKey: ['me-payslips'], queryFn: () => api.get('/api/me/payslips'), retry: false });
  const d = q.data;
  const content = (
    <>
      <Header overline={`Employee self-service / ${monthLabel(month)}`} title="My salary statement" subtitle={d ? `${d.employee.full_name} · ${d.employee.employee_code} · ${d.employee.department || ''}` : user.fullName} month={month}>
        <MonthPicker value={month} onChange={setMonth} />
        <button className="btn soft sm" onClick={() => setModal({ type: 'leave' })}>Apply for leave</button>
        {onLogout && <button className="btn outline sm" onClick={onLogout}>Sign out</button>}
      </Header>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Loading /> : d && (
        <>
          <div className="notice">Read-only view of your own data. Salary, commission and attendance can only be changed by authorised staff.</div>
          {d.statement ? (
            <Card title={['Approved', 'Paid'].includes(d.statement.status) ? 'My payslip' : 'Provisional statement (not final)'} extras={<button className="btn outline sm no-print" onClick={() => printPayslip(d.statement)}>Print / save as PDF</button>}>
              <PayslipBody record={d.statement} />
              <p className="tiny">Fixed commission rate: {pct(d.employee.fixed_rate_percent)}</p>
            </Card>
          ) : <div className="notice warning">No payroll for this month.</div>}
          <div className="grid22">
            <Card title="My attendance" sub="From the Attendance app">
              <Table heads={['Date', 'Status', 'In', 'Out', 'Late']}>
                {d.attendance.filter((a) => !['Upcoming', 'NotEmployed'].includes(a.status)).reverse().map((a) => <tr key={a.id}><td>{shortDate(a.date)}</td><td><Badge text={a.status} /></td><td>{readableTime(a.checkIn)}</td><td>{a.checkOut ? readableTime(a.checkOut) : '—'}</td><td>{a.lateMinutes}m</td></tr>)}
              </Table>
            </Card>
            <Card title="My leave requests">
              <Table heads={['Dates', 'Type', 'Status', '']}>
                {d.leaves.map((l) => <tr key={l.id}><td>{fullDate(l.startDate)}{l.endDate !== l.startDate ? ` → ${fullDate(l.endDate)}` : ''}</td><td>{l.leaveType}</td><td><Badge text={l.status === 'Approved' ? `${l.payType} leave` : l.status} /></td>
                  <td>{l.status === 'Pending' && <button className="btn flat sm" onClick={async () => { if (await run(() => api.post(`/api/me/leaves/${l.id}/cancel`), 'Leave cancelled.')) qc.invalidateQueries(); }}>Cancel</button>}</td></tr>)}
              </Table>
              {d.advances.length > 0 && <>
                <div className="divider" />
                <h2 style={{ fontSize: 14 }}>My advances</h2>
                {d.advances.map((a) => <div key={a.id} className="detailrow"><span>{fullDate(a.advanceDate)} · {money(a.amount)}</span><b>Balance {money(a.remainingBalance)} · <Badge text={a.status} /></b></div>)}
              </>}
            </Card>
          </div>
          <Card title="Payslip history" sub="Approved and paid months">
            <Table heads={['Month', 'Net salary', 'Status', '']} empty="No approved payslips yet">
              {(slips.data || []).map((s) => <tr key={s.id}><td>{monthLabel(s.periodMonth)}</td><td><b>{money(s.netSalary)}</b></td><td><Badge text={s.status} /></td>
                <td><button className="btn soft sm" onClick={async () => { const r = await run(() => api.get(`/api/payroll/${s.id}/payslip`)); if (r) setModal({ type: 'slip', record: r }); }}>View</button></td></tr>)}
            </Table>
          </Card>
        </>
      )}
      <p className="footer">This statement is generated from PostgreSQL. A payment reference is a record only; this system never transfers money.</p>
      {modal?.type === 'leave' && <LeaveForm self onClose={() => setModal(null)} />}
      {modal?.type === 'slip' && <Modal title="Payslip" onClose={() => setModal(null)} footer={<button className="btn outline" onClick={() => printPayslip(modal.record)}>Print / save as PDF</button>}><PayslipBody record={modal.record} /></Modal>}
    </>
  );
  if (embedded) return content;
  return <main style={{ maxWidth: 980, margin: '45px auto', padding: '0 16px' }}>{content}</main>;
}
