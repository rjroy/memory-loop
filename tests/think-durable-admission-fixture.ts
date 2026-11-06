import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { chmod, link, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { OpenCodeEvent, SessionActiveOutput, SessionCreateInput, SessionInfo, SessionPromptOutput, SessionMessageInfo, SessionFormGetOutput } from '@opencode/client';
import { OpenCode } from '@opencode/client';
import { prepareServer, type PreparedServer } from '../backend/server';
import { createApp } from '../backend/app';
import { openVault } from '../backend/vault';
import { createThinkService, type ConversationSnapshot } from '../backend/think/service';
import { createBodyStore, type BodyRef } from '../backend/think/body-store';
import { nativeSessions } from '../backend/think/native';
import { openThinkState } from '../backend/think/sqlite-state';
import type { ContentChunk } from '../backend/think/content-transfer';

// Test-only runner. No native executable/model, production listener, HOME discovery or schema import.
export const conversationId = '11111111-1111-4111-8111-111111111111';
export const createCommandId = '22222222-2222-4222-8222-222222222222';
export const sendCommandId = '33333333-3333-4333-8333-333333333333';
export const formCommandId = '44444444-4444-4444-8444-444444444444';
export const secondConversationId = '55555555-5555-4555-8555-555555555555';
export const secondCreateCommandId = '66666666-6666-4666-8666-666666666666';
export const rejectedCommandId = '77777777-7777-4777-8777-777777777777';
export const decisionId = 'form_fixture_durable_original';
export const original = '  test-owned original 🧠\r\n```\n<!-- not metadata -->\nlast line  ';
export const changedOriginal = 'changed payload must never replace the registered original';
export const preparedText = 'fixture plugin-prepared text is not the original user submission';
export const formAnswer = { zeta: 'second field', answer: '  original form 🧠\r\nlast line  ' };
export const canonicalAnswer = JSON.stringify({ answer: formAnswer.answer, zeta: formAnswer.zeta });
export const assistantMessageId = 'msg_fixture_restart_answer';
export const assistantTexts = ['Verified fixture answer 🧠\n```literal\nfirst body', 'Second text part after hidden reasoning.'];
export const orderedSecondCommandId = '99999999-9999-4999-8999-999999999999';
export const orderedTiedSecondCommandId = '00000000-0000-4000-8000-000000000001';
export const orderedSecondOriginal = '  later original B 🧠\r\nnot prepared native input  ';
export const orderedPreparedB = 'prepared-B: fixture expansion is not either original';
export const orderedStopCommandId = '88888888-8888-4888-8888-888888888888';
export const legacyId = 'ses_fixture_legacy_unowned';
const authority = '127.0.0.1:31234';
const token = 'a'.repeat(64);
const password = 'fixture-only-password';
const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
const nativeId = (id: string) => `ses_memoryloop_${id.replaceAll('-', '')}`;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export type HydrationCase = 'hydrate-busy' | 'hydrate-uncertain' | 'hydrate-uncertain-running-stop' | 'hydrate-unattempted' | 'hydrate-missing-association' | 'hydrate-corrupt-digest';
const hydrationCases: readonly HydrationCase[] = ['hydrate-busy', 'hydrate-uncertain', 'hydrate-uncertain-running-stop', 'hydrate-unattempted', 'hydrate-missing-association', 'hydrate-corrupt-digest'];
const uncertainHydration = (scenario: Scenario) => scenario === 'hydrate-uncertain' || scenario === 'hydrate-uncertain-running-stop';
const isHydrationCase = (scenario: Scenario): scenario is HydrationCase => hydrationCases.some(item => item === scenario);
const isCancelledOrder = (scenario: Scenario) => scenario === 'cancelled-input-order' || scenario === 'cancelled-input-order-tie';
export type Scenario = HydrationCase | 'create' | 'create-ready-restart' | 'history-restart' | 'cancelled-input-order' | 'cancelled-input-order-tie' | 'send' | 'form' | 'uncertain' | 'database-symlink' | 'database-hardlink' |
  'wal-symlink' | 'shm-symlink' | 'state-inside-vault';

export interface Probe {
  exists: boolean;
  error?: string;
  schemaVersion: number;
  command: CommandFact | null;
  rejectedCommandPresent: boolean;
  legacyConversationPresent: boolean;
  integrity: string | null;
  writerAvailable: boolean;
}
export interface CommandFact {
  commandId: string;
  conversationId: string;
  kind: string;
  state: string;
  originalType: string;
  originalHex: string | null;
  payloadSha256: string | null;
  dispatchAttempted: number;
  runId: string | null;
  nativeMessageId: string | null;
  decisionId: string | null;
  registeredAt: number;
  ownerConversationId: string;
  nativeSessionId: string;
  vaultDirectory: string;
  ownerMarkerJson: string;
  creationEpoch: string;
}
interface Observation { operation: 'create' | 'prompt' | 'form-reply'; probe: Probe; input: unknown }
interface HistoryRead {
  status: number;
  snapshot: ConversationSnapshot | null;
  error: unknown;
  bodies: Array<{ ref: BodyRef; text: string; epoch: string }>;
}
interface TranscriptCheckpoint {
  offset: number;
  sha256: string;
  pendingEntryId: string | null;
  entries: Array<{ id: string; sourceIdentity: string; endOffset: number }>;
}
export interface HistoryRestart {
  before: HistoryRead;
  after: HistoryRead;
  repeatedStatus: number;
  sendBefore: Probe;
  formBefore: Probe;
  sendAfter: Probe;
  formAfter: Probe;
  sendReceipt: unknown;
  formReceipt: unknown;
  markdownBefore: string;
  markdownAfter: string;
  checkpointBefore: TranscriptCheckpoint;
  checkpointAfter: TranscriptCheckpoint;
  nativeHistory: SessionMessageInfo[];
  partial?: { history: HistoryRead; markdown: string; checkpoint: TranscriptCheckpoint };
}
export interface HydrationCoverage {
  before: HistoryRead;
  after: HistoryRead;
  repeated: HistoryRead;
  beforeFact: Probe;
  afterFact: Probe;
  receipt: unknown;
  secondSendStatus?: number;
  activeAtRestart: SessionActiveOutput;
  sessionAtRestart: SessionInfo;
  markdownBefore: string;
  markdownAfter: string;
  checkpointBefore: TranscriptCheckpoint;
  checkpointAfter: TranscriptCheckpoint;
  resolved?: { history: HistoryRead; receipt: unknown; markdown: string };
  lateAdmission?: {
    evidenceId: string;
    activity: SessionActiveOutput;
    history: HistoryRead;
    receipt: unknown;
    fact: Probe;
    interruptsBeforeStop: number;
    stopStatus: number;
    stopReceipt: unknown;
    interrupts: Array<{ sessionID: string; resume: string | null }>;
    markdown: string;
  };
}
export interface CancelledInputOrder {
  before: HistoryRead;
  after: HistoryRead;
  firstReceipt: unknown;
  stopReceipt: unknown;
  secondReceipt: unknown;
  firstAfter: unknown;
  stopAfter: unknown;
  secondAfter: unknown;
  beforeSecondFirstFact: Probe;
  beforeSecondSecondFact: Probe;
  firstFact: Probe;
  stopFact: Probe;
  secondFact: Probe;
  firstFactAfter: Probe;
  stopFactAfter: Probe;
  secondFactAfter: Probe;
  nativeHistory: SessionMessageInfo[];
  markdownBefore: string;
  markdownAfter: string;
  checkpointBefore: TranscriptCheckpoint;
  checkpointAfter: TranscriptCheckpoint;
}
export interface FixtureReport {
  scenario: Scenario;
  vault: string;
  database: string;
  observations: Observation[];
  createStatus: number;
  createReceipt: unknown;
  ready: boolean;
  commandReceipt?: unknown;
  acknowledged?: Probe;
  commandStatus?: number;
  duplicateStatus?: number;
  changedStatus?: number;
  oversizedStatus?: number;
  secondCreateStatus?: number;
  after?: Probe;
  afterClose?: Probe;
  restart?: { commandStatus: number; commandReceipt: unknown; snapshotStatus: number; snapshot: unknown };
  historyRestart?: HistoryRestart;
  hydration?: HydrationCoverage;
  cancelledOrder?: CancelledInputOrder;
  counts: { creates: number; prompts: number; replies: number };
  configUnchanged: boolean;
  legacyUnchanged: boolean;
  outsideUnchanged: boolean;
  groundStatus: number;
  groundValue: unknown;
  unexpected: string[];
  probeControl: {
    committed: Probe;
    uncommitted: Probe;
    wrongOriginalCommand: Probe;
    wrongDigestCommand: Probe;
    wrongConversation: Probe;
    wrongNativeMapping: Probe;
  };
}

// Physical admission schema introduced in v1, retained by v2 checkpoints, v3 order and v4 recent/views:
// Standalone probe controls remain v1; production-opened databases now have user_version = 4.
// conversations(conversation_id PK, native_session_id UNIQUE, vault_directory,
//   owner_marker_json, creation_epoch): all TEXT NOT NULL.
// commands(command_id TEXT PK NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations,
//   kind TEXT NOT NULL, state TEXT NOT NULL, original_input BLOB NULL,
//   payload_sha256 TEXT NULL [lowercase SHA-256 hex], dispatch_attempted INTEGER NOT NULL [0/1],
//   run_id TEXT NULL, native_message_id TEXT NULL, decision_id TEXT NULL,
//   registered_at INTEGER NOT NULL [epoch ms]). Create/Stop have no original BLOB;
//   Send hashes exact UTF-8; form-reply hashes {conversationId,decisionId,answer} as today.
// state retains the public receipt state; dispatch_attempted must be 1 before the effect.
// This is a relational migration contract, not a scan for unrelated facts anywhere in a DB.
function probeDatabase(path: string, commandId: string): Probe {
  const result: Probe = { exists: false, schemaVersion: 0, command: null, rejectedCommandPresent: false,
    legacyConversationPresent: false, integrity: null, writerAvailable: false };
  let reader: Database | undefined;
  try {
    try { lstatSync(path); }
    catch (error) { if (record(error) && error.code === 'ENOENT') return result; throw error; }
    result.exists = true;
    reader = new Database(path, { readonly: true, create: false });
    result.integrity = String(reader.query('PRAGMA quick_check').values()[0]?.[0]);
    result.schemaVersion = Number(reader.query('PRAGMA user_version').values()[0]?.[0]);
    result.command = reader.query<CommandFact, [string]>(`
      SELECT d.command_id AS commandId, d.conversation_id AS conversationId,
        d.kind, d.state, typeof(d.original_input) AS originalType,
        CASE WHEN d.original_input IS NULL THEN NULL ELSE lower(hex(d.original_input)) END AS originalHex,
        d.payload_sha256 AS payloadSha256, d.dispatch_attempted AS dispatchAttempted,
        d.run_id AS runId, d.native_message_id AS nativeMessageId,
        d.decision_id AS decisionId, d.registered_at AS registeredAt,
        c.conversation_id AS ownerConversationId, c.native_session_id AS nativeSessionId,
        c.vault_directory AS vaultDirectory, c.owner_marker_json AS ownerMarkerJson,
        c.creation_epoch AS creationEpoch
      FROM commands AS d JOIN conversations AS c ON c.conversation_id = d.conversation_id
      WHERE d.command_id = ?
    `).get(commandId);
    result.rejectedCommandPresent = reader.query('SELECT 1 FROM commands WHERE command_id = ?').get(rejectedCommandId) !== null;
    result.legacyConversationPresent = reader.query('SELECT 1 FROM conversations WHERE native_session_id = ?').get(legacyId) !== null;
    reader.close(); reader = undefined;
    // Acquiring a separate write transaction at the callback proves no writer is
    // held across the external call. This creates/updates no application records.
    const writer = new Database(path, { readwrite: true, create: false });
    try { writer.run('PRAGMA busy_timeout = 0'); writer.run('BEGIN IMMEDIATE'); writer.run('ROLLBACK'); result.writerAvailable = true; }
    finally { writer.close(); }
  } catch (error) { result.error = error instanceof Error ? error.message : 'probe failed'; }
  finally { reader?.close(); }
  return result;
}

// Query only the mapped transcript's versioned checkpoint and stable entries, not a generic DB scan.
function transcriptCheckpoint(path: string): TranscriptCheckpoint {
  const db = new Database(path, { readonly: true, create: false });
  try {
    const row = db.query<Omit<TranscriptCheckpoint, 'entries'>, [string]>(`
      SELECT confirmed_offset AS offset, confirmed_sha256 AS sha256, pending_entry_id AS pendingEntryId
      FROM transcripts WHERE conversation_id = ?
    `).get(conversationId);
    if (!row) throw new Error('fixture must create a confirmed mapped transcript before restart');
    const entries = db.query<TranscriptCheckpoint['entries'][number], [string]>(`
      SELECT entry_id AS id, source_identity AS sourceIdentity, end_offset AS endOffset
      FROM transcript_entries WHERE conversation_id = ? ORDER BY end_offset
    `).all(conversationId);
    return { ...row, entries };
  } finally { db.close(); }
}

/** Prove the observation seam itself against test-owned SQLite before using it as an oracle. */
async function checkProbe(root: string): Promise<FixtureReport['probeControl']> {
  const directory = join(root, 'probe-control');
  const path = join(directory, 'control.sqlite');
  await mkdir(directory, { mode: 0o700 });
  const producer = new Database(path);
  try {
    await chmod(path, 0o600);
    // A tiny fixture of the planned schema only; no production store/migrations are implemented here.
    producer.run(`
      PRAGMA user_version = 1;
      PRAGMA foreign_keys = ON;
      CREATE TABLE conversations (
        conversation_id TEXT PRIMARY KEY NOT NULL, native_session_id TEXT NOT NULL UNIQUE,
        vault_directory TEXT NOT NULL, owner_marker_json TEXT NOT NULL, creation_epoch TEXT NOT NULL
      );
      CREATE TABLE commands (
        command_id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
        kind TEXT NOT NULL, state TEXT NOT NULL, original_input BLOB, payload_sha256 TEXT,
        dispatch_attempted INTEGER NOT NULL CHECK(dispatch_attempted IN (0, 1)),
        run_id TEXT, native_message_id TEXT, decision_id TEXT, registered_at INTEGER NOT NULL
      );
    `);
    const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const insertOwner = producer.query('INSERT INTO conversations VALUES (?, ?, ?, ?, ?)');
    for (const id of [conversationId, secondConversationId]) {
      insertOwner.run(id, nativeId(id), join(root, 'probe-vault'), JSON.stringify({ owner: 'memory-loop', conversationId: id, epoch }), epoch);
    }
    const insert = producer.query('INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    insert.run(sendCommandId, conversationId, 'send', 'registered', Buffer.from(original), digest(original), 1,
      '99999999-9999-4999-8999-999999999999', `msg_memoryloop_${sendCommandId.replaceAll('-', '')}`, null, 123);
    const committed = probeDatabase(path, sendCommandId);
    producer.run('BEGIN IMMEDIATE');
    const otherCommand = '88888888-8888-4888-8888-888888888888';
    insert.run(otherCommand, conversationId, 'send', 'registered', Buffer.from(original), digest(original), 1, null, null, null, 124);
    const uncommitted = probeDatabase(path, otherCommand);
    producer.run('ROLLBACK');
    // All wanted bytes/digests still exist, but only on a different command. A global scan would pass.
    insert.run(otherCommand, conversationId, 'send', 'registered', Buffer.from(original), digest(original), 1, null, null, null, 124);
    producer.query('UPDATE commands SET original_input = ? WHERE command_id = ?').run(Buffer.from(changedOriginal), sendCommandId);
    const wrongOriginalCommand = probeDatabase(path, sendCommandId);
    producer.query('UPDATE commands SET original_input = ?, payload_sha256 = ? WHERE command_id = ?')
      .run(Buffer.from(original), digest(changedOriginal), sendCommandId);
    const wrongDigestCommand = probeDatabase(path, sendCommandId);
    producer.query('UPDATE commands SET payload_sha256 = ?, conversation_id = ? WHERE command_id = ?')
      .run(digest(original), secondConversationId, sendCommandId);
    const wrongConversation = probeDatabase(path, sendCommandId);
    producer.query('UPDATE commands SET conversation_id = ? WHERE command_id = ?').run(conversationId, sendCommandId);
    // Swap native mappings while keeping both IDs present and UNIQUE. The target's owner is now wrong.
    producer.query('UPDATE conversations SET native_session_id = ? WHERE conversation_id = ?').run('ses_fixture_swap', conversationId);
    producer.query('UPDATE conversations SET native_session_id = ? WHERE conversation_id = ?').run(nativeId(conversationId), secondConversationId);
    producer.query('UPDATE conversations SET native_session_id = ? WHERE conversation_id = ?').run(nativeId(secondConversationId), conversationId);
    const wrongNativeMapping = probeDatabase(path, sendCommandId);
    return { committed, uncommitted, wrongOriginalCommand, wrongDigestCommand, wrongConversation, wrongNativeMapping };
  } finally { producer.close(); }
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!record(parsed)) throw new Error('fixture expected an object body');
  return parsed;
}

