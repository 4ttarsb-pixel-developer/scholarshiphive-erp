'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawn } = require('child_process');
const h = require('./helpers');

const PORT = 4099;
const base = `http://localhost:${PORT}`;

function startServer() {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), SERVE_FRONTEND: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    proc.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(proc); } });
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (code) => { clearTimeout(t); if (code) reject(new Error(`server exited ${code}`)); });
  });
}
const stop = (proc) => new Promise((r) => { proc.on('exit', r); proc.kill('SIGTERM'); });

test('18. data persists in PostgreSQL across a real server restart', async () => {
  await h.admin();
  const e = await h.createEmployee({ name: 'Persistence Tester', base: '55555', rate: '2' });
  let srv = await startServer();
  const loginBody = JSON.stringify({ username: 'test.admin', password: 'Admin#12345', client: 'mobile' });
  let lg = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: loginBody })).json();
  const refNo = `PERSIST-${Date.now()}`;
  const created = await fetch(`${base}/api/revenue`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lg.token}` }, body: JSON.stringify({ employeeId: e.id, saleReference: refNo, saleDate: h.today(), saleAmount: '100000', commissionMethod: 'FIXED_EMPLOYEE', verifyNow: true }) });
  assert.equal(created.status, 201);
  await stop(srv);

  srv = await startServer();
  try {
    // existing session token still valid after restart (sessions are stored in PostgreSQL)
    const sales = await (await fetch(`${base}/api/revenue?search=${refNo}`, { headers: { Authorization: `Bearer ${lg.token}` } })).json();
    assert.equal(sales.length, 1);
    assert.equal(sales[0].commissionAmount, '2000.00');
    lg = await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: loginBody })).json();
    const pay = await (await fetch(`${base}/api/payroll/${e.id}?month=${h.ym(h.currentMonth())}`, { headers: { Authorization: `Bearer ${lg.token}` } })).json();
    assert.equal(pay.commissionTotal, '2000.00');
    assert.equal(pay.baseSalary, '55555.00');
  } finally {
    await stop(srv);
  }
});
