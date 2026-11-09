import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedTransport } from '../../backend/transport';
import { handleVaultRequest } from './vault-bff';

const token = 'a'.repeat(64);
const transport: LoadedTransport = { config: { daemonOrigin: 'http://127.0.0.1:3001' }, serviceToken: token };
const path = '/api/vault/attachments?name=owned.bin';
function setup(fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetcher = vi.fn(fetch);
  const log = vi.fn<(event: string, details: Record<string, unknown>) => void>();
  const send = (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('host')) headers.set('host', '127.0.0.1:3000');
    return handleVaultRequest(new Request(`http://127.0.0.1:3000${url}`, { ...init, headers }), { transport, fetch: fetcher, log });
  };
  return { fetcher, send, log };
}
function bodyInit(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}): RequestInit & { duplex: 'half' } {
  return { method: 'POST', headers: { 'content-type': 'application/octet-stream', ...headers }, body, duplex: 'half' };
}
afterEach(() => vi.useRealTimers());

describe('upload Next boundary', () => {
  it('reports an attachment limit lookup failure without exposing private details', async () => {
    const { send, log } = setup(async () => { throw Object.assign(new Error('private upload detail'), { code: 'ECONNREFUSED' }); });
    const response = await send('/api/vault/attachments');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'upload_unavailable' } });
    const attempt = log.mock.calls.find(([event]) => event === 'vault_bff_attempt');
    expect(attempt?.[1].requestId).toEqual(expect.any(String));
    expect(log).toHaveBeenCalledWith('vault_bff_outcome', expect.objectContaining({
      operation: 'attachments', requestId: attempt?.[1].requestId, status: 503, code: 'ECONNREFUSED', category: expect.any(String),
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('private upload detail');
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });
  it('gets and projects the daemon limit via the fixed service credential', async () => {
    const { send, fetcher } = setup(async () => Response.json({ maxFileBytes: 7, private: 'discard' }));
    const response = await send('/api/vault/attachments');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ maxFileBytes: 7 });
    const [target, init] = fetcher.mock.calls[0];
    expect(String(target)).toBe('http://127.0.0.1:3001/api/vault/attachments');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
  });
  it('rejects a known zero-length upload when the incoming body is null', async () => {
    const { send, fetcher } = setup(async () => Response.json({ maxFileBytes: 4 }));
    const response = await send(path, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': '0' } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects an empty streamed body even when its length is not declared', async () => {
    const { send } = setup(async (_input, init) => {
      if ((init?.method ?? 'GET') === 'GET') return Response.json({ maxFileBytes: 4 });
      if (!(init?.body instanceof ReadableStream)) throw new Error('expected streaming request');
      const reader = init.body.getReader();
      try { while (!(await reader.read()).done) { /* Consume the stream. */ } } catch { /* Rejected empty source. */ }
      return Response.json({ error: { code: 'invalid_request', message: 'Invalid request' } }, { status: 400 });
    });
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const response = await send(path, bodyInit(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });
  it.each([undefined, '1', 'bad'])('rejects an absent body without a valid zero length (%s) before upstream', async length => {
    const { send, fetcher } = setup(async () => Response.json({ maxFileBytes: 4 }));
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
    if (length !== undefined) headers['content-length'] = length;
    const response = await send(path, { method: 'POST', headers });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('enforces its own advertised byte limit despite a misleading Content-Length', async () => {
    let received = 0;
    const { send } = setup(async (_input, init) => {
      if ((init?.method ?? 'GET') === 'GET') return Response.json({ maxFileBytes: 4 });
      if (!(init?.body instanceof ReadableStream)) throw new Error('expected streamed request');
      try {
        const reader = init.body.getReader();
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; received += chunk.value.byteLength; }
      } catch { /* A BFF byte-limit rejection may cancel the upstream body. */ }
      return Response.json({ id: ['06_Attachments', 'owned.bin'], name: 'owned.bin', size: received });
    });
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.enqueue(new Uint8Array([4, 5])); c.close(); } });
    const response = await send(path, bodyInit(body, { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'upload_too_large' } });
    expect(received).toBeLessThanOrEqual(4);
  });
  it.each<Record<string, string>>([{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }])('rejects browser policy violations %o before daemon calls', async headers => {
    const { send, fetcher } = setup(async () => Response.json({ maxFileBytes: 4 }));
    const response = await send('/api/vault/attachments', { headers });
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['/api/vault/attachments?name=a&name=b', '/api/vault/attachments?name=a&id=%5B%22x%22%5D', '/api/vault/attachments?name=%ZZ'])('rejects malformed upload query %s before contacting the daemon', async url => {
    const { send, fetcher } = setup(async () => Response.json({ maxFileBytes: 4 }));
    const response = await send(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'a' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('treats a lost acknowledgement after the complete body as uncertain without retrying', async () => {
    const { send, fetcher } = setup(async (_input, init) => {
      if ((init?.method ?? 'GET') === 'GET') return Response.json({ maxFileBytes: 100 });
      if (!(init?.body instanceof ReadableStream)) throw new Error('expected streamed request');
      const reader = init.body.getReader();
      for (;;) { const item = await reader.read(); if (item.done) break; }
      throw new Error('private acknowledgement loss');
    });
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.close(); } });
    const response = await send(path, bodyInit(body));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'upload_uncertain' } });
    expect(text).not.toContain('private acknowledgement loss');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('allows a progressing upload lasting more than 15 seconds without a response-header deadline', async () => {
    vi.useFakeTimers();
    const state: { source?: ReadableStreamDefaultController<Uint8Array>; signal?: AbortSignal; dispatched: boolean } = { dispatched: false };
    const { send } = setup(async (_input, init) => {
      if ((init?.method ?? 'GET') === 'GET') return Response.json({ maxFileBytes: 100 });
      state.dispatched = true;
      state.signal = init?.signal ?? undefined;
      if (!(init?.body instanceof ReadableStream)) throw new Error('body must stream');
      const reader = init.body.getReader();
      let size = 0;
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; }
      return Response.json({ id: ['06_Attachments', 'owned.bin'], name: 'owned.bin', size });
    });
    const body = new ReadableStream<Uint8Array>({ start(c) { state.source = c; c.enqueue(new Uint8Array([1])); } });
    let early: Response | undefined;
    const pending = send(path, bodyInit(body)).then(result => { early = result; return result; });
    await vi.advanceTimersByTimeAsync(0);
    if (!state.dispatched) { state.source?.close(); await pending; expect(state.dispatched).toBe(true); return; }
    for (const value of [2, 3]) {
      await vi.advanceTimersByTimeAsync(10_000);
      expect(state.signal?.aborted).toBe(false);
      expect(early).toBeUndefined();
      state.source?.enqueue(new Uint8Array([value]));
    }
    state.source?.close();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ['06_Attachments', 'owned.bin'], name: 'owned.bin', size: 3 });
  });
  it('aborts an upload that stalls before the body completes', async () => {
    vi.useFakeTimers();
    const state: { source?: ReadableStreamDefaultController<Uint8Array>; signal?: AbortSignal; dispatched: boolean; response?: Response; reject?: (error: Error) => void } = { dispatched: false };
    const { send } = setup(async (_input, init) => {
      if ((init?.method ?? 'GET') === 'GET') return Response.json({ maxFileBytes: 100 });
      state.dispatched = true;
      state.signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        state.reject = reject;
        state.signal?.addEventListener('abort', () => reject(new Error('fixture timeout')), { once: true });
      });
    });
    const body = new ReadableStream<Uint8Array>({ start(c) { state.source = c; c.enqueue(new Uint8Array([1])); } });
    const pending = send(path, bodyInit(body)).then(response => { state.response = response; return response; });
    await vi.advanceTimersByTimeAsync(0);
    if (!state.dispatched) { state.source?.close(); await pending; expect(state.dispatched).toBe(true); return; }
    await vi.advanceTimersByTimeAsync(60_001);
    const aborted = state.signal?.aborted;
    const result = state.response;
    if (!aborted) { state.source?.error(new Error('fixture cleanup')); state.reject?.(new Error('fixture cleanup')); }
    await pending;
    expect(aborted).toBe(true);
    expect(result?.status).toBe(503);
    expect(await result?.json()).toMatchObject({ error: { code: 'upload_unavailable' } });
  });
});
