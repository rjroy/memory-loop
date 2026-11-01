import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app';
import { openVault, type VaultReader } from './vault';

const authority = '127.0.0.1:3001';
const token = 'a'.repeat(64);
type Entry = { kind: 'note' | 'directory'; id: string[]; identity: string; version: string; children?: Entry[] };
type Tree = { rootIdentity: string; entries: Entry[] };
let fixture: string;
let root: string;
let vault: VaultReader;
let app: ReturnType<typeof createApp>;

// Controlled-fixture mock only: the check and rename are not atomic like renameat2.
async function mockRenameNoReplaceWithoutAtomicGuarantee(sourceParentFd: number, sourceName: string, destinationParentFd: number, destinationName: string) {
  const source = `/proc/self/fd/${sourceParentFd}/${sourceName}`;
  const destination = `/proc/self/fd/${destinationParentFd}/${destinationName}`;
  try { await lstat(destination); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return rename(source, destination);
    throw error;
  }
  throw Object.assign(new Error('destination exists'), { code: 'EEXIST' });
}
async function start(options: { flushFile?: (file: import('node:fs/promises').FileHandle) => Promise<void>; flushDirectory?: (directory: import('node:fs/promises').FileHandle) => Promise<void> } = {}) {
  const hooks = { ...options, renameNoReplace: mockRenameNoReplaceWithoutAtomicGuarantee };
  vault = await openVault(root, hooks);
  app = createApp({ authority, serviceToken: token, vault: { reader: vault } });
}
beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'memory-loop-actions-'));
  root = join(fixture, 'vault');
  await mkdir(root);
  await start();
});
afterEach(async () => {
  try { await vault?.close(); } finally { await rm(fixture, { recursive: true, force: true }); }
});
function request(path: string, body?: unknown) {
  return app(new Request(`http://${authority}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { host: authority, authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
}
async function tree(): Promise<Tree> {
  const response = await request('/api/vault/tree');
  expect(response.status).toBe(200);
  return response.json() as Promise<Tree>;
}
function entry(tree: Tree, ...id: string[]): Entry {
  let entries = tree.entries;
  let found: Entry | undefined;
  for (const name of id) {
    found = entries.find(item => item.id.at(-1) === name);
    expect(found).toBeDefined();
    entries = found?.children ?? [];
  }
  if (!found) throw new Error('Missing fixture entry');
  return found;
}
const action = (body: unknown) => request('/api/vault/actions', body);

describe('vault actions daemon HTTP', () => {
  it('exposes opaque identity and version, and creates both kinds at root', async () => {
    const initial = await tree();
    expect(initial.rootIdentity).toEqual(expect.any(String));
    expect(initial.rootIdentity.length).toBeGreaterThan(0);
    const folder = await action({ action: 'create-directory', parentId: [], expectedParentIdentity: initial.rootIdentity, name: 'folder' });
    expect(folder.status).toBe(200);
    expect(await folder.json()).toMatchObject({ id: ['folder'] });
    const note = await action({ action: 'create-note', parentId: [], expectedParentIdentity: initial.rootIdentity, name: 'new.md' });
    expect(note.status).toBe(200);
    expect(await note.json()).toMatchObject({ id: ['new.md'], revision: expect.any(String) });
    expect(await readFile(join(root, 'new.md'), 'utf8')).toBe('');
    for (const item of (await tree()).entries) {
      expect(item.identity).toEqual(expect.any(String));
      expect(item.version).toEqual(expect.any(String));
      expect(item.identity.length).toBeGreaterThan(0);
      expect(item.version.length).toBeGreaterThan(0);
    }
  });

  it('rejects malformed requests and explicit non-Markdown note names', async () => {
    const t = await tree();
    for (const body of [
      { action: 'create-note', parentId: [], expectedParentIdentity: t.rootIdentity, name: 'untitled' },
      { action: 'create-note', parentId: [], expectedParentIdentity: t.rootIdentity, name: '../escape.md' },
      { action: 'create-directory', parentId: [], expectedParentIdentity: t.rootIdentity, name: 'folder', extra: true },
      { action: 'delete', kind: 'directory', id: [], expectedVersion: 'v' },
    ]) expect((await action(body)).status).toBe(400);
    expect((await tree()).entries).toEqual([]);
  });

  it('refuses create collisions without modifying the existing entry', async () => {
    await writeFile(join(root, 'same.md'), 'sentinel');
    await mkdir(join(root, 'folder'));
    await writeFile(join(root, 'folder', 'hidden.txt'), 'keep');
    const t = await tree();
    for (const [kind, name] of [['create-note', 'same.md'], ['create-directory', 'folder']]) {
      const response = await action({ action: kind, parentId: [], expectedParentIdentity: t.rootIdentity, name });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: 'entry_exists' } });
    }
    expect(await readFile(join(root, 'same.md'), 'utf8')).toBe('sentinel');
    expect(await readFile(join(root, 'folder', 'hidden.txt'), 'utf8')).toBe('keep');
  });

  it('moves notes and whole directories including hidden and non-Markdown descendants', async () => {
    await mkdir(join(root, 'source'));
    await mkdir(join(root, 'target'));
    await writeFile(join(root, 'source', 'note.md'), 'note');
    await writeFile(join(root, 'source', '.hidden'), 'hidden');
    await writeFile(join(root, 'source', 'other.txt'), 'other');
    let t = await tree();
    let source = entry(t, 'source');
    const target = entry(t, 'target');
    let response = await action({ action: 'move', kind: 'note', id: ['source', 'note.md'], expectedVersion: entry(t, 'source', 'note.md').version, destinationParentId: ['target'], expectedDestinationIdentity: target.identity });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: ['target', 'note.md'] });
    t = await tree();
    source = entry(t, 'source');
    response = await action({ action: 'move', kind: 'directory', id: ['source'], expectedVersion: source.version, destinationParentId: ['target'], expectedDestinationIdentity: entry(t, 'target').identity });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: ['target', 'source'] });
    expect(await readFile(join(root, 'target', 'note.md'), 'utf8')).toBe('note');
    expect(await readFile(join(root, 'target', 'source', '.hidden'), 'utf8')).toBe('hidden');
    expect(await readFile(join(root, 'target', 'source', 'other.txt'), 'utf8')).toBe('other');
  });

  it('refuses collision and moving a directory into itself or its descendant', async () => {
    await mkdir(join(root, 'source', 'child'), { recursive: true });
    await mkdir(join(root, 'target'));
    await writeFile(join(root, 'source', 'a.md'), 'source');
    await writeFile(join(root, 'target', 'a.md'), 'destination');
    const t = await tree();
    for (const [id, destination] of [[['source'], ['source']], [['source'], ['source', 'child']], [['source', 'a.md'], ['target']]] as const) {
      const response = await action({ action: 'move', kind: id.length === 1 ? 'directory' : 'note', id, expectedVersion: entry(t, ...id).version, destinationParentId: destination, expectedDestinationIdentity: entry(t, ...destination).identity });
      expect(response.status).toBe(id.length === 1 ? 400 : 409);
      expect(await response.json()).toMatchObject({ error: { code: id.length === 1 ? 'invalid_request' : 'entry_exists' } });
    }
    expect(await readFile(join(root, 'source', 'a.md'), 'utf8')).toBe('source');
    expect(await readFile(join(root, 'target', 'a.md'), 'utf8')).toBe('destination');
  });

  it('deletes files and empty directories but refuses hidden or non-Markdown contents', async () => {
    for (const name of ['empty', 'hidden', 'other']) await mkdir(join(root, name));
    await writeFile(join(root, 'hidden', '.secret'), 'secret');
    await writeFile(join(root, 'other', 'data.txt'), 'data');
    await writeFile(join(root, 'note.md'), 'note');
    const t = await tree();
    for (const [name, kind] of [['empty', 'directory'], ['note.md', 'note']]) {
      expect((await action({ action: 'delete', kind, id: [name], expectedVersion: entry(t, name).version })).status).toBe(200);
    }
    for (const name of ['hidden', 'other']) {
      const response = await action({ action: 'delete', kind: 'directory', id: [name], expectedVersion: entry(t, name).version });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: 'folder_not_empty' } });
    }
    expect(await readFile(join(root, 'hidden', '.secret'), 'utf8')).toBe('secret');
    expect(await readFile(join(root, 'other', 'data.txt'), 'utf8')).toBe('data');
  });

  it('rejects stale source and parent identities and never follows substituted symlinks', async () => {
    await mkdir(join(root, 'dir'));
    await writeFile(join(root, 'note.md'), 'original');
    const outside = join(fixture, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'secret.md'), 'secret');
    const t = await tree();
    await rename(join(root, 'note.md'), join(root, 'old.md'));
    await writeFile(join(root, 'note.md'), 'replacement');
    await rename(join(root, 'dir'), join(root, 'old-dir'));
    await symlink(outside, join(root, 'dir'));
    const stale = await action({ action: 'delete', kind: 'note', id: ['note.md'], expectedVersion: entry(t, 'note.md').version });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: 'entry_conflict' } });
    const linked = await action({ action: 'create-note', parentId: ['dir'], expectedParentIdentity: entry(t, 'dir').identity, name: 'new.md' });
    expect(linked.status).toBe(404);
    expect(await linked.json()).toMatchObject({ error: { code: 'entry_unavailable' } });
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('replacement');
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('secret');
  });

  it('keeps mutations in the pinned root after its pathname is replaced', async () => {
    const t = await tree();
    const original = join(fixture, 'original');
    await rename(root, original);
    await mkdir(root);
    const response = await action({ action: 'create-note', parentId: [], expectedParentIdentity: t.rootIdentity, name: 'pinned.md' });
    expect(response.status).toBe(200);
    expect(await readFile(join(original, 'pinned.md'), 'utf8')).toBe('');
    await expect(lstat(join(root, 'pinned.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('binds save revisions to physical identity as well as bytes', async () => {
    await writeFile(join(root, 'note.md'), 'same');
    const note = await vault.note(['note.md']);
    await rename(join(root, 'note.md'), join(root, 'old.md'));
    await writeFile(join(root, 'note.md'), 'same');
    await expect(vault.save(['note.md'], 'changed', note.revision)).rejects.toMatchObject({ code: 'note_conflict' });
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('same');
  });

  it('serializes a save and delete sharing the same source state', async () => {
    await vault.close();
    let enterFlush: () => void = () => {};
    let releaseFlush: () => void = () => {};
    const flushing = new Promise<void>(resolve => { enterFlush = resolve; });
    const release = new Promise<void>(resolve => { releaseFlush = resolve; });
    await start({ flushFile: async file => { enterFlush(); await release; await file.sync(); } });
    await writeFile(join(root, 'note.md'), 'original');
    const t = await tree();
    const note = await vault.note(['note.md']);
    const save = request('/api/vault/note', { id: ['note.md'], markdown: 'saved', expectedRevision: note.revision });
    await flushing;
    const deletion = action({ action: 'delete', kind: 'note', id: ['note.md'], expectedVersion: entry(t, 'note.md').version });
    releaseFlush();
    const [saved, deleted] = await Promise.all([save, deletion]);
    expect(saved.status).toBe(200);
    expect(deleted.status).toBe(409);
    expect(await deleted.json()).toMatchObject({ error: { code: 'entry_conflict' } });
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('saved');
  });

  it('serializes competing deletes so only one succeeds', async () => {
    await writeFile(join(root, 'note.md'), 'original');
    const t = await tree();
    const body = { action: 'delete', kind: 'note', id: ['note.md'], expectedVersion: entry(t, 'note.md').version };
    const results = await Promise.all([action(body), action(body)]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
  });

  it('executes a queued unrelated delete successfully after a pending save', async () => {
    await vault.close();
    let enterFlush: () => void = () => {};
    let releaseFlush: () => void = () => {};
    const flushing = new Promise<void>(resolve => { enterFlush = resolve; });
    const release = new Promise<void>(resolve => { releaseFlush = resolve; });
    await start({ flushFile: async file => { enterFlush(); await release; await file.sync(); } });
    await writeFile(join(root, 'save.md'), 'before');
    await writeFile(join(root, 'delete.md'), 'delete');
    const t = await tree();
    const note = await vault.note(['save.md']);
    const saving = vault.save(['save.md'], 'after', note.revision);
    await flushing;
    const deleting = vault.action({ action: 'delete', kind: 'note', id: ['delete.md'], expectedVersion: entry(t, 'delete.md').version });
    try { expect(await readFile(join(root, 'delete.md'), 'utf8')).toBe('delete'); }
    finally { releaseFlush(); }
    await saving;
    expect(await deleting).toEqual({ id: ['delete.md'] });
    await expect(lstat(join(root, 'delete.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a create collision as definite and preserves the existing file', async () => {
    await writeFile(join(root, 'note.md'), 'original');
    const t = await tree();
    const response = await action({ action: 'create-note', parentId: [], expectedParentIdentity: t.rootIdentity, name: 'note.md' });
    expect(response.status).toBe(409);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'entry_exists' } });
    expect(text).not.toContain('uncertain');
    expect(text).not.toContain(root);
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('original');
  });

  it('reports post-mutation flush failure as uncertain rather than a known failure', async () => {
    await vault.close();
    await start({ flushDirectory: async () => { throw new Error('private flush detail'); } });
    const t = await tree();
    const response = await action({ action: 'create-directory', parentId: [], expectedParentIdentity: t.rootIdentity, name: 'created' });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ error: { code: 'file_action_uncertain' } });
    expect(text).not.toContain('private flush detail');
    expect((await lstat(join(root, 'created'))).isDirectory()).toBe(true);
  });
});
