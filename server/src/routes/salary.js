import express from 'express';
import { one, many, tx } from '../db.js';
import { ah, bad, forbidden, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requirePerm, requireAdmin } from '../middleware/auth.js';
import { can, isAdmin } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';
import { sendMail, template, link } from '../lib/email.js';
import { commission, add, sub, sum, monthBounds, currentMonth, monthLabel, pkr } from '../lib/money.js';
import { payslipPdf } from '../lib/pdf.js';
import { METHODS } from './revenue.js';

const r = express.Router();
r.use(requireAuth);

const STATUS_LABEL = { draft: 'Draft', in_process: 'In Process', approved: 'Approved', paid: 'Paid' };

/** Net received sales for an employee in a month (payments − refunds, by date). */
export async function monthSales(db, userId, month) {
  const { from, next } = monthBounds(month);
  const q = db?.query ? (t, p) => db.query(t, p).then(x => x.rows[0]) : one;
  const p = await q(`SELECT COALESCE(SUM(p.amount),0)::numeric AS n, COUNT(*)::int AS c FROM sale_payments p JOIN sales s ON s.id=p.sale_id WHERE s.employee_id=$1 AND p.payment_date >= $2 AND p.payment_date < $3`, [userId, from, next]);
  const r2 = await q(`SELECT COALESCE(SUM(r.amount),0)::numeric AS n FROM sale_refunds r JOIN sales s ON s.id=r.sale_id WHERE s.employee_id=$1 AND r.refund_date >= $2 AND r.refund_date < $3`, [userId, from, next]);
  const d = await q(`SELECT COUNT(*)::int AS c, COALESCE(SUM(total_amount),0)::numeric AS n FROM sales WHERE employee_id=$1 AND sale_date >= $2 AND sale_date < $3`, [userId, from, next]);
  return { received: p.n, payments: p.c, refunds: r2.n, net: Math.max(0, sub(p.n, r2.n)), deals: d.c, dealValue: d.n };
}

export async function termsFor(db, userId, month) {
  const q = db?.query ? (t, p) => db.query(t, p).then(x => x.rows[0]) : one;
  return q('SELECT * FROM salary_terms WHERE user_id=$1 AND effective_month <= $2 ORDER BY effective_month DESC LIMIT 1', [userId, month]);
}

/** Full salary calculation for one employee + month. Approved/Paid months use their saved snapshot. */
export async function computeMonth(db, userId, month) {
  const q = db?.query ? (t, p) => db.query(t, p).then(x => x.rows[0]) : one;
  const pm = await q('SELECT * FROM payroll_months WHERE user_id=$1 AND month=$2', [userId, month]);
  const terms = await termsFor(db, userId, month);
  const sales = await monthSales(db, userId, month);
  const status = pm?.status || 'draft';
  const locked = status === 'approved' || status === 'paid';
  const base = locked ? pm.snap_base : Number(terms?.base_salary || 0);
  const pct = locked ? pm.snap_commission_pct : Number(pm?.commission_pct ?? terms?.commission_pct ?? 0);
  const salesAmt = locked ? pm.snap_sales : sales.net;
  const comm = locked ? pm.snap_commission : commission(salesAmt, pct);
  const bonus = Number(pm?.bonus || 0);
  const deductions = Number(pm?.deductions || 0);
  const net = locked ? pm.snap_net : sub(add(base, comm, bonus), deductions);
  return {
    month, month_label: monthLabel(month), payroll_id: pm?.id || null, status, status_label: STATUS_LABEL[status],
    terms_set: Boolean(terms), effective_from: terms?.effective_month || null,
    base_salary: base, commission_pct: pct, pct_override: pm?.commission_pct != null, sales: salesAmt, live_sales: sales, commission: comm,
    bonus, deductions, adjustment_note: pm?.adjustment_note || '', net_salary: net, locked,
    slip_no: pm?.slip_no || null, approved_at: pm?.approved_at || null, paid_at: pm?.paid_at || null, payment_method: pm?.payment_method || null,
    late_sales_warning: locked && sales.net !== Number(pm.snap_sales),
  };
}

function canSee(req, userId) {
  if (req.user.id === userId || can(req.user, 'salary', 'view')) return;
  throw forbidden('You can only see your own salary.');
}

