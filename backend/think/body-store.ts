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
  /** Bind before the first body; SQLite retains cleanup attribution across daemon crashes. */
  bind(state: BodyCacheStateStore): void;
  revoke(conversationId: string): void;
  purge(conversationId: string): Promise<void>;
  close(): Promise<void>;
}

import { createHash, randomUUID } from 'node:crypto';
import { lstat, rmdir, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, normalize } from 'node:path';
import { openSafeRoot } from '../safe-fs';
import { sameFileId, statIdentity } from '../file-identity';
import type { BodyCacheStateStore, CacheNamespace } from './state';
import { checkCacheOutsideVault, removeCacheNamespace } from './body-cleanup';

class StoreError extends Error implements BodyStoreError {
  constructor(readonly code: BodyStoreErrorCode, readonly reason?: 'evicted') { super('Think body store operation failed'); }
}

interface StoredBody {
  ref: BodyRef;
  name: string;
  /** Exact decimal file identity (see ../file-identity). */
  dev: string;
  ino: string;
  prefixes: Set<number>;
  resident: boolean;
  pins: number;
  evictPending: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function createNamespace(path: string, vault: string, epoch: string) {
  if (!isAbsolute(path) || path.includes('\0') || !uuid.test(epoch)) throw new StoreError('resource_failure');
  const nativePath = normalize(path);
  const parent = await openSafeRoot(dirname(nativePath));
  await checkCacheOutsideVault(parent.path, vault);
  const rootName = basename(nativePath);
  // The configured parent may be linked; the newly generated root may not exist at all.
  await parent.createDirectory([rootName]);
  const directory = await parent.resolve([rootName], 'directory');
  const stat = await lstat(directory, { bigint: true });
  const namespace = statIdentity(stat);
  if (!stat.isDirectory() || !namespace) throw new StoreError('resource_failure');
  const root = await openSafeRoot(directory);
  const named = await lstat(await parent.resolve([rootName], 'directory'), { bigint: true });
  if (!named.isDirectory() || !sameFileId(named, namespace)) throw new StoreError('resource_failure');
  await parent.syncDirectory([]);
  return { parent, root, rootName, directory, namespace };
}

/** Create a new private daemon-owned namespace; existing namespaces are never adopted. */
export async function createBodyStore(options: { directory: string; epoch: string; vaultDirectory: string }): Promise<BodyStore> {
  const { epoch, vaultDirectory } = options;
  const { parent, root, rootName, directory, namespace } = await createNamespace(options.directory, vaultDirectory, epoch)
    .catch(() => { throw new StoreError('resource_failure'); });
  const records = new Map<string, StoredBody>();
  const current = new Map<string, StoredBody>();
  const contentIds = new Map<string, string>();
  const locks = new Map<string, Promise<void>>();
  const readers = new Set<FileHandle>();
  const readerClosers = new Map<FileHandle, { conversationId: string; close(): Promise<void> }>();
  const revoked = new Set<string>();
  const spaces = new Map<string, Promise<CacheNamespace>>();
  const spaceIntents = new Map<string, CacheNamespace>();
  let cache: BodyCacheStateStore | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  const checkRoot = async () => {
    const named = await lstat(await parent.resolve([rootName], 'directory'), { bigint: true });
    if (!named.isDirectory() || !sameFileId(named, namespace)) throw new StoreError('unavailable');
    await root.resolve([], 'directory');
  };
  const namespaceFor = (conversationId: string) => {
    let work = spaces.get(conversationId);
    if (!work) {
      work = (async () => {
        if (!uuid.test(conversationId) || revoked.has(conversationId)) throw new StoreError('closed');
        await checkRoot();
        const record: CacheNamespace = { conversationId, epoch, path: directory, root: { ...namespace }, directory: null };
        spaceIntents.set(conversationId, record);
        cache?.intent(record); // Commit attribution before creating a directory or writing any content.
        await root.createDirectory([conversationId]);
        const stat = await lstat(await root.resolve([conversationId], 'directory'), { bigint: true });
        const identity = statIdentity(stat);
        if (!stat.isDirectory() || !identity) throw new StoreError('resource_failure');
        await checkRoot();
        cache?.acquire(conversationId, epoch, identity);
        // A failed acquisition acknowledgement must not grant cleanup authority in memory.
        record.directory = identity;
        await root.syncDirectory([]);
        return record;
      })();
      spaces.set(conversationId, work);
    }
    return work;
  };
  const pathFor = async (conversationId: string, name: string, kind: 'file' | 'missing' = 'file') => {
    if (!uuid.test(name)) throw new StoreError('unavailable');
    const space = await namespaceFor(conversationId);
    await checkRoot();
    const named = await lstat(await root.resolve([conversationId], 'directory'), { bigint: true });
    if (!space.directory || !named.isDirectory() || !sameFileId(named, space.directory)) throw new StoreError('unavailable');
    return root.resolve([conversationId, name], kind);
  };
  const fingerprint = (key: BodyKey) => JSON.stringify([key.conversationId, key.owner.kind, key.owner.kind === 'assistant-text' ? key.owner.messageId : key.owner.clientCommandId,
    key.owner.kind === 'assistant-text' ? key.owner.ordinal : key.owner.kind === 'original' ? key.owner.messageId : key.owner.decisionId]);
  const snapshot = (ref: BodyRef): BodyRef => structuredClone(ref);
  const checkOpen = () => { if (closed) throw new StoreError('closed'); };
  const checkConversation = (id: string) => { checkOpen(); if (revoked.has(id)) throw new StoreError('closed'); };
  const namedFile = async (item: StoredBody) => {
    const path = await pathFor(item.ref.key.conversationId, item.name);
    const stat = await lstat(path, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || !sameFileId(stat, item)) throw new StoreError('unavailable');
    return path;
  };
  const verify = async (handle: FileHandle, expected?: StoredBody) => {
    const stat = await handle.stat({ bigint: true });
    const identity = statIdentity(stat);
    const size = Number(stat.size);
    if (!stat.isFile() || stat.nlink !== 1n || !identity || !Number.isSafeInteger(size) ||
        (expected && !sameFileId(identity, expected))) throw new StoreError('unavailable');
    if (expected) await namedFile(expected);
    return { ...identity, size };
  };
  const get = (ref: BodyRef): StoredBody => {
    try {
      checkConversation(ref.key.conversationId);
      const stored = records.get(ref.generation);
      if (!stored || ref.epoch !== epoch || ref.contentId !== stored.ref.contentId || fingerprint(ref.key) !== fingerprint(stored.ref.key) ||
          ref.kind !== stored.ref.kind || !Number.isSafeInteger(ref.through) || !stored.prefixes.has(ref.through) ||
          (ref.kind === 'canonical' && (stored.ref.kind !== 'canonical' || ref.sha256 !== stored.ref.sha256 || ref.through !== stored.ref.through))) throw new StoreError('stale_ref');
      return stored;
    } catch { throw new StoreError('stale_ref'); }
  };
  const remove = async (item: StoredBody) => {
    await pathFor(item.ref.key.conversationId, item.name);
    const handle = await root.openFile([item.ref.key.conversationId, item.name], 'read');
    try { await verify(handle, item); } finally { await handle.close(); }
    await unlink(await namedFile(item));
  };
  const serial = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = locks.get(key) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => gate);
    locks.set(key, queued);
    await previous;
    try { checkConversation(JSON.parse(key)[0]); return await work(); }
    finally { release(); if (locks.get(key) === queued) locks.delete(key); }
  };
  const write = async (handle: FileHandle, source: AsyncIterable<Uint8Array>, offset: number, item: StoredBody, hash?: ReturnType<typeof createHash>) => {
    let position = offset;
    for await (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) throw new StoreError('resource_failure');
      hash?.update(chunk);
      for (let i = 0; i < chunk.length;) {
        await verify(handle, item);
        checkConversation(item.ref.key.conversationId);
        const size = Math.min(65536, chunk.length - i);
        const result = await handle.write(chunk, i, size, position);
        if (!result.bytesWritten || result.bytesWritten > size) throw new StoreError('resource_failure');
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
      await pathFor(requested.key.conversationId, item.name);
      handle = await root.openFile([requested.key.conversationId, item.name], 'read');
      try { const stat = await verify(handle, item); if (stat.size < requested.through) throw new StoreError('unavailable'); checkConversation(requested.key.conversationId); }
      catch (error) { await handle.close(); throw error; }
    } catch { item.pins--; throw new StoreError('unavailable'); }
    readers.add(handle);
    let readerClosed = false;
    const reader: BodyReader = {
      async read(offset, length) {
        if (readerClosed) throw new StoreError('closed');
        checkConversation(requested.key.conversationId);
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
          checkConversation(requested.key.conversationId);
          return result;
        } catch { throw new StoreError('unavailable'); }
      },
      async close() {
        if (readerClosed) return;
        readerClosed = true; readers.delete(handle); readerClosers.delete(handle); await handle.close();
        if (closed || revoked.has(requested.key.conversationId)) { item.pins--; return; }
        await serial(fingerprint(requested.key), async () => {
          item.pins--;
          if (!item.pins && item.evictPending && item.resident) { await remove(item); item.resident = false; item.evictPending = false; }
        });
      },
    };
    readerClosers.set(handle, { conversationId: requested.key.conversationId, close: () => reader.close() });
    return reader;
  };
  const purge = async (conversationId: string) => {
    revoked.add(conversationId);
    await Promise.all([...locks].filter(([key]) => JSON.parse(key)[0] === conversationId).map(([, work]) => work));
    await Promise.all([...readerClosers.values()].filter(reader => reader.conversationId === conversationId).map(reader => reader.close()));
    const work = spaces.get(conversationId);
    if (work) {
      const space = await work.catch(() => undefined);
      if (space) await removeCacheNamespace(space, vaultDirectory);
      else {
        const record = spaceIntents.get(conversationId);
        if (!record) throw new StoreError('resource_failure');
        await removeCacheNamespace(record, vaultDirectory);
      }
      cache?.removed(conversationId, epoch);
      spaces.delete(conversationId);
      spaceIntents.delete(conversationId);
    }
    for (const [generation, item] of records) if (item.ref.key.conversationId === conversationId) records.delete(generation);
    for (const [key, item] of current) if (item.ref.key.conversationId === conversationId) { current.delete(key); contentIds.delete(key); }
  };
  return {
    bind(state) { if (cache || spaces.size || records.size || closed) throw new StoreError('resource_failure'); cache = state; },
    revoke(conversationId) { revoked.add(conversationId); },
    purge,
    async replace(key, source, kind) {
      checkOpen();
      const ownedKey = structuredClone(key);
      const logical = fingerprint(ownedKey);
      return serial(logical, async () => {
        const name = randomUUID();
        let handle: FileHandle | undefined;
        let item: StoredBody | undefined;
        try {
          await pathFor(key.conversationId, name, 'missing');
          handle = await root.createFile([key.conversationId, name]);
          const stat = await verify(handle);
          const contentId = contentIds.get(logical) ?? randomUUID();
          const generation = randomUUID();
          item = { name, dev: stat.dev, ino: stat.ino, prefixes: new Set(), resident: true, pins: 0, evictPending: false, ref: { key: ownedKey, epoch, contentId, generation, through: 0, kind: 'preview' } };
          const hash = createHash('sha256');
          const through = await write(handle, source, 0, item, hash);
          const digest = hash.digest('hex');
          await verify(handle, item);
          await handle.close(); handle = undefined;
          checkConversation(key.conversationId);
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
          await pathFor(requested.key.conversationId, item.name);
          handle = await root.openFile([requested.key.conversationId, item.name], 'read-write');
          const stat = await verify(handle, item);
          verified = true;
          if (stat.size !== requested.through) throw new StoreError('unavailable');
          const through = await write(handle, source, requested.through, item);
          await verify(handle, item);
          checkConversation(requested.key.conversationId);
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
          await pathFor(requested.key.conversationId, name, 'missing');
          handle = await root.createFile([requested.key.conversationId, name]);
          const stat = await verify(handle);
          candidate = { ...item, name, dev: stat.dev, ino: stat.ino, resident: true, pins: 0, evictPending: false };
          const hash = createHash('sha256');
          const length = await write(handle, source, 0, candidate, hash);
          if (length !== requested.through || hash.digest('hex') !== requested.sha256) throw new Error('restore mismatch');
          await verify(handle, candidate); await handle.close(); handle = undefined;
          checkConversation(requested.key.conversationId);
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
          let failed = false;
          for (const id of [...spaces.keys()]) { try { await purge(id); } catch { failed = true; } }
          await Promise.all([...readerClosers.values()].map(reader => reader.close())); readers.clear();
          try {
            await checkRoot();
            if (!failed) { await rmdir(directory); await parent.syncDirectory([]); }
          } catch { failed = true; }
          if (failed) throw new StoreError('resource_failure');
        })();
      }
      await closing;
    },
  };
}
