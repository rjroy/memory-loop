import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { open, readdir, rename, stat, unlink, mkdir, rmdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { isVaultComponent, isVaultId, parseVaultSaveRequest, parseVaultAction, vaultSaveTextLimit, type VaultEntry, type VaultId, type VaultNoteResponse, type VaultSaveResponse, type VaultTreeResponse, type VaultAction, type VaultActionResponse, type VaultErrorCode } from './contract';
import { renameNoReplace as nativeRenameNoReplace } from './vault-rename';
import { contentResponse, describeFile } from './vault-media';
import type { VaultFileResponse } from './contract';

export interface VaultReader {
  tree(): Promise<VaultTreeResponse>;
  note(id: VaultId): Promise<VaultNoteResponse>;
  file(id: VaultId): Promise<VaultFileResponse>;
  content(id: VaultId, method: string, range: string | null, download: boolean, signal: AbortSignal): Promise<Response>;
  save(id: VaultId, markdown: string, expectedRevision: string): Promise<VaultSaveResponse>;
  action(input: VaultAction): Promise<VaultActionResponse>;
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

const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;

function descriptorPath(handle: FileHandle, name?: string): string {
  const path = `/proc/self/fd/${handle.fd}`;
  return name === undefined ? path : `${path}/${name}`;
}

function isVanishedOrLink(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP');
}

async function listDirectory(directory: FileHandle, parent: VaultId, identity: (stats: Stats) => string, version: (stats: Stats) => string): Promise<VaultEntry[]> {
  const entries = await readdir(descriptorPath(directory), { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const result: VaultEntry[] = [];
  for (const entry of entries) {
    if (!isVaultComponent(entry.name)) continue;
    const id = [...parent, entry.name];
    if (entry.isDirectory()) {
      let child: FileHandle;
      try {
        child = await open(descriptorPath(directory, entry.name), directoryFlags);
      } catch (error: unknown) {
        if (isVanishedOrLink(error)) continue;
        throw error;
      }
      try {
        const stats = await child.stat();
        result.push({ kind: 'directory', name: entry.name, id, identity: identity(stats), version: version(stats), children: await listDirectory(child, id, identity, version) });
      } finally {
        await child.close();
      }
    } else if (entry.isFile()) {
      let child: FileHandle;
      try {
        child = await open(descriptorPath(directory, entry.name), fileFlags);
      } catch (error: unknown) {
        if (isVanishedOrLink(error)) continue;
        throw error;
      }
      try {
        const stats = await child.stat();
        if (stats.isFile()) result.push({ kind: entry.name.endsWith('.md') ? 'note' : 'file', name: entry.name, id, identity: identity(stats), version: version(stats) });
      } finally {
        await child.close();
      }
    }
  }
  return result;
}

export interface VaultOptions {
  flushFile?: (file: FileHandle) => Promise<void>;
  flushDirectory?: (directory: FileHandle) => Promise<void>;
  renameNoReplace?: (sourceParentFd: number, sourceName: string, destinationParentFd: number, destinationName: string) => Promise<void>;
  afterContentSniff?: () => Promise<void>;
}

function editableBytes(bytes: Buffer): boolean {
  if (bytes.length > vaultSaveTextLimit) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
}

/** Open and retain the configured root for the reader lifetime. */
export async function openVault(root: string, options: VaultOptions = {}): Promise<VaultReader> {
  if (process.platform !== 'linux' || !constants.O_DIRECTORY || !constants.O_NOFOLLOW || !constants.O_NONBLOCK) {
    throw new VaultError('vault_unavailable', 'Vault directory is unavailable');
  }
  let rootHandle: FileHandle | undefined;
  try {
    rootHandle = await open(root, directoryFlags);
    const actual = await rootHandle.stat();
    const viaProc = await stat(descriptorPath(rootHandle));
    if (actual.dev !== viaProc.dev || actual.ino !== viaProc.ino || !viaProc.isDirectory()) {
      throw new Error('Descriptor access unavailable');
    }
  } catch {
    await rootHandle?.close();
    throw new VaultError('vault_unavailable', 'Vault directory is unavailable');
  }
  const pinnedRoot = rootHandle;
  const flushFile = options.flushFile ?? (async (file: FileHandle) => file.sync());
  const flushDirectory = options.flushDirectory ?? (async (file: FileHandle) => file.sync());
  const renameNoReplace = options.renameNoReplace ?? nativeRenameNoReplace;
  const secret = randomUUID();
  const digest = (input: string | Buffer) => createHash('sha256').update(secret).update(input).digest('hex');
  const identity = (stats: Stats) => digest(`identity:${stats.dev}:${stats.ino}:${stats.birthtimeMs}`);
  const version = (stats: Stats) => stats.isDirectory() ? identity(stats) : digest(`version:${stats.dev}:${stats.ino}:${stats.birthtimeMs}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`);
  const revisionOf = (stats: Stats, bytes: Buffer) => createHash('sha256').update(secret).update(`revision:${stats.dev}:${stats.ino}:${stats.birthtimeMs}:`).update(bytes).digest('hex');
  let queue: Promise<void> = Promise.resolve();
  let closed = false;

  async function save(id: VaultId, markdown: string, expectedRevision: string): Promise<VaultSaveResponse> {
    const opened: FileHandle[] = [];
    let parent = pinnedRoot;
    let temporary: string | undefined;
    let replaced = false;
    try {
      for (const component of id.slice(0, -1)) {
        parent = await open(descriptorPath(parent, component), directoryFlags);
        opened.push(parent);
      }
      const name = id[id.length - 1];
      let file: FileHandle;
      try { file = await open(descriptorPath(parent, name), fileFlags); }
      catch { throw new VaultError('note_unavailable', 'Note is unavailable'); }
      opened.push(file);
      const original = await file.stat();
      if (!original.isFile()) throw new VaultError('note_unavailable', 'Note is unavailable');
      const bytes = await file.readFile();
      if (!editableBytes(bytes)) throw new VaultError('note_not_editable', 'Note cannot be edited');
      if (revisionOf(original, bytes) !== expectedRevision) throw new VaultError('note_conflict', 'Note has changed');
      const tempName = `.memory-loop-${randomUUID()}.tmp`;
      const temp = await open(descriptorPath(parent, tempName), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      temporary = tempName;
      opened.push(temp);
      await temp.chmod(original.mode & 0o777);
      await temp.writeFile(markdown, 'utf8');
      await flushFile(temp);
      let check: FileHandle;
      try { check = await open(descriptorPath(parent, name), fileFlags); }
      catch { throw new VaultError('note_conflict', 'Note has changed'); }
      opened.push(check);
      const current = await check.stat();
      if (!current.isFile() || current.dev !== original.dev || current.ino !== original.ino || revisionOf(current, await check.readFile()) !== expectedRevision) {
        throw new VaultError('note_conflict', 'Note has changed');
      }
      // External writers can still race between this check and rename; this is not filesystem CAS.
      await rename(descriptorPath(parent, temporary), descriptorPath(parent, name));
      replaced = true;
      temporary = undefined;
      await flushDirectory(parent);
      return { revision: revisionOf(await temp.stat(), Buffer.from(markdown, 'utf8')) };
    } catch (error) {
      if (replaced) throw new VaultError('note_save_uncertain', 'Note save outcome is uncertain');
      if (error instanceof VaultError) throw error;
      if (isVanishedOrLink(error)) throw new VaultError('note_unavailable', 'Note is unavailable');
      throw new VaultError('note_save_unavailable', 'Note could not be saved');
    } finally {
      if (temporary) await unlink(descriptorPath(parent, temporary)).catch(() => {});
      for (const handle of opened.reverse()) await handle.close().catch(() => {});
    }
  }
  async function performAction(input: VaultAction): Promise<VaultActionResponse> {
    const opened: FileHandle[] = [];
    let mutated = false;
    function fail(code: ReaderErrorCode): never { throw new VaultError(code, 'File action failed'); }
    const directory = async (id: VaultId) => {
      let current = pinnedRoot;
      for (const component of id) {
        current = await open(descriptorPath(current, component), directoryFlags);
        opened.push(current);
      }
      return current;
    };
    const revalidate = async (id: VaultId, handle: FileHandle) => {
      const current = await directory(id);
      if (identity(await current.stat()) !== identity(await handle.stat())) fail('entry_conflict');
    };
    const revalidateSource = async (parent: FileHandle, name: string, expected: Stats, kind: 'note' | 'file' | 'directory') => {
      const check = await open(descriptorPath(parent, name), kind === 'directory' ? directoryFlags : fileFlags);
      opened.push(check);
      if (version(await check.stat()) !== version(expected)) fail('entry_conflict');
    };
    try {
      if (input.action === 'create-note' || input.action === 'create-directory') {
        const parent = await directory(input.parentId);
        if (identity(await parent.stat()) !== input.expectedParentIdentity) fail('entry_conflict');
        await revalidate(input.parentId, parent);
        const path = descriptorPath(parent, input.name);
        const id = [...input.parentId, input.name];
        if (input.action === 'create-directory') {
          await mkdir(path);
          mutated = true;
          const created = await open(path, directoryFlags);
          opened.push(created);
          await flushDirectory(created);
          await flushDirectory(parent);
          return { id };
        }
        const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        opened.push(file);
        mutated = true;
        await flushFile(file);
        await flushDirectory(parent);
        return { id, revision: revisionOf(await file.stat(), Buffer.alloc(0)) };
      }
      const parent = await directory(input.id.slice(0, -1));
      const name = input.id[input.id.length - 1];
      if (input.kind === 'note' && !name.endsWith('.md')) fail('entry_unavailable');
      if (input.kind === 'file' && name.endsWith('.md')) fail('entry_unavailable');
      const source = await open(descriptorPath(parent, name), input.kind === 'directory' ? directoryFlags : fileFlags);
      opened.push(source);
      const sourceStats = await source.stat();
      if (input.kind === 'directory' ? !sourceStats.isDirectory() : !sourceStats.isFile()) fail('entry_unavailable');
      if (version(sourceStats) !== input.expectedVersion) fail('entry_conflict');
      if (input.action === 'delete') {
        await revalidate(input.id.slice(0, -1), parent);
        await revalidateSource(parent, name, sourceStats, input.kind);
        if (input.kind === 'directory') await rmdir(descriptorPath(parent, name));
        else await unlink(descriptorPath(parent, name));
        mutated = true;
        await flushDirectory(parent);
        return { id: input.id };
      }
      if (input.destinationParentId.length === input.id.length - 1 && input.destinationParentId.every((part, i) => part === input.id[i])) fail('invalid_request');
      if (input.kind === 'directory' && input.destinationParentId.length >= input.id.length && input.id.every((part, i) => input.destinationParentId[i] === part)) fail('invalid_request');
      const destination = await directory(input.destinationParentId);
      if (identity(await destination.stat()) !== input.expectedDestinationIdentity) fail('entry_conflict');
      await revalidate(input.id.slice(0, -1), parent);
      await revalidate(input.destinationParentId, destination);
      await revalidateSource(parent, name, sourceStats, input.kind);
      await renameNoReplace(parent.fd, name, destination.fd, name);
      mutated = true;
      await flushDirectory(parent);
      if (parent.fd !== destination.fd) await flushDirectory(destination);
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
    } finally {
      for (const handle of opened.reverse()) await handle.close().catch(() => {});
    }
  }
  async function openRegular(rawId: VaultId) {
    const id = validateId(rawId);
    const opened: FileHandle[] = [];
    try {
      let parent = pinnedRoot;
      for (const component of id.slice(0, -1)) {
        parent = await open(descriptorPath(parent, component), directoryFlags);
        opened.push(parent);
      }
      const name = id[id.length - 1];
      const file = await open(descriptorPath(parent, name), fileFlags);
      try {
        const stats = await file.stat();
        if (!stats.isFile() || !Number.isSafeInteger(stats.size)) throw new Error('Not a regular file');
        return { file, name, size: stats.size };
      } catch (error) { await file.close(); throw error; }
    } catch { throw new VaultError('entry_unavailable', 'Entry is unavailable'); }
    finally { for (const handle of opened.reverse()) await handle.close().catch(() => {}); }
  }
  return {
    async tree() {
      try {
        return { rootIdentity: identity(await pinnedRoot.stat()), entries: await listDirectory(pinnedRoot, [], identity, version) };
      } catch {
        throw new VaultError('vault_unavailable', 'Vault directory is unavailable');
      }
    },
    async note(rawId) {
      const id = validateId(rawId);
      if (!id[id.length - 1].endsWith('.md')) {
        throw new VaultError('note_unavailable', 'Note is unavailable');
      }
      const opened: FileHandle[] = [];
      try {
        let parent = pinnedRoot;
        for (const component of id.slice(0, -1)) {
          parent = await open(descriptorPath(parent, component), directoryFlags);
          opened.push(parent);
        }
        const name = id[id.length - 1];
        const file = await open(descriptorPath(parent, name), fileFlags);
        opened.push(file);
        const stats = await file.stat();
        if (!stats.isFile()) throw new Error('Not a regular file');
        const bytes = await file.readFile();
        return { name, markdown: bytes.toString('utf8'), revision: revisionOf(stats, bytes), editable: editableBytes(bytes) };
      } catch {
        throw new VaultError('note_unavailable', 'Note is unavailable');
      } finally {
        for (const handle of opened.reverse()) await handle.close();
      }
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
    async close() { closed = true; await queue; await pinnedRoot.close(); },
  };
}
