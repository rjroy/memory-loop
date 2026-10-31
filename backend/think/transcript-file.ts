import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

export type TranscriptFailure = 'io_unavailable' | 'conflict' | 'content_gap' | 'invalid_configuration';
export class TranscriptError extends Error {
  constructor(readonly reason: TranscriptFailure) { super('Think transcript operation failed'); }
}

/** Narrow native-I/O seam: fault tests can wrap real owned handles, without mocking modules. */
export interface TranscriptHandle {
  readonly fd: number;
  stat(): Promise<Stats>;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  write(buffer: Uint8Array, offset: number, length: number, position: null): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
export interface TranscriptIO {
  open(path: string, flags: number, mode?: number): Promise<TranscriptHandle>;
  mkdir(path: string, mode: number): Promise<void>;
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
}
export const transcriptIO: TranscriptIO = {
  open,
  async mkdir(path, mode) { await mkdir(path, { mode }); },
  lstat, realpath,
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
const dirFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const fileFlags = constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const descriptor = (handle: TranscriptHandle, name: string) => `/proc/self/fd/${handle.fd}/${name}`;
const sameIdentity = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
const fingerprint = (s: Stats) => JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.nlink, s.uid, s.mode]);
function code(error: unknown): unknown { return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined; }
function conflict(): never { throw new TranscriptError('conflict'); }
function fileStat(stat: Stats): void {
  if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o600 || !Number.isSafeInteger(stat.size)) conflict();
}

/** Held directory descriptors pin the namespace, but do not excuse a moved/replaced path. */
export class TranscriptNamespace {
  private readonly nodes: Array<{ handle: TranscriptHandle; stat: Stats }> = [];
  private stopped = false;
  private preparing?: Promise<void>;
  readonly components: string[];
  constructor(private readonly root: string, relative: unknown, readonly io: TranscriptIO = transcriptIO) {
    this.components = transcriptComponents(relative);
    if (process.platform !== 'linux' || !process.getuid || !isAbsolute(root) || normalize(root) !== root || root.includes('\0')) throw new TranscriptError('invalid_configuration');
  }
  private checkOpen(): void { if (this.stopped) throw new TranscriptError('io_unavailable'); }
  prepare(): Promise<void> {
    if (!this.preparing) this.preparing = this.prepareDirectories().finally(() => { this.preparing = undefined; });
    return this.preparing;
  }
  private async prepareDirectories(): Promise<void> {
    this.checkOpen();
    if (!this.nodes.length) {
      if (await this.io.realpath(this.root) !== this.root) conflict();
      const handle = await this.io.open(this.root, dirFlags);
      try {
        const stat = await handle.stat();
        const named = await this.io.lstat(this.root);
        if (!stat.isDirectory() || !named.isDirectory() || !sameIdentity(stat, named)) conflict();
        this.nodes.push({ handle, stat });
      } catch (error) { await handle.close(); throw error; }
    }
    await this.validate();
    for (let index = this.nodes.length - 1; index < this.components.length; index++) {
      this.checkOpen();
      await this.validate();
      const path = descriptor(this.nodes[index].handle, this.components[index]);
      try { await this.io.mkdir(path, 0o700); }
      catch (error) { if (code(error) !== 'EEXIST') throw error; }
      let handle: TranscriptHandle;
      try { handle = await this.io.open(path, dirFlags); }
      catch (error) { if (['ELOOP', 'ENOTDIR'].includes(String(code(error)))) conflict(); throw error; }
      try {
        const stat = await handle.stat();
        const named = await this.io.lstat(path);
        if (!stat.isDirectory() || !named.isDirectory() || !sameIdentity(stat, named)) conflict();
        this.nodes.push({ handle, stat });
      } catch (error) { await handle.close(); throw error; }
    }
    await this.validate();
  }
  async validate(): Promise<void> {
    this.checkOpen();
    for (let index = 0; index < this.nodes.length; index++) {
      const node = this.nodes[index];
      let named: Stats;
      try { named = await this.io.lstat(index === 0 ? this.root : descriptor(this.nodes[index - 1].handle, this.components[index - 1])); }
      catch (error) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(code(error)))) conflict(); throw error; }
      const held = await node.handle.stat();
      if (!named.isDirectory() || !held.isDirectory() || !sameIdentity(named, node.stat) || !sameIdentity(held, node.stat)) conflict();
    }
  }
  path(name: string): string {
    this.checkOpen();
    if (this.nodes.length !== this.components.length + 1 || !/^think-[0-9a-f-]{36}\.md$/.test(name)) throw new TranscriptError('invalid_configuration');
    return descriptor(this.nodes[this.nodes.length - 1].handle, name);
  }
  async sync(): Promise<void> {
    await this.validate();
    // Flush both the file name and any newly created directory names before confirming bytes.
    for (const node of [...this.nodes].reverse()) await node.handle.sync();
  }
  async close(): Promise<void> {
    this.stopped = true;
    const nodes = this.nodes.splice(0).reverse();
    const results = await Promise.allSettled(nodes.map(node => node.handle.close()));
    if (results.some(result => result.status === 'rejected')) throw new TranscriptError('io_unavailable');
  }
}

