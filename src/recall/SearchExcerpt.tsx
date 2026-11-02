import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { VaultSearchContextRequest, VaultSearchContextResponse } from '../../backend/contract';
import { readSearchContext, SearchApiError } from './searchApi';
import SearchHighlight from './SearchHighlight';

type ContextState = { key: string; status: 'loading' } | { key: string; status: 'ready'; data: VaultSearchContextResponse } |
  { key: string; status: 'error'; changed: boolean };

export default function SearchExcerpt({ request, active, markdown, onNormal, onSearchAgain, headingRef, focusOnArrival, isCurrent, onArrivalHandled, onLoaded }: {
  request: VaultSearchContextRequest; active: boolean; markdown: boolean; onNormal: () => void; onSearchAgain: () => void;
  headingRef: RefObject<HTMLHeadingElement | null>; focusOnArrival: boolean;
  isCurrent: () => boolean;
  onArrivalHandled: () => void;
  onLoaded: () => void;
}) {
  const key = JSON.stringify(request);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<ContextState>({ key, status: 'loading' });
  const focusOwner = useRef<Element | null>(null);
  const targetRef = useRef<HTMLDivElement>(null);
  const state: ContextState = loaded.key === key ? loaded : { key, status: 'loading' };
  useEffect(() => {
    if (!active || !isCurrent()) return;
    const controller = new AbortController();
    focusOwner.current = document.activeElement;
    setLoaded({ key, status: 'loading' });
    void readSearchContext(request, controller.signal).then(data => {
      if (!controller.signal.aborted && isCurrent()) setLoaded({ key, status: 'ready', data });
    }, error => {
      if (!controller.signal.aborted && isCurrent()) setLoaded({ key, status: 'error', changed: error instanceof SearchApiError && error.code === 'search_context_changed' });
    });
    return () => controller.abort();
  }, [request, key, revision, active, isCurrent]);
  useLayoutEffect(() => {
    if (active && isCurrent() && state.status !== 'loading') onLoaded();
  }, [state, active, isCurrent, onLoaded]);
  useEffect(() => {
    if (!active || !isCurrent() || !focusOnArrival || state.status === 'loading') return;
    onArrivalHandled();
    // Respect a user who started another task while this read was outstanding.
    if (document.activeElement !== focusOwner.current && document.activeElement !== document.body && document.activeElement !== headingRef.current) return;
    const target = state.status === 'ready' ? targetRef.current : headingRef.current;
    target?.focus({ preventScroll: true });
    // Long neighbors may wrap for many screenfuls: arrival must reveal the match,
    // not merely the excerpt's heading above an offscreen target.
    if (target) {
      const bounds = target.getBoundingClientRect();
      const pane = target.closest('.recall-reader')?.getBoundingClientRect();
      const top = Math.max(0, pane?.top ?? 0), bottom = Math.min(window.innerHeight, pane?.bottom ?? window.innerHeight);
      if (bounds.top < top || bounds.bottom > bottom) target.scrollIntoView?.({ block: 'start', inline: 'nearest' });
    }
  }, [state, active, focusOnArrival, headingRef, isCurrent, onArrivalHandled]);
  return <section className="search-excerpt" aria-labelledby="search-excerpt-heading" aria-busy={state.status === 'loading'}>
    <div className="search-excerpt-actions"><button type="button" className="recall-button" onClick={onNormal}>{markdown ? 'Read formatted' : 'Open full file'}</button></div>
    <h2 id="search-excerpt-heading" ref={headingRef} tabIndex={-1}>{state.status === 'ready'
      ? `Source excerpt · lines ${state.data.startLine}–${state.data.lines.at(-1)?.number}` : 'Source excerpt'}</h2>
    {state.status === 'loading' ? <p role="status">Opening excerpt…</p> : state.status === 'error' ? <div className="search-excerpt-error" role="status">
      <p>{state.changed ? 'This file changed. Search again.' : "Couldn't open this excerpt."}</p>
      <button type="button" className="recall-button" onClick={state.changed ? onSearchAgain : () => setRevision(value => value + 1)}>{state.changed ? 'Search again' : 'Retry excerpt'}</button>
    </div> : <>
      <p className="search-excerpt-match">Match · line {state.data.targetLine}</p>
      {state.data.truncated && <p className="search-context-clipped">Some context is omitted.</p>}
      <div className="search-source-lines">{state.data.lines.map(line => <div key={line.number}
        ref={line.number === state.data.targetLine ? targetRef : undefined} tabIndex={line.number === state.data.targetLine ? -1 : undefined}
        role={line.number === state.data.targetLine ? 'group' : undefined}
        aria-label={line.number === state.data.targetLine ? `Match, line ${line.number}` : undefined}
        className={`search-source-line${line.number === state.data.targetLine ? ' search-source-line--target' : ''}`}>
        <span className="search-line-number" aria-hidden="true">{line.number}</span><pre><SearchHighlight text={line.text} positions={line.positions} /></pre>
      </div>)}</div>
    </>}
  </section>;
}
