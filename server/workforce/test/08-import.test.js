'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const { importLegacy } = require('../scripts/lib/legacy-import');

const file = path.join(__dirname, '..', '..', 'legacy', 'AttendanceTestApi', 'attendance.db');
// The legacy SQLite fixture is not part of the source archive; place it at the path above to run this test.
const skip = fs.existsSync(file) ? false : `legacy fixture not present: ${path.relative(path.join(__dirname, '..', '..', '..'), file)}`;

test('legacy SQLite import: dry run changes nothing; real import is idempotent and keeps passwords working', { skip }, async () => {
  const SQL = await require('sql.js')();
  const bytes = fs.readFileSync(file);
  const before = await h.knex('users').count('* as c').first();
  const dry = await importLegacy(h.knex, new SQL.Database(bytes), { dialect: 'sqlite', sourceBytes: bytes, dryRun: true, tz: h.TZ });
  assert.ok(dry.users.created > 0);
  assert.equal((await h.knex('users').count('* as c').first()).c, before.c, 'dry run rolled back');
  const real = await importLegacy(h.knex, new SQL.Database(bytes), { dialect: 'sqlite', sourceBytes: bytes, dryRun: false, tz: h.TZ });
  assert.equal(real.sessions.imported, dry.sessions.imported);
  const open = await h.knex('attendance_sessions').where({ is_active: true, source: 'import_sqlite' }).select('user_id');
  assert.equal(new Set(open.map((o) => o.user_id)).size, open.length, 'never more than one open session per user');
  await assert.rejects(importLegacy(h.knex, new SQL.Database(bytes), { dialect: 'sqlite', sourceBytes: bytes, dryRun: false, tz: h.TZ }), /already imported/);
  // ASP.NET PBKDF2 password still works through the Flutter login (and is flagged weak)
  const ali = await h.knex('users').where({ username: 'ali', legacy_source: 'sqlite' }).first();
  assert.ok(ali);
  assert.equal(ali.must_change_password, true);
  assert.equal(ali.employee_id, null, 'imported logins are not auto-mapped by name');
  const roles = await h.knex('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', ali.id).pluck('r.code');
  assert.deepEqual(roles, ['EMPLOYEE']);
  const lg = await h.request(h.app).post('/api/auth/login').send({ username: 'ali', password: '12345', client: 'mobile' });
  assert.equal(lg.status, 200, JSON.stringify(lg.body));
  assert.equal(lg.body.user.mustChangePassword, true);
});
