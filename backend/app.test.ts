import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppOptions, type VaultState } from './app';
import type { VaultReader } from './vault';

const authority = '127.0.0.1:3000';
const origin = 'http://127.0.0.1:5173';
const secret = '/test-owned/private-host-path/note.md';
const token = 'a'.repeat(64);

function setup(vault?: VaultState) {
  const reader: VaultReader = {
    tree: vi.fn(async () => ({ entries: [{ kind: 'note' as const, name: 'note.md', id: ['note.md'] }] })),
    note: vi.fn(async () => ({ name: 'note.md', markdown: '# Test note\n', revision: 'fixture', editable: true })),
    save: vi.fn(),
    close: vi.fn(async () => {}),
  };
  const options = { authority, vault: vault ?? { reader }, serviceToken: token } satisfies AppOptions & { serviceToken: string };
  const app = createApp(options);
  const request = (path: string, init: RequestInit = {}, authenticate = true) => {
    const headers = new Headers(init.headers);
    if (!headers.has('host')) headers.set('host', authority);
    if (authenticate && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    return app(new Request(`http://${authority}${path}`, { ...init, headers }));
  };
  return { reader, request };
}

async function expectSafeError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  const body: unknown = await response.json();
  expect(body).toMatchObject({ error: { code, message: expect.any(String) } });
  expect(JSON.stringify(body)).not.toContain(secret);
}

describe('vault HTTP API', () => {
  it('returns the typed tree without caching or cross-origin grants', async () => {
    const { request, reader } = setup();
    const response = await request('/api/vault/tree');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toEqual({ entries: [{ kind: 'note', name: 'note.md', id: ['note.md'] }] });
    expect(reader.tree).toHaveBeenCalledOnce();
  });

  it.each([undefined, `Bearer ${'b'.repeat(64)}`, 'Basic abc', 'Bearer', 'Bearer a', `Bearer ${token}, Bearer ${token}`])(
    'rejects missing, wrong or malformed service credentials before reader calls', async authorization => {
      const { request, reader } = setup();
      const headers = new Headers();
      if (authorization !== undefined) headers.set('authorization', authorization);
      const response = await request('/api/vault/tree', { headers }, false);
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(JSON.stringify([...response.headers])).not.toContain(token);
      const body = await response.text();
      expect(JSON.parse(body)).toMatchObject({ error: { code: 'unauthorized', message: expect.any(String) } });
      expect(body).not.toContain(token);
      expect(body).not.toContain('b'.repeat(64));
      expect(reader.tree).not.toHaveBeenCalled();
      expect(reader.note).not.toHaveBeenCalled();
    },
  );

  it('decodes a nested identifier once and returns the typed note', async () => {
    const { request, reader } = setup();
    const id = ['folder', 'a % name.md'];
    const response = await request(`/api/vault/note?${new URLSearchParams({ id: JSON.stringify(id) })}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ name: 'note.md', markdown: '# Test note\n', revision: 'fixture', editable: true });
    expect(reader.note).toHaveBeenCalledExactlyOnceWith(id);
  });

  it.each([
    '/api/vault/note',
    '/api/vault/note?id=%ZZ',
    '/api/vault/note?id=%5B%22..%22%2C%22secret.md%22%5D',
    '/api/vault/note?id=%5B%22note.md%22%5D&id=%5B%22other.md%22%5D',
  ])('rejects malformed, traversal or ambiguous note identifiers: %s', async path => {
    const { request, reader } = setup();
    await expectSafeError(await request(path), 400, 'invalid_request');
    expect(reader.note).not.toHaveBeenCalled();
  });

  it.each(['config_missing', 'config_invalid', 'vault_unavailable'] as const)(
    'preserves the sanitized startup failure %s', async code => {
      const { request } = setup({ error: code });
      await expectSafeError(await request('/api/vault/tree'), 503, code);
    },
  );

  it('maps unavailable note errors without exposing internal error text', async () => {
    const reader: VaultReader = {
      tree: vi.fn(),
      note: vi.fn(async () => { throw Object.assign(new Error(secret), { code: 'note_unavailable' }); }),
      save: vi.fn(),
      close: vi.fn(),
    };
    const { request } = setup({ reader });
    await expectSafeError(await request('/api/vault/note?id=%5B%22note.md%22%5D'), 404, 'note_unavailable');
  });

  it('does not disclose unexpected service errors', async () => {
    const reader: VaultReader = {
      tree: vi.fn(async () => { throw new Error(secret); }),
      note: vi.fn(),
      save: vi.fn(),
      close: vi.fn(),
    };
    const { request } = setup({ reader });
    await expectSafeError(await request('/api/vault/tree'), 503, 'vault_unavailable');
  });

  it.each<Record<string, string>>([
    { host: 'evil.example:3000' },
    { host: 'localhost:3000' },
    { host: '127.0.0.1:3001' },
    { host: 'evil.example:3000', 'x-forwarded-host': authority },
    { host: 'evil.example:3000', forwarded: `host=${authority}` },
    { origin: 'https://evil.example' },
    { origin },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-origin' },
    { 'sec-fetch-mode': 'cors' },
  ])('rejects untrusted request metadata %o before accessing the vault', async headers => {
    const { request, reader } = setup();
    const response = await request('/api/vault/tree', { headers });
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(reader.tree).not.toHaveBeenCalled();
  });

  it('rejects a missing Host header', async () => {
    const reader: VaultReader = { tree: vi.fn(), note: vi.fn(), save: vi.fn(), close: vi.fn() };
    const options = { authority, vault: { reader }, serviceToken: token };
    const app = createApp(options);
    const response = await app(new Request(`http://${authority}/api/vault/tree`, { headers: { authorization: `Bearer ${token}` } }));
    expect(response.status).toBe(403);
    expect(reader.tree).not.toHaveBeenCalled();
  });

  it('logs attempts and outcomes without credentials, identifiers or internal error details', async () => {
    const logs = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { request } = setup();
    try {
      await request(`/api/vault/note?${new URLSearchParams({ id: JSON.stringify(['fixture-private-name.md']) })}`);
      await request('/api/vault/tree', { headers: { authorization: `Bearer ${'b'.repeat(64)}` } });
      expect(logs.mock.calls.length).toBeGreaterThanOrEqual(4);
      const output = JSON.stringify(logs.mock.calls);
      expect(output).not.toContain(token);
      expect(output).not.toContain('b'.repeat(64));
      expect(output).not.toContain('fixture-private-name.md');
      expect(output).not.toContain(secret);
    } finally { logs.mockRestore(); }
  });

  it.each(['HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'])('rejects %s without touching the vault', async method => {
    const { request, reader } = setup();
    const response = await request('/api/vault/tree', { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(reader.tree).not.toHaveBeenCalled();
  });

  it('does not provide a generic filesystem endpoint', async () => {
    const { request, reader } = setup();
    const response = await request(`/api/files?path=${encodeURIComponent(secret)}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).not.toContain(secret);
    expect(reader.tree).not.toHaveBeenCalled();
    expect(reader.note).not.toHaveBeenCalled();
  });
});
