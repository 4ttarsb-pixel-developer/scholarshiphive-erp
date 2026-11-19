'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../src/services/pg');
for (const filename of ['ad-integration.service.js', 'fx.service.js']) {
  test(`SQL month alias safely quoted in ${filename}`, () => {
    const code = fs.readFileSync(path.join(root, filename), 'utf8');
    assert.ok(code.includes('to_char(month,\'YYYY-MM\') AS "month"'));
    assert.equal(/to_char\(month,'YYYY-MM'\)\s+month\b/i.test(code), false);
  });
}
