import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { isVaultComponent } from './contract';
import { GroundGenerationError } from './ground-generation-error';
import { questionDigest, questionResourceLimit } from './ground-generation-questions';
import { generationCandidates, mergeGenerationCandidates, type GenerationJob } from './ground-generation-formats';
import { publicationTempName, type GroundGenerationPublicationState, type PublicationBaseline, type PublicationIdentity,
  type QuestionPublication, type QuestionPublicationPlan } from './ground-generation-publication-state';
import type { GenerationAttempt } from './ground-generation-state';
import type { GenerationCandidate } from './ground-generation-native';

export interface QuestionPublicationHandle {
  readonly fd: number;
  stat(): Promise<Stats>;
  read(bytes: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  write(bytes: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesWritten: number }>;
  sync(): Promise<void>;
  close(): Promise<void>;
}
/** A narrow owned-filesystem seam for conflict, short-write and flush/crash boundary tests. */
export interface QuestionPublicationIO {
  open(path: string, flags: number, mode?: number): Promise<QuestionPublicationHandle>;
  lstat(path: string): Promise<Stats>;
  realpath(path: string): Promise<string>;
  mkdir(path: string, mode: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  link(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}
export const questionPublicationIO: QuestionPublicationIO = { open, lstat, realpath, rename, link, unlink,
  async mkdir(path, mode) { await mkdir(path, { mode }); } };
const dirFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const tempFlags = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const same = (a: PublicationIdentity, b: PublicationIdentity) => a.dev === b.dev && a.ino === b.ino;
const identity = (s: Stats): PublicationIdentity => ({ dev: s.dev, ino: s.ino });
const fingerprint = (s: Stats) => JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.nlink, s.uid, s.mode]);
const code = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
function conflict(): never { throw new GroundGenerationError('conflict'); }
function unsafe(): never { throw new GroundGenerationError('configuration'); }
function owner(s: Stats): void {
  if (!process.getuid || s.uid !== process.getuid() || (s.mode & 0o022) !== 0 || (s.mode & 0o7000) !== 0 ||
      ![s.dev, s.ino, s.size].every(value => Number.isSafeInteger(value) && value >= 0)) unsafe();
}
function file(s: Stats, links = 1): void { owner(s); if (!s.isFile() || s.nlink !== links) unsafe(); }
interface Snapshot { baseline: PublicationBaseline; source: string | null }

class QuestionNamespace {
  private readonly nodes: Array<{ handle: QuestionPublicationHandle; stat: Stats; named: string }> = [];
  constructor(private readonly root: string, readonly noteId: readonly string[], readonly io: QuestionPublicationIO, private readonly signal: AbortSignal) {
    if (process.platform !== 'linux' || noteId.length < 3 || noteId.length > 32 || noteId[0] !== '03_Resources' || noteId[1] !== 'Memory-Loop' ||
        !noteId.every(isVaultComponent) || !noteId.at(-1)?.endsWith('.md')) unsafe();
  }
  private check(): void { if (this.signal.aborted) throw new Error('publication stopped'); }
  async prepare(expected?: readonly PublicationIdentity[], create = false): Promise<void> {
    this.check(); if (await this.io.realpath(this.root) !== this.root) conflict();
    const names = [this.root, ...this.noteId.slice(0, -1)];
    for (let index = 0; index < names.length; index++) {
      this.check(); if (index) await this.validate();
      const named = index === 0 ? this.root : this.path(names[index]);
      if (create && index) { try { await this.io.mkdir(named, 0o700); } catch (error) { if (code(error) !== 'EEXIST') throw error; } }
      let handle: QuestionPublicationHandle;
      try { handle = await this.io.open(named, dirFlags); }
      catch (error) {
        if (code(error) === 'ENOENT' && !create && index >= (expected?.length ?? 0)) break;
        if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(String(code(error)))) conflict(); throw error;
      }
      try {
        const stat = await handle.stat(); owner(stat);
        if (!stat.isDirectory() || expected?.[index] && !same(stat, expected[index])) conflict();
        this.nodes.push({ handle, stat, named });
      } catch (error) { await handle.close(); throw error; }
    }
    if (!this.nodes.length || expected && this.nodes.length < expected.length) conflict();
    await this.validate();
  }
  path(name: string): string {
    const node = this.nodes.at(-1); if (!node) throw new Error('publication namespace unavailable');
    return `/proc/self/fd/${node.handle.fd}/${name}`;
  }
  identities(): PublicationIdentity[] { return this.nodes.map(node => identity(node.stat)); }
  get complete(): boolean { return this.nodes.length === this.noteId.length; }
  async validate(): Promise<void> {
    this.check();
    for (const node of this.nodes) {
      let named: Stats;
      try { named = await this.io.lstat(node.named); }
      catch (error) { if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(code(error)))) conflict(); throw error; }
      const held = await node.handle.stat(); owner(named); owner(held);
      if (!named.isDirectory() || !held.isDirectory() || !same(named, node.stat) || !same(held, node.stat)) conflict();
    }
    this.check();
  }
  async sync(): Promise<void> { await this.validate(); for (const node of [...this.nodes].reverse()) { this.check(); await node.handle.sync(); } await this.validate(); }
  async read(plan?: QuestionPublication, flush = false): Promise<Snapshot> {
    await this.validate(); if (!this.complete) return { baseline: { kind: 'absent' }, source: null };
    const named = this.path(this.noteId[this.noteId.length - 1]); let handle: QuestionPublicationHandle;
    try { handle = await this.io.open(named, readFlags); }
    catch (error) { if (code(error) === 'ENOENT') return { baseline: { kind: 'absent' }, source: null }; if (['ELOOP', 'ENOTDIR'].includes(String(code(error)))) unsafe(); throw error; }
    try {
      const before = await handle.stat();
      if (before.nlink === 2 && plan?.publishAttempted && plan.tempIdentity && same(before, plan.tempIdentity)) {
        const temp = await this.io.lstat(this.path(plan.tempName)); file(temp, 2); if (!same(temp, before)) conflict(); file(before, 2);
      } else file(before);
      if (before.size > questionResourceLimit) unsafe();
      const bytes = await this.bytes(handle, before.size);
      if (flush) await handle.sync();
      await this.validate();
      if (fingerprint(before) !== fingerprint(await handle.stat()) || fingerprint(before) !== fingerprint(await this.io.lstat(named))) conflict();
      let source: string; try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return unsafe(); }
      return { source, baseline: { kind: 'file', identity: identity(before), fingerprint: fingerprint(before), sha256: questionDigest(source) } };
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
  async close(): Promise<void> {
    const results = await Promise.allSettled([...this.nodes].reverse().map(node => node.handle.close()));
    if (results.some(result => result.status === 'rejected')) throw new Error('publication close unavailable');
  }
}
function unchanged(expected: PublicationBaseline, actual: PublicationBaseline): void {
  if (expected.kind === 'absent' ? actual.kind !== 'absent'
    : actual.kind !== 'file' || !same(expected.identity, actual.identity) || expected.fingerprint !== actual.fingerprint || expected.sha256 !== actual.sha256) conflict();
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
    if (!plan.tempIdentity || !same(before, plan.tempIdentity) || (before.mode & 0o777) !== 0o600 || plan.output === null) conflict();
    const output = Buffer.from(plan.output); if (before.size > output.length) conflict();
    const bytes = await ns.bytes(handle, before.size);
    if (!bytes.equals(output.subarray(0, bytes.length)) || fingerprint(before) !== fingerprint(await handle.stat()) ||
        fingerprint(before) !== fingerprint(await io.lstat(ns.path(name)))) conflict();
    return before.size;
  }
  /** A pre-recorded random witness holds the exclusive-create inode across loss of its SQL binding.
   * No payload is written before binding. A lone filename, missing witness or substituted path is NOT proof.
   * A crash before the witness link exists is still ambiguous and deliberately fails closed. */
  async function creationProof(ns: QuestionNamespace, plan: QuestionPublication, handle: QuestionPublicationHandle): Promise<PublicationIdentity> {
    if (!plan.tempWitnessName) conflict();
    const before = await handle.stat();
    if (before.nlink !== 2 || before.size !== 0 || (before.mode & 0o777) !== 0o600) conflict();
    file(before, 2);
    let named: Stats; let witness: Stats;
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
    try { handle = await io.open(ns.path(plan.tempWitnessName), readFlags); }
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
    try { handle = await io.open(ns.path(plan.tempName), readFlags); }
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
      if (stat.nlink === 2) {
        const target = await io.lstat(ns.path(plan.noteId[plan.noteId.length - 1]));
        if (!plan.publishAttempted || !same(target, stat)) conflict();
      }
      await tempPrefix(ns, plan, handle, stat.nlink === 2 ? 2 : 1); await ns.validate();
      await io.unlink(ns.path(plan.tempName)); await ns.sync();
      state.clearTemp(plan.attemptId); plan.tempIdentity = null; delete plan.tempWitnessName;
    } finally { await handle.close(); }
  }
  async function writeTemp(ns: QuestionNamespace, plan: QuestionPublication): Promise<void> {
    if (plan.output === null) unsafe();
    let handle: QuestionPublicationHandle | undefined;
    if (plan.tempIdentity) {
      try { handle = await io.open(ns.path(plan.tempName), tempFlags); }
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
        try { handle = await io.open(ns.path(plan.tempName), tempFlags | constants.O_CREAT | constants.O_EXCL, 0o600); created = true; }
        catch (error) { if (code(error) !== 'EEXIST') throw error; handle = await io.open(ns.path(plan.tempName), tempFlags); }
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
        unchanged(plan.baseline, actual.baseline);
        if (!plan.writeRequired) { check(signal); state.settle(plan.attemptId); return; }
      });
      const stored = state.get(plan.attemptId); if (stored?.phase === 'settled') { log(plan.attemptId, 'settled', 'publish'); return 'settled'; }
      await withNamespace(plan, signal, true, async ns => {
        if (ns.identities().length !== plan.directories.length) { await ns.sync(); state.directories(plan.attemptId, ns.identities()); plan.directories = ns.identities(); }
        unchanged(plan.baseline, (await ns.read(plan)).baseline);
        await writeTemp(ns, plan);
        unchanged(plan.baseline, (await ns.read(plan)).baseline); await ns.validate(); check(signal);
        state.publishing(plan.attemptId); plan.publishAttempted = true;
        const temp = await io.open(ns.path(plan.tempName), readFlags);
        try { if (await tempPrefix(ns, plan, temp) !== Buffer.byteLength(plan.output ?? '')) conflict(); }
        finally { await temp.close(); }
        await ns.validate(); check(signal);
        unchanged(plan.baseline, (await ns.read(plan)).baseline); check(signal);
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
      if (!signal.aborted && (error instanceof GroundGenerationError && error.code !== 'unavailable' || ['ELOOP', 'ENOTDIR', 'EISDIR'].includes(String(code(error))))) {
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
        if (!signal.aborted && error instanceof GroundGenerationError) { state.fail(attempt.attemptId, error.code === 'conflict' ? 'conflict' : 'unsafe_target'); return 'failed'; }
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
