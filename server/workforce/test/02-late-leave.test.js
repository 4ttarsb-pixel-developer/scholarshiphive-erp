'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.describe('Lateness, overnight shifts and leave (server-side source of truth)', () => {
  const month = h.prevMonth(1);
  let dates;

  test.before(async () => {
    await h.setPolicy({ workingDaysBasis: 'fixed', fixedWorkingDays: 30, graceMinutes: 10, lateDeductionEnabled: false, severeLateRequiresReview: false, paidLeaveDaysPerMonth: '2', absenceDeductionEnabled: true });
    dates = h.workingDates(month);
  });

  test('3. late minutes follow the configured shift + grace (09:30 vs 09:00 = 30 min)', async () => {
    const e = await h.createEmployee({ name: 'Late Tester', base: '60000', shiftName: 'Morning' });
    await h.insertSessions(e.id, month, { times: { [dates[0]]: '09:30', [dates[1]]: '09:08', [dates[2]]: '10:15' } });
    await h.payrollFor(e.id, month); // triggers server recalculation
    const rec = async (d) => h.knex('attendance_records').where({ employee_id: e.id, attendance_date: d }).first();
    const r1 = await rec(dates[0]); const r2 = await rec(dates[1]); const r3 = await rec(dates[2]); const r4 = await rec(dates[3]);
    assert.equal(r1.late_minutes, 30); assert.equal(r1.status, 'Late');
    assert.equal(r2.late_minutes, 8); assert.equal(r2.status, 'Present', 'within 10-minute grace');
    assert.equal(r3.late_minutes, 75); assert.equal(r3.status, 'Late');
    assert.equal(r4.late_minutes, 0); assert.equal(r4.status, 'Present');
    const p = await h.payrollFor(e.id, month);
    assert.equal(p.lateMinutes, 30 + 8 + 75);
    assert.equal(p.attendanceDeductions, '0.00', 'late penalties are not applied while disabled in policy');
  });

  test('3b. configurable tiered late policy (grace 10, ≥60 min → 5%, ≥120 min → 10% of daily salary)', async () => {
    await h.setPolicy({ workingDaysBasis: 'fixed', fixedWorkingDays: 30, graceMinutes: 10, lateDeductionEnabled: true, lateRuleType: 'tiered', lateBasis: 'daily', lateCapPercent: '10', lateTiers: [{ minMinutes: 60, percent: '5' }, { minMinutes: 120, percent: '10' }], severeLateRequiresReview: false });
    const e = await h.createEmployee({ name: 'Tier Tester', base: '60000', shiftName: 'Morning' });
    await h.insertSessions(e.id, month, { times: { [dates[0]]: '09:30', [dates[1]]: '10:05', [dates[2]]: '11:10' } });
    const p = await h.payrollFor(e.id, month);
    // daily = 60000/30 = 2000 → 30 min: 0 ; 65 min: 5% = 100 ; 130 min: 10% = 200
    assert.equal(p.attendanceDeductions, '300.00');
    const late = p.lines.find((l) => l.code === 'LATE');
    assert.equal(late.amount, '300.00');
    await h.setPolicy({ workingDaysBasis: 'fixed', fixedWorkingDays: 30, lateDeductionEnabled: false, severeLateRequiresReview: false });
  });

  test('3c. overnight shift: 01:30 check-in belongs to the previous shift date', async () => {
    const e = await h.createEmployee({ name: 'Night Owl', base: '45000', shiftName: 'Night', username: `night_${Date.now().toString(36)}` });
    const user = await h.knex('users').where({ employee_id: e.id }).first();
    const att = require('../src/services/attendance.service');
    const d = dates[4];
    const nextDay = h.addDays(d, 1);
    const at = h.zonedToUtc(nextDay, '01:30', h.TZ);
    const bd = await att.businessDateFor(await h.knex('employees').where({ id: e.id }).first(), at);
    assert.equal(bd, d, 'after-midnight check-in counts for the shift that started the evening before');
    const at2 = h.zonedToUtc(d, '21:45', h.TZ);
    assert.equal(await att.businessDateFor(await h.knex('employees').where({ id: e.id }).first(), at2), d);
    await h.knex('attendance_sessions').insert({ session_id: require('crypto').randomUUID(), user_id: user.id, employee_id: e.id, business_date: d, check_in_at: at2, check_out_at: h.zonedToUtc(nextDay, '06:00', h.TZ), is_active: false, closed_reason: 'checkout', source: 'test' });
    await h.payrollFor(e.id, month);
    const r = await h.knex('attendance_records').where({ employee_id: e.id, attendance_date: d }).first();
    assert.equal(r.late_minutes, 45);
    assert.equal(r.worked_seconds, (8 * 60 + 15) * 60, '21:45 → 06:00 = 8h15m');
    assert.equal(r.early_departure_minutes, 0);
  });

  test('4. paid vs unpaid leave, rejected leave = one absence (never double-counted)', async () => {
    const e = await h.createEmployee({ name: 'Leave Tester', base: '60000', username: `leave_${Date.now().toString(36)}` });
    const [d1, d2, d3, d4] = [dates[5], dates[6], dates[7], dates[8]];
    await h.insertSessions(e.id, month, { skip: [d1, d2, d3, d4] });
    const a = await h.admin();
    const mk = async (d) => (await a.post('/api/leaves').send({ employeeId: e.id, leaveType: 'Full-Day Leave', startDate: d, endDate: d, reason: 'Test leave' })).body;
    const l1 = await mk(d1); const l2 = await mk(d2); const l3 = await mk(d3);
    // pending leave blocks payroll approval
    let p = await h.payrollFor(e.id, month);
    assert.ok(p.blockers.some((b) => b.code === 'PENDING_LEAVE'));
    assert.equal((await a.post(`/api/leaves/${l1.id}/approve`).send({ payType: 'Paid' })).status, 200);
    assert.equal((await a.post(`/api/leaves/${l2.id}/approve`).send({ payType: 'Unpaid' })).status, 200);
    assert.equal((await a.post(`/api/leaves/${l3.id}/reject`).send({ note: 'Not approved in peak week' })).status, 200);
    p = await h.payrollFor(e.id, month);
    assert.equal(p.paidLeaveDays, '1');
    assert.equal(p.unpaidLeaveDays, '1');
    assert.equal(p.absentDays, '2', 'rejected leave day + plain absence');
    // daily 2000: unpaid leave 2000; absences 2 × 2000 = 4000 (no separate rejected-leave charge)
    assert.equal(p.unpaidLeaveDeduction, '2000.00');
    assert.equal(p.attendanceDeductions, '4000.00');
    assert.equal(p.netSalary, '54000.00');
    assert.equal(p.blockers.length, 0);
    const statuses = await h.knex('attendance_records').where({ employee_id: e.id }).whereIn('attendance_date', [d1, d2, d3, d4]).orderBy('attendance_date').pluck('status');
    assert.deepEqual(statuses, ['PaidLeave', 'UnpaidLeave', 'Absent', 'Absent']);
  });

  test('4b. paid leave beyond the monthly allowance becomes unpaid; holidays are never absences', async () => {
    const e = await h.createEmployee({ name: 'Allowance Tester', base: '30000' });
    const ds = dates.slice(9, 12); const hol = dates[12];
    await h.insertSessions(e.id, month, { skip: [...ds, hol] });
    const a = await h.admin();
    for (const d of ds) {
      const l = (await a.post('/api/leaves').send({ employeeId: e.id, startDate: d, reason: 'Allowance test' })).body;
      await a.post(`/api/leaves/${l.id}/approve`).send({ payType: 'Paid' });
    }
    const hr = await a.post('/api/holidays').send({ date: hol, name: 'Test Holiday', isPaid: true });
    assert.equal(hr.status, 201, JSON.stringify(hr.body));
    const p = await h.payrollFor(e.id, month);
    assert.equal(p.paidLeaveDays, '2');
    assert.equal(p.unpaidLeaveDays, '1');
    assert.equal(p.absentDays, '0', 'holiday is not an absence');
    assert.equal(p.unpaidLeaveDeduction, '1000.00'); // 30000/30
    await a.del(`/api/holidays/${hr.body.id}`);
  });
});
