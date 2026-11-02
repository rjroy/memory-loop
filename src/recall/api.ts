import { isUploadName, isVaultComponent, isVaultDirectoryId, isVaultErrorCode, isVaultId, type VaultUploadLimit, type VaultUploadResponse, type VaultEntry, type VaultDirectoryResponse, type VaultErrorCode, type VaultId, type VaultNoteResponse, type VaultFileResponse, type VaultTreeResponse, type VaultSaveRequest, type VaultSaveResponse, type VaultAction as VaultActionRequest, type VaultActionResponse } from '../../backend/contract';

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

/** Content always crosses the same-origin vault boundary, never a source-supplied URL. */
export function fileContentLocation(id: VaultId, download = false): string {
  const params = new URLSearchParams({ id: idKey(id) });
  if (download) params.set('download', '1');
  return `/api/vault/content?${params}`;
}

export function selectionFromSearch(search: string): { id: VaultId | null; invalid: boolean } {
  const values = new URLSearchParams(search).getAll('file');
  if (values.length === 0) return { id: null, invalid: false };
  if (values.length !== 1) return { id: null, invalid: true };
  try {
    const id: unknown = JSON.parse(values[0]);
    if (isVaultId(id)) return { id, invalid: false };
  } catch { /* Malformed client addresses never become filesystem requests. */ }
  return { id: null, invalid: true };
}

function isTree(value: unknown): value is VaultTreeResponse {
  const entriesValid = (entries: unknown, parent: VaultId): boolean => Array.isArray(entries) && entries.every(entry => {
    if (!record(entry) || !isVaultComponent(entry.name) || !isVaultId(entry.id) ||
      !opaque(entry.identity) || !opaque(entry.version) ||
      idKey(entry.id) !== idKey([...parent, entry.name])) return false;
    if (entry.kind === 'note') return entry.name.endsWith('.md');
    if (entry.kind === 'file') return true;
    return entry.kind === 'directory' && entriesValid(entry.children, entry.id);
  });
  return record(value) && opaque(value.rootIdentity) && entriesValid(value.entries, []);
}

function opaque(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512; }

let readSequence = 0;

