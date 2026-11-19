import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadFile, qs } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Card, ErrorBox, Field, Header, Kpi, Kpis, Loading, Modal, MonthPicker, MoneySpan, Person, Table, useAction, useUi } from '../components/ui.jsx';
import { money, monthLabel } from '../format.js';
import { MarkPaidModal } from '../components/EmployeeDetail.jsx';
import PayslipBody, { printPayslip } from '../components/Payslip.jsx';

const SELECTABLE = ['Draft', 'UnderReview'];

function BulkPreview({ ids, onClose, onDone }) {
  const [run, busy] = useAction();
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['approve-preview', ids], queryFn: () => api.post('/api/payroll/approve-bulk/preview', { ids }) });
  const eligible = q.data?.eligible || [];
  const blocked = q.data?.blocked || [];
  const go = async () => {
    const r = await run(() => api.post('/api/payroll/approve-bulk', { ids: eligible.map((x) => x.id), note }),
      (res) => `${res.approved.length} salary(ies) approved and locked${res.blocked.length ? `; ${res.blocked.length} blocked` : ''}.`);
    if (r) onDone();
  };
  return (
    <Modal title="Approve selected payroll" onClose={onClose} width={760}
      footer={<><button className="btn outline" onClick={onClose}>Cancel</button><button className="btn" disabled={busy || !eligible.length} onClick={go}>Approve {eligible.length} eligible</button></>}>
      {q.isLoading ? <Loading text="Checking blockers…" /> : (
        <>
          <div className="notice good">✓ Eligible ({eligible.length}) — an immutable snapshot is saved for each; advance installments are posted once.</div>
          <Table heads={['Employee', 'Net salary']} empty="No eligible employees in this selection">
            {eligible.map((e) => <tr key={e.id}><td>{e.employeeName} · {e.employeeCode}</td><td><b>{money(e.net)}</b></td></tr>)}
          </Table>
          {blocked.length > 0 && (
            <>
              <div className="notice warning" style={{ marginTop: 14 }}>⚠ Blocked ({blocked.length}) — these will NOT be approved until resolved.</div>
              <Table heads={['Employee', 'Blockers']}>
                {blocked.map((b) => <tr key={b.id}><td>{b.employeeName || `Record #${b.id}`}</td><td className="wrap redtext">{b.reasons.join('; ')}</td></tr>)}
              </Table>
            </>
          )}
          <Field label="Approval note (optional)" full><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </>
      )}
    </Modal>
  );
}

