import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPortableName, openSafeRoot } from './safe-fs';

const fixtures: string[] = [];

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'memory-loop-safe-fs-'));
  fixtures.push(base);
  const root = join(base, 'vault');
  await mkdir(join(root, 'folder'), { recursive: true });
  await writeFile(join(root, 'folder', 'note.md'), 'fixture');
  return { base, root, canonical: await realpath(root) };
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('portable new names', () => {
  it.each(['note.md', 'ordinary name.txt', 'écriture 漢字.md', '.internal', 'COM10.txt', 'COM10 .log', 'console.txt', 'CONINBOX.txt'])('accepts %s', name => {
    expect(isPortableName(name)).toBe(true);
  });

  it.each([
    '', '.', '..', 'a/b', 'a\\b', 'a\0b', 'a<b', 'a>b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b',
    ...Array.from({ length: 32 }, (_, code) => `a${String.fromCharCode(code)}b`),
    'name.', 'name ', 'CON', 'con.txt', 'PrN.md', 'AUX', 'nul.tar.gz',
    'COM1', 'com9.log', 'LPT1.txt', 'lpt9', 'NUL .txt', 'nul  .TXT', 'COM1 .log', 'com1  .LOG',
    'CONIN$', 'conin$', 'CONOUT$', 'conout$',
  ])('rejects nonportable name %j', name => {
    expect(isPortableName(name)).toBe(false);
  });

  it.each([null, undefined, 42, {}, ['name']])('rejects non-string %j', value => {
    expect(isPortableName(value)).toBe(false);
  });
});

