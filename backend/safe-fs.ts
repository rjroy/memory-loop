import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, realpathSync, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { isPortableName } from './portable-name';
export { isPortableName } from './portable-name';

export interface ReplaceFileOptions {
  /** Called immediately before publication; caller owns revision/content validation. */
  validate: () => Promise<void>;
  flushFile?: (file: FileHandle) => Promise<void>;
  flushDirectory?: (components: readonly string[]) => Promise<void>;
}

export class ReplaceFileError extends Error {
  constructor(readonly published: boolean, cause: unknown) {
    super('Filesystem replacement failed', { cause });
  }
}

/** A checked descendant is a link or does not have the requested kind. */
export class SafeEntryError extends Error {}

/** A path component is not valid for the current filesystem platform. */
export class SafeComponentError extends Error {}

/** The configured root no longer identifies the opened directory. */
export class SafeRootChangedError extends Error {}

type EntryKind = 'file' | 'directory' | 'missing';
type FileIdentity = { readonly dev: bigint; readonly ino: bigint };

export function sameFileIdentity(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

function checkResolutionRequest(components: readonly string[], kind: EntryKind): void {
  if (!Array.isArray(components) || !['file', 'directory', 'missing'].includes(kind)) {
    throw new Error('Invalid filesystem resolution request');
  }
  for (const component of components) {
    if (typeof component !== 'string' || component === '' || component === '.' || component === '..' ||
        /[/\\\0]/.test(component) || isAbsolute(component) ||
        (process.platform === 'win32' && component.includes(':'))) {
      throw new SafeComponentError('Invalid filesystem path component');
    }
  }
  if (components.length === 0 && kind !== 'directory') {
    throw new Error('Filesystem root is a directory');
  }
}

// Compare canonical path components exactly; Windows directories can be case-sensitive.
function checkContained(root: string, candidate: string): void {
  const rootParts = root.endsWith(sep) ? root.slice(0, -1).split(sep) : root.split(sep);
  const candidateParts = candidate.split(sep);
  if (candidateParts.length < rootParts.length ||
      rootParts.some((part, index) => candidateParts[index] !== part)) {
    throw new Error('Filesystem path is outside the root');
  }
}

function checkEntry(entry: Pick<Stats, 'isSymbolicLink' | 'isDirectory' | 'isFile'>, directory: boolean): void {
  if (entry.isSymbolicLink()) throw new SafeEntryError('Filesystem links are not allowed');
  if (directory ? !entry.isDirectory() : !entry.isFile()) {
    throw new SafeEntryError('Unexpected filesystem entry kind');
  }
}

/** A canonical, identity-checked root for ordinary portable filesystem access. */
export interface SafeRoot {
  readonly path: string;
  /** Returns a checked path, not a reservation or pinned handle. `missing` checks absence, not portable naming. */
  resolve(components: readonly string[], kind: 'file' | 'directory' | 'missing'): Promise<string>;
  /** Caller serializes mutations and owns the returned handle, including closing and syncing it. */
  createFile(components: readonly string[]): Promise<FileHandle>;
  /** Caller serializes mutations. */
  createDirectory(components: readonly string[]): Promise<void>;
  /** Caller serializes mutations; observed collisions use EEXIST. No external-writer race guarantee. */
  move(source: readonly string[], destination: readonly string[], kind: 'file' | 'directory'): Promise<void>;
  /** Existing regular file only; caller owns the handle. Write modes refuse hard links. */
  openFile(components: readonly string[], mode: 'read' | 'read-write' | 'append'): Promise<FileHandle>;
  /** Caller serializes mutations; validation is not an atomic compare-and-swap. */
  replaceFile(components: readonly string[], bytes: Uint8Array, options: ReplaceFileOptions): Promise<void>;
  /** Flush a checked directory where supported; Windows explicitly skips directory fsync. */
  syncDirectory(components: readonly string[]): Promise<void>;
}

export async function openSafeRoot(path: string): Promise<SafeRoot> {
  const root = await realpath(path);
  const identity = await lstat(root, { bigint: true });
  if (!identity.isDirectory()) throw new Error('Filesystem root is not a directory');

  async function checkRoot(): Promise<void> {
    let current;
    try { current = await lstat(root, { bigint: true }); }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        throw new SafeRootChangedError('Filesystem root has changed', { cause: error });
      }
      throw error;
    }
    if (!current.isDirectory() || !sameFileIdentity(current, identity)) {
      throw new SafeRootChangedError('Filesystem root has changed');
    }
  }

  function checkNewName(components: readonly string[]): void {
    if (!Array.isArray(components) || components.length === 0 || !isPortableName(components[components.length - 1])) {
      throw new Error('Invalid new filesystem name');
    }
  }

  const safe: SafeRoot = {
    path: root,
    async openFile(components, mode) {
      if (mode !== 'read' && mode !== 'read-write' && mode !== 'append') {
        throw new Error('Invalid file open mode');
      }
      const path = await safe.resolve(components, 'file');
      const flags = mode === 'read' ? constants.O_RDONLY :
        constants.O_RDWR | (mode === 'append' ? constants.O_APPEND : 0);
      const file = await open(path, flags | (constants.O_NONBLOCK ?? 0));
      try {
        const info = await file.stat({ bigint: true });
        const checkedPath = await safe.resolve(components, 'file');
        const current = await lstat(checkedPath, { bigint: true });
        if (!info.isFile() || !current.isFile()) throw new SafeEntryError('Unexpected filesystem entry kind');
        if (info.dev !== current.dev || info.ino !== current.ino ||
            (mode !== 'read' && info.nlink !== 1n)) {
          throw new Error('Unsafe or changed filesystem file');
        }
        return file;
      } catch (error) {
        await file.close();
        throw error;
      }
    },
    async replaceFile(components, bytes, options) {
      let published = false;
      let temporary: readonly string[] | undefined;
      let tempIdentity: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint } | undefined;
      let tempHandle: FileHandle | undefined;
      try {
        const target = [...components];
        const parent = target.slice(0, -1);
        const initial = await safe.openFile(target, 'read');
        let targetIdentity: { dev: bigint; ino: bigint };
        try {
          const info = await initial.stat({ bigint: true });
          targetIdentity = info;
        } finally {
          await initial.close();
        }

        const tempComponents = [...parent, `.memory-loop-${randomUUID()}.tmp`];
        tempHandle = await safe.createFile(tempComponents);
        temporary = tempComponents;
        tempIdentity = await tempHandle.stat({ bigint: true });
        try {
          await tempHandle.writeFile(bytes);
        } catch (error) {
          tempIdentity = await tempHandle.stat({ bigint: true });
          throw error;
        }
        tempIdentity = await tempHandle.stat({ bigint: true });
        await (options.flushFile ?? (async file => file.sync()))(tempHandle);
        await tempHandle.close();
        tempHandle = undefined;

        await options.validate();
        const targetPath = await safe.resolve(target, 'file');
        const current = await lstat(targetPath, { bigint: true });
        if (!current.isFile() || current.dev !== targetIdentity.dev || current.ino !== targetIdentity.ino) {
          throw new Error('Filesystem target has changed');
        }
        const tempPath = await safe.resolve(tempComponents, 'file');
        const temp = await lstat(tempPath, { bigint: true });
        if (!temp.isFile() || temp.nlink !== 1n || temp.dev !== tempIdentity.dev || temp.ino !== tempIdentity.ino ||
            temp.size !== tempIdentity.size || temp.mtimeNs !== tempIdentity.mtimeNs || temp.ctimeNs !== tempIdentity.ctimeNs) {
          throw new Error('Filesystem temporary file has changed');
        }
        await rename(tempPath, targetPath);
        published = true;
        temporary = undefined;
        await (options.flushDirectory ?? (async id => safe.syncDirectory(id)))(parent);
      } catch (error) {
        let failure: unknown = error;
        if (tempHandle) {
          try { await tempHandle.close(); } catch (closeError) { failure = new AggregateError([failure, closeError], 'Replacement and close failed'); }
        }
        if (temporary && tempIdentity) {
          try {
            const tempPath = await safe.resolve(temporary, 'file');
            const current = await lstat(tempPath, { bigint: true });
            if (current.isFile() && current.nlink === 1n && current.dev === tempIdentity.dev && current.ino === tempIdentity.ino &&
                current.size === tempIdentity.size && current.mtimeNs === tempIdentity.mtimeNs && current.ctimeNs === tempIdentity.ctimeNs) {
              await unlink(tempPath);
            }
          } catch (cleanupError) {
            if (!(typeof cleanupError === 'object' && cleanupError !== null && 'code' in cleanupError && cleanupError.code === 'ENOENT')) {
              failure = new AggregateError([failure, cleanupError], 'Replacement and cleanup failed');
            }
          }
        }
        throw new ReplaceFileError(published, failure);
      }
    },
    async syncDirectory(components) {
      const path = await safe.resolve(components, 'directory');
      if (process.platform === 'win32') return;
      const directory = await open(path, 'r');
      try {
        const info = await directory.stat({ bigint: true });
        const checkedPath = await safe.resolve(components, 'directory');
        const current = await lstat(checkedPath, { bigint: true });
        if (!info.isDirectory() || !current.isDirectory() || info.dev !== current.dev || info.ino !== current.ino) {
          throw new Error('Filesystem directory has changed');
        }
        await directory.sync();
      } finally {
        await directory.close();
      }
    },
    async createFile(components) {
      checkNewName(components);
      return open(await safe.resolve(components, 'missing'), 'wx');
    },
    async createDirectory(components) {
      checkNewName(components);
      await mkdir(await safe.resolve(components, 'missing'));
    },
    async move(source, destination, kind) {
      checkNewName(destination);
      if (!Array.isArray(source) || source.length === 0 || (kind !== 'file' && kind !== 'directory')) {
        throw new Error('Invalid filesystem move source');
      }
      const sourcePath = await safe.resolve(source, kind);
      const destinationPath = await safe.resolve(destination, 'missing');
      if (kind === 'directory') {
        const sourceIdentity = await lstat(sourcePath, { bigint: true });
        if (!sourceIdentity.isDirectory()) throw new Error('Unexpected filesystem entry kind');
        // Compare directory objects, not spellings: Windows may have either case-sensitive
        // siblings or multiple case spellings for the same directory.
        let ancestor = root;
        for (let index = 0; index < destination.length; index++) {
          const entry = await lstat(ancestor, { bigint: true });
          if (!entry.isDirectory()) throw new Error('Unexpected filesystem entry kind');
          if (entry.dev === sourceIdentity.dev && entry.ino === sourceIdentity.ino) {
            throw new Error('Cannot move a directory into itself');
          }
          ancestor = join(ancestor, destination[index]);
        }
        await checkRoot();
      }
      await rename(sourcePath, destinationPath);
    },
    async resolve(components, kind) {
      checkResolutionRequest(components, kind);

      await checkRoot();
      let current = root;
      for (let index = 0; index < components.length; index++) {
        current = join(current, components[index]);
        const relativePath = relative(root, current);
        if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
          throw new Error('Filesystem path is outside the root');
        }

        const last = index === components.length - 1;
        let entry;
        try {
          entry = await lstat(current);
        } catch (error) {
          if (last && kind === 'missing' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            await checkRoot();
            return current;
          }
          throw error;
        }
        if (last && kind === 'missing') {
          throw Object.assign(new Error('Filesystem destination already exists'), { code: 'EEXIST' });
        }
        checkEntry(entry, !last || kind === 'directory');
        checkContained(root, await realpath(current));
      }
      await checkRoot();
      return current;
    },
  };
  return safe;
}