async function request<T>(url: string, operation: 'tree' | 'directory' | 'note' | 'file' | 'attachments', signal: AbortSignal, validate: (value: unknown) => value is T): Promise<T> {
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

export function readDirectory(id: VaultId, signal: AbortSignal): Promise<VaultDirectoryResponse> {
  if (!isVaultDirectoryId(id)) return Promise.reject(new RecallReadError('invalid_request'));
  return request(`/api/vault/directory?${new URLSearchParams({ id: idKey(id) })}`, 'directory', signal,
    (value): value is VaultDirectoryResponse => record(value) && opaque(value.rootIdentity) && opaque(value.directoryIdentity) &&
      isVaultDirectoryId(value.id) && idKey(value.id) === idKey(id) && Array.isArray(value.entries) && value.entries.every(entry =>
        record(entry) && isVaultComponent(entry.name) && isVaultId(entry.id) && idKey(entry.id) === idKey([...id, entry.name]) &&
        opaque(entry.identity) && opaque(entry.version) && (entry.kind === 'directory' || entry.kind === 'file' || entry.kind === 'note' && entry.name.endsWith('.md'))));
}

export function readNote(key: string, signal: AbortSignal): Promise<VaultNoteResponse> {
  const id: unknown = JSON.parse(key);
  if (!isVaultId(id)) return Promise.reject(new RecallReadError('invalid_request'));
  return request(`/api/vault/note?${new URLSearchParams({ id: key })}`, 'note', signal,
    (value): value is VaultNoteResponse => record(value) && isVaultComponent(value.name) &&
      value.name === id.at(-1) && typeof value.markdown === 'string' &&
      typeof value.revision === 'string' && value.revision.length > 0 && value.revision.length <= 128 && typeof value.editable === 'boolean');
}

export function readFile(key: string, signal: AbortSignal): Promise<VaultFileResponse> {
  const id: unknown = JSON.parse(key);
  if (!isVaultId(id)) return Promise.reject(new RecallReadError('invalid_request'));
  return request(`/api/vault/file?${new URLSearchParams({ id: key })}`, 'file', signal,
    (value): value is VaultFileResponse => {
      if (!record(value) || !isVaultComponent(value.name) || value.name !== id.at(-1)) return false;
      if (value.kind === 'text') return typeof value.text === 'string';
      if (value.kind === 'unsupported') return true;
      // Classification belongs to the daemon. Validate its descriptor, not a filename extension.
      return (value.kind === 'image' || value.kind === 'video') && typeof value.contentType === 'string' &&
        new RegExp(`^${value.kind}/[a-z0-9.+-]+$`, 'i').test(value.contentType);
    });
}

// Local wire validation for the reviewed upload boundary; the daemon owns limits,
// names and publication. No browser MIME/type or size policy replaces that truth.
export type AttachmentLimits = VaultUploadLimit;
export type AttachmentResult = VaultUploadResponse;
export interface AttachmentProgress { loaded: number; total: number | null; finishing: boolean }
export type AttachmentFailure = 'upload_too_large' | 'invalid_request' | 'upload_unavailable' | 'upload_uncertain';
export class AttachmentUploadError extends Error {
  constructor(readonly code: AttachmentFailure) { super('Attachment upload failed'); }
}

export function readAttachmentLimits(signal: AbortSignal): Promise<AttachmentLimits> {
  return request('/api/vault/attachments', 'attachments', signal,
    (value): value is AttachmentLimits => record(value) && typeof value.maxFileBytes === 'number' && Number.isSafeInteger(value.maxFileBytes) && value.maxFileBytes > 0);
}

/** Send the original File once. Progress is transfer, not durable acknowledgement. */
export function uploadAttachment(file: File, signal: AbortSignal, progress: (value: AttachmentProgress) => void): Promise<AttachmentResult> {
  if (file.size === 0) {
    console.info('vault_upload_rejected', { reason: 'empty', trigger: 'client-validation' });
    return Promise.reject(new AttachmentUploadError('invalid_request'));
  }
  const requestId = ++readSequence;
  console.info('vault_upload_attempt', { requestId });
  return new Promise((resolve, reject) => {
    let xhr: XMLHttpRequest;
    try { xhr = new XMLHttpRequest(); } catch {
      console.info('vault_upload_outcome', { requestId, status: 'upload_uncertain' });
      reject(new AttachmentUploadError('upload_uncertain')); return;
    }
    let settled = false;
    let transferred: AttachmentProgress = { loaded: 0, total: null, finishing: false };
    const finish = (result: AttachmentResult | AttachmentFailure) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
      xhr.upload.onprogress = xhr.upload.onload = null;
      console.info('vault_upload_outcome', { requestId, status: typeof result === 'string' ? result : 'uploaded' });
      if (typeof result === 'string') reject(new AttachmentUploadError(result)); else resolve(result);
    };
    const abort = () => { xhr.abort(); finish('upload_uncertain'); };
    xhr.onload = () => {
      try {
        if (xhr.getResponseHeader('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') { finish('upload_uncertain'); return; }
        const value: unknown = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && record(value) && isUploadName(value.name) && isVaultId(value.id) &&
          value.id.length === 2 && value.id[0] === '06_Attachments' && value.id[1] === value.name &&
          typeof value.size === 'number' && Number.isSafeInteger(value.size) && value.size === file.size) {
          finish({ id: value.id, name: value.name, size: value.size }); return;
        }
        const code = record(value) && record(value.error) ? value.error.code : null;
        if ((xhr.status === 413 && code === 'upload_too_large') || (xhr.status === 400 && code === 'invalid_request') ||
          (xhr.status === 503 && code === 'upload_unavailable')) finish(code);
        else finish('upload_uncertain');
      } catch { finish('upload_uncertain'); }
    };
    xhr.onerror = xhr.onabort = xhr.ontimeout = () => finish('upload_uncertain');
    xhr.upload.onprogress = event => {
      if (settled || signal.aborted) return;
      const total = event.lengthComputable && Number.isFinite(event.total) && event.total > 0 ? event.total : null;
      transferred = { loaded: Math.max(0, event.loaded), total, finishing: total !== null && event.loaded >= total };
      progress(transferred);
    };
    xhr.upload.onload = () => { if (!settled && !signal.aborted) progress({ ...transferred, finishing: true }); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted) { finish('upload_uncertain'); return; }
      xhr.open('POST', `/api/vault/attachments?${new URLSearchParams({ name: file.name })}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.send(file);
    } catch { finish('upload_uncertain'); }
  });
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

const attachmentFailureCopy = {
  upload_too_large: { heading: 'File too large', body: 'Choose a file within the current upload limit.', action: '' },
  upload_unavailable: { heading: 'Upload unavailable', body: "The file couldn't be saved. Your selected file is still here.", action: '' },
  upload_uncertain: { heading: 'Upload not confirmed', body: 'Check files before uploading again.', action: '' },
};

export const failureCopy: Record<RecallFailure, { heading: string; body: string; action: string }> = {
  config_missing: { heading: 'Vault not configured', body: 'Set the vault directory in the JSON config, then restart Memory Loop.', action: 'Check again' },
  config_invalid: { heading: 'Vault configuration is invalid', body: 'Check the JSON configuration and vault directory, then restart Memory Loop.', action: 'Check again' },
  vault_unavailable: { heading: 'Vault unavailable', body: "Memory Loop can't read the configured vault. Check that it exists and is readable, then try again.", action: 'Try again' },
  search_unavailable: { heading: 'Search unavailable', body: 'Search could not finish. Try again.', action: 'Try again' },
  search_context_changed: { heading: 'File changed', body: 'This file changed. Search again.', action: 'Search again' },
  note_unavailable: { heading: 'Note unavailable', body: "This note may have moved, been removed, or can't be read. Choose another file or try again.", action: 'Retry note' },
  invalid_request: { heading: 'File address is invalid', body: 'Choose a file from Files.', action: '' },
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
  ...attachmentFailureCopy,
};
