// End-to-end API test against a real PostgreSQL test database.
// Run:  TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/scholarshiphive_erp_test npm test
// WARNING: the test database is wiped at the start. Never point it at your real database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) {
  test('API tests skipped (set TEST_DATABASE_URL to a throw-away database)', () => {});
} else {
  process.env.DATABASE_URL = TEST_DB;
  process.env.COOKIE_SECRET = 'test-secret-'.padEnd(64, 'x');
  process.env.GOOGLE_DEV_BYPASS = 'true';
  process.env.NODE_ENV = 'test';
  process.env.SMTP_USER = ''; process.env.SMTP_PASS = '';
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-erp-up-'));
  process.env.APP_URL = 'http://localhost:4000';
  process.env.TZ = 'Asia/Karachi'; // same day as the server, also late at night
  run();
}

// ── test file builders ──
function png(w = 400, h = 400) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x7f); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pdf = (tag = '') => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n% ${tag} ${Math.random()}\ntrailer<<>>\n%%EOF\n`);
const docx = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml....' + Math.random())]);

function run() {
  let request, app, db;
  const H = { 'X-Requested-With': 'ScholarshipHive' };
  const month = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  const today = (() => { const d = new Date(); return `${month}-${String(d.getDate()).padStart(2, '0')}`; })();
  const PW = 'Strong#Pw0rd'; // 12 characters (default password policy is exactly 12)
  let superAgent, empAgent, emp2Agent, empId, emp2Id, saleId, payrollId, PW_NEW;

  before(async () => {
    ({ default: request } = await import('supertest'));
    db = await import('../src/db.js');
    // Same start-up order as server/src/index.js: ERP (public) → Workforce → Marketing.
    await db.query('DROP SCHEMA IF EXISTS marketing CASCADE; DROP SCHEMA IF EXISTS workforce CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await db.migrate();
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const workforce = req('../workforce/index.cjs');
    await workforce.migrateWorkforce();
    await req('../../marketing-backend/src/db/migrate.js').migrateMarketing();
    ({ createApp: app } = await import('../src/app.js'));
    app = app();
  });
  after(async () => {
    const { createRequire } = await import('node:module');
    await createRequire(import.meta.url)('../workforce/index.cjs').closeWorkforcePool().catch(() => {});
    await db.closePool();
  });

  const verify = async (agent, email, mode = 'register') => {
    const r = await agent.post('/api/auth/google/dev-verify').set(H).send({ email, name: 'Test', mode });
    assert.equal(r.status, 200, r.text);
  };

  const registerFields = (req, o = {}) => req.set(H)
    .field('full_name', o.full_name || 'Ali Raza').field('father_name', 'Raza Khan').field('cnic', o.cnic || '35202-1234567-1')
    .field('phone1', o.phone1 || '+923001234567').field('phone2', o.phone2 || '+923011234567')
    .field('address', 'House 1, Lahore').field('permanent_address', 'Village X, Faisalabad')
    .field('password', o.password || PW).field('confirm_password', o.confirm || o.password || PW)
    .field('education', JSON.stringify([{ degree: 'BS Computer Science', institute: 'UE Faisalabad', year: '2026', grade: '3.4' }]))
    .field('document_labels', JSON.stringify(['CNIC copy']))
    .attach('photo', o.photo || png(), 'me.png').attach('cv', docx(), 'cv.docx').attach('documents', pdf('cnic'), 'cnic.pdf');

  test('fresh database needs setup; CSRF header is required', async () => {
    const b = await request(app).get('/api/auth/bootstrap');
    assert.equal(b.body.setupDone, false);
    const noHeader = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' });
    assert.equal(noHeader.status, 403);
  });

  test('first-time setup creates the single Super Admin', async () => {
    superAgent = request.agent(app);
    await verify(superAgent, 'owner@scholarshiphive.test', 'setup');
    const weak = await superAgent.post('/api/auth/setup').set(H).field('full_name', 'Owner Admin').field('password', 'short').field('confirm_password', 'short').attach('photo', png(), 'p.png');
    assert.equal(weak.status, 400);
    assert.match(weak.body.error, /12 characters/);
    const r = await superAgent.post('/api/auth/setup').set(H).field('full_name', 'Owner Admin').field('password', PW).field('confirm_password', PW).attach('photo', png(), 'p.png');
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.user.role, 'super_admin');
    const me = await superAgent.get('/api/auth/me');
    assert.equal(me.status, 200);
    const again = request.agent(app);
    const v2 = await again.post('/api/auth/google/dev-verify').set(H).send({ email: 'x@y.com', name: 'X', mode: 'setup' });
    assert.equal(v2.status, 200);
    const r2 = await again.post('/api/auth/setup').set(H).field('full_name', 'Hacker').field('password', PW).field('confirm_password', PW).attach('photo', png(), 'p.png');
    assert.equal(r2.status, 400);
  });

  test('employee registration validates everything', async () => {
    empAgent = request.agent(app);
    const noGoogle = await registerFields(empAgent.post('/api/auth/register'));
    assert.equal(noGoogle.status, 400);
    assert.match(noGoogle.body.error, /Google/);
    await verify(empAgent, 'ali@scholarshiphive.test');
    const samePhones = await registerFields(empAgent.post('/api/auth/register'), { phone2: '+923001234567' });
    assert.match(samePhones.body.error, /must be different/);
    const fakePhoto = await registerFields(empAgent.post('/api/auth/register'), { photo: Buffer.from('not really an image') });
    assert.match(fakePhoto.body.error, /not a genuine/);
    const tiny = await registerFields(empAgent.post('/api/auth/register'), { photo: png(50, 50) });
    assert.match(tiny.body.error, /resolution is too low/);
    const badCnic = await registerFields(empAgent.post('/api/auth/register'), { cnic: '123' });
    assert.match(badCnic.body.error, /CNIC/);
    const ok = await registerFields(empAgent.post('/api/auth/register'));
    assert.equal(ok.status, 201, ok.text);
    assert.match(ok.body.employee_code, /^SH-\d{4}$/);
    const login = await empAgent.post('/api/auth/login').set(H).send({ email: 'ali@scholarshiphive.test', password: PW });
    assert.equal(login.status, 403);
    assert.match(login.body.error, /waiting for admin approval/);
  });

  test('admin approves with page access; employee sees only allowed pages', async () => {
    const list = await superAgent.get('/api/users?status=pending');
    assert.equal(list.body.rows.length, 1);
    empId = list.body.rows[0].id;
    const det = await superAgent.get(`/api/users/${empId}`);
    assert.equal(det.body.documents.length, 1);
    const ap = await superAgent.post(`/api/users/${empId}/approve`).set(H).send({ designation: 'Sales Consultant', perms: { revenue: 'edit', petty_cash: 'edit' } });
    assert.equal(ap.status, 200, ap.text);
    const login = await empAgent.post('/api/auth/login').set(H).send({ email: 'ali@scholarshiphive.test', password: PW });
    assert.equal(login.status, 200, login.text);
    assert.equal(login.body.user.perms.revenue, 'edit');
    assert.equal((await empAgent.get('/api/expenses')).status, 403);
    assert.equal((await empAgent.get('/api/salary/employees')).status, 403);
    assert.equal((await empAgent.get('/api/revenue/overview')).status, 200);
    assert.equal((await empAgent.post('/api/assets').set(H).send({})).status, 403);
  });

  test('sales, payments and refunds keep balances correct', async () => {
    const bad = await empAgent.post('/api/revenue/sales').set(H).send({ customer_name: 'Sara Ahmed', package: 'Premium Package', destination: 'UK', total_amount: '100000', sale_date: today, employee_id: empId, initial_amount: '150000', payment_method: 'Cash', payment_date: today });
    assert.equal(bad.status, 400);
    const s = await empAgent.post('/api/revenue/sales').set(H).send({ customer_name: 'Sara Ahmed', customer_phone: '+923331112223', package: 'Premium Package', destination: 'UK', total_amount: '100000', sale_date: today, employee_id: empId, initial_amount: '60000', payment_method: 'Bank Transfer', payment_date: today });
    assert.equal(s.status, 201, s.text);
    assert.equal(s.body.status, 'Partially Paid');
    assert.equal(s.body.outstanding, 40000);
    saleId = s.body.id;
    const over = await empAgent.post('/api/revenue/payments').set(H).send({ sale_id: saleId, amount: '40000.01', method: 'Cash', payment_date: today });
    assert.equal(over.status, 400);
    const p = await empAgent.post('/api/revenue/payments').set(H).send({ sale_id: saleId, amount: '40000', method: 'Cash', payment_date: today });
    assert.equal(p.status, 201, p.text);
    const rf = await empAgent.post('/api/revenue/refunds').set(H).send({ sale_id: saleId, amount: '5000', refund_date: today, reason: 'Partial service cancelled' });
    assert.equal(rf.status, 201, rf.text);
    const ov = await empAgent.get('/api/revenue/overview');
    assert.equal(ov.body.kpi.gross, 100000);
    assert.equal(ov.body.kpi.collected, 100000);
    assert.equal(ov.body.kpi.refunds, 5000);
    assert.equal(ov.body.byCountry[0].name, 'UK');
    const cust = await empAgent.get('/api/revenue/customers');
    assert.equal(cust.body[0].deals, 1);
  });

  test('revenue: 5-step deal with installments, filters, mark paid, schedule, documents, targets, receipt', async () => {
    const meta = (await empAgent.get('/api/revenue/meta')).body;
    assert.equal(meta.categories.length, 5);
    assert.ok(meta.services.includes('Student Visa Processing'));
    const add = d => { const x = new Date(today + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
    const bad = await empAgent.post('/api/revenue/sales').set(H).send({ employee_id: empId, sale_date: today, revenue_category: 'Operating Revenue', service: 'Student Visa Processing', package: 'Premium Package', destination: 'Canada',
      client: { name: 'Hamza Ali', phone: '+923211112223', email: 'hamza@example.com', country: 'Pakistan' }, total_amount: '300000', initial_amount: '100000', payment_method: 'Bank Transfer', reference: 'HBL-77',
      installments: [{ due_date: add(30), amount: '100000' }, { due_date: add(60), amount: '50000' }] });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /add up/);
    const deal = await empAgent.post('/api/revenue/sales').set(H).send({ employee_id: empId, sale_date: add(-10), revenue_category: 'Operating Revenue', service: 'Other', service_other: 'Embassy appointment booking', package: 'Other', package_other: 'Gold Plus',
      destination: 'Canada', client: { name: 'Hamza Ali', phone: '+923211112223', email: 'hamza@example.com', country: 'Pakistan' }, total_amount: '300000', initial_amount: '100000', payment_method: 'Bank Transfer', reference: 'HBL-77',
      installments: [{ due_date: add(-2), amount: '100000' }, { due_date: add(60), amount: '100000' }], reminder_days: '3', reminder_channels: ['app', 'email'], notes_type: 'Referral client', notes: 'Referred by Sara' });
    assert.equal(deal.status, 201, deal.text);
    assert.equal(deal.body.service, 'Embassy appointment booking');
    assert.equal(deal.body.package, 'Gold Plus');
    assert.equal(deal.body.status, 'Overdue'); // first installment was due 2 days ago
    const id = deal.body.id;
    let det = (await empAgent.get(`/api/revenue/sales/${id}`)).body;
    assert.equal(det.installments.length, 3);
    assert.equal(det.installments[0].paid, true);
    assert.equal(det.installments[1].overdue, true);
    // filters + paging + summary
    const f = await empAgent.get(`/api/revenue/deals?status=Overdue&country=Canada&limit=5`);
    assert.equal(f.body.total, 1);
    assert.equal(f.body.rows[0].invoice_no, deal.body.invoice_no);
    const sum2 = await empAgent.get(`/api/revenue/summary?from=${add(-10)}&to=${today}&country=Canada`);
    assert.equal(sum2.status, 200, sum2.text);
    assert.equal(sum2.body.kpi.gross, 300000);
    assert.equal(sum2.body.kpi.collected, 100000);
    assert.equal(sum2.body.kpi.overdue_count, 1);
    assert.equal(sum2.body.monthly.length, 12);
    assert.equal(sum2.body.byCountry[0].name, 'Canada');
    const evil = await empAgent.get(`/api/revenue/deals?sort=${encodeURIComponent('total;DROP TABLE sales')}&q=${encodeURIComponent("' OR 1=1 --")}`);
    assert.equal(evil.status, 200);
    assert.equal(evil.body.total, 0);
    // reminders: overdue installment → notification for the staff member
    const run = await superAgent.post('/api/notifications/run-daily').set(H);
    assert.equal(run.status, 200, run.text);
    assert.ok(run.body.reminders >= 1);
    const n = await empAgent.get('/api/notifications');
    assert.ok(n.body.rows.find(x => x.kind === 'payment_overdue' && x.link.includes(String(id))));
    const again = await superAgent.post('/api/notifications/run-daily').set(H);
    assert.equal(again.body.reminders, 0, 'same stage is not repeated');
    // mark next installment paid
    const pay = await empAgent.post(`/api/revenue/sales/${id}/installments/pay`).set(H).send({ method: 'Cash' });
    assert.equal(pay.status, 200, pay.text);
    assert.equal(pay.body.status, 'Partially Paid');
    assert.equal(pay.body.paid, 200000);
    // new plan for the rest
    const sch = await empAgent.put(`/api/revenue/sales/${id}/schedule`).set(H).send({ installments: [{ due_date: today, amount: '100000' }, { due_date: today, amount: '100000' }, { due_date: add(10), amount: '50000' }, { due_date: add(40), amount: '50000' }] });
    assert.equal(sch.status, 200, sch.text);
    assert.equal(sch.body.installments.filter(i => i.paid).length, 2);
    assert.equal(sch.body.installments[0].seq, 0, 'the advance row keeps its "Advance" label');
    // edit the deal + client details
    const ed = await empAgent.put(`/api/revenue/sales/${id}`).set(H).send({ customer_name: 'Hamza Ali Khan', customer_phone: '+923211112299', customer_email: '', package: 'Premium Package', destination: 'Canada', total_amount: '300000', sale_date: add(-10), service: 'Student Visa Processing', notes: 'x' });
    assert.equal(ed.status, 200, ed.text);
    assert.equal(ed.body.customer_name, 'Hamza Ali Khan');
    assert.equal(ed.body.customer_phone, '+923211112299');
    assert.equal(ed.body.customer_email, null);
    const badName = await empAgent.put(`/api/revenue/sales/${id}`).set(H).send({ customer_name: '<script>', package: 'Premium Package', destination: 'Canada', total_amount: '300000', sale_date: add(-10) });
    assert.equal(badName.status, 400);
    const lower = await empAgent.put(`/api/revenue/sales/${id}`).set(H).send({ package: 'Premium Package', destination: 'Canada', total_amount: '1000', sale_date: add(-10) });
    assert.equal(lower.status, 400, 'total cannot go below money already received');
    // documents (one request per file)
    const doc = await empAgent.post(`/api/revenue/sales/${id}/documents`).set(H).attach('passport', pdf('passport'), 'passport.pdf');
    assert.equal(doc.status, 201, doc.text);
    assert.equal(doc.body.documents[0].doc_type, 'passport');
    const fake = await empAgent.post(`/api/revenue/sales/${id}/documents`).set(H).attach('other', Buffer.from('not a pdf'), 'x.pdf');
    assert.equal(fake.status, 400);
    // receipt PDF with QR
    const rec = await empAgent.get(`/api/revenue/sales/${id}/invoice`).buffer(true).parse((res, cb) => { const d = []; res.on('data', x => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); });
    assert.equal(rec.status, 200);
    assert.equal(rec.body.subarray(0, 5).toString(), '%PDF-');
    // cash flow (one query per period, 12 months side by side) agrees with the money received
    const cf = await superAgent.get(`/api/cashflow?from=${add(-10)}&to=${today}`);
    assert.equal(cf.status, 200, cf.text);
    assert.equal(cf.body.monthly.length, 12);
    assert.ok(cf.body.period.revenue.collected >= 200000);
    // targets
    assert.equal((await empAgent.put('/api/revenue/targets').set(H).send({ company_target: '1000000' })).status, 403);
    const tg = await superAgent.put('/api/revenue/targets').set(H).send({ company_target: '1000000', staff: [{ id: empId, target: '500000' }] });
    assert.equal(tg.status, 200, tg.text);
    assert.equal(tg.body.company.target, 1000000);
    assert.ok(tg.body.staff.find(x => x.id === empId && x.target === 500000));
    // a refunded/closed deal is removed so the rest of the suite sees the old numbers
    assert.equal((await empAgent.delete(`/api/revenue/sales/${id}`).set(H)).status, 200);
  });

  test('salary: terms, commission %, approval snapshot, slip', async () => {
    const t = await superAgent.put(`/api/salary/employees/${empId}/terms`).set(H).send({ effective_month: month, base_salary: '50000', commission_pct: '10' });
    assert.equal(t.status, 200, t.text);
    assert.equal(t.body.sales, 95000);           // 100000 received − 5000 refund
    assert.equal(t.body.commission, 9500);
    assert.equal(t.body.net_salary, 59500);
    const c = await superAgent.put(`/api/salary/employees/${empId}/month/${month}/commission`).set(H).send({ commission_pct: '16', scope: 'month' });
    assert.equal(c.body.commission, 15200);
    const adj = await superAgent.put(`/api/salary/employees/${empId}/month/${month}/adjust`).set(H).send({ bonus: '1000', deductions: '500', adjustment_note: 'Target bonus / late' });
    assert.equal(adj.body.net_salary, 50000 + 15200 + 1000 - 500);
    const mine = await empAgent.get('/api/salary/my');
    assert.equal(mine.body.calc.status, 'draft');
    assert.equal(mine.body.calc.net_salary, 65700);
    const ap = await superAgent.post(`/api/salary/employees/${empId}/month/${month}/status`).set(H).send({ status: 'approved' });
    assert.equal(ap.status, 200, ap.text);
    assert.equal(ap.body.status, 'approved');
    payrollId = ap.body.payroll_id;
    // a later sale must NOT change the approved salary
    await empAgent.post('/api/revenue/sales').set(H).send({ customer_name: 'Late Client', package: 'Standard Package', destination: 'Canada', total_amount: '20000', sale_date: today, employee_id: empId, initial_amount: '20000', payment_method: 'Cash', payment_date: today });
    const after = await empAgent.get('/api/salary/my');
    assert.equal(after.body.calc.net_salary, 65700);
    const locked = await superAgent.put(`/api/salary/employees/${empId}/month/${month}/adjust`).set(H).send({ bonus: '5', adjustment_note: 'x' });
    assert.equal(locked.status, 400);
    const slip = await empAgent.get(`/api/salary/slip/${payrollId}`).buffer(true).parse((res, cb) => { const d = []; res.on('data', x => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); });
    assert.equal(slip.status, 200);
    assert.equal(slip.body.subarray(0, 5).toString(), '%PDF-');
    const paid = await superAgent.post(`/api/salary/employees/${empId}/month/${month}/status`).set(H).send({ status: 'paid', payment_method: 'Bank Transfer' });
    assert.equal(paid.body.status, 'paid');
  });

  test('expenses + petty cash are connected (top-up adds, purchase subtracts)', async () => {
    const base = req => req.set(H).field('expense_type', 'variable').field('category', 'Office Supplies & Equipment').field('sub_category', 'Printer Toner & Ink').field('expense_date', today).field('paid_to', 'Hafeez Centre');
    const noReceipt = await base(superAgent.post('/api/expenses')).field('amount', '30000');
    assert.match(noReceipt.body.error, /receipt/);
    const words = await base(superAgent.post('/api/expenses')).field('amount', '500 rupees').attach('receipt', pdf('toner'), 'toner.pdf');
    assert.match(words.body.error, /must be a number/);
    const toner = await base(superAgent.post('/api/expenses')).field('amount', '30000').attach('receipt', pdf('toner'), 'toner.pdf');
    assert.equal(toner.status, 201, toner.text);
    assert.equal(toner.body.status, 'approved');
    assert.equal(toner.body.sub_category, 'Printer Toner & Ink');
    const top = await superAgent.post('/api/petty/topups').set(H).send({ amount: '20000', expense_date: today, paid_to: 'Ali Raza', payment_method: 'Cash' });
    assert.equal(top.status, 201, top.text);
    assert.equal(top.body.balance, 20000);
    const buy = await empAgent.post('/api/petty').set(H).field('category', 'Office Refreshments & Hospitality').field('sub_category', 'Tea, Coffee & Water').field('title', 'Tea & sugar')
      .field('amount', '1500').field('entry_date', today).field('purchased_by', 'Ali Raza').attach('receipt', png(600, 800), 'bill.png');
    assert.equal(buy.status, 201, buy.text);
    assert.equal(buy.body.balance_after, 18500);
    const noReason = await empAgent.post('/api/petty').set(H).field('category', 'Local Conveyance / Daily Travel').field('sub_category', 'Rickshaw / Taxi / Ride-hailing').field('amount', '400').field('entry_date', today).field('purchased_by', 'Ali');
    assert.match(noReason.body.error, /receipt/);
    const fare = await empAgent.post('/api/petty').set(H).field('category', 'Local Conveyance / Daily Travel').field('sub_category', 'Rickshaw / Taxi / Ride-hailing').field('amount', '400').field('entry_date', today).field('purchased_by', 'Ali').field('no_receipt_reason', 'Rickshaw to HEC office');
    assert.equal(fare.status, 201, fare.text);
    const bigNoReceipt = await empAgent.post('/api/petty').set(H).field('category', 'Miscellaneous').field('sub_category', 'Emergency Purchase').field('amount', '5000').field('entry_date', today).field('purchased_by', 'Ali').field('no_receipt_reason', 'Shop had no bill book');
    assert.match(bigNoReceipt.body.error, /receipt is required/);
    const tooMuch = await empAgent.post('/api/petty').set(H).field('category', 'Others').field('sub_category_other', 'Laptop repair').field('amount', '19000').field('entry_date', today).field('purchased_by', 'Ali').attach('receipt', pdf('lap'), 'l.pdf');
    assert.equal(tooMuch.status, 400);
    assert.match(tooMuch.body.error, /Not enough petty cash/);
    const selfVerify = await empAgent.post(`/api/petty/${buy.body.id}/review`).set(H).send({ status: 'verified' });
    assert.equal(selfVerify.status, 403);
    const rej = await superAgent.post(`/api/petty/${buy.body.id}/review`).set(H).send({ status: 'rejected', note: 'Receipt unreadable' });
    assert.equal(rej.status, 200);
    const sum = await superAgent.get('/api/petty/summary');
    assert.equal(sum.body.balance, 19600);
    assert.equal(sum.body.noReceipt, 1);
    const led = await superAgent.get('/api/petty/ledger');
    assert.equal(led.status, 200, led.text);
    assert.equal(led.body.closing, 19600);
    assert.equal(led.body.rows[0].balance, 19600);
    const exp = await superAgent.get('/api/expenses/summary');
    assert.equal(exp.body.operating, 30000);
    assert.equal(exp.body.variable, 30000);
    assert.equal(exp.body.salaries, 65700);
    assert.equal(exp.body.monthly.length, 12);
    assert.equal((await empAgent.get('/api/expenses/summary')).status, 403);
  });

  test('constant expenses: recurring template → monthly cycles, Other option, approvals, paging & conflicts', async () => {
    const meta = (await superAgent.get('/api/expenses/meta')).body;
    const office = meta.categories.constant.find(c => c.name === 'Office & Utilities');
    assert.ok(office.subs.length >= 10, 'Office & Utilities has its item list');
    assert.ok(meta.categories.constant.length >= 10 && meta.categories.constant.length <= 15);
    assert.ok(meta.categories.petty.find(c => c.name === 'Office Refreshments & Hospitality'));
    const rentItem = office.subs.find(s => s.name === 'Office Rent');
    // a constant category cannot be used for a variable expense
    const wrong = await superAgent.post('/api/expenses').set(H).field('expense_type', 'variable').field('category_id', String(office.id)).field('sub_category_id', String(rentItem.id)).field('amount', '100').field('expense_date', today).field('paid_to', 'x').field('no_receipt_reason', 'testing only');
    assert.match(wrong.body.error, /does not belong/);
    const rent = await superAgent.post('/api/expenses/recurring').set(H).send({ category_id: office.id, sub_category_id: rentItem.id, amount: '85000', billing_day: '5', start_month: month, paid_to: 'Landlord', payment_method: 'Bank Transfer', location: 'Office 1' });
    assert.equal(rent.status, 201, rent.text);
    assert.equal(rent.body.status, 'approved');
    assert.equal(rent.body.generated, 1);
    assert.equal(rent.body.title, 'Office Rent');
    const cyc = await superAgent.get(`/api/expenses/cycles?month=${month}`);
    assert.equal(cyc.body.rows.length, 1);
    assert.equal(cyc.body.rows[0].status, 'pending');
    assert.equal(cyc.body.rows[0].amount, 85000);
    assert.equal(cyc.body.rows[0].expense_date, `${month}-05`);
    // generating again never duplicates
    await superAgent.get(`/api/expenses/cycles?month=${month}`);
    assert.equal((await superAgent.get(`/api/expenses/cycles?month=${month}`)).body.total, 1);
    // employee with expenses:edit adds a template → waits for approval
    await superAgent.put(`/api/users/${empId}/permissions`).set(H).send({ perms: { revenue: 'edit', petty_cash: 'edit', expenses: 'edit' } });
    const sw = meta.categories.constant.find(c => c.name === 'Software & Tech Subscriptions');
    const crm = await empAgent.post('/api/expenses/recurring').set(H).send({ category_id: sw.id, sub_category_id: sw.subs.find(s => s.name === 'CRM Software').id, amount: '12000', frequency: 'monthly', billing_day: '1', start_month: month, paid_to: 'Zoho', auto_approve: true, location: 'Office 2' });
    assert.equal(crm.status, 201, crm.text);
    assert.equal(crm.body.status, 'pending');
    assert.equal(crm.body.auto_approve, false, 'only approvers can switch on auto-approve');
    const notApprover = await empAgent.post(`/api/expenses/recurring/${crm.body.id}/review`).set(H).send({ status: 'approved' });
    assert.equal(notApprover.status, 403);
    const q = await superAgent.get('/api/expenses/approvals');
    assert.equal(q.body.templates.length, 1);
    assert.equal(q.body.cycles.length, 1);
    const ok = await superAgent.post(`/api/expenses/recurring/${crm.body.id}/review`).set(H).send({ status: 'approved' });
    assert.equal(ok.body.generated, 1);
    // "Other" → custom name, optionally saved as a new option
    const other = await empAgent.post('/api/expenses').set(H).field('expense_type', 'variable').field('category', 'Courier & Documentation').field('sub_category_id', 'other')
      .field('sub_category_other', 'Visa photo printing').field('save_option', 'true').field('amount', '800').field('expense_date', today).field('paid_to', 'Photo studio').attach('receipt', pdf('photo'), 'p.pdf');
    assert.equal(other.status, 201, other.text);
    assert.equal(other.body.status, 'pending');
    const meta2 = (await superAgent.get('/api/expenses/meta')).body;
    assert.ok(meta2.categories.variable.find(c => c.name === 'Courier & Documentation').subs.find(s => s.name === 'Visa photo printing'));
    // optimistic locking
    const stale = await empAgent.put(`/api/expenses/${other.body.id}`).set(H).field('version', '99').field('category', 'Courier & Documentation').field('sub_category', 'Visa photo printing').field('amount', '900').field('expense_date', today).field('paid_to', 'Photo studio');
    assert.equal(stale.status, 409);
    const fresh = await empAgent.put(`/api/expenses/${other.body.id}`).set(H).field('version', String(other.body.version)).field('category', 'Courier & Documentation').field('sub_category', 'Visa photo printing').field('amount', '900').field('expense_date', today).field('paid_to', 'Photo studio');
    assert.equal(fresh.status, 200, fresh.text);
    assert.equal(fresh.body.amount, 900);
    const hist = await superAgent.get(`/api/expenses/${other.body.id}`);
    assert.ok(hist.body.history.find(h => h.action === 'expense.update' && h.details.changes.amount));
    // bulk approve the month's constant cycles + the custom expense
    const cycles = (await superAgent.get(`/api/expenses/cycles?month=${month}&status=pending`)).body.rows;
    assert.equal(cycles.length, 2);
    const bulk = await superAgent.post('/api/expenses/review/bulk').set(H).send({ ids: [...cycles.map(c => c.id), other.body.id], status: 'approved' });
    assert.equal(bulk.body.updated, 3, bulk.text);
    const s2 = await superAgent.get('/api/expenses/summary');
    assert.equal(s2.body.constant, 97000);
    assert.equal(s2.body.variable, 30900);
    assert.equal(s2.body.recurring.active, 2);
    // future cycle: different amount next month, skip the one after
    const next = month.slice(0, 4) * 12 + Number(month.slice(5)) ; const nm = `${Math.floor(next / 12)}-${String(next % 12 + 1).padStart(2, '0')}`;
    const ov = await superAgent.post(`/api/expenses/recurring/${rent.body.id}/override`).set(H).send({ month: nm, action: 'amount', amount: '90000', note: 'Rent increase' });
    assert.equal(ov.status, 200, ov.text);
    const up = await superAgent.get('/api/expenses/recurring/upcoming?months=3');
    assert.equal(up.body.months[1].items.find(i => i.recurring_id === rent.body.id).amount, 90000);
    // server-side paging, sorting and injection-proof sort keys
    const p1 = await superAgent.get('/api/expenses?limit=1&sort=amount&dir=asc');
    assert.equal(p1.body.rows.length, 1);
    assert.ok(p1.body.total >= 3 && p1.body.pages >= 3);
    assert.equal(p1.body.rows[0].amount, 900);
    const evil = await superAgent.get(`/api/expenses?sort=${encodeURIComponent('amount;DROP TABLE users')}&dir=asc`);
    assert.equal(evil.status, 200);
    assert.equal(evil.body.sort, 'date');
    const like = await superAgent.get(`/api/expenses?q=${encodeURIComponent("%' OR 1=1 --")}`);
    assert.equal(like.body.total, 0);
    const tab = await superAgent.get('/api/expenses/analytics?type=variable');
    assert.equal(tab.status, 200, tab.text);
    assert.ok(tab.body.byCategory.length >= 2);
    const users = await superAgent.get('/api/users?limit=1&sort=name&dir=asc');
    assert.equal(users.body.rows.length, 1);
    assert.ok(users.body.total >= 2);
    assert.equal(users.body.counts.admins, 1);
    // pausing removes future pending cycles, ending closes the template
    const st = await superAgent.post(`/api/expenses/recurring/${crm.body.id}/state`).set(H).send({ state: 'paused' });
    assert.equal(st.status, 200, st.text);
    const del = await superAgent.delete(`/api/expenses/recurring/${rent.body.id}`).set(H);
    assert.equal(del.status, 400); // has an approved cycle → End instead
    const end = await superAgent.post(`/api/expenses/recurring/${rent.body.id}/state`).set(H).send({ state: 'ended' });
    assert.equal(end.status, 200);
    // CSV / PDF exports follow the filters
    const csv = await superAgent.get(`/api/export/constant-cycles?format=csv&month=${month}`);
    assert.equal(csv.status, 200);
    assert.match(csv.text, /TOTAL \(2\)/);
    assert.match(csv.text, /Office Rent/);
    await superAgent.put(`/api/users/${empId}/permissions`).set(H).send({ perms: { revenue: 'edit', petty_cash: 'edit' } });
  });

  test('managers with "Expense Approvals" can approve others but never their own entries', async () => {
    const ag = request.agent(app);
    await verify(ag, 'manager@scholarshiphive.test');
    const reg = await registerFields(ag.post('/api/auth/register'), { full_name: 'Sana Manager', cnic: '35202-7654321-8', phone1: '+923211234567', phone2: '+923221234567' });
    assert.equal(reg.status, 201, reg.text);
    const u = (await superAgent.get('/api/users?status=pending&q=manager')).body.rows[0];
    await superAgent.post(`/api/users/${u.id}/approve`).set(H).send({ perms: { expenses: 'edit', expense_approve: 'edit', petty_cash: 'view' } });
    await ag.post('/api/auth/login').set(H).send({ email: 'manager@scholarshiphive.test', password: PW });
    const mine = await ag.post('/api/expenses').set(H).field('category', 'Marketing & Lead Generation').field('sub_category', 'Seminars & Workshops').field('amount', '15000').field('expense_date', today).field('paid_to', 'PC Hotel').attach('receipt', pdf('seminar'), 's.pdf');
    assert.equal(mine.status, 201, mine.text);
    assert.equal(mine.body.status, 'pending');
    const self = await ag.post(`/api/expenses/${mine.body.id}/review`).set(H).send({ status: 'approved' });
    assert.equal(self.status, 403);
    const q = await ag.get('/api/expenses/approvals');
    assert.equal(q.status, 200);
    assert.ok(!q.body.variable.find(x => x.id === mine.body.id), 'own entry hidden from own queue');
    const fare = (await superAgent.get('/api/petty?status=pending')).body.rows[0];
    const ok = await ag.post(`/api/petty/${fare.id}/review`).set(H).send({ status: 'verified' });
    assert.equal(ok.status, 200, ok.text);
    const bulk = await ag.post('/api/expenses/review/bulk').set(H).send({ ids: [mine.body.id], status: 'approved' });
    assert.equal(bulk.body.updated, 0);
    assert.match(bulk.body.skipped[0].reason, /own entry/);
    assert.equal((await superAgent.post(`/api/expenses/${mine.body.id}/review`).set(H).send({ status: 'rejected' })).status, 400); // reason required
    assert.equal((await superAgent.post(`/api/expenses/${mine.body.id}/review`).set(H).send({ status: 'rejected', note: 'Duplicate of last week' })).status, 200);
  });

  test('liabilities (compound loan) flow into expenses and cash flow', async () => {
    const l = await superAgent.post('/api/liabilities').set(H).send({ title: 'Bank loan', type: 'loan', lender: 'HBL', principal: '120000', interest_type: 'compound', annual_rate: '12', compounding: 'monthly', start_date: today, term_months: '12' });
    assert.equal(l.status, 201, l.text);
    assert.ok(l.body.total_payable > 120000 && l.body.total_payable < 130000);
    const p = await superAgent.post(`/api/liabilities/${l.body.id}/payments`).set(H).send({ amount: String(l.body.installment), payment_date: today, method: 'Bank Transfer' });
    assert.equal(p.status, 201, p.text);
    const loans = await superAgent.get('/api/expenses/loans');
    assert.equal(loans.body.rows.length, 1);
    assert.ok(loans.body.paidInRange > 0);
    const a = await superAgent.post('/api/assets').set(H).send({ name: 'Office laptops', category: 'Computers & IT', asset_type: 'fixed', purchase_date: today, cost: '300000', current_value: '280000' });
    assert.equal(a.status, 201, a.text);
    const cf = await superAgent.get('/api/cashflow');
    assert.equal(cf.status, 200, cf.text);
    assert.equal(cf.body.period.revenue.net, 115000);
    assert.equal(cf.body.position.assets, 280000);
    assert.equal(cf.body.monthly.length, 12);
  });

  test('v4: password policy (min / max length) is enforced and admin-configurable', async () => {
    const pol = await request(app).get('/api/security/password-policy');
    assert.equal(pol.body.min, 12); assert.equal(pol.body.max, 12);
    const boot = await request(app).get('/api/auth/bootstrap');
    assert.deepEqual(boot.body.passwordPolicy, { min: 12, max: 12 });
    const tooLong = await superAgent.put('/api/auth/password').set(H).send({ current_password: PW, new_password: 'Strong#Pw0rd99', confirm_password: 'Strong#Pw0rd99' });
    assert.equal(tooLong.status, 400); assert.match(tooLong.body.error, /exactly 12/);
    assert.equal((await empAgent.put('/api/security/password-policy').set(H).send({ min: 8, max: 20 })).status, 403);
    assert.equal((await superAgent.put('/api/security/password-policy').set(H).send({ min: 14, max: 12 })).status, 400);
    const set = await superAgent.put('/api/security/password-policy').set(H).send({ min: 12, max: 64 });
    assert.equal(set.status, 200, set.text);
    assert.equal((await request(app).get('/api/security/password-policy')).body.max, 64);
    await superAgent.put('/api/security/password-policy').set(H).send({ min: 12, max: 12 });
  });

  test('v4: forms & fields — master → sub options, custom fields, safe delete', async () => {
    const list = await superAgent.get('/api/forms');
    assert.equal(list.status, 200);
    assert.ok(list.body.forms.some(f => f.key === 'assets'));
    assert.equal((await empAgent.get('/api/forms')).status, 403);
    const def = await empAgent.get('/api/forms/assets');
    assert.equal(def.status, 200);
    assert.equal(def.body.lists.liquidity.options.length, 3);
    const high = def.body.lists.liquidity.options.find(o => o.value === 'high');
    const cats = def.body.lists.category.options.filter(o => o.parent_option_id === high.id).map(o => o.value);
    assert.ok(cats.includes('Bank Account') && cats.includes('Cash in Hand'));
    // add a category under High and a sub item under it
    const catField = def.body.lists.category;
    const c = await superAgent.post(`/api/forms/fields/${catField.id}/options`).set(H).send({ label: 'Crypto Wallet', parent_option_id: high.id });
    assert.equal(c.status, 201, c.text);
    assert.equal(c.body.meta.asset_type, 'current');
    const dup = await superAgent.post(`/api/forms/fields/${catField.id}/options`).set(H).send({ label: 'crypto wallet', parent_option_id: high.id });
    assert.equal(dup.status, 400);
    assert.equal((await superAgent.post(`/api/forms/fields/${def.body.lists.liquidity.id}/options`).set(H).send({ label: 'Super liquid' })).status, 400);
    const subField = def.body.lists.sub_category;
    assert.equal((await superAgent.post(`/api/forms/fields/${subField.id}/options`).set(H).send({ label: 'Binance' })).status, 400, 'parent required');
    assert.equal((await superAgent.post(`/api/forms/fields/${subField.id}/options`).set(H).send({ label: 'Binance', parent_option_id: c.body.id })).status, 201);
    // custom fields
    const bad = await superAgent.post('/api/forms/assets/fields').set(H).send({ label: 'Insurance company', input_type: 'select' });
    assert.equal(bad.status, 400, 'dropdown needs options');
    const f1 = await superAgent.post('/api/forms/assets/fields').set(H).send({ label: 'Insurance company', input_type: 'select', options: ['EFU', 'Jubilee'], required: true });
    assert.equal(f1.status, 201, f1.text);
    assert.match(f1.body.field_key, /^x_/);
    const f2 = await superAgent.post('/api/forms/assets/fields').set(H).send({ label: 'Insured until', input_type: 'date' });
    assert.equal(f2.status, 201);
    const today = new Date().toISOString().slice(0, 10);
    const base = { name: 'Meezan current account', liquidity: 'high', category: 'Bank Account', sub_category: 'Current account', purchase_date: today, cost: '500000' };
    const missing = await superAgent.post('/api/assets').set(H).send(base);
    assert.equal(missing.status, 400); assert.match(missing.body.error, /Insurance company is required/);
    const wrongParent = await superAgent.post('/api/assets').set(H).send({ ...base, liquidity: 'low', custom_fields: { [f1.body.field_key]: 'EFU' } });
    assert.equal(wrongParent.status, 400); assert.match(wrongParent.body.error, /not in the list/);
    const badOpt = await superAgent.post('/api/assets').set(H).send({ ...base, custom_fields: { [f1.body.field_key]: 'Nope' } });
    assert.equal(badOpt.status, 400);
    const ok = await superAgent.post('/api/assets').set(H).send({ ...base, custom_fields: { [f1.body.field_key]: 'EFU', [f2.body.field_key]: today } });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.body.asset_type, 'current');
    assert.equal(ok.body.custom_fields[f1.body.field_key], 'EFU');
    // used field → delete switches it off; old record keeps its value and can still be edited
    const del = await superAgent.delete(`/api/forms/fields/${f1.body.id}`).set(H);
    assert.equal(del.body.disabled, true);
    const del2 = await superAgent.delete(`/api/forms/fields/${f2.body.id}`).set(H);
    assert.equal(del2.body.disabled, true);
    const edit = await superAgent.put(`/api/assets/${ok.body.id}`).set(H).send({ ...base, cost: '510000' });
    assert.equal(edit.status, 200, edit.text);
    const after = await superAgent.get(`/api/assets/${ok.body.id}`);
    assert.equal(after.body.custom_fields[f1.body.field_key], 'EFU', 'value kept after field was switched off');
    // custom field on another form (sales) is validated too
    const sf = await superAgent.post('/api/forms/expenses/fields').set(H).send({ label: 'Project code', input_type: 'text', max_length: 10 });
    assert.equal(sf.status, 201);
    const fresh = await superAgent.post('/api/forms/expenses/fields').set(H).send({ label: 'Unused field', input_type: 'number' });
    assert.equal((await superAgent.delete(`/api/forms/fields/${fresh.body.id}`).set(H)).body.deleted, true);
  });

  test('v4: assets by liquidity, liabilities current / non-current, capital and the accounting equation', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const y = new Date(); y.setFullYear(y.getFullYear() - 1); const lastYear = y.toISOString().slice(0, 10);
    const cash = await superAgent.post('/api/assets').set(H).send({ name: 'Office cash box', liquidity: 'high', category: 'Cash in Hand', purchase_date: today, cost: '50000' });
    assert.equal(cash.status, 201, cash.text);
    const rec = await superAgent.post('/api/assets').set(H).send({ name: 'University commission due', liquidity: 'medium', category: 'Receivable', sub_category: 'University commission receivable', purchase_date: today, cost: '150000' });
    assert.equal(rec.status, 201, rec.text);
    const fut = await superAgent.post('/api/assets').set(H).send({ name: 'Future', liquidity: 'low', category: 'Land', purchase_date: '2099-01-01', cost: '1' });
    assert.equal(fut.status, 400);
    const sold = await superAgent.post('/api/assets').set(H).send({ name: 'Old bike', liquidity: 'low', category: 'Vehicle', purchase_date: lastYear, cost: '90000', status: 'disposed', disposed_date: today, disposal_value: '60000' });
    assert.equal(sold.status, 201, sold.text);
    const reg = await superAgent.get('/api/assets?liquidity=high');
    assert.ok(reg.body.rows.every(a => a.liquidity === 'high'));
    assert.equal(reg.body.byLiquidity.length, 3);
    // liability with category → type comes from the list
    const l = await superAgent.post('/api/liabilities').set(H).send({ title: 'Supplier credit', category: 'Trade Payables', sub_category: 'Supplier payable', lender: 'Paper Mart', principal: '24000', start_date: today, term_months: '24', contact_phone: '+923001234567' });
    assert.equal(l.status, 201, l.text);
    assert.equal(l.body.type, 'payable');
    const ls = await superAgent.get('/api/liabilities?category=Trade%20Payables');
    assert.equal(ls.body.rows.length, 1);
    assert.equal(ls.body.rows[0].current_portion, 12000);
    assert.equal(ls.body.rows[0].non_current_portion, 12000);
    // capital entries by class
    const cap = await superAgent.post('/api/capital').set(H).send({ capital_class: 'equity', type: 'investment', source_type: 'Owner', party: 'Owner Admin', share_pct: '100', amount: '400000', entry_date: today, method: 'Bank Transfer' });
    assert.equal(cap.status, 201, cap.text);
    const badCap = await superAgent.post('/api/capital').set(H).send({ capital_class: 'magic', type: 'investment', party: 'X', amount: '1', entry_date: today });
    assert.equal(badCap.status, 400);
    assert.equal((await empAgent.post('/api/capital').set(H).send({ capital_class: 'equity', type: 'investment', party: 'X Y', amount: '1', entry_date: today })).status, 403);
    const edit = await superAgent.put(`/api/capital/${cap.body.id}`).set(H).send({ capital_class: 'equity', type: 'investment', source_type: 'Owner', party: 'Owner Admin', amount: '450000', entry_date: today });
    assert.equal(edit.status, 200, edit.text);
    const capList = await superAgent.get('/api/capital?class=equity');
    assert.equal(capList.body.byClass.find(c => c.id === 'equity').net, 450000);
    // balance sheet
    for (const group of ['day', 'week', 'month', 'quarter', 'year']) {
      const o = await superAgent.get(`/api/finance/overview?from=${lastYear}&to=${today}&group=${group}`);
      assert.equal(o.status, 200, o.text);
      assert.ok(o.body.series.length >= 1 && o.body.series.length <= 120, `${group}: ${o.body.series.length}`);
    }
    const o = await superAgent.get(`/api/finance/overview?from=${lastYear}&to=${today}&group=month`);
    const p = o.body.position;
    assert.equal(p.equation.balanced, true);
    assert.equal(p.equation.assets, p.assets.high + p.assets.medium + p.assets.low);
    assert.ok(Math.abs(p.equation.assets - (p.equation.liabilities + p.equation.equity)) < 0.01);
    assert.ok(p.assets.high >= 550000, 'cash + bank account');
    assert.equal(p.capital.working, Math.round((p.assets.current - p.liabilities.current) * 100) / 100);
    assert.equal(p.capital.equity, 450000);
    assert.ok(o.body.flows.assetsDisposedCount >= 1);
    const last = o.body.series[o.body.series.length - 1];
    assert.equal(last.assets, p.assets.total);
    // the sold bike was held last year but not today
    const first = o.body.series[0];
    assert.ok(first.low >= 90000);
    assert.equal((await request(app).get('/api/finance/overview')).status, 401);
    const csv = await superAgent.get('/api/export/assets?format=csv&liquidity=high');
    assert.equal(csv.status, 200);
    assert.match(csv.text, /Liquidity/);
    assert.equal((await superAgent.get('/api/export/capital?format=pdf')).status, 200);
  });

  test('v4: owner information portfolio — field picker, socials with real links, uploads', async () => {
    const empty = await empAgent.get('/api/owner');
    assert.equal(empty.status, 200);
    assert.ok(empty.body.platforms.includes('linkedin'));
    assert.equal((await empAgent.post('/api/owner/item').set(H).send({ section: 'headline', value: 'x' })).status, 403);
    assert.equal((await superAgent.post('/api/owner/item').set(H).send({ section: 'owner_name', value: 'Attar Sb' })).status, 200);
    assert.equal((await superAgent.post('/api/owner/item').set(H).send({ section: 'skills', data: { name: 'Leadership', level: 90 } })).status, 200);
    const fb = await superAgent.post('/api/owner/item').set(H).send({ section: 'socials', data: { platform: 'facebook', url: 'facebook.com/scholarshiphive' } });
    assert.equal(fb.status, 200, fb.text);
    assert.equal(fb.body.info.socials[0].url, 'https://facebook.com/scholarshiphive');
    const wrong = await superAgent.post('/api/owner/item').set(H).send({ section: 'socials', data: { platform: 'instagram', url: 'https://facebook.com/x' } });
    assert.equal(wrong.status, 400);
    const twice = await superAgent.post('/api/owner/item').set(H).send({ section: 'socials', data: { platform: 'facebook', url: 'https://fb.com/y' } });
    assert.equal(twice.status, 400);
    const wa = await superAgent.post('/api/owner/item').set(H).send({ section: 'socials', data: { platform: 'whatsapp', url: '+92 300 1234567' } });
    assert.equal(wa.body.info.socials[1].url, 'https://wa.me/923001234567');
    const up = await superAgent.post('/api/owner/upload').set(H).field('kind', 'photo').attach('file', png(500, 500), 'me.png');
    assert.equal(up.status, 201, up.text);
    assert.equal((await superAgent.post('/api/owner/item').set(H).send({ section: 'photo_file_id', value: up.body.id })).status, 200);
    assert.equal((await empAgent.get(`/api/files/${up.body.id}`)).status, 200, 'everyone can see the owner photo');
    const del = await superAgent.delete('/api/owner/item?section=skills&index=0').set(H);
    assert.equal(del.body.info.skills.length, 0);
    const full = await superAgent.get('/api/owner');
    const save = await superAgent.put('/api/owner').set(H).send({ ...full.body.info, headline: 'Founder & CEO', experience: [{ period: '2020 – now', title: 'CEO', org: 'ScholarshipHive' }] });
    assert.equal(save.status, 200, save.text);
    assert.equal(save.body.info.socials.length, 2);
  });

  test('announcements and replies', async () => {
    const a = await superAgent.post('/api/announcements').set(H).send({ title: 'Office closed Friday', body: 'Office remains closed.', link_url: 'https://scholarshiphive.com' });
    assert.equal(a.status, 201, a.text);
    const bad = await empAgent.post('/api/announcements').set(H).send({ title: 'Hi', body: 'x' });
    assert.equal(bad.status, 403);
    const rep = await empAgent.post(`/api/announcements/${a.body.id}/replies`).set(H).send({ body: 'Noted, thanks!' });
    assert.equal(rep.status, 201);
    const list = await empAgent.get('/api/announcements');
    assert.equal(list.body.unread, 1);
  });

  test('v5: budget allotment → employee "My Budget" (only own entries, balance, limits), close takes access back', async () => {
    const next = (() => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();
    const meta = (await superAgent.get('/api/expenses/meta')).body;
    const courier = meta.categories.variable.find(c => c.name === 'Courier & Documentation');
    const mkt = meta.categories.variable.find(c => c.name === 'Marketing & Lead Generation');
    // employee without Cash Flow access cannot open the cash flow tools or allot money
    assert.equal((await empAgent.get('/api/cashflow/forecast')).status, 403);
    assert.equal((await empAgent.post('/api/cashflow/budgets/allot').set(H).send({ user_id: empId, amount: '1000' })).status, 403);
    // no budget yet
    assert.equal((await empAgent.get('/api/budgets/me')).body.wallet, null);
    assert.equal((await empAgent.post('/api/budgets/me/expenses').set(H).field('category_id', String(courier.id)).field('sub_category_id', String(courier.subs[0].id)).field('amount', '100').field('expense_date', today).field('paid_to', 'TCS').field('no_receipt_reason', 'counter slip lost')).status, 403);
    // admin allots PKR 10,000
    const a = await superAgent.post('/api/cashflow/budgets/allot').set(H).send({ target: 'employee', user_id: empId, amount: '10000', purpose: 'Document attestation runs', payment_method: 'Cash' });
    assert.equal(a.status, 201, a.text);
    assert.equal(a.body.status, 'approved');
    assert.equal(a.body.balance, 10000);
    const me = (await empAgent.get('/api/auth/me')).body.user;
    assert.equal(me.budget.active, true);
    assert.equal((await empAgent.get('/api/expenses')).status, 403, 'budget is NOT full Expenses access');
    const mine = (await empAgent.get('/api/budgets/me')).body;
    assert.equal(mine.balance.balance, 10000);
    assert.ok(mine.categories.length >= 5);
    const add = (amount, cat = courier) => empAgent.post('/api/budgets/me/expenses').set(H).field('category_id', String(cat.id)).field('sub_category_id', String(cat.subs[0].id))
      .field('amount', amount).field('expense_date', today).field('paid_to', 'TCS Gulberg').attach('receipt', pdf('tcs' + amount), 'tcs.pdf');
    const tooBig = await add('12000');
    assert.equal(tooBig.status, 400);
    assert.match(tooBig.body.error, /Not enough budget/);
    const e1 = await add('3000');
    assert.equal(e1.status, 201, e1.text);
    assert.equal(e1.body.status, 'pending');
    assert.equal(e1.body.balance_after, 7000);
    assert.equal(e1.body.budget_holder_id, empId);
    // only own budget entries are listed — other employees' expenses never show
    const list = (await empAgent.get('/api/budgets/me/expenses')).body;
    assert.equal(list.total, 1);
    assert.ok(list.rows.every(r => r.budget_holder_id === empId));
    // limits set by admin: max per expense, allowed categories
    assert.equal((await superAgent.put(`/api/cashflow/budgets/${empId}`).set(H).send({ max_entry: '2000', category_ids: JSON.stringify([courier.id]) })).status, 200);
    assert.match((await add('2500')).body.error, /at most/);
    assert.match((await add('500', mkt)).body.error, /categories admin chose/);
    const e2 = await add('1500');
    assert.equal(e2.status, 201, e2.text);
    // visible to approvers like any other expense; approve one, reject the other → money returns
    const q = (await superAgent.get('/api/expenses/approvals')).body;
    assert.ok(q.variable.find(x => x.id === e1.body.id && x.budget_holder_name));
    const ap = await superAgent.post('/api/cashflow/control/bulk').set(H).send({ ids: [e1.body.id], action: 'approve' });
    assert.equal(ap.body.updated, 1, ap.text);
    assert.equal((await superAgent.post('/api/cashflow/control/bulk').set(H).send({ ids: [e2.body.id], action: 'reject', note: 'Wrong slip' })).body.updated, 1);
    const w = (await superAgent.get(`/api/cashflow/budgets/${empId}`)).body;
    assert.equal(w.wallet.balance, 7000);
    assert.ok(w.ledger.length >= 2);
    // partial return, then close → the rest is recorded as returned and access ends
    assert.equal((await superAgent.post(`/api/cashflow/budgets/${empId}/return`).set(H).send({ amount: '8000' })).status, 400);
    assert.equal((await superAgent.post(`/api/cashflow/budgets/${empId}/return`).set(H).send({ amount: '2000', note: 'Cash back' })).body.balance, 5000);
    const close = await superAgent.post(`/api/cashflow/budgets/${empId}/close`).set(H).send({ note: 'Task finished' });
    assert.equal(close.status, 200, close.text);
    assert.equal(close.body.returned.amount, 5000);
    assert.equal((await empAgent.get('/api/auth/me')).body.user.budget.active, false);
    assert.equal((await add('100')).status, 403);
    const sum = (await superAgent.get('/api/cashflow/budgets')).body;
    assert.equal(sum.totals.balance, 0);
    assert.equal(sum.wallets[0].state, 'closed');
    // petty cash top-ups now come from the same screen
    const before = (await superAgent.get('/api/petty/summary')).body.balance;
    const top = await superAgent.post('/api/cashflow/budgets/allot').set(H).send({ target: 'petty', amount: '5000', paid_to: 'Ali Raza' });
    assert.equal(top.status, 201, top.text);
    assert.equal(top.body.balance, before + 5000);
    const entries = (await superAgent.get('/api/cashflow/budgets/entries?kind=petty')).body;
    assert.ok(entries.rows.find(r => r.ref_no === top.body.ref_no));
    assert.ok((await superAgent.get('/api/cashflow/budgets/entries')).body.total >= 4);
    // employee search: CNIC (any format), budget state, access
    assert.ok((await superAgent.get('/api/users?field=cnic&q=352021234567')).body.rows.find(r => r.id === empId));
    assert.ok((await superAgent.get('/api/users?budget=closed')).body.rows.find(r => r.id === empId));
    assert.ok((await superAgent.get('/api/users?module=expense_approve')).body.rows.find(r => r.email === 'manager@scholarshiphive.test'));
    assert.equal((await superAgent.get('/api/users?field=code&q=ZZ-NOPE')).body.total, 0);
    assert.equal((await superAgent.get(`/api/users/${empId}`)).body.budget.state, 'closed');
    void next;
  });

  test('v5: payment control (hold / release / approve all filtered), forecast, runway, timing, working capital, models, treasury', async () => {
    const next = (() => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; })();
    const meta = (await superAgent.get('/api/expenses/meta')).body;
    const office = meta.categories.constant.find(c => c.name === 'Office & Utilities');
    const rent = await superAgent.post('/api/expenses/recurring').set(H).send({ category_id: office.id, sub_category_id: office.subs.find(s => s.name === 'Office Rent').id, title: 'Branch rent Johar Town', amount: '40000', billing_day: '20', start_month: month, paid_to: 'Landlord 2', payment_method: 'Bank Transfer', location: 'Office 3' });
    assert.equal(rent.status, 201, rent.text);
    const addD = d => { const x = new Date(today + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
    const deal = await superAgent.post('/api/revenue/sales').set(H).send({ employee_id: empId, sale_date: addD(-20), revenue_category: 'Operating Revenue', service: 'Student Visa Processing', package: 'Premium Package', destination: 'UK',
      client: { name: 'Zara Khan', phone: '+923451112223', email: 'zara@example.com', country: 'Pakistan' }, total_amount: '200000', initial_amount: '50000', payment_method: 'Cash',
      installments: [{ due_date: addD(-5), amount: '75000' }, { due_date: addD(20), amount: '75000' }] });
    assert.equal(deal.status, 201, deal.text);
    const filters = { type: 'constant', month, q: 'Branch rent' };
    const listed = (await superAgent.get(`/api/cashflow/control?type=constant&month=${month}&q=Branch%20rent`)).body;
    assert.equal(listed.total, 1);
    assert.equal(listed.rows[0].status, 'pending');
    assert.equal((await superAgent.post('/api/cashflow/control/bulk').set(H).send({ all: true, filters, action: 'hold' })).status, 400, 'reason required');
    const hold = await superAgent.post('/api/cashflow/control/bulk').set(H).send({ all: true, filters, action: 'hold', note: 'Wait for fee collections', hold_until: `${next}-05` });
    assert.equal(hold.body.updated, 1, hold.text);
    const held = (await superAgent.get(`/api/cashflow/control?type=constant&month=${month}&status=hold`)).body;
    assert.equal(held.total, 1);
    assert.equal(held.totals.held_count, 1);
    // the forecast moves the held rent to its hold date
    const f = (await superAgent.get('/api/cashflow/forecast?months=6')).body;
    assert.equal(f.months.length, 6);
    assert.equal(f.months[0].opening, f.position.cash);
    assert.ok(f.events.find(e => e.ref === listed.rows[0].ref_no && e.date === `${next}-05`), 'held rent appears on the hold date');
    for (const m of f.months) { assert.ok(Number.isFinite(m.closing)); assert.ok(['deficit', 'below_buffer', 'surplus'].includes(m.status)); }
    assert.equal(f.months[0].in.overdue, 37500, 'half of the overdue installment is expected back now');
    assert.equal(Math.round(f.months.reduce((x, m) => x + m.in.receivables, 0)), 67500, '90% of the future installment');
    assert.equal((await superAgent.post('/api/cashflow/control/bulk').set(H).send({ all: true, filters, action: 'release' })).body.updated, 1);
    const all = await superAgent.post('/api/cashflow/control/bulk').set(H).send({ all: true, filters: { type: 'constant', month, status: 'pending' }, action: 'approve' });
    assert.ok(all.body.updated >= 1, all.text);
    assert.equal((await superAgent.get(`/api/cashflow/control?type=constant&month=${month}&status=pending`)).body.total, 0);
    // settings: opening cash anchors today's cash position
    const s = await superAgent.put('/api/cashflow/settings').set(H).send({ opening_balance: '500000', opening_date: today, collection_rate: 85, seasonality: JSON.stringify([115, 95, 90, 100, 110, 125, 130, 115, 85, 90, 105, 120]) });
    assert.equal(s.status, 200, s.text);
    const pos = (await superAgent.get('/api/cashflow/position')).body;
    assert.equal(pos.basis, 'opening');
    assert.equal(pos.anchor.amount, 500000);
    // treasury: bank account + running finance line
    assert.equal((await superAgent.post('/api/cashflow/treasury').set(H).send({ name: 'Meezan current', kind: 'bank', institution: 'Meezan Bank', balance: '400000' })).status, 201);
    assert.equal((await superAgent.post('/api/cashflow/treasury').set(H).send({ name: 'RF line', kind: 'running_finance', credit_limit: '0' })).status, 400);
    assert.equal((await superAgent.post('/api/cashflow/treasury').set(H).send({ name: 'RF line', kind: 'running_finance', credit_limit: '1000000', balance: '0', interest_rate: '21' })).status, 201);
    const tr = (await superAgent.get('/api/cashflow/treasury')).body;
    assert.equal(tr.totals.bank, 400000);
    assert.equal(tr.position.credit.available, 1000000);
    assert.equal(tr.position.statements.difference, 400000 - tr.position.cash);
    // planned receipt (50% chance) shows half in next month
    assert.equal((await superAgent.post('/api/cashflow/plan').set(H).send({ direction: 'in', category: 'University commission', title: 'UK university commission', amount: '300000', start_month: next, day: '10', probability: 50 })).status, 201);
    const f2 = (await superAgent.get('/api/cashflow/forecast?months=3&scenario=worst')).body;
    assert.equal(f2.scenario.key, 'worst');
    assert.ok(f2.months[1].in.planned >= 150000);
    const rw = await superAgent.get('/api/cashflow/runway');
    assert.equal(rw.status, 200, rw.text);
    assert.equal(rw.body.history.length, 12);
    assert.ok(['safe', 'watch', 'danger', 'critical'].includes(rw.body.runway.level));
    const tm = (await superAgent.get('/api/cashflow/timing?days=60')).body;
    assert.equal(tm.daily.length, 60);
    assert.ok(tm.weekly.length >= 8);
    assert.equal(tm.history.buckets.length, 6);
    const wc = (await superAgent.get('/api/cashflow/working-capital')).body;
    assert.equal(Math.round(wc.receivables.aging.reduce((x, b) => x + b.amount, 0)), Math.round(wc.receivables.total));
    assert.equal(wc.receivables.total, 150000, 'open student fees are receivables');
    assert.equal(wc.receivables.overdue, 75000);
    assert.equal(wc.receivables.debtors[0].customer, 'Zara Khan');
    assert.ok('ccc' in wc.cycle);
    const md = (await superAgent.get('/api/cashflow/models')).body;
    assert.equal(md.daily.length, 180);
    assert.ok(md.yearlyNeed > 0);
    assert.ok(md.baumol.optimal > 0);
    // new exports
    const bin = r => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', x => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); });
    for (const ds of ['cash-forecast', 'receivables', 'budget-entries', 'payment-control']) {
      const p = await bin(superAgent.get(`/api/export/${ds}?format=pdf`));
      assert.equal(p.status, 200, ds);
      assert.equal(p.body.subarray(0, 5).toString(), '%PDF-', ds);
      assert.equal((await superAgent.get(`/api/export/${ds}?format=csv`)).status, 200, ds);
    }
  });

  test('exports produce real CSV tables and PDFs', async () => {
    const csv = await superAgent.get('/api/export/sales?format=csv');
    assert.equal(csv.status, 200);
    assert.ok(csv.text.startsWith('﻿#,Date,Invoice,Client'), csv.text.slice(0, 80));
    assert.ok(csv.text.split('\r\n').length >= 3);
    const bin = r => r.buffer(true).parse((res, cb) => { const d = []; res.on('data', x => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); });
    for (const ds of ['sales', 'salary', 'expenses', 'constant-cycles', 'variable-expenses', 'recurring', 'petty', 'petty-ledger', 'petty-topups', 'cashflow', 'assets', 'loans', 'users', 'customers', 'payments', 'refunds', 'salaries', 'capital', 'audit']) {
      const p = await bin(superAgent.get(`/api/export/${ds}?format=pdf`));
      assert.equal(p.status, 200, ds);
      assert.equal(p.body.subarray(0, 5).toString(), '%PDF-', ds);
    }
    assert.equal((await empAgent.get('/api/export/expenses?format=csv')).status, 403);
    assert.equal((await bin(empAgent.get('/api/export/my-salary?format=pdf'))).status, 200);
  });

  test('admins: maximum 3 including Super Admin', async () => {
    const ids = [];
    for (const [i, email] of ['b@x.test', 'c@x.test', 'd@x.test'].entries()) {
      const ag = request.agent(app);
      await verify(ag, email);
      const r = await registerFields(ag.post('/api/auth/register'), { full_name: 'User ' + i, cnic: `35202-123456${i}-2`, phone1: `+92300765432${i}`, phone2: `+92301765432${i}` });
      assert.equal(r.status, 201, r.text);
      const u = (await superAgent.get('/api/users?status=pending')).body.rows.find(x => x.email === email);
      await superAgent.post(`/api/users/${u.id}/approve`).set(H).send({ perms: {} });
      ids.push(u.id);
      if (i === 0) { emp2Agent = ag; emp2Id = u.id; }
    }
    assert.equal((await superAgent.post(`/api/users/${ids[0]}/make-admin`).set(H)).status, 200);
    assert.equal((await superAgent.post(`/api/users/${ids[1]}/make-admin`).set(H)).status, 200);
    const third = await superAgent.post(`/api/users/${ids[2]}/make-admin`).set(H);
    assert.equal(third.status, 400);
    assert.match(third.body.error, /Maximum 3 admins/);
    // an ordinary admin cannot touch the Super Admin
    await emp2Agent.post('/api/auth/login').set(H).send({ email: 'b@x.test', password: PW });
    const me = (await superAgent.get('/api/auth/me')).body.user;
    assert.equal((await emp2Agent.post(`/api/users/${me.id}/block`).set(H)).status, 403);
  });

  test('access requests, block, 30-minute idle logout', async () => {
    const rq = await empAgent.post('/api/requests').set(H).send({ type: 'access', module: 'expenses', level: 'view', message: 'Need to see expenses' });
    assert.equal(rq.status, 201, rq.text);
    const h = await superAgent.post(`/api/requests/${rq.body.id}/handle`).set(H).send({ decision: 'approved' });
    assert.equal(h.status, 200);
    assert.equal((await empAgent.get('/api/expenses')).status, 200);
    await db.query(`UPDATE sessions SET last_activity = NOW() - interval '31 minutes' WHERE user_id=$1`, [empId]);
    const idle = await empAgent.get('/api/expenses');
    assert.equal(idle.status, 401);
    assert.equal(idle.body.code, 'SESSION_EXPIRED');
    await empAgent.post('/api/auth/login').set(H).send({ email: 'ali@scholarshiphive.test', password: PW });
    assert.equal((await superAgent.post(`/api/users/${empId}/block`).set(H)).status, 200);
    assert.equal((await empAgent.get('/api/auth/me')).status, 401);
    const del = await superAgent.delete(`/api/users/${empId}`).set(H);
    assert.equal(del.status, 400); // has sales + paid salary → must stay (blocked)
  });

  test('forgot password: one-time link, no email enumeration, logs out everywhere; language preference', async () => {
    const unknown = await request(app).post('/api/auth/forgot').set(H).send({ email: 'nobody@nowhere.test' });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.devLink, undefined);
    const f = await request(app).post('/api/auth/forgot').set(H).send({ email: 'b@x.test' });
    assert.equal(f.status, 200);
    assert.equal(f.body.message, unknown.body.message, 'same answer for known and unknown emails');
    const token = new URL(f.body.devLink).searchParams.get('token');
    assert.equal((await request(app).get(`/api/auth/reset/check?token=${token}`)).status, 200);
    const weak = await request(app).post('/api/auth/reset').set(H).send({ token, password: 'short', confirm_password: 'short' });
    assert.equal(weak.status, 400);
    const NEW = 'Brand#New202';
    const ok = await request(app).post('/api/auth/reset').set(H).send({ token, password: NEW, confirm_password: NEW });
    assert.equal(ok.status, 200, ok.text);
    assert.equal((await request(app).post('/api/auth/reset').set(H).send({ token, password: NEW, confirm_password: NEW })).status, 400, 'link works once');
    assert.equal((await emp2Agent.get('/api/auth/me')).status, 401, 'old sessions are logged out');
    assert.equal((await emp2Agent.post('/api/auth/login').set(H).send({ email: 'b@x.test', password: PW })).status, 401);
    assert.equal((await emp2Agent.post('/api/auth/login').set(H).send({ email: 'b@x.test', password: NEW })).status, 200);
    const lang = await emp2Agent.put('/api/auth/preferences').set(H).send({ language: 'ur' });
    assert.equal(lang.body.language, 'ur');
    assert.equal((await emp2Agent.get('/api/auth/me')).body.user.language, 'ur');
    assert.equal((await emp2Agent.put('/api/auth/preferences').set(H).send({ language: 'fr' })).status, 400);
    const adminLink = await superAgent.post(`/api/users/${empId}/reset-link`).set(H);
    assert.equal(adminLink.status, 400); // empId is blocked by now
    PW_NEW = NEW;
  });

  test('Super Admin can hand over and delete own account', async () => {
    const bad = await superAgent.post('/api/users/me/delete-account').set(H).send({ password: 'wrong', successor_id: emp2Id });
    assert.equal(bad.status, 400);
    const ok = await superAgent.post('/api/users/me/delete-account').set(H).send({ password: PW, successor_id: emp2Id });
    assert.equal(ok.status, 200, ok.text);
    void PW_NEW;
    const now = await emp2Agent.get('/api/auth/me');
    assert.equal(now.body.user.role, 'super_admin');
    assert.equal((await superAgent.get('/api/auth/me')).status, 401);
  });
}