export default function Payroll() {
  const { month, setMonth, openEmployee, can } = useApp();
  const qc = useQueryClient();
  const { confirm, toast } = useUi();
  const [run, busy] = useAction();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [modal, setModal] = useState(null);
  const q = useQuery({ queryKey: ['payroll', month], queryFn: () => api.get(`/api/payroll${qs({ month })}`) });
  const all = q.data?.records || [];
  const records = useMemo(() => all.filter((r) => (!status || r.status === status) && (!search || `${r.fullName} ${r.employeeCode} ${r.department}`.toLowerCase().includes(search.toLowerCase()))), [all, status, search]);
  // "Select all" = only eligible records (Draft / Under Review without blockers) in the current filtered view.
  const eligibleVisible = records.filter((r) => SELECTABLE.includes(r.status) && r.blockers.length === 0);
  const selectableVisible = records.filter((r) => SELECTABLE.includes(r.status));
  const allChecked = eligibleVisible.length > 0 && eligibleVisible.every((r) => selected.has(r.id));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectAll = (on) => setSelected(on ? new Set(eligibleVisible.map((r) => r.id)) : new Set());
  const selIds = [...selected].filter((id) => all.some((r) => r.id === id && SELECTABLE.includes(r.status)));
  const refresh = () => { setSelected(new Set()); qc.invalidateQueries(); };

  const bulkReject = async () => {
    if (!selIds.length) return toast('Select at least one Draft or Under Review employee.');
    let reason = '';
    const ok = await confirm({
      title: `Reject ${selIds.length} selected salary(ies)?`, danger: true, confirmText: 'Reject selected',
      message: 'Rejected payroll stays editable and can be reopened. Give a reason:',
      children: <textarea style={{ marginTop: 10 }} minLength={5} placeholder="Reason (min 5 characters)" onChange={(e) => { reason = e.target.value; }} />,
    });
    if (!ok) return undefined;
    const r = await run(() => api.post('/api/payroll/reject-bulk', { ids: selIds, reason }), (res) => `${res.rejected.length} rejected${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}.`);
    if (r) refresh();
    return undefined;
  };
  const recalc = async () => { if (await run(() => api.post('/api/payroll/calculate', { month }), 'Draft payroll recalculated from PostgreSQL.')) refresh(); };
  const reopen = async (r) => { if (await run(() => api.post(`/api/payroll/${r.id}/reopen`, { note: 'Reopened from payroll register' }), 'Payroll reopened as Draft.')) refresh(); };
  const openSlip = async (r) => { const d = await run(() => api.get(`/api/payroll/${r.id}/payslip`)); if (d) setModal({ type: 'slip', record: d }); };

  const count = (s) => all.filter((r) => r.status === s).length;
  return (
    <>
      <Header overline="Payroll workspace / payroll" title="Payroll & payslips" subtitle="Review all salary components, approve payroll, and record payments." month={month}>
        <MonthPicker value={month} onChange={(m) => { setSelected(new Set()); setMonth(m); }} />
        {can('payroll.calculate') && <button className="btn outline sm" disabled={busy} onClick={recalc}>Recalculate drafts</button>}
        <button className="btn outline sm" onClick={() => downloadFile(`/api/payroll/export?month=${month}`, `payroll_${month}.csv`)}>Export CSV</button>
      </Header>
      <ErrorBox error={q.error} />
      <Kpis>
        <Kpi label="Projected net payroll" value={money(all.reduce((a, r) => a + Number(r.netSalary), 0))} foot="Draft and approved amounts" />
        <Kpi label="Awaiting approval" value={`${count('Draft') + count('UnderReview')} employees`} foot={`${all.filter((r) => r.blockers.length).length} blocked by exceptions`} />
        <Kpi label="Approved" value={count('Approved')} foot="Locked payslip snapshots" />
        <Kpi label="Marked paid" value={count('Paid')} foot="Payment reference recorded" />
      </Kpis>
      <Card title="Employee payroll register" sub={`Verified commissions, approved leave, adjustments and active advances are reflected automatically · ${monthLabel(month)}`}>
        {can('payroll.approve') && (
          <div className="controls no-print">
            <label className="inline-check"><input type="checkbox" checked={allChecked} disabled={!eligibleVisible.length} onChange={(e) => selectAll(e.target.checked)} /> Select all eligible ({eligibleVisible.length})</label>
            <button className="btn sm" disabled={!selIds.length} onClick={() => setModal({ type: 'approve' })}>Approve Selected ({selIds.length})</button>
            <button className="btn outline sm" disabled={!selIds.length || busy} onClick={bulkReject}>Reject Selected</button>
            {selectableVisible.length > eligibleVisible.length && <span className="tiny">{selectableVisible.length - eligibleVisible.length} draft(s) have blockers and are not included in Select all.</span>}
          </div>
        )}
        <div className="controls no-print">
          <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['Draft', 'UnderReview', 'Approved', 'Rejected', 'Paid'].map((s) => <option key={s} value={s}>{s === 'UnderReview' ? 'Under Review' : s}</option>)}</select></Field>
          <Field label="Search" grow><input placeholder="Name, department or employee code" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <button className="btn outline" onClick={() => { setSearch(''); setStatus(''); }}>Clear</button>
        </div>
        {q.isLoading ? <Loading /> : (
          <Table heads={[can('payroll.approve') ? '' : '#', 'Employee', 'Base pay', 'Present', 'Late time', 'Commission', 'Total deductions', 'Net salary', 'Status', 'Review']}>
            {records.map((r) => {
              const selectable = SELECTABLE.includes(r.status);
              return (
                <tr key={r.id}>
                  <td className="checkcell">{can('payroll.approve') ? <input type="checkbox" aria-label={`Select ${r.fullName}`} disabled={!selectable} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /> : r.id}</td>
                  <td><Person name={r.fullName} sub={r.department} code={r.employeeCode} demo={r.isDemo} /></td>
                  <td><MoneySpan n={r.baseSalary} /></td>
                  <td>{r.presentDays}/{r.scheduledDays}</td>
                  <td>{r.lateMinutes}m</td>
                  <td><MoneySpan n={r.commissionTotal} cls="greentext" /></td>
                  <td><MoneySpan n={r.totalDeductions} cls="redtext" /></td>
                  <td><b>{money(r.netSalary)}</b></td>
                  <td>
                    <Badge text={r.status} />
                    {r.status === 'Rejected' && (can('payroll.calculate') || can('payroll.approve')) && <button className="btn flat sm" onClick={() => reopen(r)}>Reopen</button>}
                    {r.blockers.length > 0 && <div className="tiny redtext" title={r.blockers.map((b) => b.message).join('\n')}>{r.blockers.length} to review</div>}
                  </td>
                  <td className="nowrap">
                    <button className="btn soft sm" onClick={() => openEmployee(r.employeeId)}>Review →</button>{' '}
                    <button className="btn flat sm" onClick={() => openSlip(r)}>Payslip</button>
                    {r.status === 'Approved' && can('payroll.pay') && <button className="btn flat sm" onClick={() => setModal({ type: 'paid', record: r })}>Mark paid</button>}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <div className="notice">Approval locks the monthly salary snapshot (enforced by the database). “Mark paid” records the payment reference; it does not send money. Corrections after approval go through authorised payroll adjustments.</div>
      {modal?.type === 'approve' && <BulkPreview ids={selIds} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal?.type === 'paid' && <MarkPaidModal record={modal.record} onClose={() => setModal(null)} />}
      {modal?.type === 'slip' && (
        <Modal title={modal.record.official ? 'Payslip' : 'Provisional salary statement'} onClose={() => setModal(null)} footer={<button className="btn outline" onClick={() => printPayslip(modal.record)}>Print / save as PDF</button>}>
          {!modal.record.official && <div className="notice warning">Draft figures — they can still change until payroll is approved.</div>}
          <PayslipBody record={modal.record} />
        </Modal>
      )}
    </>
  );
}
