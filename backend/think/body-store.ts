/** Identifies content by application ownership, never by a filesystem path. */
export type BodyOwner =
  | { kind: 'original'; clientCommandId: string; messageId: string }
  | { kind: 'assistant-text'; messageId: string; ordinal: number }
  | { kind: 'form-reply'; clientCommandId: string; decisionId: string };

export interface BodyKey { conversationId: string; owner: BodyOwner }

export type BodyKind = 'preview' | 'canonical';

interface BodyRefBase {
  key: BodyKey;
  epoch: string;
  contentId: string;
  generation: string;
  /** Immutable published byte prefix. */
  through: number;
}

export type BodyRef = BodyRefBase & (
  | { kind: 'preview' }
  | { kind: 'canonical'; sha256: string }
);
export type PreviewBodyRef = Extract<BodyRef, { kind: 'preview' }>;

export type BodyStoreErrorCode = 'stale_ref' | 'unavailable' | 'invalid_range' | 'resource_failure' | 'closed';
export interface BodyStoreError extends Error { readonly code: BodyStoreErrorCode; readonly reason?: 'evicted' }

/** Reads a pinned immutable prefix; each read is capped at 64 KiB. */
export interface BodyReader {
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface BodyStore {
  replace(key: BodyKey, source: AsyncIterable<Uint8Array>, kind: BodyKind): Promise<BodyRef>;
  append(ref: PreviewBodyRef, source: AsyncIterable<Uint8Array>): Promise<PreviewBodyRef>;
  open(ref: BodyRef): Promise<BodyReader>;
  evict(ref: BodyRef): Promise<'evicted' | 'deferred' | 'protected' | 'already-evicted'>;
  restore(ref: Extract<BodyRef, { kind: 'canonical' }>, source: AsyncIterable<Uint8Array>): Promise<BodyReader>;
  close(): Promise<void>;
}

import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rmdir, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

class StoreError extends Error implements BodyStoreError {
  constructor(readonly code: BodyStoreErrorCode, readonly reason?: 'evicted') { super('Think body store operation failed'); }
}

interface StoredBody {
  ref: BodyRef;
  name: string;
  dev: number;
  ino: number;
  prefixes: Set<number>;
  resident: boolean;
  pins: number;
  evictPending: boolean;
}

/** Create a new private daemon-owned namespace; existing namespaces are never adopted. */
export async function createBodyStore(options: { directory: string; epoch: string; vaultDirectory: string }): Promise<BodyStore> {
  const { directory, epoch, vaultDirectory } = options;
  let dir: FileHandle | undefined;
  try {
    if (!isAbsolute(directory) || !isAbsolute(vaultDirectory) || !process.getuid || process.platform !== 'linux') throw new Error();
    const parent = await realpath(dirname(directory));
    const vault = await realpath(vaultDirectory);
    const parentStat = await lstat(parent);
    if (!parentStat.isDirectory() || parentStat.uid !== process.getuid() || (parentStat.mode & 0o077) !== 0) throw new Error();
    const target = join(parent, directory.slice(dirname(directory).length + 1));
    const fromVault = relative(vault, target);
    if (target !== directory || fromVault === '' || (fromVault !== '..' && !fromVault.startsWith(`..${sep}`) && !isAbsolute(fromVault))) throw new Error();
    await mkdir(directory, { mode: 0o700 });
    dir = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const stat = await dir.stat();
    if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o700) throw new Error();
  } catch {
    await dir?.close();
    throw new StoreError('resource_failure');
  }
  const directoryHandle = dir;
  const namespace = await directoryHandle.stat();
  const records = new Map<string, StoredBody>();
  const current = new Map<string, StoredBody>();
  const contentIds = new Map<string, string>();
  const locks = new Map<string, Promise<void>>();
  const readers = new Set<FileHandle>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const pathFor = (name: string) => `/proc/self/fd/${directoryHandle.fd}/${name}`;
  const fingerprint = (key: BodyKey) => JSON.stringify([key.conversationId, key.owner.kind, key.owner.kind === 'assistant-text' ? key.owner.messageId : key.owner.clientCommandId,
    key.owner.kind === 'assistant-text' ? key.owner.ordinal : key.owner.kind === 'original' ? key.owner.messageId : key.owner.decisionId]);
  const snapshot = (ref: BodyRef): BodyRef => structuredClone(ref);
  const checkOpen = () => { if (closed) throw new StoreError('closed'); };
  const verify = async (handle: FileHandle, expected?: StoredBody) => {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1 ||
        (expected && (stat.dev !== expected.dev || stat.ino !== expected.ino))) throw new StoreError('unavailable');
    return stat;
  };
  const get = (ref: BodyRef): StoredBody => {
    try {
      const stored = records.get(ref.generation);
      if (!stored || ref.epoch !== epoch || ref.contentId !== stored.ref.contentId || fingerprint(ref.key) !== fingerprint(stored.ref.key) ||
          ref.kind !== stored.ref.kind || !Number.isSafeInteger(ref.through) || !stored.prefixes.has(ref.through) ||
          (ref.kind === 'canonical' && (stored.ref.kind !== 'canonical' || ref.sha256 !== stored.ref.sha256 || ref.through !== stored.ref.through))) throw new StoreError('stale_ref');
      return stored;
    } catch { throw new StoreError('stale_ref'); }
  };
  const remove = async (item: StoredBody) => {
    const handle = await open(pathFor(item.name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { await verify(handle, item); await unlink(pathFor(item.name)); } finally { await handle.close(); }
  };
  const serial = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = locks.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => gate);
    locks.set(key, queued);
    await previous;
    try { checkOpen(); return await work(); }
    finally { release(); if (locks.get(key) === queued) locks.delete(key); }
  };
  const write = async (handle: FileHandle, source: AsyncIterable<Uint8Array>, offset: number, hash?: ReturnType<typeof createHash>) => {
    let position = offset;
    for await (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) throw new StoreError('resource_failure');
      hash?.update(chunk);
      for (let i = 0; i < chunk.length;) {
        const size = Math.min(65536, chunk.length - i);
        const result = await handle.write(chunk, i, size, position);
        if (!result.bytesWritten) throw new StoreError('resource_failure');
        i += result.bytesWritten; position += result.bytesWritten;
      }
    }
    return position;
  };
  const pin = async (requested: BodyRef, item: StoredBody): Promise<BodyReader> => {
    if (!item.resident) throw new StoreError('unavailable', 'evicted');
    item.pins++;
    let handle: FileHandle;
    try {
      handle = await open(pathFor(item.name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try { const stat = await verify(handle, item); if (stat.size < requested.through) throw new StoreError('unavailable'); checkOpen(); }
      catch (error) { await handle.close(); throw error; }
    } catch { item.pins--; throw new StoreError('unavailable'); }
    readers.add(handle);
    let readerClosed = false;
    return {
      async read(offset, length) {
        if (readerClosed || closed) throw new StoreError('closed');
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > 65536 || offset + length > requested.through) throw new StoreError('invalid_range');
        try {
          await verify(handle, item);
          const result = new Uint8Array(length);
          let count = 0;
          while (count < length) {
            const read = await handle.read(result, count, length - count, offset + count);
            if (!read.bytesRead) throw new Error();
            count += read.bytesRead;
          }
          return result;
        } catch { throw new StoreError('unavailable'); }
      },
      async close() {
        if (readerClosed) return;
        readerClosed = true; readers.delete(handle); await handle.close();
        if (closed) return;
        await serial(fingerprint(requested.key), async () => {
          item.pins--;
          if (!item.pins && item.evictPending && item.resident) { await remove(item); item.resident = false; item.evictPending = false; }
        });
      },
    };
  };
  return {
    async replace(key, source, kind) {
      checkOpen();
      const ownedKey = structuredClone(key);
      const logical = fingerprint(ownedKey);
      return serial(logical, async () => {
        const name = randomUUID();
        let handle: FileHandle | undefined;
        let item: StoredBody | undefined;
        try {
          handle = await open(pathFor(name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
          const stat = await verify(handle);
          const contentId = contentIds.get(logical) ?? randomUUID();
          const generation = randomUUID();
          item = { name, dev: stat.dev, ino: stat.ino, prefixes: new Set(), resident: true, pins: 0, evictPending: false, ref: { key: ownedKey, epoch, contentId, generation, through: 0, kind: 'preview' } };
          const hash = createHash('sha256');
          const through = await write(handle, source, 0, hash);
          const digest = hash.digest('hex');
          await verify(handle, item);
          await handle.close(); handle = undefined;
          checkOpen();
          const previous = current.get(logical);
          if (kind === 'canonical' && previous?.ref.kind === 'canonical' && previous.ref.through === through && previous.ref.sha256 === digest) {
            checkOpen();
            if (previous.resident) await remove(item);
            else { previous.name = item.name; previous.dev = item.dev; previous.ino = item.ino; previous.resident = true; previous.evictPending = false; }
            return snapshot(previous.ref);
          }
          item.ref = kind === 'canonical' ? { key: ownedKey, epoch, contentId, generation, through, kind, sha256: digest }
            : { key: ownedKey, epoch, contentId, generation, through, kind };
          item.prefixes.add(through);
          contentIds.set(logical, contentId); records.set(generation, item); current.set(logical, item);
          return snapshot(item.ref);
        } catch {
          await handle?.close().catch(() => {});
          if (item) {
            try { await remove(item); }
            catch { records.set(item.ref.generation, item); }
          }
          throw new StoreError('resource_failure');
        }
      });
    },
    async append(ref, source) {
      checkOpen();
      const requested = structuredClone(ref);
      return serial(fingerprint(requested.key), async () => {
        const item = get(requested);
        if (item.ref.kind !== 'preview' || item.ref.through !== requested.through || current.get(fingerprint(requested.key)) !== item) throw new StoreError('stale_ref');
        let handle: FileHandle | undefined;
        let verified = false;
        try {
          handle = await open(pathFor(item.name), constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          const stat = await verify(handle, item);
          verified = true;
          if (stat.size !== requested.through) throw new StoreError('unavailable');
          const through = await write(handle, source, requested.through);
          await verify(handle, item);
          item.ref = { ...requested, through };
          item.prefixes.add(through);
          return snapshot(item.ref) as PreviewBodyRef;
        } catch (error) {
          if (handle && verified) {
            try { await verify(handle, item); await handle.truncate(requested.through); } catch { /* Do not modify an unverified replacement. */ }
          }
          if (error instanceof StoreError && error.code === 'unavailable') throw error;
          throw new StoreError('resource_failure');
        } finally { await handle?.close(); }
      });
    },
    async open(ref) {
      checkOpen();
      const requested = structuredClone(ref);
      return serial(fingerprint(requested.key), () => pin(requested, get(requested)));
    },
    async evict(ref) {
      const requested = structuredClone(ref);
      return serial(fingerprint(requested.key), async () => {
        const item = get(requested);
        if (requested.key.owner.kind !== 'assistant-text' || (item.ref.kind === 'preview' && current.get(fingerprint(requested.key)) === item)) return 'protected';
        if (!item.resident) return 'already-evicted';
        if (item.pins) { item.evictPending = true; return 'deferred'; }
        try { await remove(item); item.resident = false; item.evictPending = false; return 'evicted'; }
        catch { throw new StoreError('unavailable'); }
      });
    },
    async restore(ref, source) {
      const requested = structuredClone(ref);
      return serial(fingerprint(requested.key), async () => {
        const item = get(requested);
        if (requested.kind !== 'canonical') throw new StoreError('stale_ref');
        if (item.resident) return pin(requested, item);
        const name = randomUUID();
        let handle: FileHandle | undefined;
        let candidate: StoredBody | undefined;
        try {
          handle = await open(pathFor(name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
          const stat = await verify(handle);
          candidate = { ...item, name, dev: stat.dev, ino: stat.ino, resident: true, pins: 0, evictPending: false };
          const hash = createHash('sha256');
          const length = await write(handle, source, 0, hash);
          if (length !== requested.through || hash.digest('hex') !== requested.sha256) throw new Error('restore mismatch');
          await verify(handle, candidate); await handle.close(); handle = undefined;
          checkOpen();
          item.name = name; item.dev = stat.dev; item.ino = stat.ino; item.resident = true; item.evictPending = false;
          candidate = undefined;
          return await pin(requested, item);
        } catch {
          await handle?.close().catch(() => {});
          if (candidate) await remove(candidate).catch(() => {});
          throw new StoreError('resource_failure');
        }
      });
    },
    async close() {
      if (!closing) {
        closed = true;
        closing = (async () => {
          await Promise.all([...locks.values()]);
          await Promise.all([...readers].map(handle => handle.close())); readers.clear();
          let failed = false;
          for (const item of records.values()) { if (item.resident) try { await remove(item); } catch { failed = true; } }
          try {
            const stat = await lstat(directory);
            if (!stat.isDirectory() || stat.dev !== namespace.dev || stat.ino !== namespace.ino) throw new Error();
            if (!failed) await rmdir(directory);
          } catch { failed = true; }
          await directoryHandle.close();
          if (failed) throw new StoreError('resource_failure');
        })();
      }
      await closing;
    },
  };
}
