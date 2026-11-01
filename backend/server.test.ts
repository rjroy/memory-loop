import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { SessionCreateInput, SessionInfo } from '@opencode/client';
import { Service } from '@opencode/client/service';
import { prepareServer, type PreparedServer } from './server';
import * as configModule from './config';
import * as vaultModule from './vault';
import * as captureModule from './capture';
import * as appModule from './app';

const authority = '127.0.0.1:31234';
const token = 'a'.repeat(64);
let fixture: string;
let projectRoot: string;
let vault: string;
let server: PreparedServer | undefined;
let nativeFixture: Server | undefined;

beforeEach(async () => {
  server = undefined;
  nativeFixture = undefined;
  fixture = await mkdtemp(join(tmpdir(), 'memory-loop-server-test-'));
  projectRoot = join(fixture, 'app');
  vault = join(fixture, 'vault');
  await mkdir(join(projectRoot, '.memory-loop'), { recursive: true, mode: 0o700 });
  await mkdir(join(vault, 'folder'), { recursive: true });
  await writeFile(join(vault, 'folder', 'note.md'), '# Fixture note\n');
  await writeFile(join(projectRoot, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault }));
  await writeFile(join(projectRoot, '.memory-loop', 'transport.json'), JSON.stringify({ daemonOrigin: `http://${authority}`, web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }), { mode: 0o600 });
  await writeFile(join(projectRoot, '.memory-loop', 'service.token'), token, { mode: 0o600 });
});

afterEach(async () => {
  try {
    await server?.close();
    if (nativeFixture) await new Promise<void>((resolve, reject) => nativeFixture?.close(error => error ? reject(error) : resolve()));
  } finally {
    vi.restoreAllMocks();
    if (fixture) await rm(fixture, { recursive: true, force: true });
  }
});

it('discovers the explicit fixture service and creates an owned native session through the daemon', async () => {
  const fixturePassword = 'fixture-only-password';
  const auth = `Basic ${Buffer.from(`opencode:${fixturePassword}`).toString('base64')}`;
  const nativeCalls: string[] = [];
  const created: SessionInfo[] = [];
  nativeFixture = createServer(async (req, res) => {
    nativeCalls.push(`${req.method} ${req.url}`);
    if (req.headers.authorization !== auth) { res.writeHead(401).end('{}'); return; }
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/api/info') {
      res.end(JSON.stringify({ version: '2.2.2', pid: process.pid, urls: [], paths: { tmp: fixture } }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/session') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const input: SessionCreateInput = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input.id || !input.location || !input.permissions || !input.metadata) { res.writeHead(400).end('{}'); return; }
      const session: SessionInfo = { id: input.id, projectID: 'fixture-project', location: input.location,
        metadata: input.metadata, permissions: input.permissions.map(rule => ({ ...rule })), cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 1 } };
      created.push(session);
      res.end(JSON.stringify({ data: session }));
      return;
    }
    if (req.method === 'GET' && created[0] && req.url === `/api/session/${created[0].id}`) {
      res.end(JSON.stringify({ data: created[0] }));
      return;
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((resolve, reject) => nativeFixture?.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = nativeFixture.address();
  if (!address || typeof address === 'string') throw new Error('fixture listener unavailable');
  const url = `http://127.0.0.1:${address.port}`;
  const registrationFile = join(fixture, 'service.json');
  await writeFile(registrationFile, JSON.stringify({ url, pid: process.pid, version: '2.2.2', password: fixturePassword }), { mode: 0o600 });
  expect(await Service.discover({ file: registrationFile, version: '2.2.2' })).toBeDefined();
  await writeFile(join(projectRoot, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault,
    think: { service: { registrationFile, requiredVersion: '2.2.2' }, location: { kind: 'vault' }, permissionMode: 'full' } }));
  const request = await start();
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const clientCommandId = '22222222-2222-4222-8222-222222222222';
  const response = await request('/api/think/conversations', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId, clientCommandId }) });
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ kind: 'create', conversationId, clientCommandId });
  await vi.waitFor(() => expect(created).toHaveLength(1));
  expect(created[0]).toMatchObject({ id: `ses_memoryloop_${conversationId.replaceAll('-', '')}`,
    location: { directory: vault }, permissions: [{ action: '*', resource: '*', effect: 'allow' }] });
  await vi.waitFor(async () => expect(await (await request(`/api/think/conversations/${conversationId}`)).json()).toMatchObject({ creation: 'ready' }));
  expect(nativeCalls).toContain(`GET /api/session/ses_memoryloop_${conversationId.replaceAll('-', '')}`);
  expect((await request('/api/vault/tree')).status).toBe(200);
});

