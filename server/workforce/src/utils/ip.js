'use strict';
/**
 * Office network matching — ported 1:1 from attendance_worker/src/index.js so the
 * Flutter app behaves identically: IPv4 exact (/32 default), IPv6 normalised to /64,
 * private router IPs handled (see normalizeForSave).
 */

function expandIpv6(ip) {
  const value = String(ip || '').split('/')[0].trim().toLowerCase();
  if (!value.includes(':')) return [];
  const halves = value.split('::');
  if (halves.length > 2) return [];
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = halves.length > 1 ? Math.max(0, 8 - left.length - right.length) : 0;
  const full = halves.length > 1 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (full.length !== 8 || full.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return [];
  return full.map((x) => x.padStart(4, '0'));
}

function ipv6ToBigInt(ip) {
  const full = expandIpv6(ip);
  if (full.length !== 8) return null;
  return full.reduce((acc, part) => (acc << 16n) + BigInt(parseInt(part, 16)), 0n);
}

function ipv4ToBigInt(ip) {
  const parts = String(ip || '').split('/')[0].trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    value = (value << 8n) + BigInt(n);
  }
  return value;
}

function isPrivateIpv4(ip) {
  const parts = String(ip || '').split('/')[0].trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

/** Strip IPv4-mapped IPv6 prefix and zone ids. */
function cleanIp(ip) {
  let v = String(ip || '').trim();
  if (v.startsWith('::ffff:') && v.includes('.')) v = v.slice(7);
  const pct = v.indexOf('%');
  if (pct >= 0) v = v.slice(0, pct);
  return v || 'unknown';
}

function normalizeOfficeNetwork(value, { privateDefaultPrefix = 32 } = {}) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'unknown') return '';
  const slash = raw.lastIndexOf('/');
  const ipOnly = cleanIp(slash >= 0 ? raw.slice(0, slash) : raw);
  const prefixText = slash >= 0 ? raw.slice(slash + 1) : '';
  if (ipOnly.includes(':')) {
    const full = expandIpv6(ipOnly);
    if (full.length !== 8) return '';
    let prefix = prefixText ? Number(prefixText) : 64;
    if (!Number.isInteger(prefix) || prefix < 1 || prefix > 128) prefix = 64;
    if (ipOnly === '::1') prefix = prefixText ? prefix : 128;
    return `${full.join(':')}/${prefix}`;
  }
  if (ipv4ToBigInt(ipOnly) === null) return '';
  const defaultPrefix = isPrivateIpv4(ipOnly) && !ipOnly.startsWith('127.') ? privateDefaultPrefix : 32;
  let prefix = prefixText ? Number(prefixText) : defaultPrefix;
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32) prefix = 32;
  return `${ipOnly}/${prefix}`;
}

function officeNetworkMatches(rule, ip) {
  const normalized = normalizeOfficeNetwork(rule);
  const current = cleanIp(ip).toLowerCase();
  if (!normalized || !current || current === 'unknown') return false;
  const [ruleIp, prefixRaw] = normalized.split('/');
  const prefix = Number(prefixRaw);
  if (ruleIp.includes(':') && current.includes(':')) {
    const a = ipv6ToBigInt(ruleIp);
    const b = ipv6ToBigInt(current);
    if (a === null || b === null) return false;
    const p = BigInt(prefix);
    const mask = ((1n << p) - 1n) << (128n - p);
    return (a & mask) === (b & mask);
  }
  if (!ruleIp.includes(':') && !current.includes(':')) {
    const a = ipv4ToBigInt(ruleIp);
    const b = ipv4ToBigInt(current);
    if (a === null || b === null) return false;
    const p = BigInt(prefix);
    const mask = ((1n << p) - 1n) << (32n - p);
    return (a & mask) === (b & mask);
  }
  return false;
}

/**
 * Decide which rule to save when an admin adds a network.
 * - Admin typed a private router IP and the server sees a *public* client IP (cloud deployment):
 *   save the public IP the server observed (Worker behaviour).
 * - Admin typed a private IP and the server also sees private IPs (LAN deployment): save it as /24
 *   (ASP.NET behaviour) so all devices on 192.168.x.* match.
 */
function normalizeForSave(raw, detectedIp) {
  const detected = cleanIp(detectedIp);
  const typed = String(raw || '').trim();
  if (!typed) return normalizeOfficeNetwork(detected, { privateDefaultPrefix: 24 });
  if (isPrivateIpv4(typed) && !typed.startsWith('127.')) {
    if (detected && !detected.includes(':') && !isPrivateIpv4(detected) && detected !== 'unknown') {
      return normalizeOfficeNetwork(detected);
    }
    return normalizeOfficeNetwork(typed, { privateDefaultPrefix: 24 });
  }
  return normalizeOfficeNetwork(typed, { privateDefaultPrefix: 24 });
}

module.exports = { expandIpv6, isPrivateIpv4, cleanIp, normalizeOfficeNetwork, officeNetworkMatches, normalizeForSave };
