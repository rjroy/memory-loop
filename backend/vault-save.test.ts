import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openVault, type VaultReader } from './vault';
import { openSafeRoot } from './safe-fs';

let fixture: string;
let root: string;
let vault: VaultReader;

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'memory-loop-save-test-'));
  root = join(fixture, 'vault');
  await mkdir(root);
  vault = await openVault(root);
});
afterEach(async () => {
  try { await vault?.close(); }
  finally { await rm(fixture, { recursive: true, force: true }); }
});

describe('existing Markdown save', () => {
  it('reads an opaque revision and durably saves exact UTF-8 with a new revision', async () => {
    await vault.close();
    const flushFile = vi.fn(async (file: FileHandle) => { await file.sync(); });
    const safe = await openSafeRoot(root);
    const flushDirectory = vi.fn(async (directory: readonly string[]) => { await safe.syncDirectory(directory); });
    vault = await openVault(root, { flushFile, flushDirectory });
    await writeFile(join(root, 'note.md'), 'original\r\n');
    const original = await vault.note(['note.md']);
    expect(original).toMatchObject({ markdown: 'original\r\n', revision: expect.any(String), editable: true });
    expect(original.revision.length).toBeGreaterThan(0);
    const result = await vault.save(['note.md'], 'é\nnew\n', original.revision);
    expect(result.revision).toEqual(expect.any(String));
    expect(result.revision).not.toBe(original.revision);
    expect(flushFile).toHaveBeenCalled();
    expect(flushDirectory).toHaveBeenCalled();
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('é\nnew\n');
    expect(await vault.note(['note.md'])).toMatchObject({ markdown: 'é\nnew\n', revision: result.revision, editable: true });
  });

  it('rejects an external edit and leaves its bytes intact', async () => {
    const path = join(root, 'note.md');
    await writeFile(path, 'original');
    const { revision } = await vault.note(['note.md']);
    await writeFile(path, 'external edit');
    await expect(vault.save(['note.md'], 'my edit', revision)).rejects.toMatchObject({ code: 'note_conflict' });
    expect(await readFile(path, 'utf8')).toBe('external edit');
  });

  it('serializes competing saves so only one revision wins', async () => {
    const path = join(root, 'note.md');
    await writeFile(path, 'original');
    const { revision } = await vault.note(['note.md']);
    const results = await Promise.allSettled(['first', 'second'].map(text => vault.save(['note.md'], text, revision)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'note_conflict' } }]);
    expect(['first', 'second']).toContain(await readFile(path, 'utf8'));
  });

  it('refuses replacement after the root pathname changes', async () => {
    await writeFile(join(root, 'note.md'), 'original');
    const { revision } = await vault.note(['note.md']);
    const originalRoot = join(fixture, 'original-root');
    await rename(root, originalRoot);
    await mkdir(root);
    await writeFile(join(root, 'note.md'), 'unrelated');
    await expect(vault.save(['note.md'], 'changed', revision)).rejects.toMatchObject({ code: expect.stringMatching(/unavailable|conflict/) });
    expect(await readFile(join(originalRoot, 'note.md'), 'utf8')).toBe('original');
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('unrelated');
  });

  it('refuses path escape, missing files and directories', async () => {
    const outside = join(fixture, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.md'), 'sentinel');
    await mkdir(join(root, 'directory.md'));
    for (const id of [['missing.md'], ['directory.md']]) {
      await expect(vault.save(id, 'changed', 'revision')).rejects.toMatchObject({ code: 'note_unavailable' });
    }
    await expect(vault.save(['..', 'outside', 'secret.md'], 'changed', 'revision')).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('sentinel');
  });

  // Symlink fixtures need elevated privileges on Windows; link tests are POSIX-only.
  it.skipIf(process.platform === 'win32')('refuses intermediate and final symlinks', async () => {
    const outside = join(fixture, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.md'), 'sentinel');
    await symlink(outside, join(root, 'link-dir'));
    await symlink(join(outside, 'secret.md'), join(root, 'link.md'));
    for (const id of [['link-dir', 'secret.md'], ['link.md']]) {
      await expect(vault.save(id, 'changed', 'revision')).rejects.toMatchObject({ code: 'note_unavailable' });
    }
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('sentinel');
  });

  it('keeps malformed UTF-8 readable but refuses an edit without altering bytes', async () => {
    const bytes = Buffer.from([0x61, 0xff, 0x62]);
    const path = join(root, 'note.md');
    await writeFile(path, bytes);
    const note = await vault.note(['note.md']);
    expect(note).toMatchObject({ markdown: 'a\ufffdb', revision: expect.any(String), editable: false });
    await expect(vault.save(['note.md'], note.markdown, note.revision)).rejects.toMatchObject({ code: 'note_not_editable' });
    expect(await readFile(path)).toEqual(bytes);
  });

  it('keeps larger files readable but refuses oversized saves by UTF-8 byte length', async () => {
    const path = join(root, 'note.md');
    const large = 'a'.repeat(2 * 1024 * 1024 + 1);
    await writeFile(path, large);
    const note = await vault.note(['note.md']);
    expect(note.markdown).toBe(large);
    expect(note.editable).toBe(false);
    await expect(vault.save(['note.md'], 'small', note.revision)).rejects.toMatchObject({ code: 'note_not_editable' });
    await writeFile(path, 'small');
    const current = await vault.note(['note.md']);
    await expect(vault.save(['note.md'], 'é'.repeat(1024 * 1024 + 1), current.revision)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await readFile(path, 'utf8')).toBe('small');
  });

  it('accepts a 2 MiB UTF-8 save but rejects a non-round-trippable string', async () => {
    const path = join(root, 'note.md');
    await writeFile(path, 'small');
    const current = await vault.note(['note.md']);
    const text = 'é'.repeat(1024 * 1024);
    const saved = await vault.save(['note.md'], text, current.revision);
    expect(await readFile(path, 'utf8')).toBe(text);
    await expect(vault.save(['note.md'], '\ud800', saved.revision)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await readFile(path, 'utf8')).toBe(text);
  });

  it('reports a definite pre-replacement I/O failure without altering either file', async () => {
    await vault.close();
    vault = await openVault(root, { flushFile: async () => { throw new Error('private fixture failure'); } });
    await writeFile(join(root, 'note.md'), 'original');
    await writeFile(join(root, 'other.md'), 'unrelated');
    const { revision } = await vault.note(['note.md']);
    await expect(vault.save(['note.md'], 'changed', revision)).rejects.toMatchObject({ code: 'note_save_unavailable' });
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('original');
    expect(await readFile(join(root, 'other.md'), 'utf8')).toBe('unrelated');
  });

  it('flushes the temporary file before replacement and the directory afterward', async () => {
    await vault.close();
    const path = join(root, 'note.md');
    await writeFile(path, 'original');
    const events: string[] = [];
    const safe = await openSafeRoot(root);
    vault = await openVault(root, {
      flushFile: async file => { expect(await readFile(path, 'utf8')).toBe('original'); events.push('file'); await file.sync(); },
      flushDirectory: async directory => { expect(await readFile(path, 'utf8')).toBe('changed'); events.push('directory'); await safe.syncDirectory(directory); },
    });
    const { revision } = await vault.note(['note.md']);
    await vault.save(['note.md'], 'changed', revision);
    expect(events).toEqual(['file', 'directory']);
  });

  it('reports uncertainty when the directory flush fails after replacement', async () => {
    await vault.close();
    vault = await openVault(root, { flushDirectory: async () => { throw new Error('private flush failure'); } });
    const path = join(root, 'note.md');
    await writeFile(path, 'original');
    const { revision } = await vault.note(['note.md']);
    await expect(vault.save(['note.md'], 'changed', revision)).rejects.toMatchObject({ code: 'note_save_uncertain' });
    expect(await readFile(path, 'utf8')).toBe('changed');
  });
});
