import { Link } from 'react-router-dom';
import { Building2, Landmark, Scale, ArrowUpRight, Wallet } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { Card, Notice } from '../components/ui.jsx';

const AREAS = [
  { to: '/assets', key: 'assets', title: 'Assets', desc: 'Cash, bank balances, receivables, equipment, vehicles and other things the business owns.', icon: Building2, action: 'Open assets' },
  { to: '/liabilities', key: 'liabilities', title: 'Liabilities', desc: 'Loans, supplier balances, payables and amounts the business still owes.', icon: Landmark, action: 'Open liabilities' },
  { to: '/capital', key: 'cashflow', title: 'Capital & Equity', desc: 'The accounting equation, fixed and working capital, debt capital and owner equity.', icon: Scale, action: 'Open capital & equity' },
];

export default function Accounts() {
  const { can } = useAuth();
  const visible = AREAS.filter(x => can(x.key, 'view') || (x.key === 'cashflow' && can('assets', 'view')));
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Accounts</h1><p>Assets, liabilities and capital in one place. Open the section you need—no separate clutter in the main menu.</p></div>
      </div>
      <div className="grid grid-3 accounts-hub">
        {visible.map(({ to, title, desc, icon: Icon, action }) => (
          <Link key={to} to={to} className="card card-pad account-hub-card">
            <span className="account-hub-icon"><Icon size={22} /></span>
            <h3>{title}</h3>
            <p>{desc}</p>
            <span className="account-hub-action">{action}<ArrowUpRight size={15} /></span>
          </Link>
        ))}
      </div>
      {!visible.length && <Notice type="warn">Your account does not currently have access to an Accounts section. Ask an admin to enable Assets, Liabilities or Cash Flow access.</Notice>}
      <Card title="How the accounts fit together" subtitle="Keep the balance sheet connected">
        <div className="accounts-equation"><b>Assets</b><span>=</span><b>Liabilities</b><span>+</span><b>Capital & Equity</b></div>
        <p className="small muted" style={{ marginBottom: 0 }}>Record an asset or a liability in its own register. Capital & Equity then brings these figures together so the accounting equation can be reviewed from one place.</p>
      </Card>
    </div>
  );
}
