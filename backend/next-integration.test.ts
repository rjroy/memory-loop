import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ClientRequest, type Server } from 'node:http';
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

const root = resolve(import.meta.dirname, '..');
const next = join(root, 'node_modules/next/dist/bin/next');
const token = 'd'.repeat(64);
let fixture = '';
let upstream: Server;
let child: ChildProcessWithoutNullStreams;
let port: number;
let calls: Array<{ url: string | undefined; method: string | undefined; headers: IncomingHttpHeaders; body: string }> = [];
let output = '';
let watchMode: 'normal' | 'redirect' | 'malformed' | 'oversized' = 'normal';
let watchClosed = 0;
let snapshotEligibility: unknown;
let groundMalformed = false;
const groundId = 'a'.repeat(64);
const groundRevision = 'b'.repeat(64);
const groundBase = ['03_Resources', 'Memory-Loop'];
const groundResponses: Record<string, { projected: object; upstream: object }> = {
  '/api/ground/quick-actions': {
    projected: { state: 'ready', noteId: [...groundBase, 'quick-actions.md'], revision: groundRevision, data: { actions: [{ id: '@fixture', skill: '@fixture', description: 'Fixture action' }] } },
    upstream: { state: 'ready', noteId: [...groundBase, 'quick-actions.md'], revision: groundRevision, data: { actions: [{ id: '@fixture', skill: '@fixture', description: 'Fixture action', privateField: 'fixture-private-action' }], privateField: 'fixture-private-data' }, privateField: 'fixture-private-root' },
  },
  '/api/ground/inspiration': {
    projected: { state: 'ready', noteId: [...groundBase, 'inspiration.md'], revision: groundRevision, data: { quote: { id: groundId, text: 'Fictional fixture quote', attribution: 'Fixture author', source: { title: 'Fixture source', url: 'https://example.test/quote' } } } },
    upstream: { state: 'ready', noteId: [...groundBase, 'inspiration.md'], revision: groundRevision, data: { quote: { id: groundId, text: 'Fictional fixture quote', attribution: 'Fixture author', source: { title: 'Fixture source', url: 'https://example.test/quote', privateField: 'fixture-private-source' }, privateField: 'fixture-private-quote' } }, privateField: 'fixture-private-root' },
  },
  '/api/ground/prompts': {
    projected: { state: 'ready', noteId: [...groundBase, 'prompts.md'], revision: groundRevision, data: { question: { id: groundId, text: 'Fixture question' } } },
    upstream: { state: 'ready', noteId: [...groundBase, 'prompts.md'], revision: groundRevision, data: { question: { id: groundId, text: 'Fixture question', privateField: 'fixture-private-question' } }, privateField: 'fixture-private-root' },
  },
  '/api/ground/goals': {
    projected: { state: 'ready', noteId: [...groundBase, 'goals.md'], revision: groundRevision, data: { markdown: '# Fixture goal' } },
    upstream: { state: 'ready', noteId: [...groundBase, 'goals.md'], revision: groundRevision, data: { markdown: '# Fixture goal', privateField: 'fixture-private-data' }, privateField: 'fixture-private-root' },
  },
  '/api/ground/recent-captures': {
    projected: { state: 'ready', coverage: 'partial', items: [{ id: groundId, localDateTime: '2026-01-01T12:34', timeBasis: 'recorded-local', excerpt: 'Fixture capture\nsecond line', noteId: ['00_Inbox', '2026-01-01.md'] }] },
    upstream: { state: 'ready', coverage: 'partial', items: [{ id: groundId, localDateTime: '2026-01-01T12:34', timeBasis: 'recorded-local', excerpt: 'Fixture capture\nsecond line', noteId: ['00_Inbox', '2026-01-01.md'], privateField: 'fixture-private-capture' }], privateField: 'fixture-private-root' },
  },
};
const conversationId = '11111111-1111-4111-8111-111111111111';
const commandId = '22222222-2222-4222-8222-222222222222';
const epoch = '33333333-3333-4333-8333-333333333333';
const viewToken = 'c'.repeat(64);
const expiry = '2026-12-01T12:00:00.000Z';
const recentPath = '/api/ground/recent-conversations';
const resumePath = `/api/think/conversations/${conversationId}/resume`;
const deletePath = `/api/think/conversations/${conversationId}/delete`;
const commandPath = `/api/think/conversations/${conversationId}/commands/${commandId}`;
const selection = { selectionRevision: 1, conversationId, expiresAt: expiry };
const resumeReceipt = { kind: 'resume', conversationId, clientCommandId: commandId, epoch, state: 'ready' };
const recentItems = Array.from({ length: 10 }, (_, index) => ({
  conversationId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
  title: index === 0 ? null : `Fixture conversation ${index}`, lastActivityAt: '2026-11-01T12:00:00.000Z',
  state: 'ready', resume: { available: true }, delete: { available: false, ...(index === 0 ? { reason: 'current' } : {}) },
  ...(index === 1 ? { transcriptNoteId: ['Conversations', 'Memory Loop', 'fixture.md'] } : {}),
}));
let conversationFixture = false;
let conversationOverride: { status: number; body: object } | undefined;
let dropDelete = false;
const watchPath = `/api/think/conversations/${conversationId}/events`;
const bodyRef = { key: { conversationId, owner: { kind: 'original', clientCommandId: commandId, messageId: 'msg_fixture_owned' } },
  epoch, contentId: '44444444-4444-4444-8444-444444444444', generation: '55555555-5555-4555-8555-555555555555', through: 123, kind: 'canonical', sha256: 'a'.repeat(64) };
const watchSnapshot = { conversationId, epoch, revision: 1, creation: 'ready', sendEligibility: 'available', contentHealth: 'complete',
  entries: [{ kind: 'original', displayOrder: 0, clientCommandId: commandId, messageId: 'msg_fixture_owned', body: bodyRef, nativeDebug: 'fixture-private-entry' }],
  nativeDebug: 'fixture-private-snapshot' };
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: '', NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production' };

