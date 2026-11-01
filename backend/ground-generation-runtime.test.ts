import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ModelInfo, SessionInfo } from '@opencode/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseGroundGenerationConfig, type GroundGenerationConfig } from './ground-generation-config';
import { createNativeClient } from './think/native';
import { parseGroundCollection } from './ground-parsers';

const runtime = resolve(import.meta.dirname, 'runtime.ts');
const clock = resolve(import.meta.dirname, '../tests/ground-generation-clock.ts');
const serverModule = resolve(import.meta.dirname, 'server.ts');
const now = Date.parse('2032-04-17T10:23:59.500Z');
const due = Date.parse('2032-04-17T10:23:00.000Z');
const serviceToken = 'a'.repeat(64);
const password = 'owned-generation-fixture-only';
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
const model = { providerID: 'fixture-provider', id: 'fixture-model' };
const generation = { enabled: true, timeZone: 'UTC', questions: { schedule: '* * * * *', count: 2 },
  quotes: { schedule: '31 8 * * 2', count: 1 }, context: { lookbackDays: 3, maxNotes: 2, maxNoteBytes: 1024, maxTotalBytes: 2048 } } satisfies GroundGenerationConfig & { enabled: true };
const promptsBefore = '# Owned questions\n\n## Question\nAn existing owned question?\n';
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

interface AttemptFact {
  occurrenceId: string; job: string; timeZone: string; scheduledAt: number; occurrenceState: string;
  attemptId: string; nativeSessionId: string; nativeMessageId: string; inputSha256: string; dispatchAttempted: number;
}
interface Probe {
  exists: boolean; integrity?: string; installationId?: string; writerAvailable: boolean;
  thinkRows?: { conversations: number; commands: number; transcripts: number }; attempts: AttemptFact[]; issue?: string;
}
interface OwnedChild { child: ChildProcessWithoutNullStreams; output: string; errors: string }
type NativeSession = Omit<SessionInfo, 'metadata' | 'permissions'> & { metadata: unknown; permissions: unknown };
interface Fixture {
  root: string; project: string; vault: string; database: string; prompts: string; port: number;
  native: Server; streams: Set<ServerResponse>; sessions: Map<string, NativeSession>;
  creates: Array<{ id: string; input: unknown; before: Probe }>;
  sends: Array<{ sessionId: string; id: string; text: string; before: Probe }>;
  unexpected: string[]; children: OwnedChild[];
  candidate?: string; historyReads: number; paginated?: boolean; historyQueries: string[];
}
let root: string;
const fixtures: Fixture[] = [];

// Narrow physical-state projection for the GREEN job store: no future module import,
// schema-version constant, flattened JSON search, or missing-table failure before native behavior.
function probe(path: string, attempts = true): Probe {
  const result: Probe = { exists: existsSync(path), writerAvailable: false, attempts: [] };
  if (!result.exists) return result;
  const db = new DatabaseSync(path);
  try {
    result.integrity = String(db.prepare('PRAGMA quick_check').get()?.quick_check);
    const installation = db.prepare('SELECT installation_id FROM application_metadata WHERE singleton = 1').get()?.installation_id;
    if (typeof installation !== 'string') throw new Error('missing installation identity');
    result.installationId = installation;
    const count = (table: 'conversations' | 'commands' | 'transcripts') => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
    result.thinkRows = { conversations: count('conversations'), commands: count('commands'), transcripts: count('transcripts') };
    db.exec('BEGIN IMMEDIATE; ROLLBACK;'); result.writerAvailable = true;
    if (!attempts) return result;
    const rows = db.prepare(`SELECT o.occurrence_id, o.job_key, o.time_zone, o.scheduled_at, o.state AS occurrence_state,
      a.attempt_id, a.native_session_id, a.native_message_id, a.input_sha256, a.dispatch_attempted
      FROM ground_generation_occurrences o JOIN ground_generation_attempts a ON a.occurrence_id = o.occurrence_id
      ORDER BY o.scheduled_at, a.attempt_id`).all();
    const text = (row: Record<string, unknown>, key: string) => {
      const value = row[key]; if (typeof value !== 'string') throw new Error(`invalid ${key}`); return value;
    };
    const integer = (row: Record<string, unknown>, key: string) => {
      const value = row[key]; if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`invalid ${key}`); return value;
    };
    result.attempts = rows.map(row => ({ occurrenceId: text(row, 'occurrence_id'), job: text(row, 'job_key'), timeZone: text(row, 'time_zone'),
      scheduledAt: integer(row, 'scheduled_at'), occurrenceState: text(row, 'occurrence_state'), attemptId: text(row, 'attempt_id'),
      nativeSessionId: text(row, 'native_session_id'), nativeMessageId: text(row, 'native_message_id'),
      inputSha256: text(row, 'input_sha256'), dispatchAttempted: integer(row, 'dispatch_attempted') }));
  } catch (error) { result.issue = error instanceof Error ? error.message : 'probe unavailable'; }
  finally { db.close(); }
  return result;
}

