import { Link } from 'react-router-dom';
import { BadgeDollarSign, TrendingUp, Wallet, Receipt, LineChart, Users, Megaphone, ShieldAlert, ClipboardCheck, Coins, Inbox } from 'lucide-react';
import { useAuth, useLoad } from '../lib/auth.jsx';
import { Badge, Card, Kpi, Loader, Notice } from '../components/ui.jsx';
import { money, monthName, ago, titleCase } from '../lib/format.js';

export default function Dashboard() {
  const { user, isAdmin, boot, can } = useAuth();
  const { data: d, error } = useLoad('/dashboard');
  const { data: cashFlow } = useLoad(can('cashflow') ? '/cashflow/runway' : null);
  if (!d) return error ? <Notice type="error">{error.message}</Notice> : <Loader />;
  const s = d.mySalary;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const pend = d.pending ? Object.values(d.pending).reduce((a, b) => a + b, 0) : 0;
  return (
    <>
      <div className="page-head">
        <div><h1>Cash Flow Manager</h1><p>{greet}, {user.full_name.split(' ')[0]} · {monthName(d.month)} dashboard overview</p></div>
      </div>
      {isAdmin && !boot?.smtpConfigured && <div style={{ marginBottom: 16 }}><Notice type="warn">Automatic emails are off. Add your Gmail App Password in the .env file (SETUP_GUIDE.md) so approvals, salaries and announcements are emailed.</Notice></div>}

      <div className="grid grid-kpi">
        <Kpi icon={BadgeDollarSign} color="blue" label="My salary this month" value={money(s.net_salary)} sub={<Badge status={s.status}>{s.status_label}</Badge>} />
        <Kpi icon={TrendingUp} color="green" label="My sales this month" value={money(s.sales)} sub={`${s.commission_pct}% commission = ${money(s.commission)}`} />
        {d.revenue && <Kpi icon={Coins} color="purple" label="Company collected" value={money(d.revenue.collected)} sub={`Refunds ${money(d.revenue.refunds)}`} />}
        {d.expenses && <Kpi icon={Receipt} color="orange" label="Total expenses" value={money(d.expenses.total)} sub="Constant + variable + petty + salaries" />}
        {d.profit && <Kpi icon={LineChart} color={d.profit.net >= 0 ? 'cyan' : 'red'} label="Net profit / loss" value={money(d.profit.net)} sub={`Margin ${d.profit.margin}%`} />}
        {d.petty && <Kpi icon={Wallet} color="cyan" label="Petty cash balance" value={money(d.petty.balance)} sub={`Spent ${money(d.petty.spent)} of ${money(d.petty.topups)}`} />}
        {cashFlow?.position && <Kpi icon={Wallet} color="blue" label="Cash available" value={money(cashFlow.position.cash)} sub={<Link to="/cash-flow">Cash Flow Manager →</Link>} />}
        {d.approvals !== undefined && <Kpi icon={ClipboardCheck} color="orange" label="Waiting for your approval" value={d.approvals} sub={<Link to="/expenses/approvals">Open approvals →</Link>} />}
      </div>

      <div className="grid grid-main mt">
        <div className="stack">
          {isAdmin && (
            <Card title="Waiting for your action" subtitle={pend ? `${pend} item(s) need attention` : 'All clear'}>
              <div className="grid grid-3" style={{ gap: 10 }}>
                {[
                  ['New registrations', d.pending.users, '/settings/admin/users', Users],
                  ['Access requests', d.pending.requests, '/settings/admin/requests', ShieldAlert],
                  ['Expenses to approve', d.pending.expenses, '/expenses/approvals', Receipt],
                  ['Petty receipts to verify', d.pending.petty, '/petty-cash/entries?status=pending', Wallet],
                  ['Salaries in process', d.pending.salaries, '/salary', ClipboardCheck],
                ].map(([l, n, to, I]) => (
                  <Link key={l} to={to} className="card card-pad row" style={{ padding: 14, textDecoration: 'none', color: 'inherit' }}>
                    <I size={20} color={n ? 'var(--orange)' : 'var(--muted)'} /><div><div className="strong" style={{ fontSize: '1.2rem' }}>{n}</div><div className="small muted">{l}</div></div>
                  </Link>
                ))}
              </div>
            </Card>
          )}
          <Card title="My salary status" subtitle={monthName(d.month)} actions={<Link className="btn btn-sm" to="/my-salary">Open My Salary</Link>}>
            <div className="status-track">{['draft', 'in_process', 'approved', 'paid'].map((k, i) => <div key={k} className={['draft', 'in_process', 'approved', 'paid'].indexOf(s.status) >= i ? 'on' : ''}>{titleCase(k)}</div>)}</div>
            <div className="slip-row"><span>Base salary</span><b>{money(s.base_salary)}</b></div>
            <div className="slip-row"><span>Commission ({s.commission_pct}% of {money(s.sales)})</span><b>{money(s.commission)}</b></div>
            {(s.bonus > 0 || s.deductions > 0) && <div className="slip-row"><span>Bonus / deductions</span><b>+{money(s.bonus)} / −{money(s.deductions)}</b></div>}
            <div className="slip-row total"><span>Net salary</span><span>{money(s.net_salary)}</span></div>
            {!s.terms_set && <p className="hint">Your base salary has not been set by admin yet.</p>}
          </Card>
        </div>
        <div className="stack">
          {cashFlow?.position && <Card title={<span style={{fontSize:'1.25rem',fontWeight:850}}>Cash Flow Manager</span>} subtitle={cashFlow.runway.net === null ? 'Current cash position · forecast is cash-positive' : `Estimated cash runway · ${Math.round(cashFlow.runway.net * 10) / 10} months`}>
            <div className="slip-row"><span>Available cash</span><b>{money(cashFlow.position.cash)}</b></div>
            <div className="slip-row"><span>Cash held with staff</span><b>{money(cashFlow.position.withStaff.total)}</b></div>
            <div className="slip-row"><span>Bank / cash accounts</span><b>{money(cashFlow.position.statements.total)}</b></div>
            {cashFlow.forecast.zeroDate && <div className="small text-orange" style={{ marginTop: 8 }}>Forecast may fall below zero on {cashFlow.forecast.zeroDate}.</div>}
            <div className="grid grid-2" style={{marginTop:14,gap:8}}>{[['Cash Runway','/cash-flow/runway'],['Cash Forecast','/cash-flow/forecast'],['Inflow vs Outflow','/cash-flow/timing'],['Working Capital','/cash-flow/working-capital'],['Surplus & Deficit','/cash-flow/surplus-deficit'],['Cash Models','/cash-flow/models'],['Treasury & Banking','/cash-flow/treasury'],['Budget Allotment','/cash-flow/budgets'],['Payment Control','/cash-flow/payments'],['Profit & Loss','/cash-flow/profit-loss']].map(([label,to])=><Link key={to} className="btn btn-sm btn-outline" to={to}>{label} →</Link>)}</div>
          </Card>}
          <Card title="Announcements" actions={<Link className="btn btn-sm" to="/announcements">View all</Link>}>
            {d.latestAnnouncements.length ? d.latestAnnouncements.map(a => (
              <Link key={a.id} to={`/announcements?id=${a.id}`} className="list-row" style={{ color: 'inherit', textDecoration: 'none' }}>
                <span className="row" style={{ gap: 8 }}><Megaphone size={16} color="var(--primary)" />{a.title}</span><small className="muted nowrap">{ago(a.created_at)}</small>
              </Link>)) : <div className="muted small">No announcements yet.</div>}
          </Card>
          <Card title="My requests to admin" actions={<Link className="btn btn-sm" to="/settings/requests">New request</Link>}>
            {d.myRequests.length ? d.myRequests.map(r => (
              <div key={r.id} className="list-row"><span>{r.module ? `${titleCase(r.module)} (${r.level})` : titleCase(r.type)}</span><Badge status={r.status} /></div>
            )) : <div className="muted small row"><Inbox size={16} /> No requests.</div>}
          </Card>
        </div>
      </div>
    </>
  );
}
