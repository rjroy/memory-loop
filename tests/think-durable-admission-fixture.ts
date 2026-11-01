import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { chmod, link, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { SessionCreateInput, SessionInfo, SessionPromptOutput, SessionMessageUser, SessionFormGetOutput } from '@opencode/client';
import { prepareServer, type PreparedServer } from '../backend/server';

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
export const legacyId = 'ses_fixture_legacy_unowned';
const authority = '127.0.0.1:31234';
const token = 'a'.repeat(64);
const password = 'fixture-only-password';
const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
const nativeId = (id: string) => `ses_memoryloop_${id.replaceAll('-', '')}`;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export type Scenario = 'create' | 'create-ready-restart' | 'send' | 'form' | 'uncertain' | 'database-symlink' | 'database-hardlink' |
  'database-permissions' | 'wal-symlink' | 'shm-symlink' | 'metadata-permissions' | 'state-inside-vault';

export interface Probe {
  exists: boolean;
  error?: string;
  schemaVersion: number;
  command: CommandFact | null;
  rejectedCommandPresent: boolean;
  legacyConversationPresent: boolean;
  integrity: string | null;
  writerAvailable: boolean;
  directoryMode?: number;
  fileMode?: number;
  ownerMatches?: boolean;
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

// Planned physical schema v1 for 9ya.3 (additional production columns/tables are fine):
// PRAGMA user_version = 1.
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
    let stat;
    try { stat = lstatSync(path); }
    catch (error) { if (record(error) && error.code === 'ENOENT') return result; throw error; }
    result.exists = true;
    result.fileMode = stat.mode & 0o7777;
    result.directoryMode = lstatSync(join(path, '..')).mode & 0o7777;
    result.ownerMatches = stat.uid === process.getuid?.();
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
  if (scenario === 'database-permissions') {
    const seed = new Database(database); seed.run('PRAGMA user_version = 0'); seed.close();
    await chmod(database, 0o644);
  }
  if (scenario === 'metadata-permissions') await chmod(metadata, 0o755);

  const observations: Observation[] = [];
  const unexpected: string[] = [];
  const counts = { creates: 0, prompts: 0, replies: 0 };
  const sessions = new Map<string, SessionInfo>();
  const messages: SessionMessageUser[] = [];
  const inbox: SessionPromptOutput[] = [];
  const streams = new Set<ServerResponse>();
  const base = `/api/think/conversations/${conversationId}`;
  let prepared: PreparedServer | undefined;
  let nativeUrl = '';
  const form: SessionFormGetOutput = { id: decisionId, sessionID: nativeId(conversationId), title: 'Fixture form',
    fields: [{ key: 'answer', type: 'string' }, { key: 'zeta', type: 'string' }], state: { status: 'pending' },
    metadata: { fixturePrivate: 'native form metadata is not original input' } };
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
        response.write(`data: ${JSON.stringify({ id: 'evt_fixture_connected', type: 'server.connected', data: {} })}\n\n`);
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
          metadata: typed.metadata ?? {}, permissions: [...(typed.permissions ?? [])], cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 100, updated: 100 } };
        sessions.set(session.id, session); response.end(JSON.stringify({ data: session })); return;
      }
      if (request.method === 'GET' && path === '/api/session/active') { response.end(JSON.stringify({ data: {} })); return; }
      if (request.method === 'GET' && path === '/api/permission/request') {
        response.end(JSON.stringify({ location: { directory: vault }, data: [] })); return;
      }
      const match = /^\/api\/session\/([^/]+)(.*)$/.exec(path);
      const session = match ? sessions.get(match[1]) : undefined;
      if (match && session) {
        const suffix = match[2];
        if (request.method === 'GET' && suffix === '') { response.end(JSON.stringify({ data: session })); return; }
        if (request.method === 'GET' && suffix === '/message') { response.end(JSON.stringify({ data: messages, cursor: {} })); return; }
        if (request.method === 'GET' && suffix === '/inbox') { response.end(JSON.stringify({ data: inbox })); return; }
        if (request.method === 'POST' && suffix === '/prompt') {
          const input = await body(request);
          if (typeof input.id !== 'string' || typeof input.text !== 'string') throw new Error('fixture received malformed prompt');
          observations.push({ operation: 'prompt', input: { ...input, sessionID: session.id }, probe: probeDatabase(database, sendCommandId) }); counts.prompts++;
          const admitted: SessionPromptOutput = { id: input.id, sessionID: session.id, type: 'user', time: { created: 200 },
            delivery: 'queue', payload: { text: preparedText } };
          inbox.push(admitted);
          messages.push({ id: input.id, type: 'user', text: preparedText, time: { created: 200 } });
          if (scenario === 'uncertain') { response.destroy(); return; }
          response.end(JSON.stringify({ data: admitted })); return;
        }
        if (request.method === 'GET' && suffix === '/form') { response.end(JSON.stringify({ data: [form] })); return; }
        if (request.method === 'GET' && suffix === `/form/${decisionId}`) { response.end(JSON.stringify({ data: form })); return; }
        if (request.method === 'POST' && suffix === `/form/${decisionId}/reply`) {
          const input = await body(request);
          observations.push({ operation: 'form-reply', input, probe: probeDatabase(database, formCommandId) }); counts.replies++;
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
  try {
    prepared = await prepareServer({ projectRoot, authority });
    const created = await request('/api/think/conversations', { conversationId, clientCommandId: createCommandId });
    const report: FixtureReport = { scenario, vault, database, observations, createStatus: created.status, createReceipt: await created.json(), ready: false,
      counts, configUnchanged: false, legacyUnchanged: false, outsideUnchanged: false, groundStatus: 0, groundValue: null, unexpected, probeControl };
    if (['create', 'create-ready-restart', 'send', 'form', 'uncertain'].includes(scenario)) {
      report.acknowledged = probeDatabase(database, createCommandId);
      if (created.status !== 202) throw new Error(`existing Think create did not reach admission: ${JSON.stringify(report.createReceipt)}`);
      await until(async () => (await request(base)).json() as Promise<unknown>, value => record(value) && value.creation === 'ready');
      report.ready = true;
      if (scenario === 'create') {
        report.duplicateStatus = (await request('/api/think/conversations', { conversationId, clientCommandId: createCommandId })).status;
        report.changedStatus = (await request('/api/think/conversations', { conversationId: secondConversationId, clientCommandId: createCommandId })).status;
      } else if (scenario === 'create-ready-restart') {
        // No Send: native creation is ready, but the shell has not observed that fact yet.
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
    await prepared?.close();
    for (const stream of streams) stream.destroy();
    native.closeAllConnections();
    await new Promise<void>((resolve, reject) => native.close(error => error ? reject(error) : resolve()));
  }
}

const scenarios: readonly Scenario[] = ['create', 'create-ready-restart', 'send', 'form', 'uncertain', 'database-symlink', 'database-hardlink',
  'database-permissions', 'wal-symlink', 'shm-symlink', 'metadata-permissions', 'state-inside-vault'];
const root = process.argv[2];
const selected = process.argv[3];
const output = process.argv[4];
if (!root?.startsWith('/tmp/opencode/think-durable-admission-') || !output?.startsWith(`${root}/`) || !scenarios.some(item => item === selected)) {
  throw new Error('Pass a test-owned /tmp/opencode fixture root, known scenario and report path');
}
const result = await run(root, selected as Scenario);
await writeFile(output, JSON.stringify(result), { mode: 0o600 });