async function json(request: IncomingMessage): Promise<unknown> {
  let body = '';
  for await (const chunk of request) { body += String(chunk); if (Buffer.byteLength(body) > 128 * 1024) throw new Error('oversized fixture request'); }
  return JSON.parse(body) as unknown;
}
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing owned listener');
  return address.port;
}
async function until(test: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await sleep(10);
  return test();
}
async function stop(owned: OwnedChild): Promise<void> {
  const child = owned.child;
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end(); child.kill('SIGTERM');
  if (!await until(() => child.exitCode !== null || child.signalCode !== null)) {
    child.kill('SIGKILL');
    if (!await until(() => child.exitCode !== null || child.signalCode !== null)) throw new Error('owned daemon cleanup failed');
    throw new Error(`owned daemon did not shut down gracefully:\n${owned.output}\n${owned.errors}`);
  }
}

async function fixture(settings: unknown = generation, occupied?: number): Promise<Fixture> {
  const base = await mkdtemp(join(root, 'case-'));
  const project = join(base, 'project'); const vault = join(base, 'vault'); const metadata = join(project, '.memory-loop');
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  await mkdir(join(vault, 'notes'), { recursive: true });
  await mkdir(join(vault, '03_Resources', 'Memory-Loop'), { recursive: true });
  const recent = join(vault, 'notes', 'recent.md');
  await writeFile(recent, '# Owned recent edit\nA bounded fixture thought for question generation.\n');
  await utimes(recent, new Date(now - 3600000), new Date(now - 3600000));
  const prompts = join(vault, '03_Resources', 'Memory-Loop', 'prompts.md');
  await writeFile(prompts, promptsBefore);
  await writeFile(join(vault, '03_Resources', 'Memory-Loop', 'goals.md'), '# Owned fixture goal\n');
  const reserve = createServer(); const unused = occupied ?? await listen(reserve);
  if (occupied === undefined) await new Promise<void>((resolve, reject) => reserve.close(error => error ? reject(error) : resolve()));
  const state: Fixture = { root: base, project, vault, prompts, database: join(metadata, 'application.sqlite'), port: unused,
    native: createServer(), streams: new Set(), sessions: new Map(), creates: [], sends: [], unexpected: [], children: [], historyReads: 0, historyQueries: [] };
  fixtures.push(state);
  const catalog: ModelInfo = { ...model, modelID: model.id, name: 'Owned fixture model', type: 'chat', enabled: true,
    status: 'active', capabilities: { tools: true, input: ['text'], output: ['text'] }, variants: [], time: { released: 0 }, cost: [], limit: { context: 8192, output: 512 } };
  state.native.on('request', async (request, response) => {
    try {
      if (request.headers.authorization !== authorization) throw new Error('wrong native fixture authorization');
      const url = new URL(request.url ?? '/', 'http://fixture'); const path = url.pathname;
      const reply = (value: unknown) => { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value)); };
      if (request.method === 'GET' && path === '/api/info') { reply({ version: '2.2.2', pid: process.pid, urls: [], paths: { tmp: base } }); return; }
      if (request.method === 'GET' && path === '/api/model') { reply({ location: { directory: vault }, data: [catalog] }); return; }
      if (request.method === 'GET' && path === '/api/model/default') { reply({ location: { directory: vault }, data: catalog }); return; }
      if (request.method === 'GET' && path === '/api/event') {
        response.writeHead(200, { 'content-type': 'text/event-stream' }); response.flushHeaders();
        response.write(`data: ${JSON.stringify({ id: 'evt_owned_generation_connected', type: 'server.connected', data: {} })}\n\n`);
        state.streams.add(response); response.once('close', () => state.streams.delete(response)); return;
      }
      if (request.method === 'POST' && path === '/api/session') {
        const input = await json(request);
        if (!record(input) || typeof input.id !== 'string' || !record(input.location) || input.location.directory !== vault) throw new Error('malformed native create');
        state.creates.push({ id: input.id, input, before: probe(state.database) });
        const requested = input.model;
        if (requested !== undefined && (!record(requested) || typeof requested.providerID !== 'string' || typeof requested.id !== 'string' || requested.variant !== undefined && typeof requested.variant !== 'string')) throw new Error('invalid fixture model');
        const selected = record(requested) && typeof requested.providerID === 'string' && typeof requested.id === 'string'
          ? { providerID: requested.providerID, id: requested.id, variant: typeof requested.variant === 'string' ? requested.variant : 'default' } : undefined;
        const session: NativeSession = { id: input.id, projectID: 'owned-generation-project', location: { directory: vault }, agent: 'fixture-agent', ...(selected ? { model: selected } : {}),
          metadata: input.metadata, permissions: input.permissions, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: now, updated: now } };
        state.sessions.set(session.id, session); reply({ data: session }); return;
      }
      if (request.method === 'GET' && path === '/api/session/active') { reply({ data: state.candidate === undefined ? Object.fromEntries(state.sends.map(send => [send.sessionId, { type: 'running' }])) : {} }); return; }
      if (request.method === 'GET' && path === '/api/permission/request') { reply({ location: { directory: vault }, data: [] }); return; }
      const match = /^\/api\/session\/([^/]+)(.*)$/.exec(path); const session = match ? state.sessions.get(match[1]) : undefined;
      if (request.method === 'GET' && match && !session && !match[2]) { response.writeHead(404).end('{}'); return; }
      if (match && session) {
        const suffix = match[2];
        if (request.method === 'GET' && !suffix) { reply({ data: session }); return; }
        if (request.method === 'GET' && suffix === '/message') {
          state.historyReads++;
          state.historyQueries.push(url.search);
          const sent = state.sends.find(item => item.sessionId === session.id);
          const data = state.candidate === undefined || !sent ? [] : [
            { id: sent.id, type: 'user', text: sent.text, time: { created: now } },
            { id: 'msg_owned_generation_answer', type: 'assistant', agent: 'fixture-agent', ...(session.model ? { model: session.model } : {}), finish: 'stop',
              time: { created: now + 1, completed: now + 2 }, content: [{ type: 'text', text: state.candidate }] },
          ];
          if (state.paginated && data.length) {
            const cursor = url.searchParams.get('cursor');
            if (cursor === null && url.searchParams.get('order') === 'asc') { reply({ data: [data[0]], cursor: { next: 'owned-page-two' } }); return; }
            if (cursor === 'owned-page-two' && !url.searchParams.has('order')) { reply({ data: [data[1]], cursor: {} }); return; }
            response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'fixture invalid continuation' })); return;
          }
          reply({ data, cursor: {} }); return;
        }
        if (request.method === 'GET' && ['/inbox', '/form'].includes(suffix)) { reply({ data: [] }); return; }
        if (request.method === 'POST' && suffix === '/prompt') {
          const input = await json(request);
          if (!record(input) || typeof input.id !== 'string' || typeof input.text !== 'string') throw new Error('malformed native prompt');
          state.sends.push({ sessionId: session.id, id: input.id, text: input.text, before: probe(state.database) });
          if (state.candidate !== undefined) {
            session.time = { ...session.time, busy: now, idle: now + 2, updated: now + 2 };
            reply({ data: { id: input.id, sessionID: session.id, type: 'user', time: { created: now }, payload: { text: input.text }, delivery: 'queue' } });
            return;
          }
          session.time = { ...session.time, busy: now, updated: now };
          // Effect received, ACK lost; neither history nor inbox proves this particular ID yet.
          // No model/provider exists in this fixture. Native activity remains nonterminal.
          response.destroy(); return;
        }
      }
      throw new Error(`unexpected native request ${request.method} ${path}`);
    } catch (error) {
      state.unexpected.push(error instanceof Error ? error.message : 'fixture protocol error'); response.writeHead(500).end('{}');
    }
  });
  const nativePort = await listen(state.native);
  const client = createNativeClient({ baseUrl: `http://127.0.0.1:${nativePort}`, headers: { authorization } });
  expect(await client.server.info({ signal: AbortSignal.timeout(3000) })).toMatchObject({ pid: process.pid, version: '2.2.2' });
  expect(await client.model.list({ location: { directory: vault }, types: ['chat'] }, { signal: AbortSignal.timeout(3000) }))
    .toMatchObject({ location: { directory: vault }, data: [catalog] });
  const registrationFile = join(base, 'native-registration.json');
  await writeFile(registrationFile, JSON.stringify({ url: `http://127.0.0.1:${nativePort}`, password, pid: process.pid, version: '2.2.2' }), { mode: 0o600 });
  await writeFile(join(metadata, 'config.json'), JSON.stringify({ vaultDirectory: vault, think: { service: { registrationFile, requiredVersion: '2.2.2' },
    location: { kind: 'vault' }, permissionMode: 'full', model }, ground: { generation: settings } }));
  await writeFile(join(metadata, 'transport.json'), JSON.stringify({ daemonOrigin: `http://127.0.0.1:${unused}`, web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }), { mode: 0o600 });
  await writeFile(join(metadata, 'service.token'), serviceToken, { mode: 0o600 });
  return state;
}

