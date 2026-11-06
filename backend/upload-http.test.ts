import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app';
import { prepareServer, type PreparedServer } from './server';
import { openVault, type VaultReader } from './vault';
import { openSafeRoot } from './safe-fs';

const authority = '127.0.0.1:31234';
const token = 'a'.repeat(64);
let fixture: string;
let root: string;
let vault: VaultReader;
let app: ReturnType<typeof createApp>;
let configured: PreparedServer | undefined;

async function start(options: { flushFile?: (file: FileHandle) => Promise<void>; flushDirectory?: (directory: readonly string[]) => Promise<void> } = {}) {
  vault = await openVault(root, options);
  app = createApp({ authority, serviceToken: token, vault: { reader: vault } });
}
beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'memory-loop-upload-http-'));
  root = join(fixture, 'vault');
  await mkdir(root);
  configured = undefined;
  await start();
});
afterEach(async () => {
  try { await configured?.close(); await vault?.close(); }
  finally { await rm(fixture, { recursive: true, force: true }); }
});
function request(path: string, init: RequestInit = {}, fetch = app) {
  const headers = new Headers(init.headers);
  headers.set('host', authority);
  headers.set('authorization', `Bearer ${token}`);
  return fetch(new Request(`http://${authority}${path}`, { ...init, headers }));
}
function post(name: string, body: BodyInit, extra: Record<string, string> = {}, fetch = app) {
  const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { 'content-type': 'application/octet-stream', ...extra }, body, duplex: 'half' };
  return request(`/api/vault/attachments?${new URLSearchParams({ name })}`, init, fetch);
}
async function beforeUploadRelease<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Action blocked behind active upload')), 2000);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
async function prepared(limit: number) {
  const projectRoot = join(fixture, 'project');
  const metadata = join(projectRoot, '.memory-loop');
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  await writeFile(join(metadata, 'config.json'), JSON.stringify({ vaultDirectory: root, recall: { uploads: { maxFileBytes: limit } } }));
  await writeFile(join(metadata, 'transport.json'), JSON.stringify({ daemonOrigin: `http://${authority}` }), { mode: 0o600 });
  await writeFile(join(metadata, 'service.token'), token, { mode: 0o600 });
  const previous = process.env.MEMORY_LOOP_TRANSPORT_FILE;
  process.env.MEMORY_LOOP_TRANSPORT_FILE = join(metadata, 'transport.json');
  try { configured = await prepareServer({ projectRoot, authority }); }
  finally {
    if (previous === undefined) delete process.env.MEMORY_LOOP_TRANSPORT_FILE;
    else process.env.MEMORY_LOOP_TRANSPORT_FILE = previous;
  }
  return configured.fetch;
}

