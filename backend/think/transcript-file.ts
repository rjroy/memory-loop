import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { isPortableName, openSafeRoot, SafeEntryError, SafeRootChangedError, type SafeRoot } from '../safe-fs';
import { exactFingerprint, fingerprintMatches, parseFileIdValue, sameFileId, statIdentity, type FileIdentity } from '../file-identity';
import type { TranscriptDirectoryIdentity, TranscriptFileCheckpoint } from './state';

export type TranscriptFailure = 'io_unavailable' | 'conflict' | 'content_gap' | 'invalid_configuration';
export class TranscriptError extends Error {
  constructor(readonly reason: TranscriptFailure) { super('Think transcript operation failed'); }
}

/** Narrow native-I/O seam: fault tests can wrap real owned handles, without mocking modules.
 * Stats are exact (`bigint: true`), so 64-bit file IDs are never rounded. */
export interface TranscriptHandle {
  readonly fd: number;
  stat(): Promise<BigIntStats>;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  write(buffer: Uint8Array, offset: number, length: number, position: null): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface TranscriptIO {
  open(path: string, flags: number, mode?: number): Promise<TranscriptHandle>;
  mkdir(path: string, mode: number): Promise<void>;
  lstat(path: string): Promise<BigIntStats>;
  realpath(path: string): Promise<string>;
  unlink(path: string): Promise<void>;
  /** Separate from file opens: no directory FileHandles are needed on Windows. */
  syncDirectory(root: SafeRoot, components: readonly string[]): Promise<void>;
}
export const transcriptIO: TranscriptIO = {
  async open(path, flags, mode) {
    const handle = await open(path, flags, mode);
    return { fd: handle.fd, stat: () => handle.stat({ bigint: true }),
      read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
      write: (buffer, offset, length, position) => handle.write(buffer, offset, length, position),
      sync: () => handle.sync(), close: () => handle.close() };
  },
  async mkdir(path, mode) { await mkdir(path, { mode }); },
  lstat: path => lstat(path, { bigint: true }), realpath, unlink,
  syncDirectory: (root, components) => root.syncDirectory(components),
};
export interface TranscriptBytes {
  readonly length: number;
  /** Addressable serialization; restarting after a short write never copies the whole record. */
  chunks(offset: number): AsyncIterable<Uint8Array>;
}

export function transcriptComponents(value: unknown = 'Conversations/Memory Loop'): string[] {
  if (typeof value !== 'string' || !value.length || isAbsolute(value) || value.includes('\\') || value.includes('\0')) throw new TranscriptError('invalid_configuration');
  const components = value.split('/');
  if (components.some(component => !component || component.startsWith('.'))) throw new TranscriptError('invalid_configuration');
  return components;
}
const fileFlags = constants.O_RDWR | constants.O_APPEND | (constants.O_NONBLOCK ?? 0);
const sameIdentity = sameFileId;
/**
 * POSIX ctime is kernel-maintained, so it is part of the fingerprint there. NTFS ChangeTime is
 * not usable for exact comparison: it is updated lazily when a written handle is flushed or
 * closed, an open handle can report an older value than its path, and (like mtime) callers can
 * set it directly. Windows fingerprints therefore omit only ctime; identity, size, mtime, link
 * count, owner and mode remain exact.
 */
const fingerprintsCtime = process.platform !== 'win32';
/** Exact identity, size and nanosecond times as decimal strings. */
export const transcriptFingerprint = (s: BigIntStats) => exactFingerprint(s, fingerprintsCtime);
/** Also accepts a checkpoint persisted in the pre-exact numeric fingerprint form. */
export const transcriptFingerprintMatches = (s: BigIntStats, persisted: string) => fingerprintMatches(s, persisted, fingerprintsCtime);
const fingerprint = transcriptFingerprint;
function code(error: unknown): unknown { return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined; }
function conflict(): never { throw new TranscriptError('conflict'); }
/** Transcript sizes are byte offsets; only file IDs may exceed the safe-integer range. */
export function transcriptSize(stat: BigIntStats): number {
  const size = Number(stat.size);
  return stat.size >= 0n && Number.isSafeInteger(size) ? size : conflict();
}
function identityOf(stat: BigIntStats): FileIdentity { return statIdentity(stat) ?? conflict(); }
function fileStat(stat: BigIntStats): void {
  if (!stat.isFile() || stat.nlink !== 1n) conflict();
  transcriptSize(stat); identityOf(stat);
}
function namespaceFailure(error: unknown): never {
  if (error instanceof SafeEntryError || error instanceof SafeRootChangedError ||
      ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(code(error)))) conflict();
  throw error;
}

