import { constants, type BigIntStats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { isVaultComponent } from './contract';
import { isPortableName } from './portable-name';
import { openSafeRoot, SafeComponentError, SafeEntryError, SafeRootChangedError, type SafeRoot } from './safe-fs';
import { join } from 'node:path';
import { GroundGenerationError } from './ground-generation-error';
import { questionDigest, questionResourceLimit } from './ground-generation-questions';
import { generationCandidates, mergeGenerationCandidates, type GenerationJob } from './ground-generation-formats';
import { publicationTempName, type GroundGenerationPublicationState, type PublicationBaseline, type PublicationIdentity,
  type QuestionPublication, type QuestionPublicationPlan } from './ground-generation-publication-state';
import type { GenerationAttempt } from './ground-generation-state';
import type { GenerationCandidate } from './ground-generation-native';
import { exactFingerprint, fingerprintMatches, sameFileId, statIdentity } from './file-identity';

/** Stats are exact (`bigint: true`), so 64-bit file IDs are never rounded. */
export interface QuestionPublicationHandle {
  readonly fd: number;
  stat(): Promise<BigIntStats>;
  read(bytes: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  write(bytes: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
/** A narrow owned-filesystem seam for conflict, short-write and flush/crash boundary tests. */
export interface QuestionPublicationIO {
  open(path: string, flags: number, mode?: number): Promise<QuestionPublicationHandle>;
  lstat(path: string): Promise<BigIntStats>;
  realpath(path: string): Promise<string>;
  mkdir(path: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  link(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}
export const questionPublicationIO: QuestionPublicationIO = {
  async open(path, flags, mode) {
    const handle = await open(path, flags, mode);
    return { fd: handle.fd, stat: () => handle.stat({ bigint: true }),
      read: (bytes, offset, length, position) => handle.read(bytes, offset, length, position),
      write: (bytes, offset, length, position) => handle.write(bytes, offset, length, position),
      sync: () => handle.sync(), close: () => handle.close() };
  },
  lstat: path => lstat(path, { bigint: true }), realpath, rename, link, unlink,
  async mkdir(path, mode) { await mkdir(path, { mode }); } };
const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const tempFlags = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const same = sameFileId;
const code = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
function conflict(): never { throw new GroundGenerationError('conflict'); }
function unsafe(): never { throw new GroundGenerationError('configuration'); }
const identity = (s: BigIntStats): PublicationIdentity => statIdentity(s) ?? unsafe();
const fingerprintsCtime = true;
const fingerprint = (s: BigIntStats) => exactFingerprint(s, fingerprintsCtime);
/** Exact byte size; only file IDs may exceed the safe-integer range. */
function size(s: BigIntStats): number { const value = Number(s.size); return s.size >= 0n && Number.isSafeInteger(value) ? value : unsafe(); }
function validMetadata(s: BigIntStats): void { identity(s); size(s); }
function file(s: BigIntStats, links = 1): void { validMetadata(s); if (!s.isFile() || s.nlink !== BigInt(links)) unsafe(); }
/** `stat` is the observed file behind a `file` baseline; it is not persisted. */
interface Snapshot { baseline: PublicationBaseline; source: string | null; stat?: BigIntStats }

class QuestionNamespace {
  private readonly nodes: Array<{ id: string[]; stat: BigIntStats }> = [];
  private safe: SafeRoot | undefined;
  constructor(private readonly root: string, readonly noteId: readonly string[], readonly io: QuestionPublicationIO, private readonly signal: AbortSignal) {}
  private check(): void { if (this.signal.aborted) throw new Error('publication stopped'); }
  async prepare(expected?: readonly PublicationIdentity[], create = false): Promise<void> {
    this.check();
    if (this.noteId.length < 3 || this.noteId.length > 32 || this.noteId[0] !== '03_Resources' || this.noteId[1] !== 'Memory-Loop' ||
        !this.noteId.every(isVaultComponent) || !this.noteId.at(-1)?.endsWith('.md')) unsafe();
    this.safe = await openSafeRoot(this.root);
    for (let index = 0; index < this.noteId.length; index++) {
      this.check();
      const id = this.noteId.slice(0, index);
      try {
        if (create && index) {
          try {
            const name = await this.safe.resolve(id, 'missing');
            if (!isPortableName(id[id.length - 1])) unsafe();
            await this.io.mkdir(name, 0o700);
          } catch (error) { if (code(error) !== 'EEXIST') throw error; }
        }
        const named = await this.safe.resolve(id, 'directory');
        const entry = await this.io.lstat(named); validMetadata(entry);
        if (!entry.isDirectory() || expected?.[index] && !same(entry, expected[index])) conflict();
        this.nodes.push({ id, stat: entry });
      } catch (error) {
        if (code(error) === 'ENOENT' && !create && index >= (expected?.length ?? 0)) {
          if (!this.noteId.slice(index - 1).every(isPortableName)) unsafe();
          break;
        }
        if (error instanceof SafeEntryError || error instanceof SafeRootChangedError || ['ENOENT', 'ELOOP', 'ENOTDIR'].includes(String(code(error)))) conflict();
        throw error;
      }
    }
    if (!this.nodes.length || expected && this.nodes.length < expected.length) conflict();
    await this.validate();
  }
  path(name: string): string {
    const valid = name === this.noteId[this.noteId.length - 1] ? isVaultComponent(name) : isPortableName(name);
    if (!this.safe || !this.nodes.length || !valid) unsafe();
    return join(this.safe.path, ...this.nodes[this.nodes.length - 1].id, name);
  }
  async open(name: string, flags: number, mode?: number): Promise<QuestionPublicationHandle> {
    if (!this.safe || !this.nodes.length) unsafe();
    await this.validate();
    const id = [...this.nodes[this.nodes.length - 1].id, name];
    const creating = (flags & constants.O_CREAT) !== 0 && (flags & constants.O_EXCL) !== 0;
    if (creating && !isPortableName(name)) unsafe();
    try { await this.safe.resolve(id, creating ? 'missing' : 'file'); }
    catch (error) {
      if (error instanceof SafeEntryError || error instanceof SafeRootChangedError) conflict();
      throw error;
    }
    return this.io.open(this.path(name), flags, mode);
  }
  identities(): PublicationIdentity[] { return this.nodes.map(node => identity(node.stat)); }
  get complete(): boolean { return this.nodes.length === this.noteId.length; }
  async validate(): Promise<void> {
    this.check();
    if (!this.safe) conflict();
    for (const node of this.nodes) {
      let named: BigIntStats;
      try { named = await this.io.lstat(await this.safe.resolve(node.id, 'directory')); }
      catch (error) {
        if (error instanceof SafeEntryError || error instanceof SafeRootChangedError || ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(code(error)))) conflict();
        throw error;
      }
      validMetadata(named);
      if (!named.isDirectory() || !same(named, node.stat)) conflict();
    }
    this.check();
  }
  async sync(): Promise<void> {
    await this.validate();
    if (!this.safe) conflict();
    for (const node of [...this.nodes].reverse()) { this.check(); await this.safe.syncDirectory(node.id); }
    await this.validate();
  }
  async read(plan?: QuestionPublication, flush = false): Promise<Snapshot> {
    await this.validate(); if (!this.complete) return { baseline: { kind: 'absent' }, source: null };
    const named = this.path(this.noteId[this.noteId.length - 1]); let handle: QuestionPublicationHandle;
    // Windows requires write access to flush a file; ordinary baseline reads stay read-only.
    try { handle = await this.open(this.noteId[this.noteId.length - 1], flush ? tempFlags : readFlags); }
    catch (error) {
      if (code(error) === 'ENOENT') {
        if (!isPortableName(this.noteId[this.noteId.length - 1])) unsafe();
        return { baseline: { kind: 'absent' }, source: null };
      }
      if (['ELOOP', 'ENOTDIR'].includes(String(code(error)))) unsafe();
      throw error;
    }
    try {
      const before = await handle.stat();
      if (before.nlink === 2n && plan?.publishAttempted && plan.tempIdentity && same(before, plan.tempIdentity)) {
        const temp = await this.io.lstat(this.path(plan.tempName)); file(temp, 2); if (!same(temp, before)) conflict(); file(before, 2);
      } else file(before);
      if (size(before) > questionResourceLimit) unsafe();
      const bytes = await this.bytes(handle, size(before));
      let source: string; try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return unsafe(); }
      if (flush) {
        if (!plan?.publishAttempted || !plan.outputSha256 || questionDigest(source) !== plan.outputSha256) conflict();
        await this.validate();
        if (fingerprint(before) !== fingerprint(await handle.stat()) || fingerprint(before) !== fingerprint(await this.io.lstat(named))) conflict();
        await handle.sync();
      }
      await this.validate();
      if (fingerprint(before) !== fingerprint(await handle.stat()) || fingerprint(before) !== fingerprint(await this.io.lstat(named))) conflict();
      return { source, stat: before, baseline: { kind: 'file', identity: identity(before), fingerprint: fingerprint(before), sha256: questionDigest(source) } };
    } finally { await handle.close(); }
  }
  async bytes(handle: QuestionPublicationHandle, size: number): Promise<Buffer> {
    const bytes = Buffer.alloc(size);
    for (let at = 0; at < size;) {
      this.check(); const read = await handle.read(bytes, at, size - at, at);
      if (!Number.isSafeInteger(read.bytesRead) || read.bytesRead < 1 || read.bytesRead > size - at) conflict(); at += read.bytesRead;
    }
    return bytes;
  }
  async close(): Promise<void> {}
}
/** Plans staged before exact identities carry the legacy numeric fingerprint; compare it against the observed file. */
function unchanged(expected: PublicationBaseline, snapshot: Snapshot): void {
  const actual = snapshot.baseline;
  if (expected.kind === 'absent' ? actual.kind !== 'absent'
    : actual.kind !== 'file' || !snapshot.stat || !same(expected.identity, actual.identity) ||
      !fingerprintMatches(snapshot.stat, expected.fingerprint, fingerprintsCtime) || expected.sha256 !== actual.sha256) conflict();
}
const hasOutput = (plan: QuestionPublication, snapshot: Snapshot) => snapshot.baseline.kind === 'file' && snapshot.baseline.sha256 === plan.outputSha256;
export type QuestionPublicationResult = 'settled' | 'failed' | 'pending';
export interface GroundQuestionPublisher {
  resume(attempt: GenerationAttempt, signal: AbortSignal): Promise<QuestionPublicationResult | null>;
  complete(attempt: GenerationAttempt, candidate: GenerationCandidate | undefined, signal: AbortSignal): Promise<QuestionPublicationResult>;
  cleanup(signal: AbortSignal): Promise<void>;
}

interface PublisherOptions { directory: string; noteId: string[]; state: GroundGenerationPublicationState; io?: QuestionPublicationIO }
export function createQuestionPublisher(options: PublisherOptions): GroundQuestionPublisher {
  return createGenerationPublisher({ ...options, job: 'questions' });
}
export function createQuotePublisher(options: PublisherOptions): GroundQuestionPublisher {
  return createGenerationPublisher({ ...options, job: 'quotes' });
}

/** Immutable plans authorize only this configured job/resource. Filesystem ownership is shared, not reimplemented. */
function createGenerationPublisher(options: PublisherOptions & { job: GenerationJob }): GroundQuestionPublisher {
  const io = options.io ?? questionPublicationIO; const state = options.state;
  const check = (signal: AbortSignal) => { if (signal.aborted) throw new Error('publication stopped'); };
  const log = (attemptId: string, status: string, operation: string) => console.info('ground_generation_publication', { job: options.job, attemptId, operation, status });
  async function withNamespace<T>(plan: Pick<QuestionPublicationPlan, 'noteId' | 'directories'>, signal: AbortSignal, create: boolean, action: (ns: QuestionNamespace) => Promise<T>): Promise<T> {
    const ns = new QuestionNamespace(options.directory, plan.noteId, io, signal);
    try { await ns.prepare(plan.directories, create); return await action(ns); } finally { await ns.close(); }
  }
  async function tempPrefix(ns: QuestionNamespace, plan: QuestionPublication, handle: QuestionPublicationHandle, links = 1, name = plan.tempName): Promise<number> {
    const before = await handle.stat(); file(before, links);
    if (!plan.tempIdentity || !same(before, plan.tempIdentity) || plan.output === null) conflict();
    const output = Buffer.from(plan.output); if (size(before) > output.length) conflict();
    const bytes = await ns.bytes(handle, size(before));
    if (!bytes.equals(output.subarray(0, bytes.length)) || fingerprint(before) !== fingerprint(await handle.stat()) ||
        fingerprint(before) !== fingerprint(await io.lstat(ns.path(name)))) conflict();
    return size(before);
  }
  /** A pre-recorded random witness holds the exclusive-create inode across loss of its SQL binding.
   * No payload is written before binding. A lone filename, missing witness or substituted path is NOT proof.
   * A crash before the witness link exists is still ambiguous and deliberately fails closed. */
  async function creationProof(ns: QuestionNamespace, plan: QuestionPublication, handle: QuestionPublicationHandle): Promise<PublicationIdentity> {
    if (!plan.tempWitnessName) conflict();
    const before = await handle.stat();
    if (before.nlink !== 2n || before.size !== 0n) conflict();
    file(before, 2);
    let named: BigIntStats; let witness: BigIntStats;
    try { named = await io.lstat(ns.path(plan.tempName)); witness = await io.lstat(ns.path(plan.tempWitnessName)); }
    catch (error) { if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(String(code(error)))) conflict(); throw error; }
    file(named, 2); file(witness, 2);
    if (fingerprint(before) !== fingerprint(named) || fingerprint(before) !== fingerprint(witness)) conflict();
    await handle.sync(); await ns.sync();
    if (fingerprint(before) !== fingerprint(await handle.stat()) || fingerprint(before) !== fingerprint(await io.lstat(ns.path(plan.tempName))) ||
        fingerprint(before) !== fingerprint(await io.lstat(ns.path(plan.tempWitnessName)))) conflict();
    return identity(before);
  }
  async function retireWitness(ns: QuestionNamespace, plan: QuestionPublication, temp?: QuestionPublicationHandle): Promise<void> {
    if (!plan.tempWitnessName) return;
    let handle: QuestionPublicationHandle;
    try { handle = await ns.open(plan.tempWitnessName, readFlags); }
    catch (error) { if (code(error) === 'ENOENT') return; throw error; }
    try {
      if (temp) await tempPrefix(ns, plan, temp, 2);
      await tempPrefix(ns, plan, handle, temp ? 2 : 1, plan.tempWitnessName);
      await ns.validate();
      const named = await io.lstat(ns.path(plan.tempWitnessName));
      if (!plan.tempIdentity || !same(named, plan.tempIdentity) || fingerprint(named) !== fingerprint(await handle.stat())) conflict();
      await io.unlink(ns.path(plan.tempWitnessName)); await ns.sync();
    } finally { await handle.close(); }
  }
  async function cleanupTemp(ns: QuestionNamespace, plan: QuestionPublication): Promise<void> {
    if (!plan.tempIdentity && !plan.tempWitnessName) return;
    let handle: QuestionPublicationHandle;
    // Unbound recovery must flush the witnessed inode before recording ownership.
    try { handle = await ns.open(plan.tempName, plan.tempIdentity ? readFlags : tempFlags); }
    catch (error) {
      if (code(error) !== 'ENOENT') throw error;
      await retireWitness(ns, plan); await ns.sync(); state.clearTemp(plan.attemptId); plan.tempIdentity = null; delete plan.tempWitnessName; return;
    }
    try {
      // Transfer the proven ownership to SQLite BEFORE retiring its filesystem witness,
      // including terminal cleanup. A failed persistence leaves both links intact.
      if (!plan.tempIdentity) {
        const acquired = await creationProof(ns, plan, handle);
        state.temp(plan.attemptId, acquired); plan.tempIdentity = acquired;
      }
      await retireWitness(ns, plan, handle);
      const stat = await handle.stat();
      if (stat.nlink === 2n) {
        const target = await io.lstat(ns.path(plan.noteId[plan.noteId.length - 1]));
        if (!plan.publishAttempted || !same(target, stat)) conflict();
      }
      await tempPrefix(ns, plan, handle, stat.nlink === 2n ? 2 : 1); await ns.validate();
      await io.unlink(ns.path(plan.tempName)); await ns.sync();
      state.clearTemp(plan.attemptId); plan.tempIdentity = null; delete plan.tempWitnessName;
    } finally { await handle.close(); }
  }
  async function writeTemp(ns: QuestionNamespace, plan: QuestionPublication): Promise<void> {
    if (plan.output === null) unsafe();
    let handle: QuestionPublicationHandle | undefined;
    if (plan.tempIdentity) {
      try { handle = await ns.open(plan.tempName, tempFlags); }
      catch (error) {
        if (code(error) !== 'ENOENT') throw error;
        await retireWitness(ns, plan); await ns.sync(); state.clearTemp(plan.attemptId, true); plan.tempIdentity = null;
      }
    }
    try {
      if (!handle) {
        if (!plan.tempWitnessName) {
          const reserved = state.stage(plan.attemptId, plan);
          if (!reserved.tempWitnessName) conflict(); plan.tempWitnessName = reserved.tempWitnessName;
        }
        let created = false;
        try { handle = await ns.open(plan.tempName, tempFlags | constants.O_CREAT | constants.O_EXCL, 0o600); created = true; }
        catch (error) { if (code(error) !== 'EEXIST') throw error; handle = await ns.open(plan.tempName, tempFlags); }
        // O_EXCL success is the only path allowed to create the independent witness.
        // On EEXIST, recovery must find an already-existing matching proof instead.
        if (created) {
          try { await io.link(ns.path(plan.tempName), ns.path(plan.tempWitnessName)); }
          catch (error) { if (code(error) === 'EEXIST') conflict(); throw error; }
          await handle.sync(); await ns.sync();
        }
        const acquired = await creationProof(ns, plan, handle);
        state.temp(plan.attemptId, acquired); plan.tempIdentity = acquired;
      }
      await retireWitness(ns, plan, handle);
      const bytes = Buffer.from(plan.output); let offset = await tempPrefix(ns, plan, handle);
      while (offset < bytes.length) {
        await ns.validate(); const wrote = await handle.write(bytes, offset, bytes.length - offset, offset);
        if (!Number.isSafeInteger(wrote.bytesWritten) || wrote.bytesWritten < 1 || wrote.bytesWritten > bytes.length - offset) throw new Error('publication write unavailable');
        offset += wrote.bytesWritten;
      }
      await handle.sync(); if (await tempPrefix(ns, plan, handle) !== bytes.length) conflict();
      await ns.sync();
    } finally { await handle?.close(); }
  }
  async function apply(plan: QuestionPublication, signal: AbortSignal): Promise<QuestionPublicationResult> {
    // A publisher from the other job cannot change even the owner's receipt/state.
    check(signal); if ((plan.job ?? 'questions') !== options.job) conflict();
    log(plan.attemptId, 'attempt', 'publish');
    try {
      check(signal); if (plan.noteId.join('/') !== options.noteId.join('/')) conflict();
      await withNamespace(plan, signal, false, async ns => {
        const actual = await ns.read(plan);
        if (plan.writeRequired && plan.publishAttempted && hasOutput(plan, actual)) {
          await cleanupTemp(ns, plan); if (!hasOutput(plan, await ns.read(plan, true))) conflict();
          await ns.sync(); check(signal); state.settle(plan.attemptId); return;
        }
        unchanged(plan.baseline, actual);
        if (!plan.writeRequired) { check(signal); state.settle(plan.attemptId); return; }
      });
      const stored = state.get(plan.attemptId); if (stored?.phase === 'settled') { log(plan.attemptId, 'settled', 'publish'); return 'settled'; }
      await withNamespace(plan, signal, true, async ns => {
        if (ns.identities().length !== plan.directories.length) { await ns.sync(); state.directories(plan.attemptId, ns.identities()); plan.directories = ns.identities(); }
        unchanged(plan.baseline, await ns.read(plan));
        await writeTemp(ns, plan);
        unchanged(plan.baseline, await ns.read(plan)); await ns.validate(); check(signal);
        state.publishing(plan.attemptId); plan.publishAttempted = true;
        const temp = await ns.open(plan.tempName, readFlags);
        try { if (await tempPrefix(ns, plan, temp) !== Buffer.byteLength(plan.output ?? '')) conflict(); }
        finally { await temp.close(); }
        await ns.validate(); check(signal);
        unchanged(plan.baseline, await ns.read(plan)); check(signal);
        const target = ns.path(plan.noteId[plan.noteId.length - 1]);
        log(plan.attemptId, 'attempt', plan.baseline.kind === 'absent' ? 'create' : 'replace');
        try { if (plan.baseline.kind === 'absent') await io.link(ns.path(plan.tempName), target); else await io.rename(ns.path(plan.tempName), target); }
        catch (error) { if (code(error) === 'EEXIST') conflict(); throw error; }
        await cleanupTemp(ns, plan);
        if (!hasOutput(plan, await ns.read(plan, true))) conflict();
        await ns.sync(); check(signal); state.settle(plan.attemptId);
      });
      log(plan.attemptId, 'settled', 'publish'); return 'settled';
    } catch (error) {
      if (!signal.aborted && (error instanceof SafeComponentError || error instanceof GroundGenerationError && error.code !== 'unavailable' || ['ELOOP', 'ENOTDIR', 'EISDIR'].includes(String(code(error))))) {
        state.fail(plan.attemptId, error instanceof GroundGenerationError && error.code === 'conflict' ? 'conflict' : 'unsafe_target');
        log(plan.attemptId, 'conflict', 'publish'); return 'failed';
      }
      log(plan.attemptId, 'pending', 'publish'); return 'pending';
    }
  }
  return {
    async resume(attempt, signal) { const plan = state.get(attempt.attemptId); return plan ? apply(plan, signal) : null; },
    async complete(attempt, candidate, signal) {
      let candidatesJson: string;
      try {
        if (!candidate || questionDigest(candidate.text) !== candidate.sha256) throw new Error('invalid candidate');
        candidatesJson = generationCandidates(options.job, candidate.text, attempt.count);
      } catch { state.fail(attempt.attemptId, 'invalid_output'); log(attempt.attemptId, 'invalid_output', 'validate'); return 'failed'; }
      const prior = state.get(attempt.attemptId); if (prior) return apply(prior, signal);
      const ns = new QuestionNamespace(options.directory, options.noteId, io, signal);
      let plan: QuestionPublication;
      try {
        await ns.prepare(); const baseline = await ns.read(); check(signal);
        let merged: ReturnType<typeof mergeGenerationCandidates>;
        try { merged = mergeGenerationCandidates(options.job, baseline.source, candidatesJson); } catch { throw new GroundGenerationError('configuration'); }
        plan = state.stage(attempt.attemptId, { job: options.job, noteId: [...options.noteId], directories: ns.identities(), baseline: baseline.baseline,
          candidatesJson, sourceMessageId: candidate.messageId, sourceSha256: candidate.sha256,
          ...merged, outputSha256: merged.output === null ? null : questionDigest(merged.output), tempName: publicationTempName(attempt.attemptId, options.job) });
      } catch (error) {
        if (!signal.aborted && (error instanceof GroundGenerationError || error instanceof SafeComponentError)) { state.fail(attempt.attemptId, error instanceof GroundGenerationError && error.code === 'conflict' ? 'conflict' : 'unsafe_target'); return 'failed'; }
        log(attempt.attemptId, 'pending', 'stage'); return 'pending';
      } finally { await ns.close(); }
      return apply(plan, signal);
    },
    async cleanup(signal) {
      for (const plan of state.cleanup(options.job)) {
        check(signal);
        try {
          if ((plan.job ?? 'questions') !== options.job || plan.noteId.join('/') !== options.noteId.join('/')) conflict();
          await withNamespace(plan, signal, false, async ns => { if (!ns.complete) conflict(); await cleanupTemp(ns, plan); }); log(plan.attemptId, 'ready', 'cleanup');
        }
        catch { log(plan.attemptId, 'pending', 'cleanup'); }
      }
    },
  };
}
