import type { BodyRef } from './body-store';
import type { TranscriptHealth } from './contract';
import type { ProjectionEntry, ThinkContentReader } from './projection';
import { OwnedTranscriptFile, TranscriptError, TranscriptNamespace, type TranscriptBytes, type TranscriptFailure, type TranscriptIO } from './transcript-file';
import { entryFor, prepareTranscriptEntry, transcriptHeader, type PreparedTranscriptEntry, type TranscriptEntry } from './transcript-format';

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
}
export interface TranscriptWriter {
  changed(conversationId: string): void;
  retains(ref: BodyRef): boolean;
  health(conversationId: string): TranscriptHealth;
  warningCount(): number;
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
  pending: Map<string, TranscriptEntry>;
  confirmed: Set<string>;
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
  let namespace: TranscriptNamespace | undefined;
  let configurationError = false;
  try {
    if (!Number.isFinite(warningAfter) || warningAfter < 0) throw new TranscriptError('invalid_configuration');
    namespace = new TranscriptNamespace(vaultDirectory, options.directory, options.io);
  } catch { configurationError = true; }
  // Pin startup namespace independently of native setup/admission. A failed open is retried safely.
  const startup = namespace?.prepare().catch(() => {});
  let stopped = false;
  let closing: Promise<void> | undefined;

  function health(writer: WriterState): TranscriptHealth {
    const reason = configurationError && writer.started ? 'invalid_configuration' : writer.reason;
    const warning = writer.started && (writer.attention || reason === 'conflict' || reason === 'content_gap' || reason === 'invalid_configuration' ||
      (writer.firstFailure !== undefined && runtime.now() - writer.firstFailure >= warningAfter));
    return { state: configurationError && writer.started ? 'degraded' : writer.state, warning, liveTextPending: writer.live,
      ...(reason ? { reason } : {}), ...(writer.lastSyncedAt ? { lastSyncedAt: writer.lastSyncedAt } : {}),
      ...(writer.headerSynced && namespace ? { noteId: [...namespace.components, `think-${writer.id}.md`] } : {}) };
  }
  function publish(writer: WriterState): void {
    if (stopped) return;
    const encoded = JSON.stringify(health(writer));
    if (encoded === writer.published) return;
    writer.published = encoded;
    onHealth();
  }
  function enqueue(writer: WriterState): void {
    if (stopped || active.has(writer) || writer.cancelRetry) return;
    ready.add(writer);
    queueMicrotask(pump);
  }
  function failed(writer: WriterState, reason: TranscriptFailure): void {
    writer.reason = reason; writer.state = 'retrying';
    if (writer.firstFailure === undefined) {
      writer.firstFailure = runtime.now();
      writer.cancelWarning = runtime.schedule(() => { writer.cancelWarning = undefined; writer.attention = true; publish(writer); }, warningAfter);
    }
    writer.attention ||= reason !== 'io_unavailable' || runtime.now() - writer.firstFailure >= warningAfter;
    const backoff = [1000, 2000, 4000, 8000, 16000, 30000, 60000][Math.min(writer.failures++, 6)];
    const delay = Math.min(60000, Math.max(1, Math.round(backoff * (0.9 + runtime.random() * 0.2))));
    writer.cancelRetry = runtime.schedule(() => { writer.cancelRetry = undefined; enqueue(writer); }, delay);
    console.info('think_transcript_outcome', { conversationId: writer.id, outcome: 'retrying', reason });
    publish(writer);
  }