/** Only the synchronous checks needed to bracket synchronous storage operations. */
export interface SafeRootSync {
  readonly path: string;
  resolve(components: readonly string[], kind: EntryKind): string;
  /** Validates first; directory fsync is explicitly unsupported on Windows. */
  syncDirectory(components: readonly string[]): void;
}

export function openSafeRootSync(path: string): SafeRootSync {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('Invalid filesystem root');
  const root = realpathSync(normalize(path));
  const identity = lstatSync(root, { bigint: true });
  if (!identity.isDirectory()) throw new Error('Filesystem root is not a directory');

  function checkRoot(): void {
    let current;
    try { current = lstatSync(root, { bigint: true }); }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
        throw new SafeRootChangedError('Filesystem root has changed', { cause: error });
      }
      throw error;
    }
    if (!current.isDirectory() || !sameFileIdentity(current, identity)) {
      throw new SafeRootChangedError('Filesystem root has changed');
    }
  }

  const safe: SafeRootSync = {
    path: root,
    resolve(components, kind) {
      checkResolutionRequest(components, kind);
      checkRoot();
      let current = root;
      for (let index = 0; index < components.length; index++) {
        current = join(current, components[index]);
        const relativePath = relative(root, current);
        if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
          throw new Error('Filesystem path is outside the root');
        }
        const last = index === components.length - 1;
        let entry;
        try { entry = lstatSync(current, { bigint: true }); }
        catch (error) {
          if (last && kind === 'missing' && typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            checkRoot();
            return current;
          }
          throw error;
        }
        if (last && kind === 'missing') {
          throw Object.assign(new Error('Filesystem destination already exists'), { code: 'EEXIST' });
        }
        checkEntry(entry, !last || kind === 'directory');
        checkContained(root, realpathSync(current));
      }
      checkRoot();
      return current;
    },
    syncDirectory(components) {
      const path = safe.resolve(components, 'directory');
      if (process.platform === 'win32') return;
      const fd = openSync(path, 'r');
      try {
        const held = fstatSync(fd, { bigint: true });
        const current = lstatSync(safe.resolve(components, 'directory'), { bigint: true });
        if (!held.isDirectory() || !current.isDirectory() || !sameFileIdentity(held, current)) {
          throw new Error('Filesystem directory has changed');
        }
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
  };
  return safe;
}
