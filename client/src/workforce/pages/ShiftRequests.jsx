import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { Header, Card, Loading, ErrorBox, Badge, Table, useAction, useUi } from '../components/ui.jsx';

export default function ShiftRequests() {
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [run, busy] = useAction();
  const [filter, setFilter] = useState('Pending');
  const query = useQuery({
    queryKey: ['shift-request-overview'],
    queryFn: () => api.get('/api/admin/overview'),
    refetchInterval: 15000,
  });
  const shifts = query.data?.shifts || [];
  const shown = shifts.filter((s) => filter === 'All' || s.status === filter);
  const decide = async (s, action) => {
    const approving = action === 'Approve';
    const ok = await confirm({
      title: `${action} shift request — ${s.username}`,
      message: `${s.shiftType || 'Custom Shift'}: ${s.customTiming || '—'}\nImportant: custom times are NOT automatically assigned to payroll by the current backend. Check employee shift after approval.`,
      danger: !approving,
      confirmText: action,
    });
    if (!ok) return;
    const saved = await run(() => api.post('/api/admin/shift/action', { ShiftId: s.id, Action: action }), `Shift ${approving ? 'approved' : 'denied'}.${approving ? ' Verify assigned shift before payroll.' : ''}`);
    if (saved) qc.invalidateQueries();
  };
  return <>
    <Header overline="Administration / attendance" title="Shift requests" subtitle="Approve or deny Flutter Attendance App shift requests from the ERP. Custom times require separate payroll shift assignment." />
    <ErrorBox error={query.error} />
    <Card title={`Shift requests (${shifts.length})`}>
      <div className="pill-tabs">{['Pending','Approved','Denied','All'].map(s => <button key={s} className={filter === s ? 'on' : ''} onClick={() => setFilter(s)}>{s}</button>)}</div>
      <button className="btn outline sm" onClick={() => query.refetch()} disabled={query.isFetching}>Refresh</button>
      {query.isLoading ? <Loading /> : shown.length === 0 ? <p>No {filter.toLowerCase()} shift requests.</p> : <Table heads={['Employee','Shift type','Requested time','Requested at','Status','Action']} minWidth={760}>
        {shown.map(s => <tr key={s.id}>
          <td>{s.username}</td><td>{s.shiftType || '—'}</td><td>{s.customTiming || '—'}</td><td>{s.requestedAt ? new Date(s.requestedAt).toLocaleString() : '—'}</td><td><Badge text={s.status} /></td>
          <td>{s.status === 'Pending' ? <><button className="btn soft sm" disabled={busy} onClick={() => decide(s,'Approve')}>Approve</button>{' '}<button className="btn flat sm" disabled={busy} onClick={() => decide(s,'Deny')}>Deny</button></> : (s.finalRemarks || '—')}</td>
        </tr>)}
      </Table>}
    </Card>
    <div className="notice warning">Current backend: approving a predefined shift can update the employee's assigned shift. Approving a CUSTOM shift only updates request status; it does not yet apply the requested start/end times to payroll. Verify in Policy Settings before salary calculations.</div>
  </>;
}
