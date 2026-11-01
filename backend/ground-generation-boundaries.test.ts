import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createGroundGeneration } from './ground-generation';
import { recentGenerationContext } from './ground-generation-context';
import type { GroundGenerationConfig } from './ground-generation-config';
import type { GroundGenerationState } from './ground-generation-state';
import type { GroundGenerationPreflight } from './ground-generation-state';
import type { GroundGenerationNative } from './ground-generation-native';

const now = Date.parse('2032-04-17T10:23:00.000Z');
const config: GroundGenerationConfig = { timeZone: 'UTC', questions: { schedule: '0 10 * * *', count: 2 },
  quotes: { schedule: '0 11 * * 1', count: 1 }, context: { lookbackDays: 3, maxNotes: 1, maxNoteBytes: 1024, maxTotalBytes: 2048 } };
let root = '';
afterEach(async () => { vi.useRealTimers(); if (root) await rm(root, { recursive: true, force: true }); root = ''; });

it.each([
  ['before spring transition', '2026-03-07T12:00:00.000Z', '2026-03-07T00:00:00.000Z'],
  ['after spring transition', '2026-03-08T12:00:00.000Z', '2026-03-08T00:00:00.000Z'],
  ['before autumn transition', '2026-10-31T12:00:00.000Z', '2026-10-31T00:00:00.000Z'],
  ['after autumn transition', '2026-11-01T12:00:00.000Z', '2026-11-01T00:00:00.000Z'],
])('uses the configured New York calendar date %s', async (_label, current, expected) => {
  root = await mkdtemp('/tmp/opencode/ground-generation-zone-');
  vi.useFakeTimers({ now: new Date(current) });
  const begin = vi.fn<GroundGenerationPreflight['beginPreflight']>(() => ({ allowed: false, fact: { attempts: 3, retryAt: null, blocked: false } }));
  const preflight: GroundGenerationPreflight = { beginPreflight: begin, failedPreflight: () => null };
  const state: GroundGenerationState = { pending: () => null, claim: vi.fn(() => null), creating: vi.fn(), verified: vi.fn(),
    attempted: vi.fn(), admitted: vi.fn(), abandonUndispatched: vi.fn(), isTranscript: () => false };
  const native: GroundGenerationNative = { validate: vi.fn(async () => {}), create: vi.fn(async () => ({})),
    prompt: vi.fn(async () => {}), observe: vi.fn(async () => ({ admitted: false, complete: false })) };
  const generator = createGroundGeneration({ config: { ...config, timeZone: 'America/New_York', questions: { schedule: '0 6 * * *', count: 2 } },
    directory: root, transcriptDirectory: ['transcripts'], state, native, selection: {}, preflight });
  try {
    generator.start(); generator.demand(); await vi.advanceTimersByTimeAsync(1);
    expect(begin).toHaveBeenCalledOnce();
    expect(begin.mock.calls[0][0]).toEqual({ directory: root, timeZone: 'America/New_York', scheduledAt: Date.parse(expected), period: Date.parse(expected) });
    expect(native.create).not.toHaveBeenCalled();
  } finally { await generator.close(); }
});

it('GROUND-9YA7-02 bounds pre-admission validation retries for one occurrence with increasing backoff', async () => {
  root = await mkdtemp('/tmp/opencode/ground-generation-retry-');
  vi.useFakeTimers({ now });
  const times: number[] = [];
  const validate = vi.fn(async () => { times.push(Date.now()); throw new Error('fixture validation unavailable'); });
  const native: GroundGenerationNative = { validate, create: vi.fn(async () => ({})), prompt: vi.fn(async () => {}),
    observe: vi.fn(async () => ({ admitted: false, complete: false })) };
  const state: GroundGenerationState = { pending: () => null, claim: vi.fn(() => null), creating: vi.fn(), verified: vi.fn(),
    attempted: vi.fn(), admitted: vi.fn(), abandonUndispatched: vi.fn(), isTranscript: () => false };
  const generation = createGroundGeneration({ config, directory: root, transcriptDirectory: ['new-transcripts'], state, native, selection: {} });
  try {
    generation.start(); generation.demand();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(times.length).toBeGreaterThan(0);
    expect(native.create).not.toHaveBeenCalled(); expect(native.prompt).not.toHaveBeenCalled(); expect(state.claim).not.toHaveBeenCalled();
    expect(times.length, 'at most three automatic attempts for the same occurrence').toBeLessThanOrEqual(3);
    if (times.length === 3) expect(times[2] - times[1]).toBeGreaterThan(times[1] - times[0]);
    expect(times).toHaveLength(3);
    generation.demand(); await vi.advanceTimersByTimeAsync(1);
    expect(times).toHaveLength(4);
  } finally { await generation.close(); }
});

