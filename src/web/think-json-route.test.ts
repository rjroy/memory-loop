import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LoadedTransport } from '../../backend/transport';
import { classifyThinkJsonRoute } from './think-json-route';
import { handleThinkRequest, type ThinkBffDependencies } from './think-bff';

// This marker prevents client imports in Next; it has no behavior in these server tests.
vi.mock('server-only', () => ({}));
import { thinkDaemonFetch } from './think-daemon-http';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const base = '/api/think/conversations';
const snapshot = `${base}/${id}`;
const content = `${snapshot}/content/${other}`;
const query = `generation=${id}&through=7&offset=0`;
const cursor = `page.${'a'.repeat(64)}`;
const token = 'a'.repeat(64);
const transport: LoadedTransport = { config: { daemonOrigin: 'http://127.0.0.1:3001', web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }, serviceToken: token };
const routes = [
  ['POST', base, 'create'], ['GET', snapshot, 'snapshot'], ['GET', `${snapshot}/commands/${other}`, 'command'],
  ['GET', `${content}?${query}`, 'content'], ['POST', `${snapshot}/messages`, 'send'],
  ['POST', `${snapshot}/runs/${other}/stop`, 'stop'], ['GET', `${snapshot}/decisions`, 'decisions'],
  ['GET', `${snapshot}/decisions/form_1`, 'decision'], ['POST', `${snapshot}/decisions/form_1/reply`, 'reply'],
] as const;
const invalid = [
  `${base}/ses_native`, `${base}/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA`, `${base}/11111111-1111-0111-8111-111111111111`,
  `${snapshot}/events`, `${snapshot}/messages/extra`, `${snapshot}/decisions/${'x'.repeat(129)}`, `${snapshot}/decisions/form%2Fother`,
  `${snapshot}?&`, `${snapshot}?cursor=${cursor}&cursor=${cursor}`, `${snapshot}?cursor=bad`,
  content, `${content}?${query}&offset=0`, `${content}?${query}&other=1`, `${content}?generation=${id}&through=7&offset=1`,
  `${content}?generation=${id}&through=7&offset=8&transfer=${other}`, `${content}?generation=${id}&through=9007199254740992&offset=0`,
  `${content}?generation=${id}&through=07&offset=0`,
];

describe('Think JSON target classification', () => {
  it.each(routes)('classifies %s %s', (method, path, operation) => {
    expect(classifyThinkJsonRoute(new URL(path, 'http://127.0.0.1:3000'), method)).toMatchObject({ method, operation });
  });
  it.each(invalid)('rejects invalid GET target %s', path => {
    expect(classifyThinkJsonRoute(new URL(path, 'http://127.0.0.1:3000'), 'GET')).toBeUndefined();
  });
  it('uses the incoming method for query rules, including wrong-method content', () => {
    expect(classifyThinkJsonRoute(new URL(content, 'http://localhost'), 'POST')).toMatchObject({ operation: 'content', method: 'GET' });
    expect(classifyThinkJsonRoute(new URL(`${content}?${query}`, 'http://localhost'), 'POST')).toBeUndefined();
    expect(classifyThinkJsonRoute(new URL(`${snapshot}?cursor=${cursor}`, 'http://localhost'), 'GET')).toMatchObject({ operation: 'snapshot' });
    expect(classifyThinkJsonRoute(new URL(`${content}?generation=${id}&through=7&offset=1&transfer=${other}`, 'http://localhost'), 'GET')).toMatchObject({ operation: 'content' });
    expect(classifyThinkJsonRoute(new URL(`${snapshot}#fragment`, 'http://localhost'), 'GET')).toBeUndefined();
  });
});

describe('Think BFF target policy', () => {
  const upstream = () => Response.json({ error: { code: 'not_found', message: 'private upstream message' } }, { status: 404 });
  function setup() {
    const fetcher = vi.fn<ThinkBffDependencies['fetch']>(async () => upstream());
    const call = (method: string, path: string, host = '127.0.0.1:3000') => handleThinkRequest(new Request(`http://127.0.0.1:3000${path}`, {
      method, headers: { host, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) }, ...(method === 'POST' ? { body: '{}' } : {}),
    }), { transport, fetch: fetcher, log: vi.fn() });
    return { fetcher, call };
  }
  it.each(routes)('dispatches the fixed route %s %s', async (method, path) => {
    const { call, fetcher } = setup();
    const result = await call(method, path);
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: { code: 'not_found', message: 'Think resource not found' } });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(invalid)('does not dispatch invalid GET %s', async path => {
    const { call, fetcher } = setup();
    expect((await call('GET', path)).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('preserves denial and wrong-method precedence without upstream calls', async () => {
    const { call, fetcher } = setup();
    expect((await call('POST', `${content}?${query}`, 'evil.example')).status).toBe(403);
    expect((await call('POST', content)).status).toBe(405);
    expect((await call('POST', `${content}?${query}`)).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('forwards the validated cursor unchanged', async () => {
    const { call, fetcher } = setup();
    await call('GET', `${snapshot}?cursor=${cursor}`);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0][0])).toBe(`${transport.config.daemonOrigin}${snapshot}?cursor=${cursor}`);
  });
});

describe('Think daemon HTTP target policy', () => {
  let origin: string;
  let calls: string[] = [];
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture address unavailable');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  it('dispatches only fixed valid routes and rejects malformed targets before the socket', async () => {
    calls = [];
    for (const [method, path] of routes) {
      expect((await thinkDaemonFetch(new URL(path, origin), { method, token, signal: new AbortController().signal })).status).toBe(200);
    }
    expect(calls).toHaveLength(routes.length);
    for (const path of invalid) {
      await expect(thinkDaemonFetch(new URL(path, origin), { method: 'GET', token, signal: new AbortController().signal })).rejects.toThrow('Invalid Think target');
    }
    for (const path of [content, `${content}?${query}`]) {
      await expect(thinkDaemonFetch(new URL(path, origin), { method: 'POST', token, signal: new AbortController().signal })).rejects.toThrow('Invalid Think target');
    }
    await expect(thinkDaemonFetch(new URL(snapshot, origin), { method: 'GET', token: 'invalid', signal: new AbortController().signal })).rejects.toThrow('Invalid Think target');
    await expect(thinkDaemonFetch(new URL(`http://localhost${snapshot}`), { method: 'GET', token, signal: new AbortController().signal })).rejects.toThrow('Invalid Think target');
    expect(calls).toHaveLength(routes.length);
  });
});
