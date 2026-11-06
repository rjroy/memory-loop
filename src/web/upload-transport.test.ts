import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('server-only', () => ({}));
import { vaultRoute } from './vault-route';

const token = 'a'.repeat(64);
const previous = process.env.MEMORY_LOOP_TRANSPORT_FILE;
let fixture: string;
let server: Server;
let firstBytes: Promise<void>;
let firstArrived: () => void;
let calls: Array<{ method: string; url: string; headers: import('node:http').IncomingHttpHeaders; bytes: Buffer }>;

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'j21-upload-transport-'));
  const metadata = join(fixture, 'private');
  await mkdir(metadata, { mode: 0o700 });
  calls = [];
  firstBytes = new Promise(resolve => { firstArrived = resolve; });
  server = createServer((incoming, response) => {
    const call = { method: incoming.method ?? '', url: incoming.url ?? '', headers: incoming.headers, bytes: Buffer.alloc(0) };
    calls.push(call);
    if (incoming.method === 'GET') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ maxFileBytes: 100 })); return; }
    incoming.on('data', (chunk: Buffer) => { call.bytes = Buffer.concat([call.bytes, chunk]); firstArrived(); });
    incoming.on('end', () => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: ['06_Attachments', 'a %.bin'], name: 'a %.bin', size: call.bytes.length })));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing listener');
  await writeFile(join(metadata, 'transport.json'), JSON.stringify({ daemonOrigin: `http://127.0.0.1:${address.port}` }), { mode: 0o600 });
  await writeFile(join(metadata, 'service.token'), token, { mode: 0o600 });
  process.env.MEMORY_LOOP_TRANSPORT_FILE = join(metadata, 'transport.json');
});
afterEach(async () => {
  if (previous === undefined) delete process.env.MEMORY_LOOP_TRANSPORT_FILE;
  else process.env.MEMORY_LOOP_TRANSPORT_FILE = previous;
  server?.closeAllConnections();
  await new Promise<void>(resolve => server?.close(() => resolve()) ?? resolve());
  if (fixture) await rm(fixture, { recursive: true, force: true });
});

describe('runtime-bound upload route over real private HTTP', () => {
  it('fetches limits then forwards bytes before browser EOF using only server credentials', async () => {
    const state: { controller?: ReadableStreamDefaultController<Uint8Array> } = {};
    const stream = new ReadableStream<Uint8Array>({ start(c) { state.controller = c; c.enqueue(new Uint8Array([0, 1, 255])); } });
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/octet-stream', cookie: 'browser=private', authorization: 'Bearer browser', origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' }, body: stream, duplex: 'half' };
    const pending = vaultRoute(new Request(`http://127.0.0.1:3000/api/vault/attachments?${new URLSearchParams({ name: 'a %.bin' })}`, init));
    const first = await Promise.race([firstBytes.then(() => 'bytes' as const), pending.then(() => 'early' as const)]);
    if (first !== 'bytes') { state.controller?.close(); expect(first).toBe('bytes'); return; }
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('/api/vault/attachments');
    const post = calls.find(call => call.method === 'POST');
    if (!post) throw new Error('missing upload request');
    expect(new URL(`http://127.0.0.1${post.url}`).pathname).toBe('/api/vault/attachments');
    expect(new URL(`http://127.0.0.1${post.url}`).searchParams.get('name')).toBe('a %.bin');
    expect(post.headers.authorization).toBe(`Bearer ${token}`);
    expect(post.headers.cookie).toBeUndefined();
    expect(post.headers.origin).toBeUndefined();
    expect(post.headers['sec-fetch-site']).toBeUndefined();
    expect(post.headers['content-type']).toBe('application/octet-stream');
    state.controller?.enqueue(new Uint8Array([2, 3]));
    state.controller?.close();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ['06_Attachments', 'a %.bin'], name: 'a %.bin', size: 5 });
    expect(post.bytes).toEqual(Buffer.from([0, 1, 255, 2, 3]));
  }, 5000);
});
