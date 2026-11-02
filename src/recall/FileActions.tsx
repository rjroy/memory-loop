import { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { VaultAction as VaultActionRequest, VaultActionResponse, VaultEntry, VaultId, VaultTreeResponse } from '../../backend/contract';
import { isVaultComponent } from '../../backend/contract';
import { actOnFiles, containsId, failureCopy, idKey, RecallReadError } from './api';

type Action = 'create-note' | 'create-directory' | 'move' | 'delete';
type Target = VaultEntry | null;
interface Menu { target: Target; trigger: HTMLElement; x: number; y: number }
interface Form { action: Action; target: Target; trigger: HTMLElement }
interface Context {
  menu: Menu | null;
  menuId: string;
  disabled: boolean;
  fenced: boolean;
  busy: boolean;
  formOpen: boolean;
  recoveryIssue: string;
  reconcile: () => Promise<void>;
  open: (target: Target, trigger: HTMLElement, point?: { x: number; y: number }) => void;
}
const Actions = createContext<Context | null>(null);

// Both entry points use these definitions; future commands add a definition here.
const definitions: { action: Action | 'upload'; label: (target: Target) => string; applies: (target: Target) => boolean }[] = [
  { action: 'create-note', label: () => 'New file…', applies: target => !target || target.kind === 'directory' },
  { action: 'create-directory', label: () => 'New folder…', applies: target => !target || target.kind === 'directory' },
  { action: 'upload', label: () => 'Upload files…', applies: target => !target },
  { action: 'move', label: () => 'Move…', applies: target => Boolean(target) },
  { action: 'delete', label: target => target?.kind === 'directory' ? 'Delete empty folder…' : 'Delete file…', applies: target => Boolean(target) },
];

export function useFileActions(target: Target) {
  const context = useContext(Actions);
  const triggerFor = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): HTMLElement =>
    (event.target as HTMLElement).closest<HTMLElement>('button, a') ??
    event.currentTarget.closest('.recall-files')?.querySelector<HTMLElement>('[aria-label="Vault actions"]') ?? event.currentTarget;
  const handlers = {
    onContextMenu(event: MouseEvent<HTMLElement>) {
      if (!context || context.disabled) return;
      event.preventDefault(); event.stopPropagation();
      context.open(target, triggerFor(event), { x: event.clientX, y: event.clientY });
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (!context || context.disabled || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
      event.preventDefault(); event.stopPropagation(); context.open(target, triggerFor(event));
    },
  };
  return { context, handlers };
}

export function FileActionTrigger({ target }: { target: Target }) {
  const { context, handlers } = useFileActions(target);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);
  if (!context) return null;
  const label = target ? `Actions for ${target.name}` : 'Vault actions';
  return <span className="file-action-control" data-tooltip-dismissed={tooltipDismissed || undefined} onPointerEnter={() => setTooltipDismissed(false)}
    onFocus={() => setTooltipDismissed(false)}><button type="button" className="file-action-trigger" aria-label={label}
    aria-haspopup="menu" aria-expanded={Boolean(context.menu && context.menu.target === target)} disabled={context.disabled}
    aria-controls={context.menu?.target === target ? context.menuId : undefined}
    {...handlers} onKeyDown={event => {
      if (event.key === 'Escape' && !tooltipDismissed) { event.preventDefault(); event.stopPropagation(); setTooltipDismissed(true); }
      else handlers.onKeyDown(event);
    }} onClick={event => context.open(target, event.currentTarget)}>
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.4" fill="currentColor" /><circle cx="10" cy="10" r="1.4" fill="currentColor" /><circle cx="16" cy="10" r="1.4" fill="currentColor" /></svg>
  </button><span className="file-action-tooltip" aria-hidden="true">{label}</span></span>;
}

export function FileBackground({ children }: { children: ReactNode }) {
  const { handlers } = useFileActions(null);
  return <div className="files-content" {...handlers}>{children}</div>;
}

export function FileActionRecovery() {
  const context = useContext(Actions);
  if (!context?.fenced || context.formOpen) return null;
  return <div className="recall-notice recall-action-recovery" role="status"><p>{context.recoveryIssue || 'File action not confirmed. Refresh files before trying another action.'}</p>
    <button className="recall-button" type="button" disabled={context.busy} onClick={() => void context.reconcile()}>Refresh files</button></div>;
}