// ── Employee self-service ──
r.get('/my', ah(async (req, res) => {
  const month = req.query.month ? v.month(req.query.month) : currentMonth();
  const calc = await computeMonth(null, req.user.id, month);
  const history = await many(`SELECT id, month, status, snap_net AS net_salary, snap_sales AS sales, snap_commission AS commission, slip_no, approved_at, paid_at
                              FROM payroll_months WHERE user_id=$1 ORDER BY month DESC`, [req.user.id]);
  res.json({ calc, history: history.map(h => ({ ...h, status_label: STATUS_LABEL[h.status], month_label: monthLabel(h.month) })) });
}));

// ── Salary manager: all employees ──
r.get('/employees', requirePerm('salary', 'view'), ah(async (req, res) => {
  const month = req.query.month ? v.month(req.query.month) : currentMonth();
  const users = await many(`SELECT id, employee_code, full_name, designation, photo_file_id, role FROM users WHERE status IN ('approved','blocked') ORDER BY employee_code`);
  const rows = await Promise.all(users.map(async u => ({ ...u, ...(await computeMonth(null, u.id, month)) })));
  const totals = {
    employees: rows.length,
    sales: sum(rows, 'sales'), commission: sum(rows, 'commission'), net: sum(rows, 'net_salary'),
    approved: sum(rows.filter(x => x.status === 'approved' || x.status === 'paid'), 'net_salary'),
    paid: sum(rows.filter(x => x.status === 'paid'), 'net_salary'),
    pending: rows.filter(x => x.status === 'draft' || x.status === 'in_process').length,
  };
  res.json({ month, month_label: monthLabel(month), rows, totals });
}));