describe('canonical root and descendant resolution', () => {
  it('resolves the root, existing directory and regular file, and a missing final target', async () => {
    const { root, canonical } = await fixture();
    const safe = await openSafeRoot(root);
    expect(safe.path).toBe(canonical);
    expect(await safe.resolve([], 'directory')).toBe(canonical);
    expect(await safe.resolve(['folder'], 'directory')).toBe(join(canonical, 'folder'));
    const file = await safe.resolve(['folder', 'note.md'], 'file');
    expect(file).toBe(join(canonical, 'folder', 'note.md'));
    expect(await readFile(file, 'utf8')).toBe('fixture');
    expect(await safe.resolve(['folder', 'new.md'], 'missing')).toBe(join(canonical, 'folder', 'new.md'));
  });

  it('rejects missing intermediates, wrong kinds, and an occupied creation target', async () => {
    const { root } = await fixture();
    const safe = await openSafeRoot(root);
    await expect(safe.resolve(['absent', 'new'], 'missing')).rejects.toThrow();
    await expect(safe.resolve(['folder', 'note.md', 'new'], 'missing')).rejects.toThrow();
    await expect(safe.resolve(['folder', 'missing'], 'file')).rejects.toThrow();
    await expect(safe.resolve(['folder'], 'file')).rejects.toThrow();
    await expect(safe.resolve(['folder', 'note.md'], 'directory')).rejects.toThrow();
    await expect(safe.resolve(['folder', 'note.md'], 'missing')).rejects.toThrow();
  });

  it('rejects traversal, absolute and embedded path components including prefix-sibling escapes', async () => {
    const { base, root } = await fixture();
    const sibling = join(base, 'vault-sibling');
    await mkdir(sibling);
    await writeFile(join(sibling, 'outside.txt'), 'outside');
    const safe = await openSafeRoot(root);
    for (const components of [
      ['..', 'vault-sibling', 'outside.txt'], ['../vault-sibling/outside.txt'],
      [sibling, 'outside.txt'], ['folder/../folder', 'note.md'], ['folder\\note.md'],
      [''], ['.'], ['folder', '..'], ['folder', 'note\0.md'],
    ]) {
      await expect(safe.resolve(components, 'file')).rejects.toThrow();
    }
  });

  it.skipIf(process.platform === 'win32')('retains access to existing host-valid names that cannot be newly created portably', async () => {
    const { root, canonical } = await fixture();
    await writeFile(join(root, 'CON.txt'), 'legacy');
    await writeFile(join(root, 'trailing.'), 'legacy dot');
    const safe = await openSafeRoot(root);
    for (const name of ['CON.txt', 'trailing.']) {
      expect(isPortableName(name)).toBe(false);
      expect(await safe.resolve([name], 'file')).toBe(join(canonical, name));
    }
  });

  it.skipIf(process.platform === 'win32')('canonicalizes a configured root that is a link', async () => {
    const { base, root, canonical } = await fixture();
    await symlink(root, join(base, 'root-link'), 'dir');
    const safe = await openSafeRoot(join(base, 'root-link'));
    expect(safe.path).toBe(canonical);
    expect(await safe.resolve(['folder', 'note.md'], 'file')).toBe(join(canonical, 'folder', 'note.md'));
  });

  it.skipIf(process.platform === 'win32')('canonicalizes a configured root reached through a linked parent', async () => {
    const { base, canonical } = await fixture();
    await symlink(base, join(base, 'parent-link'), 'dir');
    const safe = await openSafeRoot(join(base, 'parent-link', 'vault'));
    expect(safe.path).toBe(canonical);
    expect(await safe.resolve(['folder', 'note.md'], 'file')).toBe(join(canonical, 'folder', 'note.md'));
  });

  it.skipIf(process.platform === 'win32')('rejects descendant file and directory symlinks, including links inside the root', async () => {
    const { base, root } = await fixture();
    await writeFile(join(base, 'outside.txt'), 'outside');
    await symlink(join(root, 'folder', 'note.md'), join(root, 'inside-file'));
    await symlink(join(base, 'outside.txt'), join(root, 'outside-file'));
    await symlink(join(root, 'folder'), join(root, 'inside-dir'), 'dir');
    await symlink(base, join(root, 'outside-dir'), 'dir');
    const safe = await openSafeRoot(root);
    for (const id of [['inside-file'], ['outside-file'], ['inside-dir', 'note.md'], ['outside-dir', 'outside.txt']]) {
      await expect(safe.resolve(id, 'file')).rejects.toThrow();
    }
    await expect(safe.resolve(['inside-dir'], 'directory')).rejects.toThrow();
    await expect(safe.resolve(['inside-dir', 'new'], 'missing')).rejects.toThrow();
    await expect(safe.resolve(['inside-file'], 'missing')).rejects.toThrow();
  });

  it.skipIf(process.platform !== 'win32')('rejects native Windows directory junctions, including in-root targets', async () => {
    const { base, root } = await fixture();
    await symlink(join(root, 'folder'), join(root, 'inside-junction'), 'junction');
    await symlink(base, join(root, 'outside-junction'), 'junction');
    const safe = await openSafeRoot(root);
    await expect(safe.resolve(['inside-junction'], 'directory')).rejects.toThrow();
    await expect(safe.resolve(['inside-junction', 'note.md'], 'file')).rejects.toThrow();
    await expect(safe.resolve(['outside-junction', 'vault', 'folder', 'note.md'], 'file')).rejects.toThrow();
    await expect(safe.resolve(['inside-junction', 'new'], 'missing')).rejects.toThrow();
  });

  it('rejects a detectably replaced root rather than resolving into the replacement', async () => {
    const { base, root } = await fixture();
    const safe = await openSafeRoot(root);
    await rename(root, join(base, 'original'));
    await mkdir(join(root, 'folder'), { recursive: true });
    await writeFile(join(root, 'folder', 'note.md'), 'replacement');
    await expect(safe.resolve(['folder', 'note.md'], 'file')).rejects.toThrow();
    await expect(safe.resolve([], 'directory')).rejects.toThrow();
    await expect(safe.resolve(['new'], 'missing')).rejects.toThrow();
  });
});