/** Canonical paths and directory identities, not directory handles or a writer sandbox. */
export class TranscriptNamespace {
  private readonly nodes: BigIntStats[] = [];
  private safeRoot?: SafeRoot;
  private stopped = false;
  private initializing?: Promise<void>;
  private preparing?: Promise<void>;
  readonly components: string[];
  private readonly root: string;
  constructor(root: string, relative: unknown, readonly io: TranscriptIO = transcriptIO) {
    this.components = transcriptComponents(relative);
    if (!isAbsolute(root) || root.includes('\0')) throw new TranscriptError('invalid_configuration');
    this.root = normalize(root);
  }
  private checkOpen(): void { if (this.stopped) throw new TranscriptError('io_unavailable'); }
  /** Pin only the configured root; startup must not recreate a mapped namespace. */
  initialize(): Promise<void> {
    this.checkOpen();
    if (!this.initializing) this.initializing = this.initializeRoot().finally(() => { this.initializing = undefined; });
    return this.initializing;
  }
  private async initializeRoot(): Promise<void> {
    if (!this.safeRoot) {
      // Retain the injected root-I/O boundary, including startup fault/gating hooks.
      const root = await openSafeRoot(await this.io.realpath(this.root));
      const stat = await this.io.lstat(await root.resolve([], 'directory'));
      if (!stat.isDirectory() || stat.isSymbolicLink()) conflict();
      await root.resolve([], 'directory');
      this.checkOpen();
      this.safeRoot = root;
      this.nodes.push(stat);
    }
    await this.validate();
  }
  /** Existing mapped parents are checked with create=false, never repaired or recreated. */
  prepare(create = true): Promise<void> {
    if (!this.preparing) this.preparing = this.prepareDirectories(create).finally(() => { this.preparing = undefined; });
    return this.preparing;
  }
  private async prepareDirectories(create: boolean): Promise<void> {
    this.checkOpen();
    await this.initialize();
    const root = this.safeRoot;
    if (!root) throw new TranscriptError('io_unavailable');
    try {
      for (let index = this.nodes.length - 1; index < this.components.length; index++) {
        await this.validate();
        const components = this.components.slice(0, index + 1);
        let path: string;
        try { path = await root.resolve(components, 'directory'); }
        catch (error) {
          if (code(error) !== 'ENOENT') throw error;
          if (!create) conflict();
          if (!isPortableName(this.components[index])) throw new TranscriptError('invalid_configuration');
          path = await root.resolve(components, 'missing');
          try { await this.io.mkdir(path, 0o700); }
          catch (error) { if (code(error) !== 'EEXIST') throw error; }
          path = await root.resolve(components, 'directory');
        }
        const stat = await this.io.lstat(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) conflict();
        this.nodes.push(stat);
      }
      await this.validate();
    } catch (error) { namespaceFailure(error); }
  }
  async validate(): Promise<void> {
    this.checkOpen();
    const root = this.safeRoot;
    if (!root) throw new TranscriptError('io_unavailable');
    try {
      for (let index = 0; index < this.nodes.length; index++) {
        const path = await root.resolve(this.components.slice(0, index), 'directory');
        const named = await this.io.lstat(path);
        if (!named.isDirectory() || named.isSymbolicLink() || !sameIdentity(named, this.nodes[index])) conflict();
      }
    } catch (error) { namespaceFailure(error); }
  }
  /** A checked ordinary path, not a reservation; file opens still use the injected I/O seam. */
  async resolve(name: string, kind: 'file' | 'missing'): Promise<string> {
    this.path(name);
    await this.validate();
    if (!this.safeRoot) throw new TranscriptError('io_unavailable');
    try { return await this.safeRoot.resolve([...this.components, name], kind); }
    catch (error) { namespaceFailure(error); }
  }
  path(name: string): string {
    this.checkOpen();
    if (!this.safeRoot || this.nodes.length !== this.components.length + 1 || !/^think-[0-9a-f-]{36}\.md$/.test(name) || !isPortableName(name)) {
      throw new TranscriptError('invalid_configuration');
    }
    return join(this.safeRoot.path, ...this.components, name);
  }
  identities(): TranscriptDirectoryIdentity[] {
    if (this.nodes.length !== this.components.length + 1) throw new TranscriptError('io_unavailable');
    return this.nodes.map(identityOf);
  }
  async sync(ancestors = true): Promise<void> {
    await this.validate();
    if (!this.safeRoot) throw new TranscriptError('io_unavailable');
    // Flush both the file name and any newly created directory names before confirming bytes.
    try {
      for (let index = this.nodes.length - 1; index >= (ancestors ? 0 : this.nodes.length - 1); index--) {
        await this.io.syncDirectory(this.safeRoot, this.components.slice(0, index));
      }
      await this.validate();
    } catch (error) { namespaceFailure(error); }
  }
  async close(): Promise<void> {
    this.stopped = true;
  }
}

