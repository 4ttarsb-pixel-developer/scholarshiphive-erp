'use strict';
const knexFactory = require('knex');
const pg = require('pg');
const config = require('./src/config');

// Keep Workforce data isolated from ScholarshipHive's public ERP tables.
// Numeric values remain strings for Decimal.js-safe payroll calculations.
pg.types.setTypeParser(1082, (value) => value); // DATE -> YYYY-MM-DD
pg.types.setTypeParser(20, (value) => Number(value)); // BIGINT ids are within JS safe range

const timezone = String(config.businessTimezone || 'Asia/Karachi').replace(/[^A-Za-z0-9_+\-/]/g, '');
const useSsl = String(process.env.DATABASE_SSL || '').toLowerCase() === 'true';
const onVercel = Boolean(process.env.VERCEL);

const knex = knexFactory({
  client: 'pg',
  connection: {
    connectionString: config.databaseUrl,
    ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  },
  searchPath: ['workforce', 'public'],
  pool: {
    min: 0,
    max: Number(process.env.WORKFORCE_DB_POOL_MAX || (onVercel ? 2 : 4)),
    acquireTimeoutMillis: 12000,
    idleTimeoutMillis: onVercel ? 10000 : 30000,
    createTimeoutMillis: 12000,
    afterCreate(connection, done) {
      connection.query(`SET TIME ZONE '${timezone}'`, (error) => done(error, connection));
    },
  },
  migrations: {
    directory: require('path').join(__dirname, 'db', 'migrations'),
    tableName: 'knex_migrations',
    schemaName: 'workforce',
  },
});

knex.on('query-error', (error) => console.error('[workforce-db] query error:', error.message));
module.exports = knex;
