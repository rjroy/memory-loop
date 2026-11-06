import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBodyStore, type BodyKey, type BodyStore, type PreviewBodyRef } from './think/body-store';
import { removeCacheNamespace } from './think/body-cleanup';
import type { BodyCacheStateStore, CacheNamespace } from './think/state';

const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key: BodyKey = { conversationId: '11111111-1111-4111-8111-111111111111', owner: {
  kind: 'original', clientCommandId: '22222222-2222-4222-8222-222222222222', messageId: 'msg_fixture_original',
} };
async function* bytes(text: string): AsyncIterable<Uint8Array> { yield Buffer.from(text, 'utf8'); }
async function fileCount(path: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) count += await fileCount(child);
    else if (entry.isFile()) count++;
  }
  return count;
}

let root: string;
let vault: string;
let directory: string;
let store: BodyStore | undefined;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'think-body-test-'));
  vault = join(root, 'vault');
  const metadata = join(root, 'private-metadata');
  directory = join(metadata, 'owned-bodies');
  await mkdir(vault, { mode: 0o700 });
  await mkdir(metadata, { mode: 0o700 });
  store = undefined;
});

describe('persisted body namespace cleanup', () => {
  const conversationId = key.conversationId;
  const bodyName = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  async function ownedNamespace(): Promise<CacheNamespace> {
    await mkdir(directory, { mode: 0o700 });
    await mkdir(join(directory, conversationId), { mode: 0o700 });
    const rootStat = await lstat(directory);
    const folder = await lstat(join(directory, conversationId));
    return { conversationId, epoch, path: directory, root: { dev: rootStat.dev, ino: rootStat.ino },
      directory: { dev: folder.dev, ino: folder.ino } };
  }

  it.skipIf(process.platform === 'win32')('cleans acquired owned files despite accessible permissive modes', async () => {
    const record = await ownedNamespace();
    const folder = join(directory, conversationId);
    await writeFile(join(folder, bodyName), 'owned body');
    await chmod(directory, 0o755); await chmod(folder, 0o755); await chmod(join(folder, bodyName), 0o644);
    await removeCacheNamespace(record, vault);
    await expect(lstat(folder)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(directory)).toEqual([]);
  });

  it('does not adopt a directory from an unacquired intent', async () => {
    const record = await ownedNamespace();
    const body = join(directory, conversationId, bodyName);
    await writeFile(body, 'unacquired sentinel');
    await expect(removeCacheNamespace({ ...record, directory: null }, vault)).rejects.toThrow();
    expect(await readFile(body, 'utf8')).toBe('unacquired sentinel');
  });

  it('preserves unrecognized files even in an acquired namespace', async () => {
    const record = await ownedNamespace();
    const sentinel = join(directory, conversationId, 'unrelated.txt');
    await writeFile(sentinel, 'unrelated');
    await expect(removeCacheNamespace(record, vault)).rejects.toThrow();
    expect(await readFile(sentinel, 'utf8')).toBe('unrelated');
  });

  it('refuses cleanup after the root directory is replaced', async () => {
    const record = await ownedNamespace();
    const original = join(root, 'private-metadata', 'original');
    const originalBody = join(original, conversationId, bodyName);
    await writeFile(join(directory, conversationId, bodyName), 'original');
    await rename(directory, original);
    await mkdir(join(directory, conversationId), { recursive: true });
    const replacement = join(directory, conversationId, bodyName);
    await writeFile(replacement, 'replacement');
    await expect(removeCacheNamespace(record, vault)).rejects.toThrow();
    expect(await readFile(originalBody, 'utf8')).toBe('original');
    expect(await readFile(replacement, 'utf8')).toBe('replacement');
  });
});
afterEach(async () => {
  try { await store?.close(); } finally { await rm(root, { recursive: true, force: true }); }
});

