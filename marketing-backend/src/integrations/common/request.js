const { HttpError } = require('../../utils/http');
// Restricted to hardcoded official platform hostnames in adapters. Never fetch user-provided URLs.
async function requestJson(url, options = {}) {
  const abort = AbortSignal.timeout(12000);
  let response;
  try { response = await fetch(url, { ...options, signal: abort, redirect: 'error' }); }
  catch { throw new HttpError(502, 'Advertising platform request failed or timed out'); }
  if (!response.ok) {
    // Never return raw API error bodies: vendors sometimes echo token or other sensitive information.
    throw new HttpError(response.status === 401 || response.status === 403 ? 502 : 502,
      `Advertising platform rejected the request (HTTP ${response.status}). Check authorization, permissions or API limits.`);
  }
  let result;
  try { result = await response.json(); }
  catch { throw new HttpError(502, 'Advertising platform returned invalid JSON'); }
  return result;
}
function checkCredentials(value, platform) {
  if (!value || value.startsWith('REPLACE_')) throw new HttpError(409, `${platform} API credentials are not configured on the backend`);
  return value;
}
function asNumber(value) {const n=Number(value);return Number.isFinite(n)?n:0;}
module.exports={requestJson,checkCredentials,asNumber};
