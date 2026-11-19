'use strict';
/** Create or reset an Admin account:  npm run user:create-admin -- <username> <password> */
const knex = require('../src/db');
const { hashPassword } = require('../src/utils/crypto');

(async () => {
  const [username, password] = process.argv.slice(2);
  if (!username || !password || password.length < 8) throw new Error('Usage: npm run user:create-admin -- <username> <password(min 8 chars)>');
  let u = await knex('users').whereRaw('lower(username)=lower(?)', [username]).first();
  if (u) await knex('users').where({ id: u.id }).update({ password_hash: hashPassword(password), is_active: true, failed_logins: 0, locked_until: null });
  else [u] = await knex('users').insert({ username, full_name: username, password_hash: hashPassword(password), attendance_role: 'Owner', is_protected: true }).returning('*');
  const role = await knex('roles').where({ code: 'ADMIN' }).first();
  await knex('user_roles').insert({ user_id: u.id, role_id: role.id }).onConflict(['user_id', 'role_id']).ignore();
  await knex('audit_logs').insert({ actor_name: 'CLI', action: 'Admin account created/reset', entity_type: 'user', entity_id: String(u.id), detail: username });
  console.log(`[admin] "${username}" is an Admin and can sign in now.`);
})().then(() => knex.destroy()).catch((e) => { console.error(e.message); knex.destroy().then(() => process.exit(1)); });
