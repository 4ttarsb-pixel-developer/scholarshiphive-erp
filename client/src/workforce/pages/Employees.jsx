import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Card, ErrorBox, Field, Header, Kpi, Kpis, Loading, Modal, MoneySpan, Person, Table, useAction, useUi } from '../components/ui.jsx';
import { fullDate, pct, todayDate } from '../format.js';

function EmployeeForm({ employee, onClose }) {
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const editing = !!employee;
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: () => api.get('/api/shifts') });
  const deps = useQuery({ queryKey: ['departments'], queryFn: () => api.get('/api/departments') });
  const [f, setF] = useState(employee ? {
    fullName: employee.fullName, department: employee.department, designation: employee.designation, joiningDate: employee.joiningDate,
    baseSalary: employee.baseSalary, shiftId: employee.shiftId || '', employmentStatus: employee.employmentStatus, leavingDate: employee.leavingDate || '', notes: employee.notes || '',
  } : { employeeCode: '', fullName: '', department: '', designation: '', joiningDate: todayDate(), baseSalary: '', shiftId: '', fixedCommissionPercent: '', username: '', password: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { ...f, shiftId: f.shiftId ? Number(f.shiftId) : null };
    if (editing && body.employmentStatus === 'Active') body.leavingDate = null;
    if (!editing && !body.username) { delete body.username; delete body.password; }
    const r = await run(() => (editing ? api.patch(`/api/employees/${employee.id}`, body) : api.post('/api/employees', body)), editing ? 'Employee updated; Draft payroll recalculated.' : 'Employee created.');
    if (r) { qc.invalidateQueries(); onClose(); }
  };
  return (
    <Modal title={editing ? `Edit ${employee.fullName} (${employee.employeeCode})` : 'Add employee'} onClose={onClose} width={820}>
      <form onSubmit={submit}>
        <div className="formgrid">
          {!editing && <Field label="Employee code (unique, permanent)"><input value={f.employeeCode} onChange={set('employeeCode')} required pattern="[A-Za-z0-9_-]{2,30}" placeholder="EMP011" /></Field>}
          <Field label="Full name"><input value={f.fullName} onChange={set('fullName')} required minLength={2} /></Field>
          <Field label="Department"><input list="deps" value={f.department} onChange={set('department')} placeholder="Sales" /><datalist id="deps">{(deps.data || []).map((d) => <option key={d.id} value={d.name} />)}</datalist></Field>
          <Field label="Job designation"><input value={f.designation} onChange={set('designation')} /></Field>
          <Field label="Joining date"><input type="date" value={f.joiningDate} onChange={set('joiningDate')} required /></Field>
          <Field label="Base monthly salary (PKR)"><input type="number" min="0" step="0.01" value={f.baseSalary} onChange={set('baseSalary')} required /></Field>
          <Field label="Assigned shift"><select value={f.shiftId} onChange={set('shiftId')}><option value="">Company default schedule</option>{(shifts.data || []).map((s) => <option key={s.id} value={s.id}>{s.name} ({String(s.start_time).slice(0, 5)}–{String(s.end_time).slice(0, 5)})</option>)}</select></Field>
          {!editing && <Field label="Fixed commission (%)" hint="Optional — can be set later in Commissions"><input type="number" min="0" max="100" step="0.001" value={f.fixedCommissionPercent} onChange={set('fixedCommissionPercent')} /></Field>}
          {editing && <Field label="Employment status"><select value={f.employmentStatus} onChange={set('employmentStatus')}><option>Active</option><option>Inactive</option><option>Terminated</option></select></Field>}
          {editing && f.employmentStatus !== 'Active' && <Field label="Leaving date"><input type="date" value={f.leavingDate} onChange={set('leavingDate')} required /></Field>}
          {!editing && <>
            <Field label="Login username (optional)" hint="Creates an Attendance-app / self-service login"><input value={f.username} onChange={set('username')} pattern="[A-Za-z0-9._-]{3,60}" /></Field>
            <Field label="Initial password" hint="Min 8 characters; user must change it"><input type="password" value={f.password} onChange={set('password')} minLength={8} required={!!f.username} /></Field>
          </>}
          <Field label="Notes" full><input value={f.notes} onChange={set('notes')} /></Field>
        </div>
        {editing && f.employmentStatus !== 'Active' && <div className="notice warning" style={{ marginTop: 12 }}>Deactivating disables the employee's login and stops future payroll after the leaving date. History is preserved.</div>}
        <div className="modalfoot"><button className="btn" type="submit" disabled={busy}>{editing ? 'Save employee' : 'Create employee'}</button></div>
      </form>
    </Modal>
  );
}

function LinkLoginModal({ login, onClose }) {
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const employees = useQuery({ queryKey: ['employees', 'all'], queryFn: () => api.get('/api/employees?includeInactive=true') });
  const unlinked = (employees.data || []).filter((e) => !e.userId);
  const [employeeId, setEmployeeId] = useState('');
  const [confirmUsername, setConfirm] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => api.post(`/api/employees/${employeeId}/link-user`, { userId: login.id, confirmUsername }), (res) => `Linked. ${res.linkedSessions} attendance session(s) now count towards payroll.`);
    if (r) { qc.invalidateQueries(); onClose(); }
  };
  return (
    <Modal title={`Map attendance login “${login.username}”`} onClose={onClose}>
      <div className="notice">Names are never matched automatically. Choose the employee record and retype the username to verify this mapping. Past check-ins in unlocked months will be attributed to the employee.</div>
      <form onSubmit={submit}>
        <div className="formgrid">
          <Field label="Employee (without a login)"><select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required><option value="">Select…</option>{unlinked.map((e) => <option key={e.id} value={e.id}>{e.fullName} — {e.employeeCode}</option>)}</select></Field>
          <Field label="Retype username to confirm"><input value={confirmUsername} onChange={(e) => setConfirm(e.target.value)} required placeholder={login.username} /></Field>
        </div>
        <div className="modalfoot"><button className="btn" type="submit" disabled={busy || confirmUsername.toLowerCase() !== login.username.toLowerCase()}>Verify & link</button></div>
      </form>
    </Modal>
  );
}

