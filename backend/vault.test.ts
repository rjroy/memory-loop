import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openVault, parseVaultId, type VaultReader } from './vault';

let fixture: string;
let root: string;
let reader: VaultReader;

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'memory-loop-vault-test-'));
  root = join(fixture, 'vault');
  await mkdir(root);
  reader = await openVault(root);
});

afterEach(async () => {
  try {
    await reader?.close();
  } finally {
    if (fixture) await rm(fixture, { recursive: true, force: true });
  }
});

it('lists sorted Markdown and folders, excluding dot entries, other files and symlinks', async () => {
  await mkdir(join(root, 'alpha'));
  await mkdir(join(root, '.hidden'));
  await writeFile(join(root, 'alpha', 'second.md'), 'second');
  await writeFile(join(root, 'alpha', 'first.md'), 'first');
  await writeFile(join(root, 'zeta.md'), 'zeta');
  await writeFile(join(root, 'skip.txt'), 'text');
  await writeFile(join(root, '.hidden', 'private.md'), 'hidden');
  await symlink('zeta.md', join(root, 'link.md'));
  await symlink('alpha', join(root, 'link-dir'));

  expect(await reader.tree()).toEqual({ entries: [
    { kind: 'directory', name: 'alpha', id: ['alpha'], children: [
      { kind: 'note', name: 'first.md', id: ['alpha', 'first.md'] },
      { kind: 'note', name: 'second.md', id: ['alpha', 'second.md'] },
    ] },
    { kind: 'note', name: 'zeta.md', id: ['zeta.md'] },
  ] });
});

it('returns the exact Markdown and display name of a nested note', async () => {
  await mkdir(join(root, 'folder'));
  await writeFile(join(root, 'folder', 'note.md'), '# A note\n\nText.\n');
  expect(await reader.note(['folder', 'note.md'])).toMatchObject({ name: 'note.md', markdown: '# A note\n\nText.\n' });
});

it('returns an empty tree for an empty vault', async () => {
  expect(await reader.tree()).toEqual({ entries: [] });
});

it('continues using the pinned root if its configured pathname is replaced', async () => {
  await writeFile(join(root, 'note.md'), 'original');
  await rename(root, join(fixture, 'original-root'));
  await mkdir(root);
  await writeFile(join(root, 'note.md'), 'replacement');
  expect(await reader.note(['note.md'])).toMatchObject({ name: 'note.md', markdown: 'original' });
});

it('accepts a decoded JSON array of nested components', () => {
  expect(parseVaultId('["folder","note.md"]')).toEqual(['folder', 'note.md']);
});

it.each([
  '', '{', 'null', '[]', '[1]', '[""]', '["."]', '[".."]',
  '[".hidden","note.md"]', '["/outside.md"]', '["../outside.md"]',
  '["a/b.md"]', '["a\\\\b.md"]', '["a\\u0000b.md"]',
])('rejects malformed or unsafe decoded identifier %s', value => {
  expect(() => parseVaultId(value)).toThrow(expect.objectContaining({ code: 'invalid_request' }));
});

it('rejects intermediate and final symlinks, missing notes and nonregular targets', async () => {
  const outside = join(fixture, 'vault-sibling');
  await mkdir(outside);
  await writeFile(join(outside, 'secret.md'), 'outside sentinel');
  await symlink(outside, join(root, 'outside'));
  await symlink(join(outside, 'secret.md'), join(root, 'escape.md'));
  await mkdir(join(root, 'directory.md'));
  for (const id of [['outside', 'secret.md'], ['escape.md'], ['missing.md'], ['directory.md']]) {
    await expect(reader.note(id)).rejects.toMatchObject({ code: 'note_unavailable' });
  }
});

it('does not trust components passed directly to the reader', async () => {
  await expect(reader.note(['..', 'vault-sibling', 'secret.md']))
    .rejects.toMatchObject({ code: 'invalid_request' });
});
