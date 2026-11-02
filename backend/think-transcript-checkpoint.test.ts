import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Checkpoint, CompletionReport, CrashReport, InitialLoadReport, MigrationReport, Observation, OrderMigrationReport, OrderReopenReport, Probe, ReopenReport, ReopenScenario, Report, Scenario, V5MigrationReport, V6PreflightReport } from '../tests/think-transcript-checkpoint-fixture';
import { entryFor } from './think/transcript-format';
import type { BodyRef } from './think/body-store';
import type { ProjectionEntry } from './think/projection';

const conversationId = '11111111-1111-4111-8111-111111111111';
const commandId = '33333333-3333-4333-8333-333333333333';
const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nextEpoch = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const nativeId = `ses_memoryloop_${conversationId.replaceAll('-', '')}`;
const entryId = `user:${commandId}`;
const filename = `think-${conversationId}.md`;
const runner = resolve(import.meta.dirname, '../tests/think-transcript-checkpoint-fixture.ts');
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let root: string;
beforeEach(async () => { root = await mkdtemp('/tmp/opencode/think-transcript-checkpoint-'); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function child<T>(scenario: Scenario | 'probe' | 'migrate-v1' | 'migrate-v2-order' | 'migrate-v5-generation' | 'migrate-v6-preflight' | 'reopen-v3-order' | `reopen-${ReopenScenario}`, filename: string): Promise<T> {
  const output = join(root, filename);
  const result = spawnSync('/usr/bin/bun', ['--no-env-file', runner, root, scenario, output], {
    cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 256 * 1024,
    env: { NODE_ENV: 'test', PATH: '/usr/bin:/bin', HOME: root, XDG_CONFIG_HOME: root,
      XDG_DATA_HOME: root, XDG_CACHE_HOME: root, XDG_STATE_HOME: root, TMPDIR: root },
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, `existing production factories must run before durability assertions:\n${result.stdout}\n${result.stderr}`).toBe(0);
  // The JSON is produced by this typed test program, not an asserted production response schema.
  return JSON.parse(await readFile(output, 'utf8')) as T;
}
async function exercise(scenario: Scenario): Promise<{ report: Report; fresh: Probe }> {
  const report = await child<Report>(scenario, 'report.json');
  expect(report.scenario).toBe(scenario);
  expect(report.counts, 'logging/fault injection must not block native completion or request Stop').toEqual({ creates: 1, prompts: 1, stops: 0 });
  expect(report.markdown).not.toContain('fixture plugin-prepared');
  // This is a second Bun process and independent connection after service/body-store shutdown.
  // It checks durable writer facts, not native-history hydration or a resumed application chat.
  const fresh = await child<Probe>('probe', 'fresh.json');
  expect(fresh).toEqual(report.afterClose);
  return { report, fresh };
}
function observation(report: Report, at: Observation['at']): Observation {
  const found = report.observations.find(item => item.at === at);
  expect(found, `the real writer must reach ${at}`).toBeDefined();
  if (!found) throw new Error(`Missing ${at} filesystem observation`);
  expect(found.probe.writerAvailable, 'no SQLite write transaction may span filesystem calls').toBe(true);
  return found;
}
function checkpoint(probe: Probe, at: string): Checkpoint {
  expect(probe.checkpoint, `registry-bound transcript checkpoint must be committed ${at}; ${probe.issue ?? ''}`).not.toBeNull();
  if (!probe.checkpoint) throw new Error('missing durable transcript checkpoint');
  expect(probe.issue).toBeUndefined();
  // Checkpoints were introduced in v2 and retained through the v9 quote budget migration.
  expect(probe.schemaVersion).toBe(10);
  expect(probe.writerAvailable).toBe(true);
  expect(probe.checkpoint).toMatchObject({ conversationId, ownerConversationId: conversationId,
    nativeSessionId: nativeId, vaultDirectory: join(root, 'vault') });
  expect(JSON.parse(probe.checkpoint.noteIdJson)).toEqual(['Conversations', 'Memory Loop', filename]);
  return probe.checkpoint;
}
function pending(probe: Probe, expected: string): void {
  const state = checkpoint(probe, 'before unconfirmed append effects');
  expect(state).toMatchObject({ pendingEntryId: entryId, pendingLength: Buffer.byteLength(expected), pendingSha256: sha(expected), pendingState: 'ready' });
  expect(probe.entries).not.toContain(entryId);
  expect(probe.chunks.length, 'the test-owned original spans multiple bounded pending chunks').toBeGreaterThan(1);
  expect(probe.chunks.map(chunk => chunk.index)).toEqual(probe.chunks.map((_, index) => index));
  expect(probe.chunks.every(chunk => chunk.size > 0 && chunk.size <= 65536)).toBe(true);
  expect(Buffer.concat(probe.chunks.map(chunk => Buffer.from(chunk.hex, 'hex'))).toString('utf8')).toBe(expected);
}

function completionIdentity(report: CompletionReport): string {
  expect(report.counts, 'New chat and transcript I/O cannot replay or interrupt native execution').toEqual({ creates: 2, prompts: 1, stops: 0 });
  expect(report.promptAborted).toBe(false);
  expect(report.unusedTranscriptExists).toBe(false);
  expect(report.publication.command).toMatchObject({ kind: 'send', state: 'completed' });
  const canonical = report.publication.snapshot.entries.find(entry => entry.kind === 'assistant-text');
  expect(canonical).toMatchObject({ kind: 'assistant-text', closure: 'closed', capture: 'complete',
    body: { kind: 'canonical', through: Buffer.byteLength(report.assistant), sha256: sha(report.assistant) } });
  if (!canonical || canonical.kind !== 'assistant-text') throw new Error('fixture canonical publication missing');
  const entry = entryFor(canonical, 0);
  if (!entry) throw new Error('fixture canonical transcript identity missing');
  return entry.id;
}

const completionBlock = (text: string, id: string) => `\`\`\`\`text\n${text}\n\`\`\`\`\n<!-- memory-loop-end ${JSON.stringify({ entry_id: id })} -->\n\n`;

describe('observed canonical transcript completion', () => {
  it('invalidates synchronized health before immediate watch observers can read newly eligible completed canonical text', async () => {
    const report = await child<CompletionReport>('completion-publication', 'report.json');
    const id = completionIdentity(report);
    expect(report.publication.probe.entries).not.toContain(id);
    expect(report.publication.snapshot.transcript?.warning).toBe(false);
    expect(report.publication.notification.transcript?.warning).toBe(false);
    expect(report.publication.notification.transcript?.state, 'the first observer notification cannot carry the old saved claim').not.toBe('up-to-date');
    expect(report.publication.snapshot.transcript?.state, 'new canonical content is eligible but not yet synchronized').not.toBe('up-to-date');
  });

  it('does not report saved while the canonical closing fence or file sync is held, then confirms the exact complete record', async () => {
    const report = await child<CompletionReport>('completion-publication', 'report.json');
    const id = completionIdentity(report);
    const block = completionBlock(report.assistant, id);
    if (!report.append || !report.sync || !report.synchronized) throw new Error('fixture must reach each controlled append/sync boundary');
    expect(report.append.markdown).toContain(report.assistant);
    expect(report.append.markdown).not.toContain(block);
    expect(report.sync.markdown).toContain(block);
    for (const boundary of [report.append, report.sync]) {
      expect(boundary.snapshot.transcript?.state).not.toBe('up-to-date');
      expect(boundary.snapshot.transcript?.warning).toBe(false);
      expect(boundary.probe.entries).not.toContain(id);
      expect(checkpoint(boundary.probe, 'before canonical synchronization')).toMatchObject({ pendingEntryId: id, pendingState: 'ready' });
    }
    expect(report.sync.probe.checkpoint?.confirmedOffset).toBe(report.append.probe.checkpoint?.confirmedOffset);
    const synchronized = report.synchronized;
    expect(synchronized.snapshot.transcript).toMatchObject({ state: 'up-to-date', warning: false });
    expect(synchronized.markdown).toContain(block);
    expect(synchronized.markdown).toContain(completionBlock(report.original, entryId));
    expect(synchronized.markdown.split(report.assistant)).toHaveLength(2);
    expect(synchronized.probe.entries).toContain(id);
    expect(checkpoint(synchronized.probe, 'after canonical synchronization')).toMatchObject({ confirmedOffset: Buffer.byteLength(synchronized.markdown),
      confirmedSha256: sha(synchronized.markdown), pendingEntryId: null });
  });

  it('hands observed completed canonical text to disk or a sealed recoverable append before graceful close, without native-history recovery', async () => {
    const report = await child<CompletionReport>('completion-close', 'report.json');
    const id = completionIdentity(report);
    // Deliberately independent of publication.health: changing the label cannot
    // make shutdown discard the newly observed canonical work and pass this test.
    const fresh = await child<Probe>('probe', 'fresh.json');
    expect(fresh).toEqual(report.afterClose);
    const closed = checkpoint(fresh, 'after closing directly from the canonical observer');
    const confirmed = fresh.entries.includes(id);
    expect(confirmed || (closed.pendingEntryId === id && closed.pendingState === 'ready'),
      'graceful close must retain the completed AI record without requiring native history or an old body cache').toBe(true);
    let markdown = await readFile(join(root, 'vault', 'Conversations', 'Memory Loop', filename), 'utf8');
    let final = fresh;
    if (!confirmed) {
      const staged = Buffer.concat(fresh.chunks.map(chunk => Buffer.from(chunk.hex, 'hex')));
      expect(staged.length).toBe(closed.pendingLength);
      expect(sha(staged)).toBe(closed.pendingSha256);
      expect(staged.toString('utf8')).toContain(completionBlock(report.assistant, id));
      const recovered = await child<ReopenReport>('reopen-recover', 'recovered.json');
      expect(recovered.pid).not.toBe(report.pid);
      expect(recovered.sourceReads, 'pending recovery cannot consult native history').toBe(0);
      expect(recovered.bodyReads, 'pending recovery cannot consult the old body cache').toBe(0);
      expect(recovered.health).toMatchObject({ state: 'up-to-date', warning: false });
      markdown = Buffer.from(recovered.afterHex, 'hex').toString('utf8');
      final = recovered.after;
    }
    expect(markdown).toContain(completionBlock(report.assistant, id));
    expect(markdown).toContain(completionBlock(report.original, entryId));
    expect(markdown.split(report.assistant)).toHaveLength(2);
    expect(final.entries).toContain(id);
    const committed = checkpoint(final, 'after fresh-process confirmation');
    expect(sha(Buffer.from(markdown).subarray(0, committed.confirmedOffset))).toBe(committed.confirmedSha256);
    const block = completionBlock(report.assistant, id);
    const endOfAI = Buffer.byteLength(markdown.slice(0, markdown.indexOf(block)) + block);
    expect(committed.confirmedOffset).toBeGreaterThanOrEqual(endOfAI);
  });
});

describe('restart-stable transcript entry identity', () => {
  const body: Extract<BodyRef, { kind: 'canonical' }> = { key: { conversationId, owner: { kind: 'assistant-text', messageId: 'msg_fixture', ordinal: 0 } },
    epoch, contentId: conversationId, generation: epoch, kind: 'canonical', through: 5, sha256: sha('hello') };
  const canonical: Extract<ProjectionEntry, { kind: 'assistant-text' }> = { kind: 'assistant-text', messageId: 'msg_fixture', ordinal: 0,
    body, closure: 'closed', capture: 'complete', displayOrder: 2, sourceTime: 100 };

  it('keeps canonical AI identity when restart regenerates transport epoch, cache ID and generation', () => {
    const first = entryFor(canonical, 200);
    const restored = entryFor({ ...canonical, displayOrder: 99,
      body: { ...body, epoch: nextEpoch, contentId: commandId, generation: nextEpoch } }, 300);
    expect(first).toBeDefined();
    expect(restored?.id, 'the same canonical native part must not become a replacement merely because its body cache was rebuilt').toBe(first?.id);
    expect(restored?.semantic).toBe(first?.semantic);
  });

  it('distinguishes changed canonical facts while user/form identity remains bound to its command', () => {
    const id = entryFor(canonical, 200)?.id;
    for (const changed of [
      { ...canonical, messageId: 'msg_other', body: { ...body, key: { conversationId, owner: { kind: 'assistant-text' as const, messageId: 'msg_other', ordinal: 0 } } } },
      { ...canonical, ordinal: 1, body: { ...body, key: { conversationId, owner: { kind: 'assistant-text' as const, messageId: canonical.messageId, ordinal: 1 } } } },
      { ...canonical, body: { ...body, sha256: sha('other') } }, { ...canonical, body: { ...body, through: 6 } }]) {
      expect(entryFor(changed, 200)?.id).not.toBe(id);
    }
    for (const kind of ['original', 'form-reply'] as const) {
      const entry: ProjectionEntry = kind === 'original'
        ? { kind, clientCommandId: commandId, messageId: 'msg_input', body: { ...body,
          key: { conversationId, owner: { kind, clientCommandId: commandId, messageId: 'msg_input' } } }, displayOrder: 1 }
        : { kind, clientCommandId: commandId, decisionId: 'form_fixture', body: { ...body,
          key: { conversationId, owner: { kind, clientCommandId: commandId, decisionId: 'form_fixture' } } }, displayOrder: 1 };
      expect(entryFor({ ...entry, body: { ...entry.body, epoch: nextEpoch, generation: nextEpoch } }, 400)?.id).toBe(entryFor(entry, 200)?.id);
      expect(entryFor({ ...entry, clientCommandId: conversationId }, 200)?.id).not.toBe(entryFor(entry, 200)?.id);
    }
  });
});

describe('fresh Bun process registered transcript reopening', () => {
  function healthy(result: ReopenReport): void {
    expect(result.health).toMatchObject({ state: 'up-to-date', warning: false });
    const state = checkpoint(result.after, 'after a NEW writer/SQLite connection has actually run');
    const bytes = Buffer.from(result.afterHex, 'hex');
    expect(state).toMatchObject({ creationState: 'owned', confirmedOffset: bytes.length, confirmedSha256: sha(bytes),
      pendingEntryId: null, pendingLength: null, pendingSha256: null });
    expect(result.after.chunks).toEqual([]);
    expect(result.lockAvailable.length).toBeGreaterThan(0);
    expect(result.lockAvailable.every(Boolean), 'reopen I/O cannot hold a SQLite write transaction').toBe(true);
    for (const file of result.preserved.slice(1)) expect(file.afterHex).toBe(file.beforeHex);
  }
  function preservedFailure(result: ReopenReport, reason: 'conflict' | 'content_gap'): void {
    expect(result.writes).toBe(0);
    expect(result.writeBytes).toBe(0);
    for (const file of result.preserved) expect(file.afterHex, `writer must preserve ${file.path}`).toBe(file.beforeHex);
    expect(result.after).toEqual(result.before);
    expect(result.lockAvailable.every(Boolean)).toBe(true);
    expect(result.health).toMatchObject({ state: 'retrying', warning: true, reason });
  }

  it('reopens a confirmed owned checkpoint with fresh cache generations, appends a new observed fact and never duplicates old user/AI/form entries', async () => {
    const seed = await child<Report>('synced-form', 'report.json');
    expect(seed.counts).toEqual({ creates: 1, prompts: 1, stops: 0 });
    expect(seed.replies).toBe(1);
    expect(seed.markdown).toContain('fixture form answer 🧠');
    const result = await child<ReopenReport>('reopen-replay', 'reopened.json');
    expect(result.pid).not.toBe(seed.pid);
    healthy(result);
    expect(result.oldBodies.length).toBe(3);
    for (let index = 0; index < result.oldBodies.length; index++) {
      expect(result.newBodies[index].contentId).not.toBe(result.oldBodies[index].contentId);
      expect(result.newBodies[index].generation).not.toBe(result.oldBodies[index].generation);
    }
    const markdown = Buffer.from(result.afterHex, 'hex').toString('utf8');
    expect(markdown.startsWith(seed.markdown)).toBe(true);
    for (const text of ['durable fixture original 🧠', 'canonical fixture answer Ω', 'fixture form answer 🧠', 'Context compacted.']) {
      expect(markdown.split(text)).toHaveLength(2);
    }
    expect(result.after.entries).toHaveLength(seed.afterClose.entries.length + 1);
    const again = await child<ReopenReport>('reopen-replay', 'reopened-again.json');
    healthy(again);
    expect(again.pid).not.toBe(result.pid);
    expect(again.afterHex).toBe(result.afterHex);
    expect(again.writes).toBe(0);
    expect(again.after.entries).toEqual(result.after.entries);
  });

  it.each(['partial', 'confirm-failed', 'seal-failed'] as const)(
    'finishes the SAME persisted original after %s in a new process without old cache/native reads or duplicate bytes', async scenario => {
      const seed = await child<Report>(scenario, 'report.json');
      expect(seed.counts).toEqual({ creates: 1, prompts: 1, stops: 0 });
      expect(seed.health).toMatchObject({ state: 'retrying', reason: 'io_unavailable' });
      pending(seed.afterClose, seed.expectedOriginal);
      const baseline = checkpoint(seed.afterClose, 'at failed append shutdown').confirmedOffset;
      const actualTail = Buffer.from(seed.markdown).subarray(baseline);
      const originalBytes = Buffer.from(seed.expectedOriginal);
      expect(actualTail).toEqual(scenario === 'partial' ? originalBytes.subarray(0, 7) : scenario === 'seal-failed' ? Buffer.alloc(0) : originalBytes);
      if (scenario !== 'partial') {
        const fault = seed.storeFaults[0];
        expect(fault.point).toBe(scenario === 'seal-failed' ? 'after-seal' : 'before-confirm');
        pending(fault.probe, seed.expectedOriginal);
        expect(fault.probe.writerAvailable).toBe(true);
        if (scenario === 'confirm-failed') expect(fault.directorySyncs).toBe(3);
      }
      const result = await child<ReopenReport>('reopen-recover', 'recovered.json');
      expect(result.pid).not.toBe(seed.pid);
      healthy(result);
      expect(result.sourceReads).toBe(0);
      expect(result.bodyReads).toBe(0);
      expect(Buffer.from(result.afterHex, 'hex')).toEqual(Buffer.concat([Buffer.from(seed.markdown).subarray(0, baseline), originalBytes]));
      expect(result.writeBytes).toBe(originalBytes.length - actualTail.length);
      expect(result.after.entries.filter(id => id === entryId)).toHaveLength(1);
      const again = await child<ReopenReport>('reopen-verify-confirmed', 'verified-again.json');
      healthy(again);
      expect(again.afterHex).toBe(result.afterHex);
      expect(again.writes).toBe(0);
    });

  it('recovers after an actual Bun process exits without cleanup after all filesystem syncs but before SQLite confirmation', async () => {
    const seed = await child<CrashReport>('crash-before-confirm', 'crash.json');
    expect(seed.crashed).toBe(true);
    expect(seed.counts).toEqual({ creates: 1, prompts: 1, stops: 0 });
    pending(seed.pending, seed.expectedOriginal);
    const baseline = checkpoint(seed.pending, 'at unclean process exit').confirmedOffset;
    expect(Buffer.from(seed.markdown).subarray(baseline)).toEqual(Buffer.from(seed.expectedOriginal));
    const result = await child<ReopenReport>('reopen-recover', 'after-crash.json');
    expect(result.pid).not.toBe(seed.pid);
    healthy(result);
    expect(result.beforeHex).toBe(Buffer.from(seed.markdown).toString('hex'));
    expect(result.afterHex).toBe(result.beforeHex);
    expect(result.writes).toBe(0);
    expect(result.sourceReads).toBe(0);
    expect(result.bodyReads).toBe(0);
  });

  it('preserves a committed confirmation whose acknowledgement was lost, without appending its original again', async () => {
    const seed = await child<Report>('confirm-ack-lost', 'report.json');
    expect(seed.counts).toEqual({ creates: 1, prompts: 1, stops: 0 });
    const fault = seed.storeFaults[0];
    expect(fault.point).toBe('after-confirm');
    expect(fault.directorySyncs).toBe(3);
    expect(fault.probe.entries).toContain(entryId);
    expect(fault.probe.checkpoint?.pendingEntryId).toBeNull();
    const result = await child<ReopenReport>('reopen-verify-confirmed', 'after-ack-loss.json');
    healthy(result);
    expect(result.afterHex).toBe(Buffer.from(seed.markdown).toString('hex'));
    expect(result.writes).toBe(0);
    expect(result.after.entries.filter(id => id === entryId)).toHaveLength(1);
  });

  it.each(['prefix-edit', 'wrong-tail', 'replacement', 'symlink', 'hardlink', 'directory-moved'] as const)(
    'preserves every existing file on %s at the ACTUAL fresh-writer reopen boundary', async mode => {
      const seed = await child<Report>(mode === 'wrong-tail' ? 'partial' : 'synced', 'report.json');
      expect(seed.counts).toEqual({ creates: 1, prompts: 1, stops: 0 });
      const result = await child<ReopenReport>(`reopen-${mode}`, 'conflict.json');
      expect(result.pid).not.toBe(seed.pid);
      preservedFailure(result, 'conflict');
      if (mode === 'symlink') expect(result.fileType).toBe('symlink');
    });

  it.each(['missing-chunk', 'wrong-hash', 'unsealed'] as const)(
    'rejects %s persisted append state without confirming, writing or losing its checkpoint', async mode => {
      const seed = await child<Report>('partial', 'report.json');
      expect(seed.counts).toEqual({ creates: 1, prompts: 1, stops: 0 });
      const result = await child<ReopenReport>(`reopen-${mode}`, 'invalid-pending.json');
      expect(result.before.checkpoint?.pendingState).toBe(mode === 'unsealed' ? 'preparing' : 'ready');
      if (mode === 'unsealed') {
        expect(result.sourceReads, 'an empty fresh source notification must not erase unresolved staged work').toBeGreaterThan(0);
        expect(result.bodyReads).toBe(0);
      }
      preservedFailure(result, 'content_gap');
      expect(result.after.checkpoint?.pendingEntryId).toBe(entryId);
    });

  it('rejects different bytes under an already confirmed original command ID even with a new valid body cache', async () => {
    await child<Report>('synced', 'report.json');
    const result = await child<ReopenReport>('reopen-changed-original', 'changed-source.json');
    preservedFailure(result, 'conflict');
    expect(result.newBodies[0].generation).not.toBe(result.oldBodies[0].generation);
  });

  it('GROUNDTRANSCRIPT03 keeps a source conflict unhealthy through actual automatic retries and the warning threshold, clearing only after successful source revalidation', async () => {
    const seed = await child<Report>('synced', 'report.json');
    expect(seed.counts).toEqual({ creates: 1, prompts: 1, stops: 0 });
    const result = await child<ReopenReport>('reopen-changed-original-retry', 'source-retries.json');
    expect(result.writes).toBe(0);
    for (const file of result.preserved) expect(file.afterHex).toBe(file.beforeHex);
    expect(result.after).toEqual(result.before);
    expect(result.originalBeforeHex).not.toBeNull();
    expect(result.originalAfterHex).toBe(result.originalBeforeHex);
    expect(result.retry).toBeDefined();
    if (!result.retry) throw new Error('fixture must execute controlled retry callbacks');
    const { samples, revalidated, revalidationReads } = result.retry;
    expect(samples[0].health).toMatchObject({ state: 'retrying', reason: 'conflict', warning: true });
    expect(samples[1].callbacks).toBeGreaterThan(samples[0].callbacks);
    expect(samples.at(-1)?.elapsedMs).toBeGreaterThan(60000);
    expect(revalidated).toMatchObject({ state: 'up-to-date', warning: false });
    expect(revalidationReads).toBeGreaterThan(0);
    for (const sample of samples.slice(1)) {
      expect(sample.health, `unchanged bad source after ${sample.elapsedMs}ms and ${sample.callbacks} delivered callbacks`)
        .toMatchObject({ state: 'retrying', reason: 'conflict', warning: true });
      expect(sample.sourceReads).toBeGreaterThan(samples[0].sourceReads);
    }
    expect(samples.at(-1)?.callbacks).toBeGreaterThan(2);
  });

  it.each([['initial-load-failed', true], ['unused-load-failed', false]] as const)(
    'GROUNDTRANSCRIPT04 applies the normal warning threshold to %s without gating native work or warning on unused chats', async (scenario, eligible) => {
      const result = await child<InitialLoadReport>(scenario, 'initial-load.json');
      expect(result.eligible).toBe(eligible);
      expect(result.counts).toEqual({ creates: 2, prompts: eligible ? 1 : 0, stops: 0 });
      expect(result.admitted).toBe(eligible);
      expect(result.attempted).toBe(eligible);
      expect(result.originalCaptured).toBe(eligible);
      if (eligible) expect(result.eligibleLoadFailures).toBeGreaterThan(1);
      else expect(result.eligibleLoadFailures).toBe(0);
      expect(result.unusedLoadFailures).toBeGreaterThan(0);
      expect(result.transcriptWrites).toBe(0);
      expect(result.after.checkpoint).toBeNull();
      expect(result.initialQuiet, 'ordinary I/O outages do not warn immediately').toBe(true);
      expect(result.samples[1].callbacks).toBeGreaterThan(0);
      expect(result.samples.at(-1)?.callbacks).toBeGreaterThan(result.samples[1].callbacks);
      for (const sample of result.samples) {
        expect(sample.health).toMatchObject({ state: 'retrying', reason: 'io_unavailable' });
        expect(sample.nativeBusy).toBe(eligible);
        expect(sample.observer.warning, 'unused observer with the SAME load fault must stay quiet').toBe(false);
        if (sample.elapsedMs < 60000) expect(sample.health.warning).toBe(false);
      }
      const late = result.samples.filter(sample => sample.elapsedMs >= 60000);
      expect(late).toHaveLength(2);
      for (const sample of late) {
        expect(sample.health.warning, `eligible=${eligible}, persistent load failure after ${sample.elapsedMs}ms and ${sample.callbacks} delivered callbacks`).toBe(eligible);
        if (eligible) expect(sample.backgroundWarnings).toBeGreaterThan(0);
        else expect(sample.backgroundWarnings).toBe(0);
      }
    });

  it('cannot adopt an empty existing file after a creation-intent/acquired-identity crash window', async () => {
    const seed = await child<Report>('acquire-failed', 'report.json');
    expect(seed.counts).toEqual({ creates: 1, prompts: 1, stops: 0 });
    expect(seed.markdown).toBe('');
    expect(seed.storeFaults[0].point).toBe('before-acquire');
    expect(seed.afterClose.checkpoint).toMatchObject({ creationState: 'intent', fileDev: null, fileIno: null, confirmedOffset: 0 });
    const result = await child<ReopenReport>('reopen-recover', 'creation-ambiguous.json');
    preservedFailure(result, 'conflict');
    expect(result.sourceReads).toBe(0);
    expect(result.after.checkpoint?.creationState).toBe('intent');
  });

  it('refuses a pre-checkpoint transcript belonging to a migrated v1 registry conversation instead of inferring ownership from its filename', async () => {
    const seed = await child<MigrationReport>('migrate-v1', 'migration.json');
    expect(seed.transcriptMapped).toBe(false);
    const result = await child<ReopenReport>('reopen-legacy', 'legacy-conflict.json');
    expect(result.health).toMatchObject({ state: 'retrying', warning: true, reason: 'conflict' });
    expect(result.writes).toBe(0);
    for (const file of result.preserved) expect(file.afterHex).toBe(file.beforeHex);
    expect(result.after.checkpoint).toMatchObject({ creationState: 'intent', fileDev: null, fileIno: null, confirmedOffset: 0 });
    expect(Buffer.from(result.afterHex, 'hex').toString()).toBe(seed.legacy);
  });
});

describe('production Think SQLite transcript checkpoints', () => {
  it('preserves v6 attempt facts and exhausts the v7 preflight budget across SQLite reopenings', async () => {
    const result = await child<V6PreflightReport>('migrate-v6-preflight', 'v6-preflight.json');
    expect(result.beforeVersion).toBe(6); expect(result.afterVersion).toBe(10);
    expect(result.oldBefore).toMatchObject({ state: 'uncertain', createAttempted: true, dispatchAttempted: true,
      inputSha256: 'a'.repeat(64), requested: { agent: 'fixture-agent' }, effective: { agent: 'fixture-agent' } });
    expect(result.oldAfter).toEqual(result.oldBefore);
    expect(result.reservations.map(value => value.allowed)).toEqual([true, true, true, false]);
    expect(result.reservations.map(value => value.fact.attempts)).toEqual([1, 2, 3, 3]);
    const [first, second, third, exhausted] = result.reservations;
    expect(first.fact.retryAt).not.toBeNull(); expect(second.fact.retryAt).not.toBeNull();
    if (first.fact.retryAt === null || second.fact.retryAt === null) throw new Error('missing bounded retry times');
    expect(second.fact.retryAt - first.fact.retryAt).toBeGreaterThan(first.fact.retryAt - 1_700_000_000_000);
    expect(third.fact.retryAt).toBeNull(); expect(exhausted.fact).toEqual(third.fact);
  });

  it('migrates a v5 database through v10 without changing originals, checkpoints, selection or deletion tombstones', async () => {
    const result = await child<V5MigrationReport>('migrate-v5-generation', 'v5-generation.json');
    expect(result.beforeVersion).toBe(5);
    expect(result.afterVersion).toBe(10);
    expect(result.generationRows).toBe(0);
    expect(result.before.commands.some(command => command.original_type === 'blob' && command.original_hex !== null)).toBe(true);
    expect(result.before.transcript).toMatchObject({ creation_state: 'owned', pending_state: 'ready' });
    expect(result.before.chunks.length).toBeGreaterThan(0);
    expect(result.after).toEqual(result.before);
    expect(result.beforeOrder.length).toBeGreaterThan(0);
    expect(result.afterOrder).toEqual(result.beforeOrder);
    expect(result.beforeProtection).toEqual([
      [expect.objectContaining({ conversation_id: conversationId, selection_revision: 7, token_sha256: 'f'.repeat(64) })],
      [expect.objectContaining({ state: 'completed', native_removed: 1, transcript_removed: 1 })],
      [expect.objectContaining({ command_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', conversation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })],
      [expect.objectContaining({ conversation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })],
    ]);
    expect(result.afterProtection).toEqual(result.beforeProtection);
  });

  it('migrates test-owned v1 admission facts through v10 without replacing originals or adopting transcripts', async () => {
    const result = await child<MigrationReport>('migrate-v1', 'migration.json');
    const original = `  durable fixture original 🧠\r\n\`\`\`\n<!-- fixture literal -->\n${'x'.repeat(70 * 1024)}\nlast  `;
    expect(result).toMatchObject({ installationId: '44444444-4444-4444-8444-444444444444',
      originalHex: Buffer.from(original).toString('hex'), payloadSha256: sha(original), commandState: 'upstream-unconfirmed',
      conversationId, nativeSessionId: nativeId, legacy: 'pre-checkpoint transcript must not be adopted or changed', transcriptMapped: false });
    expect(result.schemaVersion, 'the additive migration chain must retain the existing private database').toBe(10);
  });

  it('preserves v2 insertion order and all old facts through v10 migration, a fresh Bun process, VACUUM and subsequent admission', async () => {
    const bId = '00000000-0000-4000-8000-000000000001';
    const stopId = '88888888-8888-4888-8888-888888888888';
    const formId = '66666666-6666-4666-8666-666666666666';
    const newId = '77777777-7777-4777-8777-777777777777';
    const expectedIds = ['22222222-2222-4222-8222-222222222222', commandId, stopId, bId, formId];
    const seed = await child<OrderMigrationReport>('migrate-v2-order', 'order-migration.json');
    expect(seed.versionBefore).toBe(2);
    expect(seed.orderTableBefore, 'a real historical v2 input must not already contain v3 order metadata').toBe(false);
    expect(seed.schemaVersion).toBe(10);
    expect(seed.insertionIds, 'observe old SQLite insertion order before the migration').toEqual(expectedIds);
    const a = seed.before.commands.find(command => command.command_id === commandId);
    const b = seed.before.commands.find(command => command.command_id === bId);
    expect(a).toMatchObject({ state: 'cancelled-before-delivery', dispatch_attempted: 0, original_type: 'blob' });
    expect(b).toMatchObject({ state: 'completed', dispatch_attempted: 1, original_type: 'blob' });
    if (!a || !b) throw new Error('fixture must retain both ordered originals');
    expect(a.registered_at).toBe(b.registered_at);
    expect(commandId > bId, 'UUID order deliberately contradicts insertion order').toBe(true);
    expect(a.original_hex).not.toBe(b.original_hex);
    for (const command of seed.before.commands.filter(command => command.original_type === 'blob')) {
      if (command.original_hex === null) throw new Error('fixture original BLOB missing');
      const bytes = Buffer.from(command.original_hex, 'hex');
      const payload = command.kind === 'form-reply' ? JSON.stringify({ conversationId, decisionId: command.decision_id,
        answer: JSON.parse(bytes.toString('utf8')) }) : bytes;
      expect(command.payload_sha256).toBe(sha(payload));
    }
    expect(seed.before.owner).toMatchObject({ conversation_id: conversationId, native_session_id: nativeId,
      vault_directory: join(root, 'vault'), creation_epoch: epoch, creation_state: 'ready' });
    expect(JSON.parse(seed.before.owner.owner_marker_json)).toEqual({ owner: 'memory-loop', conversationId, epoch,
      installationId: seed.before.installationId });
    expect(seed.before.commands.find(command => command.command_id === stopId)).toMatchObject({ state: 'cancelled-before-delivery', dispatch_attempted: 0 });
    expect(seed.before.commands.find(command => command.command_id === formId)).toMatchObject({ state: 'replied', dispatch_attempted: 1 });
    expect(seed.metadata, 'v4 backfills only retained source times and preserves the first original by real registration order').toEqual({
      purpose: 'think', lifecycle: 'live', rowVersion: 0, activityAt: a.registered_at + 10, title: 'durable fixture original 🧠',
    });
    const checkpoint = seed.before.transcript;
    const chunks = Buffer.concat(seed.before.chunks.map(chunk => Buffer.from(chunk.hex, 'hex')));
    expect(checkpoint).toMatchObject({ creation_state: 'owned', pending_entry_id: `user:${bId}`, pending_state: 'ready',
      pending_length: chunks.length, pending_sha256: sha(chunks) });
    expect(seed.before.entries.map(entry => entry.entry_id)).toEqual([`user:${commandId}`]);
    const file = Buffer.from(seed.before.fileHex, 'hex');
    expect(checkpoint.confirmed_sha256).toBe(sha(file.subarray(0, checkpoint.confirmed_offset)));
    expect(file.subarray(checkpoint.confirmed_offset)).toEqual(chunks.subarray(0, 7));
    expect(seed.after, 'migration must preserve every old command, receipt, BLOB, timestamp, ownership and pending/checkpoint field').toEqual(seed.before);
    expect(seed.registryIds).toEqual(expectedIds);
    expect(seed.order.map(row => row.commandId)).toEqual(expectedIds);
    expect(new Set(seed.order.map(row => row.sequence)).size).toBe(expectedIds.length);
    for (const [index, row] of seed.order.entries()) {
      expect(row.conversationId).toBe(conversationId);
      expect(Number.isSafeInteger(row.sequence)).toBe(true);
      expect(row.sequence).toBeGreaterThan(index ? seed.order[index - 1].sequence : 0);
    }

    const reopened = await child<OrderReopenReport>('reopen-v3-order', 'order-reopened.json');
    expect(reopened.pid).not.toBe(seed.pid);
    expect(reopened.schemaVersion).toBe(10);
    expect(reopened.vacuumIntegrity).toBe('ok');
    expect(reopened.before).toEqual(seed.after);
    expect(reopened.afterVacuum).toEqual(seed.after);
    expect(reopened.registryBefore).toEqual(expectedIds);
    expect(reopened.registryAfterVacuum).toEqual(expectedIds);
    expect(reopened.orderBefore).toEqual(seed.order);
    expect(reopened.orderAfterVacuum).toEqual(seed.order);
    expect(reopened.registryAfterNew).toEqual([...expectedIds, newId]);
    expect(reopened.registryAfterReopen).toEqual([...expectedIds, newId]);
    expect(reopened.orderAfterNew.slice(0, expectedIds.length)).toEqual(seed.order);
    expect(reopened.orderAfterNew.at(-1)).toMatchObject({ commandId: newId, conversationId });
    expect(reopened.orderAfterNew.at(-1)?.sequence).toBeGreaterThan(Math.max(...seed.order.map(row => row.sequence)));
    const { commands: afterCommands, ...afterFacts } = reopened.afterNew;
    const { commands: oldCommands, ...oldFacts } = seed.after;
    expect(afterFacts, 'new admission cannot consume old pending append/checkpoint work or rewrite its file').toEqual(oldFacts);
    expect(afterCommands.filter(command => command.command_id !== newId)).toEqual(oldCommands);
    expect(afterCommands.find(command => command.command_id === newId)).toMatchObject({ kind: 'send', state: 'registered',
      dispatch_attempted: 0, original_type: 'blob', original_hex: Buffer.from('new command after migration 🧠').toString('hex'),
      payload_sha256: sha('new command after migration 🧠'), registered_at: a.registered_at,
      registration_epoch: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' });
  });

  it('commits exclusive-creation intent and pending header before the filesystem create, then binds acquired file identity before writing', async () => {
    const { report } = await exercise('synced');
    const creating = observation(report, 'before-create');
    const writing = observation(report, 'before-first-write');
    expect(creating.fileHex).toBe('');
    expect(writing.fileHex).toBe('');
    const intent = checkpoint(creating.probe, 'before exclusive transcript creation');
    expect(intent).toMatchObject({ creationState: 'intent', fileDev: null, fileIno: null,
      confirmedOffset: 0, confirmedSha256: sha('') });
    const owned = checkpoint(writing.probe, 'after acquiring the exclusively created file and before its first byte');
    expect(owned).toMatchObject({ creationState: 'owned', fileDev: writing.fileDev, fileIno: writing.fileIno,
      confirmedOffset: 0, confirmedSha256: sha('') });
    expect(owned.fileFingerprint).toEqual(expect.any(String));
    expect(owned.pendingEntryId).toEqual(expect.any(String));
    const expectedHeader = `---\nmemory_loop_transcript: 1\nconversation_id: "${conversationId}"\ncreated_at: "2023-11-14T22:13:20.000Z"\n---\n\n# Think conversation\n\n`;
    for (const probe of [creating.probe, writing.probe]) {
      expect(probe.checkpoint?.pendingLength).toBe(Buffer.byteLength(expectedHeader));
      expect(probe.checkpoint?.pendingSha256).toBe(sha(expectedHeader));
      expect(Buffer.concat(probe.chunks.map(chunk => Buffer.from(chunk.hex, 'hex'))).toString('utf8')).toBe(expectedHeader);
    }
  });

  it('commits exact immutable original append framing and confirmed baseline before the first entry byte', async () => {
    const { report } = await exercise('synced');
    const writing = observation(report, 'before-original-write');
    const baseline = Buffer.from(writing.fileHex, 'hex');
    const syncing = (['after-original-file-sync', 'after-directory-sync'] as const).map(at => observation(report, at));
    for (const item of syncing) expect(Buffer.from(item.fileHex, 'hex')).toEqual(Buffer.concat([baseline, Buffer.from(report.expectedOriginal)]));
    pending(writing.probe, report.expectedOriginal);
    const state = checkpoint(writing.probe, 'before original append');
    expect(state).toMatchObject({ confirmedOffset: baseline.length, confirmedSha256: sha(baseline),
      fileDev: writing.fileDev, fileIno: writing.fileIno, creationState: 'owned' });
    for (const duringSync of syncing) {
      pending(duringSync.probe, report.expectedOriginal);
      expect(checkpoint(duringSync.probe, duringSync.at).confirmedOffset).toBe(baseline.length);
    }
  });

  it('durably confirms the full prefix and stable entry IDs only after all syncs, releasing pending bytes before a fresh process reads them', async () => {
    const { report, fresh } = await exercise('synced');
    expect(report.health).toMatchObject({ state: 'up-to-date', warning: false });
    expect(report.markdown).toContain(report.expectedOriginal);
    expect(report.markdown).toContain('canonical fixture answer Ω');
    const state = checkpoint(fresh, 'after writer shutdown and fresh-process reopen');
    expect(state).toMatchObject({ creationState: 'owned', confirmedOffset: Buffer.byteLength(report.markdown),
      confirmedSha256: sha(report.markdown), pendingEntryId: null, pendingLength: null, pendingSha256: null });
    expect(fresh.chunks).toEqual([]);
    const serializedIds = [...report.markdown.matchAll(/^<!-- memory-loop-entry (.+) -->$/gm)].map(match => {
      const metadata: { entry_id: string } = JSON.parse(match[1]); return metadata.entry_id;
    });
    expect(new Set(serializedIds).size).toBe(serializedIds.length);
    expect(fresh.entries).toEqual([...serializedIds].sort());
    expect(fresh.entries).toContain(entryId);
  });

  it.each(['partial', 'synced-unconfirmed'] as const)('retains the previous checkpoint and exact pending original through %s failure and fresh-process readback without gating native work', async scenario => {
    const { report, fresh } = await exercise(scenario);
    expect(report.health).toMatchObject({ state: 'retrying', reason: 'io_unavailable' });
    const writing = observation(report, 'before-original-write');
    const baseline = Buffer.from(writing.fileHex, 'hex');
    const actual = Buffer.from(report.markdown);
    expect(actual.subarray(0, baseline.length)).toEqual(baseline);
    const expectedTail = Buffer.from(report.expectedOriginal);
    expect(actual.subarray(baseline.length)).toEqual(scenario === 'partial' ? expectedTail.subarray(0, 7) : expectedTail);
    pending(fresh, report.expectedOriginal);
    expect(checkpoint(fresh, 'after failed append/close').confirmedOffset).toBe(baseline.length);
    expect(fresh.checkpoint?.confirmedSha256).toBe(sha(baseline));
    if (scenario === 'synced-unconfirmed') {
      pending(observation(report, 'after-original-file-sync').probe, report.expectedOriginal);
      pending(observation(report, 'after-directory-sync').probe, report.expectedOriginal);
    }
  });
});