function launch(state: Fixture, prepareOnly = false, instant = now): OwnedChild {
  const preparedScript = `import {prepareServer} from ${JSON.stringify(serverModule)};
    const prepared=await prepareServer({projectRoot:${JSON.stringify(state.project)},authority:'127.0.0.1:${state.port}'});
    process.on('SIGTERM',()=>{void prepared.close().then(()=>{process.exitCode=0;});});
    const response=await prepared.fetch(new Request('http://127.0.0.1:${state.port}/api/ground/goals',{headers:{host:'127.0.0.1:${state.port}',authorization:'Bearer ${serviceToken}'}}));
    console.info('ground_fixture_prepared',JSON.stringify({status:response.status,body:await response.json()}));`;
  const args = ['--no-env-file', '--preload', clock, ...(prepareOnly ? ['--eval', preparedScript] : [runtime, '--project-root', state.project, '--port', String(state.port)])];
  const child = spawn('/usr/bin/bun', args, { cwd: state.root, stdio: 'pipe', env: { NODE_ENV: 'test', PATH: '/usr/bin:/bin', HOME: state.root,
    XDG_CONFIG_HOME: state.root, XDG_DATA_HOME: state.root, XDG_CACHE_HOME: state.root, XDG_STATE_HOME: state.root, TMPDIR: state.root, TZ: 'UTC', GROUND_FIXTURE_NOW: String(instant) } });
  const owned: OwnedChild = { child, output: '', errors: '' };
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (value: string) => { owned.output += value; }); child.stderr.on('data', (value: string) => { owned.errors += value; });
  state.children.push(owned);
  return owned;
}
async function ready(owned: OwnedChild, prepareOnly = false, instant = now): Promise<void> {
  const marker = prepareOnly ? 'ground_fixture_prepared' : "status: \"listening\"";
  const found = await until(() => owned.output.includes(marker) || owned.child.exitCode !== null);
  expect(found && owned.output.includes(marker), `real production startup must succeed before behavior assertions:\n${owned.output}\n${owned.errors}`).toBe(true);
  expect(owned.output).toContain(`"now":${instant}`);
}
async function tick(owned: OwnedChild, instant = now): Promise<void> {
  owned.child.stdin.write(`${JSON.stringify({ id: 'next-minute', advanceMs: 1000 })}\n`);
  expect(await until(() => owned.output.includes('ground_fixture_step'))).toBe(true);
  const line = owned.output.split('\n').find(value => value.startsWith('ground_fixture_step '));
  if (!line) throw new Error('missing executed timer acknowledgement');
  expect(JSON.parse(line.slice('ground_fixture_step '.length))).toEqual({ id: 'next-minute', now: instant + 1000, pulses: 1 });
  await sleep(100);
}
async function observeCompletion(owned: OwnedChild, state: Fixture): Promise<void> {
  expect(await until(() => state.sends.length === 1, 1500), 'owned native prompt must be admitted before candidate observation').toBe(true);
  expect(await until(() => probe(state.database).attempts[0]?.occurrenceState === 'admitted', 1500)).toBe(true);
  const address = state.native.address();
  if (!address || typeof address === 'string') throw new Error('fixture native listener unavailable');
  const client = createNativeClient({ baseUrl: `http://127.0.0.1:${address.port}`, headers: { authorization } });
  const history = await client.message.list({ sessionID: state.sends[0].sessionId, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(3000) });
  expect(history.data).toMatchObject([{ id: state.sends[0].id, type: 'user' },
    { type: 'assistant', finish: 'stop', content: [{ type: 'text', text: state.candidate }] }]);
  const before = state.historyReads;
  owned.child.stdin.write(`${JSON.stringify({ id: 'observe-candidate', advanceMs: 30000 })}\n`);
  expect(await until(() => owned.output.includes('"id":"observe-candidate"'))).toBe(true);
  expect(await until(() => state.historyReads > before, 1500), 'real daemon must read the owned completed native history').toBe(true);
}
async function controls(state: Fixture): Promise<void> {
  // The daemon is service-only: Node fetch adds browser Fetch-Metadata that it correctly rejects.
  const get = (path: string) => new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: state.port, path, headers: { host: `127.0.0.1:${state.port}`, authorization: `Bearer ${serviceToken}` } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body })); response.on('error', reject);
    });
    request.setTimeout(3000, () => request.destroy(new Error('owned service read timeout'))); request.on('error', reject); request.end();
  });
  const goals = await get('/api/ground/goals');
  expect(goals.status).toBe(200); expect(JSON.parse(goals.body)).toMatchObject({ state: 'ready', data: { markdown: '# Owned fixture goal\n' } });
  const recent = await get('/api/ground/recent-conversations');
  expect(recent.status).toBe(200); expect(JSON.parse(recent.body)).toEqual({ state: 'ready', items: [] });
  const tree = await get('/api/vault/tree'); expect(tree.status).toBe(200);
}

