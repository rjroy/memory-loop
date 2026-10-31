import { describe, expect, it, vi } from 'vitest';
import type { LoadedTransport } from './transport';
import { handleCaptureRequest, type CaptureBffDependencies } from '../src/web/capture-bff';

const token = 'a'.repeat(64);
const transport: LoadedTransport = { config: { daemonOrigin: 'http://127.0.0.1:3001', web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }, serviceToken: token };
const json = (value: unknown, status = 200) => Response.json(value, { status });

function setup(upstream: CaptureBffDependencies['fetch'] = async () => json({ ok: true }), selected = transport) {
  const fetch = vi.fn<CaptureBffDependencies['fetch']>(upstream);
  const log = vi.fn<CaptureBffDependencies['log']>();
  const request = (path = '/api/capture', headers: Record<string, string> = {}, body = JSON.stringify({ text: 'private thought' })) => handleCaptureRequest(new Request(`http://127.0.0.1:3000${path}`, {
    method: 'POST', headers: { host: '127.0.0.1:3000', 'content-type': 'application/json', ...headers }, body,
  }), { transport: selected, fetch, log });
  return { fetch, log, request };
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  const body: unknown = await response.json();
  expect(body).toMatchObject({ error: { code, message: expect.any(String) } });
  expect(JSON.stringify(body)).not.toContain(token);
}

describe('Capture same-origin BFF boundary', () => {
  it('dispatches only the fixed target, service token and body, never browser credentials', async () => {
    const { request, fetch, log } = setup();
    const response = await request('/api/capture', { origin: transport.config.web.origin, 'sec-fetch-site': 'same-origin', authorization: 'Bearer browser-secret', cookie: 'session=browser-secret', 'x-forwarded-host': 'evil.test' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
    const [target, options] = fetch.mock.calls[0];
    expect(target.href).toBe('http://127.0.0.1:3001/api/capture');
    expect(Object.keys(options).sort()).toEqual(['body', 'signal', 'token']);
    expect(options.token).toBe(token);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(new TextDecoder().decode(options.body))).toEqual({ text: 'private thought' });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private thought|browser-secret/);
    expect(JSON.stringify(log.mock.calls)).not.toContain(token);
  });

  it.each<Record<string, string>>([
    { host: 'evil.test', 'x-forwarded-host': '127.0.0.1:3000' },
    { origin: 'http://evil.test' },
    { 'sec-fetch-site': 'cross-site' },
  ])('rejects untrusted browser metadata without dispatch: %o', async headers => {
    const { request, fetch } = setup();
    await expectError(await request('/api/capture', headers), 403, 'forbidden');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects tailnet identity mismatch before dispatch', async () => {
    const selected: LoadedTransport = { ...transport, config: { ...transport.config, web: { mode: 'tailscale', origin: 'https://capture.example.test', allowedLogin: 'user@example.test' } } };
    const { request, fetch } = setup(undefined, selected);
    await expectError(await request('/api/capture', { host: 'capture.example.test', 'tailscale-user-login': 'other@example.test' }), 403, 'forbidden');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['/api/capture?path=other', '/api/elsewhere'])('does not dispatch an unfixed route %s', async path => {
    const { request, fetch } = setup();
    await expectError(await request(path), 404, 'not_found');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', () => new Response('{private upstream', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['wrong success shape', () => json({ ok: true, extra: 'private upstream' })],
    ['mismatched error status', () => json({ error: { code: 'invalid_request', message: 'private upstream' } }, 503)],
    ['unknown error', () => json({ error: { code: 'other', message: 'private upstream' } }, 503)],
    ['wrong content type', () => new Response('private upstream', { status: 200 })],
  ])('treats %s after dispatch as uncertain and sanitizes it', async (_label, makeResponse) => {
    const { request, log, fetch } = setup(async () => makeResponse());
    const response = await request();
    const body = await response.clone().text();
    await expectError(response, 503, 'capture_uncertain');
    expect(fetch).toHaveBeenCalledOnce();
    expect(body + JSON.stringify(log.mock.calls)).not.toContain('private upstream');
  });

  it('treats transport failure after dispatch as uncertain, without retry', async () => {
    const { request, fetch, log } = setup(async () => { throw new Error('private upstream failure'); });
    await expectError(await request(), 503, 'capture_uncertain');
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain('private upstream failure');
  });

  it.each([
    [400, 'invalid_request'],
    [503, 'capture_unavailable'],
    [503, 'capture_uncertain'],
  ] as const)('retains recognized daemon status %s and error %s without exposing its message', async (status, code) => {
    const { request } = setup(async () => json({ error: { code, message: 'private upstream details' } }, status));
    const response = await request();
    expect(await response.clone().text()).not.toContain('private upstream details');
    await expectError(response, status, code);
  });

  it('rejects invalid transport before dispatch as definitely unavailable', async () => {
    const selected: LoadedTransport = { ...transport, config: { ...transport.config, daemonOrigin: 'http://evil.test' } };
    const { request, fetch } = setup(undefined, selected);
    await expectError(await request(), 503, 'capture_unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
});
