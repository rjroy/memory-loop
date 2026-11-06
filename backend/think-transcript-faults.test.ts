import { constants } from 'node:fs';
import { appendFile, chmod, link, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { OwnedTranscriptFile, TranscriptNamespace, transcriptIO, type TranscriptBytes, type TranscriptHandle, type TranscriptIO } from './think/transcript-file';
import { createTranscriptWriter, type TranscriptRuntime } from './think/transcript';
import { createBodyStore } from './think/body-store';
import type { ProjectionEntry, ThinkContentReader } from './think/projection';
import { removeMappedTranscript } from './think/transcript-remove';
import { verifiedTranscriptNote } from './think/conversations';
import type { StoredTranscript } from './think/state';

const filename = 'think-11111111-1111-4111-8111-111111111111.md';
const bytes = (text: string): TranscriptBytes => {
  const data = Buffer.from(text);
  return { length: data.length, async *chunks(offset) { for (let at = offset; at < data.length; at += 65536) yield data.subarray(at, at + 65536); } };
};
const running = () => false;

it('verifies and removes an owned transcript using read-only file access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-read-delete-'));
  const namespace = new TranscriptNamespace(root, 'Conversations/Memory Loop');
  try {
    const file = new OwnedTranscriptFile(namespace, filename);
    await file.append(bytes('owned checkpoint bytes'), running);
    const noteId = ['Conversations', 'Memory Loop', filename];
    const record: StoredTranscript = { conversationId: '11111111-1111-4111-8111-111111111111', noteId,
      createdAt: 1, namespace: namespace.identities(), file: file.confirmedCheckpoint(), pending: null };
    const path = join(root, ...noteId);
    const sentinel = join(root, 'sentinel');
    await writeFile(sentinel, 'unrelated');
    expect(await readFile(path, 'utf8')).toBe('owned checkpoint bytes');
    await namespace.close();
    let readOpens = 0;
    let readBytes = 0;
    let fileSyncs = 0;
    const io: TranscriptIO = { ...transcriptIO, async open(name, flags, mode) {
      if ((flags & (constants.O_WRONLY | constants.O_RDWR)) !== 0) {
        throw Object.assign(new Error('fixture denies file write access'), { code: 'EACCES' });
      }
      const handle = await transcriptIO.open(name, flags, mode);
      readOpens++;
      return { fd: handle.fd, stat: () => handle.stat(), close: () => handle.close(),
        async read(...args) { const result = await handle.read(...args); readBytes += result.bytesRead; return result; },
        write: (...args) => handle.write(...args),
        async sync() { fileSyncs++; throw new Error('deletion must not sync the verified file'); } };
    } };
    await removeMappedTranscript(root, record, () => null, running, io);
    expect(readOpens).toBeGreaterThan(0);
    expect(readBytes).toBeGreaterThanOrEqual(Buffer.byteLength('owned checkpoint bytes'));
    expect(fileSyncs).toBe(0);
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(sentinel, 'utf8')).toBe('unrelated');
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it('syncs owned transcript file handles with write access and deletes only the verified mapping', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-write-sync-'));
  let synced = 0;
  let refused = 0;
  const io: TranscriptIO = { ...transcriptIO, async open(path, flags, mode) {
    const handle = await transcriptIO.open(path, flags, mode);
    const writable = (flags & (constants.O_WRONLY | constants.O_RDWR)) !== 0;
    return { fd: handle.fd, stat: () => handle.stat(), read: (...args) => handle.read(...args),
      write: (...args) => handle.write(...args), close: () => handle.close(),
      async sync() {
        if (!writable) { refused++; throw Object.assign(new Error('fixture read-only file sync'), { code: 'EBADF' }); }
        synced++; await handle.sync();
      } };
  } };
  const namespace = new TranscriptNamespace(root, 'Conversations/Memory Loop', io);
  try {
    const file = new OwnedTranscriptFile(namespace, filename);
    await file.append(bytes('owned prefix'), running);
    await file.checkpoint(running);
    await file.append(bytes(' continuation'), running);
    const noteId = ['Conversations', 'Memory Loop', filename];
    const record: StoredTranscript = { conversationId: '11111111-1111-4111-8111-111111111111', noteId,
      createdAt: 1, namespace: namespace.identities(), file: file.confirmedCheckpoint(), pending: null };
    const path = join(root, ...noteId);
    expect(await readFile(path, 'utf8')).toBe('owned prefix continuation');
    const sentinel = join(root, 'sentinel');
    await writeFile(sentinel, 'untouched');
    await namespace.close();
    await removeMappedTranscript(root, record, () => null, running, io);
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(sentinel, 'utf8')).toBe('untouched');
    expect(synced).toBeGreaterThan(0);
    expect(refused).toBe(0);
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('canonicalizes a linked vault root for an owned transcript append', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-linked-root-'));
  const vault = join(root, 'vault'); const alias = join(root, 'vault-link');
  await mkdir(vault);
  await symlink(vault, alias, 'dir');
  const namespace = new TranscriptNamespace(alias, 'Conversations/Memory Loop');
  try {
    await new OwnedTranscriptFile(namespace, filename).append(bytes('owned transcript'), running);
    expect(await readFile(join(vault, 'Conversations', 'Memory Loop', filename), 'utf8')).toBe('owned transcript');
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32').each(['recent', 'delete'] as const)('handles a verified mapped transcript through a linked root for %s', async operation => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-linked-mapping-'));
  const vault = join(root, 'vault'); const alias = join(root, 'vault-link');
  await mkdir(vault);
  await symlink(vault, alias, 'dir');
  const namespace = new TranscriptNamespace(vault, 'Conversations/Memory Loop');
  try {
    const file = new OwnedTranscriptFile(namespace, filename);
    await file.append(bytes('owned transcript'), running);
    const record: StoredTranscript = { conversationId: '11111111-1111-4111-8111-111111111111',
      noteId: ['Conversations', 'Memory Loop', filename], createdAt: 1,
      namespace: namespace.identities(), file: file.confirmedCheckpoint(), pending: null };
    const sentinel = join(vault, 'sentinel');
    await writeFile(sentinel, 'unrelated');
    await namespace.close();
    if (operation === 'recent') {
      expect(await verifiedTranscriptNote(alias, record)).toEqual(record.noteId);
      expect(await verifiedTranscriptNote(alias, { ...record, file: null })).toBeUndefined();
      expect(await readFile(join(vault, ...record.noteId), 'utf8')).toBe('owned transcript');
    } else {
      await removeMappedTranscript(alias, record, () => null, running);
      await expect(lstat(join(vault, ...record.noteId))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(await readFile(sentinel, 'utf8')).toBe('unrelated');
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it('refuses a new nonportable transcript directory without creating it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-new-name-'));
  await mkdir(join(root, 'Conversations'));
  await writeFile(join(root, 'sentinel'), 'untouched');
  const namespace = new TranscriptNamespace(root, 'Conversations/CON');
  try {
    await expect(new OwnedTranscriptFile(namespace, filename).append(bytes('must not write'), running)).rejects.toThrow();
    await expect(lstat(join(root, 'Conversations', 'CON'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, 'sentinel'), 'utf8')).toBe('untouched');
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('uses an existing host-valid nonportable transcript parent without adopting existing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-legacy-parent-'));
  const parent = join(root, 'legacy:folder');
  await mkdir(parent);
  await writeFile(join(parent, 'sentinel'), 'untouched');
  const namespace = new TranscriptNamespace(root, 'legacy:folder');
  try {
    const file = new OwnedTranscriptFile(namespace, filename);
    await file.append(bytes('owned'), running);
    await file.append(bytes(' continuation'), running);
    expect(await readFile(join(parent, filename), 'utf8')).toBe('owned continuation');
    expect(await readFile(join(parent, 'sentinel'), 'utf8')).toBe('untouched');
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('accepts an exclusively created transcript with accessible non-owner-only mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-modes-'));
  let changed = false;
  const io: TranscriptIO = { ...transcriptIO, async open(path, flags, mode) {
    const handle = await transcriptIO.open(path, flags, mode);
    if ((flags & constants.O_CREAT) && (flags & constants.O_EXCL)) {
      try { await chmod(path, 0o644); changed = true; }
      catch (error) { await handle.close(); throw error; }
    }
    return handle;
  } };
  const namespace = new TranscriptNamespace(root, 'Conversations/Memory Loop', io);
  try {
    const file = new OwnedTranscriptFile(namespace, filename);
    await file.append(bytes('first'), running);
    await file.append(bytes(' second'), running);
    expect(changed).toBe(true);
    expect(await readFile(join(root, 'Conversations', 'Memory Loop', filename), 'utf8')).toBe('first second');
    expect(file.confirmedCheckpoint().offset).toBe(Buffer.byteLength('first second'));
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it('rejects an observed vault root replacement before further transcript writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-root-swap-'));
  const vault = join(root, 'vault'); const original = join(root, 'original');
  await mkdir(vault);
  const namespace = new TranscriptNamespace(vault, 'Conversations/Memory Loop');
  const file = new OwnedTranscriptFile(namespace, filename);
  try {
    await file.append(bytes('owned prefix'), running);
    await rename(vault, original);
    await mkdir(join(vault, 'Conversations', 'Memory Loop'), { recursive: true });
    const replacement = join(vault, 'Conversations', 'Memory Loop', filename);
    await writeFile(replacement, 'replacement sentinel');
    await expect(file.append(bytes(' unsafe'), running)).rejects.toMatchObject({ reason: 'conflict' });
    expect(await readFile(join(original, 'Conversations', 'Memory Loop', filename), 'utf8')).toBe('owned prefix');
    expect(await readFile(replacement, 'utf8')).toBe('replacement sentinel');
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform !== 'win32')('accepts a configured root junction but refuses a descendant junction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-junction-'));
  const vault = join(root, 'vault'); const outside = join(root, 'outside'); const alias = join(root, 'alias');
  await mkdir(vault); await mkdir(outside);
  await writeFile(join(outside, 'sentinel'), 'untouched');
  await symlink(vault, alias, 'junction');
  await symlink(outside, join(vault, 'linked'), 'junction');
  const valid = new TranscriptNamespace(alias, 'Conversations/Memory Loop');
  const linked = new TranscriptNamespace(alias, 'linked');
  try {
    await new OwnedTranscriptFile(valid, filename).append(bytes('owned'), running);
    await expect(new OwnedTranscriptFile(linked, filename).append(bytes('unsafe'), running)).rejects.toThrow();
    expect(await readFile(join(vault, 'Conversations', 'Memory Loop', filename), 'utf8')).toBe('owned');
    expect(await readFile(join(outside, 'sentinel'), 'utf8')).toBe('untouched');
  } finally { await valid.close(); await linked.close(); await rm(root, { recursive: true, force: true }); }
});