describe('private Think body store', () => {
  it('defers eviction until the last pinned reader closes, then verifies exact canonical restoration', async () => {
    store = await createBodyStore({ directory, epoch, vaultDirectory: vault });
    const assistantKey: BodyKey = { conversationId: key.conversationId, owner: { kind: 'assistant-text', messageId: 'msg_fixture_assistant', ordinal: 0 } };
    const ref = await store.replace(assistantKey, bytes('fixture canonical 🧠'), 'canonical');
    if (ref.kind !== 'canonical') throw new Error('fixture canonical missing');
    const first = await store.open(ref);
    const second = await store.open(ref);
    const resident = await fileCount(directory);
    expect(resident).toBeGreaterThan(0);
    expect(await store.evict(ref)).toBe('deferred');
    await first.close();
    expect(await fileCount(directory)).toBe(resident);
    expect(Buffer.from(await second.read(0, ref.through)).toString('utf8')).toBe('fixture canonical 🧠');
    await second.close();
    expect(await fileCount(directory)).toBeLessThan(resident);
    expect(await store.evict(ref)).toBe('already-evicted');
    await expect(store.open(ref)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(store.open({ ...ref, generation: 'forged-generation' })).rejects.toMatchObject({ code: 'stale_ref' });
    await expect(store.restore(ref, bytes('fixture canonical 🦊'))).rejects.toMatchObject({ code: 'resource_failure' });
    await expect(store.open(ref)).rejects.toMatchObject({ code: 'unavailable' });
    const restored = await store.restore(ref, bytes('fixture canonical 🧠'));
    expect(Buffer.from(await restored.read(0, ref.through)).toString('utf8')).toBe('fixture canonical 🧠');
    const separate = await store.open(ref);
    await restored.close();
    expect(Buffer.from(await separate.read(0, ref.through)).toString('utf8')).toBe('fixture canonical 🧠');
    await separate.close();
  });

  it('protects originals, form replies and the current unfinished preview but permits superseded preview eviction', async () => {
    store = await createBodyStore({ directory, epoch, vaultDirectory: vault });
    const original = await store.replace(key, bytes('fixture original'), 'canonical');
    const form = await store.replace({ conversationId: key.conversationId, owner: { kind: 'form-reply', clientCommandId: '33333333-3333-4333-8333-333333333333', decisionId: 'form_fixture' } }, bytes('fixture answer'), 'canonical');
    const assistantKey: BodyKey = { conversationId: key.conversationId, owner: { kind: 'assistant-text', messageId: 'msg_fixture_preview', ordinal: 0 } };
    const preview = await store.replace(assistantKey, bytes('fixture partial'), 'preview');
    expect(await store.evict(original)).toBe('protected');
    expect(await store.evict(form)).toBe('protected');
    expect(await store.evict(preview)).toBe('protected');
    const canonical = await store.replace(assistantKey, bytes('fixture canonical'), 'canonical');
    expect(canonical.generation).not.toBe(preview.generation);
    expect(await store.evict(preview)).toBe('evicted');
    expect(await readdir(vault)).toEqual([]);
  });

  it('creates an exclusive namespace outside the vault with regular single-link files', async () => {
    store = await createBodyStore({ directory, epoch, vaultDirectory: vault });
    await store.replace(key, bytes('fixture private body'), 'canonical');
    let files = 0;
    async function inspect(path: string): Promise<void> {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        const stat = await lstat(child);
        expect(stat.isSymbolicLink()).toBe(false);
        if (stat.isDirectory()) await inspect(child);
        else { expect(stat.isFile()).toBe(true); expect(stat.nlink).toBe(1); files++; }
      }
    }
    await inspect(directory);
    expect(files).toBeGreaterThan(0);
    expect(await readdir(vault)).toEqual([]);
    await expect(createBodyStore({ directory, epoch, vaultDirectory: vault })).rejects.toMatchObject({ code: 'resource_failure' });
  });

  it.skipIf(process.platform === 'win32')('uses an accessible non-owner-only parent for owned bodies and cleanup', async () => {
    await chmod(join(root, 'private-metadata'), 0o755);
    const records: CacheNamespace[] = [];
    const events: string[] = [];
    const cache: BodyCacheStateStore = {
      intent(record) { events.push('intent'); records.push(structuredClone(record)); },
      acquire(_conversation, _epoch, identity) { events.push('acquire'); records[0].directory = identity; },
      namespaces() { return structuredClone(records); },
      removed() { events.push('removed'); },
    };
    store = await createBodyStore({ directory, epoch, vaultDirectory: vault });
    store.bind(cache);
    const initial = await store.replace(key, bytes('first'), 'preview');
    if (initial.kind !== 'preview') throw new Error('fixture expected preview');
    const extended = await store.append(initial, bytes(' second'));
    const reader = await store.open(extended);
    try { expect(Buffer.from(await reader.read(0, extended.through)).toString()).toBe('first second'); }
    finally { await reader.close(); }
    expect(events).toEqual(['intent', 'acquire']);
    expect(records[0]).toMatchObject({ conversationId: key.conversationId, epoch, path: directory,
      root: { dev: expect.any(Number), ino: expect.any(Number) }, directory: { dev: expect.any(Number), ino: expect.any(Number) } });
    await store.close(); store = undefined;
    expect(events).toEqual(['intent', 'acquire', 'removed']);
    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(vault)).toEqual([]);
  });

  it('canonicalizes a trusted linked parent without adopting an existing body root', async () => {
    const alias = join(root, 'metadata-link');
    await symlink(join(root, 'private-metadata'), alias, process.platform === 'win32' ? 'junction' : 'dir');
    store = await createBodyStore({ directory: join(alias, 'owned-bodies'), epoch, vaultDirectory: vault });
    const ref = await store.replace(key, bytes('linked parent'), 'canonical');
    const reader = await store.open(ref);
    try { expect(Buffer.from(await reader.read(0, ref.through)).toString()).toBe('linked parent'); }
    finally { await reader.close(); }
    await store.close(); store = undefined;
    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves UTF-8 and empty canonical bodies, deduplicates identical values and fences stale generations', async () => {
    store = await createBodyStore({ directory, epoch, vaultDirectory: vault });
    const text = 'fixture 🧠\n';
    const first = await store.replace(key, bytes(text), 'canonical');
    expect(first).toMatchObject({ key, epoch, kind: 'canonical', through: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') });
    const duplicate = await store.replace(key, bytes(text), 'canonical');
    expect(duplicate).toEqual(first);
    const reader = await store.open(first);
    expect(Buffer.from(await reader.read(0, first.through)).toString('utf8')).toBe(text);
    await reader.close();
    const empty = await store.replace(key, bytes(''), 'canonical');
    expect(empty).toMatchObject({ kind: 'canonical', through: 0, sha256: createHash('sha256').update('').digest('hex') });
    expect(empty.generation).not.toBe(first.generation);
    const emptyReader = await store.open(empty);
    expect(await emptyReader.read(0, 0)).toEqual(new Uint8Array());
    await emptyReader.close();
    await expect(store.open({ ...empty, generation: 'unknown-generation' })).rejects.toMatchObject({ code: 'stale_ref' });
  });

  it('pins old preview prefixes while appending and bounds every read', async () => {
    store = await createBodyStore({ directory, epoch, vaultDirectory: vault });
    const initial = await store.replace(key, bytes('first 🧠'), 'preview');
    if (initial.kind !== 'preview') throw new Error('fixture expected preview reference');
    const pinned = await store.open(initial);
    const extended: PreviewBodyRef = await store.append(initial, bytes(' and second'));
    expect(extended.through).toBeGreaterThan(initial.through);
    expect(Buffer.from(await pinned.read(0, initial.through)).toString('utf8')).toBe('first 🧠');
    await expect(pinned.read(0, initial.through + 1)).rejects.toMatchObject({ code: 'invalid_range' });
    await expect(pinned.read(0, 64 * 1024 + 1)).rejects.toMatchObject({ code: 'invalid_range' });
    const current = await store.open(extended);
    expect(Buffer.from(await current.read(0, extended.through)).toString('utf8')).toBe('first 🧠 and second');
    await current.close();
    await pinned.close();
  });

  it('refuses access and cleanup when the owned body root is replaced', async () => {
    store = await createBodyStore({ directory, epoch, vaultDirectory: vault });
    const ref = await store.replace(key, bytes('owned bytes'), 'canonical');
    const original = join(root, 'private-metadata', 'relocated');
    await rename(directory, original);
    await mkdir(directory);
    const sentinel = join(directory, 'sentinel');
    await writeFile(sentinel, 'replacement');
    await expect(store.open(ref)).rejects.toThrow();
    await expect(store.close()).rejects.toThrow();
    store = undefined;
    expect(await readFile(sentinel, 'utf8')).toBe('replacement');
    expect(await fileCount(original)).toBeGreaterThan(0);
  });

  it('refuses an inside-vault namespace without changing the target', async () => {
    const victim = join(vault, 'fixture.txt');
    await writeFile(victim, 'fixture untouched', { mode: 0o600 });
    await expect(createBodyStore({ directory: join(vault, 'bodies'), epoch, vaultDirectory: vault })).rejects.toMatchObject({ code: 'resource_failure' });
    expect(await readFile(victim, 'utf8')).toBe('fixture untouched');
  });

  it('refuses a linked existing namespace without changing the target', async () => {
    const victim = join(vault, 'fixture.txt');
    await writeFile(victim, 'fixture untouched');
    await symlink(vault, directory, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(createBodyStore({ directory, epoch, vaultDirectory: vault })).rejects.toMatchObject({ code: 'resource_failure' });
    expect(await readFile(victim, 'utf8')).toBe('fixture untouched');
    expect((await lstat(directory)).isSymbolicLink()).toBe(true);
  });

  it('refuses a hardlinked replacement without reading or removing the unrelated target', async () => {
    store = await createBodyStore({ directory, epoch, vaultDirectory: vault });
    const ref = await store.replace(key, bytes('fixture owned body'), 'canonical');
    async function findBody(path: string): Promise<string | undefined> {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) { const found = await findBody(child); if (found) return found; }
        else if (entry.isFile() && (await readFile(child, 'utf8')) === 'fixture owned body') return child;
      }
      return undefined;
    }
    const bodyPath = await findBody(directory);
    if (!bodyPath) throw new Error('fixture body file unavailable');
    const victim = join(root, 'unrelated-fixture');
    await writeFile(victim, 'fixture unrelated', { mode: 0o600 });
    await unlink(bodyPath);
    await link(victim, bodyPath);
    await expect(store.open(ref)).rejects.toMatchObject({ code: expect.stringMatching(/^(unavailable|resource_failure|stale_ref)$/) });
    try { await store.close(); } catch (error: unknown) { expect(error).toMatchObject({ code: expect.stringMatching(/^(unavailable|resource_failure)$/) }); }
    store = undefined;
    expect(await readFile(victim, 'utf8')).toBe('fixture unrelated');
    expect((await lstat(bodyPath)).nlink).toBe(2);
  });
});
