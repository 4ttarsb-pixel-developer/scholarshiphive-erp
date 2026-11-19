'use strict';
/**
 * One-time, validated import of the old Salary Analyzer LocalStorage data
 * (key workforce_pay_executive_ten_staff_v3). Rules:
 *  - Employees are matched by employee code AND name; a code that exists with a
 *    different name is rejected (no silent overwrite). Existing salaries are never changed.
 *  - Sales are imported only if their reference is new (unique index); legacy per-unit
 *    PKR commissions (no sale amount) are skipped because they cannot be expressed as a %.
 *  - Advances are imported once (source hash). Attendance is NOT imported as real
 *    attendance; optionally for demo employees only, as admin-attested corrections.
 *  - The same file can never be imported twice (import_batches unique hash).
 */
const knex = require('../db');
const { audit } = require('./audit.service');
const { sha256Hex } = require('../utils/crypto');
const { D, Decimal, commissionFor } = require('../utils/money');
const { isValidDate, monthStart } = require('../utils/time');
const { accountingMonthFor, policyFor } = require('./policy.service');
const payroll = require('./payroll.service');
const { badRequest, conflict } = require('../utils/errors');

function validateShape(data) {
  if (!data || typeof data !== 'object') throw badRequest('Paste the exported JSON object.');
  if (!Array.isArray(data.employees)) throw badRequest('Invalid file: "employees" array missing.');
  for (const k of ['sales', 'advances', 'attendance']) if (data[k] !== undefined && !Array.isArray(data[k])) throw badRequest(`Invalid file: "${k}" must be an array.`);
  if (data.employees.length > 1000) throw badRequest('Too many employees in file.');
}

