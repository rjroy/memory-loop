import { afterEach, expect, it, vi } from 'vitest';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTransport, parseTransport, setupTransport } from './transport';

const roots: string[] = [];
const valid = { daemonOrigin: 'http://127.0.0.1:3001' };
const token = 'a'.repeat(64);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'memory-loop-transport-test-'));
  roots.push(root);
  const metadata = join(root, '.memory-loop');
  await mkdir(metadata, { mode: 0o700 });
  const transportFile = join(metadata, 'transport.json');
  const tokenFile = join(metadata, 'service.token');
  await writeFile(transportFile, JSON.stringify(valid), { mode: 0o600 });
  await writeFile(tokenFile, token, { mode: 0o600 });
  return { root, metadata, transportFile, tokenFile };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('accepts private daemon transport without any browser-origin configuration', async () => {
  const files = await fixture();
  await writeFile(files.transportFile, JSON.stringify({ daemonOrigin: valid.daemonOrigin }));
  expect(await loadTransport(files.transportFile)).toMatchObject({ config: { daemonOrigin: valid.daemonOrigin }, serviceToken: token });
});

it('ignores obsolete web fields rather than requiring a public origin or proxy identity', () => {
  expect(parseTransport({ daemonOrigin: valid.daemonOrigin, web: { mode: 'tailscale', origin: 'http://fixture.test:7319', allowedLogin: '' } })).toMatchObject({ daemonOrigin: valid.daemonOrigin });
});

it.each([null, 'obsolete', { mode: 'loopback', origin: 'http://localhost:9876' },
  { mode: 'reverse-proxy', origin: 'invalid', externalAuth: false },
  { mode: 'tailscale', allowedLogin: '*' }])('discards obsolete web configuration %o', web => {
  expect(parseTransport({ ...valid, web })).toEqual(valid);
});

it.each([
  null, {}, { ...valid, daemonOrigin: 'http://localhost:3001' },
  { ...valid, daemonOrigin: 'https://127.0.0.1:3001' },
  { ...valid, daemonOrigin: 'http://user:password@127.0.0.1:3001' },
  { ...valid, daemonOrigin: 'http://127.0.0.1:3001/path' },
  { ...valid, daemonOrigin: 'http://127.0.0.1:3001?x=1' },
  { ...valid, daemonOrigin: 'http://127.0.0.1:3001#fragment' },
])('rejects unsafe or malformed transport configuration', value => {
  expect(() => parseTransport(value)).toThrow(expect.objectContaining({ code: 'transport_invalid' }));
});

it('loads a transport file and sibling token', async () => {
  const files = await fixture();
  expect(await loadTransport(files.transportFile)).toEqual({ config: valid, serviceToken: token });
});

it.skipIf(process.platform === 'win32')('loads transport with accessible non-owner-only fixture modes', async () => {
  const files = await fixture();
  await chmod(files.metadata, 0o755);
  await chmod(files.transportFile, 0o644);
  await chmod(files.tokenFile, 0o644);
  expect(await loadTransport(files.transportFile)).toEqual({ config: valid, serviceToken: token });
});

it.skipIf(process.platform === 'win32')('sets up transport in an accessible non-owner-only metadata directory', async () => {
  const files = await fixture();
  await chmod(files.metadata, 0o755);
  await rm(files.transportFile);
  await rm(files.tokenFile);
  await setupTransport(files.root);
  const loaded = await loadTransport(files.transportFile);
  expect(loaded.config).toEqual(valid);
  expect(loaded.serviceToken).toMatch(/^[a-f0-9]{64}$/);
});

it.each(['bad token', 'missing token', 'transport directory', 'token directory'] as const)(
  'fails closed with a sanitized error for %s', async problem => {
    const files = await fixture();
    if (problem === 'transport directory') { await rm(files.transportFile); await mkdir(files.transportFile); }
    if (problem === 'token directory') { await rm(files.tokenFile); await mkdir(files.tokenFile); }
    if (problem === 'bad token') await writeFile(files.tokenFile, 'not-a-token');
    if (problem === 'missing token') await rm(files.tokenFile);
    const error: unknown = await loadTransport(files.transportFile).then(
      () => { throw new Error('Expected invalid transport to be rejected'); },
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: expect.stringMatching(/^transport_(invalid|unavailable)$/) });
    if (error instanceof Error) {
      expect(error.message).not.toContain(files.root);
      expect(error.message).not.toContain(token);
    }
  },
);

