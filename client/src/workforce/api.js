// Thin API client. Cookies carry the session; X-Requested-With satisfies the CSRF check.
const workforceUrl = (url) => url.startsWith('/api/') && !url.startsWith('/api/workforce/') ? `/api/workforce/${url.slice(5)}` : url;

export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

async function request(method, url, body, opts = {}) {
  const headers = { Accept: 'application/json', 'X-Requested-With': 'ScholarshipHive' };
  url = workforceUrl(url);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let res;
  try {
    res = await fetch(url, { method, headers, credentials: 'include', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(0, 'Cannot reach the server. Is the backend running?');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401 && !url.includes('/auth/')) window.dispatchEvent(new CustomEvent('wp:unauthorized'));
    throw new ApiError(res.status, (data && data.message) || `Request failed (${res.status})`, data && data.details);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body, opts) => request('POST', url, body ?? {}, opts),
  patch: (url, body) => request('PATCH', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url) => request('DELETE', url),
};

export const qs = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '' && v !== 'all') s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
};

/** Download a CSV through the authenticated session. */
export async function downloadFile(url, filename) {
  const res = await fetch(workforceUrl(url), { credentials: 'include', headers: { 'X-Requested-With': 'ScholarshipHive' } });
  if (!res.ok) throw new ApiError(res.status, 'Export failed');
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