function FolderChoices({ entries, source, destination, choose, busy }: {
  entries: VaultEntry[]; source: VaultEntry; destination: VaultId | null; choose: (id: VaultId, identity: string) => void; busy: boolean;
}) {
  return <ul className="destination-list">{entries.filter(entry => entry.kind === 'directory' &&
    !(source.kind === 'directory' && containsId(source.id, entry.id))).map(entry => entry.kind === 'directory' &&
    <li key={idKey(entry.id)}>
      <label className="destination-choice"><input type="radio" name="destination" disabled={busy || idKey(entry.id) === idKey(source.id.slice(0, -1))}
        checked={destination !== null && idKey(destination) === idKey(entry.id)} onChange={() => choose(entry.id, entry.identity)} />
        <span>{entry.name}{idKey(entry.id) === idKey(source.id.slice(0, -1)) && <small>Already in this folder.</small>}</span></label>
      {entry.children.some(child => child.kind === 'directory') && <details className="destination-children"><summary>Folders in {entry.name}</summary>
        <FolderChoices entries={entry.children} source={source} destination={destination} choose={choose} busy={busy} /></details>}
    </li>)}</ul>;
}

interface Props {
  children: ReactNode;
  tree: VaultTreeResponse | null;
  loadFullTree: () => Promise<VaultTreeResponse>;
  guard: (request: VaultActionRequest, run: () => void) => void;
  onSuccess: (request: VaultActionRequest, result: VaultActionResponse, isCurrent: () => boolean) => Promise<boolean>;
  isCurrent: () => boolean;
  refresh: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  fenced: boolean;
  setFenced: (fenced: boolean) => void;
  unavailable: boolean;
  onUpload?: (trigger: HTMLElement) => void;
}

