import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Layout, { Footer } from './components/Layout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { Loader } from './components/ui.jsx';
import Login from './pages/auth/Login.jsx';
import Locked from './pages/Locked.jsx';
import Dashboard from './pages/Dashboard.jsx';

// Pages load on demand → the first screen opens faster on mobile data.
const Setup = lazy(() => import('./pages/auth/Setup.jsx'));
const Register = lazy(() => import('./pages/auth/Register.jsx'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword.jsx'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword.jsx'));
const Revenue = lazy(() => import('./pages/revenue/Revenue.jsx'));
const NewSale = lazy(() => import('./pages/revenue/NewSale.jsx'));
const Expenses = lazy(() => import('./pages/expenses/Expenses.jsx'));
const MarketingExpenses = lazy(() => import('./marketing/App.jsx'));
const PettyCash = lazy(() => import('./pages/expenses/PettyCash.jsx'));
const WorkforceAnalyzer = lazy(() => import('./pages/expenses/WorkforceAnalyzer.jsx'));
const MyBudget = lazy(() => import('./pages/MyBudget.jsx'));
const EmployeePage = lazy(() => import('./pages/settings/EmployeePage.jsx'));
const Assets = lazy(() => import('./pages/finance/Assets.jsx'));
const Liabilities = lazy(() => import('./pages/finance/Liabilities.jsx'));
const CashFlow = lazy(() => import('./pages/finance/CashFlow.jsx'));
const AssetForm = lazy(() => import('./pages/finance/AssetForm.jsx'));
const LiabilityForm = lazy(() => import('./pages/finance/LiabilityForm.jsx'));
const Capital = lazy(() => import('./pages/finance/Capital.jsx'));
const CapitalForm = lazy(() => import('./pages/finance/CapitalForm.jsx'));
const Announcements = lazy(() => import('./pages/Announcements.jsx'));
const OwnerInfo = lazy(() => import('./pages/OwnerInfo.jsx'));
const Privacy = lazy(() => import('./pages/Privacy.jsx'));
const Help = lazy(() => import('./pages/Help.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Accounts = lazy(() => import('./pages/Accounts.jsx'));
const UserSettings = lazy(() => import('./pages/settings/UserSettings.jsx'));
const AdminSettings = lazy(() => import('./pages/settings/AdminSettings.jsx'));

function Guard({ perm, anyPerm, level, admin, children }) {
  const { can, isAdmin } = useAuth();
  if (anyPerm && !anyPerm.some(p => can(p, level || 'view'))) return <Locked module={anyPerm[0]} />;
  if (admin ? !isAdmin : perm && !can(perm, level || 'view')) return <Locked module={perm} admin={admin} />;
  return children;
}

const Page = ({ children }) => <Suspense fallback={<Loader />}>{children}</Suspense>;

// The module is hidden in navigation for employees without Salary permission,
// and this route guard independently blocks manually-entered URLs.
function WorkforceRoute({ attendance = false }) {
  const { can } = useAuth();
  const loc = useLocation();
  const selfView = new URLSearchParams(loc.search).get('view') === 'self';
  if (!selfView && !can('salary')) return <Locked module="salary" />;
  if (attendance && !can('salary')) return <Locked module="salary" />;
  return <WorkforceAnalyzer initialTab={attendance ? 'attendance' : undefined} />;
}


export default function App() {
  const { boot, user, loading } = useAuth();
  const loc = useLocation();

  if (loading) return <><Loader text="Loading ScholarshipHive ERP…" /><Footer /></>;
  if (!boot) {
    return (
      <>
        <div className="locked-page card card-pad">
          <h3>Cannot reach the server</h3>
          <p className="muted">Check your internet connection. If the problem continues, the server may be starting — wait a few seconds and refresh.</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Refresh</button>
          <p className="small" style={{ marginTop: 14 }}><a href="/help">Open Help</a></p>
        </div>
        <Footer />
      </>
    );
  }

  const publicPages = (
    <>
      <Route path="/help/:topic?" element={<Page><div className="public-page"><Help publicView /></div></Page>} />
      <Route path="/privacy" element={<Page><div className="public-page"><Privacy publicView /></div></Page>} />
    </>
  );

  if (!boot.setupDone) {
    return (
      <>
        <Routes>
          {publicPages}
          <Route path="*" element={loc.pathname === '/setup' ? <Page><Setup /></Page> : <Navigate to="/setup" replace />} />
        </Routes>
        <Footer />
      </>
    );
  }
  if (!user) {
    return (
      <>
        <Routes>
          {publicPages}
          <Route path="/register" element={<Page><Register /></Page>} />
          <Route path="/forgot-password" element={<Page><ForgotPassword /></Page>} />
          <Route path="/reset-password" element={<Page><ResetPassword /></Page>} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        <Footer />
      </>
    );
  }
  return (
    <>
      <Layout>
        <ErrorBoundary key={loc.pathname}>
          <Suspense fallback={<Loader />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/revenue/new" element={<Guard perm="revenue" level="edit"><NewSale /></Guard>} />
              <Route path="/revenue/:tab?" element={<Guard perm="revenue"><Revenue /></Guard>} />
              <Route path="/expenses/workforce" element={<WorkforceRoute />} />
              <Route path="/expenses/salaries" element={<Guard perm="expenses"><Guard perm="salary"><Expenses /></Guard></Guard>} />
              <Route path="/expenses/marketing" element={<Guard perm="marketing"><MarketingExpenses /></Guard>} />
              <Route path="/expenses/:tab?" element={<Guard perm="expenses"><Expenses /></Guard>} />
              <Route path="/petty-cash/:tab?" element={<Guard perm="petty_cash"><PettyCash /></Guard>} />
              <Route path="/attendance" element={<WorkforceRoute attendance />} />
              <Route path="/salary" element={<Guard perm="salary"><Navigate to="/expenses/workforce" replace /></Guard>} />
              <Route path="/my-salary" element={<Navigate to="/expenses/workforce?view=self" replace />} />
              <Route path="/my-budget" element={<MyBudget />} />
              <Route path="/assets/new" element={<Guard perm="assets" level="edit"><AssetForm /></Guard>} />
              <Route path="/assets/:id/edit" element={<Guard admin><AssetForm /></Guard>} />
              <Route path="/assets/:tab?" element={<Guard perm="assets"><Assets /></Guard>} />
              <Route path="/liabilities/new" element={<Guard perm="liabilities" level="edit"><LiabilityForm /></Guard>} />
              <Route path="/liabilities/:id/edit" element={<Guard perm="liabilities" level="edit"><LiabilityForm /></Guard>} />
              <Route path="/liabilities/:tab?" element={<Guard perm="liabilities"><Liabilities /></Guard>} />
              <Route path="/capital/new" element={<Guard admin><CapitalForm /></Guard>} />
              <Route path="/capital/:id/edit" element={<Guard admin><CapitalForm /></Guard>} />
              <Route path="/capital/:tab?" element={<Guard anyPerm={['assets', 'cashflow']}><Capital /></Guard>} />
              <Route path="/cash-flow/:tab?" element={<Guard perm="cashflow"><CashFlow /></Guard>} />
              <Route path="/accounts" element={<Guard anyPerm={['assets', 'liabilities', 'cashflow']}><Accounts /></Guard>} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/announcements" element={<Announcements />} />
              <Route path="/owner" element={<OwnerInfo />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/help/:topic?" element={<Help />} />
              <Route path="/settings/admin/users/:id" element={<Guard admin><EmployeePage /></Guard>} />
              <Route path="/settings/admin/:tab?" element={<Guard admin><AdminSettings /></Guard>} />
              <Route path="/settings/:tab?" element={<UserSettings />} />
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="/register" element={<Navigate to="/" replace />} />
              <Route path="/setup" element={<Navigate to="/" replace />} />
              <Route path="/forgot-password" element={<Navigate to="/settings/security" replace />} />
              <Route path="/reset-password" element={<Navigate to="/settings/security" replace />} />
              <Route path="*" element={<div className="empty-state"><h3>Page not found</h3><a href="/">Go to dashboard</a></div>} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
      <Footer />
    </>
  );
}
