'use strict';
/**
 * Removes ONLY demo data: employees flagged is_demo (and everything that belongs to
 * them), demo revenue, demo advances and the demo HR/revenue manager accounts.
 * Real employees, real attendance and real payroll are never touched.
 *   npm run db:reset-demo -- --yes
 */
const knex = require('../src/db');

(async () => {
  if (!process.argv.includes('--yes')) throw new Error('This deletes all DEMO records. Re-run with --yes to confirm.');
  const ids = await knex('employees').where({ is_demo: true }).pluck('id');
  const summary = await knex.transaction(async (trx) => {
    const recIds = await trx('payroll_records').whereIn('employee_id', ids).pluck('id');
    // Approved/paid demo payroll is protected by triggers; disable them for this demo-only cleanup.
    await trx.raw('ALTER TABLE payroll_records DISABLE TRIGGER payroll_records_lock_delete');
    await trx.raw('ALTER TABLE payroll_line_items DISABLE TRIGGER payroll_line_items_lock');
    await trx.raw('ALTER TABLE commission_entries DISABLE TRIGGER commission_entries_lock');
    try {
      await trx('advance_recoveries').whereIn('payroll_record_id', recIds).del();
      await trx('payment_records').whereIn('payroll_record_id', recIds).del();
      await trx('commission_entries').whereIn('employee_id', ids).del();
      await trx('payroll_line_items').whereIn('payroll_record_id', recIds).del();
      await trx('payroll_approvals').whereIn('payroll_record_id', recIds).del();
      await trx('payroll_records').whereIn('id', recIds).del();
      const sales = await trx('revenue_sales').where({ is_demo: true }).orWhereIn('employee_id', ids).del();
      const adv = await trx('salary_advances').where({ is_demo: true }).orWhereIn('employee_id', ids).del();
      const demoUsers = await trx('users').whereIn('employee_id', ids).orWhereIn('username', ['hr.manager', 'revenue.manager']).pluck('id');
      await trx('attendance_sessions').whereIn('user_id', demoUsers).del();
      await trx('device_bindings').whereIn('user_id', demoUsers).del();
      await trx('users').whereIn('id', demoUsers).del();
      const emps = await trx('employees').whereIn('id', ids).del();
      await trx('audit_logs').insert({ actor_name: 'CLI', action: 'Demo data reset', detail: `${emps} demo employees, ${sales} demo sales, ${adv} demo advances removed` });
      return { employees: emps, sales, advances: adv, users: demoUsers.length };
    } finally {
      await trx.raw('ALTER TABLE payroll_records ENABLE TRIGGER payroll_records_lock_delete');
      await trx.raw('ALTER TABLE payroll_line_items ENABLE TRIGGER payroll_line_items_lock');
      await trx.raw('ALTER TABLE commission_entries ENABLE TRIGGER commission_entries_lock');
    }
  });
  console.log('[reset-demo] Removed:', summary, '\nRun "npm run db:seed" to recreate demo data.');
})().then(() => knex.destroy()).catch((e) => { console.error(`[reset-demo] ${e.message}`); knex.destroy().then(() => process.exit(1)); });