export interface TranscriptFileOptions {
  /** Only a registry-bound caller supplies this; filenames/frontmatter never establish ownership. */
  checkpoint?: TranscriptFileCheckpoint;
  acquired?(checkpoint: TranscriptFileCheckpoint): void;
}

/** A living writer or a verified registry checkpoint; never filename-based adoption. */
export class OwnedTranscriptFile {
  private created = false;
  private identity?: FileIdentity;
  private expected?: string;
  private rejected?: string;
  private confirmed = 0;
  private verified = 0;
  private confirmedHash = createHash('sha256');
  private verifiedHash = createHash('sha256');
  private restoredDigest?: string;
  private pending?: TranscriptBytes;
  private lastConfirmed?: TranscriptBytes;
  private readonly checkpointBytes: TranscriptBytes = { length: 0, async *chunks() {} };
  constructor(private readonly namespace: TranscriptNamespace, private readonly name: string, private readonly options: TranscriptFileOptions = {}) {
    const checkpoint = options.checkpoint;
    if (checkpoint) {
      const dev = parseFileIdValue(checkpoint.dev); const ino = parseFileIdValue(checkpoint.ino);
      if (dev === undefined || ino === undefined || !Number.isSafeInteger(checkpoint.offset) || checkpoint.offset < 0 ||
          typeof checkpoint.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(checkpoint.sha256)) conflict();
      // A legacy numeric fingerprint never matches; the restored digest forces a full prefix verification first.
      this.created = true; this.identity = { dev, ino }; this.expected = checkpoint.fingerprint;
      this.confirmed = checkpoint.offset; this.restoredDigest = checkpoint.sha256;
    }
  }
  confirmedCheckpoint(): TranscriptFileCheckpoint {
    if (!this.identity || !this.expected || this.restoredDigest !== undefined) throw new TranscriptError('io_unavailable');
    return { dev: this.identity.dev, ino: this.identity.ino, fingerprint: this.expected, offset: this.confirmed, sha256: this.confirmedHash.copy().digest('hex') };
  }

  checkpoint(stopping: () => boolean): Promise<void> { return this.append(this.checkpointBytes, stopping); }

