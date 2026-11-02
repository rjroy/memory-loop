'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { usePresentation } from '../shell/presentation';
import type { Presentation } from '../shell/presentation';
import { normalizeSearchQuery } from '../../backend/contract';
import type { VaultAction as VaultActionRequest, VaultActionResponse, VaultId, VaultTreeResponse, VaultSearchContextRequest } from '../../backend/contract';
import { containsId, failureCopy, fileContentLocation, findEntry, idKey, noteLocation, readFile, readNote, readTree, selectionFromSearch } from '../recall/api';
import type { RecallFailure } from '../recall/api';
import { useRecallSession } from '../recall/RecallSession';
import { useDesktop } from '../recall/useDesktop';
import { useVaultRead } from '../recall/useVaultRead';
import { useDirectoryTree } from '../recall/useDirectoryTree';
import MarkdownDocument from '../recall/MarkdownDocument';
import FileViewer, { fileKindLabel } from '../recall/FileViewer';
import SearchFiles from '../recall/SearchFiles';
import SearchExcerpt from '../recall/SearchExcerpt';
import { contentLocation, parseContentLocation } from '../recall/searchApi';
import AttachmentsUpload from '../recall/AttachmentsUpload';
import { createMediaIndex } from '../recall/mediaReferences';
import VaultFiles from '../recall/VaultFiles';
import FilesToggle from '../recall/FilesToggle';
import FileActions, { FileActionRecovery, FileActionTrigger, FileBackground } from '../recall/FileActions';
import RouteHeading from '../shell/RouteHeading';
import '../recall/recall.css';

function Message({ heading, body, action, onAction }: { heading: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="recall-message"><h2>{heading}</h2><p>{body}</p>
    {action && onAction && <button className="recall-button" type="button" onClick={onAction}>{action}</button>}
  </div>;
}

function Failure({ code, retry }: { code: RecallFailure; retry: () => void }) {
  return <Message {...failureCopy[code]} onAction={retry} />;
}

function FileFailure({ code, retry }: { code: RecallFailure; retry: () => void }) {
  return <Message heading={['entry_unavailable', 'note_unavailable'].includes(code) ? 'This file is no longer available.' : "Couldn't open this file."}
    body={['entry_unavailable', 'note_unavailable'].includes(code) ? 'It may have moved, been removed, or be unreadable. Choose another file or try again.' : 'Check the connection and try again.'}
    action="Retry file" onAction={retry} />;
}

function revealEditorWhenClipped(field: HTMLElement) {
  const viewport = window.visualViewport;
  let top = viewport?.offsetTop ?? 0;
  let bottom = top + (viewport?.height ?? window.innerHeight);
  let left = viewport?.offsetLeft ?? 0;
  let right = left + (viewport?.width ?? window.innerWidth);
  // The reader scrolls locally; enlarged layouts also scroll the document.
  // Visible-overflow layout boxes must not be mistaken for clipping panes.
  for (let ancestor = field.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor === document.scrollingElement) continue;
    const style = getComputedStyle(ancestor);
    const bounds = ancestor.getBoundingClientRect();
    if (/^(auto|scroll|hidden|clip)$/.test(style.overflowY)) {
      top = Math.max(top, bounds.top + ancestor.clientTop);
      bottom = Math.min(bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight);
    }
    if (/^(auto|scroll|hidden|clip)$/.test(style.overflowX)) {
      left = Math.max(left, bounds.left + ancestor.clientLeft);
      right = Math.min(right, bounds.left + ancestor.clientLeft + ancestor.clientWidth);
    }
  }
  const bounds = field.getBoundingClientRect();
  // An oversized editor already spanning the visible area needs no movement.
  const vertical = (bounds.top >= top && bounds.bottom <= bottom) || (bounds.top <= top && bounds.bottom >= bottom);
  const horizontal = (bounds.left >= left && bounds.right <= right) || (bounds.left <= left && bounds.right >= right);
  if (bottom <= top || right <= left || !vertical || !horizontal) {
    field.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  }
}

export default function RecallView() {
  const presentation = usePresentation();
  // Next may retain the outgoing page during a transition. Its note controller
  // must not interpret Capture's URL as an unselected Recall entry or overwrite
  // the session's last note/reading position before it is hidden or unmounted.
  return presentation.location.pathname === '/recall' ? <RecallContent {...presentation} /> : null;
}

