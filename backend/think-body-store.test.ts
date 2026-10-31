import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBodyStore, type BodyKey, type BodyStore, type PreviewBodyRef } from './think/body-store';

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
  root = await mkdtemp('/tmp/opencode/think-body-test-');
  vault = join(root, 'vault');
  const metadata = join(root, 'private-metadata');
  directory = join(metadata, 'owned-bodies');
  await mkdir(vault, { mode: 0o700 });
  await mkdir(metadata, { mode: 0o700 });
  store = undefined;
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

  it('creates an exclusive private namespace outside the vault and owner-only regular single-link files', async () => {
    store = await createBodyStore({ directory, epoch, vaultDirectory: vault });
    await store.replace(key, bytes('fixture private body'), 'canonical');
    expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    let files = 0;
    async function inspect(path: string): Promise<void> {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        const stat = await lstat(child);
        expect(stat.isSymbolicLink()).toBe(false);
        if (stat.isDirectory()) { expect(stat.mode & 0o777).toBe(0o700); await inspect(child); }
        else { expect(stat.isFile()).toBe(true); expect(stat.nlink).toBe(1); expect(stat.mode & 0o777).toBe(0o600); files++; }
      }
    }
    await inspect(directory);
    expect(files).toBeGreaterThan(0);
    expect(await readdir(vault)).toEqual([]);
    await expect(createBodyStore({ directory, epoch, vaultDirectory: vault })).rejects.toMatchObject({ code: 'resource_failure' });
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

  it('refuses an inside-vault namespace and symlinked namespace without changing the target', async () => {
    const victim = join(vault, 'fixture.txt');
    await writeFile(victim, 'fixture untouched', { mode: 0o600 });
    await expect(createBodyStore({ directory: join(vault, 'bodies'), epoch, vaultDirectory: vault })).rejects.toMatchObject({ code: 'resource_failure' });
    await symlink(vault, directory, 'dir');
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
