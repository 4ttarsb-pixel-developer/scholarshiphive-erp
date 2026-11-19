'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.describe('19. Roles, permissions and unauthorised access', () => {
  let empA; let empB; let employee; let revenue; let hr;
  const month = h.prevMonth(1);

  test.before(async () => {
    await h.setPolicy({ workingDaysBasis: 'fixed', fixedWorkingDays: 30, lateDeductionEnabled: false, severeLateRequiresReview: false });
    const ua = `emp_a_${Date.now().toString(36)}`;
    empA = await h.createEmployee({ name: 'Employee A', base: '40000', rate: '2', username: ua, password: 'EmpA#12345' });
    empB = await h.createEmployee({ name: 'Employee B', base: '45000', rate: '2' });
    employee = await h.login(ua, 'EmpA#12345');
    await h.ensureUser(`rev_${Date.now().toString(36)}`, 'Rev#123456', ['REVENUE_MANAGER']).then(async (u) => { revenue = await h.login(u.username, 'Rev#123456'); });
    await h.ensureUser(`hr2_${Date.now().toString(36)}`, 'Hr#1234567', ['HR']).then(async (u) => { hr = await h.login(u.username, 'Hr#1234567'); });
  });

  test('unauthenticated requests are rejected', async () => {
    for (const url of ['/api/payroll', '/api/employees', '/api/revenue', '/api/attendance', '/api/audit', '/api/admin/users']) {
      const r = await h.request(h.app).get(url);
      assert.equal(r.status, 401, url);
    }
  });

  test('employee sees only own data and cannot change salary, commission or attendance', async () => {
    assert.equal((await employee.get('/api/payroll')).status, 403);
    assert.equal((await employee.get(`/api/payroll/${empB.id}?month=${h.ym(month)}`)).status, 403, 'other employee payroll');
    assert.equal((await employee.get(`/api/payroll/${empA.id}?month=${h.ym(month)}`)).status, 200, 'own payroll');
    assert.equal((await employee.get(`/api/attendance/employee/${empB.id}`)).status, 403);
    assert.equal((await employee.get(`/api/attendance/employee/${empA.id}`)).status, 200);
    assert.equal((await employee.patch(`/api/employees/${empA.id}`).send({ baseSalary: '999999' })).status, 403);
    assert.equal((await employee.put(`/api/commission-settings/${empA.id}`).send({ fixedRatePercent: '50', reason: 'give me more' })).status, 403);
    assert.equal((await employee.post('/api/attendance/corrections').send({ employeeId: empA.id, attendanceDate: h.workingDates(month)[0], requestedStatus: 'Present', checkIn: '09:00', reason: 'self edit attempt' })).status, 403);
    assert.equal((await employee.post('/api/revenue').send({})).status, 403);
    const me = await employee.get(`/api/me/overview?month=${h.ym(month)}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.employee.employee_code, empA.employeeCode);
    const leave = await employee.post('/api/me/leaves').send({ leaveType: 'Full-Day Leave', startDate: h.addDays(h.today(), 3), reason: 'Family event' });
    assert.equal(leave.status, 201, JSON.stringify(leave.body));
    const pr = (await h.payrollFor(empB.id, month));
    assert.equal((await employee.get(`/api/payroll/${pr.id}/payslip`)).status, 403, 'cannot open someone else\'s payslip');
  });

  test('revenue manager records/verifies sales but cannot approve payroll or see salaries', async () => {
    const s = await revenue.post('/api/revenue').send({ employeeId: empB.id, saleReference: `RM-${Date.now()}`, saleDate: h.workingDates(month)[0], saleAmount: '5000', commissionMethod: 'FIXED_EMPLOYEE' });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal((await revenue.post(`/api/revenue/${s.body.id}/verify`)).status, 200);
    const p = await h.payrollFor(empB.id, month);
    assert.equal((await revenue.post('/api/payroll/approve-bulk').send({ ids: [p.id] })).status, 403);
    assert.equal((await revenue.get('/api/payroll')).status, 403);
    assert.equal((await revenue.put(`/api/commission-settings/${empB.id}`).send({ fixedRatePercent: '9', reason: 'not allowed' })).status, 403);
  });

  test('HR manages leave/attendance but cannot view payroll or approve corrections', async () => {
    assert.equal((await hr.get('/api/leaves')).status, 200);
    assert.equal((await hr.get(`/api/attendance?month=${h.ym(month)}`)).status, 200);
    assert.equal((await hr.get('/api/payroll')).status, 403);
    assert.equal((await hr.post('/api/payroll/approve-bulk').send({ ids: [1] })).status, 403);
    assert.equal((await hr.post('/api/policies').send({})).status, 403);
  });

  test('cookie sessions require the X-Requested-With header for changes (CSRF defence)', async () => {
    const agent = h.request.agent(h.app);
    const lg = await agent.post('/api/auth/login').send({ username: 'test.admin', password: 'Admin#12345' });
    assert.equal(lg.status, 200);
    assert.equal((await agent.get('/api/auth/me')).status, 200);
    const noHeader = await agent.post('/api/payroll/calculate').send({ month: h.ym(month) });
    assert.equal(noHeader.status, 403);
    const withHeader = await agent.post('/api/payroll/calculate').set('X-Requested-With', 'XMLHttpRequest').send({ month: h.ym(month) });
    assert.equal(withHeader.status, 200);
  });

  test('passwords are hashed; legacy hashes are upgraded on login; lockout after repeated failures', async () => {
    const crypto = require('crypto');
    const u = await h.ensureUser(`legacy_${Date.now().toString(36)}`, 'placeholder1', ['EMPLOYEE']);
    await h.knex('users').where({ id: u.id }).update({ password_hash: crypto.createHash('sha256').update('worker-pass').digest('hex') });
    const r = await h.request(h.app).post('/api/auth/login').send({ username: u.username, password: 'worker-pass' });
    assert.equal(r.status, 200);
    assert.match((await h.knex('users').where({ id: u.id }).first()).password_hash, /^\$scrypt\$/, 'upgraded to scrypt');
    for (let i = 0; i < 10; i += 1) await h.request(h.app).post('/api/auth/login').send({ username: u.username, password: 'wrong' });
    const locked = await h.request(h.app).post('/api/auth/login').send({ username: u.username, password: 'worker-pass' });
    assert.equal(locked.status, 401);
    assert.match(locked.body.message, /locked/i);
  });

  test('CORS only allows configured origins', async () => {
    const bad = await h.request(h.app).get('/api/health').set('Origin', 'https://evil.example');
    assert.equal(bad.headers['access-control-allow-origin'], undefined);
    const good = await h.request(h.app).get('/api/health').set('Origin', 'http://localhost:5173');
    assert.equal(good.headers['access-control-allow-origin'], 'http://localhost:5173');
  });
});
