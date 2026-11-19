'use strict';
/**
 * Server-Sent Events hub. Payloads carry only identifiers ("something changed"),
 * never salary data; each client re-fetches through its own authorised API calls.
 */
const clients = new Set();
let counter = 0;

function addClient(res, user) {
  const client = { id: ++counter, res, userId: user.id };
  clients.add(client);
  return () => clients.delete(client);
}

function publish(type, data = {}) {
  const payload = `event: change\ndata: ${JSON.stringify({ type, ...data, at: new Date().toISOString() })}\n\n`;
  for (const c of clients) {
    try { c.res.write(payload); } catch (_) { clients.delete(c); }
  }
}

// Collect events raised inside a DB transaction and publish only after commit.
function deferred() {
  const queue = [];
  return {
    add(type, data) { queue.push([type, data]); },
    flush() { for (const [t, d] of queue.splice(0)) publish(t, d); },
  };
}

setInterval(() => {
  for (const c of clients) {
    try { c.res.write(': ping\n\n'); } catch (_) { clients.delete(c); }
  }
}, 25000).unref();

module.exports = { addClient, publish, deferred, clientCount: () => clients.size };
