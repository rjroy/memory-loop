import { isVaultComponent, isVaultErrorCode, isVaultId, type VaultEntry, type VaultErrorCode, type VaultId, type VaultNoteResponse, type VaultTreeResponse, type VaultSaveRequest, type VaultSaveResponse, type VaultAction as VaultActionRequest, type VaultActionResponse } from '../../backend/contract';

export type RecallFailure = VaultErrorCode | 'transport';

export class RecallReadError extends Error {
  constructor(readonly code: RecallFailure) {
    super('Vault read failed');
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { isVaultId as validId } from '../../backend/contract';

export function idKey(id: VaultId): string { return JSON.stringify(id); }

export function noteLocation(id: VaultId): string {
  return `/recall?${new URLSearchParams({ file: idKey(id) })}`;
}

export function selectionFromSearch(search: string): { id: VaultId | null; invalid: boolean } {
  const values = new URLSearchParams(search).getAll('file');
  if (values.length === 0) return { id: null, invalid: false };
  if (values.length !== 1) return { id: null, invalid: true };
  try {
    const id: unknown = JSON.parse(values[0]);
    if (isVaultId(id) && id.at(-1)!.endsWith('.md')) return { id, invalid: false };
  } catch { /* Malformed client addresses never become filesystem requests. */ }
  return { id: null, invalid: true };
}

function isTree(value: unknown): value is VaultTreeResponse {
  const entriesValid = (entries: unknown, parent: VaultId): boolean => Array.isArray(entries) && entries.every(entry => {
    if (!record(entry) || !isVaultComponent(entry.name) || !isVaultId(entry.id) ||
      !opaque(entry.identity) || !opaque(entry.version) ||
      idKey(entry.id) !== idKey([...parent, entry.name])) return false;
    if (entry.kind === 'note') return entry.name.endsWith('.md');
    return entry.kind === 'directory' && entriesValid(entry.children, entry.id);
  });
  return record(value) && opaque(value.rootIdentity) && entriesValid(value.entries, []);
}

function opaque(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512; }

let readSequence = 0;

async function request<T>(url: string, operation: 'tree' | 'note', signal: AbortSignal, validate: (value: unknown) => value is T): Promise<T> {
  const requestId = ++readSequence;
  console.info('vault_read_attempt', { operation, requestId });
  let outcome: RecallFailure | 'loaded' | 'abandoned' = 'transport';
  try {
    const response = await fetch(url, { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (mime !== 'application/json') throw new RecallReadError('transport');
    const body: unknown = await response.json();
    if (!response.ok) {
      if (record(body) && record(body.error) && isVaultErrorCode(body.error.code)) {
        throw new RecallReadError(body.error.code);
      }
      throw new RecallReadError('transport');
    }
    if (!validate(body)) throw new RecallReadError('transport');
    outcome = 'loaded';
    return body;
  } catch (error: unknown) {
    if (error instanceof RecallReadError) { outcome = error.code; throw error; }
    throw new RecallReadError('transport');
  } finally {
    if (signal.aborted) outcome = 'abandoned';
    // Do not log URLs, IDs, filenames, config paths, note text or raw exceptions.
    console.info('vault_read_outcome', { operation, requestId, status: outcome });
  }
}

export function readTree(_key: string, signal: AbortSignal): Promise<VaultTreeResponse> {
  return request('/api/vault/tree', 'tree', signal, isTree);
}

export function readNote(key: string, signal: AbortSignal): Promise<VaultNoteResponse> {
  const id: unknown = JSON.parse(key);
  if (!isVaultId(id)) return Promise.reject(new RecallReadError('invalid_request'));
  return request(`/api/vault/note?${new URLSearchParams({ id: key })}`, 'note', signal,
    (value): value is VaultNoteResponse => record(value) && isVaultComponent(value.name) &&
      value.name === id.at(-1) && typeof value.markdown === 'string' &&
      typeof value.revision === 'string' && value.revision.length > 0 && value.revision.length <= 128 && typeof value.editable === 'boolean');
}

/** A lost/malformed acknowledgement is uncertain, never evidence of no write. */
export async function saveNote(body: VaultSaveRequest): Promise<VaultSaveResponse> {
  const requestId = ++readSequence;
  let outcome: RecallFailure | 'saved' = 'note_save_uncertain';
  console.info('vault_save_attempt', { requestId });
  try {
    const response = await fetch('/api/vault/note', { method: 'POST', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new RecallReadError('note_save_uncertain');
    const value: unknown = await response.json();
    if (!response.ok) {
      if (record(value) && record(value.error) && isVaultErrorCode(value.error.code)) throw new RecallReadError(value.error.code);
      throw new RecallReadError('note_save_uncertain');
    }
    if (!record(value) || typeof value.revision !== 'string' || !value.revision.length || value.revision.length > 128) throw new RecallReadError('note_save_uncertain');
    outcome = 'saved';
    return { revision: value.revision };
  } catch (error: unknown) {
    if (error instanceof RecallReadError) { outcome = error.code; throw error; }
    throw new RecallReadError('note_save_uncertain');
  } finally { console.info('vault_save_outcome', { requestId, status: outcome }); }
}

/** Only an explicit call mutates. Missing acknowledgement never schedules a retry. */
export async function actOnFiles(body: VaultActionRequest): Promise<VaultActionResponse> {
  const requestId = ++readSequence;
  let outcome: RecallFailure | 'confirmed' = 'file_action_uncertain';
  console.info('vault_action_attempt', { requestId, action: body.action });
  try {
    const response = await fetch('/api/vault/actions', { method: 'POST', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new RecallReadError('file_action_uncertain');
    const value: unknown = await response.json();
    if (!response.ok) {
      if (record(value) && record(value.error) && isVaultErrorCode(value.error.code)) throw new RecallReadError(value.error.code);
      throw new RecallReadError('file_action_uncertain');
    }
    const expected = body.action === 'create-note' || body.action === 'create-directory' ? [...body.parentId, body.name]
      : body.action === 'move' ? [...body.destinationParentId, body.id.at(-1)!] : body.action === 'delete' ? body.id : [];
    if (!record(value) || !isVaultId(value.id) || idKey(value.id) !== idKey(expected) ||
      (body.action === 'create-note' && !opaque(value.revision))) throw new RecallReadError('file_action_uncertain');
    outcome = 'confirmed';
    return value as unknown as VaultActionResponse;
  } catch (error: unknown) {
    if (error instanceof RecallReadError) { outcome = error.code; throw error; }
    throw new RecallReadError('file_action_uncertain');
  } finally { console.info('vault_action_outcome', { requestId, action: body.action, status: outcome }); }
}

export function containsId(parent: VaultId, id: VaultId): boolean { return parent.length <= id.length && parent.every((part, index) => part === id[index]); }

export function findEntry(entries: VaultEntry[], id: VaultId): VaultEntry | undefined {
  for (const entry of entries) {
    if (idKey(entry.id) === idKey(id)) return entry;
    if (entry.kind === 'directory') { const found = findEntry(entry.children, id); if (found) return found; }
  }
}

export function findNote(entries: VaultEntry[], id: VaultId): VaultEntry | undefined {
  const key = idKey(id);
  for (const entry of entries) {
    if (entry.kind === 'note' && idKey(entry.id) === key) return entry;
    if (entry.kind === 'directory') {
      const match = findNote(entry.children, id);
      if (match) return match;
    }
  }
}

export const failureCopy: Record<RecallFailure, { heading: string; body: string; action: string }> = {
  config_missing: { heading: 'Vault not configured', body: 'Set the vault directory in the JSON config, then restart Memory Loop.', action: 'Check again' },
  config_invalid: { heading: 'Vault configuration is invalid', body: 'Check the JSON configuration and vault directory, then restart Memory Loop.', action: 'Check again' },
  vault_unavailable: { heading: 'Vault unavailable', body: "Memory Loop can't read the configured vault. Check that it exists and is readable, then try again.", action: 'Try again' },
  note_unavailable: { heading: 'Note unavailable', body: "This note may have moved, been removed, or can't be read. Choose another file or try again.", action: 'Retry note' },
  invalid_request: { heading: 'Note address is invalid', body: 'Choose a Markdown note from Files.', action: '' },
  note_conflict: { heading: 'Note changed', body: 'The note changed since it was read.', action: 'Retry note' },
  note_not_editable: { heading: 'Note cannot be edited', body: 'This note can still be viewed.', action: 'Retry note' },
  note_save_unavailable: { heading: 'Save unavailable', body: 'The note could not be saved.', action: 'Retry note' },
  note_save_uncertain: { heading: 'Save outcome uncertain', body: 'Check the note before trying again.', action: 'Retry note' },
  entry_unavailable: { heading: 'Item unavailable', body: 'This item may have moved or been removed. Refresh files.', action: 'Refresh files' },
  entry_conflict: { heading: 'Item changed', body: 'This item has changed. Refresh files before trying again.', action: 'Refresh files' },
  entry_exists: { heading: 'Name already exists', body: 'An item with this name already exists in that folder. Choose another name or folder.', action: 'Refresh files' },
  folder_not_empty: { heading: 'Folder not empty', body: "This folder isn't empty. Only empty folders can be deleted.", action: 'Refresh files' },
  move_cross_device: { heading: 'Move unavailable', body: 'These folders are on different filesystems. Choose another folder.', action: 'Refresh files' },
  move_unsupported: { heading: 'Move unavailable', body: 'Safe moves are not supported by this vault service.', action: 'Refresh files' },
  file_action_unavailable: { heading: 'Action unavailable', body: "The action couldn't be completed. Refresh files before trying again.", action: 'Refresh files' },
  file_action_uncertain: { heading: 'Action not confirmed', body: 'Refresh files to check what happened before trying again.', action: 'Refresh files' },
  transport: { heading: 'Vault service unavailable', body: "Recall couldn't reach the vault service. Check the local service and try again.", action: 'Try again' },
};
