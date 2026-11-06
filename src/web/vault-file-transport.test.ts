import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createApp } from '../../backend/app';
import { openVault, type VaultReader } from '../../backend/vault';

// Next supplies this marker at build time; the actual route and transport remain real.
vi.mock('server-only', () => ({}));
import { vaultRoute } from './vault-route';

const token = 'a'.repeat(64);
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const originalSelector = process.env.MEMORY_LOOP_TRANSPORT_FILE;
let fixture: string;
let root: string;
let vault: VaultReader;
let server: Server;
let app: ReturnType<typeof createApp>;
let streaming = false;
let upstreamClosed: Promise<void>;
let onUpstreamClosed: () => void;

const pathFor = (resource: string, name: string) => `/api/vault/${resource}?${new URLSearchParams({ id: JSON.stringify([name]) })}`;
const webRequest = (path: string, init: RequestInit = {}) => vaultRoute(new Request(`http://127.0.0.1:3000${path}`, {
  ...init, headers: { host: '127.0.0.1:3000', ...init.headers },
}));

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'j21-file-transport-'));
  root = join(fixture, 'vault');
  const metadata = join(fixture, 'private');
  await mkdir(root);
  await mkdir(metadata, { mode: 0o700 });
  await writeFile(join(root, 'note.txt'), 'fixture text');
  await writeFile(join(root, 'image.png'), png);
  vault = await openVault(root);
  upstreamClosed = new Promise(resolve => { onUpstreamClosed = resolve; });
  server = createServer(async (incoming, outgoing) => {
    if (streaming) {
      if (incoming.headers.authorization !== `Bearer ${token}` || incoming.headers.origin || incoming.headers['sec-fetch-site']) {
        outgoing.writeHead(403).end();
        return;
      }
      outgoing.on('close', onUpstreamClosed);
      outgoing.writeHead(200, { 'content-type': 'image/png', 'content-security-policy': 'sandbox', 'content-disposition': 'inline', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      outgoing.write(png);
      return; // Deliberately hold the upstream open until the consumer cancels.
    }
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const controller = new AbortController();
      outgoing.on('close', () => { if (!outgoing.writableFinished) controller.abort(); });
      const response = await app(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers, signal: controller.signal }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) { outgoing.end(); return; }
      const stream = response.body;
      const body = Readable.from((async function* () {
        const reader = stream.getReader();
        try {
          for (;;) {
            const item = await reader.read();
            if (item.done) break;
            yield item.value;
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
      })());
      outgoing.on('close', () => body.destroy());
      body.on('error', () => outgoing.destroy());
      body.pipe(outgoing);
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
  streaming = false;
});
afterEach(async () => {
  if (originalSelector === undefined) delete process.env.MEMORY_LOOP_TRANSPORT_FILE;
  else process.env.MEMORY_LOOP_TRANSPORT_FILE = originalSelector;
  server?.closeAllConnections();
  await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve());
  try { await vault?.close(); } finally { if (fixture) await rm(fixture, { recursive: true, force: true }); }
});

describe('real Next vault route transport to owned daemon', () => {
  it('gets flat metadata through the runtime-bound daemon transport', async () => {
    const response = await webRequest(pathFor('file', 'note.txt'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'note.txt', kind: 'text', text: 'fixture text' });
  });
  it('preserves full GET content and security headers', async () => {
    const response = await webRequest(pathFor('content', 'image.png'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe(String(png.length));
    expect(response.headers.get('content-disposition')).toMatch(/^inline\b/);
    expect(response.headers.get('content-security-policy')).toBe('sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });
  it('forwards a single range and preserves 206 and 416 headers', async () => {
    const ranged = await webRequest(pathFor('content', 'image.png'), { headers: { range: 'bytes=2-5' } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(`bytes 2-5/${png.length}`);
    expect(ranged.headers.get('content-length')).toBe('4');
    expect(Buffer.from(await ranged.arrayBuffer())).toEqual(png.subarray(2, 6));
    const missing = await webRequest(pathFor('content', 'image.png'), { headers: { range: 'bytes=999-' } });
    expect(missing.status).toBe(416);
    expect(missing.headers.get('content-range')).toBe(`bytes */${png.length}`);
    await missing.body?.cancel();
  });
  it('forwards HEAD with no body and ignores Range', async () => {
    const response = await webRequest(pathFor('content', 'image.png'), { method: 'HEAD', headers: { range: 'bytes=0-1' } });
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get('content-length')).toBe(String(png.length));
    expect(response.headers.get('content-range')).toBeNull();
  });
  it('preserves a bodyless HEAD 404 while GET retains a sanitized error', async () => {
    const head = await webRequest(pathFor('content', 'missing.png'), { method: 'HEAD' });
    expect(head.status).toBe(404);
    expect(head.body).toBeNull();
    const get = await webRequest(pathFor('content', 'missing.png'));
    expect(get.status).toBe(404);
    expect(await get.json()).toMatchObject({ error: { code: 'entry_unavailable' } });
  });
  it('delivers the first upstream chunk before EOF and cancellation closes the real upstream', async () => {
    streaming = true;
    const response = await webRequest(pathFor('content', 'image.png'));
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing streaming body');
    expect(Buffer.from((await reader.read()).value ?? [])).toEqual(png);
    await reader.cancel();
    await expect(upstreamClosed).resolves.toBeUndefined();
  }, 3000);
});
