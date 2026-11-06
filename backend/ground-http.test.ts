import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareServer, type PreparedServer } from './server';

const authority = '127.0.0.1:31234';
const token = 'a'.repeat(64);
const prefix = ['03_Resources', 'Memory-Loop'];
const note = (name: string) => [...prefix, `${name}.md`];
const digest = (source: string) => createHash('sha256').update(source, 'utf8').digest('hex');
let root: string;
let project: string;
let vault: string;
let server: PreparedServer | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ground-http-test-'));
  project = join(root, 'project');
  vault = join(root, 'vault');
  const metadata = join(project, '.memory-loop');
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  await mkdir(join(vault, ...prefix), { recursive: true });
  await writeFile(join(metadata, 'config.json'), JSON.stringify({ vaultDirectory: vault }));
  const transportFile = join(metadata, 'transport.json');
  await writeFile(transportFile, JSON.stringify({ daemonOrigin: `http://${authority}`, web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }), { mode: 0o600 });
  await writeFile(join(metadata, 'service.token'), token, { mode: 0o600 });
  vi.stubEnv('MEMORY_LOOP_TRANSPORT_FILE', transportFile);
});
afterEach(async () => {
  try { await server?.close(); } finally { server = undefined; vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});

async function start(ground?: unknown) {
  if (ground !== undefined) await writeFile(join(project, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault, ground }));
  server = await prepareServer({ projectRoot: project, authority });
  const prepared = server;
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('host')) headers.set('host', authority);
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    return prepared.fetch(new Request(`http://${authority}${path}`, { ...init, headers }));
  };
}
const resource = (name: string, content: string | Uint8Array) => writeFile(join(vault, ...note(name)), content);

