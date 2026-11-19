// Persistence driver selector. Services import this facade and never care which
// driver is active. Default is "memory" (no database required). Set
// PERSISTENCE_DRIVER=postgres (plus migrations/seed) to use PostgreSQL.
const driver = (process.env.PERSISTENCE_DRIVER || (process.env.NODE_ENV === 'production' ? 'postgres' : 'memory')).toLowerCase();

let impl;
if (driver === 'postgres') {
  impl = require('./postgres');
} else if (driver === 'memory') {
  impl = require('./memory');
} else {
  throw new Error(`Unknown PERSISTENCE_DRIVER "${driver}". Use "memory" or "postgres".`);
}

module.exports = impl;
