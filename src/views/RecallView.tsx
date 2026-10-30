import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import type { VaultId } from '../../backend/contract';
import { failureCopy, findNote, idKey, noteLocation, readNote, readTree, selectionFromSearch } from '../recall/api';
import type { RecallFailure } from '../recall/api';
import { useRecallSession } from '../recall/RecallSession';
import { useDesktop } from '../recall/useDesktop';
import { useVaultRead } from '../recall/useVaultRead';
import MarkdownDocument from '../recall/MarkdownDocument';
import VaultFiles from '../recall/VaultFiles';
import FilesToggle from '../recall/FilesToggle';
import '../recall/recall.css';

function Message({ heading, body, action, onAction }: { heading: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="recall-message"><h2>{heading}</h2><p>{body}</p>
    {action && onAction && <button className="recall-button" type="button" onClick={onAction}>{action}</button>}
  </div>;
}

function Failure({ code, retry }: { code: RecallFailure; retry: () => void }) {
  return <Message {...failureCopy[code]} onAction={retry} />;
}

export default function RecallView() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const session = useRecallSession();
  const desktop = useDesktop();
  const selection = useMemo(() => selectionFromSearch(location.search), [location.search]);
  const key = selection.id ? idKey(selection.id) : null;
  // Native hash entries can lose router state and reuse its fallback "default" key.
  const entryKey = JSON.stringify([location.key, location.pathname, location.search]);
  const [treeRevision, setTreeRevision] = useState(0);
  const [noteRevision, setNoteRevision] = useState(0);
  const tree = useVaultRead('tree', treeRevision, readTree);
  const note = useVaultRead(key, noteRevision, readNote);
  const [expanded, setExpanded] = useState(() => new Set(session.expanded));
  const [desktopVisible, setDesktopVisible] = useState(session.desktopVisible);
  const [narrowOpen, setNarrowOpen] = useState(() => !selection.id && !selection.invalid && !session.narrowClosed);
  const filesRef = useRef<HTMLElement>(null);
  const filesHeading = useRef<HTMLHeadingElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const identityRef = useRef<HTMLParagraphElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<'files' | 'identity' | 'toggle' | null>(null);
  const attachExpand = useCallback((element: HTMLButtonElement | null) => {
    expandRef.current = element;
    if (!element) return;
    return () => {
      // Ref cleanup runs before removal, while the outgoing control still owns focus.
      // Explicit open/selection actions already have their own focus destination.
      if (document.activeElement === element && pendingFocus.current === null) pendingFocus.current = 'toggle';
      expandRef.current = null;
    };
  }, []);
  const revealSelection = useRef(true);
  const pendingScroll = useRef<number | null>(session.entries.get(entryKey) ?? session.readerScroll);
  const previousEntry = useRef({ key: entryKey, pathname: location.pathname, search: location.search, hash: location.hash });
  const previousDesktop = useRef(desktop);
  const restoreOnEntry = useRef(navigationType === 'PUSH' && !selection.id && !selection.invalid && session.lastId
    ? { id: session.lastId, scroll: session.readerScroll, replacing: false } : null);
  const knownName = key && selection.id && tree.status === 'ready' ? findNote(tree.data.entries, selection.id)?.name : undefined;
  const filename = knownName ?? (note.status === 'ready' ? note.data.name : undefined);
  const configFailure = note.status === 'error' && ['config_missing', 'config_invalid'].includes(note.error) ? note.error : null;
  const blocked: RecallFailure | null = configFailure ?? (tree.status === 'error' && note.status !== 'ready' &&
    (!selection.id || note.status === 'error') ? tree.error : null);
  const empty = !selection.id && !selection.invalid && tree.status === 'ready' && tree.data.entries.length === 0;
  const canBrowse = !blocked && !empty;
  const showFiles = canBrowse && (desktop ? desktopVisible : narrowOpen);
  const showReader = canBrowse && (desktop || !narrowOpen);

  const revealAncestors = (id: VaultId | null) => {
    if (!id) return;
    setExpanded(previous => {
      const next = new Set(previous);
      for (let length = 1; length < id.length; length++) next.add(idKey(id.slice(0, length)));
      return next;
    });
  };

  useEffect(() => { session.expanded = new Set(expanded); }, [expanded, session]);
  useEffect(() => { session.desktopVisible = desktopVisible; }, [desktopVisible, session]);
  useEffect(() => { revealAncestors(selection.id); }, [key]);

  useLayoutEffect(() => {
    if (restoreOnEntry.current && !restoreOnEntry.current.replacing) {
      const restoration = restoreOnEntry.current;
      restoration.replacing = true;
      navigate(noteLocation(restoration.id), { replace: true });
      return;
    }
    session.lastId = selection.id;
  }, [key, selection.invalid, navigate, session]);

  useLayoutEffect(() => {
    const previous = previousEntry.current;
    const hashOnly = previous.pathname === location.pathname && previous.search === location.search && previous.hash !== location.hash;
    previousEntry.current = { key: entryKey, pathname: location.pathname, search: location.search, hash: location.hash };
    if (previous.key === entryKey) return;
    if (hashOnly) {
      // The anchor inherits this note's reading position, without selecting it again.
      session.entries.set(entryKey, pendingScroll.current ?? session.entries.get(previous.key) ?? session.readerScroll);
      return;
    }
    revealSelection.current = true;
    const restoration = restoreOnEntry.current;
    // Returning through bare /recall replaces its URL; that is not a new-note reset.
    pendingScroll.current = restoration?.replacing && key === idKey(restoration.id) ? restoration.scroll
      : navigationType === 'POP' ? session.entries.get(entryKey) ?? 0 : 0;
    restoreOnEntry.current = null;
    if (navigationType === 'POP') pendingFocus.current = selection.id ? 'identity' : null;
    setNarrowOpen(false);
  }, [entryKey, location.pathname, location.search, location.hash, navigationType, session, key]);

  useLayoutEffect(() => {
    if (previousDesktop.current === desktop) return;
    const focused = document.activeElement;
    if (!desktop) {
      const operatingFiles = Boolean(filesRef.current?.contains(focused));
      setNarrowOpen(operatingFiles || (!selection.id && !session.narrowClosed));
    } else if (narrowOpen) {
      setDesktopVisible(true);
    }
    previousDesktop.current = desktop;
  }, [desktop, narrowOpen, key, session]);

  useLayoutEffect(() => {
    // A loading placeholder cannot accommodate the saved hierarchy position.
    if (!showFiles || tree.status !== 'ready' || !filesRef.current) return;
    filesRef.current.scrollTop = session.treeScroll.top;
    filesRef.current.scrollLeft = session.treeScroll.left;
  }, [showFiles, tree.status, session]);

  useLayoutEffect(() => {
    if (!showFiles || !revealSelection.current || tree.status !== 'ready') return;
    if (!selection.id) { revealSelection.current = false; return; }
    const current = filesRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (current && !current.closest('[hidden]')) {
      current.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      revealSelection.current = false;
    }
  }, [showFiles, tree.status, key, expanded]);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === 'files'
      ? filesRef.current?.querySelector<HTMLElement>('a[aria-current="page"]') ?? filesHeading.current
      : target === 'identity' ? identityRef.current : showFiles ? collapseRef.current : expandRef.current;
    if (element && (target !== 'files' || showFiles) && (target !== 'identity' || showReader)) {
      element.focus({ preventScroll: true });
      if (target === 'files') element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      pendingFocus.current = null;
    }
  }, [entryKey, showFiles, showReader, desktopVisible, narrowOpen, noteRevision, expanded]);

  useLayoutEffect(() => {
    if (!showReader || pendingScroll.current === null || !readerRef.current) return;
    // Keep the intent through the bare route, loading and recoverable read failures.
    if (pendingScroll.current > 0 && note.status !== 'ready') return;
    readerRef.current.scrollTop = pendingScroll.current;
    session.readerScroll = readerRef.current.scrollTop;
    pendingScroll.current = null;
  }, [showReader, note.status, entryKey, session]);

  useLayoutEffect(() => {
    document.title = filename ? `${filename} · Recall · Memory Loop`
      : selection.invalid || note.status === 'error' ? 'Note unavailable · Recall · Memory Loop' : 'Recall · Memory Loop';
  }, [filename, selection.invalid, note.status]);

  const rememberReader = () => {
    if (!showReader || !readerRef.current || pendingScroll.current !== null) return;
    session.readerScroll = readerRef.current.scrollTop;
    session.entries.set(entryKey, session.readerScroll);
  };

  const openFiles = () => {
    rememberReader();
    revealAncestors(selection.id);
    revealSelection.current = true;
    pendingFocus.current = 'files';
    if (desktop) setDesktopVisible(true); else { session.narrowClosed = false; setNarrowOpen(true); }
    console.info('recall_files_visibility_changed', { visible: true, trigger: 'user' });
  };

  const closeFiles = () => {
    pendingFocus.current = 'toggle';
    // Desktop keeps the live reader. Let native anchoring account for its changed
    // layout, and keep recording the resulting real scroll position. Only the
    // hidden narrow reader needs an explicit restoration when it returns.
    if (desktop) rememberReader(); else pendingScroll.current = session.readerScroll;
    if (desktop) setDesktopVisible(false); else { session.narrowClosed = true; setNarrowOpen(false); }
    console.info('recall_files_visibility_changed', { visible: false, trigger: 'user' });
  };

  const selectNote = (id: VaultId) => {
    rememberReader();
    pendingFocus.current = 'identity';
    setNarrowOpen(false);
    if (idKey(id) === key) {
      pendingScroll.current = session.readerScroll;
      if (note.status !== 'loading') setNoteRevision(value => value + 1);
      else if (showReader) { identityRef.current?.focus({ preventScroll: true }); pendingFocus.current = null; }
    } else {
      pendingScroll.current = 0;
      navigate(noteLocation(id));
    }
    console.info('recall_selection_changed', { trigger: 'file-link' });
  };

  const retryAll = () => {
    if (tree.status !== 'loading') setTreeRevision(value => value + 1);
    if (selection.id && note.status !== 'loading') setNoteRevision(value => value + 1);
  };

  const toggleFolder = (folder: string) => {
    const next = new Set(expanded);
    if (next.has(folder)) next.delete(folder); else next.add(folder);
    setExpanded(next);
    console.info('recall_folder_visibility_changed', { expanded: next.has(folder), trigger: 'folder-disclosure' });
  };

  const announcement = selection.invalid ? failureCopy.invalid_request.heading : blocked ? failureCopy[blocked].heading : empty ? 'No Markdown notes to show'
    : note.status === 'loading' ? 'Opening note…' : note.status === 'ready' ? 'Note opened.'
      : note.status === 'error' ? failureCopy[note.error].heading : tree.status === 'loading' ? 'Loading files…' : '';

  return <div className="recall" onKeyDown={event => {
    if (showFiles && event.key === 'Escape' && filesRef.current?.contains(event.target as Node)) {
      event.preventDefault(); closeFiles();
    }
  }}>
    <header className="recall-toolbar">
      <h1 id="view-heading" tabIndex={-1}>Recall</h1>
      <p className="read-only-label">Read-only</p>
    </header>
    <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement ? `Recall: ${announcement}` : ''}</div>
    {blocked ? <div className="recall-blocking"><Failure code={blocked} retry={retryAll} /></div>
      : empty ? <div className="recall-blocking"><Message heading="No Markdown notes to show"
        body="Recall lists Markdown files and folders only. Other files and hidden entries aren't shown." /></div>
        : <div className={`recall-panes${showFiles && desktop ? ' recall-panes--split' : ''}`}>
          <nav className="recall-files" id="recall-files" aria-label="Vault files" ref={filesRef} hidden={!showFiles}
            aria-busy={tree.status === 'loading'} onScroll={() => {
              if (showFiles && tree.status === 'ready' && filesRef.current) session.treeScroll = { top: filesRef.current.scrollTop, left: filesRef.current.scrollLeft };
            }}>
            <header className="files-header">
              <h2 ref={filesHeading} tabIndex={-1}>Files</h2>
              <FilesToggle expanded active={showFiles} ref={collapseRef} onToggle={closeFiles} />
            </header>
            {desktop && selection.id && <button className="pane-jump" type="button" onClick={() => identityRef.current?.focus({ preventScroll: true })}>Skip to note</button>}
            {tree.status === 'loading' ? <p className="files-status">Loading files…</p>
              : tree.status === 'error' ? <Message heading="Couldn't load files" body="The file list couldn't be retrieved. Try again."
                action="Retry files" onAction={() => setTreeRevision(value => value + 1)} />
                : tree.status === 'ready' && <>
                  {tree.data.entries.length ? <VaultFiles entries={tree.data.entries} selected={key} expanded={expanded}
                    toggle={toggleFolder}
                    select={selectNote} /> : <p className="files-status">No Markdown notes to show</p>}
                  <p className="files-footnote">Markdown files only.</p>
                </>}
          </nav>
          <section className="recall-reader" ref={readerRef} hidden={!showReader} aria-label="Note reader" onScroll={rememberReader}>
            {showReader && !showFiles && <div className="reader-controls">
              <FilesToggle expanded={false} ref={attachExpand} onToggle={openFiles} />
            </div>}
            {showReader && <div className="reader-measure">
              {selection.invalid ? <Failure code="invalid_request" retry={() => {}} />
                : selection.id ? <>
                  <button className="pane-jump" type="button" onClick={openFiles}>Return to files</button>
                  <article aria-labelledby="note-identity" aria-busy={note.status === 'loading'}>
                    <header className="note-header">
                      <p className="note-identity" ref={identityRef} tabIndex={-1} id="note-identity">{filename ?? 'Requested note'}</p>
                      {filename && <p className="note-path">{selection.id.join(' / ')}</p>}
                      <details className="formatting-support"><summary>Formatting support</summary>
                        <p>CommonMark and GFM are supported. Raw HTML is shown as text. Images and embeds aren't displayed. Note, heading, and Obsidian wiki links remain text. Web links open in a new tab. Task checkboxes are read-only. Frontmatter is ordinary Markdown, not interpreted metadata. This is not a full Obsidian preview.</p>
                      </details>
                    </header>
                    {note.status === 'loading' ? <p className="note-status">Opening note…</p>
                      : note.status === 'error' ? <Failure code={note.error} retry={() => setNoteRevision(value => value + 1)} />
                        : note.status === 'ready' && (note.data.markdown.length
                          ? <MarkdownDocument markdown={note.data.markdown} /> : <p className="note-status">This note is empty.</p>)}
                  </article>
                </> : <Message heading="Choose a Markdown note" body="Open a folder or choose a file in Files. Notes open read-only." />}
            </div>}
          </section>
        </div>}
  </div>;
}
