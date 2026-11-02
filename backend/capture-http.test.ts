import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareServer, type PreparedServer } from './server';

const authority = '127.0.0.1:3001';
const token = 'a'.repeat(64);
const instant = '2025-01-01T04:59:00.000Z'; // 2024-12-31 23:59 in New York
let root: string;
let vault: string;
let server: PreparedServer | undefined;
let originalTimezone: string | undefined;

// Capture HTTP contract: POST /api/capture with exactly {text}; 200 {ok:true}
// confirms a flushed append. Validation failures use 400 invalid_request;
// unsafe/unavailable targets use 503 capture_unavailable (definitely no write).
// A failure after possible write progress uses 503 capture_uncertain; a lost
// response is also uncertain. Neither case authorizes an automatic retry.
// Payload limit: 1 MiB of UTF-8 text; meaningful whitespace is never trimmed.
beforeEach(async () => {
  originalTimezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(instant));
  root = await mkdtemp(join(tmpdir(), 'memory-loop-capture-test-'));
  vault = join(root, 'vault');
  const metadata = join(root, '.memory-loop');
  await mkdir(vault);
  await mkdir(metadata, { mode: 0o700 });
  await writeFile(join(metadata, 'config.json'), JSON.stringify({ vaultDirectory: vault }));
  await writeFile(join(metadata, 'transport.json'), JSON.stringify({ daemonOrigin: `http://${authority}`, web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } }), { mode: 0o600 });
  await writeFile(join(metadata, 'service.token'), token, { mode: 0o600 });
  vi.stubEnv('MEMORY_LOOP_TRANSPORT_FILE', join(metadata, 'transport.json'));
  server = await prepareServer({ projectRoot: root, authority });
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
  await rm(root, { recursive: true, force: true });
});

function request(body: string, headers: Record<string, string> = {}) {
  if (!server) throw new Error('Test server not prepared');
  return server.fetch(new Request(`http://${authority}/api/capture`, {
    method: 'POST', headers: { host: authority, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body,
  }));
}

async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body: unknown = await response.json();
  expect(body).toMatchObject({ error: { code, message: expect.any(String) } });
  expect(JSON.stringify(body)).not.toContain(root);
}

describe('Capture daemon HTTP ownership', () => {
  it('creates a daily note using one server-local instant and preserves multiline text', async () => {
    const response = await request(JSON.stringify({ text: '  first \r\nsecond\r third  ' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await readdir(join(vault, '00_Inbox'))).toEqual(['2024-12-31.md']);
    expect(await readFile(join(vault, '00_Inbox', '2024-12-31.md'), 'utf8'))
      .toBe('- [23:59]   first \n  second\n   third  \n');
  });

  it('appends after existing bytes without a final newline and crosses local midnight', async () => {
    const inbox = join(vault, '00_Inbox');
    await mkdir(inbox);
    const first = join(inbox, '2024-12-31.md');
    await writeFile(first, 'existing\r\nbytes');
    expect((await request(JSON.stringify({ text: 'one' }))).status).toBe(200);
    vi.setSystemTime(new Date('2025-01-01T05:00:00.000Z'));
    expect((await request(JSON.stringify({ text: 'two' }))).status).toBe(200);
    expect(await readFile(first, 'utf8')).toBe('existing\r\nbytes\n- [23:59] one\n');
    expect(await readFile(join(inbox, '2025-01-01.md'), 'utf8')).toBe('- [00:00] two\n');
  });

  it('serializes concurrent writes into complete non-interleaved entries', async () => {
    const texts = Array.from({ length: 16 }, (_, i) => `entry-${i}\ncontinuation-${i}`);
    const responses = await Promise.all(texts.map(text => request(JSON.stringify({ text }))));
    expect(responses.map(response => response.status)).toEqual(texts.map(() => 200));
    const content = await readFile(join(vault, '00_Inbox', '2024-12-31.md'), 'utf8');
    const entries = content.match(/- \[23:59\] entry-\d+\n  continuation-\d+\n/g) ?? [];
    expect(entries.join('')).toBe(content);
    expect(entries.sort()).toEqual(texts.map(text => `- [23:59] ${text.replace('\n', '\n  ')}\n`).sort());
  });

  it.each([
    ['blank', JSON.stringify({ text: ' \r\n\t' }), 'application/json'],
    ['malformed JSON', '{', 'application/json'],
    ['wrong shape', JSON.stringify({ text: 12 }), 'application/json'],
    ['extra field', JSON.stringify({ text: 'valid', path: '../elsewhere' }), 'application/json'],
    ['wrong content type', JSON.stringify({ text: 'valid' }), 'text/plain'],
    ['oversize UTF-8', JSON.stringify({ text: 'é'.repeat(524289) }), 'application/json'],
  ])('rejects %s without creating an inbox', async (_name, body, contentType) => {
    await error(await request(body, { 'content-type': contentType }), 400, 'invalid_request');
    expect(await readdir(vault)).toEqual([]);
  });

  it('enforces service authentication and request origin policy before writing', async () => {
    await error(await request(JSON.stringify({ text: 'private thought' }), { authorization: 'Bearer wrong' }), 401, 'unauthorized');
    await error(await request(JSON.stringify({ text: 'private thought' }), { origin: 'https://evil.example' }), 403, 'forbidden');
    expect(await readdir(vault)).toEqual([]);
  });

  it.each(['inbox symlink', 'file symlink', 'hard link', 'directory target'] as const)(
    'rejects unsafe %s without modifying its target', async kind => {
      const outside = join(root, 'outside');
      await mkdir(outside);
      const target = join(outside, 'target.md');
      await writeFile(target, 'untouched');
      const inbox = join(vault, '00_Inbox');
      const daily = join(inbox, '2024-12-31.md');
      if (kind === 'inbox symlink') await symlink(outside, inbox);
      else {
        await mkdir(inbox);
        if (kind === 'file symlink') await symlink(target, daily);
        if (kind === 'hard link') await link(target, daily);
        if (kind === 'directory target') await mkdir(daily);
      }
      await error(await request(JSON.stringify({ text: 'must not write' })), 503, 'capture_unavailable');
      expect(await readFile(target, 'utf8')).toBe('untouched');
      if (kind === 'inbox symlink') expect(await readdir(outside)).toEqual(['target.md']);
      if (kind === 'directory target') expect(await readdir(daily)).toEqual([]);
    },
  );
});
