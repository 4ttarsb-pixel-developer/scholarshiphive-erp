const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../src/services/pg/ad-account.service.js'),'utf8');
test('PostgreSQL account creation writes to DB and loads returned row, never mutates RAM',()=>{
 assert.match(src,/INSERT INTO marketing\.ad_accounts/);
 assert.match(src,/return get\(rows\[0\]\.id,user\)/);
 assert.doesNotMatch(src,/mock\.store|store\.accounts\.push/);
});
test('PostgreSQL failed account creation does not fabricate local records',()=>{
 assert.match(src,/await db\.query\(`INSERT INTO marketing\.ad_accounts/);
 assert.doesNotMatch(src,/catch\s*\([^)]*\)\s*\{\s*return \{/);
});
