import type { VaultSearchMode, VaultSearchResponse } from '../../backend/contract';
import { normalizeSearchQuery } from '../../backend/contract';
import { SearchApiError, searchVault } from './searchApi';

interface SearchState { query: string; mode: VaultSearchMode; status: 'idle' | 'loading' | 'ready' | 'error'; result: VaultSearchResponse | null; error: string | null }
export function createRecallSearch() {
  let state: SearchState = { query: '', mode: 'filename', status: 'idle', result: null, error: null };
  const listeners = new Set<() => void>();
  let active = false, generation = 0;
  let ownsView: () => boolean = () => true;
  let resultScroll = { top: 0, left: 0 };
  let lastHref: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const publish = (next: Partial<SearchState>) => { state = { ...state, ...next }; listeners.forEach(listener => listener()); };
  const cancel = () => { generation++; clearTimeout(timer); controller?.abort(); controller = undefined; };
  const run = () => {
    cancel();
    if (!normalizeSearchQuery(state.query)) { publish({ status: 'idle', result: null, error: null }); return; }
    publish({ status: 'loading', result: null, error: null });
    if (!active) return;
    const owned = generation, owns = ownsView;
    const request = { mode: state.mode, query: state.query };
    timer = setTimeout(async () => {
      if (!active || owned !== generation || !owns()) return;
      const abort = new AbortController(); controller = abort;
      try {
        const result = await searchVault(request, abort.signal);
        if (active && owned === generation && owns() && !abort.signal.aborted) publish({ status: 'ready', result });
      } catch (error) {
        if (active && owned === generation && owns() && !abort.signal.aborted) publish({ status: 'error', error: error instanceof SearchApiError ? error.code : 'search_unavailable' });
      }
    }, 200);
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate(owns: () => boolean) { active = true; ownsView = owns; if (state.status !== 'ready') run(); return () => { active = false; cancel(); }; },
    setQuery(query: string) { if (query === state.query) return; resultScroll = { top: 0, left: 0 }; lastHref = null; state = { ...state, query }; run(); },
    setMode(mode: VaultSearchMode) { if (mode === state.mode) return; resultScroll = { top: 0, left: 0 }; lastHref = null; state = { ...state, mode }; run(); },
    invalidate: run,
    get resultScroll() { return resultScroll; },
    set resultScroll(value: { top: number; left: number }) { resultScroll = value; },
    get lastHref() { return lastHref; },
    set lastHref(value: string | null) { lastHref = value; },
  };
}