function CreateLoginModal({ employee, onClose }) {
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const [f, setF] = useState({ username: '', password: '' });
  const submit = async (e) => {
    e.preventDefault();
    if (await run(() => api.post(`/api/employees/${employee.id}/create-login`, f), 'Login created. The employee must change the password at first sign-in.')) { qc.invalidateQueries(); onClose(); }
  };
  return (
    <Modal title={`Create login for ${employee.fullName}`} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="formgrid">
          <Field label="Username"><input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required pattern="[A-Za-z0-9._-]{3,60}" /></Field>
          <Field label="Initial password"><input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} /></Field>
        </div>
        <div className="modalfoot"><button className="btn" disabled={busy} type="submit">Create login</button></div>
      </form>
    </Modal>
  );
}

export default function Employees() {
  const { can, openEmployee } = useApp();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Active');
  const [modal, setModal] = useState(null);
  const q = useQuery({ queryKey: ['employees', 'list', status, search], queryFn: () => api.get(`/api/employees${qs({ search, status, includeInactive: status === '' ? 'true' : undefined })}`) });
  const unmapped = useQuery({ queryKey: ['unmapped-logins'], queryFn: () => api.get('/api/employees/unmapped-logins'), enabled: can('employees.manage') });
  const rows = q.data || [];
  const unmappedRows = (unmapped.data || []).filter((u) => u.is_active);
  return (
    <>
      <Header overline="Payroll workspace / employees" title="Employees" subtitle="One identity per employee, shared by attendance, revenue and payroll (matched by employee ID, never by name).">
        {can('employees.manage') && <button className="btn sm" onClick={() => setModal({ type: 'new' })}>+ Add employee</button>}
      </Header>
      <ErrorBox error={q.error} />
      <Kpis>
        <Kpi label="Employees shown" value={rows.length} foot={status ? `${status} employees` : 'All statuses'} />
        <Kpi label="With attendance login" value={rows.filter((e) => e.userId).length} foot="Can use the Attendance app" />
        <Kpi label="Without salary" value={rows.filter((e) => Number(e.baseSalary) <= 0).length} foot="Blocked from payroll approval" />
        <Kpi label="Unmapped logins" value={unmappedRows.length} foot="Attendance users not linked to an employee" />
      </Kpis>
      {can('employees.manage') && unmappedRows.length > 0 && (
        <Card title="Unmapped attendance logins" sub="These accounts can check in, but their attendance does not reach payroll until mapped to an employee record.">
          <Table heads={['Username', 'Name', 'Attendance role', 'Team', 'Sessions', 'Source', 'Action']}>
            {unmappedRows.map((u) => <tr key={u.id}><td className="mono">{u.username}</td><td>{u.full_name}</td><td>{u.attendance_role}</td><td>{u.team}</td><td>{u.session_count}</td><td className="tiny">{u.legacy_source || 'app'}</td>
              <td><button className="btn soft sm" onClick={() => setModal({ type: 'link', login: u })}>Map to employee</button></td></tr>)}
          </Table>
        </Card>
      )}
      <Card title="Employee directory">
        <div className="controls">
          <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="Active">Active</option><option value="Inactive">Inactive</option><option value="Terminated">Terminated</option><option value="">All</option></select></Field>
          <Field label="Search" grow><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, code, username or department" /></Field>
        </div>
        {q.isLoading ? <Loading /> : (
          <Table heads={['Employee', 'Username', 'Designation', 'Joined', 'Base salary', 'Shift', 'Fixed comm.', 'Status', 'This month', 'Action']}>
            {rows.map((e) => (
              <tr key={e.id}>
                <td><Person name={e.fullName} sub={e.department} code={e.employeeCode} demo={e.isDemo} /></td>
                <td className="mono">{e.username || <span className="tiny">no login</span>}</td>
                <td>{e.designation || '—'}</td><td>{fullDate(e.joiningDate)}</td>
                <td><MoneySpan n={e.baseSalary} cls={Number(e.baseSalary) <= 0 ? 'redtext' : ''} /></td>
                <td className="tiny">{e.shiftName ? `${e.shiftName} ${e.shiftTiming}` : 'Default'}</td>
                <td>{pct(e.fixedCommissionPercent)}</td>
                <td><Badge text={e.employmentStatus} /></td>
                <td><Badge text={e.paymentStatus} /></td>
                <td className="nowrap">
                  {can('payroll.view') && <button className="btn soft sm" onClick={() => openEmployee(e.id)}>Profile →</button>}{' '}
                  {can('employees.manage') && <button className="btn flat sm" onClick={() => setModal({ type: 'edit', employee: e })}>Edit</button>}
                  {can('employees.manage') && !e.userId && <button className="btn flat sm" onClick={() => setModal({ type: 'login', employee: e })}>Create login</button>}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {modal?.type === 'new' && <EmployeeForm onClose={() => setModal(null)} />}
      {modal?.type === 'edit' && <EmployeeForm employee={modal.employee} onClose={() => setModal(null)} />}
      {modal?.type === 'link' && <LinkLoginModal login={modal.login} onClose={() => setModal(null)} />}
      {modal?.type === 'login' && <CreateLoginModal employee={modal.employee} onClose={() => setModal(null)} />}
    </>
  );
}
