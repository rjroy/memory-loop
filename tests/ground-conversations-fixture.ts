import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { SessionInfo, SessionMessageInfo } from '@opencode/client';
import { prepareServer, type PreparedServer } from '../backend/server';
import { createApp } from '../backend/app';
import { openVault } from '../backend/vault';
import { openGround } from '../backend/ground';
import { openCaptureWriter } from '../backend/capture';
import { createThinkService } from '../backend/think/service';
import { createBodyStore } from '../backend/think/body-store';
import { createNativeClient, nativeSessions } from '../backend/think/native';
import { openThinkState } from '../backend/think/sqlite-state';

// Current production factories + real Bun SQLite, talking only to our owned HTTP native fake.
// No future module imports, fake application routes, native executable or model requests.
export type Mode = 'recent' | 'resume' | 'leases' | 'unknown-selection' | 'canonical' | 'offline' | 'lease-lost-ack' | 'resume-unknown' | 'registration-absent' | 'delete-idle' | 'delete-selected' | 'delete-lease' | 'delete-busy' | 'delete-child' | 'delete-transcript-conflict' | 'delete-remove-ack-lost';
export interface Http { status: number; body: unknown }
export const instant = 1_700_000_000_000;
export const id = (group: number, index: number) => `${(group * 0x10000 + index).toString(16).padStart(8, '0')}-1111-4111-8111-000000000001`;
export const conversation = (index: number) => id(1, index);
export const nativeId = (index: number) => `ses_memoryloop_${conversation(index).replaceAll('-', '')}`;
export const original = (index: number) => index === 1 ? '\r\n \t\r\n   First   useful\tline 🧠  \r\nprivate second line, not a title'
  : index === 12 ? `  ${'🧠'.repeat(125)} tail\nprivate second line, not a title` : `  Conversation ${index}\nprivate second line, not a title`;
export const activity = (index: number) => instant + (index === 1 ? 30000 : index >= 12 ? 13000 : index * 1000);
const authority = '127.0.0.1:31234';
const serviceToken = 'a'.repeat(64);
const password = 'fixture-only-native-password';
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

interface StateFacts { conversationIds: string[]; sendCount: number; originalHex: string; originalSha256: string; nativeSessionId: string }
interface LeaseRow { tokenHash: string; conversationId: string | null; selectionRevision: number; expiresAt: number }
interface CanonicalProof {
  facts: Array<{ conversationId: string; nativeSessionId: string; messageId: string; ordinal: number; sha256: string; length: number; at: number }>;
  activityAt: number; originalHex: string; originalSha256: string; resumeCount: number;
}
interface ResumeFact {
  commandId: string; conversationId: string; nativeSessionId: string; registrationEpoch: string;
  registeredAt: number; state: string; failureCode: string | null; count: number;
}
interface LeaseProof { rows: LeaseRow[]; versions: Array<{ conversationId: string; version: number; activityAt: number }> }
interface TranscriptProof { noteId: string[]; creationState: string; offset: number; sha256: string; pendingEntryId: string | null; entries: string[]; bytesHex: string }
export interface Report {
  mode: Mode;
  controls: { snapshot: Http; goals: Http; tree: Http; capture: Http };
  before: StateFacts; after: StateFacts;
  effects: { creates: number; prompts: number; cancels: number; interrupts: number; replies: number };
  unexpected: string[]; legacyUnchanged: boolean; nativeLookalikesUnchanged: boolean;
  list?: Http; repeatedList?: Http;
  resume?: { requested: Http; ready?: Http; retry?: Http; wrongTarget?: Http; snapshot?: Http; listBefore?: Http; listAfter?: Http };
  unknownSelection?: Http;
  unknownRead?: Http;
  canonical?: { beforeList: Http; snapshot: Http; firstList: Http; repeatedList: Http; resumed: Http;
    restartSnapshot: Http; restartList: Http; commandAfterRestart: Http; retryAfterRestart: Http;
    first: CanonicalProof; repeated: CanonicalProof; restarted: CanonicalProof };
  offline?: { list: Http; siblings: { goals: Http; tree: Http; capture: Http } };
  registrationAbsent?: { descriptorMissing: boolean; databaseIntegrity: string; databaseMode: number; directoryMode: number;
    transcriptBefore: TranscriptProof; transcriptAfter: TranscriptProof; list: Http; siblings: { goals: Http; tree: Http; capture: Http } };
  lostAck?: { acceptedStatus: number; beforeRead: LeaseProof; readback: Http; afterRead: LeaseProof;
    stale: Http; beforeCorrectCas: LeaseProof; changed?: Http; afterChange: LeaseProof };
  resumeUnknown?: { first: Http; beforeRestart: ResumeFact; unknownAfterRestart: Http; afterUnknown: ResumeFact;
    known: Http; retry: Http; afterKnown: ResumeFact; snapshot: Http; listBefore: Http; listAfter: Http };
  deletion?: { registration: Http; selected?: Http; own?: Http; other?: Http; unknown?: Http; expired?: Http; expiredRead?: Http;
    requested?: Http; receipt?: Http; retry?: Http; reopenedReceipt?: Http; reopenedRetry?: Http; transcriptBefore: TranscriptProof; transcriptAfter?: TranscriptProof; transcriptExists: boolean; nativePresent: boolean; childPresent?: boolean;
    removals: string[]; removalCounts?: { afterReceipt: number; afterRetry: number; afterRestart: number; afterReopenedRead: number; afterReopenedRetry: number };
    payloadRows: number; transcriptRows: number; transcriptEntryRows: number; pendingChunkRows: number; unrelatedIntact: boolean };
  leases?: {
    registration: Http; tokenShape?: boolean; tokensDistinct?: boolean; secondRegistration?: Http;
    selected?: Http; renewed?: Http; stale?: Http; staleRenewal?: Http; readback?: Http; otherSelected?: Http; cleared?: Http;
    preparedResume?: Http; selectionAfterResume?: Http;
    foreignHash?: Http; unownedTarget?: Http; ownList?: Http; otherList?: Http;
    rows?: LeaseRow[]; foreignKey?: boolean; plaintextStored?: boolean; tokenDataExposed?: boolean;
    afterRestart?: Http; restartList?: Http; rowsAfterRestart?: LeaseRow[];
    expired?: Http; expiredRead?: Http; afterExpiryList?: Http;
  };
}

