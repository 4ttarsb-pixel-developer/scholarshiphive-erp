// Portable (Windows + Linux) test runner. Test mode prevents accidental
// mutation of local dev JSON archives and ensures deterministic empty fixtures.
const { spawnSync } = require('node:child_process');
const { readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname,'..');
const files=readdirSync(join(root,'tests')).filter(f=>f.endsWith('.test.js')).sort()
  .map(f=>join(root,'tests',f));
const result=spawnSync(process.execPath,['--test',...files],{
  cwd:root, env:{...process.env,NODE_ENV:'test',PERSISTENCE_DRIVER:'memory'},stdio:'inherit'
});
process.exit(result.status===null?1:result.status);
