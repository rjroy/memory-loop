import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadedTransport } from '../../backend/transport';
import { handleVaultRequest } from './vault-bff';

const transport: LoadedTransport = { config: { daemonOrigin: 'http://127.0.0.1:3001' }, serviceToken: 'a'.repeat(64) };
const path = `/api/vault/content?${new URLSearchParams({ id: JSON.stringify(['fixture.png']) })}`;
function request(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return handleVaultRequest(new Request(`http://127.0.0.1:3000${path}`, { headers: { host: '127.0.0.1:3000' } }), { transport, fetch: fetcher, log: vi.fn() });
}
afterEach(() => vi.useRealTimers());

describe('content transfer bounded upstream waits', () => {
  it('releases an unfinished non-JSON upstream error body before returning 503', async () => {
    vi.useFakeTimers();
    const state: {
      signal?: AbortSignal;
      controller?: ReadableStreamDefaultController<Uint8Array>;
      cancelled: boolean;
      result?: { response: Response; cancelled: boolean; aborted: boolean; timers: number };
    } = { cancelled: false };
    const pending = request(async (_input, init) => {
      state.signal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) { state.controller = controller; controller.enqueue(new TextEncoder().encode('private error')); },
        cancel() { state.cancelled = true; },
      });
      return new Response(body, { status: 500, headers: { 'content-type': 'text/plain' } });
    }).then(response => {
      state.result = { response, cancelled: state.cancelled, aborted: state.signal?.aborted ?? false, timers: vi.getTimerCount() };
      return response;
    });
    await vi.advanceTimersByTimeAsync(0);
    const resultAtReturn = state.result;
    if (!resultAtReturn) state.controller?.close(); // Clean up a broken buffering implementation without hanging the test.
    await pending;
    expect(resultAtReturn).toBeDefined();
    expect(resultAtReturn?.response.status).toBe(503);
    expect(resultAtReturn?.cancelled || resultAtReturn?.aborted).toBe(true);
    expect(resultAtReturn?.timers).toBe(0);
    expect(await resultAtReturn?.response.text()).not.toContain('private error');
  });

  it('cancels an oversized upstream JSON error without waiting for EOF', async () => {
    const state: { signal?: AbortSignal; cancelled: boolean } = { cancelled: false };
    const response = await request(async (_input, init) => {
      state.signal = init?.signal ?? undefined;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 * 6 + 65537)); },
        cancel() { state.cancelled = true; },
      }), { status: 500, headers: { 'content-type': 'application/json' } });
    });
    expect(response.status).toBe(503);
    expect(state.cancelled).toBe(true);
    expect(state.signal?.aborted).toBe(true);
  });

  it('disposes a body erroneously supplied with a HEAD error while preserving its status', async () => {
    const state: { signal?: AbortSignal; cancelled: boolean } = { cancelled: false };
    const response = await handleVaultRequest(new Request(`http://127.0.0.1:3000${path}`, { method: 'HEAD', headers: { host: '127.0.0.1:3000' } }), {
      transport, log: vi.fn(), fetch: async (_input, init) => {
        state.signal = init?.signal ?? undefined;
        return new Response(new ReadableStream<Uint8Array>({ cancel() { state.cancelled = true; } }), { status: 404 });
      },
    });
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
    expect(state.cancelled).toBe(true);
    expect(state.signal?.aborted).toBe(true);
  });

  it('aborts and returns an unavailable response when upstream establishment exceeds 15 seconds', async () => {
    vi.useFakeTimers();
    const state: { signal?: AbortSignal; response?: Response } = {};
    let rejectFetch: (error: Error) => void = () => {};
    const pending = request((_input, init) => new Promise((_resolve, reject) => {
      state.signal = init?.signal ?? undefined;
      rejectFetch = reject;
      state.signal?.addEventListener('abort', () => reject(new Error('private upstream timeout')), { once: true });
    })).then(response => { state.response = response; return response; });
    await vi.advanceTimersByTimeAsync(15_001);
    const abortedInBudget = state.signal?.aborted;
    const resultInBudget = state.response;
    rejectFetch(new Error('fixture cleanup'));
    await pending;
    expect(abortedInBudget).toBe(true);
    expect(resultInBudget?.status).toBe(503);
    expect(await resultInBudget?.text()).not.toContain('private upstream timeout');
  });

  it('bounds a stalled JSON error body after upstream headers', async () => {
    vi.useFakeTimers();
    const state: { signal?: AbortSignal; controller?: ReadableStreamDefaultController<Uint8Array>; response?: Response } = {};
    const pending = request(async (_input, init) => {
      state.signal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({ start(c) { state.controller = c; c.enqueue(new TextEncoder().encode('{')); } });
      state.signal?.addEventListener('abort', () => state.controller?.error(new Error('private stalled body')), { once: true });
      return new Response(body, { status: 404, headers: { 'content-type': 'application/json' } });
    }).then(response => { state.response = response; return response; });
    await vi.advanceTimersByTimeAsync(60_001);
    const abortedInBudget = state.signal?.aborted;
    const resultInBudget = state.response;
    if (!abortedInBudget) state.controller?.error(new Error('fixture cleanup'));
    await pending;
    expect(abortedInBudget).toBe(true);
    expect(resultInBudget?.status).toBe(503);
    expect(await resultInBudget?.text()).not.toContain('private stalled body');
  });

  it('aborts an upstream content body stalled for 60 seconds and terminates the downstream read', async () => {
    vi.useFakeTimers();
    const state: { signal?: AbortSignal; controller?: ReadableStreamDefaultController<Uint8Array> } = {};
    const response = await request(async (_input, init) => {
      state.signal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({ start(c) { state.controller = c; c.enqueue(new Uint8Array([1])); } });
      state.signal?.addEventListener('abort', () => state.controller?.error(new Error('stalled')), { once: true });
      return new Response(body, { headers: { 'content-type': 'image/png' } });
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing body');
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    let settled = false;
    const pending = reader.read().then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(60_001);
    const abortedInBudget = state.signal?.aborted;
    const settledInBudget = settled;
    if (!abortedInBudget) state.controller?.error(new Error('fixture cleanup'));
    await pending;
    expect(abortedInBudget).toBe(true);
    expect(settledInBudget).toBe(true);
  });

  it('resets idle time on progress and permits a transfer much longer than five seconds', async () => {
    vi.useFakeTimers();
    const state: { signal?: AbortSignal; controller?: ReadableStreamDefaultController<Uint8Array> } = {};
    const response = await request(async (_input, init) => {
      state.signal = init?.signal ?? undefined;
      return new Response(new ReadableStream<Uint8Array>({ start(c) { state.controller = c; c.enqueue(new Uint8Array([1])); } }), { headers: { 'content-type': 'image/png' } });
    });
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader || !state.controller) throw new Error('missing stream');
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    for (const byte of [2, 3]) {
      const next = reader.read();
      await vi.advanceTimersByTimeAsync(40_000);
      expect(state.signal?.aborted).toBe(false);
      state.controller.enqueue(new Uint8Array([byte]));
      expect((await next).value).toEqual(new Uint8Array([byte]));
    }
    state.controller.close();
    expect((await reader.read()).done).toBe(true);
  });
});
