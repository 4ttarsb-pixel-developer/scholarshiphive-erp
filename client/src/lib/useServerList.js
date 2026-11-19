import { useCallback, useEffect, useRef, useState } from 'react';
import { api, qs } from './api.js';

/** Value that only changes after the user stops typing for `ms`. */
export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * Server-side list loader: cancels stale requests (no out-of-order results) and keeps the previous page on screen
 * while the next one loads, so tables never jump or collapse.
 */
export function useServerList(path, params = {}, deps = []) {
  const key = path ? path + qs(params) : null;
  const [state, setState] = useState({ data: null, loading: Boolean(key), error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!key) { setState({ data: null, loading: false, error: null }); return undefined; }
    const ctrl = new AbortController();
    setState(s => ({ ...s, loading: true, error: null }));
    api(key, { signal: ctrl.signal })
      .then(d => setState({ data: d, loading: false, error: null }))
      .catch(e => { if (e?.name !== 'AbortError') setState(s => ({ data: s.data, loading: false, error: e })); });
    return () => ctrl.abort();
  }, [key, tick, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { ...state, reload };
}

/** Paging/sorting/filter state for a server table. Changing a filter jumps back to page 1. */
export function useTableQuery(initial = {}) {
  const init = useRef({ page: 1, limit: 25, sort: '', dir: '', ...initial });
  const [q, setQ] = useState(init.current);
  const update = useCallback(patch => setQ(prev => {
    const paging = ['page', 'limit', 'sort', 'dir'];
    const onlyPaging = Object.keys(patch).every(k => paging.includes(k));
    const next = { ...prev, ...patch };
    if (!onlyPaging || patch.limit || patch.sort) next.page = patch.page || 1;
    return next;
  }), []);
  const reset = useCallback(keep => setQ(prev => ({ ...init.current, limit: prev.limit, ...(keep || {}) })), []);
  return [q, update, reset];
}
