import React from 'react';
import { Badge, Person } from './ui.jsx';
import { dateTime, money, monthLabel } from '../format.js';

const ORDER = ['BASE', 'COMMISSION', 'BONUS', 'LATE', 'EARLY', 'ABSENCE', 'NOT_EMPLOYED', 'UNPAID_LEAVE', 'EXCESS_PAID_LEAVE', 'UNPAID_HOLIDAY', 'ADVANCE', 'OTHER'];

/** Salary breakdown + payslip body (same structure as the original slipBody). */
export default function PayslipBody({ record, showLines = true }) {
  if (!record) return null;
  const r = record;
  const lines = [...(r.lines || [])].sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code) || (a.sort_order || 0) - (b.sort_order || 0));
  const summary = r.attendanceSummary || {};
  const groups = [
    ['Base salary', r.baseSalary, 1],
    ['Verified commission', r.commissionTotal, 1],
    ['Approved bonus', r.bonusTotal, 1],
    ['Attendance deductions (late / absence / pro-rata)', r.attendanceDeductions, -1],
    ['Unpaid leave deductions', r.unpaidLeaveDeduction, -1],
    ['Advance installment', r.advanceRecovery, -1],
    ['Other authorised deductions', r.otherDeductions, -1],
  ];
  return (
    <div>
      <div className="row" style={{ marginBottom: 13 }}>
        <div>
          <Person name={r.fullName || r.employee?.full_name} sub={r.department || r.employee?.department} code={r.employeeCode || r.employee?.employee_code} demo={r.isDemo} />
          <div className="tiny" style={{ marginLeft: 43 }}>{monthLabel(r.periodMonth)} · {r.scheduledDays} scheduled working day(s) · daily rate {money(r.dailyRate)}</div>
        </div>
        <Badge text={r.status} />
      </div>
      {groups.map(([name, amt, sign]) => (
        <div className="detailrow" key={name}>
          <span>{name}</span>
          <b className={sign < 0 && Number(amt) > 0 ? 'redtext' : sign > 0 && Number(amt) > 0 && name !== 'Base salary' ? 'greentext' : ''}>{sign < 0 ? '− ' : '+ '}{money(amt)}</b>
        </div>
      ))}
      <div className="detailrow"><div><b>Gross earnings</b></div><b>{money(r.grossEarnings)}</b></div>
      <div className="detailrow"><div><b>Total deductions</b></div><b className="redtext">− {money(r.totalDeductions)}</b></div>
      <div className="detailrow">
        <div><b>Net payable</b><div className="tiny">Before statutory deductions, if any</div></div>
        <span className="value-lg">{money(r.netSalary)}</span>
      </div>
      <div style={{ marginTop: 14 }} className="grid22">
        <div className="mini-stat"><span className="tiny">Attendance</span><strong>{r.presentDays}/{r.scheduledDays}</strong><small className="tiny">Present days ({summary.upcoming || 0} upcoming)</small></div>
        <div className="mini-stat"><span className="tiny">Late time</span><strong>{r.lateMinutes} min</strong><small className="tiny">{r.absentDays} absent, {r.paidLeaveDays} paid leave, {r.unpaidLeaveDays} unpaid</small></div>
      </div>
      {showLines && lines.length > 0 && (
        <>
          <div className="divider" />
          <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Calculation lines</h2>
          {lines.map((l, i) => (
            <div className="detailrow" key={i} style={{ padding: '7px 0', fontSize: 12 }}>
              <span className="wrap">{l.description}</span>
              <b className={l.line_type === 'DEDUCTION' ? 'redtext' : ''}>{l.line_type === 'DEDUCTION' ? '− ' : '+ '}{money(l.amount)}</b>
            </div>
          ))}
        </>
      )}
      {r.approvedAt && <p className="tiny">Approved: {dateTime(r.approvedAt)}{r.approvedBy ? ` · ${r.approvedBy}` : ''} · snapshot locked</p>}
      {r.payment && <p className="tiny">Paid {r.payment.date} via {r.payment.method} · Ref {r.payment.reference}{r.payment.paidBy ? ` · ${r.payment.paidBy}` : ''}</p>}
    </div>
  );
}

/** Print only the payslip (uses the original @media print rules). */
export function printPayslip(record) {
  const root = document.getElementById('printroot');
  const r = record;
  const rows = [
    ['Base salary', r.baseSalary], ['Verified commission', r.commissionTotal], ['Approved bonus', r.bonusTotal],
    ['Attendance deductions', `-${r.attendanceDeductions}`], ['Unpaid leave deductions', `-${r.unpaidLeaveDeduction}`],
    ['Advance installment', `-${r.advanceRecovery}`], ['Other deductions', `-${r.otherDeductions}`],
  ];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const official = ['Approved', 'Paid'].includes(r.status);
  root.innerHTML = `<h1>Workforce Pay</h1><p>${official ? 'Employee salary statement' : 'PROVISIONAL draft statement — not final'} · ${esc(monthLabel(r.periodMonth))}</p>
  <p><b>${esc(r.fullName)}</b> · ${esc(r.employeeCode)} · ${esc(r.department)}${r.isDemo ? ' · DEMO' : ''}<br>Status: ${esc(r.status)}</p>
  <table style="width:100%;border-collapse:collapse;font-size:12px">${rows.map(([n, v]) => `<tr><td style="padding:6px;border-bottom:1px solid #ddd">${esc(n)}</td><td style="padding:6px;border-bottom:1px solid #ddd;text-align:right">${esc(money(v))}</td></tr>`).join('')}
  <tr><td style="padding:8px"><b>Gross earnings</b></td><td style="padding:8px;text-align:right"><b>${esc(money(r.grossEarnings))}</b></td></tr>
  <tr><td style="padding:8px"><b>Total deductions</b></td><td style="padding:8px;text-align:right"><b>${esc(money(r.totalDeductions))}</b></td></tr>
  <tr><td style="padding:8px;font-size:16px"><b>Net payable</b></td><td style="padding:8px;text-align:right;font-size:16px"><b>${esc(money(r.netSalary))}</b></td></tr></table>
  <h3 style="font-size:13px;margin-top:18px">Calculation lines</h3>
  <table style="width:100%;border-collapse:collapse;font-size:11px">${(r.lines || []).map((l) => `<tr><td style="padding:4px;border-bottom:1px solid #eee">${esc(l.description)}</td><td style="padding:4px;border-bottom:1px solid #eee;text-align:right">${l.line_type === 'DEDUCTION' ? '−' : '+'} ${esc(money(l.amount))}</td></tr>`).join('')}</table>
  <p style="font-size:11px">Attendance: ${esc(r.presentDays)}/${esc(r.scheduledDays)} present · ${esc(r.lateMinutes)} late minutes · ${esc(r.absentDays)} absent</p>
  ${r.approvedAt ? `<p style="font-size:11px">Approved ${esc(dateTime(r.approvedAt))} by ${esc(r.approvedBy || '')}</p>` : ''}
  ${r.payment ? `<p style="font-size:11px">Paid ${esc(r.payment.date)} via ${esc(r.payment.method)} · Ref ${esc(r.payment.reference)}</p>` : ''}
  <p style="margin-top:28px;font-size:11px">${official ? 'System-generated statement. A payment reference is a record only; no bank transfer is initiated by this system.' : 'Provisional — figures can change until payroll is approved.'}</p>`;
  const moduleRoot = root.closest('.workforce-module');
  moduleRoot?.classList.add('printslip');
  window.print();
  setTimeout(() => moduleRoot?.classList.remove('printslip'), 1500);
}
