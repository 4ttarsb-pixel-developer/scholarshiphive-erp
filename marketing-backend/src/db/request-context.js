// PostgreSQL-only request / worker snapshots. Never share mutable business state
// across concurrent requests. All snapshots are read from PostgreSQL and discarded
// after the request/job; memory driver continues using the original dev store.
const { AsyncLocalStorage } = require('node:async_hooks');
const storage = new AsyncLocalStorage();
function fresh() {
  return {
    users: [], accounts: [], adAccountAssignments: [], counsellors: [],
    campaignAllocations: [], attributionEvents: [],
    adHistory: { version: 1, accounts: {} },
    fx: { version: 1, rates: {}, history: [] },
  };
}
const current = () => storage.getStore();
const run = (fn) => storage.run(fresh(), fn);
module.exports = { current, run, fresh };
