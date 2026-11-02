import { useId, useRef, useState, useSyncExternalStore } from 'react';
import type { VaultContentHit, VaultId, VaultSearchContextRequest } from '../../backend/contract';
import { idKey, noteLocation } from './api';
import { plainActivation } from './VaultFiles';
import { contentLocation } from './searchApi';
import type { createRecallSearch } from './searchState';
import SearchHighlight from './SearchHighlight';

export default function SearchFiles({ search, selected, selectFile, selectContent, dirty }: {
  search: ReturnType<typeof createRecallSearch>; selected: string | null; selectFile: (id: VaultId) => void;
  selectContent: (request: VaultSearchContextRequest) => void; dirty: boolean;
}) {
  const state = useSyncExternalStore(search.subscribe, search.getSnapshot, search.getSnapshot);
  const inputId = useId(), modeId = useId(), issueId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const result = composing === null ? state.result : null;
  const invalid = state.status === 'error' && state.error === 'invalid_request';
  const groups = new Map<string, VaultContentHit[]>();
  if (result?.mode === 'content') for (const hit of result.hits) {
    const key = idKey(hit.id); const list = groups.get(key) ?? []; list.push(hit); groups.set(key, list);
  }
  return <>
    <div className="search-controls">
      <label htmlFor={inputId}>Search</label>
      <div className="search-field"><input type="search" id={inputId} ref={input} autoComplete="off" spellCheck={false}
        aria-invalid={invalid || undefined} aria-describedby={state.status === 'error' ? issueId : undefined}
        value={composing ?? state.query} onCompositionStart={event => setComposing(event.currentTarget.value)}
        onCompositionEnd={event => { setComposing(null); search.setQuery(event.currentTarget.value); }}
        onChange={event => composing !== null ? setComposing(event.target.value) : search.setQuery(event.target.value)} />
        {state.query && <button type="button" className="search-clear" aria-label="Clear search and show files" onClick={() => { setComposing(null); search.setQuery(''); input.current?.focus(); }}>
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>}
      </div>
      <fieldset className="search-modes"><legend className="visually-hidden">Search in</legend>{(['filename', 'content'] as const).map(mode =>
        <label key={mode}><input type="radio" name={modeId} value={mode} checked={state.mode === mode} onChange={() => search.setMode(mode)} />
          <span>{mode === 'filename' ? 'Filename' : 'Content'}</span></label>)}</fieldset>
    </div>
    {state.status !== 'idle' && <div className="search-results" aria-busy={state.status === 'loading'}>
      <div className="search-summary" role="status" aria-live="polite" aria-atomic="true">
        {state.status === 'loading' || composing !== null ? <p>Searching…</p> : state.status === 'error' ? <><p id={issueId}>{invalid ? state.query.replace(/\s/gu, '').length > 128 ? 'Use 128 characters or fewer, not counting spaces.' : 'Use a shorter search or try entering it again.' : state.mode === 'filename' ? "Couldn't search files." : "Couldn't search file contents."}</p>
          <button type="button" className="recall-button" onClick={search.invalidate}>Retry search</button></> : result && <>
          <p>{result.counts.matches ? result.mode === 'filename' ? `${result.counts.matches} matching ${result.counts.matches === 1 ? 'file' : 'files'}.`
            : `${result.counts.matches} matching ${result.counts.matches === 1 ? 'line' : 'lines'} in ${result.counts.files} ${result.counts.files === 1 ? 'file' : 'files'}.`
            : result.coverage.complete ? result.mode === 'filename' ? 'No matching files.' : 'No matching lines.' : 'No matches in the files searched.'}</p>
          {result.limited && <p>Showing {result.hits.length} {result.mode === 'filename' ? 'files' : 'lines'}.</p>}
          {!result.coverage.complete && <p>Search incomplete.{result.coverage.timedOut && ' Time limit reached.'}
            {result.coverage.skippedFiles.unreadable > 0 && " Some files or folders couldn't be read."}
            {result.coverage.skippedFiles.changed > 0 && ' Some files changed.'}
            {result.coverage.skippedFiles.invalidEncoding > 0 && " Some files weren't valid UTF-8 text."}
            {result.coverage.skippedLines > 0 && ` ${result.coverage.skippedLines} ${result.coverage.skippedLines === 1 ? 'line was' : 'lines were'} too long to search.`}</p>}
        </>}
      </div>
      {dirty && state.mode === 'content' && <p className="search-saved">Searching saved files.</p>}
      {result?.mode === 'filename' && <ul className="search-list">{result.hits.map(hit => <li key={idKey(hit.id)}><a className="search-result" href={noteLocation(hit.id)}
        aria-current={selected === idKey(hit.id) ? 'page' : undefined} onClick={event => { if (plainActivation(event)) { event.preventDefault(); search.lastHref = event.currentTarget.getAttribute('href'); selectFile(hit.id); } }}>
        <span className="search-name">{hit.field === 'name' ? <SearchHighlight text={hit.name} positions={hit.positions} /> : hit.name}</span>
        <span className="search-path">{hit.field === 'path' ? <SearchHighlight text={hit.path} positions={hit.positions} /> : hit.path}</span>
      </a></li>)}</ul>}
      {result?.mode === 'content' && <ul className="search-list">{[...groups].map(([key, hits]) => <li className="search-group" key={key}>
        <p className="search-name">{hits[0].name}</p><p className="search-path">{hits[0].path}</p>
        <ul>{hits.sort((a, b) => a.line - b.line).map(hit => {
          const request = { id: hit.id, version: hit.version, line: hit.line, query: state.query }; const href = contentLocation(request);
          return <li key={hit.line}><a className="search-result search-line-result" href={href} aria-label={`${hit.name}, line ${hit.line}: ${hit.snippets.map(part => part.text).join(' … ')}`}
            onClick={event => { if (plainActivation(event)) { event.preventDefault(); search.lastHref = href; selectContent(request); } }}>
            <span className="search-line-number">{hit.line}</span><span className="search-snippets">{hit.snippets.map((part, i) => <span key={part.start}>
              {(i > 0 || part.start > 0) && <span className="search-ellipsis">…</span>}<SearchHighlight text={part.text} positions={part.positions} />
            </span>)}</span>
          </a></li>;
        })}</ul>
      </li>)}</ul>}
    </div>}
  </>;
}