export default function FileActions({ children, tree, loadFullTree, guard, onSuccess, isCurrent, refresh, onBusy, fenced, setFenced, unavailable, onUpload }: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [moveTree, setMoveTree] = useState<VaultTreeResponse | null>(null);
  const [name, setName] = useState('');
  const [destination, setDestination] = useState<{ id: VaultId; identity: string } | null>(null);
  const [issue, setIssue] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshOnly, setRefreshOnly] = useState(false);
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const issueRef = useRef<HTMLParagraphElement>(null);
  const revealFailure = useRef(false);
  const titleId = useId();
  const menuId = useId();
  const issueId = useId();
  const owner = useRef(true);
  const operation = useRef(0);
  useLayoutEffect(() => { owner.current = true; return () => { owner.current = false; operation.current++; }; }, []);

  const open: Context['open'] = (target, trigger, point) => {
    if (lock.current || form || fenced || unavailable || !tree) return;
    const bounds = trigger.getBoundingClientRect();
    setMenu({ target, trigger, x: point?.x ?? bounds.right, y: point?.y ?? bounds.bottom });
  };
  const dismissMenu = (restore = true) => {
    if (restore && menu?.trigger.isConnected) menu.trigger.focus({ preventScroll: true });
    setMenu(null);
  };
  const dismissForm = () => {
    if (lock.current) return;
    operation.current++;
    const trigger = form?.trigger;
    dialog.current?.close?.(); setForm(null); setIssue(''); setRefreshOnly(false);
    if (trigger?.isConnected) { trigger.focus({ preventScroll: true }); trigger.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  };

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const element = menuRef.current;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
    element.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) setMenu(null); };
    const hide = () => setMenu(null);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', hide);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', hide); };
  }, [menu]);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!form || !element) return;
    if (!element.open) {
      if (typeof element.showModal === 'function') element.showModal(); else element.setAttribute('open', '');
      const field = busy ? element : form.action.startsWith('create') ? inputRef.current : cancelRef.current;
      field?.focus({ preventScroll: true });
      field?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }, [form, busy]);

  useLayoutEffect(() => {
    const content = contentRef.current, message = issueRef.current;
    if (!revealFailure.current || busy || !issue || !content || !message) return;
    revealFailure.current = false;
    const bounds = content.getBoundingClientRect(), error = message.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = Math.max(bounds.top + content.clientTop, viewport?.offsetTop ?? 0);
    const bottom = Math.min(bounds.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight));
    const firstLine = Math.min(error.height, parseFloat(getComputedStyle(message).lineHeight));
    if (error.top < top || error.top + firstLine > bottom) {
      // Reveal only inside the dialog; preserve focus and the page/pane scroll.
      content.scrollTop += error.top - top;
    }
  }, [form, busy, issue]);

  const run = async (request: VaultActionRequest, captured: Form) => {
    if (lock.current || !owner.current || !isCurrent()) return;
    const sequence = ++operation.current;
    const owns = () => owner.current && operation.current === sequence && isCurrent();
    lock.current = true; onBusy(true); setBusy(true); setIssue(''); setForm(captured);
    let confirmed = false;
    try {
      const result = await actOnFiles(request);
      if (!owns()) return;
      confirmed = true;
      const applied = await onSuccess(request, result, owns);
      if (!applied || !owner.current || operation.current !== sequence) return;
      dialog.current?.close?.(); setForm(null);
    } catch (error: unknown) {
      if (!owns()) return;
      revealFailure.current = true;
      const code = error instanceof RecallReadError ? error.code : 'file_action_uncertain';
      if (confirmed) {
        setForm(captured);
        setIssue("Action completed. Couldn't refresh files or open the note. Refresh files to continue.");
        setRefreshOnly(true); setFenced(true);
      } else if (code === 'file_action_uncertain' || code === 'transport') {
        const noun = request.action === 'delete' ? 'Deletion' : request.action === 'move' ? 'Move' : 'Creation';
        setIssue(`${noun} not confirmed. Refresh files to check what happened before trying again.`);
        setRefreshOnly(true); setFenced(true);
      } else {
        setIssue(code === 'invalid_request' ? 'Check the name and destination, then try again.' : failureCopy[code]?.body ?? "The action couldn't be completed. Refresh files before trying again.");
        if (code === 'entry_conflict' || code === 'entry_unavailable') setRefreshOnly(true);
      }
    } finally {
      lock.current = false;
      if (owner.current) { setBusy(false); onBusy(false); }
    }
  };

  const submit = () => {
    if (!form || !tree || lock.current || refreshOnly || fenced || unavailable || !isCurrent()) return;
    let request: VaultActionRequest;
    if (form.action === 'create-note' || form.action === 'create-directory') {
      if (!isVaultComponent(name) || !name.trim()) { setIssue('Enter a name without slashes or a leading dot.'); inputRef.current?.focus(); return; }
      let filename = name;
      if (form.action === 'create-note') {
        if (!filename.endsWith('.md') && filename.includes('.')) { setIssue('Use a .md file name.'); inputRef.current?.focus(); return; }
        if (!filename.endsWith('.md')) filename += '.md';
      }
      if (new TextEncoder().encode(filename).length > 255) { setIssue('This name is too long. Use a shorter name.'); inputRef.current?.focus(); return; }
      request = { action: form.action, parentId: form.target?.id ?? [], expectedParentIdentity: form.target?.identity ?? tree.rootIdentity, name: filename };
    } else {
      if (!form.target) return;
      if (form.action === 'move') {
        if (!destination) { setIssue('Choose a destination folder.'); return; }
        request = { action: 'move', kind: form.target.kind, id: form.target.id, expectedVersion: form.target.version,
          destinationParentId: destination.id, expectedDestinationIdentity: destination.identity };
      } else request = { action: 'delete', kind: form.target.kind, id: form.target.id, expectedVersion: form.target.version };
    }
    const captured = form;
    // Close the modal before n72 presents its inline dirty guard. The original
    // command is held once; Keep editing cannot accidentally submit it later.
    dialog.current?.close?.(); setForm(null);
    guard(request, () => { void run(request, captured); });
  };

  const reconcile = async () => {
    if (lock.current || !isCurrent()) return;
    lock.current = true; setBusy(true); onBusy(true);
    try {
      await refresh();
      if (!owner.current || !isCurrent()) return;
      setFenced(false); setIssue(''); setRefreshOnly(false);
      dialog.current?.close?.(); setForm(null);
    } catch { if (owner.current && isCurrent()) { revealFailure.current = true; setIssue("Couldn't refresh files. Check the connection and try again."); } }
    finally { lock.current = false; if (owner.current) { setBusy(false); onBusy(false); } }
  };

  const creation = form?.action === 'create-note' || form?.action === 'create-directory';
  const folder = creation ? form?.action === 'create-directory' : form?.target?.kind === 'directory';
  const label = form?.action === 'delete' ? (folder ? 'Delete empty folder' : 'Delete file')
    : form?.action === 'move' ? (folder ? 'Move folder' : 'Move file') : folder ? 'Create folder' : 'Create file';
  const callbacks = useRef({ reconcile, open });
  callbacks.current = { reconcile, open };
  const disabled = busy || fenced || unavailable || !tree;
  const formOpen = Boolean(form);
  const context = useMemo<Context>(() => ({ menu, menuId, disabled, fenced, busy, formOpen, recoveryIssue: issue,
    reconcile: () => callbacks.current.reconcile(), open: (target, trigger, point) => callbacks.current.open(target, trigger, point),
  }), [menu, menuId, disabled, fenced, busy, formOpen, issue]);
  return <Actions.Provider value={context}>
    {children}
    {menu && createPortal(<div ref={menuRef} id={menuId} className="recall-action-menu" role="menu" aria-label={menu.target ? `Actions for ${menu.target.name}` : 'Vault actions'}
      style={{ left: menu.x, top: menu.y }} onKeyDown={event => {
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissMenu(); }
        else if (event.key === 'Tab') dismissMenu();
      }}>
      {definitions.filter(item => item.applies(menu.target) && (item.action !== 'upload' || onUpload)).map(item => <button key={item.action} role="menuitem" type="button"
        className={item.action === 'delete' ? 'file-menu-delete' : ''} onClick={() => {
          if (item.action === 'upload') { dismissMenu(false); onUpload?.(menu.trigger); return; }
          setForm({ action: item.action, target: menu.target, trigger: menu.trigger }); setName(''); setDestination(null); setIssue(''); setRefreshOnly(false); dismissMenu(false);
          if (item.action === 'move') {
            setMoveTree(null);
            const sequence = operation.current;
            void loadFullTree().then(value => { if (owner.current && operation.current === sequence && isCurrent()) setMoveTree(value); }, () => { if (owner.current && operation.current === sequence && isCurrent()) setIssue("Couldn't load folders. Close and try again."); });
          }
        }}>{item.label(menu.target)}</button>)}
    </div>, document.body)}
    {form && <dialog ref={dialog} tabIndex={-1} className="recall-action-dialog" aria-labelledby={titleId} aria-describedby={issue ? issueId : undefined}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); dismissForm(); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissForm(); } }}>
      <form onSubmit={event => { event.preventDefault(); submit(); }} aria-busy={busy}>
        <div ref={contentRef} className="action-dialog-content">
        <h2 id={titleId}>{form.action === 'delete' ? `${folder ? 'Delete empty folder' : 'Delete'} “${form.target?.name}”?` : form.action === 'move' ? label : folder ? 'New folder' : 'New file'}</h2>
        <p className="action-location">{form.target?.id.join(' / ') || 'Vault root'}</p>
        {creation ? <div className="action-name-field"><label htmlFor={`${titleId}-name`}>{folder ? 'Folder name' : 'File name'}</label>
          <input ref={inputRef} id={`${titleId}-name`} value={name} disabled={busy || refreshOnly} autoComplete="off" spellCheck={false}
            aria-invalid={Boolean(issue)} aria-describedby={!folder ? `${titleId}-help` : undefined} onChange={event => { setName(event.target.value); setIssue(''); }} />
          {!folder && <p id={`${titleId}-help`} className="action-help">.md is added if omitted.</p>}</div>
          : form.action === 'move' && form.target ? <>
            {folder && <p>Moves this folder and everything inside it.</p>}
            <fieldset className="destination-picker" disabled={busy || refreshOnly || !moveTree}><legend>Destination folder</legend>
              <label className="destination-choice"><input type="radio" name="destination" disabled={form.target.id.length === 1}
                checked={destination?.id.length === 0} onChange={() => setDestination({ id: [], identity: tree!.rootIdentity })} /><span>Vault root{form.target.id.length === 1 && <small>Already in this folder.</small>}</span></label>
              <FolderChoices entries={moveTree?.entries ?? []} source={form.target} destination={destination?.id ?? null}
                choose={(id, identity) => setDestination({ id, identity })} busy={busy || refreshOnly} />
            </fieldset>
            {destination && <p className="action-help">Destination: {destination.id.join(' / ') || 'Vault root'}</p>}
          </> : <p>{folder ? 'Only an empty folder can be deleted. There is no undo.' : 'This permanently deletes the file. There is no undo.'}</p>}
        {issue && <p ref={issueRef} id={issueId} className="action-error" role="alert">{issue}</p>}
        </div>
        <div className="recall-confirm-actions action-dialog-buttons">
          <button ref={cancelRef} className="recall-button" type="button" disabled={busy} onClick={dismissForm}>Cancel</button>
          {refreshOnly || fenced ? <button className="recall-button" type="button" disabled={busy} onClick={() => void reconcile()}>{busy ? 'Refreshing…' : 'Refresh files'}</button>
            : <button className={`recall-button ${form.action === 'delete' ? 'recall-discard-action' : 'recall-save'}`} type="submit"
              disabled={busy || unavailable || (form.action === 'move' && !destination)}>{busy ? form.action === 'delete' ? 'Deleting…' : form.action === 'move' ? 'Moving…' : 'Creating…' : label}</button>}
        </div>
      </form>
    </dialog>}
  </Actions.Provider>;
}