function RecallContent({ location, navigate, navigationType, isNavigating, navigationGeneration, claimNativeRecallSelection, recallSnapshot, rememberEntry, registerRecallCapture, registerNavigationGuard }: Presentation) {
  const session = useRecallSession();
  const editor = session.editor;
  const editing = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  const searching = useSyncExternalStore(session.search.subscribe, session.search.getSnapshot, session.search.getSnapshot);
  const searchActive = Boolean(normalizeSearchQuery(searching.query));
  const excerpt = useMemo(() => parseContentLocation(location.search), [location.search]);
  const excerptRequest = excerpt.request;
  const [excerptRevision, setExcerptRevision] = useState(0);
  const desktop = useDesktop();
  const selection = useMemo(() => selectionFromSearch(location.search), [location.search]);
  const key = selection.id ? idKey(selection.id) : null;
  // Markdown retains its existing revision-aware note contract; all other files
  // use a daemon-classified passive preview, never an extension-based MIME guess.
  const markdown = Boolean(selection.id?.at(-1)?.endsWith('.md'));
  // Identity comes from the public browser entry, never Next router internals.
  const entryKey = location.key;
  const [noteRevision, setNoteRevision] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set(session.expanded));
  const [fullTree, setFullTree] = useState<VaultTreeResponse | null>(null);
  const [fullError, setFullError] = useState(false);
  const fullPending = useRef<Promise<VaultTreeResponse> | null>(null);
  const fullGeneration = useRef(0);
  const resetFull = useCallback(() => { fullGeneration.current++; fullPending.current = null; session.directories.full = null; setFullTree(null); setFullError(false); }, [session]);
  const { tree, refresh: refreshDirectoryTree, failed: failedDirectories, retry: retryDirectory } = useDirectoryTree(session.directories, expanded, () => {
    resetFull(); editor.clearConfirmed(); session.search.invalidate();
    session.lastId = null; session.lastExcerpt = null; session.normalReaderPositions.clear(); session.expanded.clear();
    const selected = selection.id;
    setExpanded(new Set(selected ? selected.slice(0, -1).map((_, index) => idKey(selected.slice(0, index + 1))) : []));
    setNoteRevision(value => value + 1);
  });
  const loadedDirectories = useMemo(() => new Set(session.directories.listings.keys()), [session, tree]);
  const loadFullTree = useCallback(async () => {
    if (session.directories.full) { setFullTree(session.directories.full); return session.directories.full; }
    if (fullPending.current) return fullPending.current;
    const epoch = fullGeneration.current;
    const work = readTree('tree', new AbortController().signal).then(value => {
      if (epoch !== fullGeneration.current || value.rootIdentity !== session.directories.rootIdentity) throw new Error('Vault changed');
      session.directories.full = value; setFullTree(value); setFullError(false); return value;
    }).catch(error => { if (epoch === fullGeneration.current) setFullError(true); throw error; })
      .finally(() => { if (fullPending.current === work) fullPending.current = null; });
    fullPending.current = work;
    return work;
  }, [session]);
  useEffect(() => () => { fullGeneration.current++; fullPending.current = null; }, []);
  useEffect(() => {
    const focus = () => resetFull();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [resetFull]);
  const requestMedia = useCallback(() => { void loadFullTree().catch(() => {}); }, [loadFullTree]);
  const mediaIndex = useMemo(() => fullTree ? createMediaIndex(fullTree.entries) : null, [fullTree]);
  const media = useMemo(() => selection.id ? { noteId: selection.id, index: mediaIndex, unavailable: tree.status === 'error' || fullError, load: tree.status === 'ready' ? requestMedia : undefined } : undefined,
    [selection.id, mediaIndex, tree.status, fullError, requestMedia]);
  const [fileBusy, setFileBusy] = useState(false);
  const [uploadTrigger, setUploadTrigger] = useState<HTMLElement | null>(null);
  const fileBusyRef = useRef(false);
  const fileMounted = useRef(false);
  const renderedGeneration = navigationGeneration?.();
  const fileView = useRef({ location, isNavigating, generation: renderedGeneration });
  useLayoutEffect(() => { fileView.current = { location, isNavigating, generation: renderedGeneration }; });
  useLayoutEffect(() => { fileMounted.current = true; return () => { fileMounted.current = false; }; }, []);
  const ownsFileView = useCallback(() => {
    const current = fileView.current;
    return fileMounted.current && !current.isNavigating && current.location.key === location.key &&
      current.location.pathname === location.pathname && current.location.search === location.search && current.location.hash === location.hash &&
      current.generation === renderedGeneration && (navigationGeneration === undefined || navigationGeneration() === renderedGeneration);
  }, [location.key, location.pathname, location.search, location.hash, renderedGeneration, navigationGeneration]);
  const admitSelection = () => {
    if (!fileMounted.current || fileBusyRef.current) return null;
    const owns = ownsFileView() ? ownsFileView : claimNativeRecallSelection?.(location);
    // Capture once at the fresh event boundary. Guard callbacks keep this owner,
    // never a newly admitted generation or an unconditional updated view ref.
    return owns ? () => fileMounted.current && owns() : null;
  };
  useEffect(() => isNavigating ? undefined : session.search.activate(ownsFileView), [session, isNavigating, ownsFileView]);
  const affectedAction = useRef(false);
  const uncertainAffectedId = useRef<VaultId | null>(null);
  const actionNavigation = useRef(false);
  const [fileFenced, setFileFenced] = useState(session.fileActionFenced);
  const actionPresentation = useRef<{ key: string; scroll: number; narrowOpen: boolean } | null>(null);
  const actionFocus = useRef<string | null>(null);
  // A read begun before an acknowledged save cannot replace that saved snapshot.
  // A later successful read may refresh it; a failed navigation/read retains it.
  const readForView = useCallback(async (readKey: string, signal: AbortSignal) => {
    const acknowledged = editor.getSnapshot().confirmed;
    return { note: await readNote(readKey, signal), acknowledged };
  }, [editor]);
  const rawRead = useVaultRead(markdown ? key : null, noteRevision, readForView);
  const read = rawRead.status === 'ready' ? { status: 'ready' as const, data: rawRead.data.note } : rawRead;
  const file = useVaultRead(markdown ? null : key, noteRevision, readFile);
  const refreshed = rawRead.status === 'ready' && rawRead.data.acknowledged === editing.confirmed;
  const note = editing.confirmed?.key === key && !refreshed ? { status: 'ready' as const, data: editing.confirmed.note } : read;
  const content = markdown ? note : file;
  const draft = editing.draft && idKey(editing.draft.id) === key ? editing.draft : null;
  const selectedFenced = fileFenced && session.fileActionAffectedId !== null && idKey(session.fileActionAffectedId) === key;
  const dirty = Boolean(draft && draft.markdown !== draft.base.markdown);
  // A route POP can remount this controller rather than transition an existing
  // one. Seed it from that entry just as the transition effect would below.
  const initialPop = useRef(navigationType === 'POP' ? recallSnapshot : undefined).current;
  const initialHashPresentation = location.nativeHash ? initialPop : undefined;
  const [desktopVisible, setDesktopVisible] = useState(initialHashPresentation?.desktopVisible ?? session.desktopVisible);
  const [narrowOpen, setNarrowOpen] = useState(() => navigationType === 'POP'
    ? initialHashPresentation?.narrowOpen ?? false
    : !selection.id && !selection.invalid && !session.narrowClosed);
  const filesRef = useRef<HTMLElement>(null);
  const filesHeading = useRef<HTMLHeadingElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const identityRef = useRef<HTMLParagraphElement>(null);
  const excerptHeading = useRef<HTMLHeadingElement>(null);
  const excerptFocus = useRef(Boolean(excerptRequest) && navigationType === 'INITIAL');
  const excerptArrivalHandled = useCallback(() => { excerptFocus.current = false; }, []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  const focusOwned = useRef(false);
  const wasEditing = useRef(Boolean(draft));
  const collapseRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<'files' | 'identity' | 'toggle' | 'editor' | 'edit' | 'article' | null>(
    navigationType === 'POP' && selection.id && !initialHashPresentation ? 'identity' : null,
  );
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
  const revealSelection = useRef(!initialPop && !searchActive);
  // An asynchronous listing may finish after the user has moved elsewhere.
  const revealOwner = useRef<Element | null>(null);
  const delayedFilesFocus = useRef(false);
  const pendingScroll = useRef<number | null>(recallSnapshot?.readerScroll ?? session.readerScroll);
  const previousEntry = useRef({ key: entryKey, pathname: location.pathname, search: location.search, hash: location.hash });
  const previousDesktop = useRef(desktop);
  const restoreOnEntry = useRef(navigationType === 'PUSH' && !selection.id && !selection.invalid && session.lastId
    ? { id: session.lastId, scroll: session.readerScroll, excerpt: session.lastExcerpt, replacing: false } : null);
  const knownEntry = key && selection.id && tree.status === 'ready' ? findEntry(tree.data.entries, selection.id) : undefined;
  const filename = (knownEntry?.kind !== 'directory' ? knownEntry?.name : undefined) ?? (content.status === 'ready' ? content.data.name : undefined) ?? excerptRequest?.id.at(-1);
  const configFailure = content.status === 'error' && ['config_missing', 'config_invalid'].includes(content.error) ? content.error : null;
  const blocked: RecallFailure | null = configFailure ?? (!excerptRequest && tree.status === 'error' && content.status !== 'ready' &&
    (!selection.id || content.status === 'error') ? tree.error : null);
  const empty = !selection.id && !selection.invalid && tree.status === 'ready' && tree.data.entries.length === 0;
  const canBrowse = !blocked;
  const showFiles = canBrowse && (desktop ? desktopVisible : narrowOpen);
  const showReader = canBrowse && (desktop || !narrowOpen);

  useLayoutEffect(() => registerNavigationGuard?.(resume => {
    if (actionNavigation.current) return true;
    if (fileBusyRef.current) return false;
    if (session.uploads.getSnapshot().busy) { session.uploads.wait(); return false; }
    session.uploads.dismiss();
    setUploadTrigger(null);
    const leave = () => { editor.finish(); resume(); };
    if (!editor.request(leave)) return false;
    editor.finish();
    return true;
  }), [editor, session, registerNavigationGuard]);

  const wasSaving = useRef(editing.saving);
  useEffect(() => {
    if (wasSaving.current && !editing.saving && !editing.issue) {
      session.search.invalidate(); resetFull();
      void refreshDirectoryTree().catch(() => {});
    }
    wasSaving.current = editing.saving;
  }, [editing.saving, editing.issue, session, resetFull, refreshDirectoryTree]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      const current = editor.getSnapshot();
      if (!editor.dirty() && !current.saving && !current.reloading && !fileBusyRef.current && !session.uploads.hasPending() && !session.uploads.getSnapshot().busy) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const focus = () => { focusOwned.current = document.activeElement === textareaRef.current || Boolean(actionRef.current?.contains(document.activeElement)); };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('focusin', focus);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('focusin', focus); };
  }, [editor, session]);

  useLayoutEffect(() => {
    if (editing.pending) keepRef.current?.focus();
  }, [editing.pending]);

  useLayoutEffect(() => {
    if (wasEditing.current && !draft) {
      pendingScroll.current = editor.position.readingScroll;
      if (focusOwned.current) pendingFocus.current = 'edit';
    }
    wasEditing.current = Boolean(draft);
  }, [draft, editor]);

  const restoreEditor = () => {
    const field = textareaRef.current;
    if (!field) return;
    const { start, end, direction, scroll } = editor.position;
    field.focus({ preventScroll: true });
    field.setSelectionRange(start, end, direction);
    field.scrollTop = scroll;
    revealEditorWhenClipped(field);
    field.scrollTop = scroll;
  };

  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (!draft || !showReader || !field) return;
    field.setSelectionRange(editor.position.start, editor.position.end, editor.position.direction);
    field.scrollTop = editor.position.scroll;
  }, [Boolean(draft), showReader, editor]);

  const keepEditing = () => {
    pendingFocus.current = 'editor';
    setNarrowOpen(false);
    editor.keep();
  };

  useLayoutEffect(() => {
    if (initialPop) session.treeScroll = { ...initialPop.treeScroll };
  }, [initialPop, session]);

  // The coordinator reads this synchronously at native entry creation or before
  // selection changes panes. All per-entry snapshots live in that one map.
  useLayoutEffect(() => registerRecallCapture(entryKey, () => ({
    readerScroll: draft ? editor.position.readingScroll : pendingScroll.current ?? (showReader && readerRef.current ? readerRef.current.scrollTop : session.readerScroll),
    treeScroll: showFiles && !searchActive && tree.status === 'ready' && filesRef.current
      ? { top: filesRef.current.scrollTop, left: filesRef.current.scrollLeft } : { ...session.treeScroll },
    narrowOpen, desktopVisible,
   })), [entryKey, registerRecallCapture, showReader, showFiles, tree.status, narrowOpen, desktopVisible, session, Boolean(draft), editor, searchActive]);

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
  useEffect(() => { if (!searchActive) revealAncestors(selection.id); }, [key]);

  useLayoutEffect(() => {
    if (restoreOnEntry.current && !restoreOnEntry.current.replacing) {
      const restoration = restoreOnEntry.current;
      restoration.replacing = true;
      navigate(restoration.excerpt ? contentLocation(restoration.excerpt) : noteLocation(restoration.id), { replace: true });
      return;
    }
    session.lastId = selection.id;
    session.lastExcerpt = excerptRequest;
  }, [key, selection.invalid, navigate, session, excerptRequest]);

  useLayoutEffect(() => {
    const previous = previousEntry.current;
    const hashOnly = previous.pathname === location.pathname && previous.search === location.search && previous.hash !== location.hash;
    previousEntry.current = { key: entryKey, pathname: location.pathname, search: location.search, hash: location.hash };
    if (navigationType === 'INITIAL') return;
    if (previous.key === entryKey && previous.pathname === location.pathname && previous.search === location.search && previous.hash === location.hash) return;
    if (hashOnly) {
      if (delayedFilesFocus.current) {
        if (pendingFocus.current === 'files') pendingFocus.current = null;
        delayedFilesFocus.current = false;
      }
      revealOwner.current = null;
      revealSelection.current = false;
      // A new native fragment inherits the visible note. A traversal restores
      // that exact browser entry, not a different entry with the same URL.
      if (navigationType === 'POP' && recallSnapshot) {
        pendingScroll.current = recallSnapshot.readerScroll;
        session.treeScroll = { ...recallSnapshot.treeScroll };
        setNarrowOpen(recallSnapshot.narrowOpen);
        setDesktopVisible(recallSnapshot.desktopVisible);
        pendingFocus.current = null;
      }
      return;
    }
    revealOwner.current = null;
    delayedFilesFocus.current = false;
    revealSelection.current = !searchActive;
    const restoration = restoreOnEntry.current;
    // Returning through bare /recall replaces its URL; that is not a new-note reset.
    const moved = actionPresentation.current?.key === (key ?? '') ? actionPresentation.current : null;
    pendingScroll.current = moved ? moved.scroll : restoration?.replacing && key === idKey(restoration.id) ? restoration.scroll
      : navigationType === 'POP' ? recallSnapshot?.readerScroll ?? 0 : 0;
    restoreOnEntry.current = null;
    const hashPresentation = navigationType === 'POP' && location.nativeHash ? recallSnapshot : undefined;
    if (navigationType === 'POP' && recallSnapshot) session.treeScroll = { ...recallSnapshot.treeScroll };
    if (navigationType === 'POP') pendingFocus.current = selection.id && !hashPresentation ? 'identity' : null;
    setNarrowOpen(moved ? moved.narrowOpen : hashPresentation?.narrowOpen ?? false);
    if (moved) actionPresentation.current = null;
    if (hashPresentation) setDesktopVisible(hashPresentation.desktopVisible);
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
    if (searchActive && searching.status !== 'ready') return;
    const position = searchActive ? session.search.resultScroll : session.treeScroll;
    filesRef.current.scrollTop = position.top;
    filesRef.current.scrollLeft = position.left;
  }, [entryKey, showFiles, tree.status, session, searchActive, searching.status]);

  useLayoutEffect(() => {
    if (!showFiles || searchActive || !revealSelection.current || tree.status !== 'ready' || !ownsFileView()) return;
    if (!selection.id) { revealSelection.current = false; return; }
    const current = filesRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (current && !current.closest('[hidden]')) {
      current.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      revealSelection.current = false;
      if (!delayedFilesFocus.current) revealOwner.current = null;
    } else if (!revealOwner.current) revealOwner.current = document.activeElement;
  }, [showFiles, tree, key, expanded, searchActive, ownsFileView]);

  useLayoutEffect(() => {
    const supersede = (event: FocusEvent) => {
      if (!revealOwner.current || event.target === revealOwner.current) return;
      revealOwner.current = null;
      revealSelection.current = false;
      if (delayedFilesFocus.current && pendingFocus.current === 'files') pendingFocus.current = null;
      delayedFilesFocus.current = false;
    };
    document.addEventListener('focusin', supersede);
    return () => document.removeEventListener('focusin', supersede);
  }, []);

  useLayoutEffect(() => {
    if (!showReader || pendingScroll.current === null || !readerRef.current) return;
    if (excerptRequest && !draft) return; // wait for verified excerpt height, not the ordinary note read
    // Restore the pane before focus reveal, so it cannot undo that reveal.
    if (pendingScroll.current > 0 && content.status !== 'ready') return;
    readerRef.current.scrollTop = pendingScroll.current;
    session.readerScroll = readerRef.current.scrollTop;
    pendingScroll.current = null;
  }, [showReader, content.status, entryKey, session, Boolean(draft), excerptRequest]);

  const restoreExcerptPosition = useCallback(() => {
    if (!showReader || !readerRef.current || pendingScroll.current === null) return;
    readerRef.current.scrollTop = pendingScroll.current;
    session.readerScroll = readerRef.current.scrollTop;
    pendingScroll.current = null;
  }, [showReader, session]);

  useLayoutEffect(() => {
    // A selection can close Files while Next still displays the outgoing note.
    // Keep its focus intent until the selected entry is actually committed.
    if (isNavigating || fileBusy || !ownsFileView()) return;
    const target = pendingFocus.current;
    if (!target) return;
    const selectedRow = filesRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    const waitingForSelection = target === 'files' && !searchActive && !actionFocus.current && selection.id && !selectedRow &&
      (tree.status === 'loading' || selection.id.slice(0, -1).some((_, index) => {
        const ancestor = idKey(selection.id?.slice(0, index + 1) ?? []);
        return !loadedDirectories.has(ancestor) && !failedDirectories.has(ancestor);
      }));
    if (waitingForSelection && showFiles) {
      const heading = filesHeading.current;
      if (heading && !delayedFilesFocus.current) {
        delayedFilesFocus.current = true;
        revealOwner.current = heading;
        heading.focus({ preventScroll: true });
      }
      return;
    }
    const element = target === 'files'
       ? (searchActive ? Array.from(filesRef.current?.querySelectorAll<HTMLAnchorElement>('.search-result') ?? []).find(row => row.getAttribute('href') === session.search.lastHref) : null)
         ?? (actionFocus.current ? Array.from(filesRef.current?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? []).find(row => row.dataset.entryId === actionFocus.current)?.querySelector<HTMLElement>('.file-row') : null)
        ?? filesRef.current?.querySelector<HTMLElement>('a[aria-current="page"]') ?? filesHeading.current
      : target === 'identity' ? identityRef.current : target === 'editor' ? textareaRef.current : target === 'edit' ? editRef.current : target === 'article' ? articleRef.current : showFiles ? collapseRef.current : expandRef.current;
    if (element && (target !== 'files' || showFiles) && (!['identity', 'editor', 'edit', 'article'].includes(target) || showReader)) {
      if (target === 'editor') restoreEditor(); else { element.focus({ preventScroll: true }); if (target === 'identity') revealEditorWhenClipped(element); }
      if (target === 'files') element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      pendingFocus.current = null;
      actionFocus.current = null;
      delayedFilesFocus.current = false;
      revealOwner.current = null;
    }
  }, [entryKey, isNavigating, fileBusy, showFiles, showReader, desktopVisible, narrowOpen, noteRevision, expanded, editing, searchActive, session, tree, loadedDirectories, failedDirectories, ownsFileView, key]);

  useLayoutEffect(() => {
    document.title = filename ? `${filename} · Recall · Memory Loop`
      : selection.invalid || content.status === 'error' ? 'File unavailable · Recall · Memory Loop' : 'Recall · Memory Loop';
  }, [filename, selection.invalid, content.status]);

  const rememberReader = () => {
    if (draft) return;
    if (isNavigating || !showReader || !readerRef.current || pendingScroll.current !== null) return;
    session.readerScroll = readerRef.current.scrollTop;
    if (!excerptRequest && key) session.normalReaderPositions.set(key, session.readerScroll);
    rememberEntry();
  };

  const openFiles = () => {
    rememberReader();
    if (!searchActive) revealAncestors(selection.id);
    revealOwner.current = null;
    delayedFilesFocus.current = false;
    revealSelection.current = !searchActive;
    pendingFocus.current = 'files';
    if (desktop) setDesktopVisible(true); else { session.narrowClosed = false; setNarrowOpen(true); }
    console.info('recall_files_visibility_changed', { visible: true, trigger: 'user' });
  };

  const closeFiles = () => {
    revealOwner.current = null;
    delayedFilesFocus.current = false;
    revealSelection.current = false;
    pendingFocus.current = 'toggle';
    // Desktop keeps the live reader. Let native anchoring account for its changed
    // layout, and keep recording the resulting real scroll position. Only the
    // hidden narrow reader needs an explicit restoration when it returns.
    if (desktop) rememberReader(); else pendingScroll.current = session.readerScroll;
    if (desktop) setDesktopVisible(false); else { session.narrowClosed = true; setNarrowOpen(false); }
    console.info('recall_files_visibility_changed', { visible: false, trigger: 'user' });
  };

  const selectNote = (id: VaultId) => {
    const owns = admitSelection();
    if (!owns) return;
    if (idKey(id) === key && draft) {
      pendingFocus.current = 'editor';
      setNarrowOpen(false);
      if (showReader) { restoreEditor(); pendingFocus.current = null; }
      return;
    }
    const commit = () => {
    if (!owns()) return;
    rememberEntry();
    rememberReader();
    editor.finish();
    pendingFocus.current = 'identity';
    setNarrowOpen(false);
    if (idKey(id) === key && !excerptRequest) {
      pendingScroll.current = session.readerScroll;
      if (content.status !== 'loading') setNoteRevision(value => value + 1);
      else if (showReader) { identityRef.current?.focus({ preventScroll: true }); pendingFocus.current = null; }
    } else {
      pendingScroll.current = 0;
      actionNavigation.current = true;
      try { navigate(noteLocation(id)); } finally { actionNavigation.current = false; }
    }
    console.info('recall_selection_changed', { trigger: 'file-link' });
    };
    if (editor.request(commit)) commit();
  };

  const selectContent = (request: VaultSearchContextRequest) => {
    const owns = admitSelection();
    if (!owns) return;
    const commit = () => {
      if (!owns()) return;
      rememberEntry(); rememberReader();
      editor.finish();
      excerptFocus.current = true;
      pendingFocus.current = 'identity';
      setNarrowOpen(false);
      pendingScroll.current = 0;
      if (excerptRequest && idKey(excerptRequest.id) === idKey(request.id) && excerptRequest.line === request.line &&
        excerptRequest.version === request.version && excerptRequest.query === request.query) {
        // Next does not create a new entry for this identical address. Refresh
        // the verified context locally instead of leaving an unsettled intent.
        setExcerptRevision(value => value + 1);
        console.info('recall_selection_changed', { trigger: 'current-content-hit' });
        return;
      }
      actionNavigation.current = true;
      try { navigate(contentLocation(request)); } finally { actionNavigation.current = false; }
      console.info('recall_selection_changed', { trigger: 'content-hit' });
    };
    if (editor.request(commit)) commit();
  };

  const openNormal = () => {
    if (!selection.id || !ownsFileView()) return;
    const normalScroll = session.normalReaderPositions.get(idKey(selection.id)) ?? 0;
    actionPresentation.current = { key: idKey(selection.id), scroll: normalScroll, narrowOpen: false };
    pendingFocus.current = 'article';
    setNoteRevision(value => value + 1);
    actionNavigation.current = true;
    try { navigate(noteLocation(selection.id), { replace: true, focus: 'preserve' }); } finally { actionNavigation.current = false; }
  };

  const searchAgain = () => {
    if (!excerptRequest || !ownsFileView()) return;
    session.search.setMode('content');
    session.search.setQuery(excerptRequest.query);
    session.search.invalidate();
    revealSelection.current = false;
    pendingFocus.current = 'files';
    if (desktop) setDesktopVisible(true); else { session.narrowClosed = false; setNarrowOpen(true); }
  };

  const retryAll = () => {
    resetFull();
    editor.clearConfirmed();
    if (tree.status !== 'loading') void refreshDirectoryTree().catch(() => {});
    if (selection.id && content.status !== 'loading') setNoteRevision(value => value + 1);
  };

  const toggleFolder = (folder: string) => {
    const next = new Set(expanded);
    if (next.has(folder)) next.delete(folder); else next.add(folder);
    setExpanded(next);
    console.info('recall_folder_visibility_changed', { expanded: next.has(folder), trigger: 'folder-disclosure' });
  };

  const announcement = selection.invalid ? failureCopy.invalid_request.heading : blocked ? failureCopy[blocked].heading : empty ? 'No files to show'
    : content.status === 'loading' ? 'Opening file…' : content.status === 'ready' ? 'File opened.'
      : content.status === 'error' ? 'File unavailable.' : tree.status === 'loading' ? 'Loading files…' : '';

  const refreshFiles = async () => {
    if (!ownsFileView()) return;
    session.search.invalidate();
    resetFull();
    for (const key of session.directories.listings.keys()) if (key !== '[]') session.directories.listings.delete(key);
    await refreshDirectoryTree();
  };

  const reconcileFiles = async () => {
    await refreshFiles();
    if (!ownsFileView()) return;
    // A read-only reconciliation must not resurrect a stale selected body after
    // an unconfirmed move/delete. An unrelated dirty draft remains untouched.
    if (selection.id && !editor.getSnapshot().draft) {
      editor.clearConfirmed();
      setNoteRevision(value => value + 1);
    }
  };

  const guardFileAction = (request: VaultActionRequest, run: () => void) => {
    if (fileBusyRef.current || !ownsFileView()) return;
    const current = editor.getSnapshot();
    const affects = request.action === 'create-note' || ((request.action === 'move' || request.action === 'delete') &&
      ((selection.id && containsId(request.id, selection.id)) || (current.draft && containsId(request.id, current.draft.id))));
    const proceed = () => {
      if (!ownsFileView()) return;
      affectedAction.current = Boolean(affects);
      uncertainAffectedId.current = (request.action === 'move' || request.action === 'delete') && selection.id && containsId(request.id, selection.id) ? selection.id : null;
      // The guard may discard a draft, but the last acknowledged body/revision
      // still belongs to this note until a confirmed move/delete replaces it.
      if (affects) { rememberReader(); editor.finish(); }
      run();
    };
    if (!affects || editor.request(proceed)) proceed();
  };

  const fileActionSucceeded = async (request: VaultActionRequest, result: VaultActionResponse, owns: () => boolean) => {
    if (!owns()) return false;
    const commitLocation = (href: string, replace = false) => {
      if (!owns()) return;
      actionNavigation.current = true;
      try { navigate(href, { replace }); } finally { actionNavigation.current = false; }
    };
    await refreshFiles();
    if (!owns()) return false;
    if (request.action === 'create-note') {
      // Creation acknowledgement is not a readable/editable note snapshot.
      const created = await readNote(idKey(result.id), new AbortController().signal);
      if (!owns()) return false;
      editor.leave();
      revealAncestors(result.id);
      pendingScroll.current = 0;
      pendingFocus.current = 'editor';
      setNarrowOpen(false);
      editor.start(result.id, created);
      commitLocation(noteLocation(result.id));
    } else if (request.action === 'create-directory') {
      revealAncestors([...result.id, '_']);
      actionFocus.current = idKey(result.id);
      pendingFocus.current = 'files';
    } else if (request.action === 'move') {
      const remap = (id: VaultId): VaultId => containsId(request.id, id) ? [...result.id, ...id.slice(request.id.length)] : id;
      setExpanded(previous => new Set([...previous].map(value => idKey(remap(JSON.parse(value) as VaultId)))));
      revealAncestors(result.id);
      if (selection.id && containsId(request.id, selection.id)) {
        const nextId = remap(selection.id);
        const scroll = draft ? editor.position.readingScroll : excerptRequest ? session.normalReaderPositions.get(key ?? '') ?? 0 : readerRef.current?.scrollTop ?? session.readerScroll;
        session.normalReaderPositions.set(idKey(nextId), scroll);
        actionPresentation.current = { key: idKey(nextId), scroll, narrowOpen };
        editor.leave(); session.lastId = nextId; session.readerScroll = scroll;
        revealAncestors(nextId);
        pendingFocus.current = narrowOpen ? 'files' : 'identity';
        commitLocation(noteLocation(nextId), true);
      } else {
        actionFocus.current = idKey(result.id);
        pendingFocus.current = 'files';
      }
    } else if (request.action === 'delete') {
      setExpanded(previous => new Set([...previous].filter(value => !containsId(request.id, JSON.parse(value) as VaultId))));
      if (selection.id && containsId(request.id, selection.id)) {
        editor.leave(); session.lastId = null; session.readerScroll = 0;
        pendingScroll.current = 0;
        setNarrowOpen(true); session.narrowClosed = false;
        actionPresentation.current = { key: '', scroll: 0, narrowOpen: true };
        commitLocation('/recall', true);
      }
      actionFocus.current = idKey(request.id.slice(0, -1));
      pendingFocus.current = 'files';
    }
    return true;
  };

  return <FileActions tree={tree.status === 'ready' ? tree.data : null} loadFullTree={loadFullTree} guard={guardFileAction} onSuccess={fileActionSucceeded}
    isCurrent={ownsFileView} onUpload={setUploadTrigger}
    refresh={reconcileFiles} onBusy={busy => { fileBusyRef.current = busy; setFileBusy(busy); }} fenced={fileFenced}
    setFenced={fenced => { session.fileActionFenced = fenced; session.fileActionAffectedId = fenced ? uncertainAffectedId.current : null; setFileFenced(fenced); }} unavailable={Boolean(editing.pending) || isNavigating || Boolean(uploadTrigger)}>
    <div className="recall" onKeyDown={event => {
    if (draft && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!event.nativeEvent.isComposing && !event.repeat && !(fileBusyRef.current && affectedAction.current)) void editor.save();
    }
    if (editing.pending && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); keepEditing(); return; }
    if (showFiles && event.key === 'Escape' && filesRef.current?.contains(event.target as Node)) {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (searching.query) { event.stopPropagation(); session.search.setQuery(''); }
      else closeFiles();
    }
  }}>
    <header className="recall-toolbar">
      <RouteHeading route="/recall">Recall</RouteHeading>
      {canBrowse && selection.id && <div className="recall-note-location">
        <p className="note-identity" ref={identityRef} tabIndex={-1} id="note-identity">{filename ?? 'Requested file'}</p>
        {filename && <p className="note-path">{selection.id.join(' / ')}</p>}
      </div>}
      <div className="recall-edit-actions" ref={actionRef} aria-busy={editing.saving || editing.reloading}>
        {selectedFenced && <span className="visually-hidden" id="recall-file-action-fence">Refresh files before editing this note.</span>}
        {draft ? <>
          <button className="recall-button" type="button" disabled={editing.saving || editing.reloading || (fileBusy && affectedAction.current)} onClick={() => {
            const cancel = () => { pendingFocus.current = 'edit'; editor.finish(); };
            if (editor.request(cancel)) cancel();
          }}>Cancel</button>
          <button className="recall-button recall-save" type="button" disabled={!dirty || editing.saving || editing.reloading || Boolean(editing.pending) || editing.fenced || (fileBusy && affectedAction.current)}
            aria-describedby={editing.issue ? 'recall-edit-error' : undefined} onClick={() => void editor.save()}>{editing.saving ? 'Saving…' : 'Save'}</button>
        </> : note.status === 'ready' && note.data.editable ? <button className="recall-button" type="button" ref={editRef}
          disabled={selectedFenced || (fileBusy && affectedAction.current)} aria-describedby={selectedFenced ? 'recall-file-action-fence' : undefined} onClick={() => {
          if (!selection.id) return;
          editor.position.readingScroll = excerptRequest ? session.normalReaderPositions.get(key ?? '') ?? 0 : readerRef.current?.scrollTop ?? session.readerScroll;
          if (excerptRequest) {
            actionNavigation.current = true;
            try { navigate(noteLocation(selection.id), { replace: true, focus: 'preserve' }); } finally { actionNavigation.current = false; }
          }
          pendingFocus.current = 'editor';
          setNarrowOpen(false);
          editor.start(selection.id, note.data);
        }}>Edit</button> : !markdown && file.status === 'ready' && selection.id ? <>
          <p className="read-only-label">{fileKindLabel(file.data)}</p>
          {!selectedFenced && !(fileBusy && affectedAction.current) && <a className="recall-button" href={fileContentLocation(selection.id, true)} download={file.data.name}>Download original</a>}
        </> : note.status === 'ready' ? <p className="read-only-label">Read-only</p> : null}
      </div>
    </header>
    <FileActionRecovery />
    {editing.pending && <section className="recall-discard" aria-labelledby="recall-discard-title" aria-describedby="recall-discard-copy">
      <div><h2 id="recall-discard-title">Discard unsaved changes?</h2><p id="recall-discard-copy">Your changes to “{filename}” haven't been saved.</p></div>
      <div className="recall-confirm-actions"><button className="recall-button" type="button" ref={keepRef} onClick={keepEditing}>Keep editing</button>
        <button className="recall-button recall-discard-action" type="button" onClick={() => editor.discard()}>Discard changes</button></div>
    </section>}
    <div className={editing.notice.includes('Please wait') ? 'recall-notice' : 'visually-hidden'} role="status" aria-live="polite" aria-atomic="true">{editing.notice || (announcement ? `Recall: ${announcement}` : '')}</div>
    {blocked ? <div className="recall-blocking"><Failure code={blocked} retry={retryAll} /></div>
      : <div className={`recall-panes${showFiles && desktop ? ' recall-panes--split' : ''}`}>
          <nav className="recall-files" id="recall-files" aria-label="Vault files" ref={filesRef} hidden={!showFiles}
            aria-busy={tree.status === 'loading'} onScroll={() => {
              if (showFiles && tree.status === 'ready' && filesRef.current) {
                const position = { top: filesRef.current.scrollTop, left: filesRef.current.scrollLeft };
                if (searchActive) { if (searching.status === 'ready') session.search.resultScroll = position; }
                else session.treeScroll = position;
                rememberEntry();
              }
            }}>
            <header className="files-header">
              <h2 ref={filesHeading} tabIndex={-1}>Files</h2>
              <div className="files-header-actions"><FileActionTrigger target={null} /><FilesToggle expanded active={showFiles} ref={collapseRef} onToggle={closeFiles} /></div>
            </header>
            {desktop && selection.id && <button className="pane-jump" type="button" onClick={() => draft ? restoreEditor() : articleRef.current?.focus({ preventScroll: true })}>Skip to file</button>}
            <SearchFiles search={session.search} selected={key} selectFile={selectNote} selectContent={selectContent} dirty={dirty} />
            {!searchActive && <FileBackground>{tree.status === 'loading' ? <p className="files-status">Loading files…</p>
              : tree.status === 'error' ? <Message heading="Couldn't load files" body="The file list couldn't be retrieved. Try again."
                action="Retry files" onAction={() => { void refreshDirectoryTree().catch(() => {}); }} />
                : tree.status === 'ready' && <>
                  {tree.data.entries.length ? <VaultFiles entries={tree.data.entries} selected={key} expanded={expanded}
                    loaded={loadedDirectories} failed={failedDirectories} retry={retryDirectory}
                    toggle={toggleFolder}
                    select={selectNote} /> : <p className="files-status">No files to show</p>}
                </>}</FileBackground>}
          </nav>
          <section className={`recall-reader${draft ? ' recall-reader--editing' : (excerptRequest || !markdown) && selection.id ? ' recall-reader--file' : ''}`} ref={readerRef} hidden={!showReader} aria-label="File reader" onScroll={rememberReader}>
            {showReader && !showFiles && <div className="reader-controls">
              <FilesToggle expanded={false} ref={attachExpand} onToggle={openFiles} />
            </div>}
            {showReader && <div className={`reader-measure${draft ? ' reader-measure--editing' : (excerptRequest || !markdown) && selection.id ? ' reader-measure--file' : ''}`}>
              {selection.invalid || excerpt.invalid ? <Failure code="invalid_request" retry={() => {}} />
                : selection.id ? <>
                  <button className="pane-jump" type="button" onClick={openFiles}>Return to files</button>
                  {draft ? <div className="recall-editor">
                    {editing.issue && <div className="recall-edit-error" id="recall-edit-error" role="alert">
                      <h2>{editing.issue === 'note_conflict' ? 'This note has changed since you opened it.' : editing.issue === 'reload' ? "Couldn't reload this note." : ['transport', 'note_save_uncertain'].includes(editing.issue) ? 'Save not confirmed.' : "Couldn't save this note."}</h2>
                      <p>{editing.issue === 'note_conflict' ? 'Your draft is still here. Copy any changes you want to keep, then reload the saved note.'
                        : editing.issue === 'note_unavailable' || editing.issue === 'note_not_editable' ? 'This note may have moved or is no longer writable. Your draft is still here.'
                          : editing.issue === 'reload' ? 'Your draft is still here. Try reloading again.'
                            : ['transport', 'note_save_uncertain'].includes(editing.issue) ? 'Your draft is still here. Check the connection and try saving again.' : 'Your draft is still here. Try saving again.'}</p>
                      {(editing.fenced || editing.issue === 'reload') && <button className="recall-button" type="button" disabled={editing.reloading} onClick={() => {
                        const reload = () => { void editor.reload(); };
                        if (editor.request(reload)) reload();
                      }}>{editing.reloading ? 'Reloading…' : 'Reload saved note'}</button>}
                    </div>}
                    <div className="recall-editor-label"><label id="recall-markdown-label" htmlFor="recall-markdown">Markdown</label>{dirty && <span>Unsaved changes</span>}</div>
                      <textarea id="recall-markdown" ref={textareaRef} value={draft.markdown} spellCheck={false} aria-labelledby="recall-markdown-label note-identity"
                      aria-describedby={editing.issue ? 'recall-edit-error' : undefined} readOnly={editing.reloading || (fileBusy && affectedAction.current)}
                      onChange={event => editor.change(event.target.value)} onSelect={event => {
                        const field = event.currentTarget;
                        Object.assign(editor.position, { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection });
                      }} onScroll={event => { editor.position.scroll = event.currentTarget.scrollTop; }} />
                  </div> : <article ref={articleRef} tabIndex={-1} aria-labelledby="note-identity" aria-busy={content.status === 'loading'}>
                    {excerptRequest ? <SearchExcerpt key={excerptRevision} request={excerptRequest} active={!isNavigating} markdown={markdown} onNormal={openNormal}
                      headingRef={excerptHeading} focusOnArrival={showReader && navigationType !== 'POP' && excerptFocus.current}
                      onArrivalHandled={excerptArrivalHandled} onLoaded={restoreExcerptPosition} onSearchAgain={searchAgain} isCurrent={ownsFileView} />
                      : content.status === 'loading' ? <p className="note-status">Opening file…</p>
                      : content.status === 'error' ? markdown ? <Failure code={content.error} retry={() => { editor.clearConfirmed(); setNoteRevision(value => value + 1); }} />
                        : <FileFailure code={content.error} retry={() => setNoteRevision(value => value + 1)} />
                        : markdown && note.status === 'ready' ? (note.data.markdown.length
                          ? <MarkdownDocument key={key} markdown={note.data.markdown} media={media} /> : <p className="note-status">This note is empty.</p>)
                          : file.status === 'ready' && <FileViewer key={`${key}:${noteRevision}`} file={file.data} id={selection.id} />}
                  </article>}
                </> : <Message heading="Choose a file" body="Open a folder or choose a file in Files." />}
            </div>}
          </section>
        </div>}
  </div>
    <AttachmentsUpload uploads={session.uploads} trigger={uploadTrigger} isCurrent={ownsFileView} onClose={() => setUploadTrigger(null)}
      onUploaded={async result => { await refreshFiles(); if (ownsFileView()) revealAncestors(result.id); }}
      onRefresh={refreshFiles} onCheckFiles={() => { actionFocus.current = idKey(['06_Attachments']); revealAncestors(['06_Attachments', '_']); openFiles(); }}
      onOpen={result => { if (ownsFileView()) selectNote(result.id); }} />
  </FileActions>;
}