function stateFacts(database: string, index = 1): StateFacts {
  const db = new Database(database, { readonly: true, create: false });
  try {
    const fact = db.query<{ originalHex: string; originalSha256: string; nativeSessionId: string }, [string]>(`
      SELECT lower(hex(d.original_input)) AS originalHex, d.payload_sha256 AS originalSha256, c.native_session_id AS nativeSessionId
      FROM commands d JOIN conversations c ON c.conversation_id = d.conversation_id WHERE d.command_id = ?`).get(id(3, index));
    if (!fact) throw new Error('fixture registered original/ownership join missing');
    return { ...fact, conversationIds: db.query<{ id: string }, []>('SELECT conversation_id AS id FROM conversations ORDER BY conversation_id').all().map(row => row.id),
      sendCount: Number(db.query<{ count: number }, []>("SELECT count(*) AS count FROM commands WHERE kind = 'send'").get()?.count) };
  } finally { db.close(); }
}

// Actual v4 physical lease columns, not a generic table/foreign-key walker:
// view_leases(token_sha256 TEXT PK, conversation_id NULL REFERENCES conversations(conversation_id),
//   selection_revision INTEGER NOT NULL, expires_at INTEGER NOT NULL [epoch ms]).
// Query only the exact minted hash rows after successful public route behavior.
function leaseFacts(database: string, tokens: string[]): { rows: LeaseRow[]; foreignKey: boolean; plaintextStored: boolean } {
  const db = new Database(database, { readonly: true, create: false });
  try {
    const rows = tokens.map(token => db.query<LeaseRow, [string]>(`SELECT token_sha256 AS tokenHash,
      conversation_id AS conversationId, selection_revision AS selectionRevision, expires_at AS expiresAt
      FROM view_leases WHERE token_sha256 = ?`).get(sha(token)));
    if (rows.some(row => row === null)) throw new Error('successful view registration must commit its exact hashed lease row');
    const keys = db.query<{ table: string; from: string; to: string }, []>('PRAGMA foreign_key_list(view_leases)').all();
    return { rows: rows.filter((row): row is LeaseRow => row !== null),
      foreignKey: keys.some(key => key.table === 'conversations' && key.from === 'conversation_id' && key.to === 'conversation_id'),
      plaintextStored: tokens.some(token => new TextDecoder().decode(db.serialize()).includes(token)) };
  } finally { db.close(); }
}

function canonicalProof(database: string): CanonicalProof {
  const db = new Database(database, { readonly: true, create: false });
  try {
    const input = db.query<{ activityAt: number; originalHex: string; originalSha256: string }, [string]>(`
      SELECT c.last_activity_at AS activityAt, lower(hex(d.original_input)) AS originalHex, d.payload_sha256 AS originalSha256
      FROM conversations c JOIN commands d ON d.conversation_id = c.conversation_id WHERE d.command_id = ?`).get(id(3, 4));
    if (!input) throw new Error('canonical fixture original/owner missing');
    return { ...input, facts: db.query<CanonicalProof['facts'][number], [string]>(`SELECT a.conversation_id AS conversationId,
      c.native_session_id AS nativeSessionId, a.message_id AS messageId, a.part_ordinal AS ordinal,
      a.payload_sha256 AS sha256, a.byte_length AS length, a.source_at AS at
      FROM canonical_activity a JOIN conversations c ON c.conversation_id = a.conversation_id
      WHERE a.conversation_id = ? ORDER BY a.message_id, a.part_ordinal`).all(conversation(4)),
      resumeCount: Number(db.query<{ count: number }, []>('SELECT count(*) AS count FROM resume_commands').get()?.count) };
  } finally { db.close(); }
}
function resumeFact(database: string, commandId: string): ResumeFact {
  const db = new Database(database, { readonly: true, create: false });
  try {
    const row = db.query<Omit<ResumeFact, 'count'>, [string]>(`SELECT r.command_id AS commandId, r.conversation_id AS conversationId,
      c.native_session_id AS nativeSessionId, r.registration_epoch AS registrationEpoch, r.registered_at AS registeredAt,
      r.state, r.failure_code AS failureCode FROM resume_commands r JOIN conversations c ON c.conversation_id = r.conversation_id
      WHERE r.command_id = ?`).get(commandId);
    if (!row) throw new Error('accepted Resume must have its bound durable command row');
    return { ...row, count: Number(db.query<{ count: number }, []>('SELECT count(*) AS count FROM resume_commands').get()?.count) };
  } finally { db.close(); }
}
function leaseProof(database: string, tokens: string[]): LeaseProof {
  const db = new Database(database, { readonly: true, create: false });
  try { return { rows: leaseFacts(database, tokens).rows,
    versions: db.query<LeaseProof['versions'][number], [string, string]>(`SELECT conversation_id AS conversationId,
      row_version AS version, last_activity_at AS activityAt FROM conversations WHERE conversation_id IN (?, ?) ORDER BY conversation_id`)
      .all(conversation(1), conversation(12)) }; }
  finally { db.close(); }
}

