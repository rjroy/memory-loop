import { isVaultComponent, isVaultErrorCode, isVaultId, type VaultEntry, type VaultErrorCode, type VaultId, type VaultNoteResponse, type VaultTreeResponse, type VaultSaveRequest, type VaultSaveResponse } from '../../backend/contract';

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
      idKey(entry.id) !== idKey([...parent, entry.name])) return false;
    if (entry.kind === 'note') return entry.name.endsWith('.md');
    return entry.kind === 'directory' && entriesValid(entry.children, entry.id);
  });
  return record(value) && entriesValid(value.entries, []);
}

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
  transport: { heading: 'Vault service unavailable', body: "Recall couldn't reach the vault service. Check the local service and try again.", action: 'Try again' },
};