function listen(server: Server): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePort((server.address() as AddressInfo).port));
  });
}
function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
}
function request(path: string, headers: Record<string, string> = {}, targetPort = port, method = 'GET', requestBody?: string) {
  return new Promise<{ status: number | undefined; headers: IncomingHttpHeaders; body: string }>((resolveRequest, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: targetPort, path, headers, method }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolveRequest({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(requestBody);
  });
}
function watchRequest(headers: Record<string, string> = {}): Promise<{ req: ClientRequest; res: IncomingMessage }> {
  return new Promise((resolveWatch, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path: watchPath, headers }, res => resolveWatch({ req, res }));
    req.setTimeout(8000, () => req.destroy(new Error('fixture watch connection timeout')));
    req.on('error', reject);
    req.end();
  });
}

function watchFrames(res: IncomingMessage) {
  const iterator = res[Symbol.asyncIterator]();
  let buffer = '';
  async function nextChunk(timeoutMs: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([iterator.next(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('fixture watch timeout')), timeoutMs); })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  return {
    async frame(timeoutMs = 3000) {
      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (boundary && boundary.index !== undefined) {
          const raw = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary[0].length);
          if (!raw.includes('data:')) continue;
          expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64 * 1024);
          const type = /^event:\s*(.+)$/m.exec(raw)?.[1];
          const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          const value: unknown = JSON.parse(data);
          return { type, value, raw };
        }
        const chunk = await nextChunk(timeoutMs);
        if (chunk.done) throw new Error('fixture watch ended before frame');
        buffer += Buffer.from(chunk.value).toString('utf8');
        if (Buffer.byteLength(buffer) > 64 * 1024 + 4096) throw new Error('fixture watch frame exceeded bound');
      }
    },
    async remaining() {
      let text = buffer;
      for (;;) {
        let chunk: IteratorResult<unknown>;
        try { chunk = await nextChunk(3000); }
        catch (error: unknown) {
          if (error instanceof Error && (error.message === 'aborted' || ('code' in error && (error.code === 'ECONNRESET' || error.code === 'ERR_STREAM_PREMATURE_CLOSE')))) return text;
          throw error;
        }
        if (chunk.done) return text;
        if (!(chunk.value instanceof Uint8Array) && typeof chunk.value !== 'string') throw new Error('invalid fixture stream chunk');
        text += Buffer.from(chunk.value).toString('utf8');
        if (Buffer.byteLength(text) > 128 * 1024) throw new Error('fixture watch forwarded too much');
      }
    },
  };
}
async function ready() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next exited before ready: ${output}`);
    try { await request('/'); return; } catch { await new Promise(resolveWait => setTimeout(resolveWait, 30)); }
  }
  throw new Error('Next did not become ready');
}

async function ownedNodeNext(rootPid: number) {
  const runnerExecutable = await realpath(process.execPath);
  let pathNode: string | undefined;
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    try {
      const candidate = resolve(fixture, directory || '.', 'node');
      await access(candidate, constants.X_OK);
      pathNode = await realpath(candidate);
      break;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOTDIR'))) throw error;
    }
  }
  if (!pathNode) throw new Error('Fixture PATH has no executable node');
  const result = { owned: false, descendantObserved: false, executableMatched: false, nextCommandMatched: false,
    vanishedProc: false, pathNodeFound: true, pathNodeMatchesRunner: pathNode === runnerExecutable,
    runnerIsBun: typeof process.versions.bun === 'string', traversalTruncated: false };
  const pending = [rootPid];
  let visited = 0;
  while (pending.length && visited < 256) {
    const pid = pending.pop();
    if (pid === undefined) break;
    visited++;
    if (pid !== rootPid) result.descendantObserved = true;
    try {
      const [executable, args, children] = await Promise.all([
        realpath(`/proc/${pid}/exe`),
        readFile(`/proc/${pid}/cmdline`, 'utf8'),
        readFile(`/proc/${pid}/task/${pid}/children`, 'utf8'),
      ]);
      const executableMatched = executable === pathNode;
      const nextCommandMatched = /next-server|next\/dist\/bin\/next/.test(args);
      result.executableMatched ||= executableMatched;
      result.nextCommandMatched ||= nextCommandMatched;
      result.owned ||= executableMatched && nextCommandMatched;
      for (const child of children.trim().split(/\s+/)) if (/^\d+$/.test(child)) pending.push(Number(child));
    } catch (error: unknown) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
      result.vanishedProc = true;
    }
  }
  result.traversalTruncated = pending.length > 0;
  return result;
}

describe('production Next HTTP boundary', () => {
  beforeAll(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'recall-next-test-'));
    const project = join(fixture, 'project');
    await mkdir(project);
    await cp(join(root, 'src'), join(project, 'src'), { recursive: true });
    await cp(join(root, 'backend'), join(project, 'backend'), { recursive: true });
    await cp(join(root, 'public'), join(project, 'public'), { recursive: true });
    await cp(join(root, 'package.json'), join(project, 'package.json'));
    await cp(join(root, 'tsconfig.json'), join(project, 'tsconfig.json'));
    await cp(join(root, 'next.config.ts'), join(project, 'next.config.ts'));
    await cp(join(root, 'bunfig.toml'), join(project, 'bunfig.toml'));
    await symlink(join(root, 'node_modules'), join(project, 'node_modules'), 'dir');
    const build = spawnSync(process.execPath, [next, 'build', project, '--webpack'], { cwd: fixture, env: { ...env, HOME: fixture }, encoding: 'utf8', timeout: 120_000 });
    if (build.status !== 0) throw new Error(`Fixture Next build failed: ${build.stdout}\n${build.stderr}`);
    upstream = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        calls.push({ url: req.url, method: req.method, headers: req.headers, body });
        if (conversationFixture && (req.url === recentPath || req.url === '/api/think/views' || req.url === '/api/think/selection' || req.url === resumePath || req.url === deletePath || req.url === commandPath)) {
          if (req.url === deletePath && dropDelete) { res.destroy(); return; }
          if (!conversationOverride && req.url === '/api/think/selection' && req.method === 'GET' && !/^[a-f0-9]{64}$/.test(String(req.headers['x-memory-loop-view'] ?? ''))) {
            res.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'lease_unavailable', message: 'View is unavailable' } }));
            return;
          }
          if (!conversationOverride && req.method === 'POST' && (req.url === '/api/think/views' || req.url === '/api/think/selection')) {
            let input: unknown;
            try { input = JSON.parse(body); } catch { input = null; }
            const object = typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : null;
            const valid = object && (req.url === '/api/think/views' ? Object.keys(object).length === 0 :
              Object.keys(object).length === 3 && typeof object.viewToken === 'string' && /^[a-f0-9]{64}$/.test(object.viewToken) &&
              typeof object.expectedRevision === 'number' && Number.isSafeInteger(object.expectedRevision) && object.expectedRevision >= 0 &&
              (object.conversationId === null || object.conversationId === conversationId));
            if (!valid) {
              res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'invalid_request', message: 'Invalid Think request' } }));
              return;
            }
          }
          const status = req.url === '/api/think/views' ? 201 : req.url === resumePath ? 202 : 200;
          const value = req.url === recentPath ? { state: 'ready', items: recentItems.map(item => ({ ...item, tokenHash: 'fixture-private-hash', resume: { ...item.resume, nativeDebug: 'fixture-private' } })), viewToken, nativeDebug: 'fixture-private' }
            : req.url === '/api/think/views' ? { viewToken, selectionRevision: 0, conversationId: null, expiresAt: expiry, tokenHash: 'fixture-private-hash' }
            : req.url === '/api/think/selection' ? { ...selection, viewToken, tokenHash: 'fixture-private-hash' }
            : { ...resumeReceipt, nativeDebug: 'fixture-private' };
          res.writeHead(conversationOverride?.status ?? status, { 'content-type': 'application/json', 'set-cookie': 'fixture=private' });
          res.end(JSON.stringify(conversationOverride?.body ?? value));
          return;
        }
        if (req.url === '/api/capture' && body === JSON.stringify({ text: 'origin fixture capture' })) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
          return;
        }
        if (req.url && Object.hasOwn(groundResponses, req.url)) {
          res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'fixture=private' });
          res.end(JSON.stringify(groundMalformed ? { state: 'ready', noteId: ['..', 'fixture-private'], revision: 'bad', data: { markdown: 'fixture-private' } } : groundResponses[req.url].upstream));
          return;
        }
        if (req.url?.startsWith('/api/think/conversations')) {
          if (req.url.startsWith(`/api/think/conversations/${conversationId}/content/`)) {
            res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'fixture=private' });
            res.end(JSON.stringify({ conversationId, epoch, contentId: bodyRef.contentId, generation: bodyRef.generation,
              through: bodyRef.through, offset: 0, bytes: Buffer.from('fixture').toString('base64'), nextOffset: 7,
              transfer: '66666666-6666-4666-8666-666666666666', nativeDebug: 'fixture-private-chunk' }));
            return;
          }
          if (req.url === watchPath) {
            const mode = watchMode;
            if (mode === 'redirect') { res.writeHead(302, { location: 'http://fixture-private.invalid/secret' }).end(); return; }
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'set-cookie': 'fixture=private' });
            res.write(`event: snapshot\ndata: ${JSON.stringify(watchSnapshot)}\n\n`);
            const timer = setTimeout(() => {
              if (mode === 'normal') {
                res.write('event: heartbeat\ndata: {}\n\n');
                res.write(`event: revision\ndata: ${JSON.stringify({ conversationId, epoch, revision: 2, creation: 'ready', sendEligibility: 'busy', nativeDebug: 'fixture-private-update' })}\n\n`);
              } else if (mode === 'malformed') res.end('event: revision\ndata: {"fixture-private-invalid":\n\n');
              else res.end(`event: revision\ndata: ${'fixture-private-oversized'.repeat(4000)}\n\n`);
            }, mode === 'normal' ? 5500 : 10);
            res.once('close', () => { clearTimeout(timer); watchClosed++; });
            return;
          }
          if (body.includes('44444444-4444-4444-8444-444444444444')) { res.destroy(); return; }
          const clientCommandId = commandId;
          const receipt = { kind: 'create', conversationId, clientCommandId, epoch, state: 'registered' };
          const state = snapshotEligibility === undefined ? watchSnapshot : { ...watchSnapshot, sendEligibility: snapshotEligibility };
          res.writeHead(req.method === 'POST' ? 202 : 200, { 'content-type': 'application/json', 'set-cookie': 'fixture=private' });
          res.end(JSON.stringify(req.url.includes('/commands/') || req.method === 'POST' ? receipt : state));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'fixture=private' });
        res.end(JSON.stringify(req.url?.startsWith('/api/vault/note') ? { name: 'fixture.md', markdown: '# fixture' } : { entries: [] }));
      });
    });
    const upstreamPort = await listen(upstream);
    const reservation = createServer();
    port = await listen(reservation);
    await close(reservation);
    const metadata = join(fixture, 'metadata');
    await mkdir(metadata, { mode: 0o700 });
    await writeFile(join(metadata, 'service.token'), token, { mode: 0o600 });
    await writeFile(join(metadata, 'transport.json'), JSON.stringify({ daemonOrigin: `http://127.0.0.1:${upstreamPort}`, web: { mode: 'loopback', origin: `http://127.0.0.1:${port}` } }), { mode: 0o600 });
    child = spawn(process.execPath, [next, 'start', project, '--hostname', '127.0.0.1', '--port', String(port)], { cwd: fixture, env: { ...env, HOME: fixture, MEMORY_LOOP_TRANSPORT_FILE: join(metadata, 'transport.json') }, stdio: 'pipe' });
    child.stdout.on('data', data => { output += String(data); });
    child.stderr.on('data', data => { output += String(data); });
    await ready();
  }, 150_000);
  afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>(resolveExit => child.once('exit', () => resolveExit()));
      child.kill('SIGTERM');
      await exited;
    }
    if (upstream?.listening) await close(upstream);
    if (fixture) await rm(fixture, { recursive: true, force: true });
  });
  it('launcher accepts an independent OS-assigned listening port despite the obsolete web origin', async () => {
    const reservation = createServer();
    const alternate = await listen(reservation);
    await close(reservation);
    const launcher = spawn('bun', ['--no-env-file', join(fixture, 'project/src/web/start.ts'), 'start', '--hostname', '127.0.0.1', '--port', String(alternate)], {
      cwd: fixture, env: { ...env, HOME: fixture, MEMORY_LOOP_TRANSPORT_FILE: join(fixture, 'metadata/transport.json') }, stdio: 'pipe',
    });
    let logs = '';
    launcher.stdout.on('data', data => { logs += String(data); });
    launcher.stderr.on('data', data => { logs += String(data); });
    try {
      const deadline = Date.now() + 15_000;
      let status: number | undefined;
      while (Date.now() < deadline && launcher.exitCode === null && launcher.signalCode === null) {
        try { status = (await request('/ground', {}, alternate)).status; break; }
        catch { await new Promise(resolveWait => setTimeout(resolveWait, 30)); }
      }
      expect(status, `launcher did not listen: ${logs}`).toBe(200);
    } finally {
      if (launcher.exitCode === null && launcher.signalCode === null) {
        const exited = new Promise<void>(resolveExit => launcher.once('exit', () => resolveExit()));
        launcher.kill('SIGTERM');
        await exited;
      }
    }
  }, 20_000);
  it('serves Ground, Recall, Capture and Think under an arbitrary proxy-shaped browser authority', async () => {
    calls = [];
    const host = 'browser.fixture.test:8719';
    const headers = { host, origin: `https://${host}`, 'sec-fetch-site': 'same-origin', authorization: 'Bearer browser-secret', cookie: 'session=fixture', 'x-forwarded-host': 'hostile.fixture' };
    const capture = JSON.stringify({ text: 'origin fixture capture' });
    const cases = [
      { path: '/api/ground/prompts', method: 'GET', body: undefined, status: 200 },
      { path: '/api/vault/tree', method: 'GET', body: undefined, status: 200 },
      { path: '/api/capture', method: 'POST', body: capture, status: 200 },
      { path: `/api/think/conversations/${conversationId}`, method: 'GET', body: undefined, status: 200 },
    ];
    for (const item of cases) {
      const response = await request(item.path, { ...headers, ...(item.body ? { 'content-type': 'application/json' } : {}) }, port, item.method, item.body);
      expect(response.status, item.path).toBe(item.status);
      expect(JSON.parse(response.body)).toBeTypeOf('object');
    }
    expect(calls).toHaveLength(cases.length);
    for (const call of calls) {
      expect(call.headers.authorization).toBe(`Bearer ${token}`);
      for (const key of ['cookie', 'origin', 'sec-fetch-site', 'x-forwarded-host']) expect(call.headers[key]).toBeUndefined();
    }
  });
  it('relays tree with server-only authorization and projects safe headers', async () => {
    calls = [];
    const response = await request('/api/vault/tree', { origin: `http://127.0.0.1:${port}`, authorization: 'Bearer browser-secret', cookie: 'session=fixture' });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ entries: [] });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
    expect(calls[0].headers.cookie).toBeUndefined();
    expect(response.body + JSON.stringify(response.headers) + output).not.toContain(token);
  });

  it.each(Object.entries(groundResponses))('Ground BFF forwards and projects %s', async (path, fixtureData) => {
    calls = [];
    const response = await request(path, { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', authorization: 'Bearer browser-secret', cookie: 'session=fixture', 'x-forwarded-host': 'fixture-hostile' });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual(fixtureData.projected);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body + JSON.stringify(response.headers) + output).not.toMatch(/fixture-private|browser-secret|session=fixture/);
    expect(response.body + JSON.stringify(response.headers) + output).not.toContain(token);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', url: path, body: '' });
    expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
    expect(calls[0].headers.cookie).toBeUndefined();
    expect(calls[0].headers.origin).toBeUndefined();
    expect(calls[0].headers['sec-fetch-site']).toBeUndefined();
    expect(calls[0].headers['x-forwarded-host']).toBeUndefined();
  });
  it.each<Record<string, string>>([{ host: 'hostile.example', origin: 'http://fixture.example:7319' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }])('Ground BFF rejects web policy violations without dispatch %o', async headers => {
    calls = [];
    const response = await request('/api/ground/goals', headers);
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('Ground BFF rejects malformed upstream data without disclosing it', async () => {
    calls = [];
    groundMalformed = true;
    try {
      const response = await request('/api/ground/goals');
      expect(response.status).toBe(503);
      expect(response.body + JSON.stringify(response.headers)).not.toContain('fixture-private');
      expect(calls).toHaveLength(1);
    } finally { groundMalformed = false; }
  });
  describe('Ground conversation BFF', () => {
    beforeAll(() => { conversationFixture = true; });
    afterAll(() => { conversationFixture = false; conversationOverride = undefined; });

    it.each([
      { name: 'recent list', path: recentPath, method: 'GET', status: 200, body: undefined, expected: { state: 'ready', items: recentItems }, header: viewToken },
      { name: 'recent list without view', path: recentPath, method: 'GET', status: 200, body: undefined, expected: { state: 'ready', items: recentItems } },
      { name: 'mint view', path: '/api/think/views', method: 'POST', status: 201, body: {}, expected: { viewToken, selectionRevision: 0, conversationId: null, expiresAt: expiry } },
      { name: 'read selection', path: '/api/think/selection', method: 'GET', status: 200, body: undefined, expected: selection, header: viewToken },
      { name: 'select conversation', path: '/api/think/selection', method: 'POST', status: 200, body: { viewToken, expectedRevision: 0, conversationId }, expected: selection },
      { name: 'resume', path: resumePath, method: 'POST', status: 202, body: { clientCommandId: commandId }, expected: resumeReceipt },
      { name: 'lookup resume receipt', path: commandPath, method: 'GET', status: 200, body: undefined, expected: resumeReceipt },
    ])('forwards and safely projects $name', async ({ path, method, status, body, expected, header }) => {
      calls = [];
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const response = await request(path, { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
        authorization: 'Basic browser-secret', cookie: 'session=fixture', 'x-forwarded-host': 'fixture-hostile',
        ...(header ? { 'x-memory-loop-view': header } : {}), ...(payload ? { 'content-type': 'application/json' } : {}) }, port, method, payload);
      expect(response.status).toBe(status);
      expect(JSON.parse(response.body)).toEqual(expected);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.body + JSON.stringify(response.headers) + output).not.toMatch(/fixture-private|browser-secret|session=fixture/);
      expect(response.body + JSON.stringify(response.headers) + output).not.toContain(token);
      if (path !== '/api/think/views') expect(response.body).not.toContain(viewToken);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ url: path, method, body: payload ?? '' });
      expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
      for (const key of ['cookie', 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'x-forwarded-host']) expect(calls[0].headers[key]).toBeUndefined();
      expect(calls[0].headers['x-memory-loop-view']).toBe(header);
    });

    it.each([
      { path: recentPath, method: 'GET', body: undefined },
      { path: '/api/think/views', method: 'POST', body: '{}' },
      { path: '/api/think/selection', method: 'GET', body: undefined },
      { path: '/api/think/selection', method: 'POST', body: JSON.stringify({ viewToken, expectedRevision: 0, conversationId }) },
      { path: resumePath, method: 'POST', body: JSON.stringify({ clientCommandId: commandId }) },
    ])('denies hostile origin before dispatch for $method $path', async ({ path, method, body }) => {
      calls = [];
      const response = await request(path, { origin: 'https://hostile.invalid', 'x-memory-loop-view': viewToken, 'content-type': 'application/json' }, port, method, body);
      expect(response.status).toBe(403);
      expect(calls).toHaveLength(0);
    });

    it.each([
      { name: 'caller-chosen token', path: '/api/think/views', method: 'POST', body: { viewToken }, status: 400 },
      { name: 'invalid revision', path: '/api/think/selection', method: 'POST', body: { viewToken, expectedRevision: -1, conversationId }, status: 400 },
      { name: 'invalid selection token', path: '/api/think/selection', method: 'POST', body: { viewToken: 'bad', expectedRevision: 0, conversationId }, status: 400 },
      { name: 'missing read token', path: '/api/think/selection', method: 'GET', body: undefined, status: 403 },
    ])('rejects $name', async ({ path, method, body, status }) => {
      calls = [];
      const response = await request(path, body ? { 'content-type': 'application/json' } : {}, port, method, body ? JSON.stringify(body) : undefined);
      expect(response.status).toBe(status);
      expect(response.body).not.toContain(viewToken);
    });

    it.each([
      { name: 'invalid expiry', path: '/api/think/selection', method: 'GET', upstream: { ...selection, expiresAt: 'not-a-date', private: 'fixture-private' }, status: 200 },
      { name: 'wrong status', path: '/api/think/views', method: 'POST', upstream: { viewToken, selectionRevision: 0, conversationId: null, expiresAt: expiry, private: 'fixture-private' }, status: 200 },
      { name: 'eleven rows', path: recentPath, method: 'GET', upstream: { state: 'ready', items: [...recentItems, recentItems[0]], private: 'fixture-private' }, status: 200 },
      { name: 'mismatched resume target', path: resumePath, method: 'POST', upstream: { ...resumeReceipt, conversationId: commandId, private: 'fixture-private' }, status: 202 },
    ])('sanitizes $name from upstream', async ({ path, method, upstream: value, status }) => {
      calls = [];
      conversationOverride = { status, body: value };
      try {
        const body = path === resumePath ? JSON.stringify({ clientCommandId: commandId }) : method === 'POST' ? '{}' : undefined;
        const response = await request(path, { 'x-memory-loop-view': viewToken, ...(body ? { 'content-type': 'application/json' } : {}) }, port, method, body);
        expect(response.status).toBe(503);
        expect(response.body + JSON.stringify(response.headers)).not.toMatch(/fixture-private|cccccccc/);
        expect(calls).toHaveLength(1);
      } finally { conversationOverride = undefined; }
    });

    it.each([
      { name: 'stale selection', status: 409, code: 'selection_conflict', method: 'POST', body: JSON.stringify({ viewToken, expectedRevision: 0, conversationId }) },
      { name: 'unknown lease', status: 403, code: 'lease_unavailable', method: 'GET', body: undefined },
    ])('preserves controlled $name without upstream details', async ({ status, code, method, body }) => {
      calls = [];
      conversationOverride = { status, body: { error: { code, message: 'fixture-private', tokenHash: 'fixture-private' } } };
      try {
        const response = await request('/api/think/selection', { 'x-memory-loop-view': viewToken, ...(body ? { 'content-type': 'application/json' } : {}) }, port, method, body);
        expect(response.status).toBe(status);
        expect(JSON.parse(response.body)).toMatchObject({ error: { code } });
        expect(response.body).not.toMatch(/fixture-private|cccccccc/);
        expect(calls).toHaveLength(1);
      } finally { conversationOverride = undefined; }
    });

    it.each([
      { path: `${recentPath}?unknown=1`, status: 400 },
      { path: '/api/think/selection?viewToken=cccc', status: 404 },
    ])('rejects query on fixed target $path without dispatch', async ({ path, status }) => {
      calls = [];
      const response = await request(path, { 'x-memory-loop-view': viewToken });
      expect(response.status).toBe(status);
      expect(calls).toHaveLength(0);
    });
    it('does not forward view tokens to unrelated Ground or Think reads', async () => {
      calls = [];
      for (const path of ['/api/ground/goals', `/api/think/conversations/${conversationId}`]) {
        expect((await request(path, { 'x-memory-loop-view': viewToken })).status).toBe(200);
      }
      expect(calls).toHaveLength(2);
      for (const call of calls) expect(call.headers['x-memory-loop-view']).toBeUndefined();
    });
    it.each([
      { path: '/api/think/selection', status: 405 },
      { path: '/api/think/selection?unknown=1', status: 404 },
    ])('applies fixed-target classification for wrong method $path', async ({ path, status }) => {
      calls = [];
      const response = await request(path, {}, port, 'PUT');
      expect(response.status).toBe(status);
      expect(calls).toHaveLength(0);
    });
  });

  describe('Ground delete BFF', () => {
    const payload = JSON.stringify({ clientCommandId: commandId, viewToken });
    const receipt = { kind: 'delete', conversationId, clientCommandId: commandId, epoch, state: 'pending', reason: 'status_unknown' };
    beforeAll(() => { conversationFixture = true; });
    afterAll(() => { conversationFixture = false; conversationOverride = undefined; dropDelete = false; });

    it('forwards one delete with service credentials and projects each receipt state', async () => {
      try {
        for (const state of ['accepted', 'pending', 'completed'] as const) {
          calls = [];
          const expected = { kind: 'delete', conversationId, clientCommandId: commandId, epoch, state, ...(state === 'pending' ? { reason: 'io_unavailable' } : {}) };
          conversationOverride = { status: 202, body: { ...expected, viewToken, private: 'fixture-private' } };
          const response = await request(deletePath, { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`,
            'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', authorization: 'Basic browser-secret', cookie: 'session=fixture', 'x-memory-loop-view': viewToken }, port, 'POST', payload);
          expect(response.status).toBe(202);
          expect(JSON.parse(response.body)).toEqual(expected);
          expect(response.headers['cache-control']).toBe('no-store');
          expect(response.headers['set-cookie']).toBeUndefined();
          expect(response.body + JSON.stringify(response.headers) + output).not.toMatch(/fixture-private|browser-secret|session=fixture/);
          expect(response.body + JSON.stringify(response.headers) + output).not.toContain(viewToken);
          expect(calls).toHaveLength(1);
          expect(calls[0]).toMatchObject({ url: deletePath, method: 'POST', body: payload });
          expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
          for (const key of ['cookie', 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'x-memory-loop-view']) expect(calls[0].headers[key]).toBeUndefined();
        }
      } finally { conversationOverride = undefined; }
    });

    it('reconciles a delete receipt on the existing command GET without private fields', async () => {
      calls = [];
      conversationOverride = { status: 200, body: { ...receipt, viewToken, private: 'fixture-private' } };
      try {
        const response = await request(commandPath, { 'x-memory-loop-view': viewToken });
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual(receipt);
        expect(response.body).not.toMatch(/fixture-private|cccccccc/);
        expect(calls).toHaveLength(1);
        expect(calls[0].headers['x-memory-loop-view']).toBeUndefined();
      } finally { conversationOverride = undefined; }
    });

    it('preserves controlled lease, selection and deletion refusals without private details', async () => {
      try {
        for (const { status, code, reason } of [
          { status: 403, code: 'lease_unavailable' },
          { status: 409, code: 'selection_conflict' },
          { status: 409, code: 'delete_blocked', reason: 'status_unknown' },
        ]) {
          calls = [];
          conversationOverride = { status, body: { error: { code, ...(reason ? { reason } : {}), message: 'fixture-private', viewToken } } };
          const response = await request(deletePath, { 'content-type': 'application/json' }, port, 'POST', payload);
          expect(response.status).toBe(status);
          expect(JSON.parse(response.body)).toMatchObject({ error: { code, ...(reason ? { reason } : {}) } });
          expect(response.body).not.toMatch(/fixture-private|cccccccc/);
          expect(calls).toHaveLength(1);
        }
      } finally { conversationOverride = undefined; }
    });

    it('rejects hostile policy, invalid methods, paths, queries and bodies before dispatch', async () => {
      const cases: Array<{ path: string; method: string; body?: string; headers?: Record<string, string>; status: number }> = [
        { path: deletePath, method: 'POST', body: payload, headers: { origin: 'https://hostile.invalid' }, status: 403 },
        { path: deletePath, method: 'POST', body: payload, headers: { host: 'hostile.invalid', origin: 'https://fixture.example:7319', 'x-forwarded-host': 'fixture.example:7319' }, status: 403 },
        { path: deletePath, method: 'POST', body: payload, headers: { 'sec-fetch-site': 'cross-site' }, status: 403 },
        { path: deletePath, method: 'GET', status: 405 },
        { path: `${deletePath}?unknown=1`, method: 'POST', body: payload, status: 404 },
        { path: '/api/think/conversations/not-a-uuid/delete', method: 'POST', body: payload, status: 404 },
        { path: deletePath, method: 'POST', body: JSON.stringify({ clientCommandId: commandId, viewToken: 'bad' }), status: 400 },
        { path: deletePath, method: 'POST', body: JSON.stringify({ clientCommandId: commandId, viewToken, extra: true }), status: 400 },
      ];
      for (const item of cases) {
        calls = [];
        const response = await request(item.path, { 'content-type': 'application/json', ...item.headers }, port, item.method, item.body);
        expect(response.status, `${item.method} ${item.path} headers=${JSON.stringify(item.headers ?? {})}`).toBe(item.status);
        expect(calls).toHaveLength(0);
      }
    });

    it('does not retry an ambiguous upstream disconnect', async () => {
      calls = [];
      dropDelete = true;
      try {
        const response = await request(deletePath, { 'content-type': 'application/json' }, port, 'POST', payload);
        expect(response.status).toBe(503);
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toBe(payload);
        expect(response.body).not.toContain(viewToken);
      } finally { dropDelete = false; }
    });

    it('projects available and safely blocked delete capabilities on recent rows', async () => {
      calls = [];
      const items = [ { ...recentItems[0], delete: { available: true } }, { ...recentItems[1], delete: { available: false, reason: 'status_unknown' } } ];
      conversationOverride = { status: 200, body: { state: 'ready', items: items.map(item => ({ ...item, delete: { ...item.delete, private: 'fixture-private' } })), viewToken, private: 'fixture-private' } };
      try {
        const response = await request(recentPath, { 'x-memory-loop-view': viewToken });
        expect(response.status).toBe(200);
        expect(JSON.parse(response.body)).toEqual({ state: 'ready', items });
        expect(response.body).not.toMatch(/fixture-private|cccccccc/);
        expect(calls).toHaveLength(1);
      } finally { conversationOverride = undefined; }
    });

    it('sanitizes mismatched delete receipts and invalid refusal reasons', async () => {
      try {
        for (const override of [
          { status: 202, body: { ...receipt, conversationId: commandId, private: 'fixture-private' } },
          { status: 202, body: { ...receipt, clientCommandId: conversationId, private: 'fixture-private' } },
          { status: 409, body: { error: { code: 'delete_blocked', reason: 'fixture-private', message: 'fixture-private' } } },
          { status: 200, body: { ...receipt, private: 'fixture-private' } },
        ]) {
          calls = [];
          conversationOverride = override;
          const response = await request(deletePath, { 'content-type': 'application/json' }, port, 'POST', payload);
          expect(response.status).toBe(503);
          expect(response.body).not.toMatch(/fixture-private|cccccccc/);
          expect(calls).toHaveLength(1);
        }
      } finally { conversationOverride = undefined; }
    });
  });

  it('projects only validated authoritative Send eligibility on the real Next snapshot boundary', async () => {
    try {
      for (const eligibility of ['available', 'busy', 'unavailable'] as const) {
        snapshotEligibility = eligibility;
        const response = await request(`/api/think/conversations/${conversationId}`);
        expect(response.status).toBe(200);
        const value: unknown = JSON.parse(response.body);
        expect(value).toMatchObject({ conversationId, epoch, sendEligibility: eligibility });
        expect(response.body).not.toContain('fixture-private-snapshot');
      }
      snapshotEligibility = { state: 'available', nativeDebug: 'fixture-private-eligibility' };
      const malformed = await request(`/api/think/conversations/${conversationId}`);
      expect(malformed.body).not.toContain('fixture-private-eligibility');
      if (malformed.status === 200) expect(JSON.parse(malformed.body)).not.toHaveProperty('sendEligibility');
      else expect(malformed.status).toBeGreaterThanOrEqual(400);
    } finally { snapshotEligibility = undefined; }
  });
  it('forwards fixed Think create, state and receipt routes with fresh daemon credentials', async () => {
    calls = [];
    const conversationId = '11111111-1111-4111-8111-111111111111';
    const clientCommandId = '22222222-2222-4222-8222-222222222222';
    const base = `/api/think/conversations/${conversationId}`;
    const body = JSON.stringify({ conversationId, clientCommandId });
    const create = await request('/api/think/conversations', { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', authorization: 'Bearer browser-secret', cookie: 'session=fixture' }, port, 'POST', body);
    expect(create.status).toBe(202);
    expect(JSON.parse(create.body)).toMatchObject({ kind: 'create', conversationId, clientCommandId, state: 'registered' });
    expect(create.headers['set-cookie']).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: '/api/think/conversations', method: 'POST', body });
    expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
    expect(calls[0].headers.cookie).toBeUndefined();
    const state = await request(base);
    expect(state.status).toBe(200);
    expect(JSON.parse(state.body)).toMatchObject({ conversationId, creation: 'ready', sendEligibility: 'available' });
    const receipt = await request(`${base}/commands/${clientCommandId}`);
    expect(receipt.status).toBe(200);
    expect(JSON.parse(receipt.body)).toMatchObject({ kind: 'create', conversationId, clientCommandId });
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ['POST', '/api/think/conversations'], ['GET', base], ['GET', `${base}/commands/${clientCommandId}`],
    ]);
    expect(create.body + state.body + receipt.body + output).not.toContain(token);
  });
  it.each<Record<string, string>>([{ host: 'hostile.example', origin: 'http://fixture.example:7319', 'x-forwarded-host': 'fixture.example:7319' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }])('rejects Think command policy violations before forwarding %o', async headers => {
    calls = [];
    const response = await request('/api/think/conversations', { ...headers, 'content-type': 'application/json' }, port, 'POST', JSON.stringify({ conversationId: '11111111-1111-4111-8111-111111111111', clientCommandId: '22222222-2222-4222-8222-222222222222' }));
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('does not retry a Think POST after an ambiguous upstream connection loss', async () => {
    calls = [];
    const body = JSON.stringify({ conversationId: '11111111-1111-4111-8111-111111111111', clientCommandId: '44444444-4444-4444-8444-444444444444' });
    const response = await request('/api/think/conversations', { 'content-type': 'application/json' }, port, 'POST', body);
    expect(response.status).toBe(503);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', body });
  });
  it('preserves the bounded Think snapshot manifest and strips noncontract fields', async () => {
    calls = [];
    const response = await request(`/api/think/conversations/${conversationId}`);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ conversationId, epoch, revision: 1, creation: 'ready', sendEligibility: 'available', entries: [
      expect.objectContaining({ kind: 'original', clientCommandId: commandId, messageId: 'msg_fixture_owned', body: bodyRef }),
    ] });
    expect(response.body).not.toContain('fixture-private');
    expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(64 * 1024);
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
  });
  it('forwards an authenticated bounded Think content chunk with fixed query and strips private fields', async () => {
    calls = [];
    const query = new URLSearchParams({ generation: bodyRef.generation, through: String(bodyRef.through), offset: '0' });
    const path = `/api/think/conversations/${conversationId}/content/${bodyRef.contentId}?${query}`;
    const response = await request(path, { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', authorization: 'Bearer browser-secret', cookie: 'session=fixture' });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ conversationId, epoch, contentId: bodyRef.contentId, generation: bodyRef.generation,
      through: bodyRef.through, offset: 0, bytes: Buffer.from('fixture').toString('base64'), nextOffset: 7, transfer: expect.any(String) });
    expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(128 * 1024);
    expect(response.body + JSON.stringify(response.headers)).not.toContain('fixture-private');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', url: path });
    expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
    expect(calls[0].headers.cookie).toBeUndefined();
    expect(calls[0].headers.origin).toBeUndefined();
    expect(calls[0].headers['sec-fetch-site']).toBeUndefined();
  });
  it('denies a Think content chunk before upstream access', async () => {
    calls = [];
    const query = new URLSearchParams({ generation: bodyRef.generation, through: String(bodyRef.through), offset: '0' });
    const response = await request(`/api/think/conversations/${conversationId}/content/${bodyRef.contentId}?${query}`, { origin: 'null' });
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('streams snapshot, heartbeat and a later revision beyond five seconds without buffering or forwarding browser credentials', async () => {
    calls = [];
    watchMode = 'normal';
    const closedBefore = watchClosed;
    const { req, res } = await watchRequest({ origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', authorization: 'Bearer browser-secret', cookie: 'session=fixture' });
    try {
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/event-stream(?:;|$)/i);
      expect(res.headers['cache-control']).toMatch(/no-cache|no-store/);
      expect(res.headers['cache-control']).toContain('no-transform');
      expect(res.headers['set-cookie']).toBeUndefined();
      const frames = watchFrames(res);
      const first = await frames.frame();
      expect(first.type).toBe('snapshot');
      expect(first.value).toMatchObject({ conversationId, epoch, revision: 1, sendEligibility: 'available', entries: [expect.objectContaining({ kind: 'original', body: bodyRef })] });
      expect(first.raw).not.toContain('fixture-private');
      const start = Date.now();
      const heartbeat = await frames.frame(8000);
      expect(Date.now() - start).toBeGreaterThan(5000);
      expect(heartbeat.type).toBe('heartbeat');
      const later = await frames.frame();
      expect(later.type).toBe('revision');
      expect(later.value).toMatchObject({ conversationId, epoch, revision: 2, sendEligibility: 'busy' });
      expect(later.raw).not.toContain('fixture-private');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ method: 'GET', url: watchPath });
      expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
      expect(calls[0].headers.accept).toBe('text/event-stream');
      expect(calls[0].headers.cookie).toBeUndefined();
      expect(calls[0].headers.origin).toBeUndefined();
      expect(calls[0].headers['sec-fetch-site']).toBeUndefined();
    } finally { req.destroy(); res.destroy(); }
    await vi.waitFor(() => expect(watchClosed).toBeGreaterThan(closedBefore), { timeout: 3000 });
    expect(calls.every(call => call.method === 'GET' && call.url === watchPath)).toBe(true);
  }, 15000);
  it.each<Record<string, string>>([{ host: 'hostile.example', origin: 'http://fixture.example:7319', 'x-forwarded-host': 'fixture.example:7319' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }])('denies a Think watch before the upstream boundary %o', async headers => {
    calls = [];
    const response = await request(watchPath, headers);
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('rejects an upstream watch redirect without exposing its target', async () => {
    calls = [];
    watchMode = 'redirect';
    try {
      const response = await request(watchPath);
      expect(response.status).toBe(503);
      expect(response.body + JSON.stringify(response.headers)).not.toMatch(/fixture-private|location/i);
      expect(calls).toHaveLength(1);
    } finally { watchMode = 'normal'; }
  });
  it.each(['malformed', 'oversized'] as const)('closes on a %s control frame without leaking its bytes', async mode => {
    calls = [];
    watchMode = mode;
    const { req, res } = await watchRequest();
    try {
      expect(res.statusCode).toBe(200);
      const frames = watchFrames(res);
      expect((await frames.frame()).type).toBe('snapshot');
      expect(await frames.remaining()).not.toContain('fixture-private');
      expect(calls).toHaveLength(1);
    } finally { req.destroy(); res.destroy(); watchMode = 'normal'; }
  });
  it('forwards exactly encoded note identifier on the fixed route', async () => {
    calls = [];
    const id = ['folder', 'a % &.md'];
    const response = await request(`/api/vault/note?${new URLSearchParams({ id: JSON.stringify(id) })}`);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ name: 'fixture.md', markdown: '# fixture' });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url ?? '', 'http://127.0.0.1').searchParams.getAll('id')).toEqual([JSON.stringify(id)]);
  });
  it.each<Record<string, string>>([{ host: 'hostile.example', origin: 'http://fixture.example:7319', 'x-forwarded-host': 'fixture.example:7319' }, { origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }])('denies real HTTP hostile headers %o without upstream', async headers => {
    calls = [];
    const response = await request('/api/vault/tree', headers);
    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it('hard-load HTML does not reveal the service token', async () => {
    const response = await request('/recall');
    expect(response.status).toBe(200);
    expect(response.body + JSON.stringify(response.headers) + output).not.toContain(token);
  });
  it('does not embed the fixture token in production static bundles', async () => {
    const directory = join(fixture, 'project', '.next', 'static');
    let checked = 0;
    async function scan(path: string): Promise<void> {
      for (const item of await readdir(path, { withFileTypes: true })) {
        const childPath = join(path, item.name);
        if (item.isDirectory()) await scan(childPath);
        else if (item.isFile()) {
          checked++;
          expect((await readFile(childPath)).includes(Buffer.from(token))).toBe(false);
        }
      }
    }
    await scan(directory);
    expect(checked).toBeGreaterThan(0);
  });
  it('starts and stops the canonical server package entrypoint from an unrelated directory', async () => {
    const reservation = createServer();
    const serverPort = await listen(reservation);
    await close(reservation);
    const metadata = join(fixture, 'server-metadata');
    await mkdir(metadata, { mode: 0o700 });
    await writeFile(join(metadata, 'service.token'), token, { mode: 0o600 });
    const upstreamPort = (upstream.address() as AddressInfo).port;
    await writeFile(join(metadata, 'transport.json'), JSON.stringify({ daemonOrigin: `http://127.0.0.1:${upstreamPort}`, web: { mode: 'loopback', origin: `http://127.0.0.1:${serverPort}` } }), { mode: 0o600 });
    const server = spawn('bun', ['--no-env-file', 'run', '--cwd', join(fixture, 'project'), 'server', '--port', String(serverPort)], {
      cwd: fixture, env: { ...env, HOME: fixture, MEMORY_LOOP_TRANSPORT_FILE: join(metadata, 'transport.json') }, detached: true, stdio: 'pipe',
    });
    let logs = '';
    server.stdout.on('data', data => { logs += String(data); });
    server.stderr.on('data', data => { logs += String(data); });
    const exited = new Promise<void>((resolveExit, reject) => {
      server.once('exit', () => resolveExit());
      server.once('error', reject);
    });
    try {
      const deadline = Date.now() + 15_000;
      let response: Awaited<ReturnType<typeof request>> | undefined;
      while (Date.now() < deadline) {
        if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Server script exited before readiness: ${logs}`);
        try { response = await request('/recall', {}, serverPort); break; }
        catch { await new Promise(resolveWait => setTimeout(resolveWait, 30)); }
      }
      expect(response, `Server script did not become ready: ${logs}`).toBeDefined();
      expect(response?.status).toBe(200);
      expect(response?.headers['content-type']).toContain('text/html');
      expect((response?.body ?? '') + logs).not.toContain(token);
      if (server.pid === undefined) throw new Error('Owned server process has no PID');
      const ownership = await ownedNodeNext(server.pid);
      const launcherState = server.exitCode !== null ? 'exited' : server.signalCode !== null ? 'signalled' : 'running';
      expect(ownership.owned, `owned Next process not found: ${JSON.stringify({ ...ownership, launcherState })}`).toBe(true);
      process.kill(-server.pid, 'SIGTERM');
      await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Server did not stop')), 5000))]);
      const check = createServer();
      try {
        await new Promise<void>((resolveListen, reject) => {
          check.once('error', reject);
          check.listen(serverPort, '127.0.0.1', resolveListen);
        });
      } finally { if (check.listening) await close(check); }
    } finally {
      if (server.pid !== undefined) {
        try { process.kill(-server.pid, 'SIGKILL'); }
        catch (error: unknown) {
          if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')) throw error;
        }
      }
      if (server.exitCode === null && server.signalCode === null) await exited;
    }
  }, 30_000);
});
