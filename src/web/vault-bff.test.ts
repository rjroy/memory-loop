import { describe, expect, it, vi } from 'vitest';
import type { LoadedTransport } from '../../backend/transport';
import type { VaultNoteResponse, VaultTreeResponse } from '../../backend/contract';
import { handleVaultRequest } from './vault-bff';

const token = 'a'.repeat(64);
const transport: LoadedTransport = { config: { daemonOrigin: 'http://127.0.0.1:3001', web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }, serviceToken: token };
const tree: VaultTreeResponse = { entries: [{ kind: 'directory', name: 'folder', id: ['folder'], children: [{ kind: 'note', name: 'a.md', id: ['folder', 'a.md'] }] }] };
const note: VaultNoteResponse = { name: 'a.md', markdown: '# fixture' };
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
function setup(upstream: () => Promise<Response> = async () => json(tree), selected = transport) {
  const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => upstream());
  const log = vi.fn<(event: string, details: Record<string, unknown>) => void>();
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('host')) headers.set('host', '127.0.0.1:3000');
    return handleVaultRequest(new Request(`http://127.0.0.1:3000${path}`, { ...init, headers }), { transport: selected, fetch: fetcher, log });
  };
  return { fetcher, log, request };
}
async function safe(response: Response) {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('location')).toBeNull();
  expect(response.headers.get('www-authenticate')).toBeNull();
  const body = await response.text();
  expect(JSON.stringify([...response.headers]) + body).not.toContain(token);
  return body;
}