beforeEach(async () => { root = await mkdtemp('/tmp/opencode/ground-generation-runtime-'); });
afterEach(async () => {
  try {
    for (const state of fixtures.splice(0)) {
      try { for (const owned of state.children) await stop(owned); }
      finally {
        for (const stream of state.streams) stream.destroy(); state.native.closeAllConnections();
        await new Promise<void>((resolve, reject) => state.native.close(error => error ? reject(error) : resolve()));
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

describe('Ground 9ya.7 autonomous daemon question admission', () => {
  it('Ground candidate pagination uses cursor-only continuation and publishes the completed answer', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 2 } };
    const state = await fixture(settings);
    state.candidate = JSON.stringify([{ text: 'Owned paginated question?' }]); state.paginated = true;
    const owned = launch(state); await ready(owned);
    expect(await until(() => state.sends.length === 1, 1500)).toBe(true);
    expect(await until(() => probe(state.database).attempts[0]?.occurrenceState === 'admitted', 1500)).toBe(true);
    owned.child.stdin.write(`${JSON.stringify({ id: 'observe-pages', advanceMs: 30000 })}\n`);
    expect(await until(() => owned.output.includes('"id":"observe-pages"'))).toBe(true);
    expect(await until(() => state.historyQueries.some(query => new URLSearchParams(query).has('cursor')), 1500), 'daemon must request the next native history page').toBe(true);
    const continuation = state.historyQueries.find(query => new URLSearchParams(query).has('cursor'));
    if (!continuation) throw new Error('fixture continuation missing');
    const query = new URLSearchParams(continuation);
    expect(query.get('cursor')).toBe('owned-page-two');
    expect(query.has('order'), 'native 2.2.2 rejects order alongside a cursor').toBe(false);
    expect(await until(() => readFileSync(state.prompts, 'utf8').includes('Owned paginated question?'), 2000)).toBe(true);
    expect(await until(() => probe(state.database).attempts[0]?.occurrenceState === 'settled', 2000)).toBe(true);
    expect(state.creates).toHaveLength(1); expect(state.sends).toHaveLength(1); expect(state.unexpected).toEqual([]);
  }, 20000);

  it('Ground candidate publication appends unique validated questions, retains the newest 50, and settles across restart', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 3 } };
    const state = await fixture(settings);
    const originals = Array.from({ length: 50 }, (_, index) => `Owned fixture question ${index + 1}?`);
    await writeFile(state.prompts, `# Owned questions\n\n${originals.map(text => `## Question\n${text}\n`).join('\n')}`);
    state.candidate = JSON.stringify([{ text: originals[49] }, { text: 'A new owned fixture question?' }]);
    const first = launch(state); await ready(first); await observeCompletion(first, state);
    expect(await until(() => existsSync(state.prompts) && readFileSync(state.prompts, 'utf8').includes('A new owned fixture question?'), 2000),
      'validated candidate must be published to the actual owned resource').toBe(true);
    const published = await readFile(state.prompts, 'utf8');
    const parsed = parseGroundCollection('prompts', published);
    expect(parsed.state).toBe('ready');
    if (parsed.state !== 'ready') throw new Error('published prompts are not valid Ground questions');
    expect(parsed.items.map(item => item.text)).toEqual([...originals.slice(1), 'A new owned fixture question?']);
    expect(await until(() => probe(state.database).attempts[0]?.occurrenceState === 'settled', 2000)).toBe(true);
    await stop(first);
    const second = launch(state, false, now + 30000); await ready(second, false, now + 30000);
    await controls(state);
    await stop(second);
    expect(await readFile(state.prompts, 'utf8')).toBe(published);
    expect(state.creates).toHaveLength(1); expect(state.sends).toHaveLength(1);
    expect(probe(state.database).attempts).toHaveLength(1);
    expect(probe(state.database).attempts[0]).toMatchObject({ occurrenceState: 'settled' });
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('Ground candidate publication rejects extra fields without changing the existing resource or claiming settlement', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 2 } };
    const state = await fixture(settings);
    state.candidate = JSON.stringify([{ text: 'Private invalid fixture candidate?', extra: 'fixture-private-field' }]);
    const before = await lstat(state.prompts);
    const owned = launch(state); await ready(owned); await observeCompletion(owned, state);
    expect(await until(() => probe(state.database).attempts[0]?.occurrenceState === 'failed', 2000),
      'invalid completed native output must be recorded as a safe failed outcome').toBe(true);
    expect(await readFile(state.prompts, 'utf8')).toBe(promptsBefore);
    expect((await lstat(state.prompts)).ino).toBe(before.ino);
    expect(probe(state.database).attempts[0]?.occurrenceState).not.toBe('settled');
    expect(state.creates).toHaveLength(1); expect(state.sends).toHaveLength(1);
    expect(owned.output + owned.errors).not.toMatch(/Private invalid fixture candidate|fixture-private-field/);
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('Ground candidate publication settles a valid empty batch without creating a missing resource or prompting again', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 2 } };
    const state = await fixture(settings); await rm(state.prompts);
    state.candidate = '[]';
    const first = launch(state); await ready(first); await observeCompletion(first, state);
    expect(await until(() => probe(state.database).attempts[0]?.occurrenceState === 'settled', 2000),
      'valid empty candidate batch must settle without publishing a file').toBe(true);
    expect(existsSync(state.prompts)).toBe(false);
    await stop(first);
    const second = launch(state, false, now + 30000); await ready(second, false, now + 30000); await stop(second);
    expect(existsSync(state.prompts)).toBe(false);
    expect(state.creates).toHaveLength(1); expect(state.sends).toHaveLength(1);
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('GROUND-9YA7-01 abandons an older undispatched attempt and admits only the latest due occurrence after restart', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 2 } };
    const state = await fixture(settings);
    const prepared = launch(state, true); await ready(prepared, true); await stop(prepared);
    const old = Date.parse('2032-04-16T10:00:00.000Z');
    const latest = Date.parse('2032-04-17T10:00:00.000Z');
    const occurrence = createHash('sha256').update(JSON.stringify(['questions', 'UTC', old])).digest('hex');
    const attempt = randomUUID(); const suffix = attempt.replaceAll('-', '');
    const db = new DatabaseSync(state.database);
    try {
      db.prepare(`INSERT INTO ground_generation_occurrences(occurrence_id, job_key, time_zone, scheduled_at, vault_directory, state)
        VALUES (?, 'questions', 'UTC', ?, ?, 'preparing')`).run(occurrence, old, state.vault);
      db.prepare(`INSERT INTO ground_generation_attempts(attempt_id, occurrence_id, native_session_id, native_message_id, input_sha256, question_count, requested_context_json)
        VALUES (?, ?, ?, ?, ?, 2, '{}')`).run(attempt, occurrence, `ses_memoryloop_generation_${suffix}`, `msg_memoryloop_generation_${suffix}`, 'b'.repeat(64));
    } finally { db.close(); }
    const owned = launch(state); await ready(owned);
    expect(await until(() => probe(state.database).attempts.some(item => item.attemptId === attempt && item.occurrenceState === 'failed'))).toBe(true);
    expect(state.sends.some(send => send.id === `msg_memoryloop_generation_${suffix}`)).toBe(false);
    expect(await until(() => state.sends.length === 1, 1500), 'new latest-due question must be admitted without waiting for tomorrow').toBe(true);
    await stop(owned);
    const facts = probe(state.database);
    expect(facts.issue).toBeUndefined();
    expect(facts.attempts).toHaveLength(2);
    expect(facts.attempts[0]).toMatchObject({ scheduledAt: old, occurrenceState: 'failed', dispatchAttempted: 0, attemptId: attempt });
    expect(facts.attempts[1]).toMatchObject({ scheduledAt: latest, dispatchAttempted: 1 });
    expect(state.creates).toHaveLength(1); expect(state.sends).toHaveLength(1);
    expect(state.sends[0].id).not.toBe(`msg_memoryloop_generation_${suffix}`);
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('admits only the latest due occurrence without a browser, and never duplicates its uncertain prompt on a timer or fresh daemon', async () => {
    expect(parseGroundGenerationConfig({ generation }).state).toBe('ready');
    const state = await fixture(); const first = launch(state); await ready(first);
    // No application HTTP request has occurred: the real runtime's post-listener hook owns this work.
    await until(() => state.sends.length > 0, 1500);
    const beforeReads = { creates: state.creates.length, sends: state.sends.length };
    await controls(state);
    expect(state.unexpected).toEqual([]);
    expect(probe(state.database, false)).toMatchObject({ exists: true, integrity: 'ok', writerAvailable: true,
      thinkRows: { conversations: 0, commands: 0, transcripts: 0 } });
    expect(beforeReads.sends, 'enabled resident startup must attempt ONE latest-due question prompt without a browser').toBe(1);
    expect(beforeReads.creates).toBe(1);
    const created = state.creates[0]; const sent = state.sends[0];
    expect(created.input).toMatchObject({ id: created.id, location: { directory: state.vault }, model,
      metadata: { memoryLoop: { owner: 'memory-loop', purpose: 'ground-generation', installationId: created.before.installationId } },
      permissions: [{ action: '*', resource: '*', effect: 'deny' }] });
    for (const observed of [created.before, sent.before]) {
      expect(observed.issue).toBeUndefined(); expect(observed.writerAvailable).toBe(true); expect(observed.attempts).toHaveLength(1);
      expect(observed.attempts[0]).toMatchObject({ job: 'questions', timeZone: 'UTC', scheduledAt: due, nativeSessionId: created.id,
        nativeMessageId: sent.id, inputSha256: createHash('sha256').update(sent.text, 'utf8').digest('hex'),
        attemptId: expect.stringMatching(/\S/), occurrenceId: expect.stringMatching(/\S/) });
    }
    expect(sent.sessionId).toBe(created.id);
    expect(sent.before.attempts[0].dispatchAttempted, 'attempt fact must commit BEFORE crossing the native prompt boundary').toBe(1);
    await tick(first);
    expect(state.creates).toHaveLength(1); expect(state.sends).toHaveLength(1);
    await stop(first);
    expect(first.child.exitCode).toBe(0);
    const retained = probe(state.database); expect(retained.issue).toBeUndefined(); expect(retained.attempts).toHaveLength(1);
    expect(retained.attempts[0].occurrenceState).not.toBe('settled');
    const second = launch(state, false, now + 1000); await ready(second, false, now + 1000); await tick(second, now + 1000); await controls(state);
    await stop(second);
    expect(second.child.exitCode).toBe(0);
    expect(state.unexpected).toEqual([]); expect(state.creates).toHaveLength(1); expect(state.sends).toHaveLength(1);
    const restored = probe(state.database); expect(restored.issue).toBeUndefined(); expect(restored.attempts).toEqual(retained.attempts);
    expect(await readFile(state.prompts, 'utf8')).toBe(promptsBefore);
  }, 20000);

  it('does not start generation during prepare-only or disabled/invalid runtime startup, while existing reads remain usable', async () => {
    for (const mode of ['prepare-only', 'disabled', 'invalid'] as const) {
      const settings = mode === 'disabled' ? { ...generation, enabled: false } : mode === 'invalid' ? { ...generation, questions: { schedule: 'invalid fixture cron', count: 2 } } : generation;
      expect(parseGroundGenerationConfig({ generation: settings }).state).toBe(mode === 'prepare-only' ? 'ready' : mode);
      const state = await fixture(settings); const prepared = mode === 'prepare-only'; const owned = launch(state, prepared); await ready(owned, prepared);
      await tick(owned);
      if (prepared) expect(owned.output).toContain('"status":200'); else await controls(state);
      expect(state.unexpected).toEqual([]); expect(state.creates).toEqual([]); expect(state.sends).toEqual([]);
      expect(await readFile(state.prompts, 'utf8')).toBe(promptsBefore);
      await stop(owned);
      expect(owned.child.exitCode).toBe(0);
      expect(state.unexpected).toEqual([]); expect(state.creates).toEqual([]); expect(state.sends).toEqual([]);
    }
  }, 20000);

  it('never dispatches background generation when the actual daemon cannot acquire its listener', async () => {
    const occupied = createServer((_request, response) => response.end('owned listener sentinel'));
    try {
      const port = await listen(occupied); const state = await fixture(generation, port); const owned = launch(state);
      owned.child.stdin.end();
      expect(await until(() => owned.child.exitCode !== null), `occupied-listener startup must settle:\n${owned.output}\n${owned.errors}`).toBe(true);
      expect(owned.child.exitCode).not.toBe(0); expect(owned.errors).toContain('EADDRINUSE');
      expect(owned.output).toContain('ground_generation_config_outcome'); expect(owned.output).not.toContain('status: "listening"');
      expect(probe(state.database, false)).toMatchObject({ exists: true, integrity: 'ok', writerAvailable: true,
        thinkRows: { conversations: 0, commands: 0, transcripts: 0 } });
      expect(state.unexpected).toEqual([]); expect(state.creates).toEqual([]); expect(state.sends).toEqual([]);
      expect(await readFile(state.prompts, 'utf8')).toBe(promptsBefore);
      expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('owned listener sentinel');
    } finally { occupied.closeAllConnections(); await new Promise<void>((resolve, reject) => occupied.close(error => error ? reject(error) : resolve())); }
  });
});
