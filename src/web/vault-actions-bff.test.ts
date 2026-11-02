import { describe, expect, it, vi } from 'vitest';
import type { LoadedTransport } from '../../backend/transport';
import { handleVaultRequest } from './vault-bff';

const token = 'a'.repeat(64);
const transport: LoadedTransport = { config: { daemonOrigin: 'http://127.0.0.1:3001' }, serviceToken: token };
const payload = { action: 'create-note', parentId: [], expectedParentIdentity: 'root-identity', name: 'note.md' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'set-cookie': 'private=1' } });
function setup(upstream: () => Promise<Response>) {
  const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => upstream());
  const log = vi.fn<(event: string, details: Record<string, unknown>) => void>();
  function request(body: unknown, headers: Record<string, string> = {}) {
    return handleVaultRequest(new Request('http://127.0.0.1:3000/api/vault/actions', {
      method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    }), { transport, fetch: fetcher, log });
  }
  return { request, fetcher, log };
}
describe('vault actions BFF', () => {
  it('forwards one strictly authenticated action and projects its response', async () => {
    const { request, fetcher } = setup(async () => json({ id: ['note.md'], revision: 'revision', private: 'discard' }));
    const response = await request(payload, { cookie: 'browser-secret', authorization: 'Bearer browser-secret', origin: 'http://127.0.0.1:3000' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ['note.md'], revision: 'revision' });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetcher).toHaveBeenCalledOnce();
    const [target, init] = fetcher.mock.calls[0];
    expect(String(target)).toBe('http://127.0.0.1:3001/api/vault/actions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(payload);
    expect([...new Headers(init?.headers)].sort()).toEqual([['accept', 'application/json'], ['authorization', `Bearer ${token}`], ['content-type', 'application/json']]);
    expect(init?.redirect).toBe('error');
  });

  it.each([
    { ...payload, name: 'not-markdown' },
    { ...payload, parentId: ['..'] },
    { ...payload, extra: 'private' },
    { action: 'delete', kind: 'directory', id: [], expectedVersion: 'v' },
    { action: 'move', kind: 'note', id: ['a.md'], expectedVersion: 'v', destinationParentId: [], expectedDestinationIdentity: '' },
  ])('rejects invalid input before dispatch: %o', async body => {
    const { request, fetcher } = setup(async () => json({}));
    const response = await request(body);
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin action before dispatch', async () => {
    const { request, fetcher } = setup(async () => json({}));
    expect((await request(payload, { origin: 'https://evil.example' })).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('projects a known conflict without leaking upstream details', async () => {
    const { request, log, fetcher } = setup(async () => json({ error: { code: 'entry_conflict', message: 'private upstream detail' } }, 409));
    const response = await request(payload);
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'entry_conflict' } });
    expect(text + JSON.stringify(log.mock.calls)).not.toContain('private upstream detail');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['invalid_request', 400], ['entry_unavailable', 404], ['entry_conflict', 409],
    ['entry_exists', 409], ['folder_not_empty', 409], ['move_cross_device', 409],
    ['move_unsupported', 503], ['file_action_unavailable', 503], ['file_action_uncertain', 503],
  ])('preserves the canonical %s error with status %i', async (code, status) => {
    const { request, fetcher } = setup(async () => json({ error: { code, message: 'private upstream detail' } }, status));
    const response = await request(payload);
    expect(response.status).toBe(status);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code } });
    expect(text).not.toContain('private upstream detail');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['lost response', async () => { throw new Error('private transport detail'); }],
    ['invalid success', async () => json({ private: 'private upstream detail' })],
  ])('reports uncertainty and never retries on %s', async (_label, upstream) => {
    const { request, fetcher, log } = setup(upstream);
    const response = await request(payload);
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'file_action_uncertain' } });
    expect(text + JSON.stringify(log.mock.calls)).not.toMatch(/private transport detail|private upstream detail/);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
