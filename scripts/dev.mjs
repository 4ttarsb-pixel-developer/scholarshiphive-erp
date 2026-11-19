// Development mode: API with auto-restart (port 4000) + Vite dev server with hot reload (port 5173).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const procs = [
  spawn(process.execPath, ['--watch-path=server/src', 'server/src/index.js'], { cwd: root, stdio: 'inherit' }),
  spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], { cwd: path.join(root, 'client'), stdio: 'inherit', shell: isWin }),
];
console.log('\nDev mode: open http://localhost:5173  (set APP_URL=http://localhost:5173 in .env so Google sign-in returns there)\n');
const stop = () => { for (const p of procs) { try { p.kill(); } catch { /* ignore */ } } process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach(p => p.on('exit', code => { if (code) { console.error('A dev process stopped with code', code); stop(); } }));
