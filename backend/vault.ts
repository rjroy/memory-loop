import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { open, readdir, rename, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isVaultComponent, isVaultId, parseVaultSaveRequest, vaultSaveTextLimit, type VaultEntry, type VaultId, type VaultNoteResponse, type VaultSaveResponse, type VaultTreeResponse } from './contract';

export interface VaultReader {
  tree(): Promise<VaultTreeResponse>;
  note(id: VaultId): Promise<VaultNoteResponse>;
  save(id: VaultId, markdown: string, expectedRevision: string): Promise<VaultSaveResponse>;
  close(): Promise<void>;
}

type ReaderErrorCode = 'invalid_request' | 'note_unavailable' | 'vault_unavailable' | 'note_conflict' | 'note_not_editable' | 'note_save_unavailable' | 'note_save_uncertain';

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

async function listDirectory(directory: FileHandle, parent: VaultId): Promise<VaultEntry[]> {
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
        result.push({ kind: 'directory', name: entry.name, id, children: await listDirectory(child, id) });
      } finally {
        await child.close();
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      let child: FileHandle;
      try {
        child = await open(descriptorPath(directory, entry.name), fileFlags);
      } catch (error: unknown) {
        if (isVanishedOrLink(error)) continue;
        throw error;
      }
      try {
        if ((await child.stat()).isFile()) result.push({ kind: 'note', name: entry.name, id });
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
}

const revisionOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
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
      if (revisionOf(bytes) !== expectedRevision) throw new VaultError('note_conflict', 'Note has changed');
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
      if (!current.isFile() || current.dev !== original.dev || current.ino !== original.ino || revisionOf(await check.readFile()) !== expectedRevision) {
        throw new VaultError('note_conflict', 'Note has changed');
      }
      // External writers can still race between this check and rename; this is not filesystem CAS.
      await rename(descriptorPath(parent, temporary), descriptorPath(parent, name));
      replaced = true;
      temporary = undefined;
      await flushDirectory(parent);
      return { revision: revisionOf(Buffer.from(markdown, 'utf8')) };
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
  return {
    async tree() {
      try {
        return { entries: await listDirectory(pinnedRoot, []) };
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
        if (!(await file.stat()).isFile()) throw new Error('Not a regular file');
        const bytes = await file.readFile();
        return { name, markdown: bytes.toString('utf8'), revision: revisionOf(bytes), editable: editableBytes(bytes) };
      } catch {
        throw new VaultError('note_unavailable', 'Note is unavailable');
      } finally {
        for (const handle of opened.reverse()) await handle.close();
      }
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
    async close() { closed = true; await queue; await pinnedRoot.close(); },
  };
}
