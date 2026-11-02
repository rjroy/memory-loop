import { memo, useCallback, useId, useRef } from 'react';
import type { MouseEvent } from 'react';
import type { VaultEntry, VaultId } from '../../backend/contract';
import { idKey, noteLocation } from './api';
import { FileActionTrigger, useFileActions } from './FileActions';

export function plainActivation(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

interface FilesProps {
  entries: VaultEntry[];
  selected: string | null;
  expanded: Set<string>;
  toggle: (key: string) => void;
  select: (id: VaultId) => void;
  loaded?: ReadonlySet<string>;
  failed?: ReadonlySet<string>;
  retry?: (key: string) => void;
}

const Entry = memo(function Entry({ entry, ...props }: FilesProps & { entry: VaultEntry }) {
  const childrenId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const key = idKey(entry.id);
  const { handlers } = useFileActions(entry);
  if (entry.kind !== 'directory') {
    return <li><div className="file-entry-row" data-entry-id={key} {...handlers}><a className={`file-row file-link${entry.kind === 'file' ? ' file-link--file' : ''}`} href={noteLocation(entry.id)}
      aria-current={props.selected === key ? 'page' : undefined}
      onFocus={event => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
      onClick={event => { if (plainActivation(event)) { event.preventDefault(); props.select(entry.id); } }}>
      {entry.kind === 'file' && <svg className="file-kind-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 1.5h5l4 4v9h-9z M8.5 1.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      </svg>}<span>{entry.name}</span>
    </a><FileActionTrigger target={entry} /></div></li>;
  }
  const open = props.expanded.has(key);
  return <li>
    <div className="file-entry-row" data-entry-id={key} {...handlers}><button className="file-row folder-disclosure" type="button" aria-expanded={open} aria-controls={childrenId}
      onFocus={event => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
      onClick={event => {
        if (open && listRef.current?.contains(document.activeElement)) event.currentTarget.focus();
        props.toggle(key);
      }}>
      <svg className="folder-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      <span>{entry.name}</span>
    </button><FileActionTrigger target={entry} /></div>
    <ul id={childrenId} ref={listRef} hidden={!open}>
      {open && (props.failed?.has(key) ? <li className="empty-folder">Couldn't load folder. <button type="button" onClick={() => props.retry?.(key)}>Retry</button></li>
        : props.loaded && !props.loaded.has(key) ? <li className="empty-folder">Loading files…</li>
        : entry.children.length ? entry.children.map(child => <Entry key={idKey(child.id)} {...props} entries={entry.children} entry={child} />)
          : <li className="empty-folder">No items to show.</li>)}
    </ul>
  </li>;
}, (previous, next) => {
  if (previous.entry !== next.entry || previous.expanded !== next.expanded || previous.toggle !== next.toggle || previous.select !== next.select || previous.loaded !== next.loaded || previous.failed !== next.failed || previous.retry !== next.retry) return false;
  const affects = (selected: string | null) => selected !== null && (previous.entry.kind === 'directory'
    ? selected.startsWith(`${idKey(previous.entry.id).slice(0, -1)},`) : selected === idKey(previous.entry.id));
  return previous.selected === next.selected || (!affects(previous.selected) && !affects(next.selected));
});

export default function VaultFiles(props: FilesProps) {
  const current = useRef(props);
  current.current = props;
  const select = useCallback((id: VaultId) => current.current.select(id), []);
  const toggle = useCallback((key: string) => current.current.toggle(key), []);
  return <ul className="vault-file-list">{props.entries.map(entry => <Entry key={idKey(entry.id)} {...props} toggle={toggle} select={select} entry={entry} />)}</ul>;
}
