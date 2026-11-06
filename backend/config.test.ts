import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config';

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'memory-loop-config-test-'));
  temporaryRoots.push(root);
  return root;
}

async function writeConfig(root: string, content: string): Promise<void> {
  await mkdir(join(root, '.memory-loop'), { recursive: true });
  await writeFile(join(root, '.memory-loop', 'config.json'), content);
}

// loadConfig rejects with an Error carrying the public code; its message is safe
// for a caller to expose, independently of the HTTP response envelope.
async function expectConfigError(root: string, code: string): Promise<void> {
  const error: unknown = await loadConfig(root).then(
    () => { throw new Error('Expected configuration loading to fail'); },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ code, message: expect.any(String) });
  if (error instanceof Error) {
    expect(error.message).not.toContain(root);
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it('reports missing configuration without exposing its host path', async () => {
  const root = await createRoot();
  await expectConfigError(root, 'config_missing');
});

it.each([
  ['malformed JSON', '{'],
  ['null', 'null'],
  ['array', '[]'],
  ['missing field', '{}'],
  ['non-string field', '{"vaultDirectory":42}'],
  ['empty field', '{"vaultDirectory":""}'],
  ['whitespace field', '{"vaultDirectory":"   "}'],
  ['relative path', '{"vaultDirectory":"relative/vault"}'],
])('reports invalid configuration for %s', async (_name, content) => {
  const root = await createRoot();
  await writeConfig(root, content);
  await expectConfigError(root, 'config_invalid');
});

async function expectUnavailableVault(target: 'missing' | 'file' | 'symlink loop') {
  const root = await createRoot();
  const vault = join(root, 'vault');
  if (target === 'file') await writeFile(vault, 'not a directory');
  if (target === 'symlink loop') await symlink('vault', vault);
  await writeConfig(root, JSON.stringify({ vaultDirectory: vault }));
  await expectConfigError(root, 'vault_unavailable');
}

it.each(['missing', 'file'] as const)(
  'reports an unavailable vault for a %s target without exposing its host path',
  expectUnavailableVault,
);

// Symlink fixtures need elevated privileges on Windows; link tests are POSIX-only.
it.skipIf(process.platform === 'win32')(
  'reports an unavailable vault for a symlink loop target without exposing its host path',
  () => expectUnavailableVault('symlink loop'),
);

it('loads a configured absolute vault directory from app metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-loop-config-test-'));
  temporaryRoots.push(root);
  const vault = join(root, 'test-vault');
  await mkdir(vault);
  await mkdir(join(root, '.memory-loop'));
  await writeFile(join(root, '.memory-loop', 'config.json'), JSON.stringify({ vaultDirectory: vault }));

  await expect(loadConfig(root)).resolves.toEqual({ vaultDirectory: vault });
});

it('retains test-owned custom generation settings without replacing them with defaults', async () => {
  const root = await createRoot();
  const vault = join(root, 'vault');
  await mkdir(vault);
  const generation = { enabled: true, timeZone: 'Europe/Paris', questions: { schedule: '17 9 * * 2', count: 3 },
    quotes: { schedule: '21 8 * * 3', count: 2 }, context: { lookbackDays: 4, maxNotes: 11, maxNoteBytes: 1024, maxTotalBytes: 4096 } };
  await writeConfig(root, JSON.stringify({ vaultDirectory: vault, ground: { generation } }));
  expect(await loadConfig(root)).toMatchObject({ vaultDirectory: vault, ground: { generation } });
});