describe('server-only vault BFF boundary', () => {
  it('projects a valid tree and makes a fresh fixed authenticated request', async () => {
    const { request, fetcher } = setup();
    const response = await request('/api/vault/tree', { headers: { authorization: 'Bearer browser-secret', cookie: 'session=private', 'x-forwarded-host': 'evil.test', 'tailscale-user-login': 'attacker', origin: transport.config.web.origin, 'sec-fetch-site': 'same-origin' } });
    expect(response.status).toBe(200);
    expect(JSON.parse(await safe(response))).toEqual(tree);
    expect(fetcher).toHaveBeenCalledOnce();
    const [target, init] = fetcher.mock.calls[0];
    expect(String(target)).toBe('http://127.0.0.1:3001/api/vault/tree');
    const headers = new Headers(init?.headers);
    expect([...headers].sort()).toEqual([['accept', 'application/json'], ['authorization', `Bearer ${token}`]]);
    expect(init?.cache).toBe('no-store');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it('encodes a validated component identifier once for the fixed note endpoint', async () => {
    const id = ['folder', 'a % &.md'];
    const { request, fetcher } = setup(async () => json(note));
    const response = await request(`/api/vault/note?${new URLSearchParams({ id: JSON.stringify(id) })}`);
    expect(response.status).toBe(200);
    expect(JSON.parse(await safe(response))).toEqual(note);
    const target = new URL(String(fetcher.mock.calls[0][0]));
    expect(target.origin + target.pathname).toBe('http://127.0.0.1:3001/api/vault/note');
    expect([...target.searchParams]).toEqual([['id', JSON.stringify(id)]]);
  });
  it.each(['/api/vault/note', '/api/vault/note?id=%ZZ', '/api/vault/note?id=%5B%22..%22%5D', '/api/vault/note?id=%5B%22a.md%22%5D&id=%5B%22b.md%22%5D'])('rejects invalid identifiers before upstream: %s', async path => {
    const { request, fetcher } = setup();
    const response = await request(path);
    expect(response.status).toBe(400);
    expect(JSON.parse(await safe(response))).toMatchObject({ error: { code: 'invalid_request' } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['HEAD', 'OPTIONS', 'POST', 'DELETE'])('rejects %s before upstream', async method => {
    const { request, fetcher } = setup();
    const response = await request('/api/vault/tree', { method });
    expect(response.status).toBe(405);
    await safe(response);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects arbitrary routes without contacting the daemon', async () => {
    const { request, fetcher } = setup();
    const response = await request('/api/files?url=http://evil.test');
    expect(response.status).toBe(404);
    await safe(response);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { host: 'evil.test', 'x-forwarded-host': '127.0.0.1:3000' },
    { origin: 'null' }, { origin: 'http://evil.test' }, { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ])('denies browser policy violations without upstream call %o', async headers => {
    const { request, fetcher } = setup();
    const response = await request('/api/vault/tree', { headers });
    expect(response.status).toBe(403);
    await safe(response);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('enforces tailnet identity at the relay before upstream', async () => {
    const selected: LoadedTransport = { ...transport, config: { ...transport.config, web: { mode: 'tailscale', origin: 'https://recall.example.test:9443', allowedLogin: 'person@example.test' } } };
    const { request, fetcher } = setup(undefined, selected);
    const response = await request('/api/vault/tree', { headers: { host: 'recall.example.test:9443', 'tailscale-user-login': 'other@example.test' } });
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    await safe(response);
  });
  it.each(['config_missing', 'config_invalid', 'vault_unavailable'] as const)('projects known canonical %s error', async code => {
    const { request } = setup(async () => json({ error: { code, message: 'Unavailable' } }, 503));
    const response = await request('/api/vault/tree');
    expect(response.status).toBe(503);
    expect(JSON.parse(await safe(response))).toMatchObject({ error: { code } });
  });
  it('projects the canonical unavailable-note error', async () => {
    const { request } = setup(async () => json({ error: { code: 'note_unavailable', message: 'Unavailable' } }, 404));
    const response = await request('/api/vault/note?id=%5B%22a.md%22%5D');
    expect(response.status).toBe(404);
    expect(JSON.parse(await safe(response))).toMatchObject({ error: { code: 'note_unavailable' } });
  });
  it.each([
    ['config_missing', 503, 'Vault configuration is missing'],
    ['config_invalid', 503, 'Vault configuration is invalid'],
    ['vault_unavailable', 503, 'Vault directory is unavailable'],
    ['note_unavailable', 404, 'Note is unavailable'],
    ['invalid_request', 400, 'Invalid note identifier'],
  ])('uses the canonical message and matching status for %s', async (code, status, message) => {
    const { request } = setup(async () => json({ error: { code, message: 'private upstream detail' } }, status));
    const response = await request('/api/vault/tree');
    expect(response.status).toBe(status);
    expect(JSON.parse(await safe(response))).toEqual({ error: { code, message } });
  });
  it.each([
    ['unauthorized', () => json({ error: { code: 'unauthorized', message: 'secret internal' } }, 401)],
    ['known code with wrong status', () => json({ error: { code: 'note_unavailable', message: 'secret internal' } }, 503)],
    ['inherited property code', () => json({ error: { code: 'toString', message: 'secret internal' } }, 503)],
    ['unknown status', () => json({ private: 'upstream-sensitive' }, 418)],
    ['HTML', () => new Response('<html>upstream-sensitive</html>', { status: 200 })],
    ['invalid JSON', () => new Response('{upstream-sensitive', { headers: { 'content-type': 'application/json' } })],
    ['wrong tree shape', () => json({ entries: [{ kind: 'directory', name: 'upstream-sensitive', id: [], children: 'wrong' }] })],
    ['redirect', () => new Response(null, { status: 302, headers: { location: 'http://evil.test/upstream-sensitive' } })],
  ])('sanitizes %s as service unavailable', async (_label, makeResponse) => {
    const { request, log } = setup(async () => makeResponse());
    const response = await request('/api/vault/tree');
    expect(response.status).toBe(503);
    const body = await safe(response);
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'service_unavailable' } });
    expect(body + JSON.stringify(log.mock.calls)).not.toMatch(/upstream-sensitive|secret internal|Bearer/);
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });
  it('sanitizes fetch timeout and raw exception details', async () => {
    const { request, log } = setup(async () => { throw new Error('private-path fixture-secret'); });
    const response = await request('/api/vault/tree');
    expect(response.status).toBe(503);
    const body = await safe(response);
    expect(body + JSON.stringify(log.mock.calls)).not.toMatch(/private-path|fixture-secret/);
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'service_unavailable' } });
  });
  it('bounds an upstream request that never completes', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('private timeout details')), { once: true });
      }));
      const pending = handleVaultRequest(new Request('http://127.0.0.1:3000/api/vault/tree', { headers: { host: '127.0.0.1:3000' } }), { transport, fetch: fetcher, log: vi.fn() });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(fetcher).toHaveBeenCalledOnce();
      const response = await pending;
      expect(response.status).toBe(503);
      const body = await safe(response);
      expect(body).not.toContain('private timeout details');
      expect(JSON.parse(body)).toMatchObject({ error: { code: 'service_unavailable' } });
    } finally { vi.useRealTimers(); }
  });
  it('never passes upstream response headers through', async () => {
    const { request } = setup(async () => json(tree, 200, { 'set-cookie': 'private=1', location: 'http://evil.test/', 'www-authenticate': 'Basic' }));
    const response = await request('/api/vault/tree');
    expect(response.status).toBe(200);
    await safe(response);
  });
});
