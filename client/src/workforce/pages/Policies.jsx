import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Card, ErrorBox, Field, Header, Loading, Table, useAction, useUi, Badge } from '../components/ui.jsx';
import { dateTime, fullDate, money, todayDate } from '../format.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function PolicyForm() {
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [run, busy] = useAction();
  const cur = useQuery({ queryKey: ['policy-current'], queryFn: () => api.get('/api/policies/current') });
  const hist = useQuery({ queryKey: ['policy-history'], queryFn: () => api.get('/api/policies') });
  const [f, setF] = useState(null);
  useEffect(() => {
    if (cur.data) setF({ ...cur.data, effectiveFrom: `${todayDate().slice(0, 7)}-01`, reason: '', payrollCutoffDay: cur.data.payrollCutoffDay || '', fixedWorkingDays: cur.data.fixedWorkingDays || 26 });
  }, [cur.data]);
  if (cur.isLoading || !f) return <Loading />;
  const set = (k, cast) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : cast ? cast(e.target.value) : e.target.value });
  const setTier = (i, k, v) => setF({ ...f, lateTiers: f.lateTiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });
  const submit = async (e) => {
    e.preventDefault();
    const turningOn = f.lateDeductionEnabled && !cur.data.lateDeductionEnabled;
    const ok = await confirm({
      title: 'Save new policy version?',
      message: `Applies to Draft payroll from ${fullDate(f.effectiveFrom)}. Approved and paid payroll keep the policy stored in their snapshot.${turningOn ? '\n\n⚠ You are ENABLING late-arrival deductions. Confirm HR/management have approved these rules and they comply with employment law.' : ''}`,
      confirmText: 'Save policy',
    });
    if (!ok) return;
    const body = { ...f, fixedWorkingDays: Number(f.fixedWorkingDays), graceMinutes: Number(f.graceMinutes), severeLateMinutes: Number(f.severeLateMinutes), earlyGraceMinutes: Number(f.earlyGraceMinutes), payrollCutoffDay: f.payrollCutoffDay ? Number(f.payrollCutoffDay) : null };
    if (await run(() => api.post('/api/policies', body), 'Policy saved. Draft salaries recalculated.')) qc.invalidateQueries();
  };
  const daily = 60000 / (f.workingDaysBasis === 'fixed' ? Number(f.fixedWorkingDays || 26) : 26);
  const basis = f.lateBasis === 'monthly' ? 60000 : daily;
  const exampleLate = (mins) => {
    if (mins <= Number(f.graceMinutes)) return 0;
    if (f.lateRuleType === 'tiered') { let p = 0; for (const t of [...f.lateTiers].sort((a, b) => a.minMinutes - b.minMinutes)) if (mins >= Number(t.minMinutes)) p = Number(t.percent); return basis * p / 100; }
    const h = f.lateRounding === 'started_hour' ? Math.ceil(mins / 60) : mins / 60;
    return h * basis * Number(f.lateRatePercent) / 100;
  };
  return (
    <>
      {!cur.data.lateDeductionEnabled && <div className="notice warning">Late-arrival deductions are currently <b>disabled</b>. The example rules below are illustrative and are not applied until an authorised administrator enables them.</div>}
      <Card title="Payroll configuration" sub="Saving creates a new versioned policy with your reason. Approved/Paid salary snapshots remain frozen.">
        <form onSubmit={submit}>
          <div className="formgrid">
            <Field label="Effective from"><input type="date" value={f.effectiveFrom} onChange={set('effectiveFrom')} required /></Field>
            <Field label="Business timezone"><input value={f.timezone} onChange={set('timezone')} /></Field>
            <Field label="Working-days basis (daily rate divisor)"><select value={f.workingDaysBasis} onChange={set('workingDaysBasis')}><option value="schedule">Scheduled working days (from schedule & holidays)</option><option value="fixed">Fixed number of days</option><option value="calendar">Calendar days in month</option></select></Field>
            {f.workingDaysBasis === 'fixed' && <Field label="Fixed working days"><input type="number" min="1" max="31" value={f.fixedWorkingDays} onChange={set('fixedWorkingDays')} required /></Field>}
            <Field label="Grace period (minutes)"><input type="number" min="0" max="240" value={f.graceMinutes} onChange={set('graceMinutes')} required /></Field>
            <Field label="Severe late threshold (minutes)"><input type="number" min="1" max="1440" value={f.severeLateMinutes} onChange={set('severeLateMinutes')} required /></Field>
            <Field label="Paid approved leave / month (days)"><input type="number" min="0" max="31" step="0.5" value={f.paidLeaveDaysPerMonth} onChange={set('paidLeaveDaysPerMonth')} required /></Field>
            <Field label="Payroll cutoff day (blank = calendar month)"><input type="number" min="1" max="28" value={f.payrollCutoffDay} onChange={set('payrollCutoffDay')} /></Field>
            <Field label="Max manual commission (%)"><input type="number" min="0" max="100" step="0.001" value={f.maxManualCommissionPercent} onChange={set('maxManualCommissionPercent')} required /></Field>
          </div>
          <div className="divider" />
          <div className="controls">
            <label className="inline-check"><input type="checkbox" checked={f.lateDeductionEnabled} onChange={set('lateDeductionEnabled')} /> Enable late-arrival deductions</label>
            <label className="inline-check"><input type="checkbox" checked={f.absenceDeductionEnabled} onChange={set('absenceDeductionEnabled')} /> Deduct absences (daily rate)</label>
            <label className="inline-check"><input type="checkbox" checked={f.earlyDeductionEnabled} onChange={set('earlyDeductionEnabled')} /> Deduct early departures</label>
            <label className="inline-check"><input type="checkbox" checked={f.severeLateRequiresReview} onChange={set('severeLateRequiresReview')} /> Severe late requires manager review (blocks approval)</label>
            <label className="inline-check"><input type="checkbox" checked={f.blockApprovalUntilPeriodEnd} onChange={set('blockApprovalUntilPeriodEnd')} /> Block approval until period ends</label>
            <label className="inline-check"><input type="checkbox" checked={f.revenueRequireSecondVerifier} onChange={set('revenueRequireSecondVerifier')} /> Sales must be verified by a different user</label>
          </div>
          <div className="formgrid" style={{ marginTop: 10 }}>
            <Field label="Late rule"><select value={f.lateRuleType} onChange={set('lateRuleType')}><option value="tiered">Tiered (e.g. 1h → 5%, 2h → 10%)</option><option value="per_hour">Percentage per late hour</option></select></Field>
            <Field label="Fine calculation basis"><select value={f.lateBasis} onChange={set('lateBasis')}><option value="daily">Daily salary</option><option value="monthly">Monthly salary</option></select></Field>
            {f.lateRuleType === 'per_hour' && <>
              <Field label="Late rate (% per hour)"><input type="number" min="0" max="100" step="0.001" value={f.lateRatePercent} onChange={set('lateRatePercent')} required /></Field>
              <Field label="Late rounding"><select value={f.lateRounding} onChange={set('lateRounding')}><option value="started_hour">Started hour</option><option value="exact">Proportional minutes</option></select></Field>
            </>}
            <Field label="Maximum late+early fine (% of base)"><input type="number" min="0" max="100" step="0.001" value={f.lateCapPercent} onChange={set('lateCapPercent')} required /></Field>
            <Field label="Early departure rate (% per started hour)"><input type="number" min="0" max="100" step="0.001" value={f.earlyRatePercent} onChange={set('earlyRatePercent')} /></Field>
            <Field label="Early departure grace (minutes)"><input type="number" min="0" max="240" value={f.earlyGraceMinutes} onChange={set('earlyGraceMinutes')} /></Field>
          </div>
          {f.lateRuleType === 'tiered' && (
            <div style={{ marginTop: 10 }}>
              <span className="tiny">Late tiers (the highest tier reached applies, once per late day, after the grace period)</span>
              {f.lateTiers.map((t, i) => (
                <div className="controls" key={i} style={{ margin: '6px 0' }}>
                  <Field label="From (minutes late)"><input type="number" min="1" max="1440" value={t.minMinutes} onChange={(e) => setTier(i, 'minMinutes', Number(e.target.value))} /></Field>
                  <Field label="Deduction (% of basis)"><input type="number" min="0" max="100" step="0.001" value={t.percent} onChange={(e) => setTier(i, 'percent', e.target.value)} /></Field>
                  <button type="button" className="btn flat sm" onClick={() => setF({ ...f, lateTiers: f.lateTiers.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn outline sm" onClick={() => setF({ ...f, lateTiers: [...f.lateTiers, { minMinutes: 180, percent: '15' }] })}>+ Add tier</button>
            </div>
          )}
          <Field label="Reason for policy change (required)" full><input value={f.reason} onChange={set('reason')} minLength={5} required placeholder="e.g. Approved by HR on 2026-10-20" /></Field>
          <div style={{ marginTop: 15 }}><button type="submit" className="btn" disabled={busy}>Save policy rules</button></div>
        </form>
      </Card>
      <div className="grid22">
        <Card title="How late fines would work" sub={`Example on PKR 60,000 base salary · ${f.lateDeductionEnabled ? 'ENABLED' : 'currently disabled'}`}>
          <div className="detailrow"><span>Daily salary ({f.workingDaysBasis === 'fixed' ? `${f.fixedWorkingDays} days` : '26 scheduled days'})</span><b>{money(daily)}</b></div>
          {[30, 75, 130].map((m) => <div className="detailrow" key={m}><span>Arrives {m} minutes late</span><b>{money(exampleLate(m))}</b></div>)}
          <p className="tiny">Monthly total is capped at {f.lateCapPercent}% of base. The server applies the policy; this is only a preview.</p>
        </Card>
        <Card title="Leave & absence logic" sub="Each day has exactly one status, so nothing is deducted twice">
          <div className="detailrow"><span>Approved paid leave</span><b>First {f.paidLeaveDaysPerMonth} day(s)/month</b></div>
          <div className="detailrow"><span>Paid leave beyond allowance</span><b>Daily rate deduction</b></div>
          <div className="detailrow"><span>Approved unpaid leave</span><b>Daily rate deduction</b></div>
          <div className="detailrow"><span>Rejected leave, not attended</span><b>Counts as one absence</b></div>
          <div className="detailrow"><span>Holiday / weekly off</span><b>Never an absence</b></div>
          <p className="tiny">Pending leave and missing punches block payroll approval until resolved.</p>
        </Card>
      </div>
      <Card title="Policy history">
        <Table heads={['Effective', 'Late deductions', 'Grace', 'Basis', 'Paid leave', 'Reason', 'By', 'Created']}>
          {(hist.data || []).map((p) => <tr key={p.id}><td>{fullDate(p.effectiveFrom)}</td><td><Badge text={p.lateDeductionEnabled ? 'Active' : 'Disabled'} /></td><td>{p.graceMinutes}m</td><td>{p.workingDaysBasis}</td><td>{p.paidLeaveDaysPerMonth}</td><td className="wrap">{p.reason}</td><td>{p.createdBy || 'System'}</td><td>{dateTime(p.createdAt)}</td></tr>)}
        </Table>
      </Card>
      <div className="notice warning">For real payroll, management and HR should check wage-deduction rules, leave entitlements and employment law before enabling penalties.</div>
    </>
  );
}

function CalendarAndShifts() {
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const year = todayDate().slice(0, 4);
  const holidays = useQuery({ queryKey: ['holidays', year], queryFn: () => api.get(`/api/holidays?year=${year}`) });
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: () => api.get('/api/shifts') });
  const sched = useQuery({ queryKey: ['schedule-default'], queryFn: () => api.get('/api/schedules') });
  const [h, setH] = useState({ date: '', name: '', isPaid: true });
  const [s, setS] = useState({ name: '', startTime: '09:00', endTime: '18:00', breakMinutes: 60 });
  const latest = (sched.data || []).length ? sched.data.filter((r) => r.effective_from === sched.data[0].effective_from) : [];
  const [days, setDays] = useState(null);
  useEffect(() => { if (latest.length && days === null) setDays(latest.filter((r) => r.is_working_day).map((r) => r.weekday)); }, [latest, days]);
  const addHoliday = async (e) => { e.preventDefault(); if (await run(() => api.post('/api/holidays', h), 'Holiday saved; it is no longer counted as an absence.')) { setH({ date: '', name: '', isPaid: true }); qc.invalidateQueries(); } };
  const delHoliday = async (x) => { if (await run(() => api.del(`/api/holidays/${x.id}`), 'Holiday removed.')) qc.invalidateQueries(); };
  const addShift = async (e) => { e.preventDefault(); if (await run(() => api.post('/api/shifts', s), 'Shift saved.')) { setS({ name: '', startTime: '09:00', endTime: '18:00', breakMinutes: 60 }); qc.invalidateQueries(); } };
  const saveDays = async () => { if (await run(() => api.put('/api/schedules', { workingDays: days }), 'Company weekly schedule saved; Draft payroll recalculated.')) qc.invalidateQueries(); };
  return (
    <div className="grid22">
      <Card title={`Official holidays ${year}`} sub="Holidays are excluded from scheduled working days and never counted as absence.">
        <form className="controls" onSubmit={addHoliday}>
          <Field label="Date"><input type="date" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} required /></Field>
          <Field label="Name" grow><input value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} required placeholder="e.g. Iqbal Day" /></Field>
          <label className="inline-check"><input type="checkbox" checked={h.isPaid} onChange={(e) => setH({ ...h, isPaid: e.target.checked })} /> Paid</label>
          <button className="btn" disabled={busy}>Add</button>
        </form>
        <Table heads={['Date', 'Holiday', 'Paid', '']} empty="No holidays configured">
          {(holidays.data || []).map((x) => <tr key={x.id}><td>{fullDate(x.holiday_date)}</td><td>{x.name}</td><td>{x.is_paid ? 'Yes' : 'No'}</td><td><button className="btn flat sm" onClick={() => delHoliday(x)}>Remove</button></td></tr>)}
        </Table>
      </Card>
      <div>
        <Card title="Company weekly schedule" sub="Working days used to compute scheduled days (employees can have overrides via API).">
          <div className="controls">{WEEKDAYS.map((d, i) => <label key={d} className="inline-check"><input type="checkbox" checked={(days || []).includes(i)} onChange={(e) => setDays(e.target.checked ? [...(days || []), i] : (days || []).filter((x) => x !== i))} /> {d}</label>)}</div>
          <button className="btn sm" onClick={saveDays} disabled={busy || !days}>Save weekly schedule</button>
        </Card>
        <Card title="Shifts" sub="Overnight shifts (end before start) are supported; check-ins after midnight count for the shift date.">
          <form className="controls" onSubmit={addShift}>
            <Field label="Name"><input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} required /></Field>
            <Field label="Start"><input type="time" value={s.startTime} onChange={(e) => setS({ ...s, startTime: e.target.value })} required /></Field>
            <Field label="End"><input type="time" value={s.endTime} onChange={(e) => setS({ ...s, endTime: e.target.value })} required /></Field>
            <button className="btn" disabled={busy}>Add shift</button>
          </form>
          <Table heads={['Shift', 'Start', 'End', 'Break']}>{(shifts.data || []).map((x) => <tr key={x.id}><td>{x.name}</td><td>{String(x.start_time).slice(0, 5)}</td><td>{String(x.end_time).slice(0, 5)}{x.end_time < x.start_time && <span className="tag blue" style={{ marginLeft: 6 }}>overnight</span>}</td><td>{x.break_minutes}m</td></tr>)}</Table>
        </Card>
      </div>
    </div>
  );
}

