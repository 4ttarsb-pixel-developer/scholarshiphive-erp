// One-command setup: checks Node, creates .env with a secure secret, installs root + client packages.
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`\n✖ Node.js 22 or newer is required (you have ${process.versions.node}). Install Node 22 LTS from https://nodejs.org and run again.\n`);
  process.exit(1);
}

const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath)) {
  let text = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  text = text.replace(/^COOKIE_SECRET=.*$/m, `COOKIE_SECRET=${crypto.randomBytes(48).toString('hex')}`);
  fs.writeFileSync(envPath, text);
  console.log('✔ Created .env (with a random COOKIE_SECRET). Now edit DATABASE_URL in .env.');
} else {
  let text = fs.readFileSync(envPath, 'utf8');
  if (/^COOKIE_SECRET=\s*$/m.test(text)) {
    text = text.replace(/^COOKIE_SECRET=\s*$/m, `COOKIE_SECRET=${crypto.randomBytes(48).toString('hex')}`);
    fs.writeFileSync(envPath, text);
    console.log('✔ Added a random COOKIE_SECRET to .env');
  } else console.log('✔ .env already exists (not changed)');
}

const run = (cmd, cwd) => { console.log(`\n→ ${cmd}  (${path.relative(root, cwd) || '.'})`); execSync(cmd, { cwd, stdio: 'inherit', shell: true }); };
run('npm install --no-audit --no-fund', root);
run('npm install --no-audit --no-fund', path.join(root, 'client'));
console.log(`
✔ Packages installed.

Next steps:
  1. Put your PostgreSQL details in .env  (DATABASE_URL=...)
  2. npm run migrate       → creates / upgrades public, workforce and marketing schemas in the SAME database
  3. npm run build         → builds the website
  4. npm start             → open ${'http://localhost:4000'} and complete first-time Super Admin setup
`);
