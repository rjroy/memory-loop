import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
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
  ['before spring transition', '2026-03-07T12:00:00.000Z', '2026-03-07T11:00:00.000Z'],
  ['after spring transition', '2026-03-08T12:00:00.000Z', '2026-03-08T10:00:00.000Z'],
  ['before autumn transition', '2026-10-31T12:00:00.000Z', '2026-10-31T10:00:00.000Z'],
  ['after autumn transition', '2026-11-01T12:00:00.000Z', '2026-11-01T11:00:00.000Z'],
])('uses the configured New York 6 AM latest-due occurrence %s', async (_label, current, expected) => {
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
    generator.start(); await vi.advanceTimersByTimeAsync(1);
    expect(begin).toHaveBeenCalledOnce();
    expect(begin.mock.calls[0][0]).toEqual({ directory: root, timeZone: 'America/New_York', scheduledAt: Date.parse(expected) });
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
    generation.start();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(times.length).toBeGreaterThan(0);
    expect(native.create).not.toHaveBeenCalled(); expect(native.prompt).not.toHaveBeenCalled(); expect(state.claim).not.toHaveBeenCalled();
    expect(times.length, 'at most three automatic attempts for the same occurrence').toBeLessThanOrEqual(3);
    if (times.length === 3) expect(times[2] - times[1]).toBeGreaterThan(times[1] - times[0]);
  } finally { await generation.close(); }
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
