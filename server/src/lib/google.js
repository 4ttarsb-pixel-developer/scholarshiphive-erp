import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { config, googleConfigured } from '../config.js';

export const GV_COOKIE = 'sh_gv';          // holds the Google-verified identity during registration
export const STATE_COOKIE = 'sh_oauth';    // CSRF state for the OAuth round trip

function client() {
  return new OAuth2Client({ clientId: config.google.clientId, clientSecret: config.google.clientSecret, redirectUri: config.google.redirectUri });
}

export function authUrl(state) {
  return client().generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
    include_granted_scopes: true,
  });
}

/** Exchanges the code and verifies the ID token. Returns {sub,email,name,picture}. */
export async function verifyCode(code) {
  if (!googleConfigured()) throw new Error('Google OAuth is not configured');
  const c = client();
  const { tokens } = await c.getToken(code);
  if (!tokens.id_token) throw new Error('Google did not return an ID token');
  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: config.google.clientId });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw new Error('Google account email is not verified');
  return { sub: p.sub, email: p.email.toLowerCase(), name: p.name || '', picture: p.picture || '' };
}

// ── HMAC-signed small cookies ──
const sign = data => crypto.createHmac('sha256', config.cookieSecret).update(data).digest('base64url');
export function seal(obj, ttlSec) {
  const data = Buffer.from(JSON.stringify({ ...obj, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  return `${data}.${sign(data)}`;
}
export function unseal(value) {
  if (!value || typeof value !== 'string' || !value.includes('.')) return null;
  const [data, sig] = value.split('.');
  const expected = sign(data);
  if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const obj = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!obj.exp || obj.exp < Date.now() / 1000) return null;
    return obj;
  } catch { return null; }
}