describe('attachment upload daemon boundary', () => {
  it('advertises the default limit without creating the destination', async () => {
    const response = await request('/api/vault/attachments');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ maxFileBytes: 100 * 1024 * 1024 });
    await expect(lstat(join(root, '06_Attachments'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reads the configured limit and counts actual streamed bytes, not Content-Length', async () => {
    const fetch = await prepared(4);
    expect(await (await request('/api/vault/attachments', {}, fetch)).json()).toEqual({ maxFileBytes: 4 });
    const chunks = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.enqueue(new Uint8Array([4, 5])); c.close(); } });
    const response = await post('large.bin', chunks, { 'content-length': '1' }, fetch);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'upload_too_large' } });
    const files = await readdir(join(root, '06_Attachments')).catch(() => []);
    expect(files).toEqual([]);
  });
  it('creates the attachment directory and publishes exact bytes only after EOF', async () => {
    const bytes = Uint8Array.from([0, 255, 10, 13, 5]);
    const response = await post('a % é.bin', bytes);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ['06_Attachments', 'a % é.bin'], name: 'a % é.bin', size: bytes.length });
    expect(await readFile(join(root, '06_Attachments', 'a % é.bin'))).toEqual(Buffer.from(bytes));
    expect(await readdir(join(root, '06_Attachments'))).toEqual(['a % é.bin']);
  });
  it('rejects a known zero-length body when Request.body is null', async () => {
    const response = await request('/api/vault/attachments?name=empty.bin', {
      method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': '0' },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(await readdir(root)).toEqual([]);
  });
  it('rejects an empty streamed body and removes its temporary file', async () => {
    const empty = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
    const response = await post('empty.bin', empty);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(await readdir(join(root, '06_Attachments')).catch(() => [])).toEqual([]);
  });
  it.each([undefined, '1', 'bad'])('rejects an absent body without a valid zero length (%s)', async length => {
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
    if (length !== undefined) headers['content-length'] = length;
    const response = await request('/api/vault/attachments?name=empty.bin', { method: 'POST', headers });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(await readdir(root)).toEqual([]);
  });
  it('keeps the completed temporary file private until the durable publication step', async () => {
    await vault.close();
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const flushing = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    await start({ flushFile: async file => { entered(); await gate; await file.sync(); } });
    const pending = post('private.bin', 'complete');
    try {
      const first = await beforeUploadRelease(Promise.race([flushing.then(() => 'flush' as const), pending.then(() => 'early' as const)]));
      expect(first).toBe('flush');
      const dir = join(root, '06_Attachments');
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^\./);
      expect((await lstat(join(dir, files[0]))).isFile()).toBe(true);
      await expect(lstat(join(dir, 'private.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { release(); await pending.catch(() => {}); }
    expect((await pending).status).toBe(200);
  });
  it('refuses attachment folder actions during publication without blocking unrelated actions, then allows a move', async () => {
    await vault.close();
    await mkdir(join(root, '06_Attachments'));
    await mkdir(join(root, 'destination'));
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const flushing = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let firstFlush = true;
    await start({ flushFile: async file => {
      if (firstFlush) { firstFlush = false; entered(); await gate; }
      await file.sync();
    } });
    const pending = post('finished.bin', 'complete');
    try {
      const first = await beforeUploadRelease(Promise.race([flushing.then(() => 'flush' as const), pending.then(() => 'early' as const)]));
      expect(first).toBe('flush');
      const tree = await vault.tree();
      const folder = tree.entries.find(entry => entry.name === '06_Attachments');
      const destination = tree.entries.find(entry => entry.name === 'destination');
      if (!folder || !destination) throw new Error('Missing fixture directories');
      const move = { action: 'move' as const, kind: 'directory' as const, id: folder.id, expectedVersion: folder.version, destinationParentId: destination.id, expectedDestinationIdentity: destination.identity };
      const remove = { action: 'delete' as const, kind: 'directory' as const, id: folder.id, expectedVersion: folder.version };
      await expect(beforeUploadRelease(vault.action(move))).rejects.toMatchObject({ code: 'entry_conflict' });
      await expect(beforeUploadRelease(vault.action(remove))).rejects.toMatchObject({ code: 'entry_conflict' });
      expect(await beforeUploadRelease(vault.action({ action: 'create-note', parentId: [], expectedParentIdentity: tree.rootIdentity, name: 'unrelated.md' }))).toMatchObject({ id: ['unrelated.md'] });
      const names = await readdir(join(root, '06_Attachments'));
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^\.memory-loop-upload-.*\.tmp$/);
      expect(await readFile(join(root, '06_Attachments', names[0]), 'utf8')).toBe('complete');
      expect(await readdir(join(root, 'destination'))).toEqual([]);
    } finally { release(); await pending.catch(() => {}); }
    expect((await pending).status).toBe(200);
    const current = await vault.tree();
    const folder = current.entries.find(entry => entry.name === '06_Attachments');
    const destination = current.entries.find(entry => entry.name === 'destination');
    if (!folder || !destination) throw new Error('Missing fixture directories');
    await vault.action({ action: 'move', kind: 'directory', id: folder.id, expectedVersion: folder.version, destinationParentId: destination.id, expectedDestinationIdentity: destination.identity });
    expect(await readFile(join(root, 'destination', '06_Attachments', 'finished.bin'), 'utf8')).toBe('complete');
    expect(await readFile(join(root, 'unrelated.md'), 'utf8')).toBe('');
  });

  it('holds folder protection during a partial stream and releases it after failed upload cleanup', async () => {
    await mkdir(join(root, '06_Attachments'));
    let pulled: () => void = () => {};
    const waiting = new Promise<void>(resolve => { pulled = resolve; });
    const state: { controller?: ReadableStreamDefaultController<Uint8Array> } = {};
    const stream = new ReadableStream<Uint8Array>({
      start(value) { state.controller = value; value.enqueue(Buffer.from('partial')); },
      pull() { pulled(); },
    }, { highWaterMark: 0 });
    const pending = post('failed.bin', stream);
    try {
      const first = await beforeUploadRelease(Promise.race([waiting.then(() => 'waiting' as const), pending.then(() => 'early' as const)]));
      expect(first).toBe('waiting');
      const tree = await vault.tree();
      const folder = tree.entries.find(entry => entry.name === '06_Attachments');
      if (!folder) throw new Error('Missing fixture directory');
      await expect(beforeUploadRelease(vault.action({ action: 'delete', kind: 'directory', id: folder.id, expectedVersion: folder.version }))).rejects.toMatchObject({ code: 'entry_conflict' });
      const names = await readdir(join(root, '06_Attachments'));
      expect(names).toHaveLength(1);
      expect(await readFile(join(root, '06_Attachments', names[0]), 'utf8')).toBe('partial');
    } finally {
      try { state.controller?.error(new Error('fixture interrupted')); } catch { /* Stream already settled. */ }
      await pending.catch(() => {});
    }
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'upload_unavailable' } });
    expect(await readdir(join(root, '06_Attachments'))).toEqual([]);
    const tree = await vault.tree();
    const folder = tree.entries.find(entry => entry.name === '06_Attachments');
    if (!folder) throw new Error('Missing fixture directory');
    await vault.action({ action: 'delete', kind: 'directory', id: folder.id, expectedVersion: folder.version });
    await expect(lstat(join(root, '06_Attachments'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('protects the attachment folder during its initial setup', async () => {
    await vault.close();
    await mkdir(join(root, 'destination'));
    const safe = await openSafeRoot(root);
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const flushing = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let firstFlush = true;
    await start({ flushDirectory: async id => {
      if (firstFlush) { firstFlush = false; entered(); await gate; }
      await safe.syncDirectory(id);
    } });
    const pending = post('new.bin', 'content');
    try {
      const first = await beforeUploadRelease(Promise.race([flushing.then(() => 'flush' as const), pending.then(() => 'early' as const)]));
      expect(first).toBe('flush');
      const tree = await vault.tree();
      const folder = tree.entries.find(entry => entry.name === '06_Attachments');
      const destination = tree.entries.find(entry => entry.name === 'destination');
      if (!folder || !destination) throw new Error('Missing fixture directories');
      await expect(beforeUploadRelease(vault.action({ action: 'move', kind: 'directory', id: folder.id, expectedVersion: folder.version, destinationParentId: destination.id, expectedDestinationIdentity: destination.identity }))).rejects.toMatchObject({ code: 'entry_conflict' });
      expect(await readdir(join(root, '06_Attachments'))).toEqual([]);
      expect(await readdir(join(root, 'destination'))).toEqual([]);
    } finally { release(); await pending.catch(() => {}); }
    expect((await pending).status).toBe(200);
    expect(await readFile(join(root, '06_Attachments', 'new.bin'), 'utf8')).toBe('content');
  });
  it('preserves collisions and serializes concurrent publication with suffixes', async () => {
    const dir = join(root, '06_Attachments');
    await mkdir(dir);
    await writeFile(join(dir, 'photo.png'), 'original');
    const results = await Promise.all([post('photo.png', 'first'), post('photo.png', 'second')]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    const names = (await Promise.all(results.map(result => result.json() as Promise<{ name: string }>))).map(result => result.name).sort();
    expect(names).toEqual(['photo (2).png', 'photo (3).png']);
    expect(await readFile(join(dir, 'photo.png'), 'utf8')).toBe('original');
    expect([await readFile(join(dir, names[0]), 'utf8'), await readFile(join(dir, names[1]), 'utf8')].sort()).toEqual(['first', 'second']);
  });
  it.each(['', '.', '..', '.hidden', '../escape', 'a/b', 'a\\b', 'bad\r\nname', 'bad\0name', 'CON.txt', 'nul .txt', 'bad?.png', 'trailing.'])('rejects unsafe basename %o', async name => {
    const response = await post(name, 'x');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    expect(await readdir(root)).toEqual([]);
  });
  it.each(['/api/vault/attachments?name=a&name=b', '/api/vault/attachments?name=a&id=%5B%22x%22%5D', '/api/vault/attachments?name=%ZZ'])('rejects ambiguous or malformed query %s', async path => {
    const response = await request(path, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: 'x' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });
  // Symlink fixtures need elevated privileges on Windows; link tests are POSIX-only.
  it.skipIf(process.platform === 'win32')('rejects a symlinked attachment directory without touching the outside target', async () => {
    const outside = join(fixture, 'outside');
    await mkdir(outside);
    await symlink(outside, join(root, '06_Attachments'));
    const response = await post('escape.bin', 'private');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'upload_unavailable' } });
    expect(await readdir(outside)).toEqual([]);
  });
  it('removes the temporary file on an interrupted upload without publishing partial data', async () => {
    const abort = new AbortController();
    let pulled: () => void = () => {};
    const started = new Promise<void>(resolve => { pulled = resolve; });
    const state: { controller?: ReadableStreamDefaultController<Uint8Array> } = {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { state.controller = controller; controller.enqueue(new Uint8Array([1, 2, 3])); },
      pull() { pulled(); },
    }, { highWaterMark: 0 });
    const init: RequestInit & { duplex: 'half' } = { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: stream, signal: abort.signal, duplex: 'half' };
    const pending = request('/api/vault/attachments?name=partial.bin', init);
    try {
      const first = await beforeUploadRelease(Promise.race([started.then(() => 'pull' as const), pending.then(() => 'early' as const)]));
      expect(first).toBe('pull');
    } finally {
      abort.abort();
      try { state.controller?.error(new Error('fixture interrupted')); } catch { /* The reader may already have cancelled. */ }
      await pending.catch(() => {});
    }
    expect(await readdir(join(root, '06_Attachments')).catch(() => [])).toEqual([]);
  });
  it('refuses uploads if its configured root is replaced', async () => {
    await writeFile(join(root, 'sentinel.txt'), 'original');
    const original = join(fixture, 'original');
    await rename(root, original);
    await mkdir(root);
    await writeFile(join(root, 'sentinel.txt'), 'replacement');
    const response = await post('pinned.bin', 'pinned');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'upload_unavailable' } });
    expect(await readdir(original)).toEqual(['sentinel.txt']);
    expect(await readdir(root)).toEqual(['sentinel.txt']);
    expect(await readFile(join(original, 'sentinel.txt'), 'utf8')).toBe('original');
    expect(await readFile(join(root, 'sentinel.txt'), 'utf8')).toBe('replacement');
  });
  it('reports post-publication directory flush failure as uncertain', async () => {
    await vault.close();
    await mkdir(join(root, '06_Attachments'));
    await start({ flushDirectory: async () => { throw new Error('private flush detail'); } });
    const response = await post('saved.bin', 'complete');
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ error: { code: 'upload_uncertain' } });
    expect(body).not.toContain('private flush detail');
    expect(await readFile(join(root, '06_Attachments', 'saved.bin'), 'utf8')).toBe('complete');
  });
  // POSIX-only: substitutes the attachment directory with a symlink (needs elevation on Windows) and renames it
  // while the temp file handle is open, which Windows refuses with EPERM.
  it.skipIf(process.platform === 'win32')('refuses publication if the attachment namespace changes during the upload', async () => {
    await vault.close();
    const dir = join(root, '06_Attachments');
    const outside = join(fixture, 'outside');
    await mkdir(dir); await mkdir(outside);
    let entered: () => void = () => {};
    let release: () => void = () => {};
    const flushEntered = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    await start({ flushFile: async file => { entered(); await gate; await file.sync(); } });
    const pending = post('race.bin', 'content');
    try {
      const first = await beforeUploadRelease(Promise.race([flushEntered.then(() => 'flush' as const), pending.then(() => 'early' as const)]));
      expect(first).toBe('flush');
      await rename(dir, join(root, 'old-attachments')); await symlink(outside, dir);
    } finally { release(); await pending.catch(() => {}); }
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'upload_unavailable' } });
    expect(await readdir(outside)).toEqual([]);
    const relocated = join(root, 'old-attachments');
    const remaining = await readdir(relocated);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatch(/^\.memory-loop-upload-.*\.tmp$/);
    expect(await readFile(join(relocated, remaining[0]), 'utf8')).toBe('content');
    await expect(lstat(join(relocated, 'race.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
