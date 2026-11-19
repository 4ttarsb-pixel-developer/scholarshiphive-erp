'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const ref = (p) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;

test.describe('Payroll workflow', () => {
  const month = h.prevMonth(1);
  let dates;

  test.before(async () => {
    // daily rate = base / 30 so that the brief's example (60,000 → 2,000/day) holds exactly
    await h.setPolicy({ workingDaysBasis: 'fixed', fixedWorkingDays: 30, lateDeductionEnabled: false, severeLateRequiresReview: true, severeLateMinutes: 60, absenceDeductionEnabled: true, paidLeaveDaysPerMonth: '2' });
    dates = h.workingDates(month);
  });

  test('20. Usman example: 60,000 + 3% of 100,000 − 2,000 attendance = 61,000 everywhere', async () => {
    const a = await h.admin();
    const usman = await h.createEmployee({ name: 'Usman Tariq', base: '60000', rate: '3' });
    await h.insertSessions(usman.id, month, { skip: [dates[3]] }); // one absence = 2,000
    const sale = await a.post('/api/revenue').send({ employeeId: usman.id, saleReference: ref('USMAN'), saleDate: dates[2], saleAmount: '100000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    assert.equal(sale.body.commissionAmount, '3000.00');

    const p = await h.payrollFor(usman.id, month);
    assert.equal(p.commissionTotal, '3000.00');
    assert.equal(p.attendanceDeductions, '2000.00');
    assert.equal(p.netSalary, '61000.00');

    const commissions = (await a.get(`/api/commissions?month=${h.ym(month)}`)).body.summary.find((s) => s.employeeId === usman.id);
    assert.equal(commissions.earnedCommission, '3000.00');
    const overview = (await a.get(`/api/dashboard?month=${h.ym(month)}`)).body.records.find((r) => r.employeeId === usman.id);
    assert.equal(overview.netSalary, '61000.00');
    assert.equal(overview.commissionTotal, '3000.00');
    const list = (await a.get(`/api/payroll?month=${h.ym(month)}`)).body.records.find((r) => r.employeeId === usman.id);
    assert.equal(list.netSalary, '61000.00');
    const slip = (await a.get(`/api/payroll/${p.id}/payslip`)).body;
    assert.equal(slip.netSalary, '61000.00');
    assert.equal(slip.lines.find((l) => l.code === 'BASE').amount, '60000.00');
    assert.equal(slip.lines.find((l) => l.code === 'COMMISSION').amount, '3000.00');
    assert.equal(slip.lines.find((l) => l.code === 'ABSENCE').amount, '2000.00');
    const db = await h.knex('payroll_records').where({ id: p.id }).first();
    assert.equal(db.net_salary, '61000.00');
    assert.equal(db.gross_earnings, '63000.00');
    assert.equal(db.total_deductions, '2000.00');
    // approved payslip shows the same breakdown from the snapshot
    const ap = await a.post('/api/payroll/approve-bulk').send({ ids: [p.id] });
    assert.equal(ap.body.approved.length, 1, JSON.stringify(ap.body));
    const slip2 = (await a.get(`/api/payroll/${p.id}/payslip`)).body;
    assert.equal(slip2.official, true);
    assert.equal(slip2.netSalary, '61000.00');
    assert.equal(slip2.commissionTotal, '3000.00');
    assert.equal(slip2.lines.length, slip.lines.length);
  });

  test('Phase 7 example: 60,000 + 3% of 200,000 − 2,000 = 64,000', async () => {
    const a = await h.admin();
    const e = await h.createEmployee({ name: 'Usman Phase7', base: '60000', rate: '3' });
    await h.insertSessions(e.id, month, { skip: [dates[5]] });
    await a.post('/api/revenue').send({ employeeId: e.id, saleReference: ref('P7'), saleDate: dates[1], saleAmount: '200000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    assert.equal((await h.payrollFor(e.id, month)).netSalary, '64000.00');
  });

  test('5. missing punches and pending decisions block approval until resolved', async () => {
    const a = await h.admin();
    const e = await h.createEmployee({ name: 'Missing Punch', base: '30000' });
    await h.insertSessions(e.id, month, { noCheckout: [dates[2]] });
    let p = await h.payrollFor(e.id, month);
    assert.ok(p.blockers.some((b) => b.code === 'MISSING_CHECKOUT' && b.date === dates[2]));
    const blocked = await a.post('/api/payroll/approve-bulk').send({ ids: [p.id] });
    assert.equal(blocked.body.approved.length, 0);
    assert.match(blocked.body.blocked[0].reason, /Missing check-out/);
    // HR requests a correction (pending → still blocked), admin approves with the real time
    const hr = await h.ensureUser(`hr_${Date.now().toString(36)}`, 'Hr#123456', ['HR']);
    const hrc = await h.login(hr.username, 'Hr#123456');
    const cr = await hrc.post('/api/attendance/corrections').send({ employeeId: e.id, attendanceDate: dates[2], requestedStatus: 'Present', checkIn: '09:00', checkOut: '17:45', reason: 'Phone battery died at checkout' });
    assert.equal(cr.status, 201, JSON.stringify(cr.body));
    assert.equal(cr.body.status, 'Pending');
    p = await h.payrollFor(e.id, month);
    assert.ok(p.blockers.some((b) => b.code === 'PENDING_CORRECTION'));
    const forbidden = await hrc.post(`/api/attendance/corrections/${cr.body.id}/decide`).send({ decision: 'Approved' });
    assert.equal(forbidden.status, 403, 'HR can request but not approve corrections');
    const dec = await a.post(`/api/attendance/corrections/${cr.body.id}/decide`).send({ decision: 'Approved', note: 'Verified with CCTV' });
    assert.equal(dec.status, 200);
    p = await h.payrollFor(e.id, month);
    assert.equal(p.blockers.length, 0, JSON.stringify(p.blockers));
    const ok = await a.post('/api/payroll/approve-bulk').send({ ids: [p.id] });
    assert.equal(ok.body.approved.length, 1);
  });

  test('12. attendance correction recalculates Draft payroll (and can be reverted)', async () => {
    const a = await h.admin();
    const e = await h.createEmployee({ name: 'Recalc Tester', base: '60000' });
    await h.insertSessions(e.id, month);
    assert.equal((await h.payrollFor(e.id, month)).netSalary, '60000.00');
    const c = await a.post('/api/attendance/corrections').send({ employeeId: e.id, attendanceDate: dates[4], requestedStatus: 'Absent', reason: 'Left after 1 hour, marked absent', autoApprove: true });
    assert.equal(c.status, 201);
    let p = await h.payrollFor(e.id, month);
    assert.equal(p.attendanceDeductions, '2000.00');
    assert.equal(p.netSalary, '58000.00');
    await a.post('/api/attendance/corrections').send({ employeeId: e.id, attendanceDate: dates[4], requestedStatus: 'Recompute', reason: 'Revert: manager error', autoApprove: true });
    p = await h.payrollFor(e.id, month);
    assert.equal(p.netSalary, '60000.00');
  });

  test('13. approved payroll snapshot never changes silently', async () => {
    const a = await h.admin();
    const e = await h.createEmployee({ name: 'Snapshot Tester', base: '50000', rate: '2' });
    await h.insertSessions(e.id, month);
    const s = await a.post('/api/revenue').send({ employeeId: e.id, saleReference: ref('SNAP'), saleDate: dates[1], saleAmount: '100000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    const p = await h.payrollFor(e.id, month);
    assert.equal(p.netSalary, '52000.00');
    const ap = await a.post('/api/payroll/approve-bulk').send({ ids: [p.id] });
    assert.equal(ap.body.approved.length, 1);
    // later changes cannot alter it
    const sale2 = await a.post('/api/revenue').send({ employeeId: e.id, saleReference: ref('LATE'), saleDate: dates[2], saleAmount: '100000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    assert.equal(sale2.status, 409, 'cannot add revenue to an approved month');
    const corr = await a.post('/api/attendance/corrections').send({ employeeId: e.id, attendanceDate: dates[3], requestedStatus: 'Absent', reason: 'Attempt after approval', autoApprove: true });
    assert.equal(corr.status, 409);
    await a.patch(`/api/employees/${e.id}`).send({ baseSalary: '90000' });
    assert.equal((await h.payrollFor(e.id, month)).netSalary, '52000.00', 'base salary change does not touch the approved snapshot');
    await assert.rejects(h.knex('payroll_records').where({ id: p.id }).update({ net_salary: '1.00' }), /locked/);
    await assert.rejects(h.knex('payroll_line_items').where({ payroll_record_id: p.id }).del(), /locked/);
    // reversing a sale that was paid in approved payroll creates a pending adjustment in the next open month
    const cancel = await a.post(`/api/revenue/${s.body.id}/cancel`).send({ reason: 'Customer chargeback after payroll' });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.ok(cancel.body.adjustment, 'reversal adjustment created');
    assert.equal(cancel.body.adjustment.status, 'Pending');
    assert.equal(cancel.body.adjustment.period_month, h.currentMonth());
    assert.equal((await h.payrollFor(e.id, month)).netSalary, '52000.00');
    const next = await h.payrollFor(e.id, h.currentMonth());
    assert.ok(next.blockers.some((b) => b.code === 'PENDING_ADJUSTMENT'), 'correction must be explicitly authorised');
    const approveAdj = await a.post(`/api/payroll-adjustments/${cancel.body.adjustment.id}/approve`);
    assert.equal(approveAdj.status, 200);
    const next2 = await h.payrollFor(e.id, h.currentMonth());
    assert.ok(next2.lines.some((l) => l.code === 'OTHER' && l.amount === '2000.00'));
  });

  test('14. bulk approval approves eligible employees and reports blocked ones', async () => {
    const a = await h.admin();
    const e1 = await h.createEmployee({ name: 'Bulk One', base: '40000' });
    const e2 = await h.createEmployee({ name: 'Bulk Two', base: '41000' });
    const e3 = await h.createEmployee({ name: 'Bulk Blocked', base: '42000' });
    await h.insertSessions(e1.id, month); await h.insertSessions(e2.id, month);
    await h.insertSessions(e3.id, month, { times: { [dates[1]]: '10:30' } }); // severe late, not reviewed
    const ids = [(await h.payrollFor(e1.id, month)).id, (await h.payrollFor(e2.id, month)).id, (await h.payrollFor(e3.id, month)).id];
    const pre = await a.post('/api/payroll/approve-bulk/preview').send({ ids });
    assert.equal(pre.body.eligible.length, 2);
    assert.equal(pre.body.blocked.length, 1);
    assert.match(pre.body.blocked[0].reasons.join(), /Severe late/);
    const res = await a.post('/api/payroll/approve-bulk').send({ ids, note: 'Bulk test' });
    assert.equal(res.body.approved.length, 2);
    assert.equal(res.body.blocked.length, 1);
    const st = await h.knex('payroll_records').whereIn('id', ids).orderBy('id').pluck('status');
    assert.deepEqual(st, ['Approved', 'Approved', 'Draft']);
    const again = await a.post('/api/payroll/approve-bulk').send({ ids: [ids[0]] });
    assert.equal(again.body.approved.length, 0, 'cannot be approved twice');
    const approvals = await h.knex('payroll_approvals').where({ payroll_record_id: ids[0], action: 'APPROVE' });
    assert.equal(approvals.length, 1);
    // review the severe-late day, then it becomes eligible
    await a.post('/api/attendance/review').send({ employeeId: e3.id, date: dates[1], note: 'Traffic accident on motorway' });
    const res2 = await a.post('/api/payroll/approve-bulk').send({ ids: [ids[2]] });
    assert.equal(res2.body.approved.length, 1);
  });

  test('15. bulk rejection with reason; reopen returns to Draft', async () => {
    const a = await h.admin();
    const e1 = await h.createEmployee({ name: 'Reject One', base: '30000' });
    const e2 = await h.createEmployee({ name: 'Reject Two', base: '31000' });
    const ids = [(await h.payrollFor(e1.id, month)).id, (await h.payrollFor(e2.id, month)).id];
    assert.equal((await a.post('/api/payroll/reject-bulk').send({ ids })).status, 400, 'reason required');
    const r = await a.post('/api/payroll/reject-bulk').send({ ids, reason: 'Salary figures under dispute' });
    assert.equal(r.body.rejected.length, 2);
    assert.deepEqual(await h.knex('payroll_records').whereIn('id', ids).orderBy('id').pluck('status'), ['Rejected', 'Rejected']);
    assert.equal((await a.post(`/api/payroll/${ids[0]}/reopen`).send({ note: 'Dispute resolved' })).status, 200);
    assert.equal((await h.knex('payroll_records').where({ id: ids[0] }).first()).status, 'Draft');
  });

  test('16. salary advance is recovered exactly once (approval transaction), paid status does not double-deduct', async () => {
    const a = await h.admin();
    const e = await h.createEmployee({ name: 'Advance Tester', base: '40000', rate: '4' });
    await h.insertSessions(e.id, month, { skip: [dates[6]] });
    await a.post('/api/revenue').send({ employeeId: e.id, saleReference: ref('ADV'), saleDate: dates[0], saleAmount: '200000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    const adv = await a.post('/api/advances').send({ employeeId: e.id, amount: '12000', monthlyRecovery: '5000', advanceDate: month, recoveryStartMonth: h.ym(month), reason: 'Medical emergency advance', approveNow: true });
    assert.equal(adv.status, 201, JSON.stringify(adv.body));
    let p = await h.payrollFor(e.id, month);
    // 40,000 + 8,000 − (40,000/30 ≈ 1,333.33) − 5,000
    assert.equal(p.advanceRecovery, '5000.00');
    assert.equal(p.attendanceDeductions, '1333.33');
    assert.equal(p.netSalary, '41666.67');
    await a.post('/api/payroll/approve-bulk').send({ ids: [p.id] });
    let row = await h.knex('salary_advances').where({ id: adv.body.id }).first();
    assert.equal(row.remaining_balance, '7000.00');
    assert.equal((await h.knex('advance_recoveries').where({ advance_id: adv.body.id })).length, 1);
    const paid = await a.post(`/api/payroll/${p.id}/mark-paid`).set('Idempotency-Key', 'pay-key-1').send({ paymentDate: h.today(), paymentMethod: 'Bank Transfer', paymentReference: 'HBL-TRX-0001' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    const replay = await a.post(`/api/payroll/${p.id}/mark-paid`).set('Idempotency-Key', 'pay-key-1').send({ paymentDate: h.today(), paymentMethod: 'Bank Transfer', paymentReference: 'HBL-TRX-0001' });
    assert.equal(replay.body.replay, true, 'idempotent replay');
    const second = await a.post(`/api/payroll/${p.id}/mark-paid`).send({ paymentDate: h.today(), paymentMethod: 'Cash', paymentReference: 'CASH-2' });
    assert.equal(second.status, 409, 'cannot be paid twice');
    row = await h.knex('salary_advances').where({ id: adv.body.id }).first();
    assert.equal(row.remaining_balance, '7000.00', 'paid status did not deduct again');
    // a direct duplicate recovery is impossible at the DB level
    await assert.rejects(h.knex('advance_recoveries').insert({ advance_id: adv.body.id, payroll_record_id: p.id, amount: '5000', balance_after: '2000' }), /duplicate key/i);
    // next month shows the next installment from the reduced balance
    p = await h.payrollFor(e.id, h.currentMonth());
    assert.equal(p.advanceRecovery, '5000.00');
    assert.equal((await h.knex('payment_records').where({ payroll_record_id: (await h.payrollFor(e.id, month)).id })).length, 1);
  });

  test('17. monthly payroll isolation: each month is calculated and locked independently', async () => {
    const a = await h.admin();
    const e = await h.createEmployee({ name: 'Isolation Tester', base: '36000', rate: '5' });
    const m2 = h.prevMonth(2);
    await h.insertSessions(e.id, m2); await h.insertSessions(e.id, month);
    await a.post('/api/revenue').send({ employeeId: e.id, saleReference: ref('ISO2'), saleDate: h.workingDates(m2)[1], saleAmount: '10000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    await a.post('/api/revenue').send({ employeeId: e.id, saleReference: ref('ISO1'), saleDate: dates[1], saleAmount: '30000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    const pOld = await h.payrollFor(e.id, m2);
    const pNew = await h.payrollFor(e.id, month);
    assert.equal(pOld.commissionTotal, '500.00');
    assert.equal(pNew.commissionTotal, '1500.00');
    await a.post('/api/payroll/approve-bulk').send({ ids: [pOld.id] });
    await a.post('/api/attendance/corrections').send({ employeeId: e.id, attendanceDate: dates[0], requestedStatus: 'Absent', reason: 'Later month correction', autoApprove: true });
    assert.equal((await h.payrollFor(e.id, m2)).netSalary, pOld.netSalary, 'older approved month untouched');
    assert.equal((await h.payrollFor(e.id, month)).attendanceDeductions, '1200.00');
  });
});
