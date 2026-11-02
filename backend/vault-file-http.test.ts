import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app';
import { openVault, type VaultReader } from './vault';

const authority = '127.0.0.1:3001';
const token = 'a'.repeat(64);
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb004300', 'hex');
const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
let fixture: string;
let root: string;
let vault: VaultReader;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'memory-loop-file-http-'));
  root = join(fixture, 'vault');
  await mkdir(root);
  vault = await openVault(root, { renameNoReplace: async (sourceFd, name, targetFd, targetName) => {
    const target = `/proc/self/fd/${targetFd}/${targetName}`;
    try { await lstat(target); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return rename(`/proc/self/fd/${sourceFd}/${name}`, target);
      throw error;
    }
    throw Object.assign(new Error('exists'), { code: 'EEXIST' });
  } });
  app = createApp({ authority, serviceToken: token, vault: { reader: vault } });
});
afterEach(async () => { try { await vault?.close(); } finally { await rm(fixture, { recursive: true, force: true }); } });

function url(endpoint: string, id: string[], extra = '') {
  return `/api/vault/${endpoint}?${new URLSearchParams({ id: JSON.stringify(id) })}${extra}`;
}
function request(path: string, init: RequestInit = {}) {
  return app(new Request(`http://${authority}${path}`, { ...init, headers: { host: authority, authorization: `Bearer ${token}`, ...init.headers } }));
}
const post = (body: unknown) => request('/api/vault/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
type Entry = { name: string; kind: string; id: string[]; identity: string; version: string; children?: Entry[] };

async function descriptorCount(path: string) {
  const fds = await readdir('/proc/self/fd');
  const targets = await Promise.all(fds.map(fd => readlink(`/proc/self/fd/${fd}`).catch(() => '')));
  return targets.filter(target => target === path || target === `${path} (deleted)`).length;
}

describe('vault file daemon HTTP', () => {
  it('shows generic regular files without inspecting their contents and supports move and delete', async () => {
    await mkdir(join(root, 'dest'));
    for (const [name, data] of [['config.json', '{}'], ['main.ts', 'let n = 1'], ['LICENSE', 'license'], ['binary.bin', Buffer.from([0, 255, 1])]] as const) await writeFile(join(root, name), data);
    const tree = await (await request('/api/vault/tree')).json() as { entries: Entry[] };
    for (const name of ['config.json', 'main.ts', 'LICENSE', 'binary.bin']) {
      expect(tree.entries.find(e => e.name === name)).toMatchObject({ kind: 'file', id: [name], identity: expect.any(String), version: expect.any(String) });
    }
    const file = tree.entries.find(e => e.name === 'binary.bin');
    const dest = tree.entries.find(e => e.name === 'dest');
    if (!file || !dest) throw new Error('missing fixture');
    const moved = await post({ action: 'move', kind: 'file', id: file.id, expectedVersion: file.version, destinationParentId: dest.id, expectedDestinationIdentity: dest.identity });
    expect(moved.status).toBe(200);
    expect(await readFile(join(root, 'dest', 'binary.bin'))).toEqual(Buffer.from([0, 255, 1]));
    const updated = await (await request('/api/vault/tree')).json() as { entries: Entry[] };
    const movedEntry = updated.entries.find(e => e.name === 'dest')?.children?.find(e => e.name === 'binary.bin');
    if (!movedEntry) throw new Error('missing moved fixture');
    expect((await post({ action: 'delete', kind: 'file', id: movedEntry.id, expectedVersion: movedEntry.version })).status).toBe(200);
    await expect(lstat(join(root, 'dest', 'binary.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([['config.json', '{"hello":"世界"}'], ['main.ts', 'export const a = 1;'], ['LICENSE', 'License text']])('returns complete UTF-8 text for %s', async (name, text) => {
    await writeFile(join(root, name), text);
    const response = await request(url('file', [name]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name, kind: 'text', text });
  });
  it('enforces the byte limit without truncation or replacement characters', async () => {
    const text = 'é'.repeat(1024 * 1024);
    await writeFile(join(root, 'exact.txt'), text);
    await writeFile(join(root, 'large.txt'), `${text}a`);
    await writeFile(join(root, 'invalid.txt'), Buffer.from([0x61, 0xc3, 0x28]));
    expect(await (await request(url('file', ['exact.txt']))).json()).toEqual({ name: 'exact.txt', kind: 'text', text });
    for (const name of ['large.txt', 'invalid.txt']) expect(await (await request(url('file', [name]))).json()).toEqual({ name, kind: 'unsupported' });
  });
  it.each([['photo.dat', png, 'image', 'image/png'], ['photo.jpg', jpeg, 'image', 'image/jpeg'], ['clip.bin', mp4, 'video', 'video/mp4']] as const)('detects %s by bytes', async (name, bytes, kind, contentType) => {
    await writeFile(join(root, name), bytes);
    const response = await request(url('file', [name]));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name, kind, contentType });
  });
  it.each(['spoof.txt', 'spoof.png', 'active.svg'])('never serves active %s inline', async name => {
    await writeFile(join(root, name), '<html><script>alert(1)</script></html>');
    const metadata = await request(url('file', [name]));
    expect(metadata.status).toBe(200);
    expect(['text', 'unsupported']).toContain((await metadata.json() as { kind: string }).kind);
    const response = await request(url('content', [name]));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment\b/i);
    expect(response.headers.get('content-security-policy')).toBe('sandbox');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    await response.arrayBuffer();
  });
  it('serves ranges and ignores Range on HEAD', async () => {
    await writeFile(join(root, 'clip.mp4'), Buffer.concat([mp4, Buffer.from('0123456789')]));
    const data = await readFile(join(root, 'clip.mp4'));
    for (const [range, start, end] of [['bytes=2-5', 2, 5], ['bytes=5-', 5, data.length - 1], ['bytes=-4', data.length - 4, data.length - 1]] as const) {
      const response = await request(url('content', ['clip.mp4']), { headers: { range } });
      expect(response.status).toBe(206);
      expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${data.length}`);
      expect(response.headers.get('content-length')).toBe(String(end - start + 1));
      expect(Buffer.from(await response.arrayBuffer())).toEqual(data.subarray(start, end + 1));
    }
    const head = await request(url('content', ['clip.mp4']), { method: 'HEAD', headers: { range: 'bytes=0-2' } });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(data.length));
    expect(head.headers.get('content-range')).toBeNull();
    expect(head.body).toBeNull();
    expect(await descriptorCount(join(root, 'clip.mp4'))).toBe(0);
  });
  it('distinguishes malformed, multirange and unsatisfiable requests', async () => {
    await writeFile(join(root, 'data.bin'), '0123456789');
    for (const range of ['bytes=0-1,3-4', 'bytes=abc', 'items=0-1']) {
      const response = await request(url('content', ['data.bin']), { headers: { range } });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    }
    const response = await request(url('content', ['data.bin']), { headers: { range: 'bytes=99-' } });
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
    await response.body?.cancel();
  });
  it('uses safe Unicode download disposition and never leaks unsafe headers', async () => {
    const name = 'résumé "photo".png';
    await writeFile(join(root, name), png);
    const response = await request(url('content', [name], '&download=1'));
    expect(response.status).toBe(200);
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^attachment\b/i);
    expect(disposition).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1])).toBe(name);
    expect(disposition).not.toMatch(/[\r\n]/);
    await response.arrayBuffer();
  });
  it('pins the opened file for sniffing and streaming and releases it on cancel', async () => {
    const path = join(root, 'photo.png');
    await writeFile(path, Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024, 7)]));
    const response = await request(url('content', ['photo.png']));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    await rename(path, join(root, 'original'));
    await writeFile(path, '<script>replacement</script>');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing body');
    const first = await reader.read();
    expect(Buffer.from(first.value ?? []) .subarray(0, png.length)).toEqual(png);
    expect((first.value?.byteLength ?? 0)).toBeLessThanOrEqual(256 * 1024);
    await reader.cancel();
    expect(await descriptorCount(join(root, 'original'))).toBe(0);
  });
  it('sniffs and streams the same descriptor even when the pathname changes between them', async () => {
    const path = join(root, 'photo.png');
    await writeFile(path, png);
    await vault.close();
    vault = await openVault(root, { afterContentSniff: async () => {
      await rename(path, join(root, 'original'));
      await writeFile(path, '<html>replacement</html>');
    } });
    app = createApp({ authority, serviceToken: token, vault: { reader: vault } });
    const response = await request(url('content', ['photo.png']));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(await descriptorCount(join(root, 'original'))).toBe(0);
  });
  it('rejects symlinks, directories, escapes and missing entries with sanitized errors', async () => {
    await writeFile(join(fixture, 'secret'), 'secret');
    await symlink(join(fixture, 'secret'), join(root, 'link'));
    await symlink(fixture, join(root, 'dirlink'));
    await mkdir(join(root, 'directory'));
    for (const endpoint of ['file', 'content']) {
      for (const id of [['link'], ['dirlink', 'secret'], ['directory'], ['missing']]) {
        const response = await request(url(endpoint, id));
        expect(response.status).toBe(404);
        const body = await response.text();
        expect(JSON.parse(body)).toMatchObject({ error: { code: 'entry_unavailable' } });
        expect(body).not.toContain(fixture);
      }
      const invalid = await request(url(endpoint, ['..', 'secret']));
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_request' } });
    }
  });
});