it('resumes short writes and failed sync without duplicating bytes or rescanning confirmed history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-fault-'));
  let phase: 'normal' | 'short' | 'write-fail' | 'sync-fail' = 'normal';
  let readBytes = 0;
  let fileSyncs = 0;
  const io: TranscriptIO = { ...transcriptIO, async open(path, flags, mode) {
    const handle = await transcriptIO.open(path, flags, mode);
    if (!(flags & constants.O_APPEND)) return handle;
    const wrapped: TranscriptHandle = {
      fd: handle.fd, stat: () => handle.stat(), close: () => handle.close(),
      async read(buffer, offset, length, position) { const result = await handle.read(buffer, offset, length, position); readBytes += result.bytesRead; return result; },
      async write(buffer, offset, length, position) {
        if (phase === 'write-fail') throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
        if (phase === 'short') { phase = 'write-fail'; return handle.write(buffer, offset, Math.min(7, length), position); }
        return handle.write(buffer, offset, length, position);
      },
      async sync() { fileSyncs++; if (phase === 'sync-fail') throw Object.assign(new Error('fixture sync failure'), { code: 'EIO' }); await handle.sync(); },
    };
    return wrapped;
  } };
  const namespace = new TranscriptNamespace(root, 'Conversations/Memory Loop', io);
  const file = new OwnedTranscriptFile(namespace, filename);
  const target = join(root, 'Conversations', 'Memory Loop', filename);
  const firstText = 'confirmed historical bytes\n'.repeat(4000);
  const nextText = 'new UTF-8 Ω and fence `````\r\n';
  const first = bytes(firstText);
  const next = bytes(nextText);
  try {
    await file.append(first, running);
    phase = 'short';
    await expect(file.append(next, running)).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe(firstText + Buffer.from(nextText).subarray(0, 7).toString());
    const priorReads = readBytes;
    await expect(file.append(next, running)).rejects.toThrow();
    expect(readBytes).toBe(priorReads);
    phase = 'sync-fail';
    await expect(file.append(next, running)).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe(firstText + nextText);
    const failedSyncs = fileSyncs;
    phase = 'normal';
    await file.append(next, running);
    expect(fileSyncs).toBeGreaterThan(failedSyncs);
    expect(await readFile(target, 'utf8')).toBe(firstText + nextText);
    expect(readBytes - priorReads).toBeLessThan(Buffer.byteLength(firstText));
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('rejects existing targets and symlinked directories without touching owned outside sentinels', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-namespace-'));
  const vault = join(root, 'vault');
  const outside = join(root, 'outside');
  await mkdir(vault); await mkdir(outside);
  const sentinel = join(outside, filename);
  await writeFile(sentinel, 'outside sentinel', { mode: 0o600 });
  const namespace = new TranscriptNamespace(vault, 'Conversations/Memory Loop');
  try {
    await symlink(outside, join(vault, 'Conversations'));
    await expect(new OwnedTranscriptFile(namespace, filename).append(bytes('unsafe'), running)).rejects.toMatchObject({ reason: 'conflict' });
    expect(await readFile(sentinel, 'utf8')).toBe('outside sentinel');
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

for (const scenario of ['collision', 'symlink', 'hardlink', 'edit', 'replacement'] as const) {
it.skipIf(process.platform === 'win32' && scenario === 'symlink')(`preserves existing or externally changed files on ${scenario} conflict`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-conflict-'));
  const directory = join(root, 'Conversations', 'Memory Loop');
  await mkdir(directory, { recursive: true });
  const target = join(directory, filename);
  const outside = join(root, 'outside');
  await writeFile(outside, 'fixture sentinel', { mode: 0o600 });
  const namespace = new TranscriptNamespace(root, 'Conversations/Memory Loop');
  const file = new OwnedTranscriptFile(namespace, filename);
  try {
    if (scenario === 'collision') await writeFile(target, 'existing', { mode: 0o600 });
    if (scenario === 'symlink') await symlink(outside, target);
    if (scenario === 'hardlink') await link(outside, target);
    if (scenario === 'edit' || scenario === 'replacement') {
      await file.append(bytes('owned prefix'), running);
      if (scenario === 'edit') await appendFile(target, ' external edit');
      else { await rename(target, `${target}.moved`); await writeFile(target, 'replacement', { mode: 0o600 }); }
    }
    const before = await readFile(target, 'utf8');
    const pending = bytes('new entry');
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(file.append(pending, running)).rejects.toMatchObject({ reason: 'conflict' });
      expect(await readFile(target, 'utf8')).toBe(before);
    }
    expect(await readFile(outside, 'utf8')).toBe('fixture sentinel');
    if (scenario === 'replacement') expect(await readFile(`${target}.moved`, 'utf8')).toBe('owned prefix');
    if (scenario === 'symlink') expect((await lstat(target)).isSymbolicLink()).toBe(true);
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});
}

it.skipIf(process.platform === 'win32')('rejects a directory replaced by a symlink after opening without writing either namespace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-swap-'));
  const vault = join(root, 'vault');
  const outside = join(root, 'outside');
  await mkdir(vault); await mkdir(outside);
  const namespace = new TranscriptNamespace(vault, 'Conversations/Memory Loop');
  const file = new OwnedTranscriptFile(namespace, filename);
  const original = join(vault, 'Conversations', 'Memory Loop', filename);
  const moved = join(vault, 'Conversations-moved', 'Memory Loop', filename);
  const sentinel = join(outside, 'sentinel');
  await writeFile(sentinel, 'outside untouched');
  try {
    await file.append(bytes('owned prefix'), running);
    await rename(join(vault, 'Conversations'), join(vault, 'Conversations-moved'));
    await symlink(outside, join(vault, 'Conversations'));
    const pending = bytes('must not append');
    for (let attempt = 0; attempt < 2; attempt++) await expect(file.append(pending, running)).rejects.toMatchObject({ reason: 'conflict' });
    expect(await readFile(moved, 'utf8')).toBe('owned prefix');
    expect(await readFile(sentinel, 'utf8')).toBe('outside untouched');
    await expect(lstat(original)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it.each(['link-count', 'type'] as const)('rejects controlled invalid %s metadata before writing', async scenario => {
  const root = await mkdtemp(join(tmpdir(), 'think-transcript-stat-'));
  const io: TranscriptIO = { ...transcriptIO, async open(path, flags, mode) {
    const handle = await transcriptIO.open(path, flags, mode);
    if (!(flags & constants.O_APPEND)) return handle;
    return { fd: handle.fd, close: () => handle.close(), read: (...args) => handle.read(...args), write: (...args) => handle.write(...args), sync: () => handle.sync(),
      async stat() {
        const stat = await handle.stat();
        return new Proxy(stat, { get(target, property, receiver) {
          if (scenario === 'link-count' && property === 'nlink') return 2;
          if (scenario === 'type' && property === 'isFile') return () => false;
          return Reflect.get(target, property, receiver);
        } });
      } };
  } };
  const namespace = new TranscriptNamespace(root, 'Conversations/Memory Loop', io);
  try {
    await expect(new OwnedTranscriptFile(namespace, filename).append(bytes('must not write'), running)).rejects.toMatchObject({ reason: 'conflict' });
    expect(await readFile(join(root, 'Conversations', 'Memory Loop', filename), 'utf8')).toBe('');
  } finally { await namespace.close(); await rm(root, { recursive: true, force: true }); }
});

it.each([['P4-01', 'checkpoint'], ['P4-02', 'attention']] as const)('%s preserves pending progress and attention through retry failures', async (_id, scenario) => {
  const root = await mkdtemp(join(tmpdir(), 'think-writer-review-'));
  const vault = join(root, 'vault');
  await mkdir(vault);
  const conversationId = '11111111-1111-4111-8111-111111111111';
  const commandId = '22222222-2222-4222-8222-222222222222';
  const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const store = await createBodyStore({ directory: join(root, 'bodies'), vaultDirectory: vault, epoch });
  const body = await store.replace({ conversationId, owner: { kind: 'original', clientCommandId: commandId, messageId: 'msg_fixture' } }, (async function* () { yield Buffer.from('fixture original'); })(), 'canonical');
  const entries: ProjectionEntry[] = [{ kind: 'original', clientCommandId: commandId, messageId: 'msg_fixture', body, displayOrder: 1 }];
  let revision = 1;
  let pageFails = false;
  const content: ThinkContentReader = { async page() { if (pageFails) throw new Error('fixture history unavailable'); return { conversationId, epoch, revision, entries: [...entries] }; }, open: ref => store.open(ref) };
  let now = 1_700_000_000_000;
  const timers = new Set<{ at: number; callback: () => void }>();
  const runtime: TranscriptRuntime = { now: () => now, random: () => 0.5, schedule(callback, delay) { const timer = { at: now + delay, callback }; timers.add(timer); return () => { timers.delete(timer); }; } };
  let fault: 'none' | 'stat' | 'sync' = 'none';
  let failures = 0;
  const io: TranscriptIO = { ...transcriptIO,
    async lstat(path) { if (fault === 'stat') { failures++; throw Object.assign(new Error('fixture unavailable'), { code: 'EIO' }); } return transcriptIO.lstat(path); },
    async open(path, flags, mode) {
      const handle = await transcriptIO.open(path, flags, mode);
      if (!(flags & constants.O_APPEND)) return handle;
      return { fd: handle.fd, stat: () => handle.stat(), read: (...args) => handle.read(...args), write: (...args) => handle.write(...args), close: () => handle.close(),
        async sync() { if (fault === 'sync') { failures++; throw Object.assign(new Error('fixture sync unavailable'), { code: 'EIO' }); } await handle.sync(); } };
    },
  };
  const writer = createTranscriptWriter(vault, content, () => {}, { runtime, io, warningAfterMs: 60000 });
  const path = join(vault, 'Conversations', 'Memory Loop', filename);
  const tick = async () => {
    const at = Math.min(...[...timers].map(timer => timer.at));
    if (!Number.isFinite(at)) throw new Error('fixture retry missing');
    now = at;
    for (const timer of [...timers]) if (timer.at <= at) { timers.delete(timer); timer.callback(); }
  };
  const addEntry = () => { entries.push({ kind: 'compaction', sessionId: 'ses_fixture', eventId: 'evt_fixture', phase: 'ended', sourceSequence: 1, sourceTime: now, displayOrder: 2 }); revision++; writer.changed(conversationId); };
  try {
    writer.changed(conversationId);
    await vi.waitFor(() => expect(writer.health(conversationId).state).toBe('up-to-date'));
    const original = await readFile(path);
    if (scenario === 'checkpoint') {
      pageFails = true; writer.changed(conversationId);
      await vi.waitFor(() => expect(writer.health(conversationId).state).toBe('retrying'));
      pageFails = false; fault = 'sync';
      await tick();
      await vi.waitFor(() => expect(failures).toBeGreaterThan(0));
      await vi.waitFor(() => expect(writer.health(conversationId)).toMatchObject({ state: 'retrying', reason: 'io_unavailable' }));
      addEntry();
      fault = 'none';
    } else {
      await appendFile(path, 'external edit');
      addEntry();
      await vi.waitFor(() => expect(writer.health(conversationId)).toMatchObject({ warning: true, reason: 'conflict' }));
      fault = 'stat';
      await tick();
      await vi.waitFor(() => expect(failures).toBeGreaterThan(0));
      await vi.waitFor(() => expect(writer.health(conversationId)).toMatchObject({ warning: true, reason: 'io_unavailable' }));
      fault = 'none';
      await writeFile(path, original);
    }
    await vi.waitFor(() => expect(timers.size).toBeGreaterThan(0));
    await tick();
    await vi.waitFor(() => expect(writer.health(conversationId)).toMatchObject({ state: 'up-to-date', warning: false }));
    const markdown = await readFile(path, 'utf8');
    expect(markdown.split('fixture original')).toHaveLength(2);
    expect(markdown.split('Context compacted.')).toHaveLength(2);
    expect(markdown).not.toContain('external edit');
  } finally { try { await writer.close(); } finally { try { await store.close(); } finally { await rm(root, { recursive: true, force: true }); } } }
});
