import { afterEach, describe, expect, it, vi } from 'vitest';
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSafeRoot, ReplaceFileError, type SafeRoot } from './safe-fs';

const roots: string[] = [];
async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'memory-loop-safe-files-'));
  roots.push(base);
  const root = join(base, 'root');
  await mkdir(join(root, 'folder'), { recursive: true });
  await writeFile(join(root, 'folder', 'note.md'), 'original');
  return { base, root, safe: await openSafeRoot(root) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function expectOpenRejected(safe: SafeRoot, id: string[], mode: 'read' | 'read-write' | 'append') {
  await expect((async () => {
    const file = await safe.openFile(id, mode);
    await file.close();
  })()).rejects.toThrow();
}

describe('checked existing file handles', () => {
  it('supports caller-owned read, nontruncating read-write, and append handles', async () => {
    const { root, safe } = await fixture();
    const read = await safe.openFile(['folder', 'note.md'], 'read');
    try { expect(await read.readFile('utf8')).toBe('original'); }
    finally { await read.close(); }
    const rw = await safe.openFile(['folder', 'note.md'], 'read-write');
    try {
      expect((await rw.stat()).size).toBe(8);
      await rw.write(Buffer.from('O'), 0, 1, 0);
      await rw.sync();
    } finally { await rw.close(); }
    const append = await safe.openFile(['folder', 'note.md'], 'append');
    try {
      const first = Buffer.alloc(1);
      expect((await append.read(first, 0, 1, 0)).bytesRead).toBe(1);
      expect(first.toString()).toBe('O');
      await append.write(Buffer.from('!'), 0, 1, 0);
      await append.sync();
    } finally { await append.close(); }
    expect(await readFile(join(root, 'folder', 'note.md'), 'utf8')).toBe('Original!');
  });

  it.each(['read', 'read-write', 'append'] as const)('does not create or adopt missing paths in %s mode', async mode => {
    const { root, safe } = await fixture();
    await expectOpenRejected(safe, ['folder', 'missing'], mode);
    await expectOpenRejected(safe, ['folder'], mode);
    expect(await readdir(join(root, 'folder'))).toEqual(['note.md']);
  });

  it('permits reading hardlinks but refuses opening them for write or append', async () => {
    const { root, safe } = await fixture();
    await link(join(root, 'folder', 'note.md'), join(root, 'folder', 'alias.md'));
    const file = await safe.openFile(['folder', 'alias.md'], 'read');
    try { expect(await file.readFile('utf8')).toBe('original'); } finally { await file.close(); }
    await expectOpenRejected(safe, ['folder', 'alias.md'], 'read-write');
    await expectOpenRejected(safe, ['folder', 'alias.md'], 'append');
    expect(await readFile(join(root, 'folder', 'note.md'), 'utf8')).toBe('original');
  });

  it.skipIf(process.platform === 'win32')('opens existing nonportable names without imposing new-name policy', async () => {
    const { root, safe } = await fixture();
    await writeFile(join(root, 'folder', 'CON.txt'), 'legacy');
    const file = await safe.openFile(['folder', 'CON.txt'], 'read-write');
    try { expect(await file.readFile('utf8')).toBe('legacy'); } finally { await file.close(); }
  });
});

describe('replacement of an existing file', () => {
  it('replaces only the selected pathname when the original has a hardlink alias', async () => {
    const { root, safe } = await fixture();
    const target = join(root, 'folder', 'note.md');
    const alias = join(root, 'folder', 'alias.md');
    await link(target, alias);
    const original = await lstat(alias, { bigint: true });
    const calls: string[] = [];
    await safe.replaceFile(['folder', 'note.md'], Buffer.from('replacement'), {
      async flushFile(file) { calls.push('file'); await file.sync(); },
      async validate() {
        calls.push('validate');
        expect(await readFile(target, 'utf8')).toBe('original');
        expect(await readFile(alias, 'utf8')).toBe('original');
      },
      async flushDirectory(id) {
        calls.push('directory');
        expect(id).toEqual(['folder']);
        expect(await readFile(target, 'utf8')).toBe('replacement');
        expect(await readFile(alias, 'utf8')).toBe('original');
      },
    });
    expect(calls).toEqual(['file', 'validate', 'directory']);
    expect(await readFile(target, 'utf8')).toBe('replacement');
    expect(await readFile(alias, 'utf8')).toBe('original');
    const aliasAfter = await lstat(alias, { bigint: true });
    const targetAfter = await lstat(target, { bigint: true });
    expect([aliasAfter.dev, aliasAfter.ino]).toEqual([original.dev, original.ino]);
    expect([targetAfter.dev, targetAfter.ino]).not.toEqual([original.dev, original.ino]);
    expect((await readdir(join(root, 'folder'))).sort()).toEqual(['alias.md', 'note.md']);
  });

  it('flushes temp bytes before validation and publishes only after validation', async () => {
    const { root, safe } = await fixture();
    const calls: string[] = [];
    await safe.replaceFile(['folder', 'note.md'], Buffer.from('replacement'), {
      async flushFile(file) {
        calls.push('file');
        const names = await readdir(join(root, 'folder'));
        const temp = names.filter(name => name !== 'note.md');
        expect(temp).toHaveLength(1);
        expect(await readFile(join(root, 'folder', temp[0]), 'utf8')).toBe('replacement');
        await file.sync();
      },
      async validate() {
        calls.push('validate');
        expect(await readFile(join(root, 'folder', 'note.md'), 'utf8')).toBe('original');
      },
      async flushDirectory(id) {
        calls.push('directory');
        expect(id).toEqual(['folder']);
        expect(await readFile(join(root, 'folder', 'note.md'), 'utf8')).toBe('replacement');
      },
    });
    expect(calls).toEqual(['file', 'validate', 'directory']);
    expect(await readdir(join(root, 'folder'))).toEqual(['note.md']);
  });

  it.each(['flush', 'validation'] as const)('cleans up and retains original on %s failure', async stage => {
    const { root, safe } = await fixture();
    const failure = new Error(stage);
    let validated = false;
    let directoryFlushed = false;
    const error: unknown = await safe.replaceFile(['folder', 'note.md'], Buffer.from('replacement'), {
      async flushFile(file) { if (stage === 'flush') throw failure; await file.sync(); },
      async validate() { validated = true; if (stage === 'validation') throw failure; },
      async flushDirectory() { directoryFlushed = true; },
    }).then(() => undefined, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(ReplaceFileError);
    expect(error).toMatchObject({ published: false, cause: failure });
    expect(validated).toBe(stage === 'validation');
    expect(directoryFlushed).toBe(false);
    expect(await readFile(join(root, 'folder', 'note.md'), 'utf8')).toBe('original');
    expect(await readdir(join(root, 'folder'))).toEqual(['note.md']);
  });

  it('reports an uncertain published outcome if directory flush fails', async () => {
    const { root, safe } = await fixture();
    const failure = new Error('directory flush');
    const error: unknown = await safe.replaceFile(['folder', 'note.md'], Buffer.from('replacement'), {
      async validate() {},
      async flushDirectory() { throw failure; },
    }).then(() => undefined, (reason: unknown) => reason);
    expect(error).toBeInstanceOf(ReplaceFileError);
    expect(error).toMatchObject({ published: true, cause: failure });
    expect(await readFile(join(root, 'folder', 'note.md'), 'utf8')).toBe('replacement');
    expect(await readdir(join(root, 'folder'))).toEqual(['note.md']);
  });

  it('refuses absent and wrong-kind targets without creating or adopting them', async () => {
    const { root, safe } = await fixture();
    for (const id of [['folder', 'missing'], ['folder']]) {
      await expect(safe.replaceFile(id, Buffer.from('replacement'), { async validate() {} })).rejects.toThrow();
    }
    expect(await readdir(join(root, 'folder'))).toEqual(['note.md']);
    expect(await readFile(join(root, 'folder', 'note.md'), 'utf8')).toBe('original');
  });

  it.skipIf(process.platform === 'win32')('replaces an existing nonportable name without renaming it', async () => {
    const { root, safe } = await fixture();
    await writeFile(join(root, 'folder', 'CON.txt'), 'legacy');
    await safe.replaceFile(['folder', 'CON.txt'], Buffer.from('updated'), { async validate() {} });
    expect(await readFile(join(root, 'folder', 'CON.txt'), 'utf8')).toBe('updated');
    expect((await readdir(join(root, 'folder'))).sort()).toEqual(['CON.txt', 'note.md']);
  });
});

describe('checked file and directory boundaries', () => {
  it('syncs existing directories and rejects missing or non-directory targets', async () => {
    const { safe } = await fixture();
    await safe.syncDirectory([]);
    await safe.syncDirectory(['folder']);
    await expect(safe.syncDirectory(['folder', 'note.md'])).rejects.toThrow();
    await expect(safe.syncDirectory(['missing'])).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32')('propagates a native directory sync failure', async () => {
    const { root, safe } = await fixture();
    const directory = await open(join(root, 'folder'), 'r');
    const failure = new Error('directory sync failed');
    const prototype = Object.getPrototypeOf(directory) as FileHandle;
    const sync = vi.spyOn(prototype, 'sync').mockRejectedValue(failure);
    try {
      await expect(safe.syncDirectory(['folder'])).rejects.toBe(failure);
      expect(sync).toHaveBeenCalled();
    } finally {
      sync.mockRestore();
      await directory.close();
    }
  });

  it.skipIf(process.platform === 'win32')('rejects descendant symlinks for opens, replacement and directory sync', async () => {
    const { base, root, safe } = await fixture();
    const outside = join(base, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'file'), 'outside');
    await symlink(join(outside, 'file'), join(root, 'folder', 'linked-file'));
    await symlink(outside, join(root, 'linked-dir'), 'dir');
    await symlink(join(root, 'folder'), join(root, 'inside-dir'), 'dir');
    for (const id of [['folder', 'linked-file'], ['linked-dir', 'file'], ['inside-dir', 'note.md']]) {
      await expectOpenRejected(safe, id, 'read');
      await expectOpenRejected(safe, id, 'append');
      await expect(safe.replaceFile(id, Buffer.from('changed'), { async validate() {} })).rejects.toThrow();
    }
    await expect(safe.syncDirectory(['linked-dir'])).rejects.toThrow();
    expect(await readFile(join(outside, 'file'), 'utf8')).toBe('outside');
    expect(await readFile(join(root, 'folder', 'note.md'), 'utf8')).toBe('original');
  });

  it.skipIf(process.platform !== 'win32')('rejects native Windows junctions for opens, replacement and directory sync', async () => {
    const { base, root, safe } = await fixture();
    const outside = join(base, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'file'), 'outside');
    await symlink(outside, join(root, 'junction'), 'junction');
    await expectOpenRejected(safe, ['junction', 'file'], 'read');
    await expect(safe.replaceFile(['junction', 'file'], Buffer.from('changed'), { async validate() {} })).rejects.toThrow();
    await expect(safe.syncDirectory(['junction'])).rejects.toThrow();
    expect(await readFile(join(outside, 'file'), 'utf8')).toBe('outside');
  });

  it('rejects operations after detectable root replacement', async () => {
    const { base, root, safe } = await fixture();
    await rename(root, join(base, 'original'));
    await mkdir(join(root, 'folder'), { recursive: true });
    await writeFile(join(root, 'folder', 'note.md'), 'replacement root');
    await expectOpenRejected(safe, ['folder', 'note.md'], 'read');
    await expect(safe.replaceFile(['folder', 'note.md'], Buffer.from('changed'), { async validate() {} })).rejects.toThrow();
    await expect(safe.syncDirectory(['folder'])).rejects.toThrow();
    expect(await readFile(join(root, 'folder', 'note.md'), 'utf8')).toBe('replacement root');
    expect((await lstat(join(base, 'original', 'folder', 'note.md'))).isFile()).toBe(true);
  });
});