it('creates transport metadata without reading or changing vault config and refuses replacement', async () => {
  const logs = [vi.spyOn(console, 'info').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {})];
  const root = await mkdtemp(join(tmpdir(), 'memory-loop-setup-test-'));
  roots.push(root);
  const metadata = join(root, '.memory-loop');
  await mkdir(metadata, { mode: 0o700 });
  const vaultConfig = join(metadata, 'config.json');
  const original = '{"vaultDirectory":"/test-owned/not-a-real-vault"}\n';
  await writeFile(vaultConfig, original, { mode: 0o600 });
  await setupTransport(root);
  const transportFile = join(metadata, 'transport.json');
  const tokenFile = join(metadata, 'service.token');
  expect((await lstat(transportFile)).isFile()).toBe(true);
  expect((await lstat(tokenFile)).isFile()).toBe(true);
  const firstTransport = await readFile(transportFile, 'utf8');
  expect(JSON.parse(firstTransport)).toEqual(valid);
  const firstToken = await readFile(tokenFile, 'utf8');
  expect(firstToken).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(JSON.parse(firstTransport))).not.toContain(firstToken);
  expect(await readFile(vaultConfig, 'utf8')).toBe(original);
  await expect(setupTransport(root)).rejects.toMatchObject({ code: expect.stringMatching(/^transport_(invalid|exists)$/) });
  expect(await readFile(transportFile, 'utf8')).toBe(firstTransport);
  expect(await readFile(tokenFile, 'utf8')).toBe(firstToken);
  expect(await readFile(vaultConfig, 'utf8')).toBe(original);
  const logOutput = JSON.stringify(logs.map(log => log.mock.calls));
  expect(logOutput).not.toContain(firstToken);
  expect(logOutput).not.toContain(root);
});

it.skipIf(process.platform === 'win32').each(['transport', 'token'] as const)('rejects a descendant %s symlink even when its target is valid', async which => {
  const files = await fixture();
  const target = join(files.root, 'valid-target');
  await writeFile(target, which === 'transport' ? JSON.stringify(valid) : token);
  const path = which === 'transport' ? files.transportFile : files.tokenFile;
  await rm(path);
  await symlink(target, path);
  await expect(loadTransport(files.transportFile)).rejects.toMatchObject({ code: expect.stringMatching(/^transport_(invalid|unavailable)$/) });
});

it.skipIf(process.platform === 'win32')('rejects a linked metadata directory for both load and setup', async () => {
  const files = await fixture();
  const target = join(files.root, 'metadata-target');
  await rename(files.metadata, target);
  await symlink(target, files.metadata, 'dir');
  await expect(loadTransport(files.transportFile)).rejects.toMatchObject({ code: expect.stringMatching(/^transport_(invalid|unavailable)$/) });
  await expect(setupTransport(files.root)).rejects.toMatchObject({ code: expect.stringMatching(/^transport_(invalid|unavailable)$/) });
  expect(await readFile(join(target, 'service.token'), 'utf8')).toBe(token);
  expect(JSON.parse(await readFile(join(target, 'transport.json'), 'utf8'))).toEqual(valid);
});

it.skipIf(process.platform === 'win32')('accepts a trusted linked project root without accepting descendant metadata links', async () => {
  const files = await fixture();
  const linkPath = join(files.root, 'project-link');
  await symlink(files.root, linkPath, 'dir');
  expect(await loadTransport(join(linkPath, '.memory-loop', 'transport.json'))).toEqual({ config: valid, serviceToken: token });
  await rm(files.transportFile);
  await rm(files.tokenFile);
  await setupTransport(linkPath);
  expect((await loadTransport(files.transportFile)).config).toEqual(valid);
});

it.skipIf(process.platform === 'win32')('preserves an unrelated replacement during partial setup cleanup', async () => {
  const files = await fixture();
  await rm(files.tokenFile);
  await rm(files.transportFile);
  const probe = await open(join(files.root, 'probe'), 'w');
  const prototype = Object.getPrototypeOf(probe) as FileHandle;
  const write = vi.spyOn(prototype, 'writeFile').mockImplementation(async () => {
    await unlink(files.tokenFile);
    const replacement = await open(files.tokenFile, 'wx');
    try { await replacement.write(Buffer.from('unrelated')); } finally { await replacement.close(); }
    throw new Error('fixture write failure');
  });
  try {
    await expect(setupTransport(files.root)).rejects.toMatchObject({ code: 'transport_unavailable' });
    expect(write).toHaveBeenCalled();
    expect(await readFile(files.tokenFile, 'utf8')).toBe('unrelated');
    await expect(lstat(files.transportFile)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    write.mockRestore();
    await probe.close();
  }
});

it.skipIf(process.platform !== 'win32')('rejects a metadata directory junction', async () => {
  const files = await fixture();
  const target = join(files.root, 'metadata-target');
  await rename(files.metadata, target);
  await symlink(target, files.metadata, 'junction');
  await expect(loadTransport(files.transportFile)).rejects.toThrow();
  await expect(setupTransport(files.root)).rejects.toThrow();
  expect(await readFile(join(target, 'service.token'), 'utf8')).toBe(token);
});

it('cleans up its newly created token when transport config already exists', async () => {
  const files = await fixture();
  await rm(files.tokenFile);
  const original = await readFile(files.transportFile, 'utf8');
  await expect(setupTransport(files.root)).rejects.toMatchObject({ code: 'transport_exists' });
  await expect(lstat(files.tokenFile)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(files.transportFile, 'utf8')).toBe(original);
});

it.skipIf(process.platform !== 'win32')('accepts native and forward-slash absolute Windows paths', async () => {
  const files = await fixture();
  expect(await loadTransport(files.transportFile.replaceAll('\\', '/'))).toEqual({ config: valid, serviceToken: token });
  await rm(files.transportFile);
  await rm(files.tokenFile);
  await setupTransport(files.root.replaceAll('\\', '/'));
  expect((await loadTransport(files.transportFile)).config).toEqual(valid);
});