/** A specific registry-owned mapped transcript, never inferred from a legacy filename. */
async function mappedTranscriptProof(database: string, vault: string): Promise<TranscriptProof> {
  const db = new Database(database, { readonly: true, create: false });
  let row: { noteIdJson: string; creationState: string; offset: number; sha256: string; pendingEntryId: string | null } | null;
  let entries: string[];
  try {
    row = db.query<NonNullable<typeof row>, [string]>(`SELECT note_id_json AS noteIdJson, creation_state AS creationState,
      confirmed_offset AS offset, confirmed_sha256 AS sha256, pending_entry_id AS pendingEntryId
      FROM transcripts WHERE conversation_id = ?`).get(conversation(1));
    entries = db.query<{ id: string }, [string]>('SELECT entry_id AS id FROM transcript_entries WHERE conversation_id = ? ORDER BY entry_id')
      .all(conversation(1)).map(entry => entry.id);
  } finally { db.close(); }
  if (!row) throw new Error('fixture must physically confirm its mapped transcript before descriptor removal');
  const value: unknown = JSON.parse(row.noteIdJson);
  if (!Array.isArray(value) || value.length !== 3) throw new Error('unexpected owned fixture transcript mapping');
  const noteId: string[] = [];
  for (const part of value) {
    if (typeof part !== 'string' || !part || part.startsWith('.') || /[/\\\0]/.test(part)) throw new Error('unsafe fixture transcript component');
    noteId.push(part);
  }
  const { noteIdJson: _privateMapping, ...checkpoint } = row;
  return { ...checkpoint, noteId, entries, bytesHex: (await readFile(join(vault, ...noteId))).toString('hex') };
}

