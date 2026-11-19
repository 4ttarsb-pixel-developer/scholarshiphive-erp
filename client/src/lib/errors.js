// Sends browser crashes to the server log (Vercel → Logs) so they can be fixed. Never throws.
let sent = 0;
export function reportError(err, extra = {}) {
  try {
    if (sent > 10) return;
    sent++;
    const body = JSON.stringify({ message: String(err?.message || err || 'Unknown error').slice(0, 500), stack: String(err?.stack || '').slice(0, 1500), url: location.pathname, ...extra });
    fetch('/api/client-errors', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ScholarshipHive' }, body, credentials: 'same-origin', keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}

/** After a new deploy, old pages may ask for files that no longer exist — reload once to get the new version. */
export function isChunkError(err) {
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/i.test(String(err?.message || err));
}
export function reloadOnceForChunk() {
  try {
    const k = 'sh_chunk_reload';
    const last = Number(sessionStorage.getItem(k) || 0);
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem(k, String(Date.now()));
  } catch { /* storage blocked — still try once */ }
  location.reload();
  return true;
}

export function installGlobalHandlers(onError) {
  window.addEventListener('error', e => {
    if (isChunkError(e.error || e.message)) { reloadOnceForChunk(); return; }
    if (e.error) { reportError(e.error); onError?.(e.error); }
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    if (r?.name === 'AbortError' || r?.status) return; // cancelled requests and normal API errors are handled where they happen
    if (isChunkError(r)) { reloadOnceForChunk(); return; }
    reportError(r);
    onError?.(r);
  });
}