it('retains a new-period demand arriving while the prior period is still running', async () => {
  root = await mkdtemp('/tmp/opencode/ground-generation-demand-');
  vi.useFakeTimers({ now: new Date('2032-04-17T23:59:50.000Z') });
  let release: () => void = () => { throw new Error('validation gate not initialized'); };
  const gate = new Promise<void>(resolve => { release = resolve; });
  const begin = vi.fn<GroundGenerationPreflight['beginPreflight']>(() => ({ allowed: true, fact: { attempts: 1, retryAt: null, blocked: false } }));
  const state: GroundGenerationState = { pending: () => null, claim: vi.fn(() => null), creating: vi.fn(), verified: vi.fn(),
    attempted: vi.fn(), admitted: vi.fn(), abandonUndispatched: vi.fn(), isTranscript: () => false };
  const native: GroundGenerationNative = { validate: vi.fn(async () => gate), create: vi.fn(async () => ({})),
    prompt: vi.fn(async () => {}), observe: vi.fn(async () => ({ admitted: false, complete: false })) };
  const runner = createGroundGeneration({ config, directory: root, transcriptDirectory: ['transcripts'], state, native, selection: {},
    preflight: { beginPreflight: begin, failedPreflight: () => null } });
  try {
    runner.start(); runner.demand(); await vi.advanceTimersByTimeAsync(1);
    expect(native.validate).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date('2032-04-18T00:00:01.000Z'));
    runner.demand(); release();
    await vi.waitFor(() => expect(begin).toHaveBeenCalledTimes(2));
    expect(begin.mock.calls.map(([occurrence]) => occurrence.period)).toEqual([
      Date.parse('2032-04-17T00:00:00.000Z'), Date.parse('2032-04-18T00:00:00.000Z'),
    ]);
  } finally { await runner.close(); }
});

it('GROUND-9YA7-03 excludes older mapped transcript paths before applying the newest-note cap', async () => {
  root = await realpath(await mkdtemp('/tmp/opencode/ground-generation-context-'));
  await mkdir(join(root, 'old-transcripts'));
  await mkdir(join(root, 'new-transcripts'));
  await mkdir(join(root, 'notes'));
  const transcript = join(root, 'old-transcripts', 'chat.md');
  const note = join(root, 'notes', 'eligible.md');
  await writeFile(transcript, 'Private old mapped transcript must not be context');
  await writeFile(note, 'Owned eligible note');
  await utimes(note, new Date(now - 2000), new Date(now - 2000));
  await utimes(transcript, new Date(now - 1000), new Date(now - 1000));
  const isTranscript = vi.fn((directory: string, id: readonly string[]) => directory === root && id.join('/') === 'old-transcripts/chat.md');
  const excerpts = await recentGenerationContext({ directory: root, transcriptDirectory: ['new-transcripts'], limits: config.context,
    state: { isTranscript }, now, signal: new AbortController().signal });
  expect(excerpts).toEqual([{ noteId: ['notes', 'eligible.md'], modifiedAt: new Date(now - 2000).toISOString(), text: 'Owned eligible note' }]);
  expect(JSON.stringify(excerpts)).not.toContain('Private old mapped transcript');
});

it('selects bounded newest context across more than 10000 vault entries', async () => {
  root = await realpath(await mkdtemp('/tmp/opencode/ground-generation-large-context-'));
  for (const name of ['bulk', 'first', 'last']) await mkdir(join(root, name));
  // A directory symlink must not be traversed, even when it points back to the root.
  await symlink(root, join(root, 'cycle'));
  const older = new Date(now - 3600000);
  for (let start = 0; start < 10001; start += 100) {
    await Promise.all(Array.from({ length: Math.min(100, 10001 - start) }, async (_, index) => {
      const file = join(root, 'bulk', `owned-${start + index}.md`);
      await writeFile(file, 'older fixture note'); await utimes(file, older, older);
    }));
  }
  const newest = join(root, 'first', 'newest.md'); const next = join(root, 'last', 'next.md');
  await writeFile(newest, 'newest-1 trailing fixture text');
  await writeFile(next, 'next-item trailing fixture text');
  await utimes(newest, new Date(now - 1000), new Date(now - 1000));
  await utimes(next, new Date(now - 2000), new Date(now - 2000));
  const excerpts = await recentGenerationContext({ directory: root, transcriptDirectory: ['transcripts'],
    limits: { lookbackDays: 3, maxNotes: 2, maxNoteBytes: 8, maxTotalBytes: 12 },
    state: { isTranscript: () => false }, now, signal: new AbortController().signal });
  expect(excerpts).toEqual([
    { noteId: ['first', 'newest.md'], modifiedAt: new Date(now - 1000).toISOString(), text: 'newest-1' },
    { noteId: ['last', 'next.md'], modifiedAt: new Date(now - 2000).toISOString(), text: 'next' },
  ]);
}, 30000);

it('stops context enumeration when cancelled during traversal', async () => {
  root = await realpath(await mkdtemp('/tmp/opencode/ground-generation-cancel-context-'));
  const note = join(root, 'eligible.md'); await writeFile(note, 'Owned cancellation fixture');
  await utimes(note, new Date(now - 1000), new Date(now - 1000));
  const controller = new AbortController();
  const isTranscript = vi.fn(() => { controller.abort(); return false; });
  await expect(recentGenerationContext({ directory: root, transcriptDirectory: ['transcripts'], limits: config.context,
    state: { isTranscript }, now, signal: controller.signal })).rejects.toThrow('context stopped');
  expect(isTranscript).toHaveBeenCalledOnce();
});
