import type { VaultEntry, VaultId } from '../../backend/contract';
import { idKey, validId } from './api';

type Leaf = Exclude<VaultEntry, { kind: 'directory' }>;
export interface MediaIndex {
  readonly byPath: ReadonlyMap<string, Leaf>;
  readonly byName: ReadonlyMap<string, readonly Leaf[]>;
}
export interface RecallMediaContext {
  noteId: VaultId;
  index: MediaIndex | null;
  unavailable: boolean;
}
export type MediaSyntax = 'markdown' | 'obsidian';
export type MediaReference =
  | { status: 'file'; entry: Leaf }
  | { status: 'missing' | 'ambiguous' | 'remote' | 'unavailable' };

/** One pass over a loaded tree, shared by every embed in the current Recall view. */
export function createMediaIndex(entries: VaultEntry[]): MediaIndex {
  const byPath = new Map<string, Leaf>(), byName = new Map<string, Leaf[]>();
  const add = (entries: VaultEntry[]) => {
    for (const entry of entries) {
      if (entry.kind === 'directory') add(entry.children);
      else {
        byPath.set(idKey(entry.id), entry);
        const matches = byName.get(entry.name) ?? [];
        matches.push(entry); byName.set(entry.name, matches);
      }
    }
  };
  add(entries);
  return { byPath, byName };
}

/** Decode each path component exactly once; encoded separators never become paths. */
export function resolveMediaReference(index: MediaIndex, noteId: VaultId, reference: string, syntax: MediaSyntax): MediaReference {
  if (/^(?:https?:)?\/\//i.test(reference)) return { status: 'remote' };
  if (!reference.trim() || /^[a-z][a-z0-9+.-]*:/i.test(reference) || /[\\?#\u0000-\u001f\u007f]/.test(reference)) return { status: 'unavailable' };
  const root = reference.startsWith('/');
  const raw = (root ? reference.slice(1) : reference).split('/');
  let parts: string[];
  try { parts = raw.map(part => decodeURIComponent(part)); } catch { return { status: 'unavailable' }; }
  if (parts.some(part => !part || /[/\\\u0000-\u001f\u007f]/.test(part)) || /^[a-z][a-z0-9+.-]*:/i.test(parts[0])) return { status: 'unavailable' };
  const relative = parts[0] === '.' || parts[0] === '..';
  if (syntax === 'obsidian' && !root && !relative && parts.length === 1) {
    if (!validId(parts)) return { status: 'unavailable' };
    const matches = index.byName.get(parts[0]) ?? [];
    return matches.length > 1 ? { status: 'ambiguous' } : matches.length === 1 ? { status: 'file', entry: matches[0] } : { status: 'missing' };
  }
  const id = root || (syntax === 'obsidian' && !relative) ? [] : [...noteId.slice(0, -1)];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') { if (!id.length) return { status: 'unavailable' }; id.pop(); }
    else id.push(part);
  }
  if (!validId(id)) return { status: 'unavailable' };
  const entry = index.byPath.get(idKey(id));
  return entry ? { status: 'file', entry } : { status: 'missing' };
}