function Security() {
  const qc = useQueryClient();
  const { confirm } = useUi();
  const [run, busy] = useAction();
  const nets = useQuery({ queryKey: ['networks'], queryFn: () => api.get('/api/admin/networks') });
  const cur = useQuery({ queryKey: ['current-ip'], queryFn: () => api.get('/api/admin/networks/current-ip') });
  const users = useQuery({ queryKey: ['att-users'], queryFn: () => api.get('/api/admin/users') });
  const [n, setN] = useState({ name: 'Office WiFi', publicIp: '' });
  const add = async (e) => { e.preventDefault(); if (await run(() => api.post('/api/admin/networks', n), (r) => r.message)) { setN({ name: 'Office WiFi', publicIp: '' }); qc.invalidateQueries(); } };
  const del = async (x) => { if ((await confirm({ title: 'Remove network?', danger: true, message: `${x.name}: ${x.rule}. Employees on this network will no longer be able to check in/out.` })) && await run(() => api.del(`/api/admin/networks/${x.id}`), 'Network removed.')) qc.invalidateQueries(); };
  const reset = async (u) => { if ((await confirm({ title: 'Reset device binding?', message: `${u.username} will be able to register a new phone at next login.` })) && await run(() => api.post(`/api/admin/devices/${u.deviceBindingId}/reset`), 'Device reset.')) qc.invalidateQueries(); };
  return (
    <>
      <Card title="Approved office Wi-Fi / networks" sub="Login and checkout from the Attendance app are only allowed from these networks (same rules as before: IPv4 exact, IPv6 /64).">
        {(nets.data || []).length === 0 && <div className="notice warning">No network is configured: check-in works in setup mode but <b>checkout is blocked</b>. Add your office network (use “My current IP” while connected to office Wi-Fi).</div>}
        <form className="controls" onSubmit={add}>
          <Field label="Name"><input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} required /></Field>
          <Field label="Public IP / range" grow hint={cur.data ? `Server sees you as ${cur.data.publicIp} → ${cur.data.suggestedRule}` : ''}><input value={n.publicIp} onChange={(e) => setN({ ...n, publicIp: e.target.value })} placeholder="Leave empty to use your current IP" /></Field>
          <button className="btn outline" type="button" onClick={() => setN({ ...n, publicIp: cur.data?.suggestedRule || '' })}>Use my current IP</button>
          <button className="btn" disabled={busy}>Add network</button>
        </form>
        <Table heads={['Name', 'Rule', 'Added', '']} empty="No approved networks">{(nets.data || []).map((x) => <tr key={x.id}><td>{x.name}</td><td className="mono">{x.rule}</td><td>{dateTime(x.createdAt)}</td><td><button className="btn flat sm" onClick={() => del(x)}>Remove</button></td></tr>)}</Table>
      </Card>
      <Card title="Attendance logins & device binding" sub="One phone per employee. Reset when an employee changes phone.">
        <Table heads={['Username', 'Name', 'Role', 'Employee', 'Device', 'Bound from IP', '']}>
          {(users.data || []).map((u) => <tr key={u.id}><td className="mono">{u.username}</td><td>{u.fullName}</td><td>{u.role}</td><td>{u.employeeCode || <span className="tag gray">unmapped</span>}</td><td className="mono tiny">{u.deviceId ? `${u.deviceId.slice(0, 14)}…` : '—'}</td><td className="tiny">{u.ipAddress || '—'}</td><td>{u.deviceBindingId && <button className="btn flat sm" onClick={() => reset(u)}>Reset device</button>}</td></tr>)}
        </Table>
        <p className="tiny">The original Attendance Administration web page is also available at <a href="/attendance-admin" target="_blank" rel="noreferrer">/attendance-admin</a>, now using this server.</p>
      </Card>
    </>
  );
}

