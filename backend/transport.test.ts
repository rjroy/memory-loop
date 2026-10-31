import { afterEach, expect, it, vi } from 'vitest';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTransport, parseTransport, setupTransport } from './transport';

const roots: string[] = [];
const valid = { daemonOrigin: 'http://127.0.0.1:3001', web: { mode: 'loopback', origin: 'http://127.0.0.1:3000' } };
const tailnet = { daemonOrigin: 'http://127.0.0.1:3001', web: { mode: 'tailscale', origin: 'https://fixture.tailnet.example:9443', allowedLogin: 'fixture@example.invalid' } };
const proxy = { daemonOrigin: 'http://127.0.0.1:3001', web: { mode: 'reverse-proxy', origin: 'https://proxy.example.test:10000', externalAuth: 'operator-managed' } };
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

it('parses the exact loopback and personal-tailnet configuration shapes', () => {
  expect(parseTransport(valid)).toEqual(valid);
  expect(parseTransport(tailnet)).toEqual(tailnet);
});

it('parses an explicitly authenticated reverse-proxy origin', () => {
  expect(parseTransport(proxy)).toEqual(proxy);
});

it.each([
  'http://proxy.example.test:10000', 'https://*.example.test:10000',
  'https://user:password@proxy.example.test:10000', 'https://proxy.example.test:10000/path',
  'https://proxy.example.test:10000?query=1', 'https://proxy.example.test:10000#fragment',
  'https://proxy.example.test:443', 'https://127.0.0.1:10000',
])('rejects unsafe reverse-proxy origin %s', origin => {
  expect(() => parseTransport({ ...proxy, web: { ...proxy.web, origin } })).toThrow(expect.objectContaining({ code: 'transport_invalid' }));
});

it.each([undefined, false, true, 'none'])('requires an explicit operator-managed authentication assertion: %s', externalAuth => {
  expect(() => parseTransport({ ...proxy, web: { ...proxy.web, externalAuth } })).toThrow(expect.objectContaining({ code: 'transport_invalid' }));
});

it.each([
  null, {}, { ...valid, daemonOrigin: 'http://localhost:3001' },
  { ...valid, daemonOrigin: 'https://127.0.0.1:3001' },
  { ...valid, daemonOrigin: 'http://user:password@127.0.0.1:3001' },
  { ...valid, daemonOrigin: 'http://127.0.0.1:3001/path' },
  { ...valid, daemonOrigin: 'http://127.0.0.1:3001?x=1' },
  { ...valid, daemonOrigin: 'http://127.0.0.1:3001#fragment' },
  { ...valid, web: { mode: 'loopback', origin: 'http://localhost:3000' } },
  { ...tailnet, web: { mode: 'tailscale', origin: 'http://fixture.tailnet.example:9443', allowedLogin: 'fixture@example.invalid' } },
  { ...tailnet, web: { ...tailnet.web, allowedLogin: '*' } },
  { ...tailnet, web: { ...tailnet.web, allowedLogin: '' } },
  { ...tailnet, web: { ...tailnet.web, origin: 'https://*.tailnet.example:9443' } },
])('rejects unsafe or malformed transport configuration', value => {
  expect(() => parseTransport(value)).toThrow(expect.objectContaining({ code: 'transport_invalid' }));
});

it('loads an owner-only transport file and sibling token without exposing either', async () => {
  const files = await fixture();
  expect(await loadTransport(files.transportFile)).toEqual({ config: valid, serviceToken: token });
});

it.each(['transport mode', 'token mode', 'directory mode', 'transport symlink', 'token symlink', 'bad token', 'missing token'] as const)(
  'fails closed with a sanitized error for %s', async problem => {
    const files = await fixture();
    if (problem === 'transport mode') await chmod(files.transportFile, 0o644);
    if (problem === 'token mode') await chmod(files.tokenFile, 0o644);
    if (problem === 'directory mode') await chmod(files.metadata, 0o755);
    if (problem === 'transport symlink') {
      await rm(files.transportFile);
      await symlink(join(files.root, 'other.json'), files.transportFile);
    }
    if (problem === 'token symlink') {
      await rm(files.tokenFile);
      await symlink(join(files.root, 'other.token'), files.tokenFile);
    }
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

it('creates private transport metadata without reading or changing vault config and refuses replacement', async () => {
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
  expect((await lstat(metadata)).mode & 0o777).toBe(0o700);
  expect((await lstat(transportFile)).mode & 0o777).toBe(0o600);
  expect((await lstat(tokenFile)).mode & 0o777).toBe(0o600);
  expect((await lstat(transportFile)).isFile()).toBe(true);
  expect((await lstat(tokenFile)).isFile()).toBe(true);
  if (process.getuid) {
    expect((await lstat(metadata)).uid).toBe(process.getuid());
    expect((await lstat(transportFile)).uid).toBe(process.getuid());
    expect((await lstat(tokenFile)).uid).toBe(process.getuid());
  }
  const firstTransport = await readFile(transportFile, 'utf8');
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
