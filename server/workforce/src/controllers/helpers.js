'use strict';
const events = require('../services/events.service');
const { clientIp } = require('../utils/request');
const { monthStart, currentMonthInTz } = require('../utils/time');
const { badRequest } = require('../utils/errors');
const config = require('../config');

/** Per-request context: client IP and an event queue flushed only after the DB commit. */
function ctx(req, extra = {}) {
  return { ip: clientIp(req), events: events.deferred(), ...extra };
}

/** Run a service call, then publish its queued change events and send JSON. */
async function run(res, c, fn, status = 200) {
  const data = await fn();
  c.events.flush();
  res.status(status).json(data === undefined ? { success: true } : data);
}

function monthParam(v) {
  if (!v) return currentMonthInTz(config.businessTimezone);
  try { return monthStart(v); } catch (_) { throw badRequest('Month must be YYYY-MM.'); }
}

function idParam(v, name = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}.`);
  return n;
}

function idList(v) {
  if (!Array.isArray(v) || !v.length) throw badRequest('Select at least one record.');
  const ids = [...new Set(v.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw badRequest('Invalid record id in selection.');
  if (ids.length > 500) throw badRequest('Too many records in one bulk action (max 500).');
  return ids;
}

module.exports = { ctx, run, monthParam, idParam, idList };
