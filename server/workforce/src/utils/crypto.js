'use strict';
/**
 * Password hashing: scrypt (Node built-in, no native build needed on Windows).
 * Legacy formats accepted on verify and transparently upgraded after login:
 *   - ASP.NET:  $pbkdf2-sha256$<iter>$<saltB64>$<hashB64>
 *   - Worker/D1: 64-char SHA-256 hex (unsalted)
 */
const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `$scrypt$N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** @returns {{ok:boolean, needsRehash:boolean}} */
function verifyPassword(password, stored) {
  if (!stored || password === undefined || password === null) return { ok: false, needsRehash: false };
  const pw = String(password);
  try {
    if (stored.startsWith('$scrypt$')) {
      const [, , params, saltB64, hashB64] = stored.split('$');
      const p = Object.fromEntries(params.split(',').map((kv) => kv.split('=')).map(([k, v]) => [k, Number(v)]));
      const expected = Buffer.from(hashB64, 'base64');
      const actual = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: p.N, r: p.r, p: p.p });
      return { ok: crypto.timingSafeEqual(actual, expected), needsRehash: p.N < SCRYPT.N };
    }
    if (stored.startsWith('$pbkdf2-sha256$')) {
      const parts = stored.split('$');
      const iterations = Number(parts[2]);
      if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) return { ok: false, needsRehash: false };
      const salt = Buffer.from(parts[3], 'base64');
      const expected = Buffer.from(parts[4], 'base64');
      const actual = crypto.pbkdf2Sync(pw, salt, iterations, expected.length, 'sha256');
      return { ok: crypto.timingSafeEqual(actual, expected), needsRehash: true };
    }
    if (/^[0-9a-f]{64}$/i.test(stored)) {
      const digest = crypto.createHash('sha256').update(pw, 'utf8').digest('hex');
      return { ok: safeEqual(digest.toLowerCase(), stored.toLowerCase()), needsRehash: true };
    }
  } catch (_) {
    return { ok: false, needsRehash: false };
  }
  return { ok: false, needsRehash: false };
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function uuid() { return crypto.randomUUID(); }

module.exports = { hashPassword, verifyPassword, sha256Hex, randomToken, uuid, safeEqual };