r.get('/employees/:id', ah(async (req, res) => {
  const id = v.id(req.params.id);
  canSee(req, id);
  const u = await one(`SELECT id, employee_code, full_name, father_name, email, phone1, phone2, designation, photo_file_id, role, status, created_at, approved_at FROM users WHERE id=$1`, [id]);
  if (!u) throw notFound('Employee not found.');
  const month = req.query.month ? v.month(req.query.month) : currentMonth();
  const period = ['week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'month';
  const calc = await computeMonth(null, id, month);
  const terms = await many('SELECT effective_month, base_salary, commission_pct, updated_at FROM salary_terms WHERE user_id=$1 ORDER BY effective_month DESC', [id]);
  const history = await many(`SELECT id, month, status, bonus, deductions, snap_base, snap_sales, snap_commission_pct, snap_commission, snap_net, slip_no, approved_at, paid_at FROM payroll_months WHERE user_id=$1 ORDER BY month DESC`, [id]);

  // Sales series (received money − refunds) for week / month / year views
  const spec = {
    week: { trunc: 'week', count: 12, step: '1 week', fmt: 'IYYY-"W"IW' },
    month: { trunc: 'month', count: 12, step: '1 month', fmt: 'YYYY-MM' },
    year: { trunc: 'year', count: 5, step: '1 year', fmt: 'YYYY' },
  }[period];
  const series = await many(`
    WITH b AS (SELECT generate_series(date_trunc('${spec.trunc}', CURRENT_DATE) - interval '${spec.step}' * ${spec.count - 1}, date_trunc('${spec.trunc}', CURRENT_DATE), interval '${spec.step}')::date AS start)
    SELECT to_char(b.start, '${spec.fmt}') AS label, b.start,
      COALESCE((SELECT SUM(p.amount) FROM sale_payments p JOIN sales s ON s.id=p.sale_id WHERE s.employee_id=$1 AND date_trunc('${spec.trunc}', p.payment_date)::date=b.start),0)::numeric AS received,
      COALESCE((SELECT SUM(x.amount) FROM sale_refunds x JOIN sales s ON s.id=x.sale_id WHERE s.employee_id=$1 AND date_trunc('${spec.trunc}', x.refund_date)::date=b.start),0)::numeric AS refunds,
      COALESCE((SELECT COUNT(*) FROM sales s WHERE s.employee_id=$1 AND date_trunc('${spec.trunc}', s.sale_date)::date=b.start),0)::int AS deals
    FROM b ORDER BY b.start`, [id]);
  const { from, next } = monthBounds(month);
  const monthDeals = await many(`SELECT s.id, s.invoice_no, s.sale_date, s.package, s.total_amount, c.name AS customer_name,
      COALESCE((SELECT SUM(amount) FROM sale_payments p WHERE p.sale_id=s.id AND p.payment_date >= $2 AND p.payment_date < $3),0)::numeric AS received_in_month
    FROM sales s JOIN customers c ON c.id=s.customer_id
    WHERE s.employee_id=$1 AND (s.sale_date >= $2 AND s.sale_date < $3 OR EXISTS (SELECT 1 FROM sale_payments p WHERE p.sale_id=s.id AND p.payment_date >= $2 AND p.payment_date < $3))
    ORDER BY s.sale_date DESC`, [id, from, next]);
  res.json({
    user: u, month, calc, terms, period,
    series: series.map(s => ({ label: s.label, received: s.received, refunds: s.refunds, net: Math.max(0, sub(s.received, s.refunds)), deals: s.deals })),
    history: history.map(h => ({ ...h, status_label: STATUS_LABEL[h.status], month_label: monthLabel(h.month) })),
    deals: monthDeals,
    canEdit: can(req.user, 'salary', 'edit'), canApprove: isAdmin(req.user),
  });
}));

async function ensureEditable(db, userId, month) {
  const pm = (await db.query('SELECT * FROM payroll_months WHERE user_id=$1 AND month=$2 FOR UPDATE', [userId, month])).rows[0];
  if (pm && (pm.status === 'approved' || pm.status === 'paid')) throw bad(`Salary for ${monthLabel(month)} is already ${STATUS_LABEL[pm.status]}. Admin must re-open it before changes.`);
  if (pm) return pm;
  return (await db.query(`INSERT INTO payroll_months(user_id,month) VALUES ($1,$2) ON CONFLICT (user_id,month) DO UPDATE SET updated_at=NOW() RETURNING *`, [userId, month])).rows[0];
}

async function employee(id) {
  const u = await one(`SELECT id, full_name, email, employee_code, status FROM users WHERE id=$1`, [v.id(id)]);
  if (!u) throw notFound('Employee not found.');
  return u;
}

// Base salary + default commission % (carries forward from effective month)
r.put('/employees/:id/terms', requirePerm('salary', 'edit'), ah(async (req, res) => {
  const u = await employee(req.params.id);
  const effective = v.month(req.body.effective_month, 'Effective month');
  const base = v.amount(req.body.base_salary, 'Base salary', { allowZero: true });
  const pct = v.percent(req.body.commission_pct ?? 0, 'Commission %');
  await tx(async db => {
    const locked = (await db.query(`SELECT 1 FROM payroll_months WHERE user_id=$1 AND month=$2 AND status IN ('approved','paid')`, [u.id, effective])).rows[0];
    if (locked) throw bad(`Salary for ${monthLabel(effective)} is already approved. Choose the next month as effective month.`);
    await db.query(`INSERT INTO salary_terms(user_id,effective_month,base_salary,commission_pct,updated_by) VALUES ($1,$2,$3,$4,$5)
                    ON CONFLICT (user_id,effective_month) DO UPDATE SET base_salary=EXCLUDED.base_salary, commission_pct=EXCLUDED.commission_pct, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
      [u.id, effective, base, pct, req.user.id]);
    await audit(db, req.user, 'salary.terms', 'user', u.id, { effective, base, pct });
  });
  res.json(await computeMonth(null, u.id, effective));
}));

// Commission % for one month (the "Commission" button)
r.put('/employees/:id/month/:month/commission', requirePerm('salary', 'edit'), ah(async (req, res) => {
  const u = await employee(req.params.id);
  const month = v.month(req.params.month);
  const pct = v.percent(req.body.commission_pct, 'Commission %');
  const scope = req.body.scope === 'forward' ? 'forward' : 'month';
  await tx(async db => {
    await ensureEditable(db, u.id, month);
    if (scope === 'forward') {
      const t = await termsFor(db, u.id, month);
      await db.query(`INSERT INTO salary_terms(user_id,effective_month,base_salary,commission_pct,updated_by) VALUES ($1,$2,$3,$4,$5)
                      ON CONFLICT (user_id,effective_month) DO UPDATE SET commission_pct=EXCLUDED.commission_pct, updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
        [u.id, month, t?.base_salary || 0, pct, req.user.id]);
      await db.query('UPDATE payroll_months SET commission_pct=NULL, updated_at=NOW() WHERE user_id=$1 AND month=$2', [u.id, month]);
    } else {
      await db.query('UPDATE payroll_months SET commission_pct=$1, updated_at=NOW() WHERE user_id=$2 AND month=$3', [pct, u.id, month]);
    }
    await audit(db, req.user, 'salary.commission', 'user', u.id, { month, pct, scope });
  });
  res.json(await computeMonth(null, u.id, month));
}));

