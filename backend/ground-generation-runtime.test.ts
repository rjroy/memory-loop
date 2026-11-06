import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
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
const due = Date.parse('2032-04-17T00:00:00.000Z');
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
  candidate?: string; quoteCandidate?: string; historyReads: number; paginated?: boolean; historyQueries: Array<{ sessionId: string; query: string }>;
}
let root: string;
const fixtures: Fixture[] = [];
const questionFacts = (probe: Probe) => probe.attempts.filter(item => item.job === 'questions');
const questionSends = (state: Fixture) => state.sends.filter(send => questionFacts(send.before).some(item => item.nativeSessionId === send.sessionId));
const questionCreates = (state: Fixture) => state.creates.filter(create => questionFacts(create.before).some(item => item.nativeSessionId === create.id));

// Narrow physical-state projection for the GREEN job store: no future module import,
// schema-version constant, flattened JSON search, or missing-table failure before native behavior.
function probe(path: string, attempts = true): Probe {
  const result: Probe = { exists: existsSync(path), writerAvailable: false, attempts: [] };
  if (!result.exists) return result;
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 1000');
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

async function fixture(settings: unknown = generation, occupied?: number, versions: { registered?: string; reported?: string; minimum?: string } = {}): Promise<Fixture> {
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
  const candidateFor = (text: string) => /\bquotes?\b/i.test(text) ? state.quoteCandidate : state.candidate;
  state.native.on('request', async (request, response) => {
    try {
      if (request.headers.authorization !== authorization) throw new Error('wrong native fixture authorization');
      const url = new URL(request.url ?? '/', 'http://fixture'); const path = url.pathname;
      const reply = (value: unknown) => { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value)); };
      if (request.method === 'GET' && path === '/api/info') { reply({ version: versions.reported ?? '2.2.2', pid: process.pid, urls: [], paths: { tmp: base } }); return; }
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
      if (request.method === 'GET' && path === '/api/session/active') { reply({ data: Object.fromEntries(state.sends.filter(send => candidateFor(send.text) === undefined).map(send => [send.sessionId, { type: 'running' }])) }); return; }
      if (request.method === 'GET' && path === '/api/permission/request') { reply({ location: { directory: vault }, data: [] }); return; }
      const match = /^\/api\/session\/([^/]+)(.*)$/.exec(path); const session = match ? state.sessions.get(match[1]) : undefined;
      if (request.method === 'GET' && match && !session && !match[2]) { response.writeHead(404).end('{}'); return; }
      if (match && session) {
        const suffix = match[2];
        if (request.method === 'GET' && !suffix) { reply({ data: session }); return; }
        if (request.method === 'GET' && suffix === '/message') {
          state.historyReads++;
          state.historyQueries.push({ sessionId: session.id, query: url.search });
          const sent = state.sends.find(item => item.sessionId === session.id);
          const candidate = sent ? candidateFor(sent.text) : undefined;
          const data = candidate === undefined || !sent ? [] : [
            { id: sent.id, type: 'user', text: sent.text, time: { created: now } },
            { id: 'msg_owned_generation_answer', type: 'assistant', agent: 'fixture-agent', ...(session.model ? { model: session.model } : {}), finish: 'stop',
              time: { created: now + 1, completed: now + 2 }, content: [{ type: 'text', text: candidate }] },
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
          if (candidateFor(input.text) !== undefined) {
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
  expect(await client.server.info({ signal: AbortSignal.timeout(3000) })).toMatchObject({ pid: process.pid, version: versions.reported ?? '2.2.2' });
  expect(await client.model.list({ location: { directory: vault }, types: ['chat'] }, { signal: AbortSignal.timeout(3000) }))
    .toMatchObject({ location: { directory: vault }, data: [catalog] });
  const registrationFile = join(base, 'native-registration.json');
  await writeFile(registrationFile, JSON.stringify({ url: `http://127.0.0.1:${nativePort}`, password, pid: process.pid, version: versions.registered ?? '2.2.2' }), { mode: 0o600 });
  await writeFile(join(metadata, 'config.json'), JSON.stringify({ vaultDirectory: vault, think: { service: { registrationFile, requiredVersion: versions.minimum ?? '2.2.2' },
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
  const child = spawn('bun', args, { cwd: state.root, stdio: 'pipe', env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: state.root,
    XDG_CONFIG_HOME: state.root, XDG_DATA_HOME: state.root, XDG_CACHE_HOME: state.root, XDG_STATE_HOME: state.root, TMPDIR: state.root, TEMP: state.root, TMP: state.root, TZ: 'UTC', GROUND_FIXTURE_NOW: String(instant) } });
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
  expect(await until(() => questionSends(state).length === 1, 1500), 'owned native question prompt must be admitted before candidate observation').toBe(true);
  expect(await until(() => questionFacts(probe(state.database))[0]?.occurrenceState === 'admitted', 1500)).toBe(true);
  const address = state.native.address();
  if (!address || typeof address === 'string') throw new Error('fixture native listener unavailable');
  const client = createNativeClient({ baseUrl: `http://127.0.0.1:${address.port}`, headers: { authorization } });
  const sent = questionSends(state)[0];
  const history = await client.message.list({ sessionID: sent.sessionId, order: 'asc', limit: 50 }, { signal: AbortSignal.timeout(3000) });
  expect(history.data).toMatchObject([{ id: sent.id, type: 'user' },
    { type: 'assistant', finish: 'stop', content: [{ type: 'text', text: state.candidate }] }]);
  const before = state.historyQueries.filter(item => item.sessionId === sent.sessionId).length;
  owned.child.stdin.write(`${JSON.stringify({ id: 'observe-candidate', advanceMs: 30000 })}\n`);
  expect(await until(() => owned.output.includes('"id":"observe-candidate"'))).toBe(true);
  expect(await until(() => state.historyQueries.filter(item => item.sessionId === sent.sessionId).length > before, 1500), 'real daemon must read the owned completed question history').toBe(true);
}
async function serviceGet(state: Fixture, path: string): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: state.port, path,
      headers: { host: `127.0.0.1:${state.port}`, authorization: `Bearer ${serviceToken}` } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body })); response.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error('owned service read timeout'))); req.on('error', reject); req.end();
  });
}
async function observeQuote(owned: OwnedChild, state: Fixture) {
  expect(await until(() => state.sends.some(send => /\bquotes?\b/i.test(send.text)), 2000),
    'weekly quote occurrence must dispatch its own prompt even while questions remain pending').toBe(true);
  const quote = state.sends.find(send => /\bquotes?\b/i.test(send.text));
  if (!quote) throw new Error('owned quote prompt missing');
  expect(await until(() => probe(state.database).attempts.some(item => item.job === 'quotes' && item.occurrenceState === 'admitted'), 1500)).toBe(true);
  const reads = state.historyQueries.filter(item => item.sessionId === quote.sessionId).length;
  owned.child.stdin.write(`${JSON.stringify({ id: 'observe-quotes', advanceMs: 30000 })}\n`);
  expect(await until(() => owned.output.includes('"id":"observe-quotes"'))).toBe(true);
  expect(await until(() => state.historyQueries.filter(item => item.sessionId === quote.sessionId).length > reads, 1500)).toBe(true);
  return quote;
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

describe('lazy Ground freshness', () => {
  const settings = { ...generation, timeZone: 'America/Los_Angeles',
    questions: { schedule: '0 10 * * *', count: 2 }, quotes: { schedule: '0 9 * * 1', count: 1 } };
  const saturday = Date.parse('2032-04-17T23:30:00.000Z');
  const sunday = Date.parse('2032-04-18T08:00:00.000Z');
  const monday = Date.parse('2032-04-19T08:00:00.000Z');
  const quotePath = (state: Fixture) => join(state.vault, '03_Resources', 'Memory-Loop', 'inspiration.md');
  const questionCandidate = JSON.stringify([{ text: 'A new owned question?' }]);
  const quoteCandidate = JSON.stringify([{ text: 'A new owned quote', attribution: 'Owned author' }]);
  const quoteSends = (state: Fixture) => state.sends.filter(send => probeJob(send, 'quotes'));
  const probeJob = (send: Fixture['sends'][number], job: string) => send.before.attempts.some(item => item.job === job && item.nativeSessionId === send.sessionId);
  const open = (state: Fixture) => Promise.all([serviceGet(state, '/api/ground/prompts'), serviceGet(state, '/api/ground/inspiration')]);
  async function settle(owned: OwnedChild, state: Fixture, id: string, expectedQuestions: number, expectedQuotes: number, newJobs: number) {
    expect(await until(() => questionSends(state).length === expectedQuestions && quoteSends(state).length === expectedQuotes, 2000)).toBe(true);
    expect(await until(() => {
      const admitted = probe(state.database).attempts.filter(item => item.occurrenceState === 'admitted').length;
      const armed = owned.output.split('ground_fixture_generation_poll_armed').length - 1;
      return admitted === newJobs && armed >= newJobs;
    }, 2000), 'each new job must be admitted and have armed its observation timer before advancing the fixture clock').toBe(true);
    owned.child.stdin.write(`${JSON.stringify({ id, advanceMs: 30000 })}\n`);
    expect(await until(() => owned.output.includes(`"id":"${id}"`))).toBe(true);
    expect(await until(() => {
      const attempts = probe(state.database).attempts;
      return attempts.filter(item => item.job === 'questions' && item.occurrenceState === 'settled').length === expectedQuestions &&
        attempts.filter(item => item.job === 'quotes' && item.occurrenceState === 'settled').length === expectedQuotes;
    }, 2000)).toBe(true);
  }

  it.each([['prompts', 'questions'], ['inspiration', 'quotes']] as const)(
    'a read of %s alone requests only %s freshness', async (path, job) => {
      const state = await fixture(settings); const owned = launch(state, false, saturday); await ready(owned, false, saturday);
      expect((await serviceGet(state, `/api/ground/${path}`)).status).toBe(200);
      expect(await until(() => state.sends.length === 1, 2000)).toBe(true);
      expect(state.sends[0].before.attempts).toEqual(expect.arrayContaining([expect.objectContaining({ job })]));
      await sleep(100);
      expect(state.sends).toHaveLength(1);
      expect(state.unexpected).toEqual([]);
    }, 20000);

  it.each([
    ['2.2.5', '2.2.2'], ['9.0.0', '2.2.2'], ['2.2.5', '2.2.5'], ['9.0.0', '2.2.5'],
  ] as const)('allows Ground generation with native %s at minimum %s', async (version, minimum) => {
    const state = await fixture(settings, undefined, { registered: version, reported: version, minimum });
    const owned = launch(state, false, saturday); await ready(owned, false, saturday);
    expect((await serviceGet(state, '/api/ground/prompts')).status).toBe(200);
    expect(await until(() => questionSends(state).length === 1, 2000)).toBe(true);
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it.each([['2.2.1', '2.2.2'], ['2.2.2', '2.2.5'], ['2.2.2-rc.1', '2.2.2']] as const)(
    'does not dispatch Ground generation when live native %s is below minimum %s', async (reported, minimum) => {
      const state = await fixture(settings, undefined, { registered: minimum, reported, minimum });
      const owned = launch(state, false, saturday); await ready(owned, false, saturday);
      expect((await serviceGet(state, '/api/ground/prompts')).status).toBe(200);
      expect(await until(() => owned.output.includes('ground_generation_native_outcome'), 2000)).toBe(true);
      await sleep(100);
      expect(state.creates).toEqual([]); expect(state.sends).toEqual([]);
      expect(state.unexpected).toEqual([]);
    }, 20000);

  it('does no generation at startup; concurrent opens return existing cards without waiting and coalesce uncertain submissions', async () => {
    const state = await fixture(settings);
    await writeFile(quotePath(state), '## Quote\n> Existing owned quote\n\nAttribution: Owned author\n');
    const first = launch(state, false, saturday); await ready(first, false, saturday);
    await sleep(150);
    expect(state.sends, 'startup alone must not request generation').toEqual([]);
    const reads = await Promise.all(Array.from({ length: 5 }, () => open(state)));
    for (const [questions, quotes] of reads) {
      expect(questions.status).toBe(200);
      expect(JSON.parse(questions.body)).toMatchObject({ state: 'ready', data: { question: { text: 'An existing owned question?' } } });
      expect(quotes.status).toBe(200);
      expect(JSON.parse(quotes.body)).toMatchObject({ state: 'ready', data: { quote: { text: 'Existing owned quote' } } });
    }
    expect(await until(() => questionSends(state).length === 1 && quoteSends(state).length === 1, 2000)).toBe(true);
    await stop(first);
    const second = launch(state, false, saturday + 60000); await ready(second, false, saturday + 60000);
    await Promise.all([open(state), open(state)]); await sleep(150);
    expect(questionSends(state)).toHaveLength(1); expect(quoteSends(state)).toHaveLength(1);
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('persists completed local periods across restarts and refreshes daily questions and Monday weekly quotes', async () => {
    const state = await fixture(settings); state.candidate = questionCandidate; state.quoteCandidate = quoteCandidate;
    const first = launch(state, false, saturday); await ready(first, false, saturday); await open(state);
    await settle(first, state, 'settle-saturday', 1, 1, 2); await stop(first);
    const same = launch(state, false, saturday + 3600000); await ready(same, false, saturday + 3600000);
    await open(state); await sleep(150);
    expect(questionSends(state)).toHaveLength(1); expect(quoteSends(state)).toHaveLength(1); await stop(same);
    const nextDay = launch(state, false, sunday); await ready(nextDay, false, sunday); await open(state);
    await settle(nextDay, state, 'settle-sunday', 2, 1, 1); await stop(nextDay);
    const nextWeek = launch(state, false, monday); await ready(nextWeek, false, monday); await open(state);
    await settle(nextWeek, state, 'settle-monday', 3, 2, 2);
    expect(state.unexpected).toEqual([]);
  }, 25000);

  it('does not generate a new day merely because reconciliation crosses midnight', async () => {
    const beforeMidnight = Date.parse('2032-04-17T23:59:50.000Z');
    const state = await fixture({ ...settings, timeZone: 'UTC' });
    state.candidate = '[]';
    const owned = launch(state, false, beforeMidnight); await ready(owned, false, beforeMidnight);
    expect((await serviceGet(state, '/api/ground/prompts')).status).toBe(200);
    // The real observation timer fires 20 seconds into the next local day.
    await settle(owned, state, 'reconcile-after-midnight', 1, 0, 1);
    expect(await until(() => questionSends(state).length > 1, 500),
      'reconciliation alone must not submit the new day without another card read').toBe(false);
    expect(questionFacts(probe(state.database))).toHaveLength(1);
    expect(questionFacts(probe(state.database))[0]).toMatchObject({ occurrenceState: 'settled' });

    expect((await serviceGet(state, '/api/ground/prompts')).status).toBe(200);
    expect(await until(() => questionSends(state).length === 2, 2000),
      'a later explicit card read must request the new local day').toBe(true);
    expect(questionFacts(probe(state.database))).toHaveLength(2);
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('retries a failed completed candidate on a later open in the same local period', async () => {
    const state = await fixture(settings);
    state.candidate = JSON.stringify([{ text: 'Invalid owned question?', extra: 'invalid' }]);
    state.quoteCandidate = quoteCandidate;
    const owned = launch(state, false, saturday); await ready(owned, false, saturday); await open(state);
    expect(await until(() => questionSends(state).length === 1, 2000)).toBe(true);
    expect(await until(() => probe(state.database).attempts.filter(item => item.occurrenceState === 'admitted').length === 2 &&
      owned.output.split('ground_fixture_generation_poll_armed').length - 1 >= 2, 2000),
    'both jobs must be admitted and have armed observation timers before advancing the clock').toBe(true);
    owned.child.stdin.write(`${JSON.stringify({ id: 'observe-invalid', advanceMs: 30000 })}\n`);
    expect(await until(() => owned.output.includes('"id":"observe-invalid"'))).toBe(true);
    expect(await until(() => questionFacts(probe(state.database)).some(item => item.occurrenceState === 'failed'), 2000)).toBe(true);
    expect(await until(() => probe(state.database).attempts.some(item => item.job === 'quotes' && item.occurrenceState === 'settled'), 2000)).toBe(true);
    expect(await readFile(state.prompts, 'utf8')).toBe(promptsBefore);
    const armedBeforeRetry = owned.output.split('ground_fixture_generation_poll_armed').length - 1;
    state.candidate = questionCandidate;
    await open(state);
    expect(await until(() => questionSends(state).length === 2, 2000), 'recoverable failure must not consume the day').toBe(true);
    expect(await until(() => questionFacts(probe(state.database)).some(item => item.occurrenceState === 'admitted'), 2000)).toBe(true);
    expect(await until(() => owned.output.split('ground_fixture_generation_poll_armed').length - 1 > armedBeforeRetry, 2000),
      'the retry must arm its observation timer before advancing the clock').toBe(true);
    owned.child.stdin.write(`${JSON.stringify({ id: 'observe-retry', advanceMs: 30000 })}\n`);
    expect(await until(() => owned.output.includes('"id":"observe-retry"'))).toBe(true);
    expect(await until(() => readFileSync(state.prompts, 'utf8').includes('A new owned question?'), 2000)).toBe(true);
    expect(await until(() => questionFacts(probe(state.database)).some(item => item.occurrenceState === 'settled'), 2000)).toBe(true);
    expect(state.unexpected).toEqual([]);
  }, 20000);
});

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ground-generation-runtime-')); });
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
  it('Ground weekly quote generation publishes a partial attributed batch independently of pending questions and preserves legacy sources', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 2 }, quotes: { schedule: '0 9 * * 6', count: 3 } };
    const state = await fixture(settings);
    const inspiration = join(state.vault, '03_Resources', 'Memory-Loop', 'inspiration.md');
    const originals = Array.from({ length: 50 }, (_, index) => `Owned fictional quote ${index + 1}`);
    await writeFile(inspiration, `# Owned inspiration\n\n${originals.map((text, index) => `## Quote\n> ${text}\n\nAttribution: Fixture author${index === 1 ? '\nSource: [Fixture archive](https://example.test/archive)' : ''}\n`).join('\n')}`);
    state.quoteCandidate = JSON.stringify([{ text: originals[49], attribution: 'Fixture author' }, { text: 'A new fictional owned quote', attribution: 'Another fixture author' }]);
    const first = launch(state); await ready(first); await serviceGet(state, '/api/ground/prompts'); await serviceGet(state, '/api/ground/inspiration');
    const quote = await observeQuote(first, state);
    expect(state.sends.some(send => /\bquestions?\b/i.test(send.text))).toBe(true);
    expect(quote.text).toMatch(/attribution/i);
    expect(quote.text).toContain('A bounded fixture thought for question generation.');
    expect(quote.text).not.toMatch(/externally verified|verified source required/i);
    const created = state.creates.find(item => item.id === quote.sessionId);
    expect(created?.input).toMatchObject({ permissions: [{ action: '*', resource: '*', effect: 'deny' }],
      metadata: { memoryLoop: { owner: 'memory-loop', purpose: 'ground-generation' } } });
    expect(quote.before.issue).toBeUndefined();
    expect(quote.before.attempts).toEqual(expect.arrayContaining([expect.objectContaining({ job: 'quotes',
      scheduledAt: Date.parse('2032-04-12T00:00:00.000Z'), nativeSessionId: quote.sessionId, nativeMessageId: quote.id,
      inputSha256: createHash('sha256').update(quote.text).digest('hex'), dispatchAttempted: 1 })]));
    expect(await until(() => readFileSync(inspiration, 'utf8').includes('A new fictional owned quote'), 2000)).toBe(true);
    const published = await readFile(inspiration, 'utf8');
    const parsed = parseGroundCollection('inspiration', published);
    expect(parsed.state).toBe('ready');
    if (parsed.state !== 'ready') throw new Error('invalid published owned quote collection');
    expect(parsed.items.map(item => item.text)).toEqual([...originals.slice(1), 'A new fictional owned quote']);
    expect(parsed.items[0]).toMatchObject({ source: { title: 'Fixture archive', url: 'https://example.test/archive' } });
    expect(parsed.items.at(-1)).toMatchObject({ attribution: 'Another fixture author' });
    expect(parsed.items.at(-1)).not.toHaveProperty('source');
    expect(await until(() => probe(state.database).attempts.some(item => item.job === 'quotes' && item.occurrenceState === 'settled'), 2000)).toBe(true);
    const beforeRead = state.sends.length;
    const selected = await serviceGet(state, '/api/ground/inspiration');
    expect(selected.status).toBe(200);
    const body: unknown = JSON.parse(selected.body);
    expect(body).toMatchObject({ state: 'ready', data: { quote: { id: expect.any(String), text: expect.any(String), attribution: expect.any(String) } } });
    expect(state.sends).toHaveLength(beforeRead);
    await stop(first);
    const second = launch(state, false, now + 30000); await ready(second, false, now + 30000); await controls(state); await stop(second);
    expect(await readFile(inspiration, 'utf8')).toBe(published);
    expect(state.sends.filter(send => /\bquotes?\b/i.test(send.text))).toHaveLength(1);
    expect(state.creates.filter(item => item.id === quote.sessionId)).toHaveLength(1);
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('Ground weekly quote generation rejects a blank attribution without rewriting the source file', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 2 }, quotes: { schedule: '0 9 * * 6', count: 2 } };
    const state = await fixture(settings);
    const inspiration = join(state.vault, '03_Resources', 'Memory-Loop', 'inspiration.md');
    const original = '## Quote\n> Owned fictional legacy quote\n\nAttribution: Fixture author\nSource: [Fixture archive](https://example.test/archive)\n';
    await writeFile(inspiration, original); const before = await lstat(inspiration);
    state.quoteCandidate = JSON.stringify([{ text: 'A fictional invalid quote', attribution: '  ' }]);
    const owned = launch(state); await ready(owned); await serviceGet(state, '/api/ground/prompts'); await serviceGet(state, '/api/ground/inspiration'); await observeQuote(owned, state);
    expect(await until(() => probe(state.database).attempts.some(item => item.job === 'quotes' && item.occurrenceState === 'failed'), 2000)).toBe(true);
    expect(await readFile(inspiration, 'utf8')).toBe(original);
    expect((await lstat(inspiration)).ino).toBe(before.ino);
    expect(probe(state.database).attempts.find(item => item.job === 'quotes')?.occurrenceState).not.toBe('settled');
    expect(state.sends.some(send => /\bquestions?\b/i.test(send.text))).toBe(true);
    expect(owned.output + owned.errors).not.toContain('A fictional invalid quote');
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('Ground candidate pagination uses cursor-only continuation and publishes the completed answer', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 2 } };
    const state = await fixture(settings);
    state.candidate = JSON.stringify([{ text: 'Owned paginated question?' }]); state.paginated = true;
    const owned = launch(state); await ready(owned); await serviceGet(state, '/api/ground/prompts');
    expect(await until(() => questionSends(state).length === 1, 1500)).toBe(true);
    expect(await until(() => questionFacts(probe(state.database))[0]?.occurrenceState === 'admitted', 1500)).toBe(true);
    owned.child.stdin.write(`${JSON.stringify({ id: 'observe-pages', advanceMs: 30000 })}\n`);
    expect(await until(() => owned.output.includes('"id":"observe-pages"'))).toBe(true);
    const sessionId = questionSends(state)[0].sessionId;
    expect(await until(() => state.historyQueries.some(item => item.sessionId === sessionId && new URLSearchParams(item.query).has('cursor')), 1500), 'daemon must request the next native history page').toBe(true);
    const continuation = state.historyQueries.find(item => item.sessionId === sessionId && new URLSearchParams(item.query).has('cursor'));
    if (!continuation) throw new Error('fixture continuation missing');
    const query = new URLSearchParams(continuation.query);
    expect(query.get('cursor')).toBe('owned-page-two');
    expect(query.has('order'), 'native 2.2.2 rejects order alongside a cursor').toBe(false);
    expect(await until(() => readFileSync(state.prompts, 'utf8').includes('Owned paginated question?'), 2000)).toBe(true);
    expect(await until(() => questionFacts(probe(state.database))[0]?.occurrenceState === 'settled', 2000)).toBe(true);
    expect(questionCreates(state)).toHaveLength(1); expect(questionSends(state)).toHaveLength(1); expect(state.unexpected).toEqual([]);
  }, 20000);

  it('Ground candidate publication appends unique validated questions, retains the newest 50, and settles across restart', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 3 } };
    const state = await fixture(settings);
    const originals = Array.from({ length: 50 }, (_, index) => `Owned fixture question ${index + 1}?`);
    await writeFile(state.prompts, `# Owned questions\n\n${originals.map(text => `## Question\n${text}\n`).join('\n')}`);
    state.candidate = JSON.stringify([{ text: originals[49] }, { text: 'A new owned fixture question?' }]);
    const first = launch(state); await ready(first); await serviceGet(state, '/api/ground/prompts'); await observeCompletion(first, state);
    expect(await until(() => existsSync(state.prompts) && readFileSync(state.prompts, 'utf8').includes('A new owned fixture question?'), 2000),
      'validated candidate must be published to the actual owned resource').toBe(true);
    const published = await readFile(state.prompts, 'utf8');
    const parsed = parseGroundCollection('prompts', published);
    expect(parsed.state).toBe('ready');
    if (parsed.state !== 'ready') throw new Error('published prompts are not valid Ground questions');
    expect(parsed.items.map(item => item.text)).toEqual([...originals.slice(1), 'A new owned fixture question?']);
    expect(await until(() => questionFacts(probe(state.database))[0]?.occurrenceState === 'settled', 2000)).toBe(true);
    await stop(first);
    const second = launch(state, false, now + 30000); await ready(second, false, now + 30000);
    await controls(state);
    await stop(second);
    expect(await readFile(state.prompts, 'utf8')).toBe(published);
    expect(questionCreates(state)).toHaveLength(1); expect(questionSends(state)).toHaveLength(1);
    expect(questionFacts(probe(state.database))).toHaveLength(1);
    expect(questionFacts(probe(state.database))[0]).toMatchObject({ occurrenceState: 'settled' });
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('Ground candidate publication rejects extra fields without changing the existing resource or claiming settlement', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 2 } };
    const state = await fixture(settings);
    state.candidate = JSON.stringify([{ text: 'Private invalid fixture candidate?', extra: 'fixture-private-field' }]);
    const before = await lstat(state.prompts);
    const owned = launch(state); await ready(owned); await serviceGet(state, '/api/ground/prompts'); await observeCompletion(owned, state);
    expect(await until(() => questionFacts(probe(state.database))[0]?.occurrenceState === 'failed', 2000),
      'invalid completed native output must be recorded as a safe failed outcome').toBe(true);
    expect(await readFile(state.prompts, 'utf8')).toBe(promptsBefore);
    expect((await lstat(state.prompts)).ino).toBe(before.ino);
    expect(questionFacts(probe(state.database))[0]?.occurrenceState).not.toBe('settled');
    expect(questionCreates(state)).toHaveLength(1); expect(questionSends(state)).toHaveLength(1);
    expect(owned.output + owned.errors).not.toMatch(/Private invalid fixture candidate|fixture-private-field/);
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('Ground candidate publication settles a valid empty batch without creating a missing resource or prompting again', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 2 } };
    const state = await fixture(settings); await rm(state.prompts);
    state.candidate = '[]';
    const first = launch(state); await ready(first); await serviceGet(state, '/api/ground/prompts'); await observeCompletion(first, state);
    expect(await until(() => questionFacts(probe(state.database))[0]?.occurrenceState === 'settled', 2000),
      'valid empty candidate batch must settle without publishing a file').toBe(true);
    expect(existsSync(state.prompts)).toBe(false);
    await stop(first);
    const second = launch(state, false, now + 30000); await ready(second, false, now + 30000); await stop(second);
    expect(existsSync(state.prompts)).toBe(false);
    expect(questionCreates(state)).toHaveLength(1); expect(questionSends(state)).toHaveLength(1);
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('abandons an older undispatched attempt and admits the requested current period after restart', async () => {
    const settings = { ...generation, questions: { schedule: '0 10 * * *', count: 2 } };
    const state = await fixture(settings);
    const prepared = launch(state, true); await ready(prepared, true); await stop(prepared);
    const old = Date.parse('2032-04-16T10:00:00.000Z');
    const latest = Date.parse('2032-04-17T00:00:00.000Z');
    const occurrence = createHash('sha256').update(JSON.stringify(['questions', 'UTC', old])).digest('hex');
    const attempt = randomUUID(); const suffix = attempt.replaceAll('-', '');
    const db = new DatabaseSync(state.database);
    try {
      db.prepare(`INSERT INTO ground_generation_occurrences(occurrence_id, job_key, time_zone, scheduled_at, vault_directory, state)
        VALUES (?, 'questions', 'UTC', ?, ?, 'preparing')`).run(occurrence, old, state.vault);
      db.prepare(`INSERT INTO ground_generation_attempts(attempt_id, occurrence_id, native_session_id, native_message_id, input_sha256, question_count, requested_context_json)
        VALUES (?, ?, ?, ?, ?, 2, '{}')`).run(attempt, occurrence, `ses_memoryloop_generation_${suffix}`, `msg_memoryloop_generation_${suffix}`, 'b'.repeat(64));
    } finally { db.close(); }
    const owned = launch(state); await ready(owned); await serviceGet(state, '/api/ground/prompts');
    expect(await until(() => probe(state.database).attempts.some(item => item.attemptId === attempt && item.occurrenceState === 'failed'))).toBe(true);
    expect(state.sends.some(send => send.id === `msg_memoryloop_generation_${suffix}`)).toBe(false);
    expect(await until(() => questionSends(state).length === 1, 1500), 'new latest-due question must be admitted without waiting for tomorrow').toBe(true);
    await stop(owned);
    const facts = probe(state.database);
    expect(facts.issue).toBeUndefined();
    expect(questionFacts(facts)).toHaveLength(2);
    expect(questionFacts(facts)).toEqual(expect.arrayContaining([expect.objectContaining({ scheduledAt: old, occurrenceState: 'failed', dispatchAttempted: 0, attemptId: attempt }),
      expect.objectContaining({ scheduledAt: latest, dispatchAttempted: 1 })]));
    expect(questionCreates(state)).toHaveLength(1); expect(questionSends(state)).toHaveLength(1);
    expect(questionSends(state)[0].id).not.toBe(`msg_memoryloop_generation_${suffix}`);
    expect(state.unexpected).toEqual([]);
  }, 20000);

  it('persists admission facts on demand and never duplicates an uncertain prompt on a timer or fresh daemon', async () => {
    expect(parseGroundGenerationConfig({ generation }).state).toBe('ready');
    const state = await fixture(); const first = launch(state); await ready(first);
    await sleep(100);
    const beforeReads = { creates: questionCreates(state).length, sends: questionSends(state).length };
    await controls(state);
    await serviceGet(state, '/api/ground/prompts');
    expect(await until(() => questionSends(state).length === 1, 1500)).toBe(true);
    expect(state.unexpected).toEqual([]);
    expect(probe(state.database, false)).toMatchObject({ exists: true, integrity: 'ok', writerAvailable: true,
      thinkRows: { conversations: 0, commands: 0, transcripts: 0 } });
    expect(beforeReads.sends, 'startup must not submit without demand').toBe(0);
    expect(beforeReads.creates).toBe(0);
    const created = questionCreates(state)[0]; const sent = questionSends(state)[0];
    expect(created.input).toMatchObject({ id: created.id, location: { directory: state.vault }, model,
      metadata: { memoryLoop: { owner: 'memory-loop', purpose: 'ground-generation', installationId: created.before.installationId } },
      permissions: [{ action: '*', resource: '*', effect: 'deny' }] });
    for (const observed of [created.before, sent.before]) {
      expect(observed.issue).toBeUndefined(); expect(observed.writerAvailable).toBe(true); expect(questionFacts(observed)).toHaveLength(1);
      expect(questionFacts(observed)[0]).toMatchObject({ job: 'questions', timeZone: 'UTC', scheduledAt: due, nativeSessionId: created.id,
        nativeMessageId: sent.id, inputSha256: createHash('sha256').update(sent.text, 'utf8').digest('hex'),
        attemptId: expect.stringMatching(/\S/), occurrenceId: expect.stringMatching(/\S/) });
    }
    expect(sent.sessionId).toBe(created.id);
    expect(questionFacts(sent.before)[0].dispatchAttempted, 'attempt fact must commit BEFORE crossing the native prompt boundary').toBe(1);
    await tick(first);
    expect(questionCreates(state)).toHaveLength(1); expect(questionSends(state)).toHaveLength(1);
    await stop(first);
    expect(first.child.exitCode).toBe(0);
    const retained = probe(state.database); expect(retained.issue).toBeUndefined(); expect(questionFacts(retained)).toHaveLength(1);
    expect(questionFacts(retained)[0].occurrenceState).not.toBe('settled');
    const second = launch(state, false, now + 1000); await ready(second, false, now + 1000); await serviceGet(state, '/api/ground/prompts'); await tick(second, now + 1000); await controls(state);
    await stop(second);
    expect(second.child.exitCode).toBe(0);
    expect(state.unexpected).toEqual([]); expect(questionCreates(state)).toHaveLength(1); expect(questionSends(state)).toHaveLength(1);
    const restored = probe(state.database); expect(restored.issue).toBeUndefined(); expect(questionFacts(restored)).toEqual(questionFacts(retained));
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
