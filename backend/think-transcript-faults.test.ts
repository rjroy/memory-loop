import { constants } from 'node:fs';
import { appendFile, link, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { OwnedTranscriptFile, TranscriptNamespace, transcriptIO, type TranscriptBytes, type TranscriptHandle, type TranscriptIO } from './think/transcript-file';
import { createTranscriptWriter, type TranscriptRuntime } from './think/transcript';
import { createBodyStore } from './think/body-store';
import type { ProjectionEntry, ThinkContentReader } from './think/projection';

const filename = 'think-11111111-1111-4111-8111-111111111111.md';
const bytes = (text: string): TranscriptBytes => {
  const data = Buffer.from(text);
  return { length: data.length, async *chunks(offset) { for (let at = offset; at < data.length; at += 65536) yield data.subarray(at, at + 65536); } };
};
const running = () => false;

it('resumes short writes and failed sync without duplicating bytes or rescanning confirmed history', async () => {
  const root = await mkdtemp('/tmp/opencode/think-transcript-fault-');
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

it('rejects existing targets and symlinked directories without touching owned outside sentinels', async () => {
  const root = await mkdtemp('/tmp/opencode/think-transcript-namespace-');
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

it.each(['collision', 'symlink', 'hardlink', 'edit', 'replacement'] as const)('preserves existing or externally changed files on %s conflict', async scenario => {
  const root = await mkdtemp('/tmp/opencode/think-transcript-conflict-');
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

it('rejects a directory replaced by a symlink after opening without writing either namespace', async () => {
  const root = await mkdtemp('/tmp/opencode/think-transcript-swap-');
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

it.each(['uid', 'link-count', 'type'] as const)('rejects controlled invalid %s metadata before writing', async scenario => {
  const root = await mkdtemp('/tmp/opencode/think-transcript-stat-');
  const io: TranscriptIO = { ...transcriptIO, async open(path, flags, mode) {
    const handle = await transcriptIO.open(path, flags, mode);
    if (!(flags & constants.O_APPEND)) return handle;
    return { fd: handle.fd, close: () => handle.close(), read: (...args) => handle.read(...args), write: (...args) => handle.write(...args), sync: () => handle.sync(),
      async stat() {
        const stat = await handle.stat();
        return new Proxy(stat, { get(target, property, receiver) {
          if (scenario === 'uid' && property === 'uid') return stat.uid + 1;
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
  const root = await mkdtemp('/tmp/opencode/think-writer-review-');
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
