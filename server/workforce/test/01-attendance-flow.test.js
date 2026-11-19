'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.describe('Flutter attendance flow (Worker-compatible API) → PostgreSQL → payroll', () => {
  let emp;
  const username = `flutter_${Date.now().toString(36)}`;

  test.before(async () => {
    await h.setPolicy({ workingDaysBasis: 'schedule', lateDeductionEnabled: false, severeLateRequiresReview: false });
    emp = await h.createEmployee({ name: 'Usman Flutter', base: '60000', rate: '3', username, password: 'Emp#12345' });
  });

  test('1. employee check-in and check-out through the Flutter endpoints', async () => {
    const net = await h.request(h.app).get('/api/attendance/check-network');
    assert.equal(net.status, 200);
    assert.equal(net.body.allowed, true, 'setup mode allows check-in before a network is configured');

    const loginRes = await h.request(h.app).post('/api/attendance/login').send({ username, password: 'Emp#12345', deviceId: 'device-test-1' });
    assert.equal(loginRes.status, 200, JSON.stringify(loginRes.body));
    assert.equal(loginRes.body.success, true);
    assert.equal(loginRes.body.isManagement, false);
    assert.equal(loginRes.body.alreadyCheckedIn, false);
    assert.match(loginRes.body.sessionId, /^[0-9a-f-]{36}$/);
    const sessionId = loginRes.body.sessionId;

    // second login on the same day re-uses the open session (no duplicate paid day)
    const again = await h.request(h.app).post('/api/attendance/login').send({ username, password: 'Emp#12345', deviceId: 'device-test-1' });
    assert.equal(again.body.alreadyCheckedIn, true);
    assert.equal(again.body.sessionId, sessionId);
    const open = await h.knex('attendance_sessions').where({ session_id: sessionId }).first();
    assert.equal(open.employee_id, emp.id);
    assert.equal(open.is_active, true);

    // device binding is enforced
    const other = await h.request(h.app).post('/api/attendance/login').send({ username, password: 'Emp#12345', deviceId: 'another-phone' });
    assert.equal(other.status, 403);

    // checkout is blocked until an office network exists (Wi-Fi rule preserved)
    let v = await h.request(h.app).post('/api/attendance/verify-checkout').send({ sessionId });
    assert.equal(v.body.eligible, false);
    let sub = await h.request(h.app).post('/api/attendance/submit-report').send({ sessionId, reportContent: 'Done' });
    assert.equal(sub.status, 403);

    await h.addLocalNetworks();
    v = await h.request(h.app).post('/api/attendance/verify-checkout').send({ sessionId });
    assert.equal(v.body.eligible, true, JSON.stringify(v.body));

    // network away interval is recorded and excluded from actual office time
    const now = new Date();
    const iv = await h.request(h.app).post('/api/attendance/network-interval').send({ sessionId, deviceId: 'device-test-1', disconnectedAt: new Date(now - 1000).toISOString(), reconnectedAt: now.toISOString() });
    assert.equal(iv.status, 200);

    sub = await h.request(h.app).post('/api/attendance/submit-report').send({ sessionId, reportContent: 'Daily report' });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal(sub.body.success, true);
    assert.ok('actualOfficeTimeText' in sub.body && 'networkAwayText' in sub.body && 'totalSpanText' in sub.body);

    const st = await h.request(h.app).get(`/api/attendance/session-status?sessionId=${sessionId}`);
    assert.equal(st.body.active, false);
    const closed = await h.knex('attendance_sessions').where({ session_id: sessionId }).first();
    assert.ok(closed.check_out_at, 'check-out time stored in PostgreSQL');
    assert.equal(closed.report, 'Daily report');
  });

  test('2. attendance appears in the admin dashboard and Draft payroll automatically', async () => {
    const a = await h.admin();
    const live = await a.get('/api/attendance/live');
    assert.equal(live.status, 200);
    assert.ok(live.body.some((r) => r.username === username), 'check-in visible in live attendance');

    const ledger = await a.get(`/api/attendance?month=${h.ym(h.currentMonth())}&employeeId=${emp.id}&includeUpcoming=true`);
    assert.equal(ledger.status, 200);
    const session = await h.knex('attendance_sessions').where({ employee_id: emp.id }).first();
    const rec = ledger.body.records.find((r) => r.date === session.business_date);
    assert.ok(rec, 'official attendance record exists for the check-in date');
    assert.ok(rec.checkInAt, 'check-in synced');
    assert.ok(rec.checkOutAt, 'check-out synced');

    const legacy = await a.get('/api/admin/attendance');
    assert.ok(legacy.body.some((r) => r.username === username && r.status === 'Checked Out'));

    const p = await h.payrollFor(emp.id, h.currentMonth());
    assert.equal(p.employeeId, emp.id);
    assert.ok(Number(p.presentDays) >= 1, 'present day counted in payroll');
  });

  test('reception / feed endpoints need an active attendance session (were open in the Worker)', async () => {
    const open = await h.request(h.app).get('/api/reception/visitor/list');
    assert.equal(open.status, 401);
    const rec = await h.ensureUser(`reception_${Date.now().toString(36)}`, 'Recep#12345', ['EMPLOYEE'], { attendanceRole: 'Receptionist' });
    const lg = await h.request(h.app).post('/api/attendance/login').send({ username: rec.username, password: 'Recep#12345', deviceId: 'front-desk' });
    assert.equal(lg.status, 200);
    assert.equal(lg.body.isReception, true);
    const ok = await h.request(h.app).get('/api/reception/visitor/list').set('X-Attendance-Session', lg.body.sessionId);
    assert.equal(ok.status, 200);
    const feedOther = await h.request(h.app).get(`/api/notes/feed/${username}`).set('X-Attendance-Session', lg.body.sessionId);
    assert.equal(feedOther.status, 401, 'cannot read another user\'s feed');
  });

  test('management login returns an admin token usable by the Flutter admin dashboard', async () => {
    const m = await h.ensureUser(`owner_${Date.now().toString(36)}`, 'Owner#12345', ['HR'], { attendanceRole: 'Owner' });
    const lg = await h.request(h.app).post('/api/attendance/login').send({ username: m.username, password: 'Owner#12345' });
    assert.equal(lg.body.isManagement, true);
    assert.ok(lg.body.adminToken);
    const s = await h.request(h.app).get('/api/admin/session').set('Authorization', `Bearer ${lg.body.adminToken}`);
    assert.equal(s.status, 200);
    const d = await h.request(h.app).get('/api/admin/dashboard').set('Authorization', `Bearer ${lg.body.adminToken}`);
    assert.equal(d.status, 200);
    assert.ok('presentUsers' in d.body && 'recentActivity' in d.body);
  });
});
