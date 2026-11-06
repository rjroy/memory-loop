import { afterEach, expect, it } from 'vitest';
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThinkStateFile } from './think/state-file';

const roots: string[] = [];
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'think-state-file-'));
  roots.push(base);
  const project = join(base, 'project');
  const vault = join(base, 'vault');
  const metadata = join(project, '.memory-loop');
  await mkdir(metadata, { recursive: true, mode: 0o700 });
  await mkdir(vault);
  const database = join(metadata, 'application.sqlite');
  await writeFile(database, 'owned state', { mode: 0o600 });
  return { base, project, vault, metadata, database };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it.each(['root', 'metadata', 'database'] as const)('detects replacement of the %s before further state access', async kind => {
  const f = await fixture();
  const state = new ThinkStateFile(f.project, f.vault);
  try {
    if (kind === 'root') {
      await rename(f.project, join(f.base, 'original-project'));
      await mkdir(f.metadata, { recursive: true });
    } else if (kind === 'metadata') {
      await rename(f.metadata, join(f.project, 'original-metadata'));
      await mkdir(f.metadata);
    } else await rename(f.database, join(f.metadata, 'original.sqlite'));
    await writeFile(f.database, 'replacement sentinel');
    expect(() => state.validate()).toThrow();
    expect(await readFile(f.database, 'utf8')).toBe('replacement sentinel');
    const original = kind === 'root' ? join(f.base, 'original-project', '.memory-loop', 'application.sqlite') :
      kind === 'metadata' ? join(f.project, 'original-metadata', 'application.sqlite') : join(f.metadata, 'original.sqlite');
    expect(await readFile(original, 'utf8')).toBe('owned state');
  } finally { state.close(); }
});

it.each(['-wal', '-shm', '-journal'] as const)('refuses a hardlinked %s sidecar', async suffix => {
  const f = await fixture();
  const outside = join(f.base, 'sentinel');
  await writeFile(outside, 'outside');
  await link(outside, `${f.database}${suffix}`);
  expect(() => new ThinkStateFile(f.project, f.vault)).toThrow();
  expect(await readFile(outside, 'utf8')).toBe('outside');
});

it.skipIf(process.platform === 'win32').each(['-wal', '-shm', '-journal'] as const)('refuses a symlinked %s sidecar', async suffix => {
  const f = await fixture();
  const outside = join(f.base, 'sentinel');
  await writeFile(outside, 'outside');
  await symlink(outside, `${f.database}${suffix}`);
  expect(() => new ThinkStateFile(f.project, f.vault)).toThrow();
  expect(await readFile(outside, 'utf8')).toBe('outside');
});

it('refuses to place state inside the vault', async () => {
  const f = await fixture();
  await mkdir(join(f.vault, '.memory-loop'));
  expect(() => new ThinkStateFile(f.vault, f.vault)).toThrow();
});

it.skipIf(process.platform === 'win32')('accepts a trusted linked project root', async () => {
  const f = await fixture();
  const alias = join(f.base, 'project-link');
  await symlink(f.project, alias, 'dir');
  const state = new ThinkStateFile(alias, f.vault);
  try { state.validate(); } finally { state.close(); }
  expect(await readFile(f.database, 'utf8')).toBe('owned state');
});
