'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.describe('Revenue and commission', () => {
  const month = h.prevMonth(1);
  let usman; let other; let dates;
  const ref = (p) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;

  test.before(async () => {
    await h.setPolicy({ workingDaysBasis: 'fixed', fixedWorkingDays: 30, lateDeductionEnabled: false, severeLateRequiresReview: false });
    usman = await h.createEmployee({ name: 'Usman Tariq (C)', base: '60000', rate: '3' });
    other = await h.createEmployee({ name: 'Other Seller', base: '50000', rate: '2' });
    dates = h.workingDates(month);
    await h.insertSessions(usman.id, month);
    await h.insertSessions(other.id, month);
  });

  test('6. Fixed Employee Commission loads the saved % from PostgreSQL (client value ignored)', async () => {
    const a = await h.admin();
    const s = await a.get(`/api/commission-settings/${usman.id}`);
    assert.equal(s.body.fixedRatePercent, '3');
    const r = await a.post('/api/revenue').send({ employeeId: usman.id, saleReference: ref('FIX'), saleDate: dates[0], saleAmount: '100000', commissionMethod: 'FIXED_EMPLOYEE', manualRatePercent: '9', verifyNow: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.appliedRatePercent, '3.000');
    assert.equal(r.body.commissionAmount, '3000.00');
    assert.equal(r.body.status, 'Verified');
  });

  test('7. Manual Percentage stores the entered rate for that sale', async () => {
    const a = await h.admin();
    const r = await a.post('/api/revenue').send({ employeeId: usman.id, saleReference: ref('MAN'), saleDate: dates[1], saleAmount: '100000', commissionMethod: 'MANUAL_PERCENT', manualRatePercent: '5' });
    assert.equal(r.status, 201);
    assert.equal(r.body.appliedRatePercent, '5.000');
    assert.equal(r.body.commissionAmount, '5000.00');
    assert.equal(r.body.status, 'Pending');
    const bad = await a.post('/api/revenue').send({ employeeId: usman.id, saleReference: ref('MAN'), saleDate: dates[1], saleAmount: '100000', commissionMethod: 'MANUAL_PERCENT', manualRatePercent: '150' });
    assert.equal(bad.status, 400);
    const badMethod = await a.post('/api/revenue').send({ employeeId: usman.id, saleReference: ref('X'), saleDate: dates[1], saleAmount: '100000', commissionMethod: 'FIXED_PKR' });
    assert.equal(badMethod.status, 400, 'only the two methods exist');
  });

  test('8. commission PKR = amount × % / 100 with decimal-safe half-up rounding', async () => {
    const a = await h.admin();
    const cases = [['200000', '3', '6000.00'], ['1234.56', '2.5', '30.86'], ['1.00', '0.5', '0.01'], ['99999.99', '7.125', '7125.00']];
    for (const [amount, rate, expected] of cases) {
      const r = await a.post('/api/revenue').send({ employeeId: other.id, saleReference: ref('RND'), saleDate: dates[2], saleAmount: amount, commissionMethod: 'MANUAL_PERCENT', manualRatePercent: rate });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.commissionAmount, expected, `${amount} × ${rate}%`);
    }
    // the DB itself enforces the formula
    await assert.rejects(h.knex('revenue_sales').insert({ sale_reference: ref('BAD'), employee_id: other.id, sale_date: dates[2], accounting_month: month, sale_amount: '100.00', commission_method: 'MANUAL_PERCENT', applied_rate_percent: '10', commission_amount: '99.00' }), /check constraint/i);
  });

  test('9. revenue is linked to the correct employee only', async () => {
    const a = await h.admin();
    const pu = await h.payrollFor(usman.id, month);
    const po = await h.payrollFor(other.id, month);
    assert.equal(pu.commissionTotal, '3000.00', 'only the verified fixed sale so far');
    assert.equal(po.commissionTotal, '0.00', 'other employee has only pending sales');
    const sum = (await a.get(`/api/commissions?month=${h.ym(month)}`)).body.summary;
    assert.equal(sum.find((s) => s.employeeId === usman.id).earnedCommission, '3000.00');
    assert.equal(sum.find((s) => s.employeeId === other.id).earnedCommission, '0.00');
  });

  test('10. duplicate sale references are rejected (API, case-insensitive, concurrent, DB level)', async () => {
    const a = await h.admin();
    const r0 = ref('DUP');
    const ok = await a.post('/api/revenue').send({ employeeId: usman.id, saleReference: r0, saleDate: dates[3], saleAmount: '1000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    assert.equal(ok.status, 201);
    const dup = await a.post('/api/revenue').send({ employeeId: other.id, saleReference: r0.toLowerCase(), saleDate: dates[3], saleAmount: '1000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    assert.equal(dup.status, 409);
    const r1 = ref('RACE');
    const results = await Promise.all([1, 2, 3].map(() => a.post('/api/revenue').send({ employeeId: usman.id, saleReference: r1, saleDate: dates[3], saleAmount: '500', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true })));
    assert.equal(results.filter((x) => x.status === 201).length, 1, 'exactly one concurrent insert wins');
    const count = await h.knex('revenue_sales').whereRaw('upper(sale_reference)=upper(?)', [r1]).count('* as c').first();
    assert.equal(Number(count.c), 1);
    const sale = await h.knex('revenue_sales').whereRaw('upper(sale_reference)=upper(?)', [r1]).first();
    await assert.rejects(h.knex('commission_entries').insert({ sale_id: sale.id, employee_id: usman.id, accounting_month: month, sale_amount: '500', rate_percent: '3', amount: '15' }), /duplicate key/i);
  });

  test('11. verified commission flows into Draft payroll; edits update (no duplicate); reject/cancel removes it', async () => {
    const a = await h.admin();
    const base = Number((await h.payrollFor(usman.id, month)).commissionTotal);
    const s = await a.post('/api/revenue').send({ employeeId: usman.id, saleReference: ref('FLOW'), saleDate: dates[4], saleAmount: '200000', commissionMethod: 'FIXED_EMPLOYEE' });
    assert.equal(Number((await h.payrollFor(usman.id, month)).commissionTotal), base, 'pending sale not counted');
    assert.equal((await a.post(`/api/revenue/${s.body.id}/verify`)).status, 200);
    assert.equal(Number((await h.payrollFor(usman.id, month)).commissionTotal), base + 6000);
    // rate change affects only new sales: historical sale keeps 3%
    assert.equal((await a.put(`/api/commission-settings/${usman.id}`).send({ fixedRatePercent: '4', reason: 'Annual review test' })).status, 200);
    const ed = await a.patch(`/api/revenue/${s.body.id}`).send({ saleAmount: '250000', version: 2 });
    assert.equal(ed.status, 200, JSON.stringify(ed.body));
    assert.equal(ed.body.appliedRatePercent, '3.000', 'historical applied rate preserved on edit');
    assert.equal(ed.body.commissionAmount, '7500.00');
    const entries = await h.knex('commission_entries').where({ sale_id: s.body.id });
    assert.equal(entries.length, 1, 'still exactly one commission entry');
    assert.equal(Number((await h.payrollFor(usman.id, month)).commissionTotal), base + 7500);
    const newSale = await a.post('/api/revenue').send({ employeeId: usman.id, saleReference: ref('NEW4'), saleDate: dates[4], saleAmount: '10000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    assert.equal(newSale.body.appliedRatePercent, '4.000', 'new sales use the new rate');
    const c = await a.post(`/api/revenue/${s.body.id}/cancel`).send({ reason: 'Customer refund test' });
    assert.equal(c.status, 200);
    assert.equal(Number((await h.payrollFor(usman.id, month)).commissionTotal), base + 400);
    const rj = await a.post(`/api/revenue/${newSale.body.id}/reject`).send({ reason: 'Only pending can be rejected' });
    assert.equal(rj.status, 409);
    await a.put(`/api/commission-settings/${usman.id}`).send({ fixedRatePercent: '3', reason: 'Restore for later tests' });
  });

  test('September revenue never appears in October payroll (accounting month isolation)', async () => {
    const a = await h.admin();
    const m2 = h.prevMonth(2);
    const before = (await h.payrollFor(usman.id, m2)).commissionTotal;
    await a.post('/api/revenue').send({ employeeId: usman.id, saleReference: ref('ISO'), saleDate: h.addDays(m2, 9), saleAmount: '50000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true });
    const after = (await h.payrollFor(usman.id, m2)).commissionTotal;
    assert.equal(Number(after) - Number(before), 1500);
    const cur = await h.payrollFor(usman.id, month);
    assert.ok(!cur.commissions.some((x) => x.sale_reference.startsWith('ISO')), 'not in the other month');
  });
});