// Bonus / deductions for one month
r.put('/employees/:id/month/:month/adjust', requirePerm('salary', 'edit'), ah(async (req, res) => {
  const u = await employee(req.params.id);
  const month = v.month(req.params.month);
  const bonus = v.amount(req.body.bonus ?? 0, 'Bonus', { allowZero: true });
  const deductions = v.amount(req.body.deductions ?? 0, 'Deductions', { allowZero: true });
  const note = v.text(req.body.adjustment_note, 'Note', { max: 500 });
  if ((bonus > 0 || deductions > 0) && !note) throw bad('Please write a short reason for the bonus/deduction.');
  await tx(async db => {
    await ensureEditable(db, u.id, month);
    await db.query('UPDATE payroll_months SET bonus=$1, deductions=$2, adjustment_note=$3, updated_at=NOW() WHERE user_id=$4 AND month=$5', [bonus, deductions, note, u.id, month]);
    await audit(db, req.user, 'salary.adjust', 'user', u.id, { month, bonus, deductions, note });
  });
  res.json(await computeMonth(null, u.id, month));
}));

// Status workflow: draft → in_process → approved → paid  (approve / pay / re-open are admin only)
r.post('/employees/:id/month/:month/status', requirePerm('salary', 'edit'), ah(async (req, res) => {
  const u = await employee(req.params.id);
  const month = v.month(req.params.month);
  const to = v.oneOf(req.body.status, ['draft', 'in_process', 'approved', 'paid'], 'Status');
  if (['approved', 'paid'].includes(to) && !isAdmin(req.user)) throw forbidden('Only admin can approve or mark salary as paid.');
  const result = await tx(async db => {
    let pm = (await db.query('SELECT * FROM payroll_months WHERE user_id=$1 AND month=$2 FOR UPDATE', [u.id, month])).rows[0];
    if (!pm) pm = (await db.query('INSERT INTO payroll_months(user_id,month) VALUES ($1,$2) RETURNING *', [u.id, month])).rows[0];
    const from = pm.status;
    if (from === to) throw bad(`Salary is already ${STATUS_LABEL[to]}.`);
    if (to === 'in_process' && from !== 'draft') throw bad('Only a Draft salary can be moved to In Process.');
    if (to === 'draft') {
      if (from === 'paid') throw bad('A paid salary cannot be re-opened.');
      if (from === 'approved' && !isAdmin(req.user)) throw forbidden('Only admin can re-open an approved salary.');
      await db.query(`UPDATE payroll_months SET status='draft', snap_base=NULL, snap_sales=NULL, snap_commission_pct=NULL, snap_commission=NULL, snap_net=NULL, approved_by=NULL, approved_at=NULL, updated_at=NOW() WHERE id=$1`, [pm.id]);
    }
    if (to === 'in_process') await db.query(`UPDATE payroll_months SET status='in_process', updated_at=NOW() WHERE id=$1`, [pm.id]);
    if (to === 'approved') {
      if (!['draft', 'in_process'].includes(from)) throw bad('Only Draft or In Process salary can be approved.');
      const terms = await termsFor(db, u.id, month);
      if (!terms) throw bad('Set the base salary for this employee first (Salary terms).');
      const c = await computeMonth(db, u.id, month);
      if (c.net_salary < 0) throw bad('Net salary is negative. Please correct the deductions.');
      const slip = pm.slip_no || (await db.query(`SELECT 'SLIP-' || $1 || '-' || lpad(nextval('slip_seq')::text, 5, '0') AS n`, [month.replace('-', '')])).rows[0].n;
      await db.query(`UPDATE payroll_months SET status='approved', snap_base=$1, snap_sales=$2, snap_commission_pct=$3, snap_commission=$4, snap_net=$5,
                      slip_no=$6, approved_by=$7, approved_at=NOW(), updated_at=NOW() WHERE id=$8`,
        [c.base_salary, c.sales, c.commission_pct, c.commission, c.net_salary, slip, req.user.id, pm.id]);
    }
    if (to === 'paid') {
      if (from !== 'approved') throw bad('Salary must be Approved before it can be marked Paid.');
      const method = v.oneOf(req.body.payment_method || 'Bank Transfer', METHODS, 'Payment method');
      await db.query(`UPDATE payroll_months SET status='paid', paid_by=$1, paid_at=NOW(), payment_method=$2, updated_at=NOW() WHERE id=$3`, [req.user.id, method, pm.id]);
    }
    await audit(db, req.user, 'salary.status', 'user', u.id, { month, from, to });
    return computeMonth(db, u.id, month);
  });
  if (to === 'approved' || to === 'paid') {
    sendMail(u.email, `Salary ${to === 'paid' ? 'paid' : 'approved'} — ${monthLabel(month)}`, template({
      title: `Your salary for ${monthLabel(month)} is ${to === 'paid' ? 'paid' : 'approved'}`, greeting: `Hi ${u.full_name},`,
      lines: [`Monthly sales: ${pkr(result.sales)}`, `Commission (${result.commission_pct}%): ${pkr(result.commission)}`, `Net salary: ${pkr(result.net_salary)}`, `Slip no: ${result.slip_no}`],
      action: { label: 'View salary & download slip', url: link('/my-salary') },
    }));
  }
  res.json(result);
}));

