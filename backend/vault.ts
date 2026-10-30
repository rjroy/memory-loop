import { constants } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { VaultEntry, VaultId, VaultNoteResponse, VaultTreeResponse } from './contract';

export interface VaultReader {
  tree(): Promise<VaultTreeResponse>;
  note(id: VaultId): Promise<VaultNoteResponse>;
  close(): Promise<void>;
}

type ReaderErrorCode = 'invalid_request' | 'note_unavailable' | 'vault_unavailable';

class VaultError extends Error {
  constructor(readonly code: ReaderErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

function invalidId(): VaultError {
  return new VaultError('invalid_request', 'Invalid note identifier');
}

function validComponent(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('.') &&
    !value.includes('/') && !value.includes('\\') && !value.includes('\0');
}

function validateId(value: unknown): VaultId {
  if (!Array.isArray(value) || value.length === 0 || !value.every(validComponent)) throw invalidId();
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
    if (!validComponent(entry.name)) continue;
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

/** Open and retain the configured root for the reader lifetime. */
export async function openVault(root: string): Promise<VaultReader> {
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
        return { name, markdown: await file.readFile('utf8') };
      } catch {
        throw new VaultError('note_unavailable', 'Note is unavailable');
      } finally {
        for (const handle of opened.reverse()) await handle.close();
      }
    },
    async close() { await pinnedRoot.close(); },
  };
}
