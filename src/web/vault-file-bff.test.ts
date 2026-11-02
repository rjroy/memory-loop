import { describe, expect, it, vi } from 'vitest';
import type { LoadedTransport } from '../../backend/transport';
import { handleVaultRequest } from './vault-bff';

const token = 'a'.repeat(64);
const transport: LoadedTransport = { config: { daemonOrigin: 'http://127.0.0.1:3001' }, serviceToken: token };
const json = (value: unknown, status = 200) => Response.json(value, { status });
const query = (id: string[]) => new URLSearchParams({ id: JSON.stringify(id) }).toString();
function setup(upstream: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetcher = vi.fn(upstream);
  const log = vi.fn<(event: string, details: Record<string, unknown>) => void>();
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('host')) headers.set('host', '127.0.0.1:3000');
    return handleVaultRequest(new Request(`http://127.0.0.1:3000${path}`, { ...init, headers }), { transport, fetch: fetcher, log });
  };
  return { request, fetcher, log };
}

describe('vault file BFF boundary', () => {
  it('projects flat metadata and encodes the ID exactly once at a fixed authenticated upstream', async () => {
    const id = ['folder', 'a % &.txt'];
    const { request, fetcher } = setup(async () => json({ name: id[1], kind: 'text', text: 'hello', private: 'discard' }));
    const response = await request(`/api/vault/file?${query(id)}`, { headers: { cookie: 'private=1', authorization: 'Bearer browser', origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: id[1], kind: 'text', text: 'hello' });
    const [target, init] = fetcher.mock.calls[0];
    const parsed = new URL(String(target));
    expect(parsed.origin + parsed.pathname).toBe('http://127.0.0.1:3001/api/vault/file');
    expect([...parsed.searchParams]).toEqual([['id', JSON.stringify(id)]]);
    expect([...new Headers(init?.headers)].sort()).toEqual([['accept', 'application/json'], ['authorization', `Bearer ${token}`]]);
    expect(init?.redirect).toBe('error');
    expect(init?.cache).toBe('no-store');
  });
  it.each([{ name: 'image', kind: 'image', contentType: 'image/png' }, { name: 'clip', kind: 'video', contentType: 'video/mp4' }, { name: 'other', kind: 'unsupported' }])('projects metadata variant $kind', async value => {
    const { request } = setup(async () => json(value));
    const response = await request(`/api/vault/file?${query([value.name])}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(value);
  });
  it('projects generic file tree entries with identity and version', async () => {
    const file = { kind: 'file', name: 'data.json', id: ['data.json'], identity: 'id', version: 'version' };
    const { request } = setup(async () => json({ rootIdentity: 'root', entries: [file] }));
    const response = await request('/api/vault/tree');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rootIdentity: 'root', entries: [file] });
  });
  it('forwards file actions with no browser credentials', async () => {
    const action = { action: 'delete', kind: 'file', id: ['data.json'], expectedVersion: 'v' };
    const { request, fetcher } = setup(async () => json({ id: action.id }));
    const response = await request('/api/vault/actions', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'private=1' }, body: JSON.stringify(action) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: action.id });
    const [target, init] = fetcher.mock.calls[0];
    expect(String(target)).toBe('http://127.0.0.1:3001/api/vault/actions');
    expect(JSON.parse(String(init?.body))).toEqual(action);
    expect(new Headers(init?.headers).get('cookie')).toBeNull();
  });
  it('forwards a valid range and only allowlisted response headers without buffering', async () => {
    let cancel = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
      cancel() { cancel = true; },
    });
    const { request, fetcher } = setup(async () => new Response(stream, { status: 206, headers: {
      'content-type': 'image/png', 'content-range': 'bytes 1-3/8', 'content-length': '3', 'accept-ranges': 'bytes',
      'content-disposition': 'inline', 'content-security-policy': 'sandbox', 'set-cookie': 'secret=1', location: 'https://evil.test/', 'x-private': 'secret',
    } }));
    const response = await request(`/api/vault/content?${query(['a %.png'])}`, { headers: { range: 'bytes=1-3', cookie: 'browser=secret', authorization: 'Bearer browser', 'sec-fetch-site': 'same-origin' } });
    expect(response.status).toBe(206);
    const [target, init] = fetcher.mock.calls[0];
    const parsed = new URL(String(target));
    expect(parsed.origin + parsed.pathname).toBe('http://127.0.0.1:3001/api/vault/content');
    expect(parsed.searchParams.get('id')).toBe(JSON.stringify(['a %.png']));
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(headers.get('range')).toBe('bytes=1-3');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('origin')).toBeNull();
    expect(headers.get('sec-fetch-site')).toBeNull();
    expect(response.headers.get('content-range')).toBe('bytes 1-3/8');
    expect(response.headers.get('content-length')).toBe('3');
    expect(response.headers.get('content-security-policy')).toBe('sandbox');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-private')).toBeNull();
    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing body');
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
    await reader.cancel();
    expect(cancel).toBe(true);
  });
  it('does not apply the short JSON timeout to an active content stream', async () => {
    vi.useFakeTimers();
    try {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      const { request } = setup(async (_input, init) => {
        const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; c.enqueue(new Uint8Array([1])); } });
        init?.signal?.addEventListener('abort', () => controller?.error(new Error('aborted')));
        return new Response(stream, { headers: { 'content-type': 'image/png' } });
      });
      const response = await request(`/api/vault/content?${query(['a.png'])}`);
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('missing body');
      expect((await reader.read()).value).toEqual(new Uint8Array([1]));
      await vi.advanceTimersByTimeAsync(6000);
      controller?.enqueue(new Uint8Array([2]));
      controller?.close();
      expect((await reader.read()).value).toEqual(new Uint8Array([2]));
      expect((await reader.read()).done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('uses HEAD upstream without forwarding Range or returning a body', async () => {
    const { request, fetcher } = setup(async () => new Response(null, { headers: { 'content-type': 'image/png', 'content-length': '42', 'content-security-policy': 'sandbox' } }));
    const response = await request(`/api/vault/content?${query(['a.png'])}&download=1`, { method: 'HEAD', headers: { range: 'bytes=1-2' } });
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get('content-length')).toBe('42');
    const [target, init] = fetcher.mock.calls[0];
    expect(new URL(String(target)).searchParams.get('download')).toBe('1');
    expect(init?.method).toBe('HEAD');
    expect(new Headers(init?.headers).get('range')).toBeNull();
  });
  it.each(['bytes=0-1,3-4', 'bytes=bad', 'items=0-1'])('rejects invalid range %s before upstream', async range => {
    const { request, fetcher } = setup(async () => json({}));
    const response = await request(`/api/vault/content?${query(['a'])}`, { headers: { range } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves a valid upstream unsatisfiable range response', async () => {
    const { request } = setup(async () => new Response(null, { status: 416, headers: { 'content-range': 'bytes */10' } }));
    const response = await request(`/api/vault/content?${query(['a'])}`, { headers: { range: 'bytes=99-' } });
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
    await response.body?.cancel();
  });
  it.each<Record<string, string>>([{ origin: 'null' }, { origin: 'https://evil.test' }, { 'sec-fetch-site': 'cross-site' }])('enforces browser origin policy %o', async headers => {
    const { request, fetcher } = setup(async () => json({}));
    const response = await request(`/api/vault/content?${query(['a'])}`, { headers });
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sanitizes known upstream file errors and private details', async () => {
    const { request, log } = setup(async () => json({ error: { code: 'entry_unavailable', message: 'private path' } }, 404));
    const response = await request(`/api/vault/file?${query(['missing'])}`);
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'entry_unavailable' } });
    expect(body + JSON.stringify(log.mock.calls)).not.toMatch(/private path|Bearer/);
  });
});
