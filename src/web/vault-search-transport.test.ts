import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../../backend/app';
import { openVault, type VaultReader } from '../../backend/vault';

vi.mock('server-only', () => ({}));
import { vaultRoute } from './vault-route';

const token = 'a'.repeat(64);
const originalSelector = process.env.MEMORY_LOOP_TRANSPORT_FILE;
let fixture: string;
let vault: VaultReader;
let server: Server;
let app: ReturnType<typeof createApp>;
let received: Array<{ path: string; headers: Record<string, string | string[] | undefined> }>;

function request(path: string, body: unknown, extra: Record<string, string> = {}) {
  return vaultRoute(new Request(`http://127.0.0.1:3000${path}`, { method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) }));
}

beforeEach(async () => {
  fixture = await mkdtemp('/tmp/opencode/recall-search-route-');
  const root = join(fixture, 'vault');
  const metadata = join(fixture, 'private');
  await mkdir(root);
  await mkdir(metadata, { mode: 0o700 });
  await writeFile(join(root, 'note.txt'), 'before\nneedle\nafter');
  vault = await openVault(root);
  received = [];
  server = createServer(async (incoming, outgoing) => {
    received.push({ path: incoming.url ?? '', headers: incoming.headers });
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const abort = new AbortController();
      outgoing.on('close', () => { if (!outgoing.writableFinished) abort.abort(); });
      const response = await app(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, signal: abort.signal }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { outgoing.destroy(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing owned listener');
  const authority = `127.0.0.1:${address.port}`;
  app = createApp({ authority, serviceToken: token, vault: { reader: vault } });
  await writeFile(join(metadata, 'transport.json'), JSON.stringify({ daemonOrigin: `http://${authority}` }), { mode: 0o600 });
  await writeFile(join(metadata, 'service.token'), token, { mode: 0o600 });
  process.env.MEMORY_LOOP_TRANSPORT_FILE = join(metadata, 'transport.json');
});

afterEach(async () => {
  if (originalSelector === undefined) delete process.env.MEMORY_LOOP_TRANSPORT_FILE;
  else process.env.MEMORY_LOOP_TRANSPORT_FILE = originalSelector;
  server?.closeAllConnections();
  await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve());
  try { await vault?.close(); } finally { await rm(fixture, { recursive: true, force: true }); }
});

describe('search through the actual Next vault route and private HTTP transport', () => {
  it.each([
    ['/api/vault/search', { mode: 'content', query: 'needle' }, 'missing-transport.json'],
    ['/api/vault/search/context', { id: ['note.txt'], version: 'version', line: 2, query: 'needle' }, 'missing-transport.json'],
    ['/api/vault/search', { mode: 'content', query: 'needle' }, 'missing/transport.json'],
    ['/api/vault/search/context', { id: ['note.txt'], version: 'version', line: 2, query: 'needle' }, 'missing/transport.json'],
  ])('sanitizes unavailable transport for %s (body %s, selector %s)', async (path, body, selector) => {
    process.env.MEMORY_LOOP_TRANSPORT_FILE = join(fixture, selector);
    const response = await request(path, body);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'search_unavailable', message: 'Search is unavailable' } });
    expect(received).toEqual([]);
  });

  it.each(['/api/vault/tree', '/api/vault/note?id=%5B%22note.txt%22%5D'])('preserves legacy unavailable transport behavior for %s', async path => {
    process.env.MEMORY_LOOP_TRANSPORT_FILE = join(fixture, 'missing-transport.json');
    const response = await vaultRoute(new Request(`http://127.0.0.1:3000${path}`, { headers: { host: '127.0.0.1:3000' } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'service_unavailable', message: 'Vault service unavailable' } });
    expect(received).toEqual([]);
  });

  it('forwards fixed authenticated search and context routes without browser credentials', async () => {
    const response = await request('/api/vault/search', { mode: 'content', query: 'needle' }, { cookie: 'secret=browser', authorization: 'Bearer browser', origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' });
    expect(response.status).toBe(200);
    const result = await response.json() as { hits: Array<{ id: string[]; line: number; version: string }> };
    expect(result.hits).toHaveLength(1);
    const hit = result.hits[0];
    const context = await request('/api/vault/search/context', { id: hit.id, line: hit.line, version: hit.version, query: 'needle' });
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({ id: ['note.txt'], targetLine: 2 });
    expect(received.map(item => item.path)).toEqual(['/api/vault/search', '/api/vault/search/context']);
    for (const { headers } of received) {
      expect(headers.authorization).toBe(`Bearer ${token}`);
      expect(headers.cookie).toBeUndefined();
      expect(headers.origin).toBeUndefined();
      expect(headers['sec-fetch-site']).toBeUndefined();
    }
  });

  it('rejects cross-origin and unknown routes before reaching the daemon', async () => {
    const crossOrigin = await request('/api/vault/search', { mode: 'filename', query: 'note' }, { origin: 'https://evil.test' });
    expect(crossOrigin.status).toBe(403);
    const unknown = await request('/api/vault/search/extra', { mode: 'filename', query: 'note' });
    expect([404, 405]).toContain(unknown.status);
    expect(received).toEqual([]);
  });

  it('arms the search budget on the real private transport without changing metadata budget', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout');
    try {
      const response = await request('/api/vault/search', { mode: 'filename', query: 'note' });
      expect(response.status).toBe(200);
      expect(timers.mock.calls.some(([, delay]) => delay === 35_000)).toBe(true);
      timers.mockClear();
      const metadata = await vaultRoute(new Request(`http://127.0.0.1:3000/api/vault/file?${new URLSearchParams({ id: JSON.stringify(['note.txt']) })}`, { headers: { host: '127.0.0.1:3000' } }));
      expect(metadata.status).toBe(200);
      expect(timers.mock.calls.some(([, delay]) => delay === 5_000)).toBe(true);
    } finally { timers.mockRestore(); }
  });
});
