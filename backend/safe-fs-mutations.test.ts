import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSafeRoot, type SafeRoot } from './safe-fs';

const fixtures: string[] = [];
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'memory-loop-safe-mutations-'));
  fixtures.push(base);
  const root = join(base, 'root');
  await mkdir(join(root, 'source'), { recursive: true });
  await mkdir(join(root, 'destination'));
  await writeFile(join(root, 'source', 'file.txt'), 'original');
  return { base, root, safe: await openSafeRoot(root) };
}
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function expectCreateFileRejected(safe: SafeRoot, components: string[], collision = false) {
  const operation = (async () => {
    const file = await safe.createFile(components);
    await file.close();
  })();
  if (collision) await expect(operation).rejects.toMatchObject({ code: 'EEXIST' });
  else await expect(operation).rejects.toThrow();
}

describe('safe filesystem mutations', () => {
  it('creates a regular file exclusively and returns a caller-owned writable handle', async () => {
    const { root, safe } = await fixture();
    const file = await safe.createFile(['destination', '.internal']);
    try {
      await file.writeFile('new content');
      await file.sync();
      expect((await file.stat()).isFile()).toBe(true);
    } finally { await file.close(); }
    expect(await readFile(join(root, 'destination', '.internal'), 'utf8')).toBe('new content');
    await expectCreateFileRejected(safe, ['destination', '.internal'], true);
    expect(await readFile(join(root, 'destination', '.internal'), 'utf8')).toBe('new content');
  });

  it('creates exactly one directory and refuses existing or missing parents', async () => {
    const { root, safe } = await fixture();
    await safe.createDirectory(['destination', 'new folder']);
    expect((await lstat(join(root, 'destination', 'new folder'))).isDirectory()).toBe(true);
    await expect(safe.createDirectory(['destination', 'new folder'])).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(safe.createDirectory(['missing', 'child'])).rejects.toThrow();
    await expect(lstat(join(root, 'missing'))).rejects.toThrow();
  });

  it('moves a file and a whole directory without copying their contents away', async () => {
    const { root, safe } = await fixture();
    await safe.move(['source', 'file.txt'], ['destination', 'moved.txt'], 'file');
    expect(await readFile(join(root, 'destination', 'moved.txt'), 'utf8')).toBe('original');
    await expect(lstat(join(root, 'source', 'file.txt'))).rejects.toThrow();
    await mkdir(join(root, 'source', 'nested'));
    await writeFile(join(root, 'source', 'nested', 'child.txt'), 'child');
    await safe.move(['source'], ['destination', 'moved folder'], 'directory');
    expect(await readFile(join(root, 'destination', 'moved folder', 'nested', 'child.txt'), 'utf8')).toBe('child');
    await expect(lstat(join(root, 'source'))).rejects.toThrow();
  });

  it.each(['file', 'directory'] as const)('refuses an observed destination %s and preserves both sides', async kind => {
    const { root, safe } = await fixture();
    const destination = join(root, 'destination', 'occupied');
    if (kind === 'file') await writeFile(destination, 'occupant');
    else { await mkdir(destination); await writeFile(join(destination, 'child'), 'occupant'); }
    await expect(safe.move(['source', 'file.txt'], ['destination', 'occupied'], 'file')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(root, 'source', 'file.txt'), 'utf8')).toBe('original');
    expect(await readFile(kind === 'file' ? destination : join(destination, 'child'), 'utf8')).toBe('occupant');
    await expectCreateFileRejected(safe, ['destination', 'occupied'], true);
    await expect(safe.createDirectory(['destination', 'occupied'])).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('refuses a directory move onto an existing empty directory', async () => {
    const { root, safe } = await fixture();
    await mkdir(join(root, 'destination', 'occupied'));
    await expect(safe.move(['source'], ['destination', 'occupied'], 'directory')).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(join(root, 'source', 'file.txt'), 'utf8')).toBe('original');
    expect(await readdir(join(root, 'destination', 'occupied'))).toEqual([]);
  });

  it('rejects invalid new names without modifying source or destination', async () => {
    const { root, safe } = await fixture();
    for (const name of ['CON.txt', 'NUL .txt', 'bad:name', 'trailing.', '../escape', 'bad\0name']) {
      await expectCreateFileRejected(safe, ['destination', name]);
      await expect(safe.createDirectory(['destination', name])).rejects.toThrow();
      await expect(safe.move(['source', 'file.txt'], ['destination', name], 'file')).rejects.toThrow();
    }
    expect(await readdir(join(root, 'destination'))).toEqual([]);
    expect(await readFile(join(root, 'source', 'file.txt'), 'utf8')).toBe('original');
  });

  it.skipIf(process.platform === 'win32')('moves an existing nonportable source to a portable name', async () => {
    const { root, safe } = await fixture();
    await writeFile(join(root, 'source', 'CON.txt'), 'legacy');
    await safe.move(['source', 'CON.txt'], ['destination', 'legacy.txt'], 'file');
    expect(await readFile(join(root, 'destination', 'legacy.txt'), 'utf8')).toBe('legacy');
  });

  it('rejects moving the root or a directory into itself or a descendant', async () => {
    const { root, safe } = await fixture();
    await mkdir(join(root, 'source', 'nested'));
    await expect(safe.move([], ['destination', 'root'], 'directory')).rejects.toThrow();
    await expect(safe.move(['source'], ['source'], 'directory')).rejects.toThrow();
    await expect(safe.move(['source'], ['source', 'nested', 'moved'], 'directory')).rejects.toThrow();
    expect(await readFile(join(root, 'source', 'file.txt'), 'utf8')).toBe('original');
  });

  it('moves between distinct differently cased sibling directories when supported', async context => {
    const { root, safe } = await fixture();
    try { await mkdir(join(root, 'SOURCE')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return context.skip();
      throw error;
    }
    await writeFile(join(root, 'SOURCE', 'keep.txt'), 'destination');
    await safe.move(['source'], ['SOURCE', 'moved'], 'directory');
    expect(await readFile(join(root, 'SOURCE', 'moved', 'file.txt'), 'utf8')).toBe('original');
    expect(await readFile(join(root, 'SOURCE', 'keep.txt'), 'utf8')).toBe('destination');
    await expect(lstat(join(root, 'source'))).rejects.toThrow();
  });

  it.skipIf(process.platform !== 'win32')('rejects a descendant reached through a case alias on a case-insensitive Windows directory', async context => {
    const { root, safe } = await fixture();
    let alias;
    try { alias = await lstat(join(root, 'SOURCE')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return context.skip();
      throw error;
    }
    const source = await lstat(join(root, 'source'));
    if (alias.dev !== source.dev || alias.ino !== source.ino) return context.skip();
    await mkdir(join(root, 'source', 'nested'));
    await expect(safe.move(['source'], ['SOURCE', 'nested', 'moved'], 'directory')).rejects.toThrow();
    expect(await readFile(join(root, 'source', 'file.txt'), 'utf8')).toBe('original');
    expect(await readdir(join(root, 'source', 'nested'))).toEqual([]);
  });

  it('rejects wrong source kinds and missing or wrong-kind parents', async () => {
    const { root, safe } = await fixture();
    await expect(safe.move(['source'], ['destination', 'item'], 'file')).rejects.toThrow();
    await expect(safe.move(['source', 'file.txt'], ['destination', 'item'], 'directory')).rejects.toThrow();
    await expect(safe.move(['source', 'file.txt'], ['absent', 'item'], 'file')).rejects.toThrow();
    await expectCreateFileRejected(safe, ['source', 'file.txt', 'child']);
    expect(await readFile(join(root, 'source', 'file.txt'), 'utf8')).toBe('original');
  });

  it.skipIf(process.platform === 'win32')('refuses dangling links and descendant links for creates and moves', async () => {
    const { base, root, safe } = await fixture();
    const outside = join(base, 'outside');
    await mkdir(outside);
    await symlink(join(base, 'absent'), join(root, 'destination', 'dangling'));
    await symlink(outside, join(root, 'link'), 'dir');
    await symlink(join(root, 'source'), join(root, 'inside-link'), 'dir');
    await expectCreateFileRejected(safe, ['destination', 'dangling']);
    await expect(safe.createDirectory(['destination', 'dangling'])).rejects.toThrow();
    await expect(safe.move(['source', 'file.txt'], ['destination', 'dangling'], 'file')).rejects.toThrow();
    await expectCreateFileRejected(safe, ['link', 'new']);
    await expect(safe.createDirectory(['link', 'new'])).rejects.toThrow();
    await expect(safe.move(['source', 'file.txt'], ['link', 'new'], 'file')).rejects.toThrow();
    await expect(safe.move(['inside-link', 'file.txt'], ['destination', 'new'], 'file')).rejects.toThrow();
    expect((await lstat(join(root, 'destination', 'dangling'))).isSymbolicLink()).toBe(true);
    expect(await readdir(outside)).toEqual([]);
    expect(await readFile(join(root, 'source', 'file.txt'), 'utf8')).toBe('original');
  });

  it.skipIf(process.platform !== 'win32')('rejects Windows junctions as source or destination parents', async () => {
    const { base, root, safe } = await fixture();
    const outside = join(base, 'outside');
    await mkdir(outside);
    await symlink(outside, join(root, 'junction'), 'junction');
    await symlink(join(root, 'source'), join(root, 'inside-junction'), 'junction');
    await expectCreateFileRejected(safe, ['junction', 'new']);
    await expect(safe.createDirectory(['junction', 'new'])).rejects.toThrow();
    await expect(safe.move(['source', 'file.txt'], ['junction', 'new'], 'file')).rejects.toThrow();
    await expect(safe.move(['inside-junction', 'file.txt'], ['destination', 'new'], 'file')).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
    expect(await readFile(join(root, 'source', 'file.txt'), 'utf8')).toBe('original');
  });

  it('rejects mutations after detectable root replacement', async () => {
    const { base, root, safe } = await fixture();
    await rename(root, join(base, 'original'));
    await mkdir(join(root, 'source'), { recursive: true });
    await mkdir(join(root, 'destination'));
    await writeFile(join(root, 'source', 'file.txt'), 'replacement');
    await expectCreateFileRejected(safe, ['destination', 'new']);
    await expect(safe.createDirectory(['destination', 'new'])).rejects.toThrow();
    await expect(safe.move(['source', 'file.txt'], ['destination', 'new'], 'file')).rejects.toThrow();
    expect(await readdir(join(root, 'destination'))).toEqual([]);
    expect(await readFile(join(root, 'source', 'file.txt'), 'utf8')).toBe('replacement');
  });
});
