import { createHash, randomUUID } from 'node:crypto';
import { readdir, stat, lstat, unlink, rmdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { isVaultComponent, isVaultId, isVaultDirectoryId, isUploadName, parseVaultSaveRequest, parseVaultAction, vaultSaveTextLimit, type VaultEntry, type VaultDirectoryEntry, type VaultDirectoryResponse, type VaultId, type VaultNoteResponse, type VaultSaveResponse, type VaultTreeResponse, type VaultAction, type VaultActionResponse, type VaultErrorCode, type VaultUploadResponse } from './contract';
import { openSafeRoot, ReplaceFileError, SafeEntryError, type SafeRoot } from './safe-fs';
import { contentResponse, describeFile } from './vault-media';
import type { VaultFileResponse } from './contract';
import type { VaultSearchRequest, VaultSearchResponse, VaultSearchContextRequest, VaultSearchContextResponse } from './contract';
import { createVaultSearch, type VaultSearchHooks } from './vault-search';

export interface VaultReader {
  tree(): Promise<VaultTreeResponse>;
  directory(id: VaultId): Promise<VaultDirectoryResponse>;
  note(id: VaultId): Promise<VaultNoteResponse>;
  file(id: VaultId): Promise<VaultFileResponse>;
  content(id: VaultId, method: string, range: string | null, download: boolean, signal: AbortSignal): Promise<Response>;
  save(id: VaultId, markdown: string, expectedRevision: string): Promise<VaultSaveResponse>;
  action(input: VaultAction): Promise<VaultActionResponse>;
  upload(name: string, body: ReadableStream<Uint8Array>, limit: number, signal: AbortSignal): Promise<VaultUploadResponse>;
  search(input: VaultSearchRequest, signal: AbortSignal): Promise<VaultSearchResponse>;
  searchContext(input: VaultSearchContextRequest, signal: AbortSignal): Promise<VaultSearchContextResponse>;
  close(): Promise<void>;
}

type ReaderErrorCode = VaultErrorCode;

class VaultError extends Error {
  constructor(readonly code: ReaderErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

function invalidId(): VaultError {
  return new VaultError('invalid_request', 'Invalid note identifier');
}

function validateId(value: unknown): VaultId {
  if (!isVaultId(value)) throw invalidId();
  return value;
}

/** Parse the already URL-decoded JSON query value. */
export function parseVaultId(value: string): VaultId {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidId();
  }
  return validateId(parsed);
}

function isVanishedOrLink(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP');
}

async function listDirectory(root: SafeRoot, parent: VaultId, identity: (stats: Stats) => string, version: (stats: Stats) => string, shallow = false, onListed?: (id: VaultId) => void): Promise<VaultEntry[] | VaultDirectoryEntry[]> {
  const entries = await readdir(await root.resolve(parent, 'directory'), { withFileTypes: true });
  onListed?.(parent);
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const result: VaultEntry[] = [];
  for (const entry of entries) {
    if (!isVaultComponent(entry.name)) continue;
    const id = [...parent, entry.name];
    try {
      if (entry.isDirectory()) {
        const stats = await stat(await root.resolve(id, 'directory'));
        const item = { kind: 'directory' as const, name: entry.name, id, identity: identity(stats), version: version(stats) };
        if (shallow) result.push({ ...item, children: [] });
        else result.push({ ...item, children: await listDirectory(root, id, identity, version) as VaultEntry[] });
      } else if (entry.isFile()) {
        const file = await root.openFile(id, 'read');
        try {
          const stats = await file.stat();
          result.push({ kind: entry.name.endsWith('.md') ? 'note' : 'file', name: entry.name, id, identity: identity(stats), version: version(stats) });
        } finally { await file.close(); }
      }
    } catch (error) {
      if (isVanishedOrLink(error)) continue;
      throw error;
    }
  }
  return shallow ? result.map(item => item.kind === 'directory' ? { kind: item.kind, name: item.name, id: item.id, identity: item.identity, version: item.version } : item) : result;
}

export interface VaultOptions extends VaultSearchHooks {
  onDirectoryListed?: (id: VaultId) => void;
  flushFile?: (file: FileHandle) => Promise<void>;
  flushDirectory?: (directory: VaultId) => Promise<void>;
  move?: (source: VaultId, destination: VaultId, kind: 'file' | 'directory') => Promise<void>;
  afterContentSniff?: () => Promise<void>;
}

function editableBytes(bytes: Buffer): boolean {
  if (bytes.length > vaultSaveTextLimit) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
}

/** Open and retain the configured root for the reader lifetime. */
export async function openVault(root: string, options: VaultOptions = {}): Promise<VaultReader> {
  let safe: SafeRoot;
  try { safe = await openSafeRoot(root); }
  catch { throw new VaultError('vault_unavailable', 'Vault directory is unavailable'); }
  const flushFile = options.flushFile ?? (async (file: FileHandle) => file.sync());
  const flushDirectory = options.flushDirectory ?? (async (id: VaultId) => safe.syncDirectory(id));
  const move = options.move ?? ((source: VaultId, destination: VaultId, kind: 'file' | 'directory') => safe.move(source, destination, kind));
  const secret = randomUUID();
  const digest = (input: string | Buffer) => createHash('sha256').update(secret).update(input).digest('hex');
  const identity = (stats: Stats) => digest(`identity:${stats.dev}:${stats.ino}:${stats.birthtimeMs}`);
  const version = (stats: Stats) => stats.isDirectory() ? identity(stats) : digest(`version:${stats.dev}:${stats.ino}:${stats.birthtimeMs}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`);
  const revisionOf = (stats: Stats, bytes: Buffer) => createHash('sha256').update(secret).update(`revision:${stats.dev}:${stats.ino}:${stats.birthtimeMs}:`).update(bytes).digest('hex');
  let queue: Promise<void> = Promise.resolve();
  let closed = false;
  const uploads = new Set<Promise<VaultUploadResponse>>();

  async function uploadFile(name: string, body: ReadableStream<Uint8Array>, limit: number, signal: AbortSignal): Promise<VaultUploadResponse> {
    if (!isUploadName(name)) throw invalidId();
    const parent = ['06_Attachments'];
    let file: FileHandle | undefined;
    let temp: VaultId | undefined;
    let tempIdentity: { dev: bigint; ino: bigint } | undefined;
    let published = false;
    let complete = false;
    let timedOut = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const reader = body.getReader();
    const abort = () => { if (!complete) void reader.cancel().catch(() => {}); };
    const armIdle = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { timedOut = true; abort(); }, 60_000);
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      // Let any already-running mutation finish before creating the upload's temp.
      // The upload is registered before this wait, so later folder actions refuse it.
      await queue;
      if (signal.aborted) throw new Error('aborted');
      try { await safe.createDirectory(parent); await flushDirectory([]); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const directoryIdentity = identity(await stat(await safe.resolve(parent, 'directory')));
      const tempId = [...parent, `.memory-loop-upload-${randomUUID()}.tmp`];
      file = await safe.createFile(tempId);
      temp = tempId;
      tempIdentity = await file.stat({ bigint: true });
      let size = 0;
      armIdle();
      for (;;) {
        const part = await reader.read();
        if (signal.aborted || timedOut) throw new Error('aborted');
        if (part.done) break;
        if (part.value.byteLength) armIdle();
        size += part.value.byteLength;
        if (size > limit) throw new VaultError('upload_too_large', 'Upload exceeds the file size limit');
        for (let start = 0; start < part.value.byteLength; start += 64 * 1024) {
          const chunk = part.value.subarray(start, start + 64 * 1024);
          let offset = 0;
          while (offset < chunk.length) {
            const result = await file.write(chunk, offset, chunk.length - offset);
            if (!result.bytesWritten) throw new Error('write failed');
            offset += result.bytesWritten;
          }
        }
      }
      if (size === 0) throw invalidId();
      complete = true;
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      signal.removeEventListener('abort', abort);
      await flushFile(file);
      await file.close();
      file = undefined;
      const operation = queue.then(async () => {
        if (identity(await stat(await safe.resolve(parent, 'directory'))) !== directoryIdentity) throw new Error('Attachment directory changed');
        const tempPath = await safe.resolve(tempId, 'file');
        const currentTemp = await lstat(tempPath, { bigint: true });
        if (!tempIdentity || currentTemp.dev !== tempIdentity.dev || currentTemp.ino !== tempIdentity.ino || currentTemp.nlink !== 1n) throw new Error('Upload temporary file changed');
        const dot = name.lastIndexOf('.');
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : '';
        for (let index = 1; index < 100000; index++) {
          const candidate = index === 1 ? name : `${base} (${index})${ext}`;
          if (!isUploadName(candidate)) throw new Error('Collision name too long');
          try { await move(tempId, [...parent, candidate], 'file'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
          published = true;
          temp = undefined;
          await flushDirectory(parent);
          return { id: [...parent, candidate], name: candidate, size };
        }
        throw new Error('Collision limit');
      });
      queue = operation.then(() => {}, () => {});
      return await operation;
    } catch (error) {
      if (published) throw new VaultError('upload_uncertain', 'Upload outcome is uncertain');
      if (error instanceof VaultError) throw error;
      throw new VaultError('upload_unavailable', 'Upload is unavailable');
    } finally {
      signal.removeEventListener('abort', abort);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      if (!complete) void reader.cancel().catch(() => {});
      reader.releaseLock();
      await file?.close().catch(() => {});
      if (temp && tempIdentity) {
        try {
          const path = await safe.resolve(temp, 'file');
          const current = await lstat(path, { bigint: true });
          if (current.dev === tempIdentity.dev && current.ino === tempIdentity.ino && current.nlink === 1n) await unlink(path);
        } catch { /* Do not remove an unrelated or inaccessible entry. */ }
      }
    }
  }

  async function save(id: VaultId, markdown: string, expectedRevision: string): Promise<VaultSaveResponse> {
    try {
      let original: Stats;
      const file = await safe.openFile(id, 'read').catch(() => { throw new VaultError('note_unavailable', 'Note is unavailable'); });
      try {
        original = await file.stat();
        const bytes = await file.readFile();
        if (!editableBytes(bytes)) throw new VaultError('note_not_editable', 'Note cannot be edited');
        if (revisionOf(original, bytes) !== expectedRevision) throw new VaultError('note_conflict', 'Note has changed');
      } finally { await file.close(); }
      const bytes = Buffer.from(markdown, 'utf8');
      let replacementStats: Stats | undefined;
      await safe.replaceFile(id, bytes, {
        async flushFile(temp) { await flushFile(temp); replacementStats = await temp.stat(); },
        flushDirectory,
        async validate() {
          const current = await safe.openFile(id, 'read').catch(() => { throw new VaultError('note_conflict', 'Note has changed'); });
          try {
            const stats = await current.stat();
            if (stats.dev !== original.dev || stats.ino !== original.ino || revisionOf(stats, await current.readFile()) !== expectedRevision) throw new VaultError('note_conflict', 'Note has changed');
          } finally { await current.close(); }
        },
      });
      if (!replacementStats) throw new VaultError('note_save_uncertain', 'Note save outcome is uncertain');
      return { revision: revisionOf(replacementStats, bytes) };
    } catch (error) {
      if (error instanceof ReplaceFileError) {
        if (error.published) throw new VaultError('note_save_uncertain', 'Note save outcome is uncertain');
        error = error.cause;
      }
      if (error instanceof VaultError) throw error;
      if (isVanishedOrLink(error)) throw new VaultError('note_unavailable', 'Note is unavailable');
      throw new VaultError('note_save_unavailable', 'Note could not be saved');
    }
  }
  async function performAction(input: VaultAction): Promise<VaultActionResponse> {
    let mutated = false;
    function fail(code: ReaderErrorCode): never { throw new VaultError(code, 'File action failed'); }
    const dirStats = async (id: VaultId) => {
      try { return await stat(await safe.resolve(id, 'directory')); }
      catch (error) {
        if (error instanceof SafeEntryError || isVanishedOrLink(error)) return fail('entry_unavailable');
        throw error;
      }
    };
    const sourceStats = async (id: VaultId, kind: 'note' | 'file' | 'directory') => {
      if (kind === 'directory') return dirStats(id);
      const file = await safe.openFile(id, 'read').catch(error => {
        if (error instanceof SafeEntryError) return fail('entry_unavailable');
        throw error;
      });
      try { return await file.stat(); } finally { await file.close(); }
    };
    try {
      if (input.action === 'create-note' || input.action === 'create-directory') {
        if (identity(await dirStats(input.parentId)) !== input.expectedParentIdentity) fail('entry_conflict');
        const id = [...input.parentId, input.name];
        if (input.action === 'create-directory') {
          await safe.createDirectory(id);
          mutated = true;
          await flushDirectory(id);
          await flushDirectory(input.parentId);
          return { id };
        }
        const file = await safe.createFile(id);
        mutated = true;
        try {
          await flushFile(file);
          const revision = revisionOf(await file.stat(), Buffer.alloc(0));
          await flushDirectory(input.parentId);
          return { id, revision };
        } finally { await file.close(); }
      }
      const name = input.id[input.id.length - 1];
      if ((input.kind === 'note' && !name.endsWith('.md')) || (input.kind === 'file' && name.endsWith('.md'))) fail('entry_unavailable');
      if (input.kind === 'directory' && input.id.length === 1 && name === '06_Attachments' && uploads.size) fail('entry_conflict');
      const original = await sourceStats(input.id, input.kind);
      if (input.kind === 'directory' && input.id.length === 1 && uploads.size) {
        // A case-insensitive filesystem can name the same directory with another spelling.
        let attachments: Stats | undefined;
        try { attachments = await stat(await safe.resolve(['06_Attachments'], 'directory')); } catch { /* Not present yet. */ }
        if (uploads.size && attachments && identity(original) === identity(attachments)) fail('entry_conflict');
      }
      if (version(original) !== input.expectedVersion) fail('entry_conflict');
      const parent = input.id.slice(0, -1);
      if (input.action === 'delete') {
        const path = await safe.resolve(input.id, input.kind === 'directory' ? 'directory' : 'file').catch(error => {
          if (error instanceof SafeEntryError) return fail('entry_unavailable');
          throw error;
        });
        if (version(await sourceStats(input.id, input.kind)) !== version(original)) fail('entry_conflict');
        if (input.kind === 'directory') await rmdir(path); else await unlink(path);
        mutated = true;
        await flushDirectory(parent);
        return { id: input.id };
      }
      if (input.destinationParentId.length === parent.length && input.destinationParentId.every((part, i) => part === parent[i])) fail('invalid_request');
      if (input.kind === 'directory' && input.destinationParentId.length >= input.id.length && input.id.every((part, i) => input.destinationParentId[i] === part)) fail('invalid_request');
      if (identity(await dirStats(input.destinationParentId)) !== input.expectedDestinationIdentity) fail('entry_conflict');
      if (version(await sourceStats(input.id, input.kind)) !== version(original)) fail('entry_conflict');
      await move(input.id, [...input.destinationParentId, name], input.kind === 'directory' ? 'directory' : 'file');
      mutated = true;
      await flushDirectory(parent);
      await flushDirectory(input.destinationParentId);
      return { id: [...input.destinationParentId, name] };
    } catch (error) {
      if (mutated) fail('file_action_uncertain');
      if (error instanceof VaultError) throw error;
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      if (code === 'EEXIST') fail('entry_exists');
      if (code === 'ENOTEMPTY') fail('folder_not_empty');
      if (code === 'EXDEV') fail('move_cross_device');
      if (code === 'ENOSYS' || code === 'ENOTSUP' || code === 'EINVAL') fail('move_unsupported');
      if (isVanishedOrLink(error)) fail('entry_unavailable');
      return fail('file_action_unavailable');
    }
  }
  async function openRegular(rawId: VaultId) {
    const id = validateId(rawId);
    try {
      if (closed) throw new Error('Vault reader is closed');
      const file = await safe.openFile(id, 'read');
      try {
        const stats = await file.stat();
        if (!stats.isFile() || !Number.isSafeInteger(stats.size)) throw new Error('Not a regular file');
        return { file, name: id[id.length - 1], size: stats.size };
      } catch (error) { await file.close(); throw error; }
    } catch { throw new VaultError('entry_unavailable', 'Entry is unavailable'); }
  }
  const search = createVaultSearch({
    directoryPath: id => safe.resolve(id, 'directory'), openRegular, version,
  }, options);
  return {
    search: search.search,
    searchContext: search.context,
    async tree() {
      try {
        if (closed) throw new Error('Vault reader is closed');
        return { rootIdentity: identity(await stat(await safe.resolve([], 'directory'))), entries: await listDirectory(safe, [], identity, version) as VaultEntry[] };
      } catch { throw new VaultError('vault_unavailable', 'Vault directory is unavailable'); }
    },
    async directory(id) {
      if (!isVaultDirectoryId(id)) throw invalidId();
      try {
        if (closed) throw new Error('Vault reader is closed');
        const rootIdentity = identity(await stat(await safe.resolve([], 'directory')));
        const directoryIdentity = id.length ? identity(await stat(await safe.resolve(id, 'directory'))) : rootIdentity;
        const entries = await listDirectory(safe, id, identity, version, true, options.onDirectoryListed) as VaultDirectoryEntry[];
        return { rootIdentity, directoryIdentity, id, entries };
      } catch { throw new VaultError('entry_unavailable', 'Directory is unavailable'); }
    },
    async note(rawId) {
      const id = validateId(rawId);
      if (!id[id.length - 1].endsWith('.md')) throw new VaultError('note_unavailable', 'Note is unavailable');
      try {
        if (closed) throw new Error('Vault reader is closed');
        const file = await safe.openFile(id, 'read');
        try {
          const stats = await file.stat();
          const bytes = await file.readFile();
          return { name: id[id.length - 1], markdown: bytes.toString('utf8'), revision: revisionOf(stats, bytes), editable: editableBytes(bytes) };
        } finally { await file.close(); }
      } catch { throw new VaultError('note_unavailable', 'Note is unavailable'); }
    },
    async file(rawId) {
      const opened = await openRegular(rawId);
      try { return await describeFile(opened.file, opened.name, opened.size); }
      catch { throw new VaultError('entry_unavailable', 'Entry is unavailable'); }
      finally { await opened.file.close(); }
    },
    async content(rawId, method, range, download, signal) {
      const opened = await openRegular(rawId);
      try { return await contentResponse(opened.file, opened.name, opened.size, method, range, download, signal, options.afterContentSniff); }
      catch { throw new VaultError('entry_unavailable', 'Entry is unavailable'); }
    },
    async save(rawId, markdown, expectedRevision) {
      const input = parseVaultSaveRequest({ id: rawId, markdown, expectedRevision });
      if (!input) throw invalidId();
      if (!input.id[input.id.length - 1].endsWith('.md')) throw new VaultError('note_unavailable', 'Note is unavailable');
      if (closed) throw new VaultError('note_save_unavailable', 'Note could not be saved');
      const operation = queue.then(() => save(input.id, input.markdown, input.expectedRevision));
      queue = operation.then(() => {}, () => {});
      return operation;
    },
    async action(rawInput) {
      const input = parseVaultAction(rawInput);
      if (!input) throw invalidId();
      if (closed) throw new VaultError('file_action_unavailable', 'File action unavailable');
      const operation = queue.then(() => performAction(input));
      queue = operation.then(() => {}, () => {});
      return operation;
    },
    async upload(name, body, limit, signal) {
      if (closed) throw new VaultError('upload_unavailable', 'Upload is unavailable');
      const operation = uploadFile(name, body, limit, signal);
      uploads.add(operation);
      try { return await operation; } finally { uploads.delete(operation); }
    },
    async close() { closed = true; await search.close(); await Promise.allSettled(uploads); await queue; },
  };
}