it.each([
  ['invalid mode', 'restricted', 'think_config_invalid'],
  ['unavailable service', 'full', 'think_unavailable'],
] as const)('keeps Recall available with %s', async (_label, permissionMode, code) => {
  const think = { service: { registrationFile: join(fixture, 'missing-service.json'), requiredVersion: '2.2.2' }, location: { kind: 'vault' }, permissionMode };
  await writeFile(join(projectRoot, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault, think }));
  const request = await start();
  expect((await request('/api/vault/tree')).status).toBe(200);
  const response = await request('/api/think/conversations', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: '11111111-1111-4111-8111-111111111111', clientCommandId: '22222222-2222-4222-8222-222222222222' }) });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code } });
});

async function start() {
  const prepared = await prepareServer({ projectRoot, authority });
  server = prepared;
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('host')) headers.set('host', authority);
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    return prepared.fetch(new Request(`http://${authority}${path}`, { ...init, headers }));
  };
}

it.each([
  ['invalid cron', { questions: { schedule: 'not a cron', count: 3 } }],
  ['invalid time zone', { timeZone: 'Fixture/Not_A_Zone' }],
  ['output count above bound', { questions: { schedule: '17 9 * * 2', count: 51 } }],
  ['per-note limit above total', { context: { lookbackDays: 4, maxNotes: 11, maxNoteBytes: 4096, maxTotalBytes: 1024 } }],
])('reports %s generation configuration without disabling other capabilities', async (_name, invalid) => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const nativeCalls: string[] = [];
  nativeFixture = createServer((req, res) => {
    nativeCalls.push(`${req.method} ${req.url}`);
    if (req.method === 'GET' && req.url === '/api/info') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ version: '2.2.2', pid: process.pid, urls: [], paths: { tmp: fixture } }));
    } else res.writeHead(404).end('{}');
  });
  await new Promise<void>((resolve, reject) => nativeFixture?.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = nativeFixture.address();
  if (!address || typeof address === 'string') throw new Error('fixture listener unavailable');
  const registrationFile = join(fixture, 'service.json');
  await writeFile(registrationFile, JSON.stringify({ url: `http://127.0.0.1:${address.port}`, pid: process.pid, version: '2.2.2', password: 'fixture-only-password' }), { mode: 0o600 });
  await writeFile(join(projectRoot, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault,
    think: { service: { registrationFile, requiredVersion: '2.2.2' }, location: { kind: 'vault' }, permissionMode: 'full' },
    ground: { generation: { enabled: true, ...invalid } } }));
  const request = await start();
  expect((await request('/api/vault/tree')).status).toBe(200);
  expect((await request('/api/ground/goals')).status).toBe(200);
  const captured = await request('/api/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Owned fixture thought' }) });
  expect(captured.status).toBe(200);
  expect(nativeCalls.filter(call => call.startsWith('POST '))).toEqual([]);
  const logs = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls].map(args => JSON.stringify(args));
  expect(logs.some(line => /generation/i.test(line) && /invalid/i.test(line))).toBe(true);
  expect(logs.join('\n')).not.toContain(fixture);
});

it.each([undefined, { enabled: false }] as const)('keeps existing services usable when generation is unconfigured or disabled', async generation => {
  await writeFile(join(projectRoot, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault,
    ...(generation ? { ground: { generation } } : {}) }));
  const request = await start();
  expect((await request('/api/vault/tree')).status).toBe(200);
  expect((await request('/api/ground/goals')).status).toBe(200);
  expect((await request('/api/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Owned fixture thought' }) })).status).toBe(200);
  const response = await request('/api/think/conversations', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: '11111111-1111-4111-8111-111111111111', clientCommandId: '22222222-2222-4222-8222-222222222222' }) });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: 'think_config_missing' } });
});

it('loads fixture config once and serves the real tree and selected note through the API', async () => {
  const request = await start();
  const tree = await request('/api/vault/tree');
  expect(tree.status).toBe(200);
  expect(tree.headers.get('cache-control')).toBe('no-store');
  expect(await tree.json()).toEqual({ rootIdentity: expect.any(String), entries: [{ kind: 'directory', name: 'folder', id: ['folder'], identity: expect.any(String), version: expect.any(String), children: [
    { kind: 'note', name: 'note.md', id: ['folder', 'note.md'], identity: expect.any(String), version: expect.any(String) },
  ] }] });
  const note = await request(`/api/vault/note?${new URLSearchParams({ id: JSON.stringify(['folder', 'note.md']) })}`);
  expect(note.status).toBe(200);
  expect(await note.json()).toEqual({ name: 'note.md', markdown: '# Fixture note\n', revision: expect.stringMatching(/^[a-f0-9]{64}$/), editable: true });
  await writeFile(join(projectRoot, '.memory-loop', 'config.json'), '{');
  expect((await request('/api/vault/tree')).status).toBe(200);
});

