import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Receipt, Repeat, Wallet } from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useServerList } from '../../lib/useServerList.js';
import { Badge, Button, Card, Loader, Notice, useToast } from '../../components/ui.jsx';
import ServerTable, { CardTabs } from '../../components/ServerTable.jsx';
import { money, date, monthName } from '../../lib/format.js';
import { ExpenseDetail, ReasonModal, StatusBadge, useBulkReview } from './shared.jsx';
import { ReceiptCell, RowReview, itemCell } from './Variable.jsx';
import { ordinal } from './ExpenseForm.jsx';

const asPage = rows => ({ rows, total: rows.length, page: 1, pages: 1, limit: rows.length || 1 });

export default function Approvals({ v, bump }) {
  const { can } = useAuth();
  const q = useServerList('/expenses/approvals', {}, [v]);
  const [tab, setTab] = useState('variable');
  const [open, setOpen] = useState(null);
  const reload = () => { q.reload(); bump?.(); };
  const exp = useBulkReview('/expenses/review/bulk', { onDone: reload });
  const pet = useBulkReview('/petty/review/bulk', { onDone: reload, approveStatus: 'verified' });
  useEffect(() => { exp.setSelected(new Set()); pet.setSelected(new Set()); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!q.data) return q.error ? <Notice type="error">{q.error.message}</Notice> : <Loader />;
  const d = q.data;
  const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
  const tabs = [
    { value: 'variable', label: 'Variable expenses', count: d.counts.variable, icon: Receipt },
    { value: 'cycles', label: 'Constant (monthly) cycles', count: d.counts.cycles, icon: CalendarClock },
    { value: 'templates', label: 'New recurring setups', count: d.counts.templates, icon: Repeat },
    ...(can('petty_cash') ? [{ value: 'petty', label: 'Petty cash receipts', count: d.counts.petty, icon: Wallet }, { value: 'topups', label: 'Petty top-ups', count: d.counts.topups, icon: Wallet }] : []),
  ];
  const expCols = [
    { key: 'expense_date', label: 'Date', render: r => date(r.expense_date) },
    { key: 'ref_no', label: 'Ref #', render: r => <span className="mono">{r.ref_no}</span> },
    { key: 'item', label: 'Expense', render: itemCell },
    { key: 'paid_to', label: 'Paid to' }, { key: 'entered_by', label: 'Entered by', render: r => r.entered_by || 'System' },
    { key: 'receipt', label: 'Receipt', render: r => <ReceiptCell row={r} /> },
    { key: 'amount', label: 'Amount', money: true },
    { key: 'act', label: '', render: r => <RowReview row={r} endpoint={`/expenses/${r.id}/review`} onDone={reload} /> },
  ];
  return (
    <div className="stack">
      {total === 0 ? <Notice type="success"><b>All clear.</b> Nothing is waiting for approval.</Notice>
        : <Notice type="info"><b>{total}</b> item(s) waiting. Tick rows and use the bar to approve many at once. You never see your own entries here — another approver must check them.</Notice>}
      <Card pad={false}>
        <CardTabs value={tab} onChange={setTab} tabs={tabs} />
        {(tab === 'variable' || tab === 'cycles') && <>
          {exp.bar}
          <ServerTable columns={tab === 'cycles' ? [{ key: 'cycle', label: 'Month', render: r => (r.cycle_month ? monthName(r.cycle_month) : '—') }, ...expCols] : expCols}
            data={asPage(d[tab])} selectable selected={exp.selected} onSelect={exp.setSelected} onRowClick={r => setOpen(r.id)}
            empty={tab === 'cycles' ? 'No monthly constant expenses waiting.' : 'No variable expenses waiting.'} />
          {exp.modal}
        </>}
        {tab === 'templates' && <ServerTable data={asPage(d.templates)} empty="No new recurring setups waiting." columns={[
          { key: 'ref_no', label: 'Ref #', render: r => <span className="mono">{r.ref_no}</span> },
          { key: 'title', label: 'Expense', render: r => <div className="cell-2"><b>{r.title}</b><small>{r.category}{r.sub_category ? ` › ${r.sub_category}` : ''}</small></div> },
          { key: 'sched', label: 'Schedule', render: r => `${r.frequency_label.split(' (')[0]} · ${ordinal(r.billing_day)} · from ${monthName(r.start_month)}` },
          { key: 'paid_to', label: 'Paid to' }, { key: 'entered_by', label: 'Entered by' },
          { key: 'amount', label: 'Amount', money: true },
          { key: 'act', label: '', render: r => <RowReview row={r} endpoint={`/expenses/recurring/${r.id}/review`} onDone={reload} /> }]} />}
        {tab === 'petty' && <>
          {pet.bar}
          <ServerTable data={asPage(d.petty)} selectable selected={pet.selected} onSelect={pet.setSelected} empty="No petty cash receipts to verify." columns={[
            { key: 'entry_date', label: 'Date', render: r => date(r.entry_date) }, { key: 'ref_no', label: 'Voucher #', render: r => <span className="mono">{r.ref_no}</span> },
            { key: 'item', label: 'Bought', render: itemCell }, { key: 'purchased_by', label: 'Bought by' },
            { key: 'receipt', label: 'Receipt', render: r => <ReceiptCell row={r} /> }, { key: 'amount', label: 'Amount', money: true },
            { key: 'act', label: '', render: r => <RowReview row={r} endpoint={`/petty/${r.id}/review`} onDone={reload} approveStatus="verified" /> }]} />
          {pet.modal}
          <div className="card-body small"><Link to="/petty-cash/entries?status=pending">Open in Petty Cash →</Link></div>
        </>}
        {tab === 'topups' && <ServerTable data={asPage(d.topups)} empty="No top-ups waiting." columns={[
          { key: 'expense_date', label: 'Date', render: r => date(r.expense_date) }, { key: 'ref_no', label: 'Ref #', render: r => <span className="mono">{r.ref_no}</span> },
          { key: 'paid_to', label: 'Given to' }, { key: 'payment_method', label: 'Method' }, { key: 'entered_by', label: 'Entered by' },
          { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} hold={r.on_hold} /> }, { key: 'amount', label: 'Amount', money: true },
          { key: 'act', label: '', render: r => <RowReview row={r} endpoint={`/petty/topups/${r.id}/review`} onDone={reload} /> }]} />}
      </Card>
      {open && <ExpenseDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}
