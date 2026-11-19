// One-time secured bootstrap of a REAL Admin account in PostgreSQL.
// Never imports demo credentials. Refuses *.test / @mea.test demo identities.
//
//   ADMIN_NAME="Full Name" ADMIN_EMAIL="admin@company.com" [ADMIN_PASSWORD="..."] \
//     node scripts/bootstrap-admin.js
//
// If ADMIN_PASSWORD is omitted a strong password is generated and printed ONCE
// to this terminal (not stored anywhere). Store it in your password manager.
require('dotenv').config();
const crypto = require('node:crypto');
const { hashPassword } = require('../src/utils/password-hash');
const { passwordError } = require('../src/utils/password-policy');

function generatePassword() {
  // 24 url-safe chars + guaranteed upper/lower/digit/special to satisfy policy.
  const base = crypto.randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, '');
  return `A${base}7!`;
}

async function main() {
  if ((process.env.PERSISTENCE_DRIVER || 'memory') !== 'postgres') {
    console.error('Set PERSISTENCE_DRIVER=postgres (and run migrations) before bootstrapping an admin.');
    process.exit(1);
  }
  const name = (process.env.ADMIN_NAME || '').trim();
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  let password = process.env.ADMIN_PASSWORD;

  if (name.length < 2) { console.error('ADMIN_NAME is required (>= 2 chars).'); process.exit(1); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('ADMIN_EMAIL must be a valid email.'); process.exit(1); }
  if (/@mea\.test$|\.test$/i.test(email)) { console.error('Refusing a demo/test email. Use a real company admin email.'); process.exit(1); }

  let generated = false;
  if (!password) { password = generatePassword(); generated = true; }
  const policyError = passwordError(password);
  if (policyError) { console.error(`ADMIN_PASSWORD rejected: ${policyError}`); process.exit(1); }

  const { pool, withTransaction } = require('../src/db/pool');
  const initials = name.split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

  await withTransaction(async (client) => {
    const existing = await client.query('SELECT id, role FROM marketing.users WHERE lower(email) = $1', [email]);
    if (existing.rowCount) throw new Error(`A user with ${email} already exists (id ${existing.rows[0].id}).`);
    const u = await client.query(
      `INSERT INTO marketing.users (name, email, role, status, initials)
         VALUES ($1, $2, 'Admin', 'Active', $3) RETURNING id`,
      [name, email, initials],
    );
    await client.query(
      'INSERT INTO marketing.auth_credentials (user_id, password_hash) VALUES ($1, $2)',
      [u.rows[0].id, hashPassword(password)],
    );
  });

  console.log(`\nAdmin created: ${name} <${email}>`);
  if (generated) {
    console.log('\n================ ONE-TIME PASSWORD (store it now, it is not saved) ================');
    console.log(`  ${password}`);
    console.log('===================================================================================\n');
  } else {
    console.log('Password set from ADMIN_PASSWORD.');
  }
  await pool.end();
}

main().catch((err) => { console.error('[MEA][bootstrap-admin] error:', err.message); process.exit(1); });
