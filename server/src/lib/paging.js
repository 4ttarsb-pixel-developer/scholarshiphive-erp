// Server-side paging, sorting and filtering helpers.
// Sorting only ever uses SQL expressions from a whitelist, so a crafted ?sort= value can never reach the query.

/** Query-string value → trimmed string ('' for arrays / objects / missing). */
export const qstr = (v, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Positive integer id from the query string, or null. */
export const qid = v => {
  const s = qstr(v, 20);
  return /^\d{1,15}$/.test(s) ? Number(s) : null;
};

/**
 * @param q        req.query
 * @param sorts    { publicKey: 'SQL expression' }
 * @returns        { page, limit, offset, order, sort, dir }
 */
export function paging(q, { sorts, defaultSort, defaultDir = 'desc', defaultLimit = 25, maxLimit = 100, tieBreaker }) {
  const page = Math.min(100000, Math.max(1, parseInt(qstr(q.page, 8), 10) || 1));
  const limit = Math.min(maxLimit, Math.max(1, parseInt(qstr(q.limit, 4), 10) || defaultLimit));
  const want = qstr(q.sort, 40);
  const sort = Object.prototype.hasOwnProperty.call(sorts, want) ? want : defaultSort;
  const d = qstr(q.dir, 4).toLowerCase();
  const dir = d === 'asc' || d === 'desc' ? d : defaultDir;
  const order = `${sorts[sort]} ${dir.toUpperCase()} NULLS LAST${tieBreaker ? `, ${tieBreaker}` : ''}`;
  return { page, limit, offset: (page - 1) * limit, order, sort, dir };
}

/** Collects parameterised WHERE conditions. `?` in a condition becomes the next $n placeholder. */
export class Where {
  constructor(params = []) { this.params = params; this.parts = []; }
  add(cond, ...vals) {
    let i = 0;
    const sql = cond.replace(/\?/g, () => {
      if (i >= vals.length) throw new Error('Where.add: missing value');
      this.params.push(vals[i++]);
      return '$' + this.params.length;
    });
    this.parts.push(sql);
    return this;
  }
  raw(cond) { this.parts.push(cond); return this; }
  get sql() { return this.parts.length ? 'WHERE ' + this.parts.join(' AND ') : ''; }
  /** next placeholder number (for LIMIT / OFFSET) */
  next(v) { this.params.push(v); return '$' + this.params.length; }
}

/** LIKE pattern with % and _ escaped (user text is matched literally). */
export const likeText = s => '%' + String(s).toLowerCase().replace(/[\\%_]/g, c => '\\' + c) + '%';