async function run(root: string, mode: Mode): Promise<Report> {
  const projectRoot = join(root, 'project'); const metadata = join(projectRoot, '.memory-loop');
  const vault = join(root, 'vault'); const transport = join(root, 'transport');
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  await mkdir(transport, { mode: 0o700 });
  await mkdir(join(vault, '03_Resources', 'Memory-Loop'), { recursive: true });
  const legacy = join(vault, 'legacy-transcript.md');
  const legacyText = 'legacy unregistered transcript must remain intact';
  await writeFile(legacy, legacyText, { mode: 0o600 });
  await writeFile(join(vault, '03_Resources', 'Memory-Loop', 'goals.md'), 'Owned fixture goal');
  const database = join(metadata, 'application.sqlite');
  const sessions = new Map<string, SessionInfo>();
  const histories = new Map<string, SessionMessageInfo[]>();
  const state = await openThinkState(projectRoot, vault);
  try {
    // Test-owned DAO input: thirteen genuine registered Sends, one recent but unused chat.
    // App routes, ownership verification and SDK parsing are NOT replaced by this setup.
    for (let index = 1; index <= 14; index++) {
      const conversationId = conversation(index); const nativeSessionId = nativeId(index);
      const owner = { owner: 'memory-loop' as const, conversationId, epoch, installationId: state.installationId };
      const receipt = { kind: 'create' as const, conversationId, clientCommandId: id(2, index), epoch, state: 'registered' as const };
      state.registerConversation({ conversationId, nativeSessionId, directory: vault, owner }, receipt, instant - 1000 + index);
      state.attempted(receipt.clientCommandId);
      state.outcome({ ...receipt, state: 'ready' }, { permissions: [{ action: '*', resource: '*', effect: 'allow' }] });
      const at = instant + (index >= 12 ? 13000 : index * 1000);
      const busy = mode === 'resume' && index === 1;
      sessions.set(nativeSessionId, { id: nativeSessionId, projectID: 'owned-fixture', location: { directory: vault }, metadata: { memoryLoop: owner },
        permissions: [{ action: '*', resource: '*', effect: 'allow' }], cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: instant - 1000 + index, updated: at, ...(index < 14 ? { busy: at - 1, ...(busy ? {} : { idle: at }) } : {}) },
        ...(index < 14 && !busy ? { outcome: 'succeeded' as const } : {}) });
      histories.set(nativeSessionId, []);
      if (index === 14) continue;
      const send = { kind: 'send' as const, conversationId, clientCommandId: id(3, index), runId: id(4, index), epoch, state: 'registered' as const };
      const text = original(index);
      state.registerCommand(send, Buffer.from(text), sha(text), at);
      state.attempted(send.clientCommandId);
      state.outcome({ ...send, state: busy ? 'admitted' : 'completed' });
      histories.set(nativeSessionId, [{ id: `msg_memoryloop_${send.clientCommandId.replaceAll('-', '')}`, type: 'user',
        text: `native prepared input ${index}, NOT the original title`, time: { created: at } }]);
      if (index === 1) {
        const decisionId = 'form_owned_fixture'; const answer = { answer: 'private form answer is not a title' };
        const form = { kind: 'form-reply' as const, conversationId, clientCommandId: id(5, index), decisionId, epoch, state: 'registered' as const };
        state.registerCommand(form, Buffer.from(JSON.stringify(answer)), sha(JSON.stringify({ conversationId, decisionId, answer })), activity(index));
        state.attempted(form.clientCommandId); state.outcome({ ...form, state: 'replied' });
      }
    }
  } finally { state.close(); }
  const lookalike = structuredClone(sessions.get(nativeId(1)));
  if (!lookalike) throw new Error('fixture native source missing');
  lookalike.id = nativeId(99);
  lookalike.metadata = { memoryLoop: { owner: 'memory-loop', conversationId: conversation(99), epoch } };
  const job = { ...structuredClone(lookalike), id: 'ses_fixture_ground_generation', metadata: { memoryLoop: { owner: 'memory-loop', purpose: 'ground-generation' } } };
  sessions.set(lookalike.id, lookalike); sessions.set(job.id, job);
  const lookalikesBefore = JSON.stringify([lookalike, job]);
  const effects = { creates: 0, prompts: 0, cancels: 0, interrupts: 0, replies: 0 };
  const removals: string[] = [];
  const unexpected: string[] = []; const streams = new Set<ServerResponse>();
  let nativeOffline = false;
  let deletionBusy = false;
  let nativeUrl = '';
  const native = createServer((request, response) => {
    if (request.headers.authorization !== authorization) { response.writeHead(401).end('{}'); return; }
    const url = new URL(request.url ?? '/', nativeUrl); const path = url.pathname;
    response.setHeader('content-type', 'application/json');
    const respond = (body: object) => { response.end(JSON.stringify(body)); };
    if (mode.startsWith('delete-') && request.method === 'DELETE' && path === `/api/session/${nativeId(1)}`) {
      removals.push(nativeId(1)); sessions.delete(nativeId(1)); histories.delete(nativeId(1));
      if (mode === 'delete-remove-ack-lost') { response.destroy(); return; }
      response.writeHead(204).end(); return;
    }
    if (request.method === 'POST') {
      if (path === '/api/session') effects.creates++;
      else if (path.endsWith('/prompt')) effects.prompts++;
      else if (path.endsWith('/interrupt')) effects.interrupts++;
      else if (path.includes('/inbox')) effects.cancels++;
      else if (path.endsWith('/reply')) effects.replies++;
      unexpected.push(`${request.method} ${path}`); response.writeHead(500).end('{}'); return;
    }
    if (nativeOffline) { response.writeHead(503).end(JSON.stringify({ error: 'fixture-private-native-error', path: root })); return; }
    if (path === '/api/info') { respond({ pid: process.pid, version: '2.2.2', urls: [], paths: { tmp: root } }); return; }
    if (path === '/api/event') {
      response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders();
      response.write(`data: ${JSON.stringify({ id: 'evt_fixture_connected', type: 'server.connected', data: {} })}\n\n`);
      streams.add(response); response.on('close', () => streams.delete(response)); return;
    }
    if (path === '/api/session/active') { respond({ data: mode === 'resume' || deletionBusy ? { [nativeId(1)]: { type: 'running' } } : {} }); return; }
    const parent = url.searchParams.get('parentID');
    if (request.method === 'GET' && path === '/api/session' && parent !== null && sessions.has(parent) &&
        Array.from({ length: 14 }, (_, index) => nativeId(index + 1)).includes(parent) &&
        url.searchParams.get('order') === 'asc' && url.searchParams.get('limit') === '1' &&
        [...url.searchParams.keys()].length === 3) {
      respond({ data: [...sessions.values()].filter(session => session.parentID === parent).slice(0, 1), cursor: {} }); return;
    }
    if (path === '/api/permission/request') { respond({ location: { directory: vault }, data: [] }); return; }
    const match = /^\/api\/session\/([^/]+)(.*)$/.exec(path);
    const session = match ? sessions.get(match[1]) : undefined;
    if (mode.startsWith('delete-') && match?.[1] === nativeId(1) && !session && !match[2]) { response.writeHead(404).end('{}'); return; }
    if (match && session) {
      const suffix = match[2]; const history = histories.get(session.id) ?? [];
      if (!suffix) { respond({ data: session }); return; }
      if (suffix === '/message') { respond({ data: history, cursor: {} }); return; }
      if (suffix.startsWith('/message/')) {
        const message = history.find(item => item.id === suffix.slice('/message/'.length));
        if (message) { respond({ data: message }); return; }
      }
      if (['/inbox', '/form'].includes(suffix)) { respond({ data: [] }); return; }
    }
    // In particular, do not let a native session-list scan silently supply registry history.
    unexpected.push(`${request.method} ${path}`); response.writeHead(404).end('{}');
  });
  await new Promise<void>((resolve, reject) => native.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = native.address(); if (!address || typeof address === 'string') throw new Error('fixture listener missing');
  nativeUrl = `http://127.0.0.1:${address.port}`;
  const registrationFile = join(root, 'native-registration.json');
  await writeFile(registrationFile, JSON.stringify({ url: nativeUrl, password, pid: process.pid, version: '2.2.2' }), { mode: 0o600 });
  await writeFile(join(metadata, 'config.json'), JSON.stringify({ vaultDirectory: vault, think: {
    service: { registrationFile, requiredVersion: '2.2.2' }, permissionMode: 'full', location: { kind: 'vault' } } }), { mode: 0o600 });
  const transportFile = join(transport, 'transport.json');
  await writeFile(transportFile, JSON.stringify({ daemonOrigin: `http://${authority}`, web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }), { mode: 0o600 });
  await writeFile(join(transport, 'service.token'), serviceToken, { mode: 0o600 });
  process.env.MEMORY_LOOP_TRANSPORT_FILE = transportFile;
  let clock = instant + 1_000_000;
  let app: PreparedServer | undefined;
  const open = async (): Promise<PreparedServer> => {
    if (!['leases', 'canonical', 'lease-lost-ack'].includes(mode) && !mode.startsWith('delete-')) return prepareServer({ projectRoot, authority });
    // Same production composition, using its existing injected clock for lease expiry.
    // No global Date/timer replacement and no future option on prepareServer.
    const state = await openThinkState(projectRoot, vault); const servingEpoch = randomUUID();
    const bodies = await createBodyStore({ directory: join(transport, `bodies-${servingEpoch}`), epoch: servingEpoch, vaultDirectory: vault });
    const reader = await openVault(vault); const ground = await openGround(vault); const capture = await openCaptureWriter(vault);
    const think = createThinkService({ native: nativeSessions(createNativeClient({ baseUrl: nativeUrl, headers: { authorization } })), state, bodies,
      context: { directory: vault }, epoch: servingEpoch, clock: { now: () => clock }, serviceIdentity: { pid: process.pid, version: '2.2.2' } });
    return { fetch: createApp({ authority, serviceToken, vault: { reader }, think, ground, capture }), startRecovery: () => think.startRecovery(), async close() {
      try { await think.close(); } finally { try { await capture.close(); } finally { try { await ground.close(); } finally { await reader.close(); } } }
    } };
  };
  const request = async (path: string, body?: object, viewToken?: string): Promise<Http> => {
    if (!app) throw new Error('fixture application is closed');
    const response = await app.fetch(new Request(`http://${authority}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { host: authority, authorization: `Bearer ${serviceToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(viewToken ? { 'X-Memory-Loop-View': viewToken } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    return { status: response.status, body: await response.json() as unknown };
  };
  try {
    app = await open();
    const controls = { snapshot: await request(`/api/think/conversations/${conversation(1)}`), goals: await request('/api/ground/goals'),
      tree: await request('/api/vault/tree'), capture: await request('/api/capture', { text: 'Owned route-isolation capture' }) };
    if (controls.snapshot.status !== 200 || !record(controls.snapshot.body) || controls.snapshot.body.creation !== 'ready') {
      throw new Error(`existing hydration must work before the new-route RED: ${JSON.stringify(controls.snapshot)}`);
    }
    const before = stateFacts(database);
    const report: Report = { mode, controls, before, after: before, effects, unexpected, legacyUnchanged: false, nativeLookalikesUnchanged: false };
    if (mode === 'recent') {
      report.list = await request('/api/ground/recent-conversations');
      await request(`/api/think/conversations/${conversation(1)}`);
      report.repeatedList = await request('/api/ground/recent-conversations');
    } else if (mode === 'canonical') {
      const path = `/api/think/conversations/${conversation(4)}`;
      const beforeList = await request('/api/ground/recent-conversations');
      histories.get(nativeId(4))?.push({ id: 'msg_ground_canonical_activity', type: 'assistant', agent: 'fixture',
        model: { providerID: 'fixture', id: 'fixture' }, finish: 'stop', time: { created: instant + 50000, completed: instant + 60000 },
        content: [{ type: 'text', text: 'Verified canonical fixture Ω\nbody' }] });
      const session = sessions.get(nativeId(4));
      if (!session) throw new Error('controlled canonical native session missing');
      session.time = { ...session.time, updated: instant + 60001, idle: instant + 60001 };
      clock += 1_000_000; // Observation/recovery time is deliberately MUCH later than the native fact.
      const snapshot = await request(path);
      const firstList = await request('/api/ground/recent-conversations');
      const first = canonicalProof(database);
      clock += 2_000_000;
      await request(path);
      const resumed = await request(`${path}/resume`, { clientCommandId: id(6, 4) });
      const repeatedList = await request('/api/ground/recent-conversations');
      const repeated = canonicalProof(database);
      await app.close(); app = undefined;
      clock += 3_000_000; app = await open();
      const restartSnapshot = await request(path);
      const commandAfterRestart = await request(`${path}/commands/${id(6, 4)}`);
      const retryAfterRestart = await request(`${path}/resume`, { clientCommandId: id(6, 4) });
      report.canonical = { beforeList, snapshot, firstList, repeatedList, resumed, restartSnapshot, commandAfterRestart, retryAfterRestart,
        restartList: await request('/api/ground/recent-conversations'), first, repeated, restarted: canonicalProof(database) };
    } else if (mode === 'registration-absent') {
      // Finish an ordinary owned transcript before closing the OLD service/store. This is
      // descriptor loss after successful app use, not absent/unsafe SQLite or an empty setup.
      let synced = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const current = await request(`/api/think/conversations/${conversation(1)}`);
        if (record(current.body) && record(current.body.transcript) && current.body.transcript.state === 'up-to-date') { synced = true; break; }
        await new Promise<void>(resolve => setTimeout(resolve, 5));
      }
      if (!synced) throw new Error('owned transcript must settle before the missing-descriptor regression');
      await app.close(); app = undefined;
      const transcriptBefore = await mappedTranscriptProof(database, vault);
      const db = new Database(database, { readonly: true, create: false });
      let databaseIntegrity: string;
      try { databaseIntegrity = String(db.query('PRAGMA quick_check').values()[0]?.[0]); } finally { db.close(); }
      const databaseMode = (await lstat(database)).mode & 0o7777;
      const directoryMode = (await lstat(metadata)).mode & 0o7777;
      // Emulate Service.stop's descriptor removal ONLY. Do not call stop (which would kill
      // a process), change config/private DB/vault binding, or reconstruct the descriptor.
      await unlink(registrationFile);
      const descriptorMissing = await readFile(registrationFile).then(() => false, (error: unknown) => {
        if (record(error) && error.code === 'ENOENT') return true;
        throw error;
      });
      // This mode uses the actual prepareServer branch above, including registration loading.
      // The owned HTTP native fake may remain alive, but no descriptor authorizes connecting to it.
      app = await open();
      const list = await request('/api/ground/recent-conversations');
      report.registrationAbsent = { descriptorMissing, databaseIntegrity, databaseMode, directoryMode, transcriptBefore,
        transcriptAfter: await mappedTranscriptProof(database, vault), list, siblings: {
          goals: await request('/api/ground/goals'), tree: await request('/api/vault/tree'),
          capture: await request('/api/capture', { text: 'Owned Capture after native descriptor removal' }) } };
    } else if (mode === 'offline') {
      await app.close(); app = undefined;
      nativeOffline = true;
      app = await open(); // Actual prepareServer startup with healthy SQLite and an unavailable selected native service.
      report.offline = { list: await request('/api/ground/recent-conversations'), siblings: {
        goals: await request('/api/ground/goals'), tree: await request('/api/vault/tree'),
        capture: await request('/api/capture', { text: 'Still a valid owned Capture while native is offline' }) } };
    } else if (mode === 'resume-unknown') {
      const path = `/api/think/conversations/${conversation(1)}`; const commandId = id(6, 1);
      const listBefore = await request('/api/ground/recent-conversations');
      nativeOffline = true;
      const first = await request(`${path}/resume`, { clientCommandId: commandId });
      const beforeRestart = resumeFact(database, commandId);
      await app.close(); app = undefined;
      app = await open();
      const unknownAfterRestart = await request(`${path}/commands/${commandId}`);
      const afterUnknown = resumeFact(database, commandId);
      nativeOffline = false;
      const known = await request(`${path}/commands/${commandId}`);
      const retry = await request(`${path}/resume`, { clientCommandId: commandId });
      report.resumeUnknown = { first, beforeRestart, unknownAfterRestart, afterUnknown, known, retry,
        afterKnown: resumeFact(database, commandId), snapshot: await request(path), listBefore, listAfter: await request('/api/ground/recent-conversations') };
    } else if (mode === 'lease-lost-ack') {
      const first = await request('/api/think/views', {}); const second = await request('/api/think/views', {});
      if (!record(first.body) || typeof first.body.viewToken !== 'string' || !record(second.body) || typeof second.body.viewToken !== 'string') throw new Error('controlled views must mint tokens');
      const token = first.body.viewToken; const otherToken = second.body.viewToken;
      await request('/api/think/selection', { viewToken: otherToken, expectedRevision: 0, conversationId: conversation(12) });
      // Accept the actual POST, but never parse/install its response at the caller.
      const lost = await app.fetch(new Request(`http://${authority}/api/think/selection`, { method: 'POST',
        headers: { host: authority, authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ viewToken: token, expectedRevision: 0, conversationId: conversation(1) }) }));
      await lost.body?.cancel();
      const beforeRead = leaseProof(database, [token, otherToken]);
      clock += 45000;
      const readback = await request('/api/think/selection', undefined, token);
      const afterRead = leaseProof(database, [token, otherToken]);
      const stale = await request('/api/think/selection', { viewToken: token, expectedRevision: 0, conversationId: conversation(1) });
      const beforeCorrectCas = leaseProof(database, [token, otherToken]);
      clock += 5000;
      let changed: Http | undefined;
      if (record(readback.body) && typeof readback.body.selectionRevision === 'number') changed = await request('/api/think/selection', {
        viewToken: token, expectedRevision: readback.body.selectionRevision, conversationId: conversation(13) });
      report.lostAck = { acceptedStatus: lost.status, beforeRead, readback, afterRead, stale, beforeCorrectCas,
        changed, afterChange: leaseProof(database, [token, otherToken]) };
    } else if (mode === 'resume') {
      const path = `/api/think/conversations/${conversation(1)}`; const clientCommandId = id(6, 1);
      const listBefore = await request('/api/ground/recent-conversations');
      const requested = await request(`${path}/resume`, { clientCommandId });
      report.resume = { requested, listBefore };
      if (requested.status === 202) {
        let ready = await request(`${path}/commands/${clientCommandId}`);
        for (let attempt = 0; attempt < 100 && record(ready.body) && ready.body.state === 'registered'; attempt++) {
          await new Promise<void>(resolve => setTimeout(resolve, 5)); ready = await request(`${path}/commands/${clientCommandId}`);
        }
        report.resume.ready = ready;
        report.resume.retry = await request(`${path}/resume`, { clientCommandId });
        report.resume.wrongTarget = await request(`/api/think/conversations/${conversation(2)}/resume`, { clientCommandId });
        report.resume.snapshot = await request(path);
        report.resume.listAfter = await request('/api/ground/recent-conversations');
      }
    } else if (mode.startsWith('delete-')) {
      // Require a real, owned mapped transcript before making any delete request.
      let synced = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const current = await request(`/api/think/conversations/${conversation(1)}`);
        if (record(current.body) && record(current.body.transcript) && current.body.transcript.state === 'up-to-date') { synced = true; break; }
        await new Promise<void>(resolve => setTimeout(resolve, 5));
      }
      if (!synced) throw new Error('owned transcript must settle before deletion checks');
      const transcriptBefore = await mappedTranscriptProof(database, vault);
      const registration = await request('/api/think/views', {});
      if (registration.status !== 201 || !record(registration.body) || typeof registration.body.viewToken !== 'string') throw new Error('controlled deletion view must be registered');
      const token = registration.body.viewToken;
      const sanitizedRegistration = { status: registration.status, body: { selectionRevision: registration.body.selectionRevision, conversationId: registration.body.conversationId, expiresAt: registration.body.expiresAt } };
      const path = `/api/think/conversations/${conversation(1)}`;
      const deletion: NonNullable<Report['deletion']> = { registration: sanitizedRegistration, transcriptBefore, transcriptExists: true,
        nativePresent: true, removals, payloadRows: 0, transcriptRows: 0, transcriptEntryRows: 0, pendingChunkRows: 0, unrelatedIntact: false };
      if (mode === 'delete-idle') {
        deletion.requested = await request(`${path}/delete`, { clientCommandId: id(7, 1), viewToken: token });
        if (deletion.requested.status === 202) {
          for (let attempt = 0; attempt < 200; attempt++) {
            deletion.receipt = await request(`${path}/commands/${id(7, 1)}`);
            if (record(deletion.receipt.body) && deletion.receipt.body.state === 'completed') break;
            await new Promise<void>(resolve => setTimeout(resolve, 10));
          }
        }
      } else if (mode === 'delete-busy' || mode === 'delete-child') {
        deletionBusy = mode === 'delete-busy';
        if (mode === 'delete-child') {
          const parent = sessions.get(nativeId(1));
          if (!parent) throw new Error('controlled child needs its owned parent');
          const child = { ...structuredClone(parent), id: 'ses_fixture_cross_directory_child', parentID: nativeId(1), location: { directory: join(root, 'other-directory') } };
          sessions.set(child.id, child);
        }
        deletion.requested = await request(`${path}/delete`, { clientCommandId: id(7, 6), viewToken: token });
        if (mode === 'delete-child') deletion.childPresent = sessions.has('ses_fixture_cross_directory_child');
      } else if (mode === 'delete-transcript-conflict' || mode === 'delete-remove-ack-lost') {
        if (mode === 'delete-transcript-conflict') await appendFile(join(vault, ...transcriptBefore.noteId), '\nfixture external edit must survive\n');
        const command = { clientCommandId: id(7, 7), viewToken: token };
        deletion.requested = await request(`${path}/delete`, command);
        if (deletion.requested.status === 202) {
          let settled = false;
          for (let attempt = 0; attempt < 200; attempt++) {
            deletion.receipt = await request(`${path}/commands/${command.clientCommandId}`);
            const body = deletion.receipt.body;
            if (deletion.receipt.status === 200 && record(body) && body.state === 'pending' &&
                (mode === 'delete-transcript-conflict' ? body.reason === 'conflict' : body.reason === 'io_unavailable' || body.reason === 'status_unknown')) {
              settled = true;
              break;
            }
            await new Promise<void>(resolve => setTimeout(resolve, 10));
          }
          if (!settled) throw new Error(`deletion did not reach the expected pending outcome for ${mode}: ${JSON.stringify(deletion.receipt)}`);
          const afterReceipt = removals.length;
          deletion.retry = await request(`${path}/delete`, command);
          const afterRetry = removals.length;
          if (mode === 'delete-remove-ack-lost') {
            await app.close(); app = undefined;
            app = await open(); app.startRecovery();
            const afterRestart = removals.length;
            deletion.reopenedReceipt = await request(`${path}/commands/${command.clientCommandId}`);
            const afterReopenedRead = removals.length;
            deletion.reopenedRetry = await request(`${path}/delete`, command);
            deletion.removalCounts = { afterReceipt, afterRetry, afterRestart, afterReopenedRead, afterReopenedRetry: removals.length };
          }
        }
      } else if (mode === 'delete-selected') {
        deletion.selected = await request('/api/think/selection', { viewToken: token, expectedRevision: 0, conversationId: conversation(1) });
        const other = await request('/api/think/views', {});
        if (other.status !== 201 || !record(other.body) || typeof other.body.viewToken !== 'string') throw new Error('controlled second view must be registered');
        deletion.own = await request(`${path}/delete`, { clientCommandId: id(7, 2), viewToken: token });
        deletion.other = await request(`${path}/delete`, { clientCommandId: id(7, 3), viewToken: other.body.viewToken });
      } else {
        deletion.unknown = await request(`${path}/delete`, { clientCommandId: id(7, 4), viewToken: 'z'.repeat(64) });
        clock += 120001;
        deletion.expiredRead = await request('/api/think/selection', undefined, token);
        deletion.expired = await request(`${path}/delete`, { clientCommandId: id(7, 5), viewToken: token });
      }
      deletion.transcriptExists = await lstat(join(vault, ...transcriptBefore.noteId)).then(() => true, (error: unknown) => {
        if (record(error) && error.code === 'ENOENT') return false; throw error;
      });
      deletion.nativePresent = sessions.has(nativeId(1));
      if (deletion.transcriptExists) deletion.transcriptAfter = await mappedTranscriptProof(database, vault);
      const db = new Database(database, { readonly: true, create: false });
      try {
        const count = (sql: string, idValue: string) => Number(db.query<{ count: number }, [string]>(sql).get(idValue)?.count);
        deletion.payloadRows = count('SELECT count(*) AS count FROM commands WHERE conversation_id = ? AND (original_input IS NOT NULL OR payload_sha256 IS NOT NULL)', conversation(1));
        deletion.transcriptRows = count('SELECT count(*) AS count FROM transcripts WHERE conversation_id = ?', conversation(1));
        deletion.transcriptEntryRows = count('SELECT count(*) AS count FROM transcript_entries WHERE conversation_id = ?', conversation(1));
        deletion.pendingChunkRows = count('SELECT count(*) AS count FROM transcript_pending_chunks WHERE conversation_id = ?', conversation(1));
        deletion.unrelatedIntact = count('SELECT count(*) AS count FROM conversations WHERE conversation_id = ?', conversation(2)) === 1 &&
          count('SELECT count(*) AS count FROM commands WHERE conversation_id = ? AND kind = \'send\' AND original_input IS NOT NULL', conversation(2)) === 1;
      } finally { db.close(); }
      report.deletion = deletion;
    } else if (mode === 'unknown-selection') {
      report.unknownSelection = await request('/api/think/selection', { viewToken: 'b'.repeat(64), expectedRevision: 0, conversationId: conversation(1) });
      report.unknownRead = await request('/api/think/selection', undefined, 'b'.repeat(64));
    } else {
      const minted = await request('/api/think/views', {});
      // Never write the plaintext response tokens into fixture reports/logs; keep them in memory.
      report.leases = { registration: { status: minted.status, body: record(minted.body) ? { ...minted.body, viewToken: undefined } : minted.body } };
      if (minted.status === 201 && record(minted.body) && typeof minted.body.viewToken === 'string') {
        const token = minted.body.viewToken;
        const other = await request('/api/think/views', {});
        report.leases.secondRegistration = { status: other.status, body: record(other.body) ? { ...other.body, viewToken: undefined } : other.body };
        if (!record(other.body) || typeof other.body.viewToken !== 'string') throw new Error('second view response token missing');
        const otherToken = other.body.viewToken;
        report.leases.tokenShape = [token, otherToken].every(value => /^[A-Za-z0-9_-]{43,256}$/.test(value));
        report.leases.tokensDistinct = token !== otherToken;
        report.leases.selected = await request('/api/think/selection', { viewToken: token, expectedRevision: 0, conversationId: conversation(1) });
        clock += 30000;
        report.leases.renewed = await request('/api/think/selection', { viewToken: token, expectedRevision: 1, conversationId: conversation(1) });
        report.leases.preparedResume = await request(`/api/think/conversations/${conversation(13)}/resume`, { clientCommandId: id(6, 13) });
        report.leases.selectionAfterResume = await request('/api/think/selection', undefined, token);
        report.leases.stale = await request('/api/think/selection', { viewToken: token, expectedRevision: 0, conversationId: conversation(12) });
        report.leases.staleRenewal = await request('/api/think/selection', { viewToken: token, expectedRevision: 0, conversationId: conversation(1) });
        // Fixed header-authenticated readback, without relaxing CAS.
        report.leases.readback = await request('/api/think/selection', undefined, token);
        report.leases.otherSelected = await request('/api/think/selection', { viewToken: otherToken, expectedRevision: 0, conversationId: conversation(12) });
        report.leases.cleared = await request('/api/think/selection', { viewToken: token, expectedRevision: 1, conversationId: null });
        report.leases.foreignHash = await request('/api/think/selection', { viewToken: sha(otherToken), expectedRevision: 1, conversationId: null });
        report.leases.unownedTarget = await request('/api/think/selection', { viewToken: token, expectedRevision: 2, conversationId: conversation(99) });
        report.leases.ownList = await request('/api/ground/recent-conversations', undefined, token);
        report.leases.otherList = await request('/api/ground/recent-conversations', undefined, otherToken);
        Object.assign(report.leases, leaseFacts(database, [token, otherToken]));
        await app.close(); app = undefined;
        clock += 15000; app = await open();
        report.leases.afterRestart = await request('/api/think/selection', undefined, token);
        report.leases.restartList = await request('/api/ground/recent-conversations', undefined, otherToken);
        report.leases.rowsAfterRestart = leaseFacts(database, [token, otherToken]).rows;
        clock += 120001;
        report.leases.expired = await request('/api/think/selection', { viewToken: otherToken, expectedRevision: 1, conversationId: conversation(12) });
        report.leases.expiredRead = await request('/api/think/selection', undefined, otherToken);
        report.leases.afterExpiryList = await request('/api/ground/recent-conversations');
        const listData = JSON.stringify([report.leases.ownList, report.leases.otherList, report.leases.restartList, report.leases.afterExpiryList]);
        report.leases.tokenDataExposed = [token, otherToken, sha(token), sha(otherToken)].some(secret => listData.includes(secret));
      }
    }
    report.after = stateFacts(database, mode.startsWith('delete-') && !sessions.has(nativeId(1)) ? 2 : 1);
    report.legacyUnchanged = await readFile(legacy, 'utf8') === legacyText;
    report.nativeLookalikesUnchanged = JSON.stringify([sessions.get(lookalike.id), sessions.get(job.id)]) === lookalikesBefore;
    return report;
  } finally {
    try { await app?.close(); } finally {
      for (const stream of streams) stream.destroy(); native.closeAllConnections();
      await new Promise<void>((resolve, reject) => native.close(error => error ? reject(error) : resolve()));
    }
  }
}

const [root, mode, output] = process.argv.slice(2);
if (!root?.startsWith('/tmp/opencode/ground-conversations-') || !output?.startsWith(`${root}/`) ||
    !['recent', 'resume', 'leases', 'unknown-selection', 'canonical', 'offline', 'lease-lost-ack', 'resume-unknown', 'registration-absent', 'delete-idle', 'delete-selected', 'delete-lease', 'delete-busy', 'delete-child', 'delete-transcript-conflict', 'delete-remove-ack-lost'].includes(mode ?? '')) throw new Error('Use an owned Ground conversation fixture root/mode');
await writeFile(output, JSON.stringify(await run(root, mode as Mode)));