it('rejects unauthenticated API requests and browser headers while allowing authenticated service reads', async () => {
  const opened = vi.spyOn(vaultModule, 'openVault');
  const request = await start();
  const reader = await opened.mock.results[0].value;
  const tree = vi.spyOn(reader, 'tree');
  const missing = await server?.fetch(new Request(`http://${authority}/api/vault/tree`, { headers: { host: authority } }));
  expect(missing?.status).toBe(401);
  expect((await request('/api/vault/tree', { headers: { authorization: `Bearer ${'b'.repeat(64)}` } })).status).toBe(401);
  expect((await request('/api/vault/tree', { headers: { origin: 'http://127.0.0.1:3000' } })).status).toBe(403);
  expect((await request('/api/vault/tree', { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(403);
  expect(tree).not.toHaveBeenCalled();
  expect((await request('/api/vault/tree')).status).toBe(200);
  expect(tree).toHaveBeenCalledOnce();
});

it.each(['missing token', 'invalid token', 'invalid transport'] as const)(
  'fails before vault configuration or reader access for %s', async problem => {
    const metadata = join(projectRoot, '.memory-loop');
    if (problem === 'missing token') await rm(join(metadata, 'service.token'));
    if (problem === 'invalid token') await writeFile(join(metadata, 'service.token'), 'invalid');
    if (problem === 'invalid transport') await writeFile(join(metadata, 'transport.json'), '{');
    const config = vi.spyOn(configModule, 'loadConfig');
    const reader = vi.spyOn(vaultModule, 'openVault');
    const outcome = await prepareServer({ projectRoot, authority })
      .then(prepared => ({ prepared, error: undefined }), (error: unknown) => ({ prepared: undefined, error }));
    await outcome.prepared?.close();
    const error: unknown = outcome.error;
    expect(error).toBeInstanceOf(Error);
    expect(config).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
    if (error instanceof Error) {
      expect(error.message).not.toContain(projectRoot);
      expect(error.message).not.toContain(token);
    }
  },
);

it.each(['close', 'construction'] as const)('attempts Vault cleanup after Capture fails during %s and preserves error precedence', async phase => {
  const events: string[] = [];
  const captureFailure = new Error('capture close failed');
  const vaultFailure = new Error('vault close failed');
  const openCapture = captureModule.openCaptureWriter;
  const openVault = vaultModule.openVault;
  vi.spyOn(captureModule, 'openCaptureWriter').mockImplementation(async (...args) => {
    const writer = await openCapture(...args);
    const close = writer.close.bind(writer);
    writer.close = async () => { events.push('capture'); await close(); throw captureFailure; };
    return writer;
  });
  vi.spyOn(vaultModule, 'openVault').mockImplementation(async (...args) => {
    const reader = await openVault(...args);
    const close = reader.close.bind(reader);
    reader.close = async () => { events.push('vault'); await close(); throw vaultFailure; };
    return reader;
  });
  if (phase === 'construction') vi.spyOn(appModule, 'createApp').mockImplementation(() => { throw new Error('construction failed'); });
  const operation = phase === 'construction'
    ? prepareServer({ projectRoot, authority })
    : prepareServer({ projectRoot, authority }).then(prepared => prepared.close());
  await expect(operation).rejects.toBe(vaultFailure);
  expect(events).toEqual(['capture', 'vault']);
});

it.each(['missing', 'invalid'] as const)('serves a clear %s config error without a frontend fallback', async kind => {
  const config = join(projectRoot, '.memory-loop', 'config.json');
  if (kind === 'missing') await rm(config);
  else await writeFile(config, '{');
  const request = await start();
  const response = await request('/api/vault/tree');
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ error: { code: kind === 'missing' ? 'config_missing' : 'config_invalid' } });
  expect((await request('/recall', { headers: { accept: 'text/html' } })).status).toBe(404);
});

it('does not expose any generic filesystem or frontend routes', async () => {
  const request = await start();
  for (const path of ['/recall', '/assets/app.js', '/.private', '/escape.txt', '/assets/%2e%2e%2fsecret.txt', '/folder/note.md', '/api/missing']) {
    const response = await request(path);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Fixture note');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  }
});