async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 2500;
  for (;;) {
    const value = await read();
    if (accepts(value)) return value;
    if (Date.now() >= deadline) throw new Error(`fixture timed out waiting for a public command/state: ${JSON.stringify(value)}`);
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
}

async function run(root: string, scenario: Scenario): Promise<FixtureReport> {
  const probeControl = await checkProbe(root);
  const projectRoot = join(root, 'project');
  const metadata = join(projectRoot, '.memory-loop');
  const transport = join(root, 'transport');
  const vault = scenario === 'state-inside-vault' ? projectRoot : join(root, 'vault');
  const database = join(metadata, 'application.sqlite');
  const outside = join(root, 'outside-sentinel');
  const legacyTranscript = join(vault, 'Conversations', 'Memory Loop', 'think-legacy-fixture.md');
  await Promise.all([mkdir(metadata, { recursive: true, mode: 0o700 }), mkdir(transport, { mode: 0o700 }),
    mkdir(join(vault, '03_Resources', 'Memory-Loop'), { recursive: true }), mkdir(join(vault, 'Conversations', 'Memory Loop'), { recursive: true })]);
  await writeFile(legacyTranscript, 'legacy transcript must remain byte-for-byte intact\n', { mode: 0o600 });
  await writeFile(join(vault, '03_Resources', 'Memory-Loop', 'goals.md'), 'Fixture goal', { mode: 0o600 });
  await writeFile(outside, 'outside sentinel must not change', { mode: 0o600 });
  const outsideBefore = await readFile(outside);
  const legacyBefore = await readFile(legacyTranscript);
  if (scenario === 'database-symlink') await symlink(outside, database);
  if (scenario === 'database-hardlink') await link(outside, database);
  if (scenario === 'wal-symlink') await symlink(outside, `${database}-wal`);
  if (scenario === 'shm-symlink') await symlink(outside, `${database}-shm`);

  const observations: Observation[] = [];
  const unexpected: string[] = [];
  const counts = { creates: 0, prompts: 0, replies: 0 };
  const sessions = new Map<string, SessionInfo>();
  const messages: SessionMessageInfo[] = [];
  const inbox: SessionPromptOutput[] = [];
  const active: SessionActiveOutput = {};
  const interrupts: Array<{ sessionID: string; resume: string | null }> = [];
  const streams = new Set<ServerResponse>();
  let holdMonitor = scenario === 'hydrate-unattempted';
  let promptAt = 200;
  let orderClock = 1800000000000;
  const orderSecondId = scenario === 'cancelled-input-order-tie' ? orderedTiedSecondCommandId : orderedSecondCommandId;
  let firstCaptureStarted = false;
  let releaseFirstCapture: () => void = () => {};
  const base = `/api/think/conversations/${conversationId}`;
  let prepared: PreparedServer | undefined;
  let nativeUrl = '';
  const form: SessionFormGetOutput = { id: decisionId, sessionID: nativeId(conversationId), title: 'Fixture form',
    fields: [{ key: 'answer', type: 'string' }, { key: 'zeta', type: 'string' }], state: { status: 'pending' },
    metadata: { fixturePrivate: 'native form metadata is not original input' } };
  function completeNative(session: SessionInfo, at: number): void {
    messages.push({ id: assistantMessageId, type: 'assistant', agent: 'fixture-agent',
      model: { providerID: 'fixture-provider', id: 'fixture-model' }, finish: 'stop',
      time: { created: at + 1, completed: at + 2 }, content: [
        { type: 'text', text: assistantTexts[0] },
        { type: 'reasoning', text: 'fixture-private-reasoning-must-not-be-projected' },
        { type: 'text', text: assistantTexts[1] },
      ] });
    session.outcome = 'succeeded';
    session.time = { ...session.time, busy: at - 1, idle: at + 3, updated: at + 3 };
    delete active[session.id]; inbox.length = 0;
  }
  const native = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== auth) { response.writeHead(401).end('{}'); return; }
      const url = new URL(request.url ?? '/', nativeUrl);
      const path = url.pathname;
      response.setHeader('content-type', 'application/json');
      if (request.method === 'GET' && path === '/api/info') {
        response.end(JSON.stringify({ version: '2.2.2', pid: process.pid, urls: [], paths: { tmp: root } })); return;
      }
      if (request.method === 'GET' && path === '/api/event') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.flushHeaders();
        if (!holdMonitor) response.write(`data: ${JSON.stringify({ id: 'evt_fixture_connected', type: 'server.connected', data: {} })}\n\n`);
        streams.add(response); response.on('close', () => streams.delete(response)); return;
      }
      if (request.method === 'POST' && path === '/api/session') {
        const input = await body(request);
        if (typeof input.id !== 'string' || !record(input.location) || typeof input.location.directory !== 'string' ||
            !record(input.metadata) || !Array.isArray(input.permissions)) throw new Error('fixture received malformed native create');
        const id = input.id === nativeId(conversationId) ? createCommandId : secondCreateCommandId;
        observations.push({ operation: 'create', input, probe: probeDatabase(database, id) }); counts.creates++;
        const typed = input as SessionCreateInput;
        const session: SessionInfo = { id: input.id, projectID: 'fixture-project', location: { directory: input.location.directory },
          metadata: structuredClone(typed.metadata ?? {}), permissions: [...(typed.permissions ?? [])], cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 100, updated: 100 } };
        sessions.set(session.id, session); response.end(JSON.stringify({ data: session })); return;
      }
      if (request.method === 'GET' && path === '/api/session/active') { response.end(JSON.stringify({ data: active })); return; }
      if (request.method === 'GET' && path === '/api/permission/request') {
        response.end(JSON.stringify({ location: { directory: vault }, data: [] })); return;
      }
      const match = /^\/api\/session\/([^/]+)(.*)$/.exec(path);
      const session = match ? sessions.get(match[1]) : undefined;
      if (match && session) {
        const suffix = match[2];
        if (request.method === 'GET' && suffix === '') { response.end(JSON.stringify({ data: session })); return; }
        if (request.method === 'GET' && suffix === '/message') { response.end(JSON.stringify({ data: messages, cursor: {} })); return; }
        if (request.method === 'GET' && suffix.startsWith('/message/')) {
          const message = messages.find(item => item.id === decodeURIComponent(suffix.slice('/message/'.length)));
          if (!message) { response.writeHead(404).end('{}'); return; }
          response.end(JSON.stringify({ data: message })); return;
        }
        if (request.method === 'GET' && suffix === '/inbox') { response.end(JSON.stringify({ data: inbox })); return; }
        if (scenario === 'hydrate-uncertain-running-stop' && request.method === 'POST' && suffix === '/interrupt') {
          interrupts.push({ sessionID: session.id, resume: url.searchParams.get('resume') });
          // Requested interruption is not a fabricated terminal event; this fixture keeps native activity running.
          response.end(JSON.stringify({ interrupted: true })); return;
        }
        if (request.method === 'POST' && suffix === '/prompt') {
          const input = await body(request);
          if (typeof input.id !== 'string' || typeof input.text !== 'string') throw new Error('fixture received malformed prompt');
          observations.push({ operation: 'prompt', input: { ...input, sessionID: session.id },
            probe: probeDatabase(database, isCancelledOrder(scenario) ? orderSecondId : sendCommandId) }); counts.prompts++;
          const at = isCancelledOrder(scenario) ? orderClock + 1 : scenario === 'history-restart' || isHydrationCase(scenario) ? Date.now() : 200;
          promptAt = at;
          const prepared = isCancelledOrder(scenario) ? orderedPreparedB : preparedText;
          const admitted: SessionPromptOutput = { id: input.id, sessionID: session.id, type: 'user', time: { created: at },
            delivery: 'queue', payload: { text: prepared } };
          inbox.push(admitted);
          messages.push({ id: input.id, type: 'user', text: prepared, time: { created: at } });
          if (scenario === 'history-restart' || scenario === 'hydrate-corrupt-digest' || isCancelledOrder(scenario)) completeNative(session, at);
          if (scenario === 'hydrate-busy' || scenario === 'hydrate-missing-association') {
            active[session.id] = { type: 'running' }; // Exact public SDK SessionActive shape, not a guessed busy flag.
            session.time = { ...session.time, busy: at - 1, updated: at };
            inbox.length = 0;
          }
          if (uncertainHydration(scenario)) {
            // Native received the attempt, but no public inbox/history/activity fact yet proves its outcome.
            inbox.length = 0; messages.length = 0; response.destroy(); return;
          }
          if (scenario === 'uncertain') { response.destroy(); return; }
          response.end(JSON.stringify({ data: admitted })); return;
        }
        if (request.method === 'GET' && suffix === '/form') {
          response.end(JSON.stringify({ data: form.state.status === 'pending' ? [form] : [] })); return;
        }
        if (request.method === 'GET' && suffix === `/form/${decisionId}`) { response.end(JSON.stringify({ data: form })); return; }
        if (request.method === 'POST' && suffix === `/form/${decisionId}/reply`) {
          const input = await body(request);
          observations.push({ operation: 'form-reply', input, probe: probeDatabase(database, formCommandId) }); counts.replies++;
          if (scenario === 'history-restart') form.state = { status: 'answered', answer: formAnswer };
          response.writeHead(204).end(); return;
        }
      }
      unexpected.push(`${request.method} ${path}`); response.writeHead(404).end('{}');
    } catch (error) {
      unexpected.push(error instanceof Error ? error.message : 'fixture request failed');
      response.writeHead(500).end('{}');
    }
  });
  await new Promise<void>((resolve, reject) => native.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = native.address();
  if (!address || typeof address === 'string') throw new Error('fixture native listener unavailable');
  nativeUrl = `http://127.0.0.1:${address.port}`;
  const registrationFile = join(root, 'fixture-registration.json');
  await writeFile(registrationFile, JSON.stringify({ url: nativeUrl, pid: process.pid, version: '2.2.2', password }), { mode: 0o600 });
  const configFile = join(metadata, 'config.json');
  const configBytes = JSON.stringify({ vaultDirectory: vault,
    think: { service: { registrationFile, requiredVersion: '2.2.2' }, location: { kind: 'vault' }, permissionMode: 'full' } });
  await writeFile(configFile, configBytes, { mode: 0o600 });
  const transportFile = join(transport, 'transport.json');
  await writeFile(transportFile, JSON.stringify({ daemonOrigin: `http://${authority}`,
    web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }), { mode: 0o600 });
  await writeFile(join(transport, 'service.token'), token, { mode: 0o600 });
  process.env.MEMORY_LOOP_TRANSPORT_FILE = transportFile;
  const request = async (path: string, payload?: object) => {
    if (!prepared) throw new Error('fixture application not prepared');
    return prepared.fetch(new Request(`http://${authority}${path}`, { method: payload ? 'POST' : 'GET',
      headers: { host: authority, authorization: `Bearer ${token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}) }));
  };
  const command = async (id: string) => (await request(`${base}/commands/${id}`)).json() as Promise<unknown>;
  const isState = (value: unknown, state: string) => record(value) && value.state === state;
  const snapshot = async () => (await request(base)).json() as Promise<ConversationSnapshot>;
  async function readHistory(): Promise<HistoryRead> {
    const response = await request(base);
    const value: unknown = await response.json();
    if (response.status !== 200) return { status: response.status, snapshot: null, error: value, bodies: [] };
    // Public ready snapshots contain manifests, never raw bodies. Read each immutable body via HTTP too.
    const current = value as ConversationSnapshot;
    const bodies: HistoryRead['bodies'] = [];
    for (const entry of current.entries) {
      if (!('body' in entry)) continue;
      const ref = entry.body;
      const chunks: Buffer[] = [];
      let offset = 0;
      let transfer: string | undefined;
      do {
        const query = new URLSearchParams({ generation: ref.generation, through: String(ref.through), offset: String(offset),
          ...(transfer ? { transfer } : {}) });
        const result = await request(`${base}/content/${ref.contentId}?${query}`);
        if (result.status !== 200) throw new Error(`fixture body read failed: ${result.status} ${await result.text()}`);
        const chunk = await result.json() as ContentChunk;
        if (chunk.epoch !== current.epoch || chunk.offset !== offset || chunk.nextOffset <= offset || chunk.nextOffset > ref.through) {
          throw new Error('fixture body response violated the pinned snapshot/chunk boundary');
        }
        chunks.push(Buffer.from(chunk.bytes, 'base64')); offset = chunk.nextOffset; transfer = chunk.transfer;
      } while (offset < ref.through);
      bodies.push({ ref, text: Buffer.concat(chunks).toString('utf8'), epoch: current.epoch });
    }
    return { status: response.status, snapshot: current, error: null, bodies };
  }
  async function prepareCaptureControlledServer(): Promise<PreparedServer> {
    // Only the first lifetime needs controlled capture. These are the same production factories
    // used by prepareServer, with its existing BodyStore injection seam, not a fake service/store.
    const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const state = await openThinkState(projectRoot, vault);
    const bodies = await createBodyStore({ directory: join(transport, `think-bodies-${epoch}`), epoch, vaultDirectory: vault });
    const reader = await openVault(vault);
    const gate = new Promise<void>(resolve => { releaseFirstCapture = resolve; });
    const controlledBodies = { ...bodies, async replace(...args: Parameters<typeof bodies.replace>) {
      if (args[0].owner.kind === 'original' && args[0].owner.clientCommandId === sendCommandId) {
        firstCaptureStarted = true; await gate;
      }
      return bodies.replace(...args);
    } };
    const think = createThinkService({ native: nativeSessions(OpenCode.make({ baseUrl: nativeUrl, headers: { authorization: auth } })),
      bodies: controlledBodies, state, epoch, context: { directory: vault }, clock: { now: () => orderClock },
      serviceIdentity: { pid: process.pid, version: '2.2.2' } });
    return { fetch: createApp({ authority, serviceToken: token, vault: { reader }, think }), startRecovery: () => think.startRecovery(),
      async close() { try { await think.close(); } finally { await reader.close(); } } };
  }
  try {
    prepared = isCancelledOrder(scenario) ? await prepareCaptureControlledServer() : await prepareServer({ projectRoot, authority });
    const created = await request('/api/think/conversations', { conversationId, clientCommandId: createCommandId });
    const report: FixtureReport = { scenario, vault, database, observations, createStatus: created.status, createReceipt: await created.json(), ready: false,
      counts, configUnchanged: false, legacyUnchanged: false, outsideUnchanged: false, groundStatus: 0, groundValue: null, unexpected, probeControl };
    if (isHydrationCase(scenario) || isCancelledOrder(scenario) || ['create', 'create-ready-restart', 'history-restart', 'send', 'form', 'uncertain'].includes(scenario)) {
      report.acknowledged = probeDatabase(database, createCommandId);
      if (created.status !== 202) throw new Error(`existing Think create did not reach admission: ${JSON.stringify(report.createReceipt)}`);
      await until(async () => (await request(base)).json() as Promise<unknown>, value => record(value) && value.creation === 'ready');
      report.ready = true;
      if (isCancelledOrder(scenario)) {
        orderClock += 10;
        const first = await request(`${base}/messages`, { clientCommandId: sendCommandId, text: original });
        const admitted = await first.json();
        if (first.status !== 202 || !record(admitted) || typeof admitted.runId !== 'string') throw new Error('fixture A did not register');
        await until(async () => firstCaptureStarted, value => value);
        if (scenario !== 'cancelled-input-order-tie') orderClock += 1;
        const stop = await request(`${base}/runs/${admitted.runId}/stop`, { clientCommandId: orderedStopCommandId });
        if (stop.status !== 202) throw new Error(`fixture local Stop did not register: ${await stop.text()}`);
        await stop.arrayBuffer();
        const stopReceipt = await until(() => command(orderedStopCommandId), value => isState(value, 'cancelled-before-delivery'));
        const firstReceipt = await command(sendCommandId);
        releaseFirstCapture();
        // Preserve A's actual original before B is registered; do not manufacture order in native history.
        await until(snapshot, value => value.entries.some(entry => entry.kind === 'original' && entry.clientCommandId === sendCommandId) && value.transcript?.state === 'up-to-date');
        const beforeSecondFirstFact = probeDatabase(database, sendCommandId);
        const beforeSecondSecondFact = probeDatabase(database, orderSecondId);
        // The tie is produced by the injected registration clock, never by editing stored timestamps.
        if (scenario !== 'cancelled-input-order-tie') orderClock += 10;
        const second = await request(`${base}/messages`, { clientCommandId: orderSecondId, text: orderedSecondOriginal });
        if (second.status !== 202) throw new Error(`fixture B did not register: ${await second.text()}`);
        await second.arrayBuffer();
        const secondReceipt = await until(() => command(orderSecondId), value => isState(value, 'completed'));
        await until(snapshot, value => value.entries.filter(entry => entry.kind === 'assistant-text').length === 2 && value.transcript?.state === 'up-to-date');
        const before = await readHistory();
        const transcriptPath = join(vault, 'Conversations', 'Memory Loop', `think-${conversationId}.md`);
        const markdownBefore = await readFile(transcriptPath, 'utf8');
        const checkpointBefore = transcriptCheckpoint(database);
        const firstFact = probeDatabase(database, sendCommandId);
        const stopFact = probeDatabase(database, orderedStopCommandId);
        const secondFact = probeDatabase(database, orderSecondId);
        await prepared.close(); prepared = undefined;
        prepared = await prepareServer({ projectRoot, authority });
        const firstRead = await readHistory();
        if (firstRead.status === 200) await until(snapshot, value => value.transcript?.state === 'up-to-date');
        report.cancelledOrder = { before, after: firstRead.status === 200 ? await readHistory() : firstRead,
          firstReceipt, stopReceipt, secondReceipt, firstAfter: await command(sendCommandId), stopAfter: await command(orderedStopCommandId),
          secondAfter: await command(orderSecondId), beforeSecondFirstFact, beforeSecondSecondFact, firstFact, stopFact, secondFact,
          firstFactAfter: probeDatabase(database, sendCommandId), stopFactAfter: probeDatabase(database, orderedStopCommandId),
          secondFactAfter: probeDatabase(database, orderSecondId), nativeHistory: structuredClone(messages),
          markdownBefore, markdownAfter: await readFile(transcriptPath, 'utf8'), checkpointBefore, checkpointAfter: transcriptCheckpoint(database) };
        report.commandReceipt = firstReceipt;
      } else if (isHydrationCase(scenario)) {
        const sent = await request(`${base}/messages`, { clientCommandId: sendCommandId, text: original });
        report.commandStatus = sent.status;
        if (sent.status !== 202) throw new Error(`fixture Send did not register: ${await sent.text()}`);
        if (scenario !== 'hydrate-unattempted') {
          report.commandReceipt = await until(() => command(sendCommandId), value => isState(value,
            uncertainHydration(scenario) ? 'upstream-unconfirmed' : scenario === 'hydrate-corrupt-digest' ? 'completed' : 'admitted'));
        }
        await until(snapshot, value => value.entries.some(entry => entry.kind === 'original') && value.transcript?.state === 'up-to-date');
        if (scenario === 'hydrate-unattempted') await until(async () => streams.size, count => count > 0);
        const before = await readHistory();
        const transcriptPath = join(vault, 'Conversations', 'Memory Loop', `think-${conversationId}.md`);
        const markdownBefore = await readFile(transcriptPath, 'utf8');
        const checkpointBefore = transcriptCheckpoint(database);
        await prepared.close(); prepared = undefined;
        holdMonitor = false;
        if (scenario === 'hydrate-missing-association' || scenario === 'hydrate-corrupt-digest') {
          const db = new Database(database, { readwrite: true, create: false });
          try {
            if (scenario === 'hydrate-missing-association') db.query('UPDATE commands SET native_message_id = NULL WHERE command_id = ?').run(sendCommandId);
            else db.query('UPDATE commands SET payload_sha256 = ? WHERE command_id = ?').run('0'.repeat(64), sendCommandId);
          } finally { db.close(); }
        }
        const beforeFact = probeDatabase(database, sendCommandId);
        const session = sessions.get(nativeId(conversationId));
        if (!session) throw new Error('fixture native session missing');
        const activeAtRestart = structuredClone(active);
        const sessionAtRestart = structuredClone(session);
        prepared = await prepareServer({ projectRoot, authority });
        const first = await readHistory();
        if (first.status === 200) {
          await until(snapshot, value => scenario === 'hydrate-missing-association'
            ? value.transcript?.warning === true : value.transcript?.state === 'up-to-date');
        }
        const after = first.status === 200 ? await readHistory() : first;
        const repeated = await readHistory();
        const receipt = await command(sendCommandId);
        let secondSendStatus: number | undefined;
        if (first.status === 200) {
          const second = await request(`${base}/messages`, { clientCommandId: rejectedCommandId, text: 'must not bypass an unresolved restored reservation' });
          secondSendStatus = second.status; await second.arrayBuffer();
        }
        report.hydration = { before, after, repeated, beforeFact, afterFact: probeDatabase(database, sendCommandId), receipt,
          ...(secondSendStatus === undefined ? {} : { secondSendStatus }), activeAtRestart, sessionAtRestart,
          markdownBefore, markdownAfter: await readFile(transcriptPath, 'utf8'), checkpointBefore, checkpointAfter: transcriptCheckpoint(database) };
        if (scenario === 'hydrate-uncertain' && first.status === 200) {
          const prompt = observations.find(item => item.operation === 'prompt')?.input;
          if (!record(prompt) || typeof prompt.id !== 'string') throw new Error('fixture missing the actually attempted prompt ID');
          messages.push({ id: prompt.id, type: 'user', text: preparedText, time: { created: promptAt } });
          completeNative(session, promptAt);
          const event: OpenCodeEvent = { type: 'session.execution.succeeded', id: 'evt_fixture_delayed_exact_prompt', created: promptAt + 3,
            durable: { aggregateID: session.id, seq: 1, version: 1 }, data: { sessionID: session.id } };
          for (const stream of streams) stream.write(`data: ${JSON.stringify(event)}\n\n`);
          const resolvedReceipt = await until(() => command(sendCommandId), value => isState(value, 'completed'));
          await until(snapshot, value => value.entries.filter(entry => entry.kind === 'assistant-text').length === 2 && value.transcript?.state === 'up-to-date');
          report.hydration.resolved = { history: await readHistory(), receipt: resolvedReceipt, markdown: await readFile(transcriptPath, 'utf8') };
        }
        if (scenario === 'hydrate-uncertain-running-stop' && first.status === 200) {
          const prompt = observations.find(item => item.operation === 'prompt')?.input;
          if (!record(prompt) || typeof prompt.id !== 'string') throw new Error('fixture missing the actually attempted prompt ID');
          // Only now, AFTER initial hydration preserved uncertainty, publish exact-ID admission evidence.
          const witnessId = 'msg_fixture_late_admission_refresh';
          messages.push({ id: prompt.id, type: 'user', text: preparedText, time: { created: promptAt } },
            { id: witnessId, type: 'assistant', agent: 'fixture-agent', model: { providerID: 'fixture-provider', id: 'fixture-model' },
              finish: 'tool-calls', time: { created: promptAt + 1, completed: promptAt + 2 },
              content: [{ type: 'text', text: 'Fixture nonterminal native observation' }] });
          active[session.id] = { type: 'running' };
          session.time = { ...session.time, busy: promptAt - 1, updated: promptAt + 2 };
          const event: OpenCodeEvent = { type: 'session.execution.started', id: 'evt_fixture_late_running_admission', created: promptAt + 2,
            durable: { aggregateID: session.id, seq: 1, version: 1 }, data: { sessionID: session.id } };
          for (const stream of streams) stream.write(`data: ${JSON.stringify(event)}\n\n`);
          // This public projection is a barrier proving refresh read and fenced the new history.
          // Do not wait for admitted here: the current bug must be an assertion failure, not a fixture timeout.
          await until(snapshot, value => value.entries.some(entry => entry.kind === 'assistant-text' && entry.messageId === witnessId));
          const history = await readHistory();
          const receipt = await command(sendCommandId);
          const fact = probeDatabase(database, sendCommandId);
          const interruptsBeforeStop = interrupts.length;
          const runId = fact.command?.runId;
          if (!runId) throw new Error('fixture missing the durable run identity');
          const stopId = '88888888-8888-4888-8888-888888888888';
          const stop = await request(`${base}/runs/${runId}/stop`, { clientCommandId: stopId });
          const stopStatus = stop.status; await stop.arrayBuffer();
          const stopReceipt = await until(() => command(stopId), value => isState(value, 'requested') || isState(value, 'upstream-unconfirmed'));
          await until(snapshot, value => value.transcript?.state === 'up-to-date');
          report.hydration.lateAdmission = { evidenceId: prompt.id, activity: structuredClone(active), history, receipt, fact,
            interruptsBeforeStop, stopStatus, stopReceipt, interrupts: [...interrupts], markdown: await readFile(transcriptPath, 'utf8') };
        }
      } else if (scenario === 'create') {
        report.duplicateStatus = (await request('/api/think/conversations', { conversationId, clientCommandId: createCommandId })).status;
        report.changedStatus = (await request('/api/think/conversations', { conversationId: secondConversationId, clientCommandId: createCommandId })).status;
      } else if (scenario === 'create-ready-restart') {
        // No Send: native creation is ready, but the shell has not observed that fact yet.
      } else if (scenario === 'history-restart') {
        const sent = await request(`${base}/messages`, { clientCommandId: sendCommandId, text: original });
        report.commandStatus = sent.status;
        report.commandReceipt = await until(() => command(sendCommandId), value => isState(value, 'completed'));
        const replied = await request(`${base}/decisions/${decisionId}/reply`, { clientCommandId: formCommandId, answer: formAnswer });
        if (replied.status !== 202) throw new Error(`fixture form was not admitted: ${await replied.text()}`);
        await until(() => command(formCommandId), value => isState(value, 'replied'));
        await until(snapshot, value => value.entries.filter(entry => entry.kind === 'assistant-text').length === 2 &&
          value.entries.some(entry => entry.kind === 'form-reply') && value.transcript?.state === 'up-to-date');
        const transcriptPath = join(vault, 'Conversations', 'Memory Loop', `think-${conversationId}.md`);
        const before = await readHistory();
        const sendBefore = probeDatabase(database, sendCommandId);
        const formBefore = probeDatabase(database, formCommandId);
        const markdownBefore = await readFile(transcriptPath, 'utf8');
        const checkpointBefore = transcriptCheckpoint(database);
        await prepared.close(); prepared = undefined;
        // Fresh prepareServer means a fresh SQLite connection, epoch and disposable body cache.
        // The HTTP native service and its owned session/history remain, as with a daemon-only restart.
        prepared = await prepareServer({ projectRoot, authority });
        const first = await readHistory();
        if (first.status === 200) {
          await until(snapshot, value => value.entries.some(entry => entry.kind === 'original') &&
            value.entries.some(entry => entry.kind === 'form-reply') &&
            value.entries.filter(entry => entry.kind === 'assistant-text').length === 2 && value.transcript?.state === 'up-to-date');
        }
        const after = first.status === 200 ? await readHistory() : first;
        const repeated = await request(base);
        await repeated.arrayBuffer();
        report.historyRestart = { before, after, repeatedStatus: repeated.status, sendBefore, formBefore,
          sendAfter: probeDatabase(database, sendCommandId), formAfter: probeDatabase(database, formCommandId),
          sendReceipt: await command(sendCommandId), formReceipt: await command(formCommandId),
          markdownBefore, markdownAfter: await readFile(transcriptPath, 'utf8'), checkpointBefore,
          checkpointAfter: transcriptCheckpoint(database), nativeHistory: structuredClone(messages) };
        if (after.status === 200) {
          // A later native read can be incomplete. A verified Markdown checkpoint is not a body-history substitute.
          await prepared.close(); prepared = undefined;
          const assistant = messages.find(message => message.id === assistantMessageId);
          if (assistant?.type !== 'assistant' || assistant.content.at(-1)?.type !== 'text') throw new Error('fixture missing its last canonical text part');
          assistant.content.pop();
          prepared = await prepareServer({ projectRoot, authority });
          await request(base).then(response => response.arrayBuffer());
          await until(snapshot, value => value.contentHealth === 'incomplete' && value.transcript?.warning === true);
          report.historyRestart.partial = { history: await readHistory(), markdown: await readFile(transcriptPath, 'utf8'),
            checkpoint: transcriptCheckpoint(database) };
        }
      } else if (scenario === 'form') {
        const reply = await request(`${base}/decisions/${decisionId}/reply`, { clientCommandId: formCommandId, answer: formAnswer });
        report.acknowledged = probeDatabase(database, formCommandId);
        report.commandStatus = reply.status;
        report.commandReceipt = await until(() => command(formCommandId), value => isState(value, 'replied'));
        report.duplicateStatus = (await request(`${base}/decisions/${decisionId}/reply`, { clientCommandId: formCommandId, answer: formAnswer })).status;
        report.changedStatus = (await request(`${base}/decisions/${decisionId}/reply`, { clientCommandId: formCommandId,
          answer: { ...formAnswer, answer: changedOriginal } })).status;
      } else {
        const sent = await request(`${base}/messages`, { clientCommandId: sendCommandId, text: original });
        report.acknowledged = probeDatabase(database, sendCommandId);
        report.commandStatus = sent.status;
        report.commandReceipt = await until(() => command(sendCommandId), value => isState(value, scenario === 'uncertain' ? 'upstream-unconfirmed' : 'admitted'));
        report.duplicateStatus = (await request(`${base}/messages`, { clientCommandId: sendCommandId, text: original })).status;
        report.changedStatus = (await request(`${base}/messages`, { clientCommandId: sendCommandId, text: changedOriginal })).status;
        report.oversizedStatus = (await request(`${base}/messages`, { clientCommandId: rejectedCommandId, text: 'x'.repeat(1024 * 1024 + 1) })).status;
      }
      const observedCommand = scenario === 'create' || scenario === 'create-ready-restart' ? createCommandId : scenario === 'form' ? formCommandId : sendCommandId;
      report.after = probeDatabase(database, observedCommand);
      await prepared.close(); prepared = undefined;
      report.afterClose = probeDatabase(database, observedCommand);
      if (scenario === 'uncertain') {
        prepared = await prepareServer({ projectRoot, authority });
        const second = await request('/api/think/conversations', { conversationId: secondConversationId, clientCommandId: secondCreateCommandId });
        report.secondCreateStatus = second.status;
        await until(async () => (await request(`/api/think/conversations/${secondConversationId}`)).json() as Promise<unknown>, value => record(value) && value.creation === 'ready');
        report.after = probeDatabase(database, sendCommandId);
        // This checks retained uncertain facts/no redispatch, not old-chat hydration or resume.
      } else if (scenario === 'create-ready-restart') {
        // Preserve GROUND-DURABLE-01's unavailable-target regression after 9ya.5 adds valid hydration:
        // a historical READY fact cannot authorize attachment when current native ownership differs.
        const session = sessions.get(nativeId(conversationId));
        const marker = session?.metadata?.memoryLoop;
        if (!session || !record(marker)) throw new Error('fixture missing created owner');
        session.metadata = { ...session.metadata, memoryLoop: { ...marker, epoch: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } };
        prepared = await prepareServer({ projectRoot, authority });
        const receipt = await request(`${base}/commands/${createCommandId}`);
        const snapshot = await request(base);
        report.restart = { commandStatus: receipt.status, commandReceipt: await receipt.json(),
          snapshotStatus: snapshot.status, snapshot: await snapshot.json() };
        report.after = probeDatabase(database, createCommandId);
      }
    }
    if (!prepared) prepared = await prepareServer({ projectRoot, authority });
    const ground = await request('/api/ground/goals');
    report.groundStatus = ground.status; report.groundValue = await ground.json();
    report.configUnchanged = (await readFile(configFile, 'utf8')) === configBytes;
    report.legacyUnchanged = (await readFile(legacyTranscript)).equals(legacyBefore);
    report.outsideUnchanged = (await readFile(outside)).equals(outsideBefore);
    return report;
  } finally {
    releaseFirstCapture();
    await prepared?.close();
    for (const stream of streams) stream.destroy();
    native.closeAllConnections();
    await new Promise<void>((resolve, reject) => native.close(error => error ? reject(error) : resolve()));
  }
}

const scenarios: readonly Scenario[] = [...hydrationCases, 'create', 'create-ready-restart', 'history-restart', 'cancelled-input-order', 'cancelled-input-order-tie', 'send', 'form', 'uncertain', 'database-symlink', 'database-hardlink',
  'wal-symlink', 'shm-symlink', 'state-inside-vault'];
const root = process.argv[2];
const selected = process.argv[3];
const output = process.argv[4];
if (!root || resolve(root) !== resolve(tmpdir()) || !basename(root).startsWith('think-durable-admission-') ||
    !output || dirname(resolve(output)) !== resolve(root) ||
    !(scenarios.some(item => item === selected) || selected === 'state-permissive' || selected === 'state-normalized' || selected === 'state-windows-slashes')) {
  throw new Error('Pass a test-owned temporary fixture root, known scenario and report path');
}
async function statePolicy(scenario: 'state-permissive' | 'state-normalized' | 'state-windows-slashes') {
  const project = join(root, 'project');
  const vault = join(root, 'vault');
  const metadata = join(project, '.memory-loop');
  const database = join(metadata, 'application.sqlite');
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  await mkdir(vault);
  await mkdir(join(project, 'child'));
  const first = await openThinkState(project, vault);
  const before = first.installationId;
  first.close();
  if (scenario === 'state-permissive') { await chmod(metadata, 0o755); await chmod(database, 0o644); }
  const requested = scenario === 'state-normalized' ? `${project}${sep}child${sep}..` :
    scenario === 'state-windows-slashes' ? project.replaceAll('\\', '/') : project;
  let after: string | undefined;
  let reopenError: string | undefined;
  try {
    const reopened = await openThinkState(requested, vault);
    try { after = reopened.installationId; } finally { reopened.close(); }
  } catch (error) { reopenError = error instanceof Error ? error.message : 'reopen failed'; }
  const independent = new Database(database, { readonly: true, create: false });
  try {
    const row = independent.query<{ installation_id: string }, []>('SELECT installation_id FROM application_metadata WHERE singleton = 1').get();
    const integrity = independent.query('PRAGMA quick_check').values()[0]?.[0];
    const schema = independent.query('PRAGMA user_version').values()[0]?.[0];
    return { before, after, reopenError, stored: row?.installation_id, integrity, schema };
  } finally { independent.close(); }
}
const result = selected === 'state-permissive' || selected === 'state-normalized' || selected === 'state-windows-slashes' ? await statePolicy(selected) : await run(root, selected as Scenario);
await writeFile(output, JSON.stringify(result), { mode: 0o600 });
