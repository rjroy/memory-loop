import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
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

it('lists sorted files and folders, excluding dot entries and symlinks', async () => {
  await mkdir(join(root, 'alpha'));
  await mkdir(join(root, '.hidden'));
  await writeFile(join(root, 'alpha', 'second.md'), 'second');
  await writeFile(join(root, 'alpha', 'first.md'), 'first');
  await writeFile(join(root, 'zeta.md'), 'zeta');
  await writeFile(join(root, 'skip.txt'), 'text');
  await writeFile(join(root, '.hidden', 'private.md'), 'hidden');
  if (process.platform !== 'win32') {
    await symlink('zeta.md', join(root, 'link.md'));
    await symlink('alpha', join(root, 'link-dir'));
  }

  expect(await reader.tree()).toEqual({ rootIdentity: expect.any(String), entries: [
    { kind: 'directory', name: 'alpha', id: ['alpha'], identity: expect.any(String), version: expect.any(String), children: [
      { kind: 'note', name: 'first.md', id: ['alpha', 'first.md'], identity: expect.any(String), version: expect.any(String) },
      { kind: 'note', name: 'second.md', id: ['alpha', 'second.md'], identity: expect.any(String), version: expect.any(String) },
    ] },
    { kind: 'file', name: 'skip.txt', id: ['skip.txt'], identity: expect.any(String), version: expect.any(String) },
    { kind: 'note', name: 'zeta.md', id: ['zeta.md'], identity: expect.any(String), version: expect.any(String) },
  ] });
});

it('returns the exact Markdown and display name of a nested note', async () => {
  await mkdir(join(root, 'folder'));
  await writeFile(join(root, 'folder', 'note.md'), '# A note\n\nText.\n');
  expect(await reader.note(['folder', 'note.md'])).toMatchObject({ name: 'note.md', markdown: '# A note\n\nText.\n' });
});

it('returns an empty tree for an empty vault', async () => {
  expect(await reader.tree()).toEqual({ rootIdentity: expect.any(String), entries: [] });
});

it('refuses access when its configured root is replaced', async () => {
  await writeFile(join(root, 'note.md'), 'original');
  await rename(root, join(fixture, 'original-root'));
  await mkdir(root);
  await writeFile(join(root, 'note.md'), 'replacement');
  await expect(reader.note(['note.md'])).rejects.toMatchObject({ code: expect.stringMatching(/unavailable|conflict/) });
  await expect(reader.tree()).rejects.toMatchObject({ code: 'vault_unavailable' });
  expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('replacement');
  expect(await readFile(join(fixture, 'original-root', 'note.md'), 'utf8')).toBe('original');
});

it.skipIf(process.platform === 'win32')('canonicalizes a configured root symlink', async () => {
  await writeFile(join(root, 'note.md'), 'linked root');
  const alias = join(fixture, 'vault-link');
  await symlink(root, alias, 'dir');
  const linked = await openVault(alias);
  try { expect(await linked.note(['note.md'])).toMatchObject({ markdown: 'linked root' }); }
  finally { await linked.close(); }
});

it.skipIf(process.platform !== 'win32')('canonicalizes a configured root junction but rejects a descendant junction', async () => {
  await mkdir(join(root, 'folder'));
  await writeFile(join(root, 'folder', 'note.md'), 'inside');
  await symlink(join(root, 'folder'), join(root, 'descendant'), 'junction');
  const alias = join(fixture, 'vault-link');
  await symlink(root, alias, 'junction');
  const linked = await openVault(alias);
  try {
    expect(await linked.note(['folder', 'note.md'])).toMatchObject({ markdown: 'inside' });
    await expect(linked.note(['descendant', 'note.md'])).rejects.toMatchObject({ code: 'note_unavailable' });
  } finally { await linked.close(); }
});

it.skipIf(process.platform === 'win32')('lists and reads existing names that are not portable new names', async () => {
  await writeFile(join(root, 'CON.md'), 'legacy note');
  await writeFile(join(root, 'legacy?.txt'), 'legacy file');
  const tree = await reader.tree();
  expect(tree.entries.map(item => item.name)).toEqual(['CON.md', 'legacy?.txt']);
  expect(await reader.note(['CON.md'])).toMatchObject({ markdown: 'legacy note' });
  expect(await reader.file(['legacy?.txt'])).toMatchObject({ kind: 'text', text: 'legacy file' });
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

it('rejects missing notes and nonregular targets', async () => {
  await mkdir(join(root, 'directory.md'));
  for (const id of [['missing.md'], ['directory.md']]) {
    await expect(reader.note(id)).rejects.toMatchObject({ code: 'note_unavailable' });
  }
});

// Symlink fixtures need elevated privileges on Windows; link tests are POSIX-only.
it.skipIf(process.platform === 'win32')('rejects intermediate and final symlinks', async () => {
  const outside = join(fixture, 'vault-sibling');
  await mkdir(outside);
  await writeFile(join(outside, 'secret.md'), 'outside sentinel');
  await symlink(outside, join(root, 'outside'));
  await symlink(join(outside, 'secret.md'), join(root, 'escape.md'));
  for (const id of [['outside', 'secret.md'], ['escape.md']]) {
    await expect(reader.note(id)).rejects.toMatchObject({ code: 'note_unavailable' });
  }
});

it('does not trust components passed directly to the reader', async () => {
  await expect(reader.note(['..', 'vault-sibling', 'secret.md']))
    .rejects.toMatchObject({ code: 'invalid_request' });
});
