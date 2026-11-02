import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app';
import { openVault, type VaultReader } from './vault';

const authority = '127.0.0.1:3001';
const token = 'a'.repeat(64);
let root: string;
let vault: VaultReader;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memory-loop-save-http-'));
  await mkdir(join(root, 'vault'));
  await writeFile(join(root, 'vault', 'note.md'), 'original');
  vault = await openVault(join(root, 'vault'));
  app = createApp({ authority, serviceToken: token, vault: { reader: vault } });
});
afterEach(async () => {
  try { await vault?.close(); } finally { await rm(root, { recursive: true, force: true }); }
});
function request(method: string, body?: string, headers: Record<string, string> = {}) {
  return app(new Request(`http://${authority}/api/vault/note${method === 'GET' ? '?id=%5B%22note.md%22%5D' : ''}`, {
    method, headers: { host: authority, authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body,
  }));
}
describe('vault save daemon HTTP', () => {
  it('returns revision and persists a validated save; stale revision is a sanitized conflict', async () => {
    const get = await request('GET');
    expect(get.status).toBe(200);
    const note = await get.json() as { revision: string; editable: boolean };
    expect(note).toMatchObject({ revision: expect.any(String), editable: true });
    const body = JSON.stringify({ id: ['note.md'], markdown: 'changed', expectedRevision: note.revision });
    const saved = await request('POST', body);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ revision: expect.any(String) });
    const conflict = await request('POST', body);
    expect(conflict.status).toBe(409);
    const error = await conflict.text();
    expect(JSON.parse(error)).toMatchObject({ error: { code: 'note_conflict' } });
    expect(error).not.toContain(root);
    expect(await readFile(join(root, 'vault', 'note.md'), 'utf8')).toBe('changed');
  });
  it.each([
    ['wrong content type', JSON.stringify({ id: ['note.md'], markdown: 'changed', expectedRevision: 'r' }), { 'content-type': 'text/plain' }],
    ['extra field', JSON.stringify({ id: ['note.md'], markdown: 'changed', expectedRevision: 'r', path: 'private' }), {}],
    ['invalid id', JSON.stringify({ id: ['..', 'note.md'], markdown: 'changed', expectedRevision: 'r' }), {}],
    ['oversized text', JSON.stringify({ id: ['note.md'], markdown: 'é'.repeat(1024 * 1024 + 1), expectedRevision: 'r' }), {}],
  ])('rejects %s without writing', async (_name, body, headers) => {
    const response = await request('POST', body, headers);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(await readFile(join(root, 'vault', 'note.md'), 'utf8')).toBe('original');
  });
  it('enforces service authentication and origin policy before save', async () => {
    const body = JSON.stringify({ id: ['note.md'], markdown: 'changed', expectedRevision: 'r' });
    expect((await request('POST', body, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await request('POST', body, { origin: 'https://evil.example' })).status).toBe(403);
    expect(await readFile(join(root, 'vault', 'note.md'), 'utf8')).toBe('original');
  });
});