  async function scan(writer: WriterState): Promise<void> {
    let cursor: string | undefined;
    let revision: number | undefined;
    const entries: ProjectionEntry[] = [];
    let contentGap = false;
    do {
      if (stopped) return;
      const page = await content.page(writer.id, cursor);
      if (revision !== undefined && revision !== page.revision) throw new TranscriptError('io_unavailable');
      revision = page.revision; contentGap ||= page.contentHealth === 'incomplete';
      entries.push(...page.entries); cursor = page.nextCursor;
    } while (cursor);
    if ((await content.page(writer.id)).revision !== revision) throw new TranscriptError('io_unavailable');
    writer.dirty = false;
    const registrations = entries.filter(entry => entry.kind === 'lifecycle' && (entry.commandKind === 'send' || entry.commandKind === 'form-reply') && entry.state === 'registered');
    const registration = registrations[0];
    if (!writer.started && (registration || entries.some(entry => entry.kind === 'original' || entry.kind === 'form-reply' || entry.kind === 'original-capture'))) {
      writer.started = true; writer.createdAt = registration?.sourceTime ?? runtime.now();
      writer.header = transcriptHeader(writer.id, writer.createdAt);
      if (namespace) writer.file = new OwnedTranscriptFile(namespace, `think-${writer.id}.md`);
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
      if (!projected || writer.confirmed.has(projected.id) || writer.pending.has(projected.id)) continue;
      if (boundary && entry.kind === 'assistant-text') writer.partials.set(JSON.stringify([entry.messageId, entry.ordinal, boundary]), { generation: entry.body.generation, through: entry.body.through });
      const previous = writer.latest.get(projected.semantic);
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
      if (stopped) return;
      await scan(writer);
      if (!writer.started || stopped) return;
      if (configurationError || !namespace || !writer.file || !writer.header) throw new TranscriptError('invalid_configuration');
      const hasWrites = !writer.headerSynced || writer.prepared || writer.pending.size;
      if (hasWrites) {
        writer.state = 'writing'; publish(writer);
        console.info('think_transcript_attempt', { conversationId: writer.id });
      }
      if (!writer.headerSynced) {
        await writer.file.append(writer.header, () => stopped);
        writer.headerSynced = true; writer.lastSyncedAt = new Date(runtime.now()).toISOString();
      }
      while (!stopped) {
        if (writer.dirty) await scan(writer);
        const entry = writer.prepared?.entry ?? writer.pending.values().next().value;
        if (!entry) break;
        if (!writer.prepared) {
          try { writer.prepared = { entry, value: await prepareTranscriptEntry(entry, content, () => stopped) }; }
          catch { throw new TranscriptError('content_gap'); }
        }
        await writer.file.append(writer.prepared.value.source, () => stopped);
        // Confirm only after append + file/directory sync; failed attempts retain the same pinned source.
        writer.confirmed.add(entry.id);
        const wasPending = writer.pending.delete(entry.id);
        if (entry.body && wasPending) {
          const key = retainedKey(entry.body);
          const count = (retained.get(key) ?? 1) - 1;
          if (count) retained.set(key, count); else retained.delete(key);
        }
        writer.lastSyncedAt = new Date(runtime.now()).toISOString();
        await writer.prepared.value.close(); writer.prepared = undefined;
      }
      if (stopped) return;
      if (writer.gap) throw new TranscriptError('content_gap');
      if (writer.awaitingOriginal) { writer.state = 'writing'; publish(writer); return; }
      if (!hasWrites && writer.firstFailure !== undefined) {
        console.info('think_transcript_attempt', { conversationId: writer.id });
        await writer.file.checkpoint(() => stopped);
        writer.lastSyncedAt = new Date(runtime.now()).toISOString();
      }
      // A fact arriving during checkpoint I/O still needs a fresh scan and synchronization.
      if (stopped || writer.dirty) return;
      if (hasWrites || writer.firstFailure !== undefined) console.info('think_transcript_outcome', { conversationId: writer.id, outcome: 'synced' });
      writer.state = 'up-to-date'; writer.reason = undefined; writer.firstFailure = undefined; writer.failures = 0; writer.attention = false;
      writer.cancelWarning?.(); writer.cancelWarning = undefined;
      publish(writer);
    } catch (error) {
      if (!stopped) failed(writer, error instanceof TranscriptError ? error.reason : 'io_unavailable');
    }
  }
  function pump(): void {
    if (stopped) return;
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
  return {
    changed(conversationId) {
      if (stopped) return;
      let writer = writers.get(conversationId);
      if (!writer) {
        writer = { id: conversationId, dirty: true, started: false, createdAt: runtime.now(), headerSynced: false,
          pending: new Map(), confirmed: new Set(), latest: new Map(), partials: new Map(), failures: 0, attention: false, gap: false, live: false, awaitingOriginal: false, state: 'not-started' };
        writers.set(conversationId, writer);
      }
      writer.dirty = true; enqueue(writer);
    },
    retains(ref) { return retained.has(retainedKey(ref)); },
    health(conversationId) { const writer = writers.get(conversationId); return writer ? health(writer) : { state: 'not-started', warning: false, liveTextPending: false }; },
    warningCount() { let count = 0; for (const writer of writers.values()) if (health(writer).warning) count++; return count; },
    close() {
      if (!closing) {
        stopped = true; ready.clear();
        for (const writer of writers.values()) { writer.cancelRetry?.(); writer.cancelWarning?.(); }
        closing = (async () => {
          await startup;
          await Promise.allSettled([...active.values()]);
          for (const writer of writers.values()) if (writer.started) {
            const pending = !writer.headerSynced || writer.pending.size > 0 || Boolean(writer.prepared) || writer.awaitingOriginal || writer.gap || writer.dirty;
            console.info('think_transcript_outcome', { conversationId: writer.id, outcome: pending ? 'closed_pending' : 'closed_synced' });
          }
          try {
            const results = await Promise.allSettled([...writers.values()].map(async writer => { await writer.prepared?.value.close(); }));
            if (results.some(result => result.status === 'rejected')) throw new TranscriptError('io_unavailable');
          } finally { await namespace?.close(); }
        })();
      }
      return closing;
    },
  };
}
