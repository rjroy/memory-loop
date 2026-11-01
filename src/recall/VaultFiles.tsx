import { useId, useRef } from 'react';
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
}

function Entry({ entry, ...props }: FilesProps & { entry: VaultEntry }) {
  const childrenId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const key = idKey(entry.id);
  const { handlers } = useFileActions(entry);
  if (entry.kind === 'note') {
    return <li><div className="file-entry-row" data-entry-id={key} {...handlers}><a className="file-row file-link" href={noteLocation(entry.id)}
      aria-current={props.selected === key ? 'page' : undefined}
      onFocus={event => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
      onClick={event => { if (plainActivation(event)) { event.preventDefault(); props.select(entry.id); } }}>
      <span>{entry.name}</span>
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
      {entry.children.length ? entry.children.map(child => <Entry key={idKey(child.id)} {...props} entries={entry.children} entry={child} />)
        : <li className="empty-folder">No items to show.</li>}
    </ul>
  </li>;
}

export default function VaultFiles(props: FilesProps) {
  return <ul className="vault-file-list">{props.entries.map(entry => <Entry key={idKey(entry.id)} {...props} entry={entry} />)}</ul>;
}
