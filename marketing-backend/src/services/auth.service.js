// Identity + sessions.
//   memory driver  -> development demo users + in-memory sessions + dev session file
//                     (unchanged behavior; demo credentials, dev-only).
//   postgres driver-> real users/credentials/sessions in PostgreSQL. No demo seed;
//                     create the first Admin with `npm run bootstrap-admin`.
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const repo = require('../repositories');
const { HttpError } = require('../utils/http');
const { passwordError } = require('../utils/password-policy');
const { hashPassword, matches } = require('../utils/password-hash');

const DRIVER = (process.env.PERSISTENCE_DRIVER || 'memory').toLowerCase();
const IS_PG = DRIVER === 'postgres';
const SESSION_MS = 8 * 60 * 60 * 1000;

// ---- shared helpers ------------------------------------------------------
const publicUser = u => ({ id:u.id, displayNumber:u.displayNumber, name:u.name, email:u.email, role:u.role, status:u.status, initials:u.initials });
const keyFor = token => createHash('sha256').update(token).digest('hex');
const failures = new Map();
// In production the API only serves once a real persistence layer is configured.
const productionLocked = () => process.env.NODE_ENV === 'production' && !IS_PG;

// ===========================================================================
// MEMORY DRIVER (development) — preserved verbatim from the original service
// ===========================================================================
const { users } = IS_PG ? {users: []} : require('../data/mock.store');
const credentials = new Map();
const sessions = new Map();
const SESSION_FILE = process.env.MEA_DEV_SESSIONS_PATH || path.join(__dirname, '../../var/demo-sessions.json');
const persistSessions = () => !['test', 'production'].includes(process.env.NODE_ENV);
function saveSessions() {
  if (!persistSessions()) return;
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  const temp = `${SESSION_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({version:1,sessions:[...sessions].map(([hash,entry])=>({hash,email:entry.email,expiresAt:entry.expiresAt}))}), {mode:0o600});
  fs.renameSync(temp, SESSION_FILE);
}
function restoreSessions() {
  if (!persistSessions() || !fs.existsSync(SESSION_FILE)) return;
  try {
    const file = JSON.parse(fs.readFileSync(SESSION_FILE,'utf8'));
    for (const item of file.sessions || []) {
      if (typeof item.hash !== 'string' || !/^[a-f0-9]{64}$/.test(item.hash)) continue;
      if (typeof item.email !== 'string' || !Number.isFinite(item.expiresAt) || item.expiresAt <= Date.now()) continue;
      sessions.set(item.hash, {email:item.email, expiresAt:item.expiresAt});
    }
  } catch (error) {
    console.error('[MEA] Cannot restore local development sessions:', error.message);
  }
}
// Demo identities exist ONLY for the memory driver and disappear on restart.
if (!IS_PG) {
  const initialAccounts = [
    { name: 'Ayesha Khan', email: 'admin@mea.test', role: 'Admin', password: 'AdminDemo!2026' },
    { name: 'Ali Raza', email: 'employee@mea.test', role: 'Employee', password: 'EmployeeDemo!2026' }
  ];
  users.splice(0, users.length);
  for(const acc of initialAccounts) {
    const id = randomUUID();
    users.push({ id, name:acc.name, email:acc.email, role:acc.role, status:'Active', initials:acc.name.split(' ').map(n=>n[0]).join('') });
    credentials.set(id, hashPassword(acc.password));
  }
  restoreSessions();
}

function loginMemory(body) {
  if (process.env.NODE_ENV === 'production') throw new HttpError(503,'Demo auth is disabled in production');
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body?.password;
  if(!email || typeof password !== 'string') throw new HttpError(400,'Email and password required');
  const attempt=failures.get(email);
  if(attempt && attempt.blockedUntil>Date.now()) throw new HttpError(429,'Too many attempts. Try again in 60 seconds');
  const user = users.find(u=>u.email===email && u.status==='Active');
  if(!user || !matches(password,credentials.get(user.id))) {
    const n=(attempt?.count||0)+1;
    failures.set(email,{count:n,blockedUntil:n>=5?Date.now()+60000:0});
    throw new HttpError(401,'Invalid email or password');
  }
  failures.delete(email);
  const token=randomBytes(32).toString('hex');
  sessions.set(keyFor(token), {userId:user.id, email:user.email, expiresAt:Date.now()+SESSION_MS});
  saveSessions();
  return {token, user:publicUser(user), expiresIn:Math.floor(SESSION_MS/1000),demo:true};
}
function resolveMemory(token) {
  const entry = sessions.get(keyFor(token));
  if (!entry) return null;
  if (entry.expiresAt<=Date.now()) { sessions.delete(keyFor(token)); saveSessions(); return null; }
  const user=users.find(u=>u.status==='Active' && (u.id===entry.userId || (u.email===entry.email && u.role && entry.email)));
  return user ? publicUser(user) : null;
}
function logoutMemory(token) { if(token) { sessions.delete(keyFor(token)); saveSessions(); } }
function revokeUserMemory(userId) { const user=users.find(u=>u.id===userId); for(const [key,v] of sessions) if(v.userId===userId || (user && v.email===user.email)) sessions.delete(key); saveSessions(); }
function setPasswordMemory(userId,password) {
  const error = passwordError(password);
  if(error) throw new HttpError(400,error);
  credentials.set(userId,hashPassword(password));
}

// ===========================================================================
// POSTGRES DRIVER (durable identity + sessions)
// ===========================================================================
async function loginPg(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body?.password;
  if(!email || typeof password !== 'string') throw new HttpError(400,'Email and password required');
  const attempt=failures.get(email);
  if(attempt && attempt.blockedUntil>Date.now()) throw new HttpError(429,'Too many attempts. Try again in 60 seconds');
  const user = await repo.users.findActiveByEmail(email);
  const hash = user ? await repo.credentials.get(user.id) : null;
  if(!user || !matches(password, hash)) {
    const n=(attempt?.count||0)+1;
    failures.set(email,{count:n,blockedUntil:n>=5?Date.now()+60000:0});
    throw new HttpError(401,'Invalid email or password');
  }
  failures.delete(email);
  const token=randomBytes(32).toString('hex');
  const expiresAt=new Date(Date.now()+SESSION_MS);
  await repo.sessions.create({tokenHash:keyFor(token), userId:user.id, email:user.email, expiresAt});
  return {token, user:publicUser(user), expiresIn:Math.floor(SESSION_MS/1000)};
}
async function resolvePg(token) {
  const session = await repo.sessions.find(keyFor(token));
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now() || session.revokedAt) return null;
  const user = await repo.users.findById(session.userId);
  return user && user.status==='Active' ? publicUser(user) : null;
}
async function logoutPg(token) { if(token) await repo.sessions.revoke(keyFor(token)); }
async function revokeUserPg(userId) { await repo.sessions.revokeByUser(userId); }
async function setPasswordPg(userId,password) {
  const error = passwordError(password);
  if(error) throw new HttpError(400,error);
  await repo.credentials.set(userId, hashPassword(password));
}

// ===========================================================================
// Public async API (driver-agnostic)
// ===========================================================================
async function login(body) {
  if (productionLocked()) throw new HttpError(503,'Authentication requires the PostgreSQL persistence driver in production');
  return IS_PG ? loginPg(body) : loginMemory(body);
}
async function resolve(token) { return IS_PG ? resolvePg(token) : resolveMemory(token); }
async function logout(token) { return IS_PG ? logoutPg(token) : logoutMemory(token); }
async function revokeUser(userId) { return IS_PG ? revokeUserPg(userId) : revokeUserMemory(userId); }
async function setPassword(userId,password) { return IS_PG ? setPasswordPg(userId,password) : setPasswordMemory(userId,password); }

module.exports={login,resolve,logout,publicUser,revokeUser,setPassword};