describe('Ground authenticated daemon resource reads', () => {
  it('reads the four default resources with exact safe data and source revisions', async () => {
    const quick = '\uFEFF# Actions\r\n\r\n## @fixture-skill\r\nA fictional fixture\r\ndescription.\r\n';
    const inspiration = '# Inspiration\n\n## Quote\n> Fictional fixture quote.\n> Second fixture line.\n\nAttribution: Fixture author\nSource: [Fixture source](https://example.test/reference)\n';
    const prompts = '# Prompts\n\n## Question\nFixture first line\nand continuation\n';
    const goals = '# Fixture goals\n\n- [ ] One *fictional* goal\n';
    await Promise.all([resource('quick-actions', quick), resource('inspiration', inspiration), resource('prompts', prompts), resource('goals', goals)]);
    const request = await start();
    const quickResponse = await request('/api/ground/quick-actions');
    expect(quickResponse.status).toBe(200);
    expect(quickResponse.headers.get('cache-control')).toBe('no-store');
    expect(await quickResponse.json()).toEqual({ state: 'ready', noteId: note('quick-actions'), revision: digest(quick), data: { actions: [{ id: '@fixture-skill', skill: '@fixture-skill', description: 'A fictional fixture description.' }] } });
    const quoteResponse = await request('/api/ground/inspiration');
    expect(quoteResponse.status).toBe(200);
    expect(await quoteResponse.json()).toEqual({ state: 'ready', noteId: note('inspiration'), revision: digest(inspiration), data: { quote: { id: expect.stringMatching(/^[a-f0-9]{64}$/), text: 'Fictional fixture quote.\nSecond fixture line.', attribution: 'Fixture author', source: { title: 'Fixture source', url: 'https://example.test/reference' } } } });
    const promptsResponse = await request('/api/ground/prompts');
    expect(promptsResponse.status).toBe(200);
    expect(await promptsResponse.json()).toEqual({ state: 'ready', noteId: note('prompts'), revision: digest(prompts), data: { question: { id: expect.stringMatching(/^[a-f0-9]{64}$/), text: 'Fixture first line and continuation' } } });
    const goalsResponse = await request('/api/ground/goals');
    expect(goalsResponse.status).toBe(200);
    expect(await goalsResponse.json()).toEqual({ state: 'ready', noteId: note('goals'), revision: digest(goals), data: { markdown: goals } });
  });

  it('isolates missing, empty, malformed and ready resources without creating a missing file', async () => {
    await resource('inspiration', '# Inspiration\n\n');
    await resource('prompts', '# Prompts\n\n## Question\nFixture prompt\n\nUnexpected extra paragraph\n');
    await resource('goals', '# Fixture goal\n');
    const request = await start();
    for (const [path, expected] of [
      ['quick-actions', { state: 'missing', noteId: note('quick-actions') }],
      ['inspiration', { state: 'empty', noteId: note('inspiration') }],
      ['prompts', { state: 'malformed', noteId: note('prompts'), issue: { code: 'invalid_format' } }],
      ['goals', { state: 'ready', noteId: note('goals'), revision: digest('# Fixture goal\n'), data: { markdown: '# Fixture goal\n' } }],
    ] as const) {
      const response = await request(`/api/ground/${path}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject(expected);
    }
    await expect(access(join(vault, ...note('quick-actions')))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports an invalid configured path for one resource without disabling its siblings', async () => {
    await resource('goals', 'Fixture goal');
    const request = await start({ resources: { quickActions: '../outside.md' } });
    const invalid = await request('/api/ground/quick-actions');
    expect(invalid.status).toBe(503);
    expect(await invalid.json()).toEqual({ state: 'unavailable', reason: 'configuration' });
    const goals = await request('/api/ground/goals');
    expect(goals.status).toBe(200);
    expect(await goals.json()).toMatchObject({ state: 'ready', data: { markdown: 'Fixture goal' } });
    expect((await request('/api/vault/tree')).status).toBe(200);
  });

  it.each([
    ['invalid UTF-8', Buffer.from([0xff]), 'invalid_utf8'],
    ['over the resource byte bound', Buffer.alloc(65537, 0x61), 'too_large'],
  ] as const)('returns malformed for %s without leaking source bytes', async (_label, content, code) => {
    await resource('goals', content);
    const request = await start();
    const response = await request('/api/ground/goals');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'malformed', noteId: note('goals'), issue: { code } });
  });

  it('does not follow a resource symlink outside the vault', async ({ skip }) => {
    const outside = join(root, 'outside.md');
    await writeFile(outside, 'fixture private outside');
    try { await symlink(outside, join(vault, ...note('goals'))); }
    catch (error) {
      if (process.platform === 'win32' && error instanceof Error && 'code' in error && error.code === 'EPERM') { skip(); return; }
      throw error;
    }
    const request = await start();
    const response = await request('/api/ground/goals');
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ state: 'unavailable', reason: 'io' });
    expect(text).not.toContain('fixture private outside');
    expect(text).not.toContain(root);
  });

  it('orders the latest five capture entries by recorded date, time and offset, not mtime', async () => {
    const inbox = join(vault, '00_Inbox');
    await mkdir(inbox);
    const older = join(inbox, '2026-01-01.md');
    const newer = join(inbox, '2026-01-02.md');
    await writeFile(older, '- [23:59] older fixture\n');
    await writeFile(newer, '- [08:00] first fixture\n- [09:00] second fixture\n  continuation line\n- [09:00] third fixture\n- [10:30] fourth fixture\n- [11:00] fifth fixture\n');
    await utimes(older, new Date('2026-03-01T00:00:00Z'), new Date('2026-03-01T00:00:00Z'));
    await utimes(newer, new Date('2026-02-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));
    const request = await start();
    const response = await request('/api/ground/recent-captures');
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value).toEqual({ state: 'ready', coverage: 'complete', items: [
      ['2026-01-02T11:00', 'fifth fixture'], ['2026-01-02T10:30', 'fourth fixture'], ['2026-01-02T09:00', 'third fixture'],
      ['2026-01-02T09:00', 'second fixture\ncontinuation line'], ['2026-01-02T08:00', 'first fixture'],
    ].map(([localDateTime, excerpt]) => ({ id: expect.stringMatching(/^[a-f0-9]{64}$/), localDateTime, timeBasis: 'recorded-local', excerpt, noteId: ['00_Inbox', '2026-01-02.md'] })) });
    expect(new Set(value.items.map((item: { id: string }) => item.id)).size).toBe(5);
  });

  it('distinguishes a missing Inbox from an inspected Inbox with no captures', async () => {
    const request = await start();
    const missing = await request('/api/ground/recent-captures');
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ state: 'missing' });
    await mkdir(join(vault, '00_Inbox'));
    await writeFile(join(vault, '00_Inbox', '2026-01-01.md'), 'Ordinary fixture prose.\n');
    const empty = await request('/api/ground/recent-captures');
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ state: 'empty' });
  });

  it('enforces existing daemon authentication and browser metadata policy', async () => {
    const request = await start();
    expect((await request('/api/ground/goals', { headers: { authorization: '' } })).status).toBe(401);
    expect((await request('/api/ground/goals', { headers: { origin: 'http://127.0.0.1:3000' } })).status).toBe(403);
    expect((await request('/api/ground/goals', { headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(403);
    expect((await request('/api/ground/goals', { method: 'POST' })).status).toBe(405);
  });
});