async function importData(data, actor, { dryRun = true, includeDemoAttendance = false, backupConfirmed = false, ip } = {}) {
  validateShape(data);
  if (!dryRun && !backupConfirmed) throw badRequest('Download and keep the backup first (backupConfirmed must be true).');
  const hash = sha256Hex(JSON.stringify(data));
  const report = { employees: { created: 0, matched: 0, rejected: [] }, commissionRates: { set: 0, kept: 0 }, sales: { imported: 0, skipped: [] }, advances: { imported: 0, skipped: [] }, attendance: { imported: 0, skipped: 0 }, dryRun };

  const exec = async (trx) => {
    if (await trx('import_batches').where({ source: 'localstorage', source_hash: hash }).first()) throw conflict('This exact export has already been imported.');
    const idByCode = new Map();
    for (const e of data.employees) {
      const code = String(e.id || '').toUpperCase().trim();
      const name = String(e.name || '').trim();
      if (!/^[A-Z0-9_-]{2,30}$/.test(code) || name.length < 2) { report.employees.rejected.push({ code, reason: 'Invalid code or name' }); continue; }
      const existing = await trx('employees').whereRaw('upper(employee_code)=?', [code]).first();
      if (existing) {
        if (existing.full_name.toLowerCase() !== name.toLowerCase()) { report.employees.rejected.push({ code, reason: `Code exists for "${existing.full_name}" (not "${name}")` }); continue; }
        idByCode.set(code, existing.id); report.employees.matched += 1;
      } else {
        const base = D(e.base || 0);
        const [row] = await trx('employees').insert({
          employee_code: code, full_name: name, designation: e.job || null, joining_date: data.month ? monthStart(data.month) : new Date().toISOString().slice(0, 10),
          base_salary: base.isNegative() ? '0.00' : base.toFixed(2), is_demo: true, notes: 'Imported from Salary Analyzer LocalStorage (demo)',
        }).returning('*');
        if (e.dept) {
          const dep = await trx('departments').whereRaw('lower(name)=lower(?)', [e.dept]).first() || (await trx('departments').insert({ name: e.dept }).returning('*'))[0];
          await trx('employees').where({ id: row.id }).update({ department_id: dep.id });
        }
        idByCode.set(code, row.id); report.employees.created += 1;
      }
      const policyRate = e.commissionPolicy && /^(fixed|percentage)$/.test(e.commissionPolicy.mode) ? e.commissionPolicy.value : null;
      if (policyRate !== null && D(policyRate).gte(0) && D(policyRate).lte(100)) {
        const id = idByCode.get(code);
        const has = await trx('commission_settings').where({ employee_id: id }).first();
        if (has) report.commissionRates.kept += 1;
        else { await trx('commission_settings').insert({ employee_id: id, fixed_rate_percent: D(policyRate).toString(), updated_by: actor.id }); report.commissionRates.set += 1; }
      }
    }
    for (const s of data.sales || []) {
      const ref = String(s.ref || '').trim();
      const empId = idByCode.get(String(s.employeeId || '').toUpperCase());
      if (!ref || !empId || !isValidDate(s.date)) { report.sales.skipped.push({ ref, reason: 'Missing reference, employee or date' }); continue; }
      if (!s.saleAmount || !['fixedPercent', 'percentage'].includes(s.commissionMode)) { report.sales.skipped.push({ ref, reason: 'Legacy per-unit PKR commission without sale amount; re-enter with an amount' }); continue; }
      if (await trx('revenue_sales').whereRaw('upper(sale_reference)=upper(?)', [ref]).first()) { report.sales.skipped.push({ ref, reason: 'Duplicate reference' }); continue; }
      const policy = await policyFor(s.date, trx);
      const month = accountingMonthFor(s.date, policy.payrollCutoffDay);
      if (await payroll.isLocked(empId, month, trx)) { report.sales.skipped.push({ ref, reason: 'Month payroll locked' }); continue; }
      const rate = D(s.commissionValue || 0).toString();
      const amount = D(s.saleAmount).toFixed(2);
      const status = ['Pending', 'Verified', 'Rejected', 'Cancelled'].includes(s.status) ? s.status : 'Pending';
      const [row] = await trx('revenue_sales').insert({
        sale_reference: ref, employee_id: empId, sale_date: s.date, accounting_month: month, sale_amount: amount, units: Number(s.units) || null,
        commission_method: s.commissionMode === 'fixedPercent' ? 'FIXED_EMPLOYEE' : 'MANUAL_PERCENT', applied_rate_percent: rate,
        commission_amount: commissionFor(amount, rate).toFixed(2), status, is_demo: true, notes: 'Imported from LocalStorage', created_by: actor.id,
        verified_by: status === 'Verified' ? actor.id : null, verified_at: status === 'Verified' ? new Date() : null,
      }).returning('*');
      if (status === 'Verified') {
        await trx('commission_entries').insert({ sale_id: row.id, employee_id: empId, accounting_month: month, sale_amount: amount, rate_percent: rate, amount: row.commission_amount });
      }
      report.sales.imported += 1;
    }
    for (const a of data.advances || []) {
      const empId = idByCode.get(String(a.employeeId || '').toUpperCase());
      const ref = `localstorage-advance:${sha256Hex(JSON.stringify(a)).slice(0, 16)}`;
      if (!empId || !isValidDate(a.date) || !(D(a.amount || 0).gt(0)) || !(D(a.recovery || 0).gt(0))) { report.advances.skipped.push({ reason: 'Invalid advance row' }); continue; }
      if (await trx('salary_advances').where({ employee_id: empId, reason: `${a.reason || 'Advance'} [${ref}]` }).first()) { report.advances.skipped.push({ reason: 'Already imported' }); continue; }
      const status = ['Pending', 'Active', 'Settled', 'Rejected'].includes(a.status) ? a.status : 'Pending';
      await trx('salary_advances').insert({
        employee_id: empId, amount: D(a.amount).toFixed(2), monthly_recovery: Decimal.min(D(a.recovery), D(a.amount)).toFixed(2),
        remaining_balance: Decimal.min(D(a.remaining ?? a.amount), D(a.amount)).toFixed(2), advance_date: a.date, recovery_start_month: monthStart(a.date),
        status, reason: `${a.reason || 'Advance'} [${ref}]`, is_demo: true, created_by: actor.id, approved_by: status === 'Active' ? actor.id : null,
      });
      report.advances.imported += 1;
    }
    if (includeDemoAttendance) {
      for (const r of data.attendance || []) {
        const empId = idByCode.get(String(r.employeeId || '').toUpperCase());
        const emp = empId ? await trx('employees').where({ id: empId }).first() : null;
        if (!emp || !emp.is_demo || !isValidDate(r.date)) { report.attendance.skipped += 1; continue; }
        const map = { Present: 'Present', Absent: 'Absent' };
        let status = map[r.status];
        if (r.status === 'Leave') status = r.leaveState === 'Approved' ? 'PaidLeave' : r.leaveState === 'Rejected' ? 'Absent' : null;
        if (!status || (status === 'Present' && !r.checkIn)) { report.attendance.skipped += 1; continue; }
        if (await trx('attendance_corrections').where({ employee_id: empId, attendance_date: r.date }).first()) { report.attendance.skipped += 1; continue; }
        const { toInstants } = require('./correction.service');
        const { inAt } = status === 'Present' ? await toInstants(emp, r.date, r.checkIn, null, trx) : { inAt: null };
        await trx('attendance_corrections').insert({
          employee_id: empId, attendance_date: r.date, requested_status: status, requested_check_in: inAt, reason: `Imported demo attendance: ${r.reason || 'LocalStorage'}`,
          status: 'Approved', requested_by: actor.id, decided_by: actor.id, decided_at: new Date(), decision_note: 'LocalStorage demo import',
        });
        report.attendance.imported += 1;
      }
    }
    if (!dryRun) {
      await trx('import_batches').insert({ source: 'localstorage', source_hash: hash, summary: JSON.stringify(report), imported_by: actor.id });
      await audit(trx, { actor, action: 'LocalStorage data imported', entityType: 'import', entityId: hash.slice(0, 12), ip, detail: JSON.stringify(report).slice(0, 2000) });
    }
  };

  if (dryRun) {
    try {
      await knex.transaction(async (trx) => { await exec(trx); throw Object.assign(new Error('dry-run'), { dryRun: true }); });
    } catch (e) { if (!e.dryRun) throw e; }
  } else {
    await knex.transaction(exec);
  }
  return report;
}

module.exports = { importData };
