// Shared password hashing (scrypt with a per-user random salt). Format: "salt:hex".
// Used by auth.service and the admin bootstrap so stored hashes are interchangeable.
// Argon2id is preferred for production; scrypt (Node built-in, no native deps) is
// used here to avoid adding build-chain dependencies in this environment.
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

function matches(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [salt, hex] = stored.split(':');
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, 'hex');
  const calculated = scryptSync(password, salt, expected.length);
  return expected.length === calculated.length && timingSafeEqual(calculated, expected);
}

module.exports = { hashPassword, matches };
