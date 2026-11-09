import { serverLogger } from '../../src/server/logger';
import type { BodyRef } from './body-store';
import type { TranscriptHealth } from './contract';
import type { ProjectionEntry, ThinkContentReader } from './projection';
import { OwnedTranscriptFile, TranscriptError, TranscriptNamespace, type TranscriptBytes, type TranscriptFailure, type TranscriptIO } from './transcript-file';
import { entryFor, prepareTranscriptEntry, transcriptHeader, transcriptEntryIdentity, type PreparedTranscriptEntry, type TranscriptEntry } from './transcript-format';
import type { TranscriptStateStore } from './state';
import { RegisteredTranscript } from './transcript-durable';

export interface TranscriptRuntime {
  now(): number;
  /** Schedule once and return cancellation; no polling or browser-triggered retry. */
  schedule(callback: () => void, delayMs: number): () => void;
  random(): number;
}
export interface TranscriptOptions {
  directory?: unknown;
  io?: TranscriptIO;
  runtime?: TranscriptRuntime;
  warningAfterMs?: number;
  /** Registry-owned mappings/checkpoints only; omission preserves legacy no-adoption behavior. */
  state?: TranscriptStateStore;
}
export interface TranscriptWriter {
  changed(conversationId: string): void;
  retains(ref: BodyRef): boolean;
  health(conversationId: string): TranscriptHealth;
  warningCount(): number;
  /** Irrevocable target fence; drains its append without closing other writers. */
  quiesce(conversationId: string): Promise<void>;
  close(): Promise<void>;
}
interface WriterState {
  id: string;
  dirty: boolean;
  started: boolean;
  createdAt: number;
  header?: TranscriptBytes;
  headerSynced: boolean;
  file?: OwnedTranscriptFile;
  durable?: RegisteredTranscript;
  noteId?: string[];
  pending: Map<string, TranscriptEntry>;
  confirmed: Map<string, string>;
  latest: Map<string, string>;
  partials: Map<string, { generation: string; through: number }>;
  prepared?: { entry: TranscriptEntry; value: PreparedTranscriptEntry };
  cancelRetry?: () => void;
  cancelWarning?: () => void;
  firstFailure?: number;
  failures: number;
  attention: boolean;
  gap: boolean;
  live: boolean;
  awaitingOriginal: boolean;
  lastSyncedAt?: string;
  reason?: TranscriptFailure;
  state: TranscriptHealth['state'];
  published?: string;
}
const runtimeDefault: TranscriptRuntime = {
  now: () => Date.now(), random: () => Math.random(),
  schedule(callback, delay) { const timer = setTimeout(callback, delay); timer.unref(); return () => clearTimeout(timer); },
};
const retainedKey = (ref: BodyRef) => JSON.stringify([ref.key.conversationId, ref.contentId, ref.generation, ref.through]);

