import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedTransport } from '../../backend/transport';
import { handleVaultRequest } from './vault-bff';

const transport: LoadedTransport = { config: { daemonOrigin: 'http://127.0.0.1:3001' }, serviceToken: 'a'.repeat(64) };
afterEach(() => vi.useRealTimers());

describe('search BFF deadline', () => {
  it('allows more than five seconds but aborts at the 35 second search budget', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let cleanup: () => void = () => {};
    let result: Response | undefined;
    const pending = handleVaultRequest(new Request('http://127.0.0.1:3000/api/vault/search', {
      method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'content', query: 'needle' }),
    }), { transport, log: vi.fn(), fetch: (_input, init) => new Promise((_resolve, reject) => {
      signal = init?.signal ?? undefined;
      cleanup = () => reject(new Error('fixture cleanup'));
      signal?.addEventListener('abort', () => reject(new Error('private timeout')), { once: true });
    }) }).then(response => { result = response; return response; });
    await vi.advanceTimersByTimeAsync(5_001);
    const pendingAfterMetadataBudget = result === undefined && signal !== undefined && !signal.aborted;
    await vi.advanceTimersByTimeAsync(30_000);
    const abortedInSearchBudget = signal?.aborted;
    cleanup();
    await pending;
    expect(pendingAfterMetadataBudget).toBe(true);
    expect(abortedInSearchBudget).toBe(true);
    expect(result?.status).toBe(503);
    expect(await result?.json()).toMatchObject({ error: { code: 'search_unavailable' } });
  });
});

describe('search BFF projection', () => {
  const request = (body: unknown) => new Request('http://127.0.0.1:3000/api/vault/search', { method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const coverage = { complete: true, filesSearched: 1, skippedFiles: { binary: 0, invalidEncoding: 0, unreadable: 0, changed: 0 }, skippedLines: 0, timedOut: false };
  it('projects only allowlisted fields and rejects unsafe offsets', async () => {
    const value = { mode: 'filename', hits: [{ id: ['note.txt'], name: 'note.txt', path: 'note.txt', field: 'name', positions: [0], score: 1, secret: 'private' }], counts: { matches: 1, files: 1 }, limited: false, coverage, secret: 'private' };
    const deps = { transport, log: vi.fn(), fetch: async () => Response.json(value) };
    const response = await handleVaultRequest(request({ mode: 'filename', query: 'n' }), deps);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('private');
    value.hits[0].positions = [999];
    const invalid = await handleVaultRequest(request({ mode: 'filename', query: 'n' }), deps);
    expect(invalid.status).toBe(503);
    expect(await invalid.json()).toMatchObject({ error: { code: 'search_unavailable' } });
  });
  it('rejects oversized input without dispatching', async () => {
    const fetch = vi.fn();
    const response = await handleVaultRequest(request({ mode: 'content', query: 'x'.repeat(129) }), { transport, log: vi.fn(), fetch });
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not forward private error details', async () => {
    const response = await handleVaultRequest(request({ mode: 'content', query: 'x' }), { transport, log: vi.fn(), fetch: async () => Response.json({ error: { code: 'invalid_request', message: 'private path' } }, { status: 400 }) });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain('private path');
  });
  it('aborts a malformed error response before returning', async () => {
    let signal: AbortSignal | undefined;
    const response = await handleVaultRequest(request({ mode: 'content', query: 'x' }), { transport, log: vi.fn(), fetch: async (_input, init) => { signal = init?.signal ?? undefined; return Response.json({ secret: 'private' }, { status: 503 }); } });
    expect(response.status).toBe(503);
    expect(signal?.aborted).toBe(true);
  });
  it('cancels a stalled upstream body when the browser aborts', async () => {
    const controller = new AbortController();
    let cancelled = false;
    let ready: () => void = () => {};
    const started = new Promise<void>(resolve => { ready = resolve; });
    const browser = new Request('http://127.0.0.1:3000/api/vault/search', { method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'content', query: 'x' }), signal: controller.signal });
    const pending = handleVaultRequest(browser, { transport, log: vi.fn(), fetch: async () => new Response(new ReadableStream({ pull() { ready(); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }) });
    await started;
    controller.abort();
    expect((await pending).status).toBe(503);
    expect(cancelled).toBe(true);
  });
});