// Bulk approve (admin): every Draft / In Process salary of the month that has terms
r.post('/approve-all', requireAdmin, ah(async (req, res) => {
  const month = v.month(req.body.month);
  const users = await many(`SELECT u.id FROM users u WHERE u.status='approved' AND EXISTS (SELECT 1 FROM salary_terms t WHERE t.user_id=u.id AND t.effective_month <= $1)`, [month]);
  let approved = 0; const skipped = [];
  for (const { id } of users) {
    const c = await computeMonth(null, id, month);
    if (c.locked) continue;
    if (c.net_salary < 0) { skipped.push(id); continue; }
    await tx(async db => {
      let pm = (await db.query('SELECT * FROM payroll_months WHERE user_id=$1 AND month=$2 FOR UPDATE', [id, month])).rows[0];
      if (!pm) pm = (await db.query('INSERT INTO payroll_months(user_id,month) VALUES ($1,$2) RETURNING *', [id, month])).rows[0];
      if (!['draft', 'in_process'].includes(pm.status)) return;
      const cc = await computeMonth(db, id, month);
      const slip = pm.slip_no || (await db.query(`SELECT 'SLIP-' || $1 || '-' || lpad(nextval('slip_seq')::text, 5, '0') AS n`, [month.replace('-', '')])).rows[0].n;
      await db.query(`UPDATE payroll_months SET status='approved', snap_base=$1, snap_sales=$2, snap_commission_pct=$3, snap_commission=$4, snap_net=$5, slip_no=$6, approved_by=$7, approved_at=NOW(), updated_at=NOW() WHERE id=$8`,
        [cc.base_salary, cc.sales, cc.commission_pct, cc.commission, cc.net_salary, slip, req.user.id, pm.id]);
      await audit(db, req.user, 'salary.status', 'user', id, { month, to: 'approved', bulk: true });
      approved++;
      const u = (await db.query('SELECT email, full_name FROM users WHERE id=$1', [id])).rows[0];
      sendMail(u.email, `Salary approved — ${monthLabel(month)}`, template({ title: `Your salary for ${monthLabel(month)} is approved`, greeting: `Hi ${u.full_name},`, lines: [`Net salary: ${pkr(cc.net_salary)}`, `Slip no: ${slip}`], action: { label: 'View salary', url: link('/my-salary') } }));
    });
  }
  res.json({ approved, skipped: skipped.length });
}));

// PDF salary slip (bank-slip style)
r.get('/slip/:payrollId', ah(async (req, res) => {
  const pm = await one('SELECT * FROM payroll_months WHERE id=$1', [v.id(req.params.payrollId)]);
  if (!pm) throw notFound('Salary record not found.');
  canSee(req, pm.user_id);
  if (!['approved', 'paid'].includes(pm.status)) throw bad('A salary slip is available after the salary is approved.');
  const u = await one('SELECT employee_code, full_name, father_name, cnic, designation, email FROM users WHERE id=$1', [pm.user_id]);
  const by = pm.approved_by ? await one('SELECT full_name FROM users WHERE id=$1', [pm.approved_by]) : null;
  const sales = await monthSales(null, pm.user_id, pm.month);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Salary-Slip-${u.employee_code}-${pm.month}.pdf"`);
  payslipPdf(res, { pm, user: u, approvedBy: by?.full_name, payments: sales.payments, deals: sales.deals });
}));

export default r;
