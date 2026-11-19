// Small fetch wrapper: same-origin cookies, security header, readable errors, session-expiry signal.
export class ApiError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body || {}; this.code = body?.code; }
}

const listeners = new Set();
export const onAuthError = fn => { listeners.add(fn); return () => listeners.delete(fn); };

async function handle(res) {
  const type = res.headers.get('content-type') || '';
  const body = type.includes('application/json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    const msg = (body && body.error) || (res.status === 413 ? 'Upload is too large.' : `Request failed (${res.status})`);
    if (res.status === 401 && body?.code && ['SESSION_EXPIRED', 'NOT_LOGGED_IN', 'ACCOUNT_INACTIVE'].includes(body.code)) listeners.forEach(fn => fn(body.code, msg));
    throw new ApiError(msg, res.status, typeof body === 'object' ? body : {});
  }
  return body;
}

export async function api(path, { method = 'GET', body, form, signal } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'ScholarshipHive' }, signal };
  if (form) opts.body = form;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + path, opts); } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError('Cannot reach the server. Check your internet connection.', 0);
  }
  return handle(res);
}
api.get = p => api(p);
api.post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
api.put = (p, body) => api(p, { method: 'PUT', body: body ?? {} });
api.del = p => api(p, { method: 'DELETE' });
api.upload = (p, data, method = 'POST') => {
  const form = new FormData();
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length && v[0] instanceof File) v.forEach(f => form.append(k, f));
    else if (v instanceof File) form.append(k, v);
    else if (typeof v === 'object') form.append(k, JSON.stringify(v));
    else form.append(k, String(v));
  }
  return api(p, { method, form });
};

export const qs = obj => {
  const p = new URLSearchParams();
  Object.entries(obj || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? '?' + s : '';
};

export const fileUrl = (id, download) => `/api/files/${id}${download ? '?download=1' : ''}`;
