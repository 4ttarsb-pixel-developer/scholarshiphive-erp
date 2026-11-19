// One employee on its own page (opened from an employee tile in Admin Settings → Users & Roles).
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Copy, Printer, Wallet, WalletCards, KeyRound, Lock } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { Badge, Button, Card, Notice, useToast } from '../../components/ui.jsx';
import { money, date, dateTime, titleCase } from '../../lib/format.js';
import { AccessIcons, UserDetail } from './AdminSettings.jsx';

export default function EmployeePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { boot, can } = useAuth();
  const { data, reload } = useLoad(`/users/${id}`);
  const u = data?.user;
  const copy = () => {
    if (!u) return;
    const lines = [
      `${u.full_name} (${u.employee_code})`, `Designation: ${u.designation || '—'}`, `Role / status: ${titleCase(u.role)} / ${titleCase(u.status)}`,
      `Father name: ${u.father_name || '—'}`, `CNIC: ${u.cnic || '—'}`, `Email: ${u.email}`, `Phone: ${[u.phone1, u.phone2].filter(Boolean).join(', ') || '—'}`,
      `Address: ${u.address || '—'}`, `Permanent address: ${u.permanent_address || '—'}`,
      `Education: ${(u.education || []).map(e => `${e.degree} — ${e.institute} (${e.year})`).join('; ') || '—'}`,
      `Page access: ${u.role !== 'employee' ? 'Full access' : Object.entries(data.perms || {}).map(([k, l]) => `${boot.modules.find(m => m.key === k)?.label || k} (${l})`).join(', ') || 'None'}`,
      `Registered: ${dateTime(u.created_at)} · Last login: ${dateTime(u.last_login_at)}`,
    ];
    navigator.clipboard?.writeText(lines.join('\n').replace(/[⁦⁩]/g, '')).then(() => toast.success('Employee details copied.'), () => toast.error('Copy failed.'));
  };
  const b = data?.budget;
  return (
    <>
      <div className="page-head">
        <div><Link to="/settings/admin/users" className="small row" style={{ gap: 4, marginBottom: 4 }}><ArrowLeft size={14} />All employees</Link>
          <h1>{u ? u.full_name : 'Employee'}</h1><p>{u ? `${u.employee_code} · ${u.designation || titleCase(u.role)}` : 'Loading…'}</p></div>
        <div className="page-actions">
          <Button icon={Copy} onClick={copy} disabled={!u}>Copy details</Button>
          <Button icon={Printer} onClick={() => window.print()} disabled={!u}>Print / PDF</Button>
          {u && u.status === 'approved' && can('cashflow', 'edit') && <Link className="btn btn-primary" to={`/cash-flow/budgets?allot=employee&user=${u.id}`}><WalletCards />Allot budget</Link>}
        </div>
      </div>
      {u && (
        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          <Card title={<span className="row" style={{ gap: 6 }}><KeyRound size={16} />Page access</span>} subtitle="Full module access given by admin — stays until you take it back">
            <AccessIcons u={{ ...u, perms: data.perms }} modules={boot.modules} />
            <div className="small muted" style={{ marginTop: 8 }}>{u.role !== 'employee' ? 'Admins can open everything.' : 'Change it in “Page access” below.'}</div>
          </Card>
          <Card title={<span className="row" style={{ gap: 6 }}><Wallet size={16} />Expense budget</span>} subtitle="Limited cash access from Cash Flow Manager">
            {b ? <>
              <div className="detail-amount" style={{ marginBottom: 6 }}><span>{money(b.balance)}</span><Badge tone={b.state === 'active' ? 'green' : 'grey'}>{b.state === 'active' ? 'Active' : 'Closed'}</Badge></div>
              <div className="small muted">Allotted {money(b.allotted - b.returned)} · spent {money(b.spent)}{b.valid_until ? ` · until ${date(b.valid_until)}` : ''}</div>
              {can('cashflow') && <Link className="small" to="/cash-flow/budgets">Open Budget allotment →</Link>}
            </> : <div className="small muted">No budget. {can('cashflow', 'edit') && u.status === 'approved' ? <Link to={`/cash-flow/budgets?allot=employee&user=${u.id}`}>Allot one →</Link> : null}</div>}
          </Card>
          <Card title={<span className="row" style={{ gap: 6 }}><Lock size={16} />Account</span>}>
            <div className="slip-row"><span>Status</span><Badge status={u.status} /></div>
            <div className="slip-row"><span>Google verified</span><b>{u.google_verified ? 'Yes' : 'No'}</b></div>
            <div className="slip-row"><span>Last login</span><b>{dateTime(u.last_login_at)}</b></div>
          </Card>
        </div>
      )}
      <UserDetail id={id} onChanged={reload} onDeleted={() => nav('/settings/admin/users')} />
      {u && u.role !== 'employee' && <div style={{ marginTop: 12 }}><Notice type="info">Admins already have full access to every page.</Notice></div>}
    </>
  );
}
