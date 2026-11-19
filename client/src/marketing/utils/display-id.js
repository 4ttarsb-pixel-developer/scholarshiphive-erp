// UI-only friendly references. Database UUIDs and platform IDs are never changed.
export function displayRef(prefix, number, fallback) {
 const n=Number(number);
 if (Number.isSafeInteger(n) && n > 0) return `${prefix}-${String(n).padStart(5,'0')}`;
 // Temporary compatibility with old API: do not expose long internal UUIDs.
 return fallback || '—';
}
export function accountRef(account) {
 return displayRef('ACC',account?.displayNumber,account?.externalAccountId || 'Pending account ID');
}