function UsersRoles() {
  const qc = useQueryClient();
  const [run] = useAction();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get('/api/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/api/roles') });
  const allRoles = roles.data?.roles || [];
  const toggle = async (u, code) => {
    const next = u.roles.includes(code) ? u.roles.filter((r) => r !== code) : [...u.roles, code];
    if (await run(() => api.put(`/api/users/${u.id}/roles`, { roles: next }), 'Roles updated.')) qc.invalidateQueries();
  };
  return (
    <>
      <Card title="User roles" sub="Admin · HR / Attendance Manager · Revenue Manager · Employee. Changes are audited.">
        {users.isLoading ? <Loading /> : (
          <Table heads={['Username', 'Name', 'Employee', 'Last sign-in', ...allRoles.map((r) => r.name)]}>
            {(users.data || []).filter((u) => u.is_active).map((u) => (
              <tr key={u.id}><td className="mono">{u.username}</td><td>{u.full_name}</td><td>{u.employee_code || '—'}</td><td className="tiny">{u.last_login_at ? dateTime(u.last_login_at) : 'never'}</td>
                {allRoles.map((r) => <td key={r.code}><input type="checkbox" style={{ width: 16 }} checked={u.roles.includes(r.code)} disabled={u.is_protected && r.code === 'ADMIN'} onChange={() => toggle(u, r.code)} aria-label={`${r.name} for ${u.username}`} /></td>)}</tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Role permissions" sub="What each role can do (Admin always has all permissions).">
        <Table heads={['Role', 'Permissions']}>{allRoles.map((r) => <tr key={r.code}><td><b>{r.name}</b><div className="tiny">{r.description}</div></td><td className="wrap tiny">{r.permissions.join(', ')}</td></tr>)}</Table>
      </Card>
    </>
  );
}

function Migration() {
  const qc = useQueryClient();
  const [run, busy] = useAction();
  const [text, setText] = useState('');
  const [backedUp, setBackedUp] = useState(false);
  const [includeAttendance, setIncludeAttendance] = useState(false);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState('');
  const parse = () => { try { setErr(''); return JSON.parse(text); } catch { setErr('The pasted text is not valid JSON.'); return null; } };
  const backup = () => {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `salary_analyzer_localstorage_backup_${todayDate()}.json`; a.click();
    setBackedUp(true);
  };
  const go = async (dryRun) => {
    const data = parse(); if (!data) return;
    const r = await run(() => api.post('/api/import/localstorage', { data, dryRun, includeDemoAttendance: includeAttendance, backupConfirmed: backedUp }), dryRun ? 'Dry run complete — nothing was saved.' : 'Import complete.');
    if (r) { setReport(r.report); if (!dryRun) qc.invalidateQueries(); }
  };
  return (
    <Card title="One-time import from the old Salary Analyzer (LocalStorage)" sub="Optional. Validated, duplicate-safe, never overwrites live data. The same export cannot be imported twice.">
      <ol className="tiny" style={{ lineHeight: 1.8 }}>
        <li>Open the old Salary Analyzer HTML in the same browser you used before.</li>
        <li>Press F12 → Console, run: <span className="mono">copy(localStorage.getItem('workforce_pay_executive_ten_staff_v3'))</span></li>
        <li>Paste below, click <b>Download backup</b>, then <b>Dry run</b> to preview, then <b>Import</b>.</li>
      </ol>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setBackedUp(false); setReport(null); }} placeholder='{"month":"2026-09","employees":[...]}' style={{ minHeight: 140 }} className="mono" />
      {err && <div className="formerror">{err}</div>}
      <div className="controls" style={{ marginTop: 10 }}>
        <button className="btn outline" disabled={!text} onClick={backup}>Download backup</button>
        <label className="inline-check"><input type="checkbox" checked={includeAttendance} onChange={(e) => setIncludeAttendance(e.target.checked)} /> Also import demo attendance (DEMO employees only, as attested corrections)</label>
        <button className="btn soft" disabled={!text || busy} onClick={() => go(true)}>Dry run</button>
        <button className="btn" disabled={!text || !backedUp || busy} onClick={() => go(false)}>Import</button>
      </div>
      {report && <pre className="mono" style={{ background: '#f7f9fc', padding: 12, borderRadius: 10, overflow: 'auto', maxHeight: 300 }}>{JSON.stringify(report, null, 2)}</pre>}
    </Card>
  );
}

export default function Policies() {
  const { can } = useApp();
  const tabs = [
    can('policy.manage') && ['policy', 'Payroll policy'], can('policy.manage') && ['calendar', 'Holidays, schedule & shifts'],
    can('attendance.security') && ['security', 'Attendance security'], can('users.manage') && ['users', 'Users & roles'], can('users.manage') && ['migration', 'Data migration'],
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0]?.[0]);
  return (
    <>
      <Header overline="Administration / policy" title="Attendance & pay policy" subtitle="Configurable rules. Saved changes affect Draft salaries only; approved snapshots stay frozen." />
      <div className="pill-tabs">{tabs.map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}</div>
      <ErrorBox error={null} />
      {tab === 'policy' && <PolicyForm />}
      {tab === 'calendar' && <CalendarAndShifts />}
      {tab === 'security' && <Security />}
      {tab === 'users' && <UsersRoles />}
      {tab === 'migration' && <Migration />}
    </>
  );
}
