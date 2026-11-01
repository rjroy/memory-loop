import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { constants, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { link, mkdir, readFile, rename, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MessageListOutput, OpenCodeEvent, SessionFormGetOutput } from '@opencode/client';
import { createBodyStore } from '../backend/think/body-store';
import { createThinkService, type ThinkService } from '../backend/think/service';
import { openThinkState } from '../backend/think/sqlite-state';
import type { NativeSession, NativeSessions } from '../backend/think/native';
import { transcriptIO, type TranscriptIO } from '../backend/think/transcript-file';
import { createTranscriptWriter, type TranscriptRuntime } from '../backend/think/transcript';
import { ThinkStateError, type ThinkStateStore, type TranscriptStateStore } from '../backend/think/state';
import type { ProjectionEntry, ThinkContentReader } from '../backend/think/projection';
import type { TranscriptHealth } from '../backend/think/contract';

// Real Bun SQLite + the existing Think service/state/transcript-I/O injection seams.
// No native executable, model, real daemon listener, private configuration or future factory option.
const conversationId = '11111111-1111-4111-8111-111111111111';
const createCommandId = '22222222-2222-4222-8222-222222222222';
const sendCommandId = '33333333-3333-4333-8333-333333333333';
const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nativeId = `ses_memoryloop_${conversationId.replaceAll('-', '')}`;
const messageId = `msg_memoryloop_${sendCommandId.replaceAll('-', '')}`;
const now = 1_700_000_000_000;
const original = `  durable fixture original 🧠\r\n\`\`\`\n<!-- fixture literal -->\n${'x'.repeat(70 * 1024)}\nlast  `;
const assistant = 'canonical fixture answer Ω\n```\nlast';
const formCommandId = '66666666-6666-4666-8666-666666666666';
const decisionId = 'form_fixture_checkpoint';
const formAnswer = { answer: 'fixture form answer 🧠\nkeep exact' };
const filename = `think-${conversationId}.md`;
export type Scenario = 'synced' | 'synced-form' | 'partial' | 'synced-unconfirmed' | 'seal-failed' |
  'confirm-failed' | 'acquire-failed' | 'confirm-ack-lost' | 'crash-before-confirm' | 'initial-load-failed' | 'unused-load-failed';
export type ReopenScenario = 'replay' | 'recover' | 'verify-confirmed' | 'legacy' | 'prefix-edit' | 'wrong-tail' |
  'replacement' | 'symlink' | 'hardlink' | 'directory-moved' | 'missing-chunk' | 'unsealed' | 'wrong-hash' | 'changed-original' | 'changed-original-retry';

export interface Checkpoint {
  conversationId: string; ownerConversationId: string; nativeSessionId: string; vaultDirectory: string;
  noteIdJson: string; creationState: string; fileDev: number | null; fileIno: number | null;
  fileFingerprint: string | null; confirmedOffset: number; confirmedSha256: string;
  pendingEntryId: string | null; pendingLength: number | null; pendingSha256: string | null;
  pendingState: string | null;
}
export interface Probe {
  schemaVersion: number; checkpoint: Checkpoint | null; issue?: string; writerAvailable: boolean;
  entries: string[]; chunks: Array<{ index: number; hex: string; size: number }>;
}
export interface Observation {
  at: 'before-create' | 'before-first-write' | 'before-original-write' | 'after-original-file-sync' | 'after-directory-sync';
  probe: Probe; fileHex: string; fileDev?: number; fileIno?: number;
}
export interface Report {
  scenario: Scenario; observations: Observation[]; counts: { creates: number; prompts: number; stops: number };
  runId: string; expectedOriginal: string; markdown: string; health: unknown; afterClose: Probe;
  sourceEntries: ProjectionEntry[];
  replies: number;
  storeFaults: Array<{ point: string; probe: Probe; fileHex: string; directorySyncs: number }>;
  pid: number;
}

export interface InitialLoadReport {
  eligible: boolean; counts: Report['counts']; initialQuiet: boolean; admitted: boolean; attempted: boolean;
  originalCaptured: boolean; eligibleLoadFailures: number; unusedLoadFailures: number; transcriptWrites: number;
  samples: Array<{ elapsedMs: number; callbacks: number; health: TranscriptHealth; observer: TranscriptHealth;
    backgroundWarnings: number; nativeBusy: boolean }>;
  after: Probe;
}
export interface CrashReport { crashed: true; counts: Report['counts']; expectedOriginal: string; markdown: string; pending: Probe; pid: number }
export interface ReopenReport {
  mode: ReopenScenario; before: Probe; after: Probe; health: unknown; beforeHex: string; afterHex: string;
  preserved: Array<{ path: string; beforeHex: string; afterHex: string }>;
  oldBodies: Array<{ contentId: string; generation: string }>;
  newBodies: Array<{ contentId: string; generation: string }>;
  writes: number; writeBytes: number; sourceReads: number; bodyReads: number; lockAvailable: boolean[];
  fileType: 'file' | 'symlink';
  pid: number;
  originalBeforeHex: string | null;
  originalAfterHex: string | null;
  retry?: { samples: Array<{ elapsedMs: number; callbacks: number; sourceReads: number; health: TranscriptHealth }>;
    revalidated: TranscriptHealth; revalidationReads: number };
}

function originalFraming(runId: string): string {
  return `## User — ${new Date(now).toISOString()}\n\n<!-- memory-loop-entry ${JSON.stringify({
    entry_id: `user:${sendCommandId}`, at: new Date(now).toISOString(), time_basis: 'source', run_id: runId,
    kind: 'user', message_id: messageId, delivery: 'registered', body_utf8_bytes: Buffer.byteLength(original),
  })} -->\n\`\`\`\`text\n${original}\n\`\`\`\`\n<!-- memory-loop-end ${JSON.stringify({ entry_id: `user:${sendCommandId}` })} -->\n\n`;
}
export interface MigrationReport {
  schemaVersion: number; installationId: string; originalHex: string; payloadSha256: string;
  commandState: string; conversationId: string; nativeSessionId: string; legacy: string; transcriptMapped: boolean;
}

// Planned v2 additions, retaining the v1 ownership/command tables unchanged:
// transcripts(conversation_id PK REFERENCES conversations, note_id_json, creation_state,
//   file_dev, file_ino, file_fingerprint, confirmed_offset, confirmed_sha256,
//   pending_entry_id, pending_length, pending_sha256).
// transcript_entries(conversation_id REFERENCES transcripts, entry_id), composite PK.
// transcript_pending_chunks(conversation_id REFERENCES transcripts, chunk_index, bytes BLOB),
//   composite PK, each bytes <= 65536. Exact pending framing includes retained timestamps.
// creation_state is 'intent' before exclusive create, 'owned' after acquired identity;
// no confirmed entry/prefix advance or pending deletion until file AND directory sync.
// Queries are deliberately record-specific, never a scan for matching facts in arbitrary tables.
function probe(database: string): Probe {
  const result: Probe = { schemaVersion: 0, checkpoint: null, writerAvailable: false, entries: [], chunks: [] };
  const db = new Database(database, { readwrite: true, create: false });
  try {
    result.schemaVersion = Number(db.query('PRAGMA user_version').values()[0]?.[0]);
    try {
      result.checkpoint = db.query<Checkpoint, [string]>(`SELECT t.conversation_id AS conversationId,
        c.conversation_id AS ownerConversationId, c.native_session_id AS nativeSessionId, c.vault_directory AS vaultDirectory,
        t.note_id_json AS noteIdJson, t.creation_state AS creationState, t.file_dev AS fileDev, t.file_ino AS fileIno,
        t.file_fingerprint AS fileFingerprint, t.confirmed_offset AS confirmedOffset, t.confirmed_sha256 AS confirmedSha256,
        t.pending_entry_id AS pendingEntryId, t.pending_length AS pendingLength, t.pending_sha256 AS pendingSha256,
        t.pending_state AS pendingState
        FROM transcripts t JOIN conversations c ON c.conversation_id = t.conversation_id WHERE t.conversation_id = ?`).get(conversationId);
      result.entries = db.query<{ entryId: string }, [string]>(
        'SELECT entry_id AS entryId FROM transcript_entries WHERE conversation_id = ? ORDER BY entry_id').all(conversationId).map(row => row.entryId);
      result.chunks = db.query<{ index: number; hex: string; size: number }, [string]>(`SELECT chunk_index AS "index",
        lower(hex(bytes)) AS hex, length(bytes) AS size FROM transcript_pending_chunks WHERE conversation_id = ? ORDER BY chunk_index`).all(conversationId);
    } catch (error) { result.issue = error instanceof Error ? error.message : 'checkpoint query failed'; }
    // A separate connection must acquire a writer without waiting at EVERY filesystem boundary.
    try { db.run('PRAGMA busy_timeout = 0'); db.run('BEGIN IMMEDIATE'); db.run('ROLLBACK'); result.writerAvailable = true; }
    catch { result.writerAvailable = false; }
  } finally { db.close(); }
  return result;
}

async function until<T>(get: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = await get();
    if (ready(value)) return value;
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Fixture production path did not settle; this is not the expected durability RED');
}

// Same test-owned timer-set pattern as think-transcript-faults.test.ts. No global/fake real-time clock.
function retryClock(start: number) {
  let current = start;
  let scheduled = 0;
  let callbacks = 0;
  const timers = new Set<{ at: number; callback: () => void }>();
  const runtime: TranscriptRuntime = { now: () => current, random: () => 0.5, schedule(callback, delay) {
    const timer = { at: current + delay, callback }; scheduled++; timers.add(timer);
    return () => { timers.delete(timer); };
  } };
  return { runtime, fired: () => callbacks, async advanceTo(at: number, settled: () => boolean) {
    if (at < current) throw new Error('fixture clock must advance monotonically');
    current = at;
    const before = scheduled;
    const due = [...timers].filter(timer => timer.at <= at);
    for (const timer of due) { timers.delete(timer); callbacks++; timer.callback(); }
    if (due.length) {
      // A failed attempt schedules its next callback; a successful attempt publishes up-to-date.
      // Wait for either actual outcome, not for the pre-retry health snapshot.
      await until(async () => { await new Promise<void>(resolve => setImmediate(resolve)); return scheduled > before || settled(); }, Boolean);
    }
  } };
}

async function migrateV1(root: string): Promise<MigrationReport> {
  const projectRoot = join(root, 'project');
  const vault = join(root, 'vault');
  await mkdir(join(projectRoot, '.memory-loop'), { recursive: true, mode: 0o700 });
  await mkdir(join(vault, 'Conversations', 'Memory Loop'), { recursive: true });
  const legacy = join(vault, 'Conversations', 'Memory Loop', filename);
  await writeFile(legacy, 'pre-checkpoint transcript must not be adopted or changed', { mode: 0o600 });
  const database = join(projectRoot, '.memory-loop', 'application.sqlite');
  await writeFile(database, '', { mode: 0o600 });
  const installationId = '44444444-4444-4444-8444-444444444444';
  const payloadSha256 = createHash('sha256').update(original).digest('hex');
  // Fixed, test-owned v1 migration input: not imported from mutable production schema constants.
  const seed = new Database(database);
  try {
    seed.run(`CREATE TABLE application_metadata(singleton INTEGER PRIMARY KEY, installation_id TEXT NOT NULL UNIQUE);
      CREATE TABLE conversations(conversation_id TEXT PRIMARY KEY NOT NULL, native_session_id TEXT NOT NULL UNIQUE,
        vault_directory TEXT NOT NULL, owner_marker_json TEXT NOT NULL, creation_epoch TEXT NOT NULL,
        context_json TEXT NOT NULL, effective_context_json TEXT, created_at INTEGER NOT NULL, creation_state TEXT NOT NULL);
      CREATE TABLE commands(command_id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations,
        kind TEXT NOT NULL, state TEXT NOT NULL, original_input BLOB, payload_sha256 TEXT,
        dispatch_attempted INTEGER NOT NULL DEFAULT 0, run_id TEXT, native_message_id TEXT, decision_id TEXT,
        registered_at INTEGER NOT NULL, registration_epoch TEXT NOT NULL, failure_code TEXT);
      CREATE INDEX commands_conversation ON commands(conversation_id, registered_at);
      PRAGMA user_version = 1;`);
    seed.query('INSERT INTO application_metadata VALUES (1, ?)').run(installationId);
    seed.query('INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)').run(conversationId, nativeId, vault,
      JSON.stringify({ owner: 'memory-loop', conversationId, epoch, installationId }), epoch, '{}', now, 'ready');
    seed.query('INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, NULL)').run(sendCommandId, conversationId,
      'send', 'upstream-unconfirmed', Buffer.from(original), payloadSha256, '55555555-5555-4555-8555-555555555555', messageId, now, epoch);
  } finally { seed.close(); }
  const store = await openThinkState(projectRoot, vault);
  const command = store.command(sendCommandId);
  if (!command?.original || !command.payloadSha256) throw new Error('Existing v1 admission record could not be decoded');
  const retainedInstallation = store.installationId;
  store.close();
  const after = new Database(database, { readonly: true, create: false });
  try {
    const owner = after.query<{ conversationId: string; nativeSessionId: string }, [string]>(
      'SELECT conversation_id AS conversationId, native_session_id AS nativeSessionId FROM conversations WHERE conversation_id = ?').get(conversationId);
    if (!owner) throw new Error('v1 ownership row disappeared');
    return { schemaVersion: Number(after.query('PRAGMA user_version').values()[0]?.[0]), installationId: retainedInstallation,
      originalHex: Buffer.from(command.original).toString('hex'), payloadSha256: command.payloadSha256,
      commandState: command.receipt.state, ...owner, legacy: await readFile(legacy, 'utf8'), transcriptMapped: probe(database).checkpoint !== null };
  } finally { after.close(); }
}

async function run(root: string, scenario: Scenario, output: string): Promise<Report | InitialLoadReport> {
  const projectRoot = join(root, 'project');
  const vault = join(root, 'vault');
  await mkdir(join(projectRoot, '.memory-loop'), { recursive: true, mode: 0o700 });
  await mkdir(vault);
  const database = join(projectRoot, '.memory-loop', 'application.sqlite');
  const state = await openThinkState(projectRoot, vault);
  const bodies = await createBodyStore({ directory: join(root, 'bodies'), epoch, vaultDirectory: vault });
  const target = join(vault, 'Conversations', 'Memory Loop', filename);
  const observations: Observation[] = [];
  const counts = { creates: 0, prompts: 0, stops: 0 };
  const initialLoadFault = scenario === 'initial-load-failed' || scenario === 'unused-load-failed';
  const loadClock = retryClock(now);
  let releaseStartup: () => void = () => {};
  const startupGate = new Promise<void>(resolve => { releaseStartup = resolve; });
  let loadUnavailable = false;
  let eligibleLoadFailures = 0;
  let unusedLoadFailures = 0;
  let transcriptWrites = 0;
  let replies = 0;
  const form: SessionFormGetOutput = { id: decisionId, sessionID: nativeId, title: 'Fixture form',
    fields: [{ key: 'answer', type: 'string', required: true }], state: { status: 'pending' } };
  const sessions = new Map<string, NativeSession>();
  const messages: MessageListOutput['data'] = [];
  const inbox: Awaited<ReturnType<NativeSessions['listInbox']>> = [];
  const native: NativeSessions = {
    async createSession(input) {
      counts.creates++;
      if (!input.id || !input.metadata) throw new Error('fixture create identity missing');
      const session = { id: input.id, metadata: input.metadata, location: { directory: vault }, permissions: [...(input.permissions ?? [])] };
      sessions.set(session.id, session);
      return session;
    },
    async getSession(input) {
      const session = sessions.get(input.sessionID);
      if (!session) throw new Error('fixture native session absent');
      if (scenario === 'initial-load-failed' && input.sessionID === nativeId && counts.prompts) {
        return { ...session, time: { created: now, updated: now + 20, busy: now + 19 } };
      }
      return { ...session, time: counts.prompts ? { created: now, updated: now + 24, busy: now + 19, idle: now + 24 } : { created: now, updated: now },
        ...(counts.prompts ? { outcome: 'succeeded' as const } : {}) };
    },
    subscribe(_input, signal) { return { async *[Symbol.asyncIterator](): AsyncGenerator<OpenCodeEvent> {
      yield { id: 'evt_fixture_connected', type: 'server.connected', data: {} };
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    } }; },
    async prompt(input) {
      counts.prompts++;
      if (!input.id) throw new Error('fixture prompt identity missing');
      if (scenario === 'initial-load-failed') {
        const admitted: Awaited<ReturnType<NativeSessions['prompt']>> = { id: input.id, sessionID: input.sessionID,
          type: 'user', time: { created: now + 20 }, delivery: 'queue', payload: { text: 'fixture prepared while native work continues' } };
        inbox.push(admitted);
        messages.push({ id: input.id, type: 'user', text: admitted.payload.text, time: { created: now + 20 }, metadata: input.metadata });
        return admitted;
      }
      messages.push({ id: input.id, type: 'user', text: 'fixture plugin-prepared text is NOT the original', time: { created: now + 20 } },
        { id: 'msg_fixture_checkpoint_answer', type: 'assistant', agent: 'fixture', model: { providerID: 'fixture', id: 'fixture' },
          finish: 'stop', time: { created: now + 22, completed: now + 23 }, content: [{ type: 'text', text: assistant }] });
      return { id: input.id, sessionID: input.sessionID, type: 'user', time: { created: now + 20 }, delivery: 'queue', payload: { text: 'fixture prepared' } };
    },
    async listInbox() { return [...inbox]; }, async cancelInbox() { counts.stops++; },
    async interruptSession() { counts.stops++; return { interrupted: false }; }, async activeSessions() {
      return scenario === 'initial-load-failed' && counts.prompts ? { [nativeId]: { type: 'running' as const } } : {};
    },
    async listMessages() { return { data: [...messages], cursor: {} }; },
    async getMessage(input) { const message = messages.find(value => value.id === input.messageID); if (!message) throw new Error('fixture message absent'); return message; },
    async getServerInfo() { return { pid: 49123, version: '2.2.2', urls: [], paths: { tmp: root } }; },
    async listForms() { return scenario === 'synced-form' && !replies ? [form] : []; },
    async getForm() { return form; }, async replyForm() { replies++; },
    async listPermissionRequests() { return { location: { directory: vault }, data: [] }; },
  };
  let firstWrite = true;
  let originalInFlight = false;
  let originalFileSynced = false;
  let originalDirectoriesSynced = 0;
  let faulted = false;
  async function observe(at: Observation['at']) {
    let file = Buffer.alloc(0);
    let stat;
    try { file = await readFile(target); stat = lstatSync(target); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    observations.push({ at, probe: probe(database), fileHex: file.toString('hex'), ...(stat ? { fileDev: stat.dev, fileIno: stat.ino } : {}) });
  }
  const io: TranscriptIO = { ...transcriptIO,
    // Hold first transcript initialization until admission/native observation, avoiding an earlier cached null load.
    async realpath(path) { if (initialLoadFault) await startupGate; return transcriptIO.realpath(path); },
    async open(path, flags, mode) {
    if (flags & constants.O_EXCL) await observe('before-create');
    const handle = await transcriptIO.open(path, flags, mode);
    const file = !!(flags & constants.O_APPEND);
    return { fd: handle.fd, stat: () => handle.stat(), read: (...args) => handle.read(...args), close: () => handle.close(),
      async write(buffer, offset, length, position) {
        transcriptWrites++;
        if (faulted) throw Object.assign(new Error('fixture append failure'), { code: 'ENOSPC' });
        if (firstWrite) { firstWrite = false; await observe('before-first-write'); }
        if (Buffer.from(buffer.subarray(offset, offset + length)).includes(Buffer.from('"kind":"user"'))) {
          originalInFlight = true;
          await observe('before-original-write');
          if (scenario === 'partial') { faulted = true; return handle.write(buffer, offset, Math.min(7, length), position); }
        }
        return handle.write(buffer, offset, length, position);
      },
      async sync() {
        await handle.sync();
        if (file && originalInFlight) { originalFileSynced = true; await observe('after-original-file-sync'); }
        if (!file && originalInFlight && originalFileSynced) {
          originalDirectoriesSynced++;
          await observe('after-directory-sync');
          if (scenario === 'synced-unconfirmed') { faulted = true; throw Object.assign(new Error('fixture directory sync acknowledgement lost'), { code: 'EIO' }); }
          if (originalDirectoriesSynced === 3) originalInFlight = false;
        }
      },
    };
  } };
  // Retries are owned/recorded but not fired before we close this controlled failed writer.
  const runtime: TranscriptRuntime = initialLoadFault ? loadClock.runtime
    : { now: () => now, random: () => 0.5, schedule() { return () => {}; } };
  const storeFaults: Report['storeFaults'] = [];
  const durable = state.transcripts;
  function fault(point: string): never {
    faulted = true;
    storeFaults.push({ point, probe: probe(database), fileHex: readFileSync(target).toString('hex'), directorySyncs: originalDirectoriesSynced });
    throw new ThinkStateError('unavailable');
  }
  // Explicit delegates keep faults on the actual SQLite methods, with no module/prototype mocking.
  const transcriptState: TranscriptStateStore = {
    load(...args) {
      if (loadUnavailable) {
        const registered = state.command(sendCommandId);
        if (args[0] === conversationId && counts.prompts === 1 && registered?.receipt.kind === 'send' && registered.attempted) eligibleLoadFailures++;
        else unusedLoadFailures++;
        throw new ThinkStateError('unavailable');
      }
      return durable.load(...args);
    },
    pending: (...args) => durable.pending(...args), intent: (...args) => durable.intent(...args),
    acquire(...args) { if (scenario === 'acquire-failed') fault('before-acquire'); durable.acquire(...args); },
    entry: (...args) => durable.entry(...args), latest: (...args) => durable.latest(...args), begin: (...args) => durable.begin(...args),
    chunk: (...args) => durable.chunk(...args), stage: (...args) => durable.stage(...args),
    seal(...args) {
      durable.seal(...args);
      if (scenario === 'seal-failed' && durable.load(conversationId, vault)?.pending?.id === `user:${sendCommandId}`) fault('after-seal');
    },
    confirm(...args) {
      if (args[1] === `user:${sendCommandId}`) {
        if (scenario === 'confirm-failed') fault('before-confirm');
        if (scenario === 'crash-before-confirm') {
          const command = state.command(sendCommandId);
          if (command?.receipt.kind !== 'send') throw new Error('crash fixture requires a registered Send');
          const crash: CrashReport = { crashed: true, counts, expectedOriginal: originalFraming(command.receipt.runId),
            markdown: readFileSync(target, 'utf8'), pending: probe(database), pid: process.pid };
          // Exit without writer/store/body-cache close, after real file+directory sync and before SQL confirmation.
          writeFileSync(output, JSON.stringify(crash), { mode: 0o600 });
          process.exit(0);
        }
      }
      durable.confirm(...args);
      if (scenario === 'confirm-ack-lost' && args[1] === `user:${sendCommandId}`) fault('after-confirm');
    },
  };
  const serviceState: ThinkStateStore = { installationId: state.installationId, transcripts: transcriptState,
    command: (...args) => state.command(...args), registerConversation: (...args) => state.registerConversation(...args),
    registerCommand: (...args) => state.registerCommand(...args), attempted: (...args) => state.attempted(...args),
    outcome: (...args) => state.outcome(...args), close: () => state.close() };
  let service: ThinkService | undefined;
  try {
    const liveService = createThinkService({ native, bodies, state: serviceState, context: { directory: vault }, epoch,
      serviceIdentity: { pid: 49123, version: '2.2.2' }, clock: { now: runtime.now }, transcript: { io, runtime, warningAfterMs: 60000 } });
    service = liveService;
    await liveService.create({ conversationId, clientCommandId: createCommandId });
    await until(() => liveService.conversation(conversationId), value => value?.creation === 'ready');
    if (initialLoadFault) {
      const observerId = '77777777-7777-4777-8777-777777777777';
      await liveService.create({ conversationId: observerId, clientCommandId: '88888888-8888-4888-8888-888888888888' });
      await until(() => liveService.conversation(observerId), value => value?.creation === 'ready');
      const eligible = scenario === 'initial-load-failed';
      if (eligible) {
        await liveService.send({ conversationId, clientCommandId: sendCommandId, text: original });
        await until(() => liveService.command(conversationId, sendCommandId), value => counts.prompts === 1 && value?.kind === 'send' && value.state === 'admitted');
      }
      loadUnavailable = true; releaseStartup();
      await until(() => liveService.conversation(conversationId), value => value?.transcript?.state === 'retrying');
      await until(() => liveService.conversation(observerId), value => value?.transcript?.state === 'retrying');
      const samples: InitialLoadReport['samples'] = [];
      async function sample(elapsedMs: number) {
        const current = await liveService.conversation(conversationId);
        const observer = await liveService.conversation(observerId);
        const command = await liveService.command(conversationId, sendCommandId);
        if (!current?.transcript || !observer?.transcript) throw new Error('fixture must observe real transcript failure health');
        samples.push({ elapsedMs, callbacks: loadClock.fired(), health: current.transcript, observer: observer.transcript,
          backgroundWarnings: observer.otherTranscriptWarnings ?? 0,
          nativeBusy: current.sendEligibility === 'busy' && command?.kind === 'send' && command.state === 'admitted' });
      }
      await sample(0);
      const initialQuiet = samples[0].health.warning === false && samples[0].observer.warning === false;
      for (const elapsedMs of [1000, 7000, 61000, 122000]) {
        await loadClock.advanceTo(now + elapsedMs, () => false);
        await sample(elapsedMs);
      }
      const command = state.command(sendCommandId);
      const originalCaptured = (await liveService.content.page(conversationId)).entries.some(entry => entry.kind === 'original' && entry.clientCommandId === sendCommandId);
      return { eligible, counts, initialQuiet, admitted: command?.receipt.kind === 'send' && command.receipt.state === 'admitted',
        attempted: command?.attempted ?? false, originalCaptured, eligibleLoadFailures, unusedLoadFailures, transcriptWrites, samples, after: probe(database) };
    }
    const receipt = await liveService.send({ conversationId, clientCommandId: sendCommandId, text: original });
    await until(() => liveService.command(conversationId, sendCommandId), value => value?.kind === 'send' && value.state === 'completed');
    if (scenario === 'synced-form') {
      await liveService.reply({ conversationId, clientCommandId: formCommandId, decisionId, answer: formAnswer });
      await until(() => liveService.command(conversationId, formCommandId), value => value?.kind === 'form-reply' && value.state === 'replied');
    }
    const current = await until(() => liveService.conversation(conversationId), value =>
      scenario === 'synced' || scenario === 'synced-form' ? value?.transcript?.state === 'up-to-date' : faulted && value?.transcript?.state === 'retrying');
    const expectedOriginal = originalFraming(receipt.runId);
    const sourceEntries = (await liveService.content.page(conversationId)).entries;
    await liveService.close();
    return { scenario, observations, counts, runId: receipt.runId, expectedOriginal,
      markdown: await readFile(target, 'utf8'), health: current?.transcript, afterClose: probe(database), sourceEntries, replies, storeFaults, pid: process.pid };
  } finally { releaseStartup(); if (service) await service.close(); else { state.close(); await bodies.close(); } }
}

async function reopen(root: string, mode: ReopenScenario): Promise<ReopenReport> {
  const projectRoot = join(root, 'project');
  const vault = join(root, 'vault');
  const database = join(projectRoot, '.memory-loop', 'application.sqlite');
  const target = join(vault, 'Conversations', 'Memory Loop', filename);
  const outside = join(root, 'unrelated-sentinel.md');
  await writeFile(outside, 'fixture unrelated bytes 🧠', { mode: 0o600 });
  const watched = [target, outside];
  const state = await openThinkState(projectRoot, vault);
  const sourceEpoch = randomUUID();
  const bodies = await createBodyStore({ directory: join(root, `reopen-bodies-${randomUUID()}`), epoch: sourceEpoch, vaultDirectory: vault });
  const entries: ProjectionEntry[] = [];
  const oldBodies: ReopenReport['oldBodies'] = [];
  const newBodies: ReopenReport['newBodies'] = [];
  if (mode === 'replay' || mode === 'changed-original' || mode === 'changed-original-retry') {
    // Recorded test-owned source facts, not an implementation of native-history hydration.
    const seed = JSON.parse(await readFile(join(root, 'report.json'), 'utf8')) as Report;
    for (const entry of seed.sourceEntries) {
      if (entry.kind === 'original' || entry.kind === 'assistant-text' || entry.kind === 'form-reply') {
        oldBodies.push({ contentId: entry.body.contentId, generation: entry.body.generation });
        const command = entry.kind === 'original' || entry.kind === 'form-reply' ? state.command(entry.clientCommandId) : null;
        const bytes = entry.kind === 'assistant-text' ? Buffer.from(assistant)
          : mode.startsWith('changed-original') && entry.kind === 'original' ? Buffer.from('different bytes under the SAME original command') : command?.original;
        if (!bytes) throw new Error('fixture original must come from its actual admitted SQLite command');
        const body = await bodies.replace(entry.body.key, (async function* () { yield bytes; })(), 'canonical');
        newBodies.push({ contentId: body.contentId, generation: body.generation });
        entries.push({ ...entry, body });
      } else entries.push(entry);
    }
    if (mode === 'replay') entries.push({ kind: 'compaction', sessionId: nativeId, eventId: 'evt_fixture_observed_after_restart',
      phase: 'ended', sourceTime: now + 1000, sourceSequence: 9, displayOrder: 100 });
  } else if (mode === 'legacy') {
    const command = state.command(sendCommandId);
    if (!command?.original || command.receipt.kind !== 'send') throw new Error('fixture migrated command absent');
    const body = await bodies.replace({ conversationId, owner: { kind: 'original', clientCommandId: sendCommandId, messageId } },
      (async function* () { yield command.original ?? Buffer.alloc(0); })(), 'canonical');
    entries.push({ kind: 'original', clientCommandId: sendCommandId, messageId, body, displayOrder: 1, sourceTime: now, runId: command.receipt.runId });
  }

  if (mode === 'prefix-edit') {
    const bytes = await readFile(target);
    const at = bytes.indexOf(Buffer.from('durable fixture original'));
    if (at < 0) throw new Error('fixture confirmed original not present');
    bytes[at] = 88;
    await writeFile(target, bytes);
  } else if (mode === 'wrong-tail') {
    const bytes = await readFile(target);
    const checkpoint = probe(database).checkpoint;
    if (!checkpoint || bytes.length <= checkpoint.confirmedOffset) throw new Error('fixture pending suffix absent');
    bytes[bytes.length - 1] = 88;
    await writeFile(target, bytes);
  } else if (mode === 'replacement' || mode === 'symlink') {
    const held = `${target}.owned`;
    await rename(target, held); watched.push(held);
    if (mode === 'replacement') await writeFile(target, await readFile(held), { mode: 0o600 });
    else await symlink(outside, target);
  } else if (mode === 'hardlink') {
    const linked = join(root, 'linked-transcript.md');
    await link(target, linked); watched.push(linked);
  } else if (mode === 'directory-moved') {
    const moved = join(vault, 'Conversations-owned');
    await rename(join(vault, 'Conversations'), moved);
    await mkdir(join(vault, 'Conversations', 'Memory Loop'), { recursive: true });
    // Keep the exact owned FILE inode/bytes, changing only its parent namespace identity.
    await rename(join(moved, 'Memory Loop', filename), target);
    const sentinel = join(moved, 'namespace-sentinel.md');
    await writeFile(sentinel, 'old namespace untouched'); watched.push(sentinel);
  } else if (mode === 'missing-chunk' || mode === 'wrong-hash' || mode === 'unsealed') {
    const db = new Database(database, { readwrite: true, create: false });
    try {
      if (mode === 'missing-chunk') db.query('DELETE FROM transcript_pending_chunks WHERE conversation_id = ? AND chunk_index = 0').run(conversationId);
      if (mode === 'wrong-hash') db.query('UPDATE transcripts SET pending_sha256 = ? WHERE conversation_id = ?').run('f'.repeat(64), conversationId);
      if (mode === 'unsealed') {
        const checkpoint = probe(database).checkpoint;
        if (!checkpoint) throw new Error('fixture checkpoint absent');
        // A crash after staging but BEFORE seal cannot have appended any of this entry.
        await truncate(target, checkpoint.confirmedOffset);
        db.query("UPDATE transcripts SET pending_state = 'preparing', pending_sha256 = NULL WHERE conversation_id = ?").run(conversationId);
      }
    } finally { db.close(); }
  }

  const before = probe(database);
  const originalBeforeHex = state.command(sendCommandId)?.original;
  const snapshots = await Promise.all(watched.map(async path => ({ path, beforeHex: (await readFile(path)).toString('hex') })));
  let writes = 0;
  let writeBytes = 0;
  let sourceReads = 0;
  let bodyReads = 0;
  const lockAvailable: boolean[] = [];
  const boundary = () => { lockAvailable.push(probe(database).writerAvailable); };
  const io: TranscriptIO = { ...transcriptIO, async open(path, flags, permissions) {
    boundary();
    const handle = await transcriptIO.open(path, flags, permissions);
    return { fd: handle.fd, stat: () => handle.stat(), read: (...args) => handle.read(...args), close: () => handle.close(),
      async write(...args) { boundary(); const result = await handle.write(...args); writes++; writeBytes += result.bytesWritten; return result; },
      async sync() { boundary(); await handle.sync(); },
    };
  } };
  let revision = 1;
  const content: ThinkContentReader = {
    async page() { sourceReads++; if (mode === 'recover') throw new Error('recovery must not require native history or old body cache');
      return { conversationId, epoch: sourceEpoch, revision, entries }; },
    async open(ref) { bodyReads++; return bodies.open(ref); },
  };
  const clock = retryClock(now + 5000);
  const runtime: TranscriptRuntime = mode === 'changed-original-retry' ? clock.runtime
    : { now: () => now + 5000, random: () => 0.5, schedule() { return () => {}; } };
  const writer = createTranscriptWriter(vault, content, () => {}, { state: state.transcripts, io, runtime, warningAfterMs: 60000 });
  try {
    // Ready-pending recovery is startup-owned. Other cases explicitly deliver their fresh source notification.
    if (mode !== 'recover') writer.changed(conversationId);
    let health = await until(async () => writer.health(conversationId), value => ['up-to-date', 'retrying', 'degraded'].includes(value.state));
    let retry: ReopenReport['retry'];
    if (mode === 'changed-original-retry') {
      const samples: NonNullable<ReopenReport['retry']>['samples'] = [{ elapsedMs: 0, callbacks: clock.fired(), sourceReads, health }];
      for (const elapsedMs of [1000, 7000, 61000, 122000]) {
        await clock.advanceTo(now + 5000 + elapsedMs, () => writer.health(conversationId).state === 'up-to-date');
        samples.push({ elapsedMs, callbacks: clock.fired(), sourceReads, health: writer.health(conversationId) });
      }
      // Correct the source, not the immutable ledger/file, and demand actual revalidation rather than a sticky warning.
      const index = entries.findIndex(entry => entry.kind === 'original');
      const entry = entries[index];
      const original = state.command(sendCommandId)?.original;
      if (entry?.kind !== 'original' || !original) throw new Error('retry fixture lost its controlled original');
      const body = await bodies.replace(entry.body.key, (async function* () { yield original; })(), 'canonical');
      entries[index] = { ...entry, body }; revision++;
      const reads = sourceReads;
      writer.changed(conversationId);
      await clock.advanceTo(clock.runtime.now() + 60001, () => writer.health(conversationId).state === 'up-to-date');
      health = await until(async () => writer.health(conversationId), value => value.state === 'up-to-date' && sourceReads > reads);
      retry = { samples, revalidated: health, revalidationReads: sourceReads - reads };
    }
    await writer.close();
    const preserved = await Promise.all(snapshots.map(async value => ({ ...value, afterHex: (await readFile(value.path)).toString('hex') })));
    return { mode, before, after: probe(database), health, beforeHex: snapshots[0].beforeHex, afterHex: preserved[0].afterHex,
      preserved, oldBodies, newBodies, writes, writeBytes, sourceReads, bodyReads, lockAvailable,
      fileType: lstatSync(target).isSymbolicLink() ? 'symlink' : 'file', pid: process.pid,
      originalBeforeHex: originalBeforeHex ? Buffer.from(originalBeforeHex).toString('hex') : null,
      originalAfterHex: Buffer.from(state.command(sendCommandId)?.original ?? []).toString('hex'), ...(retry ? { retry } : {}) };
  } finally { await writer.close(); state.close(); await bodies.close(); }
}

const root = process.argv[2];
const selected = process.argv[3];
const output = process.argv[4];
if (!root?.startsWith('/tmp/opencode/think-transcript-checkpoint-') || !output?.startsWith(`${root}/`)) throw new Error('Use a test-owned checkpoint root/report path');
if (selected?.startsWith('reopen-')) {
  const mode = selected.slice('reopen-'.length);
  const modes: ReopenScenario[] = ['replay', 'recover', 'verify-confirmed', 'legacy', 'prefix-edit', 'wrong-tail',
    'replacement', 'symlink', 'hardlink', 'directory-moved', 'missing-chunk', 'unsealed', 'wrong-hash', 'changed-original', 'changed-original-retry'];
  if (!modes.includes(mode as ReopenScenario)) throw new Error('Unknown fixture reopen scenario');
  await writeFile(output, JSON.stringify(await reopen(root, mode as ReopenScenario)));
} else if (selected === 'migrate-v1') {
  await writeFile(output, JSON.stringify(await migrateV1(root)));
} else if (selected === 'probe') {
  await writeFile(output, JSON.stringify(probe(join(root, 'project', '.memory-loop', 'application.sqlite'))));
} else {
  if (!['synced', 'synced-form', 'partial', 'synced-unconfirmed', 'seal-failed', 'confirm-failed', 'acquire-failed',
    'confirm-ack-lost', 'crash-before-confirm', 'initial-load-failed', 'unused-load-failed'].includes(selected ?? '')) throw new Error('Unknown fixture scenario');
  await writeFile(output, JSON.stringify(await run(root, selected as Scenario, output)));
}