/** One living writer's ownership/checkpoint, never reconstructed by adopting an existing file. */
export class OwnedTranscriptFile {
  private created = false;
  private identity?: Stats;
  private expected?: string;
  private rejected?: string;
  private confirmed = 0;
  private verified = 0;
  private confirmedHash = createHash('sha256');
  private verifiedHash = createHash('sha256');
  private pending?: TranscriptBytes;
  private lastConfirmed?: TranscriptBytes;
  private readonly checkpointBytes: TranscriptBytes = { length: 0, async *chunks() {} };
  constructor(private readonly namespace: TranscriptNamespace, private readonly name: string) {}

  checkpoint(stopping: () => boolean): Promise<void> { return this.append(this.checkpointBytes, stopping); }

  private async stat(handle: TranscriptHandle): Promise<Stats> {
    await this.namespace.validate();
    const actual = await handle.stat();
    let named: Stats;
    try { named = await this.namespace.io.lstat(this.namespace.path(this.name)); }
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
  private async verifyChanged(handle: TranscriptHandle, before: Stats, source: TranscriptBytes, stopping: () => boolean): Promise<void> {
    const observed = fingerprint(before);
    if (this.rejected === observed) conflict();
    try {
      if (before.size < this.confirmed || before.size > this.confirmed + source.length) conflict();
      const hash = createHash('sha256');
      for (let at = 0; at < this.confirmed; at += 65536) {
        if (stopping()) throw new TranscriptError('io_unavailable');
        hash.update(await this.read(handle, at, Math.min(65536, this.confirmed - at)));
      }
      if (hash.copy().digest('hex') !== this.confirmedHash.copy().digest('hex')) conflict();
      const tail = before.size - this.confirmed;
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
      this.verified = before.size; this.verifiedHash = hash; this.expected = observed; this.rejected = undefined;
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
    await this.namespace.prepare();
    let handle: TranscriptHandle | undefined;
    try {
      const path = this.namespace.path(this.name);
      if (!this.created) {
        try { handle = await this.namespace.io.open(path, fileFlags | constants.O_CREAT | constants.O_EXCL, 0o600); }
        catch (error) { if (code(error) === 'EEXIST') conflict(); throw error; }
        // Even a failed first fstat must never authorize a later recreate/adoption.
        this.created = true;
        const initial = await handle.stat();
        fileStat(initial);
        if (initial.size !== 0) conflict();
        this.identity = initial; this.expected = fingerprint(initial);
      } else {
        if (!this.identity) conflict();
        try {
          const named = await this.namespace.io.lstat(path);
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
      if (fingerprint(before) !== this.expected || before.size !== this.verified) await this.verifyChanged(handle, before, source, stopping);
      for await (const bytes of source.chunks(this.verified - this.confirmed)) {
        if (bytes.length > 65536) throw new TranscriptError('content_gap');
        for (let offset = 0; offset < bytes.length;) {
          if (stopping()) throw new TranscriptError('io_unavailable');
          const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, null);
          if (!bytesWritten || bytesWritten > bytes.length - offset) throw new TranscriptError('io_unavailable');
          this.verifiedHash.update(bytes.subarray(offset, offset + bytesWritten));
          this.verified += bytesWritten; offset += bytesWritten;
          const after = await this.stat(handle);
          if (after.size !== this.verified) conflict();
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
