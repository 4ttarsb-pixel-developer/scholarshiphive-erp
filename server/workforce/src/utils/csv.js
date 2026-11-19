'use strict';
function cell(v) {
  const s = String(v ?? '');
  // Neutralise spreadsheet formula injection.
  const safe = (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
function toCsv(rows) { return rows.map((r) => r.map(cell).join(',')).join('\r\n'); }
function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + toCsv(rows));
}
module.exports = { toCsv, sendCsv, cell };
