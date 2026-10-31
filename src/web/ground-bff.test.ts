import { describe, expect, it, vi } from 'vitest';
import type { LoadedTransport } from '../../backend/transport';
import { handleGroundRequest, type GroundBffDependencies } from './ground-bff';

const token = 'a'.repeat(64);
const transport: LoadedTransport = { config: { daemonOrigin: 'http://127.0.0.1:3001', web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }, serviceToken: token };
const revision = 'b'.repeat(64);
const noteId = ['03_Resources', 'Memory-Loop', 'goals.md'];
const goals = (markdown: string) => ({ state: 'ready', noteId, revision, data: { markdown } });
const response = (value: unknown, status = 200) => Response.json(value, { status });

function fixture(upstream: () => Response) {
  const fetcher = vi.fn<GroundBffDependencies['fetch']>(async () => upstream());
  const log = vi.fn<GroundBffDependencies['log']>();
  const get = (path: string) => handleGroundRequest(new Request(`http://127.0.0.1:3000/api/ground/${path}`, { headers: { host: '127.0.0.1:3000' } }), { transport, fetch: fetcher, log });
  return { get, fetcher, log };
}

describe('Ground BFF public response boundary', () => {
  it('preserves nonblank Goals Markdown containing a control character', async () => {
    const markdown = '# Fixture goal\n\n```text\nfixture\u0001inside\n```\n';
    const input = goals(markdown);
    const { get, fetcher } = fixture(() => response(input));
    const result = await get('goals');
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(input);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('accepts 64 KiB of source Markdown even when its JSON escaping exceeds 64 KiB', async () => {
    const markdown = `#${'\n'.repeat(65535)}`;
    const input = goals(markdown);
    expect(Buffer.byteLength(markdown)).toBe(65536);
    expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(65536);
    const { get, fetcher } = fixture(() => response(input));
    const result = await get('goals');
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(input);
    expect(fetcher.mock.calls[0]?.[1].limit).toBe(512 * 1024);
  });

  it('rejects Goals Markdown exceeding the 64 KiB source limit', async () => {
    const input = goals(`#${'é'.repeat(32768)}`);
    expect(Buffer.byteLength(input.data.markdown)).toBe(65537);
    const { get } = fixture(() => response(input));
    const result = await get('goals');
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: { code: 'service_unavailable', message: 'Ground service unavailable' } });
  });

  it.each([
    ['goals', 512 * 1024, { ...goals('Fixture goal'), privatePadding: '' }],
    ['prompts', 64 * 1024, { state: 'ready', noteId: ['03_Resources', 'Memory-Loop', 'prompts.md'], revision, data: { question: { id: 'c'.repeat(64), text: 'Fixture question' } }, privatePadding: '' }],
  ] as const)('enforces %s JSON envelope byte limit exactly', async (route, limit, input) => {
    const initial = JSON.stringify(input);
    const padding = limit - Buffer.byteLength(initial);
    if (padding < 0) throw new Error('Fixture exceeds intended response bound');
    const atLimit = { ...input, privatePadding: 'x'.repeat(padding) };
    const aboveLimit = { ...input, privatePadding: 'x'.repeat(padding + 1) };
    expect(Buffer.byteLength(JSON.stringify(atLimit))).toBe(limit);
    expect(Buffer.byteLength(JSON.stringify(aboveLimit))).toBe(limit + 1);
    const allowed = fixture(() => response(atLimit));
    const good = await allowed.get(route);
    expect(good.status).toBe(200);
    expect(await good.text()).not.toContain('privatePadding');
    expect(allowed.fetcher.mock.calls[0]?.[1].limit).toBe(limit);
    const denied = fixture(() => response(aboveLimit));
    const bad = await denied.get(route);
    expect(bad.status).toBe(503);
    expect(await bad.json()).toEqual({ error: { code: 'service_unavailable', message: 'Ground service unavailable' } });
  });

  it.each([
    ['goals', { ...goals('Fixture goal'), noteId: ['03_Resources', 'Memory-Loop', '..', 'secret.md'] }, 200],
    ['inspiration', { state: 'ready', noteId: ['03_Resources', 'Memory-Loop', 'inspiration.md'], revision, data: { quote: { id: 'c'.repeat(64), text: 'Fixture quote', attribution: 'Fixture author', source: { title: 'Fixture', url: 'https://user:secret@example.test/' } } } }, 200],
    ['goals', { state: 'unavailable', reason: 'io', privateField: 'fixture-private' }, 200],
    ['goals', { ...goals('Fixture goal'), privateField: 'fixture-private' }, 503],
  ] as const)('sanitizes invalid %s upstream identity, URL or status-envelope mismatch', async (route, input, status) => {
    const { get } = fixture(() => response(input, status));
    const result = await get(route);
    expect(result.status).toBe(503);
    const body = await result.text();
    expect(JSON.parse(body)).toEqual({ error: { code: 'service_unavailable', message: 'Ground service unavailable' } });
    expect(body).not.toMatch(/fixture-private|secret|example\.test/);
  });
});
