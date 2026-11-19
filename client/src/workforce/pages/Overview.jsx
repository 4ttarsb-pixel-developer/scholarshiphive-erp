import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Card, ErrorBox, Header, Kpi, Kpis, Loading, MonthPicker, MoneySpan, Person, Table } from '../components/ui.jsx';
import { money, monthLabel, shortDate, label } from '../format.js';

/** Team payroll rows. Overview never shows selection checkboxes (selection lives on the Payroll page only). */
export function PayrollRows({ records, onReview }) {
  return records.map((r) => (
    <tr key={r.id}>
      <td><Person name={r.fullName} sub={r.department} code={r.employeeCode} demo={r.isDemo} /></td>
      <td><MoneySpan n={r.baseSalary} /></td>
      <td>{r.presentDays}/{r.scheduledDays}</td>
      <td>{r.lateMinutes}m</td>
      <td><MoneySpan n={r.commissionTotal} cls="greentext" /></td>
      <td><MoneySpan n={r.totalDeductions} cls="redtext" /></td>
      <td><b>{money(r.netSalary)}</b></td>
      <td><Badge text={r.status} />{r.blockers.length > 0 && <div className="tiny redtext">{r.blockers.length} to review</div>}</td>
      <td><button className="btn soft sm" onClick={() => onReview(r.employeeId)}>Review →</button></td>
    </tr>
  ));
}

export default function Overview() {
  const { month, setMonth, openEmployee, setTab, can } = useApp();
  const q = useQuery({ queryKey: ['dashboard', month], queryFn: () => api.get(`/api/dashboard?month=${month}`) });
  const ex = useQuery({ queryKey: ['exceptions', month], queryFn: () => api.get(`/api/exceptions?month=${month}`) });
  const d = q.data;
  const k = d?.kpis;
  const records = d?.records || [];
  const baseTotal = Number(k?.monthlyBasePayroll || 0) || 1;
  const chart = k ? [['Base pay', k.monthlyBasePayroll], ['Commission', k.earnedCommissions], ['Deductions', k.attendanceDeductions], ['Advances', k.advanceRecoveries]] : [];
  return (
    <>
      <Header overline="Payroll workspace / overview" title="Payroll overview" subtitle={`Attendance-linked salary calculations for ${records.length} employee(s) · ${monthLabel(month)}`} month={month}>
        <MonthPicker value={month} onChange={setMonth} />
        {can('payroll.view') && <button className="btn outline sm" onClick={() => downloadFile(`/api/payroll/export?month=${month}`, `payroll_${month}.csv`)}>Export payroll CSV</button>}
      </Header>
      <ErrorBox error={q.error} />
      {q.isLoading ? <Loading /> : k && (
        <>
          <Kpis>
            <Kpi label="Total employees" value={k.totalEmployees} foot={`${k.presentToday} checked in today · ${k.checkedInNow} on shift now`} />
            <Kpi label="Monthly base payroll" value={money(k.monthlyBasePayroll)} foot="Sum of base salaries in this period" />
            <Kpi label="Verified monthly revenue" value={money(k.verifiedRevenue)} foot={`${k.pendingSales} pending sale(s) not counted`} />
            <Kpi label="Earned commissions" value={money(k.earnedCommissions)} foot="From verified sales only" />
          </Kpis>
          <Kpis>
            <Kpi label="Attendance deductions" value={money(k.attendanceDeductions)} foot="Late, absence and unpaid leave" />
            <Kpi label="Outstanding advances" value={money(k.outstandingAdvances)} foot={`${money(k.advanceRecoveries)} recovered this month`} />
            <Kpi label="Projected net payroll" value={money(k.projectedNetPayroll)} foot="Draft + approved amounts" />
            <Kpi label="Pending payroll approvals" value={k.pendingApprovals} foot={`${k.exceptions} exception(s) · ${k.approved} approved · ${k.paid} paid`} />
          </Kpis>
          <div className="grid2">
            <Card title="Team payroll snapshot" sub="One-click review opens the full salary breakdown.">
              <Table heads={['Employee', 'Base pay', 'Attendance', 'Late', 'Commission', 'Deductions', 'Net salary', 'Status', '']}>
                <PayrollRows records={records} onReview={openEmployee} />
              </Table>
            </Card>
            <Card title="Payroll insights" sub="Quick management summary">
              <div className="grid22">
                <div className="mini-stat"><span className="tiny">Check-ins today</span><strong>{k.presentToday}/{k.totalEmployees}</strong><small className="tiny">From the Attendance app</small></div>
                <div className="mini-stat"><span className="tiny">Paid salaries</span><strong>{k.paid}/{records.length}</strong><small className="tiny">Marked paid</small></div>
              </div>
              <div className="divider" />
              <h2>Compensation composition</h2>
              <p className="tiny">Amounts in thousands (PKR)</p>
              {chart.map(([n, v]) => (
                <div className="barrow" key={n}><span>{n}</span><div className="progress"><span style={{ width: `${Math.max(3, Math.min(100, (Number(v) / baseTotal) * 100))}%` }} /></div><b>{(Number(v) / 1000).toFixed(0)}k</b></div>
              ))}
              <div className="divider" />
              <h2>Urgent review queue</h2>
              {(ex.data?.items || []).slice(0, 5).map((i, idx) => (
                <div className="listitem" key={idx}><div className="row"><b>{i.employeeName}</b><Badge text={label(i.code === 'PENDING_LEAVE' ? 'PendingLeave' : i.code === 'MISSING_CHECKOUT' ? 'MissingCheckOut' : i.code === 'MISSING_CHECKIN' ? 'MissingCheckIn' : i.code === 'SEVERE_LATE' ? 'Severe late' : 'Pending')} /></div><div className="tiny">{i.date ? shortDate(i.date) : ''} · {i.message}</div></div>
              ))}
              {!ex.isLoading && !(ex.data?.items || []).length && <p className="tiny">All exceptions resolved.</p>}
              <button className="btn outline sm" style={{ marginTop: 12 }} onClick={() => setTab('exceptions')}>Open exception queue →</button>
            </Card>
          </div>
          <div className="notice">Figures are calculated on the server from PostgreSQL attendance, verified revenue, approved leave, adjustments and advances. They refresh automatically when anything changes.</div>
        </>
      )}
    </>
  );
}
