'use strict';
/** Creates the database named in DATABASE_URL if it does not exist (never drops anything). */
const { Client } = require('pg');
const config = require('../src/config');

(async () => {
  const url = new URL(config.databaseUrl);
  const name = url.pathname.slice(1);
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Database name may only contain letters, numbers and underscore.');
  url.pathname = '/postgres';
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (exists.rowCount) console.log(`[db:create] Database "${name}" already exists — nothing to do.`);
  else { await c.query(`CREATE DATABASE "${name}"`); console.log(`[db:create] Created database "${name}".`); }
  await c.end();
})().catch((e) => { console.error(`[db:create] ${e.message}`); process.exit(1); });