  private async stat(handle: TranscriptHandle): Promise<BigIntStats> {
    await this.namespace.validate();
    const actual = await handle.stat();
    let named: BigIntStats;
    try { named = await this.namespace.io.lstat(await this.namespace.resolve(this.name, 'file')); }
    catch (error) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(code(error)))) conflict(); throw error; }
    fileStat(actual); fileStat(named);
    if (!this.identity || !sameIdentity(actual, this.identity) || !sameIdentity(named, this.identity) || fingerprint(actual) !== fingerprint(named)) conflict();
    return actual;
  }
  private async read(handle: TranscriptHandle, at: number, length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(length);
    for (let offset = 0; offset < length;) {
      const { bytesRead } = await handle.read(bytes, offset, length - offset, at + offset);
      if (!bytesRead || bytesRead > length - offset) conflict();
      offset += bytesRead;
    }
    return bytes;
  }
  private async verifyChanged(handle: TranscriptHandle, before: BigIntStats, source: TranscriptBytes, stopping: () => boolean): Promise<void> {
    const observed = fingerprint(before);
    if (this.rejected === observed) conflict();
    try {
      const size = transcriptSize(before);
      if (size < this.confirmed || size > this.confirmed + source.length) conflict();
      const hash = createHash('sha256');
      for (let at = 0; at < this.confirmed; at += 65536) {
        if (stopping()) throw new TranscriptError('io_unavailable');
        hash.update(await this.read(handle, at, Math.min(65536, this.confirmed - at)));
      }
      if (hash.copy().digest('hex') !== (this.restoredDigest ?? this.confirmedHash.copy().digest('hex'))) conflict();
      const confirmedHash = hash.copy();
      const tail = size - this.confirmed;
      let compared = 0;
      for await (const bytes of source.chunks(0)) {
        if (stopping()) throw new TranscriptError('io_unavailable');
        const size = Math.min(bytes.length, tail - compared);
        if (!size) break;
        const actual = await this.read(handle, this.confirmed + compared, size);
        if (!Buffer.from(actual).equals(Buffer.from(bytes.subarray(0, size)))) conflict();
        hash.update(actual); compared += size;
        if (compared === tail) break;
      }
      if (compared !== tail || fingerprint(await this.stat(handle)) !== observed) conflict();
      this.confirmedHash = confirmedHash; this.restoredDigest = undefined;
      this.verified = size; this.verifiedHash = hash; this.expected = observed; this.rejected = undefined;
    } catch (error) {
      if (error instanceof TranscriptError && error.reason === 'conflict') {
        try { if (fingerprint(await this.stat(handle)) === observed) this.rejected = observed; } catch { /* Recheck namespace on the next bounded attempt. */ }
      }
      throw error;
    }
  }

  async append(source: TranscriptBytes, stopping: () => boolean): Promise<void> {
    if (this.pending && this.pending !== source) {
      // A zero-byte durability check owns no new body. Finish it before accepting new bytes;
      // an actual partial append must still resume only its original immutable source.
      if (this.pending === this.checkpointBytes) await this.checkpoint(stopping);
      else throw new TranscriptError('content_gap');
    }
    this.pending = source;
    if (stopping()) throw new TranscriptError('io_unavailable');
    await this.namespace.prepare(!this.created);
    let handle: TranscriptHandle | undefined;
    try {
      const path = this.namespace.path(this.name);
      if (!this.created) {
        try {
          await this.namespace.resolve(this.name, 'missing');
          handle = await this.namespace.io.open(path, fileFlags | constants.O_CREAT | constants.O_EXCL, 0o600);
        }
        catch (error) { if (code(error) === 'EEXIST') conflict(); throw error; }
        // Even a failed first fstat must never authorize a later recreate/adoption.
        this.created = true;
        const initial = await handle.stat();
        fileStat(initial);
        if (initial.size !== 0n) conflict();
        const identity = identityOf(initial);
        this.identity = identity; this.expected = fingerprint(initial);
        this.options.acquired?.({ dev: identity.dev, ino: identity.ino, fingerprint: this.expected, offset: 0, sha256: this.confirmedHash.copy().digest('hex') });
      } else {
        if (!this.identity) conflict();
        try {
          const named = await this.namespace.io.lstat(await this.namespace.resolve(this.name, 'file'));
          fileStat(named);
          if (!sameIdentity(named, this.identity)) conflict();
          handle = await this.namespace.io.open(path, fileFlags);
        }
        catch (error) { if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(String(code(error)))) conflict(); throw error; }
      }
      const before = await this.stat(handle);
      if (this.lastConfirmed === source) {
        if (fingerprint(before) !== this.expected) await this.verifyChanged(handle, before, this.checkpointBytes, stopping);
        await handle.sync(); await this.namespace.sync();
        if (fingerprint(await this.stat(handle)) !== this.expected) conflict();
        this.pending = undefined;
        return;
      }
      if (this.restoredDigest !== undefined || fingerprint(before) !== this.expected || transcriptSize(before) !== this.verified) await this.verifyChanged(handle, before, source, stopping);
      for await (const bytes of source.chunks(this.verified - this.confirmed)) {
        if (bytes.length > 65536) throw new TranscriptError('content_gap');
        for (let offset = 0; offset < bytes.length;) {
          if (stopping()) throw new TranscriptError('io_unavailable');
          const current = await this.stat(handle);
          if (fingerprint(current) !== this.expected || transcriptSize(current) !== this.verified) conflict();
          if (stopping()) throw new TranscriptError('io_unavailable');
          const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
          if (!bytesWritten || bytesWritten > bytes.length - offset) throw new TranscriptError('io_unavailable');
          this.verifiedHash.update(bytes.subarray(offset, offset + bytesWritten));
          this.verified += bytesWritten; offset += bytesWritten;
          const after = await this.stat(handle);
          if (transcriptSize(after) !== this.verified) conflict();
          this.expected = fingerprint(after);
        }
      }
      if (this.verified !== this.confirmed + source.length) throw new TranscriptError('content_gap');
      if (stopping()) throw new TranscriptError('io_unavailable');
      await handle.sync();
      await this.namespace.sync();
      if (fingerprint(await this.stat(handle)) !== this.expected) conflict();
      this.confirmed = this.verified; this.confirmedHash = this.verifiedHash.copy(); this.pending = undefined; this.lastConfirmed = source;
    } finally { await handle?.close(); }
  }
}