/** Daemon-owned observers and references only: no commands, native execution, or Markdown import. */
export function createTranscriptWriter(vaultDirectory: string, content: ThinkContentReader, onHealth: () => void, options: TranscriptOptions = {}): TranscriptWriter {
  const runtime = options.runtime ?? runtimeDefault;
  const warningAfter = options.warningAfterMs ?? 60000;
  const writers = new Map<string, WriterState>();
  const ready = new Set<WriterState>();
  const active = new Map<WriterState, Promise<void>>();
  const retained = new Map<string, number>();
  const revoked = new Set<string>();
  const quiescing = new Map<string, Promise<void>>();
  let namespace: TranscriptNamespace | undefined;
  let configurationError = false;
  try {
    if (!Number.isFinite(warningAfter) || warningAfter < 0) throw new TranscriptError('invalid_configuration');
    namespace = new TranscriptNamespace(vaultDirectory, options.directory, options.io);
  } catch {
    configurationError = true;
    // An invalid new-chat setting cannot relocate or hide a previously mapped transcript.
    if (options.state) try { namespace = new TranscriptNamespace(vaultDirectory, undefined, options.io); } catch { /* Invalid vault root too. */ }
  }
  // Pin startup namespace independently of native setup/admission. A failed open is retried safely.
  const startup = configurationError ? undefined : namespace?.initialize().catch(() => {});
  let draining = false;
  let stopped = false;
  let closing: Promise<void> | undefined;
  let cancelRecovery: (() => void) | undefined;
  let recoveryFailures = 0;
  const stopping = (writer: WriterState) => stopped || revoked.has(writer.id);

  function health(writer: WriterState): TranscriptHealth {
    const invalid = configurationError && writer.started && !writer.noteId;
    const reason = invalid ? 'invalid_configuration' : writer.reason;
    const warning = writer.started && (writer.attention || reason === 'conflict' || reason === 'content_gap' || reason === 'invalid_configuration' ||
      (writer.firstFailure !== undefined && runtime.now() - writer.firstFailure >= warningAfter));
    return { state: invalid ? 'degraded' : writer.state, warning, liveTextPending: writer.live,
      ...(reason ? { reason } : {}), ...(writer.lastSyncedAt ? { lastSyncedAt: writer.lastSyncedAt } : {}),
      ...(writer.headerSynced && (writer.noteId || namespace) ? { noteId: writer.noteId ?? [...(namespace?.components ?? []), `think-${writer.id}.md`] } : {}) };
  }
  function publish(writer: WriterState): void {
    if (stopping(writer)) return;
    const encoded = JSON.stringify(health(writer));
    if (encoded === writer.published) return;
    writer.published = encoded;
    onHealth();
  }
  function enqueue(writer: WriterState): void {
    if (draining || stopping(writer) || active.has(writer) || writer.cancelRetry) return;
    ready.add(writer);
    queueMicrotask(pump);
  }
  function failed(writer: WriterState, reason: TranscriptFailure): void {
    if (stopping(writer)) return;
    writer.reason = reason; writer.state = 'retrying';
    if (writer.firstFailure === undefined) {
      writer.firstFailure = runtime.now();
      if (!draining) writer.cancelWarning = runtime.schedule(() => { writer.cancelWarning = undefined; writer.attention = true; publish(writer); }, warningAfter);
    }
    writer.attention ||= reason !== 'io_unavailable' || runtime.now() - writer.firstFailure >= warningAfter;
    const backoff = [1000, 2000, 4000, 8000, 16000, 30000, 60000][Math.min(writer.failures++, 6)];
    const delay = Math.min(60000, Math.max(1, Math.round(backoff * (0.9 + runtime.random() * 0.2))));
    if (!draining) writer.cancelRetry = runtime.schedule(() => { writer.cancelRetry = undefined; enqueue(writer); }, delay);
    serverLogger.log('think_transcript_outcome', { conversationId: writer.id, outcome: 'retrying', reason });
    publish(writer);
  }

  function isTranscriptInput(entry: ProjectionEntry): boolean {
    return entry.kind === 'original' || entry.kind === 'form-reply' || entry.kind === 'original-capture' ||
      entry.kind === 'lifecycle' && (entry.commandKind === 'send' || entry.commandKind === 'form-reply') && entry.state === 'registered';
  }
  async function observeInputIntent(writer: WriterState): Promise<void> {
    let cursor: string | undefined;
    do {
      if (stopping(writer)) return;
      const page = await content.page(writer.id, cursor);
      if (page.entries.some(isTranscriptInput)) { writer.started = true; return; }
      cursor = page.nextCursor;
    } while (cursor);
  }
  async function scan(writer: WriterState): Promise<void> {
    // Consume this notification before reading, preserving later notifications during I/O.
    // Any failed validation still requires a fresh scan on the scheduled retry.
    writer.dirty = false;
    try { await scanSource(writer); }
    catch (error) { writer.dirty = true; throw error; }
  }
  async function scanSource(writer: WriterState): Promise<void> {
    let cursor: string | undefined;
    let revision: number | undefined;
    const entries: ProjectionEntry[] = [];
    let contentGap = false;
    do {
      if (stopping(writer)) return;
      const page = await content.page(writer.id, cursor);
      if (revision !== undefined && revision !== page.revision) throw new TranscriptError('io_unavailable');
      revision = page.revision; contentGap ||= page.contentHealth === 'incomplete';
      entries.push(...page.entries); cursor = page.nextCursor;
    } while (cursor);
    if ((await content.page(writer.id)).revision !== revision) throw new TranscriptError('io_unavailable');
    const registrations = entries.filter(entry => entry.kind === 'lifecycle' && (entry.commandKind === 'send' || entry.commandKind === 'form-reply') && entry.state === 'registered');
    const registration = registrations[0];
    if (!writer.header && entries.some(isTranscriptInput)) {
      writer.started = true; writer.createdAt = registration?.sourceTime ?? runtime.now();
      writer.header = transcriptHeader(writer.id, writer.createdAt);
      if (namespace && !options.state) writer.file = new OwnedTranscriptFile(namespace, `think-${writer.id}.md`);
    }
    if (!writer.started) return;
    const terminals = new Set(entries.filter(entry => entry.kind === 'lifecycle' && ['completed', 'failed', 'interrupted', 'cancelled-before-delivery', 'rejected'].includes(entry.state)).map(entry => entry.runId));
    writer.live = entries.some(entry => entry.kind === 'assistant-text' && entry.closure === 'open');
    // An original capture failure is not repaired with native/plugin-expanded user history.
    const originals = new Set(entries.filter(entry => entry.kind === 'original' || entry.kind === 'form-reply').map(entry => entry.clientCommandId));
    const captures = entries.filter(entry => entry.kind === 'original-capture');
    writer.awaitingOriginal = captures.some(entry => entry.state === 'pending');
    writer.gap = contentGap || captures.some(entry => entry.state === 'failed' || entry.state === 'captured' && !originals.has(entry.clientCommandId));
    for (const entry of entries) {
      let boundary: 'monitoring-loss' | 'terminal' | undefined;
      if (entry.kind === 'assistant-text' && entry.closure === 'open') {
        if (entry.runId && terminals.has(entry.runId)) boundary = 'terminal';
        else if (entry.capture === 'incomplete') boundary = 'monitoring-loss';
        if (!boundary) continue;
        const key = JSON.stringify([entry.messageId, entry.ordinal, boundary]);
        if (writer.partials.has(key)) continue;
        const loss = writer.partials.get(JSON.stringify([entry.messageId, entry.ordinal, 'monitoring-loss']));
        if (boundary === 'terminal' && loss?.generation === entry.body.generation && loss.through >= entry.body.through) continue;
      }
      const projected = entryFor(entry, runtime.now(), boundary);
      if (!projected) continue;
      const sourceIdentity = transcriptEntryIdentity(projected);
      const confirmed = writer.confirmed.get(projected.id) ?? writer.durable?.entry(projected.id)?.sourceIdentity;
      if (confirmed) {
        if (confirmed !== sourceIdentity) throw new TranscriptError('conflict');
        writer.confirmed.set(projected.id, confirmed); continue;
      }
      const pending = writer.pending.get(projected.id);
      if (pending) {
        if (transcriptEntryIdentity(pending) !== sourceIdentity) throw new TranscriptError('conflict');
        continue;
      }
      if (boundary && entry.kind === 'assistant-text') writer.partials.set(JSON.stringify([entry.messageId, entry.ordinal, boundary]), { generation: entry.body.generation, through: entry.body.through });
      const previous = writer.latest.get(projected.semantic) ?? writer.durable?.latest(projected.semantic)?.id;
      if (previous && previous !== projected.id && projected.role === 'AI') projected.metadata.supersedes_entry_id = previous;
      writer.latest.set(projected.semantic, projected.id);
      writer.pending.set(projected.id, projected);
      if (projected.body) { const key = retainedKey(projected.body); retained.set(key, (retained.get(key) ?? 0) + 1); }
    }
    // Known source loss needs attention even if an unrelated vault operation fails first.
    if (writer.gap) {
      writer.attention = true; writer.state = 'degraded'; writer.reason = 'content_gap';
      publish(writer);
    }
  }

  async function attempt(writer: WriterState): Promise<void> {
    try {
      await startup;
      if (stopping(writer)) return;
      if (options.state && namespace) {
        writer.durable ??= new RegisteredTranscript(options.state, vaultDirectory, writer.id, namespace, options.io);
        // A mapped transcript has started even if verifying its file/namespace fails next.
        try { if (writer.durable.load()) writer.started = true; }
        catch (error) {
          // Accepted input establishes logging intent even when its first store load fails.
          // Lack of source evidence must not turn an unused/preview/tool-only chat into a warning.
          if (!writer.started) {
            try { await observeInputIntent(writer); }
            catch { /* Keep the primary store failure; no input intent was established. */ }
          }
          throw error;
        }
        const record = await writer.durable.recover(() => stopping(writer));
        if (record) {
          writer.started = true; writer.createdAt = record.createdAt;
          writer.header ??= transcriptHeader(writer.id, record.createdAt);
          writer.headerSynced = (record.file?.offset ?? 0) > 0;
          writer.noteId = [...record.noteId];
          if (record.pending?.state === 'preparing' && !writer.dirty) throw new TranscriptError('content_gap');
        }
      }
      if (writer.dirty || !writer.started) await scan(writer);
      if (!writer.started || stopping(writer)) return;
      if ((configurationError && !writer.noteId) || !namespace || (!writer.file && !writer.durable) || !writer.header) throw new TranscriptError('invalid_configuration');
      const hasWrites = !writer.headerSynced || writer.prepared || writer.pending.size;
      if (hasWrites) {
        writer.state = 'writing'; publish(writer);
        serverLogger.log('think_transcript_attempt', { conversationId: writer.id });
      }
      if (!writer.headerSynced) {
        if (writer.durable) await writer.durable.append(writer.header, writer.createdAt, null, () => stopping(writer));
        else if (writer.file) await writer.file.append(writer.header, () => stopping(writer));
        writer.noteId = writer.durable?.noteId ?? writer.noteId;
        writer.headerSynced = true; writer.lastSyncedAt = new Date(runtime.now()).toISOString();
      }
      while (!stopping(writer)) {
        if (writer.dirty) await scan(writer);
        const entry = writer.prepared?.entry ?? writer.pending.values().next().value;
        if (!entry) break;
        if (!writer.prepared) {
          try { writer.prepared = { entry, value: await prepareTranscriptEntry(entry, content, () => stopping(writer)) }; }
          catch { throw new TranscriptError('content_gap'); }
        }
        if (writer.durable) await writer.durable.append(writer.prepared.value.source, writer.createdAt, entry, () => stopping(writer));
        else if (writer.file) await writer.file.append(writer.prepared.value.source, () => stopping(writer));
        // Confirm only after append + file/directory sync; failed attempts retain the same pinned source.
        writer.confirmed.set(entry.id, transcriptEntryIdentity(entry));
        const wasPending = writer.pending.delete(entry.id);
        if (entry.body && wasPending) {
          const key = retainedKey(entry.body);
          const count = (retained.get(key) ?? 1) - 1;
          if (count) retained.set(key, count); else retained.delete(key);
        }
        writer.lastSyncedAt = new Date(runtime.now()).toISOString();
        await writer.prepared.value.close(); writer.prepared = undefined;
      }
      if (stopping(writer)) return;
      // Fresh source observations cannot erase unresolved durable append work.
      if (writer.gap || writer.durable?.load()?.pending) throw new TranscriptError('content_gap');
      if (writer.awaitingOriginal) { writer.state = 'writing'; publish(writer); return; }
      if (!hasWrites && writer.firstFailure !== undefined) {
        serverLogger.log('think_transcript_attempt', { conversationId: writer.id });
        if (writer.durable) await writer.durable.checkpoint(() => stopping(writer));
        else if (writer.file) await writer.file.checkpoint(() => stopping(writer));
        writer.lastSyncedAt = new Date(runtime.now()).toISOString();
      }
      // A fact arriving during checkpoint I/O still needs a fresh scan and synchronization.
      if (stopping(writer) || writer.dirty) return;
      if (hasWrites || writer.firstFailure !== undefined) serverLogger.log('think_transcript_outcome', { conversationId: writer.id, outcome: 'synced' });
      writer.state = 'up-to-date'; writer.reason = undefined; writer.firstFailure = undefined; writer.failures = 0; writer.attention = false;
      writer.cancelWarning?.(); writer.cancelWarning = undefined;
      publish(writer);
    } catch (error) {
      if (!stopping(writer)) failed(writer, error instanceof TranscriptError ? error.reason : 'io_unavailable');
    }
  }
  function pump(): void {
    if (draining || stopped) return;
    // At most two conversations perform retry/append I/O concurrently; each owns one worker.
    for (const writer of ready) {
      if (active.size >= 2) break;
      ready.delete(writer);
      const work = attempt(writer);
      active.set(writer, work);
      void work.finally(() => {
        active.delete(writer);
        if (writer.dirty && !writer.cancelRetry) enqueue(writer);
        pump();
      });
    }
  }
  function writerFor(conversationId: string, dirty: boolean): WriterState {
    let writer = writers.get(conversationId);
    if (!writer) {
      writer = { id: conversationId, dirty, started: false, createdAt: runtime.now(), headerSynced: false,
        pending: new Map(), confirmed: new Map(), latest: new Map(), partials: new Map(), failures: 0,
        attention: false, gap: false, live: false, awaitingOriginal: false, state: 'not-started' };
      writers.set(conversationId, writer);
    }
    return writer;
  }
  // Recover only mapped pending bytes here. Native history/chat hydration remains a separate layer.
  function recoverPending(after?: string): void {
    if (draining || stopped || !options.state) return;
    cancelRecovery = undefined;
    serverLogger.log('think_transcript_recovery_attempt');
    try {
      const ids = options.state.pending(vaultDirectory, after);
      for (const id of ids) if (!revoked.has(id)) { const writer = writerFor(id, false); writer.started = true; enqueue(writer); }
      recoveryFailures = 0;
      serverLogger.log('think_transcript_recovery_outcome', { status: 'ready', pending: ids.length });
      if (ids.length === 100) queueMicrotask(() => recoverPending(ids.at(-1)));
    } catch {
      serverLogger.log('think_transcript_recovery_outcome', { status: 'unavailable' });
      cancelRecovery = runtime.schedule(() => recoverPending(after), Math.min(60000, 1000 * 2 ** Math.min(recoveryFailures++, 6)));
    }
  }
  if (options.state) queueMicrotask(() => recoverPending());
  return {
    quiesce(conversationId) {
      revoked.add(conversationId);
      let work = quiescing.get(conversationId);
      if (!work) {
        const writer = writers.get(conversationId);
        if (writer) { ready.delete(writer); writer.cancelRetry?.(); writer.cancelWarning?.(); }
        work = (async () => {
          if (!writer) return;
          await active.get(writer);
          try { await writer.prepared?.value.close(); } finally { await writer.durable?.close(); }
          for (const entry of writer.pending.values()) if (entry.body) retained.delete(retainedKey(entry.body));
          writers.delete(conversationId);
        })();
        quiescing.set(conversationId, work);
        void work.catch(() => { if (quiescing.get(conversationId) === work) quiescing.delete(conversationId); });
      }
      return work;
    },
    changed(conversationId) {
      if (draining || stopped || revoked.has(conversationId)) return;
      const writer = writerFor(conversationId, true);
      writer.dirty = true;
      // A completed scan is no longer a sync claim for newly observed source facts.
      // Keep existing retry/degraded warnings and their backoff intact.
      if (writer.state === 'up-to-date') { writer.state = 'writing'; publish(writer); }
      enqueue(writer);
    },
    retains(ref) {
      const writer = writers.get(ref.key.conversationId);
      // Notifications precede the async scan that pins individual entries. Do not
      // reclaim a newly published body in that gap and force shutdown to rehydrate it.
      return retained.has(retainedKey(ref)) || Boolean(writer && (writer.dirty || active.has(writer)));
    },
    health(conversationId) { const writer = writers.get(conversationId); return writer ? health(writer) : { state: 'not-started', warning: false, liveTextPending: false }; },
    warningCount() { let count = 0; for (const writer of writers.values()) if (health(writer).warning) count++; return count; },
    close() {
      if (!closing) {
        // Freeze notifications/timers, not source access or the active append. The
        // lifetime owner keeps its projections, bodies and state open until this drains.
        draining = true; ready.clear();
        cancelRecovery?.(); cancelRecovery = undefined;
        for (const writer of writers.values()) {
          writer.cancelRetry?.(); writer.cancelRetry = undefined;
          writer.cancelWarning?.(); writer.cancelWarning = undefined;
        }
        closing = (async () => {
          await startup;
          await Promise.allSettled([...active.values()]);
          // One final attempt per healthy writer consumes dirty/queued work that had
          // not reached an active append. No retry loop or backoff bypass on failure;
          // the daemon's existing shutdown deadline also bounds blocked filesystem I/O.
          for (const writer of writers.values()) {
            if (revoked.has(writer.id) || writer.state === 'retrying') continue;
            if (writer.dirty || writer.pending.size || writer.prepared || writer.started && !writer.headerSynced) await attempt(writer);
          }
          stopped = true;
          for (const writer of writers.values()) if (writer.started) {
            const pending = !writer.headerSynced || writer.pending.size > 0 || Boolean(writer.prepared) || writer.awaitingOriginal || writer.gap || writer.dirty || writer.firstFailure !== undefined;
            serverLogger.log('think_transcript_outcome', { conversationId: writer.id, outcome: pending ? 'closed_pending' : 'closed_synced', ...(pending && writer.reason ? { reason: writer.reason } : {}) });
          }
          try {
            const results = await Promise.allSettled([...writers.values()].map(async writer => {
              try { await writer.prepared?.value.close(); } finally { await writer.durable?.close(); }
            }));
            if (results.some(result => result.status === 'rejected')) throw new TranscriptError('io_unavailable');
          } finally { await namespace?.close(); }
        })();
      }
      return closing;
    },
  };
}
