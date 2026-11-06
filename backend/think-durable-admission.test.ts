import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandFact, FixtureReport, HydrationCoverage, Probe, Scenario } from '../tests/think-durable-admission-fixture';

// No runtime import of the Bun fixture (or a future persistence module) in Node Vitest.
const runner = resolve(import.meta.dirname, '../tests/think-durable-admission-fixture.ts');
const conversationId = '11111111-1111-4111-8111-111111111111';
const createCommandId = '22222222-2222-4222-8222-222222222222';
const sendCommandId = '33333333-3333-4333-8333-333333333333';
const formCommandId = '44444444-4444-4444-8444-444444444444';
const original = '  test-owned original 🧠\r\n```\n<!-- not metadata -->\nlast line  ';
const canonicalAnswer = JSON.stringify({ answer: '  original form 🧠\r\nlast line  ', zeta: 'second field' });
const nativeId = `ses_memoryloop_${conversationId.replaceAll('-', '')}`;
const messageId = `msg_memoryloop_${sendCommandId.replaceAll('-', '')}`;
const decisionId = 'form_fixture_durable_original';
const assistantMessageId = 'msg_fixture_restart_answer';
const assistantTexts = ['Verified fixture answer 🧠\n```literal\nfirst body', 'Second text part after hidden reasoning.'];
const orderedSecondCommandId = '99999999-9999-4999-8999-999999999999';
const orderedSecondOriginal = '  later original B 🧠\r\nnot prepared native input  ';
const orderedPreparedB = 'prepared-B: fixture expansion is not either original';
const orderedStopCommandId = '88888888-8888-4888-8888-888888888888';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
let root: string;

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'think-durable-admission-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function fileSymlinksPermitted(): Promise<boolean> {
  if (process.platform !== 'win32') return true;
  const target = join(root, 'symlink-probe-target');
  await writeFile(target, '');
  try { await symlink(target, join(root, 'symlink-probe')); return true; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') return false;
    throw error;
  } finally { await rm(join(root, 'symlink-probe'), { force: true }); await rm(target, { force: true }); }
}

async function statePolicy(scenario: 'state-permissive' | 'state-normalized' | 'state-windows-slashes') {
  const output = join(root, 'state-policy-report.json');
  const child = spawnSync('bun', ['--no-env-file', runner, root, scenario, output], {
    cwd: root, timeout: 15000, maxBuffer: 512 * 1024, encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: root,
      XDG_DATA_HOME: root, XDG_CACHE_HOME: root, XDG_STATE_HOME: root, TMPDIR: root, TEMP: root, TMP: root },
  });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, `owned state fixture setup failed:\n${child.stdout}\n${child.stderr}`).toBe(0);
  return JSON.parse(await readFile(output, 'utf8')) as { before: string; after?: string; stored: string; integrity: string; schema: number; reopenError?: string };
}

it.skipIf(process.platform === 'win32')('reopens actual SQLite facts with accessible non-owner-only modes', async () => {
  const report = await statePolicy('state-permissive');
  expect(report.reopenError).toBeUndefined();
  expect(report.before).toEqual(expect.any(String));
  expect(report.after).toBe(report.before);
  expect(report.stored).toBe(report.before);
  expect(report.integrity).toBe('ok');
  expect(report.schema).toBe(11);
});

it('reopens the same SQLite facts from a native noncanonical absolute project path', async () => {
  const report = await statePolicy('state-normalized');
  expect(report.reopenError).toBeUndefined();
  expect(report.before).toEqual(expect.any(String));
  expect(report.after).toBe(report.before);
  expect(report.stored).toBe(report.before);
  expect(report.integrity).toBe('ok');
  expect(report.schema).toBe(11);
});

it.skipIf(process.platform !== 'win32')('reopens native Windows state using forward-slash absolute spelling', async () => {
  const report = await statePolicy('state-windows-slashes');
  expect(report.reopenError).toBeUndefined();
  expect(report.after).toBe(report.before);
  expect(report.stored).toBe(report.before);
  expect(report.integrity).toBe('ok');
  expect(report.schema).toBe(11);
});

async function exercise(scenario: Scenario): Promise<FixtureReport> {
  const output = join(root, 'report.json');
  const child = spawnSync('bun', ['--no-env-file', runner, root, scenario, output], {
    cwd: root, timeout: 15000, maxBuffer: 512 * 1024, encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: root, XDG_CONFIG_HOME: root,
      XDG_DATA_HOME: root, XDG_CACHE_HOME: root, XDG_STATE_HOME: root, TMPDIR: root, TEMP: root, TMP: root },
  });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, `fixture must execute the existing production API before durability assertions:\n${child.stdout}\n${child.stderr}`).toBe(0);
  // This JSON is produced by our typed test program, not a production response/schema.
  const report = JSON.parse(await readFile(output, 'utf8')) as FixtureReport;
  expect(report.scenario).toBe(scenario);
  verifyProbeControls(report.probeControl);
  expect(report.unexpected, 'the fake native protocol must not be the source of RED').toEqual([]);
  expect(report.configUnchanged).toBe(true);
  expect(report.legacyUnchanged).toBe(true);
  expect(report.outsideUnchanged).toBe(true);
  expect(report.groundStatus).toBe(200);
  expect(report.groundValue).toMatchObject({ state: 'ready', data: { markdown: 'Fixture goal' } });
  return report;
}

function durable(probe: Probe | undefined, at: string): Probe {
  expect(probe, `fixture must observe ${at}`).toBeDefined();
  if (!probe) throw new Error(`Missing fixture observation at ${at}`);
  expect(probe.exists, `application.sqlite must contain committed application facts ${at}`).toBe(true);
  expect(probe.error, 'the independent SQLite reader must open successfully').toBeUndefined();
  expect(probe.integrity).toBe('ok');
  // v2 checkpoints, v3 order, v4 views, v5 deletion, v6 generation, v7 preflight,
  // v8 publication, v9 quote budgets, v10 freshness-period links, v11 exact file identities.
  // Probe controls read unmigrated v1 snapshots too, so enumerate supported versions explicitly.
  expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).toContain(probe.schemaVersion);
  expect(probe.writerAvailable, 'a SQLite write transaction must not span an external native call').toBe(true);
  return probe;
}

type Ownership = Pick<CommandFact, 'conversationId' | 'nativeSessionId' | 'vaultDirectory' | 'creationEpoch'> & { ownerMarker: unknown };
interface ExpectedCommand extends Ownership {
  commandId: string;
  kind: 'create' | 'send' | 'form-reply' | 'stop';
  originalInput: string | null;
  payloadSha256: string | null;
  runId: string | null;
  nativeMessageId: string | null;
  decisionId: string | null;
  state?: string;
  dispatchAttempted?: 0 | 1;
}

/** Every expected field belongs to this exact command and its joined ownership row. */
function boundCommand(probe: Probe, expected: ExpectedCommand): CommandFact {
  expect(probe.command, `committed command ${expected.commandId} must join its owned conversation`).not.toBeNull();
  if (!probe.command) throw new Error('missing joined command');
  const fact = probe.command;
  expect(fact).toMatchObject({ commandId: expected.commandId, conversationId: expected.conversationId,
    ownerConversationId: expected.conversationId, kind: expected.kind,
    nativeSessionId: expected.nativeSessionId, vaultDirectory: expected.vaultDirectory,
    creationEpoch: expected.creationEpoch, payloadSha256: expected.payloadSha256,
    runId: expected.runId, nativeMessageId: expected.nativeMessageId, decisionId: expected.decisionId,
    ...(expected.state === undefined ? {} : { state: expected.state }),
    ...(expected.dispatchAttempted === undefined ? {} : { dispatchAttempted: expected.dispatchAttempted }) });
  expect(fact.originalType).toBe(expected.originalInput === null ? 'null' : 'blob');
  expect(fact.originalHex).toBe(expected.originalInput === null ? null : Buffer.from(expected.originalInput).toString('hex'));
  expect(JSON.parse(fact.ownerMarkerJson)).toEqual(expected.ownerMarker);
  expect(Number.isSafeInteger(fact.registeredAt) && fact.registeredAt >= 0).toBe(true);
  expect([0, 1]).toContain(fact.dispatchAttempted);
  return fact;
}

function owned(report: FixtureReport): Ownership {
  const create = report.observations.find(item => item.operation === 'create');
  const input = create?.input as { metadata: { memoryLoop: { epoch: string } } };
  expect(input.metadata.memoryLoop).toMatchObject({ owner: 'memory-loop', conversationId });
  expect(typeof input.metadata.memoryLoop.epoch).toBe('string');
  return { conversationId, nativeSessionId: nativeId, vaultDirectory: report.vault,
    creationEpoch: input.metadata.memoryLoop.epoch, ownerMarker: input.metadata.memoryLoop };
}

function sendExpected(report: FixtureReport): ExpectedCommand {
  const receipt = report.commandReceipt as { runId: string };
  return { ...owned(report), commandId: sendCommandId, kind: 'send', originalInput: original,
    payloadSha256: digest(original), runId: receipt.runId, nativeMessageId: messageId, decisionId: null };
}

function restored(report: FixtureReport): HydrationCoverage {
  const value = report.hydration;
  expect(value, 'the owned Bun fixture must have crossed close/reprepare before assertions').toBeDefined();
  if (!value) throw new Error('missing hydration observation');
  expect(value.before.status).toBe(200);
  expect(value.markdownAfter, 'restart must preserve confirmed bytes, including when admission/history is uncertain').toBe(value.markdownBefore);
  expect(value.checkpointAfter).toEqual(value.checkpointBefore);
  expect(value.beforeFact.command?.originalHex).toBe(Buffer.from(original).toString('hex'));
  expect(value.afterFact.command?.originalHex).toBe(value.beforeFact.command?.originalHex);
  expect(value.afterFact.command?.runId).toBe(value.beforeFact.command?.runId);
  expect(value.afterFact.rejectedCommandPresent, 'blocked second Send cannot register a new command').toBe(false);
  return value;
}

function recoveredOriginal(value: HydrationCoverage): void {
  expect(value.after.status).toBe(200);
  expect(value.repeated.status).toBe(200);
  expect(value.after.snapshot?.epoch).not.toBe(value.before.snapshot?.epoch);
  expect(value.after.snapshot).toMatchObject({ creation: 'ready', sendEligibility: 'busy' });
  expect(value.secondSendStatus).toBe(409);
  expect(value.after.bodies.map(item => item.text)).toEqual([original]);
  expect(value.repeated.bodies.map(item => item.text)).toEqual([original]);
  expect(value.after.snapshot?.entries.filter(entry => entry.kind === 'original')).toHaveLength(1);
  expect(value.after.snapshot?.entries.filter(entry => entry.kind === 'lifecycle' && entry.commandKind === 'stop')).toEqual([]);
  for (const body of value.after.bodies) expect(body.ref).toMatchObject({ epoch: value.after.snapshot?.epoch,
    kind: 'canonical', sha256: digest(original), through: Buffer.byteLength(original) });
}

function verifyProbeControls(control: FixtureReport['probeControl']): void {
  const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const expected: ExpectedCommand = { commandId: sendCommandId, conversationId, kind: 'send', originalInput: original,
    payloadSha256: digest(original), runId: '99999999-9999-4999-8999-999999999999', nativeMessageId: messageId,
    decisionId: null, nativeSessionId: nativeId, vaultDirectory: join(root, 'probe-vault'), creationEpoch: epoch,
    ownerMarker: { owner: 'memory-loop', conversationId, epoch }, state: 'registered', dispatchAttempted: 1 };
  boundCommand(durable(control.committed, 'in the committed relational probe control'), expected);
  expect(control.uncommitted.command, 'uncommitted command must be invisible to another connection').toBeNull();
  expect(control.uncommitted.integrity).toBe('ok');
  expect(control.uncommitted.writerAvailable, 'probe must detect a transaction held by another connection').toBe(false);
  expect(control.uncommitted.error).toBeDefined();
  for (const key of ['wrongOriginalCommand', 'wrongDigestCommand', 'wrongConversation', 'wrongNativeMapping'] as const) {
    // Infrastructure must be healthy: only the binding/value mismatch should reject this control.
    const probe = durable(control[key], `in negative relational control ${key}`);
    expect(probe.command?.commandId).toBe(sendCommandId);
    if (key !== 'wrongOriginalCommand') expect(probe.command?.originalHex).toBe(Buffer.from(original).toString('hex'));
    expect(() => boundCommand(probe, expected), `${key} must not pass using another record's facts`).toThrow();
  }
}

describe('production Think durable admission through prepareServer and the official client', () => {
  it('commits new ownership and create-command identity before native creation, independently of transport metadata', async () => {
    const report = await exercise('create');
    expect(report.createStatus).toBe(202);
    expect(report.ready).toBe(true);
    expect(report.counts).toEqual({ creates: 1, prompts: 0, replies: 0 });
    expect(report.duplicateStatus).toBe(202);
    expect(report.changedStatus).toBe(409);
    const create = report.observations.find(item => item.operation === 'create');
    expect(create?.input).toMatchObject({ id: nativeId, location: { directory: report.vault },
      permissions: [{ action: '*', resource: '*', effect: 'allow' }] });
    const expected: ExpectedCommand = { ...owned(report), commandId: createCommandId, kind: 'create', originalInput: null,
      payloadSha256: null, runId: null, nativeMessageId: null, decisionId: null };
    boundCommand(durable(create?.probe, 'before native create'), { ...expected, state: 'registered', dispatchAttempted: 1 });
    expect(report.createReceipt).toMatchObject({ kind: 'create', conversationId, clientCommandId: createCommandId });
    boundCommand(durable(report.acknowledged, 'before returning create acknowledgement'), expected);
    expect(report.database).toBe(join(root, 'project', '.memory-loop', 'application.sqlite'));
    const afterClose = durable(report.afterClose, 'after normal service close');
    boundCommand(afterClose, { ...expected, state: 'ready', dispatchAttempted: 1 });
    expect(afterClose.legacyConversationPresent).toBe(false);
  });

  it('commits exact original Send bytes, immutable identity and digest before the native prompt', async () => {
    const report = await exercise('send');
    expect(report.createStatus).toBe(202);
    expect(report.ready).toBe(true);
    expect(report.commandStatus).toBe(202);
    expect(report.commandReceipt).toMatchObject({ kind: 'send', clientCommandId: sendCommandId, state: 'admitted' });
    expect(report.duplicateStatus).toBe(202);
    expect(report.changedStatus).toBe(409);
    expect(report.oversizedStatus).toBe(400);
    expect(report.counts).toEqual({ creates: 1, prompts: 1, replies: 0 });
    const prompt = report.observations.find(item => item.operation === 'prompt');
    expect(prompt?.input).toMatchObject({ id: messageId, text: original, sessionID: nativeId });
    const expected = sendExpected(report);
    boundCommand(durable(prompt?.probe, 'before native prompt'), { ...expected, state: 'registered', dispatchAttempted: 1 });
    boundCommand(durable(report.acknowledged, 'before returning Send acknowledgement'), expected);
    const afterClose = durable(report.afterClose, 'after ephemeral body-store cleanup');
    boundCommand(afterClose, { ...expected, state: 'admitted', dispatchAttempted: 1 });
    expect(afterClose.rejectedCommandPresent, 'rejected oversized input is not a registered command').toBe(false);
  });

  it('GROUND-DURABLE-01 retains historical readiness but cannot restore a target whose native owner changed', async () => {
    const report = await exercise('create-ready-restart');
    expect(report.createStatus).toBe(202);
    expect(report.ready).toBe(true);
    expect(report.counts).toEqual({ creates: 1, prompts: 0, replies: 0 });
    const expected: ExpectedCommand = { ...owned(report), commandId: createCommandId, kind: 'create', originalInput: null,
      payloadSha256: null, runId: null, nativeMessageId: null, decisionId: null, state: 'ready', dispatchAttempted: 1 };
    boundCommand(durable(report.afterClose, 'before the restart'), expected);
    boundCommand(durable(report.after, 'after the restart'), expected);
    expect([404, 503]).toContain(report.restart?.snapshotStatus);
    expect(report.restart?.snapshot).toMatchObject({ error: { code: report.restart?.snapshotStatus === 404 ? 'not_found' : 'think_unavailable' } });
    // The fix may keep historical ready facts readable or guard their serving status.
    // It must not erase/change the immutable DB fact or replay native creation to hide this gap.
    if (report.restart?.commandStatus === 200) {
      expect(report.restart.commandReceipt).toMatchObject({ conversationId, clientCommandId: createCommandId, kind: 'create', epoch: expect.any(String) });
      const receipt = report.restart.commandReceipt as { epoch: string };
      expect(receipt.epoch).not.toBe(expected.creationEpoch);
    } else expect([409, 503]).toContain(report.restart?.commandStatus);
  });

  it('restores the same registered completed chat after daemon restart with original inputs, verified AI bodies and no replay or duplicate transcript', async () => {
    const report = await exercise('history-restart');
    expect(report.createStatus).toBe(202);
    expect(report.ready).toBe(true);
    expect(report.commandStatus).toBe(202);
    expect(report.commandReceipt).toMatchObject({ kind: 'send', conversationId, clientCommandId: sendCommandId, state: 'completed' });
    expect(report.counts, 'fresh preparation and snapshot reads must never recreate, resend or repeat form replies').toEqual({ creates: 1, prompts: 1, replies: 1 });
    const history = report.historyRestart;
    expect(history, 'the existing API must complete the first lifetime and execute the restart before RED').toBeDefined();
    if (!history) throw new Error('missing restart observation');
    const send = sendExpected(report);
    const form: ExpectedCommand = { ...owned(report), commandId: formCommandId, kind: 'form-reply', originalInput: canonicalAnswer,
      payloadSha256: digest(JSON.stringify({ conversationId, decisionId, answer: JSON.parse(canonicalAnswer) })),
      runId: null, nativeMessageId: null, decisionId, state: 'replied', dispatchAttempted: 1 };
    boundCommand(durable(history.sendBefore, 'after the first lifetime completed'), { ...send, state: 'completed', dispatchAttempted: 1 });
    boundCommand(durable(history.formBefore, 'after the first lifetime form reply'), form);
    boundCommand(durable(history.sendAfter, 'after reopening the same private database'), { ...send, state: 'completed', dispatchAttempted: 1 });
    boundCommand(durable(history.formAfter, 'after reopening the same form-original BLOB'), form);
    expect(history.before.status).toBe(200);
    expect(history.before.snapshot).toMatchObject({ conversationId, creation: 'ready', sendEligibility: 'available', transcript: { state: 'up-to-date' } });
    // Native history deliberately retains only prepared user text; the exact original must come from its joined command BLOB.
    expect(history.nativeHistory.filter(item => item.type === 'user')).toEqual([
      expect.objectContaining({ id: messageId, text: 'fixture plugin-prepared text is not the original user submission' }),
    ]);
    expect(history.before.bodies.map(item => item.text)).toEqual([original, ...assistantTexts, canonicalAnswer]);
    expect(history.checkpointBefore).toMatchObject({ offset: Buffer.byteLength(history.markdownBefore),
      sha256: digest(history.markdownBefore), pendingEntryId: null });
    expect(history.markdownBefore).toContain(original);
    expect(history.markdownBefore).toContain(canonicalAnswer);
    for (const text of assistantTexts) expect(history.markdownBefore).toContain(text);
    expect(history.markdownBefore).not.toMatch(/plugin-prepared|fixture-private-reasoning/);

    // The intended initial RED is this real production GET returning 404, not a missing module or fixture setup.
    expect(history.after.status, 'the SAME registered conversation URL must now hydrate instead of returning not_found').toBe(200);
    expect(history.repeatedStatus).toBe(200);
    expect(history.after.snapshot).not.toBeNull();
    if (!history.after.snapshot || !history.before.snapshot) throw new Error('missing ready snapshot');
    const before = history.before.snapshot;
    const after = history.after.snapshot;
    expect(after).toMatchObject({ conversationId, creation: 'ready', sendEligibility: 'available', contentHealth: 'complete',
      transcript: { state: 'up-to-date', warning: false } });
    expect(after.epoch).not.toBe(before.epoch);
    expect(history.sendReceipt).toMatchObject({ kind: 'send', clientCommandId: sendCommandId, conversationId,
      runId: send.runId, epoch: after.epoch, state: 'completed' });
    expect(history.formReceipt).toMatchObject({ kind: 'form-reply', clientCommandId: formCommandId, conversationId,
      decisionId, epoch: after.epoch, state: 'replied' });
    const originalEntry = after.entries.find(entry => entry.kind === 'original');
    const answerEntries = after.entries.filter(entry => entry.kind === 'assistant-text');
    const formEntry = after.entries.find(entry => entry.kind === 'form-reply');
    expect(after.entries.filter(entry => entry.kind === 'original')).toHaveLength(1);
    expect(after.entries.filter(entry => entry.kind === 'form-reply')).toHaveLength(1);
    expect(originalEntry).toMatchObject({ clientCommandId: sendCommandId, messageId, runId: send.runId,
      body: { key: { conversationId, owner: { kind: 'original', clientCommandId: sendCommandId, messageId } } } });
    expect(formEntry).toMatchObject({ clientCommandId: formCommandId, decisionId,
      body: { key: { conversationId, owner: { kind: 'form-reply', clientCommandId: formCommandId, decisionId } } } });
    expect(answerEntries.map(entry => [entry.messageId, entry.ordinal, entry.closure, entry.capture])).toEqual([
      [assistantMessageId, 0, 'closed', 'complete'], [assistantMessageId, 1, 'closed', 'complete'],
    ]);
    const orderedInputAndAnswers = after.entries.filter(entry => ['original', 'assistant-text', 'form-reply'].includes(entry.kind));
    expect(orderedInputAndAnswers.map(entry => entry.kind)).toEqual(['original', 'assistant-text', 'assistant-text', 'form-reply']);
    expect(orderedInputAndAnswers.map(entry => entry.displayOrder)).toEqual(
      orderedInputAndAnswers.map(entry => entry.displayOrder).sort((a, b) => a - b));
    expect(after.entries.filter(entry => entry.kind === 'compaction' || entry.kind === 'lifecycle' && entry.commandKind === 'stop')).toEqual([]);
    expect(JSON.stringify(after)).not.toMatch(/plugin-prepared|fixture-private-reasoning/);
    expect(history.after.bodies.map(item => item.text)).toEqual([original, ...assistantTexts, canonicalAnswer]);
    for (const body of history.after.bodies) {
      expect(body.ref).toMatchObject({ epoch: after.epoch, kind: 'canonical', through: Buffer.byteLength(body.text), sha256: digest(body.text) });
      expect(body.epoch).toBe(after.epoch);
      const old = history.before.bodies.find(item => item.text === body.text);
      expect(old?.ref.kind === 'canonical' ? old.ref.sha256 : null).toBe(digest(body.text));
    }
    expect(history.markdownAfter, 'hydration observations must reopen the mapped checkpoint without appending old entries again').toBe(history.markdownBefore);
    expect(history.checkpointAfter).toEqual(history.checkpointBefore);
    expect(history.partial?.history.snapshot).toMatchObject({ creation: 'ready', sendEligibility: 'available', contentHealth: 'incomplete',
      transcript: { warning: true, reason: 'content_gap' } });
    expect(history.partial?.history.snapshot?.epoch).not.toBe(after.epoch);
    expect(history.partial?.history.bodies.map(item => item.text)).toEqual([original, assistantTexts[0], canonicalAnswer]);
    expect(history.partial?.history.snapshot?.entries.filter(entry => entry.kind === 'assistant-text').map(entry => entry.kind === 'assistant-text' ? entry.ordinal : -1)).toEqual([0]);
    expect(history.partial?.markdown, 'missing native canonical bytes cannot be invented from Markdown or duplicate confirmed entries').toBe(history.markdownBefore);
    expect(history.partial?.checkpoint).toEqual(history.checkpointBefore);
  });

  it('restores actual native running activity and the admitted run without replay, implicit Stop or a second Send', async () => {
    const report = await exercise('hydrate-busy');
    const value = restored(report);
    recoveredOriginal(value);
    expect(value.activeAtRestart).toEqual({ [nativeId]: { type: 'running' } });
    expect(value.sessionAtRestart.time.busy).toEqual(expect.any(Number));
    expect(value.sessionAtRestart.time.idle).toBeUndefined();
    expect(value.receipt).toMatchObject({ kind: 'send', clientCommandId: sendCommandId, state: 'admitted',
      runId: value.beforeFact.command?.runId, epoch: value.after.snapshot?.epoch });
    expect(value.after.snapshot?.entries).toContainEqual(expect.objectContaining({ kind: 'lifecycle', commandKind: 'send', state: 'admitted' }));
    expect(value.afterFact.command).toMatchObject({ dispatchAttempted: 1, nativeMessageId: messageId, state: 'admitted' });
    expect(report.counts).toEqual({ creates: 1, prompts: 1, replies: 0 });
  });

  it('retains lost-ack uncertainty with no native match, then reconciles only the exact persisted prompt ID without replay', async () => {
    const report = await exercise('hydrate-uncertain');
    const value = restored(report);
    recoveredOriginal(value);
    expect(value.activeAtRestart).toEqual({});
    expect(value.sessionAtRestart.time.busy).toBeUndefined();
    expect(value.beforeFact.command).toMatchObject({ state: 'upstream-unconfirmed', dispatchAttempted: 1, nativeMessageId: messageId });
    expect(value.receipt).toMatchObject({ state: 'upstream-unconfirmed', runId: value.beforeFact.command?.runId });
    expect(value.afterFact.command?.state).toBe('upstream-unconfirmed');
    expect(value.resolved?.receipt).toMatchObject({ state: 'completed', runId: value.beforeFact.command?.runId });
    expect(value.resolved?.history.snapshot).toMatchObject({ sendEligibility: 'available', contentHealth: 'complete' });
    expect(value.resolved?.history.snapshot?.entries).toContainEqual(expect.objectContaining({ kind: 'original', messageId }));
    expect(value.resolved?.history.bodies.map(item => item.text)).toEqual([original, ...assistantTexts]);
    expect(value.resolved?.markdown.startsWith(value.markdownBefore)).toBe(true);
    expect(value.resolved?.markdown.match(/"entry_id":"user:/g)).toHaveLength(2); // One start + one end framing, not two entries.
    boundCommand(durable(report.afterClose, 'after exact native reconciliation and final close'), {
      ...sendExpected(report), state: 'completed', dispatchAttempted: 1,
    });
    expect(report.counts).toEqual({ creates: 1, prompts: 1, replies: 0 });
  });

  it('GROUND-HYDRATE-01 promotes later exact-ID running evidence to admitted and permits explicit Stop without replay', async () => {
    const report = await exercise('hydrate-uncertain-running-stop');
    const value = restored(report);
    recoveredOriginal(value);
    expect(value.receipt).toMatchObject({ state: 'upstream-unconfirmed', runId: value.beforeFact.command?.runId });
    expect(value.afterFact.command).toMatchObject({ state: 'upstream-unconfirmed', dispatchAttempted: 1, nativeMessageId: messageId });
    const later = value.lateAdmission;
    expect(later, 'the fixture must observe new native history AFTER the initial uncertain restoration').toBeDefined();
    if (!later) throw new Error('missing later admission observation');
    expect(later.evidenceId).toBe(value.beforeFact.command?.nativeMessageId);
    expect(later.activity).toEqual({ [nativeId]: { type: 'running' } });
    expect(later.history.snapshot).toMatchObject({ epoch: value.after.snapshot?.epoch, sendEligibility: 'busy', creation: 'ready' });
    expect(later.history.snapshot?.entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId: 'msg_fixture_late_admission_refresh' }));
    expect(later.interruptsBeforeStop).toBe(0);
    expect(report.counts).toEqual({ creates: 1, prompts: 1, replies: 0 });
    // Initial RED: refresh has fenced/published the exact-ID evidence, but the receipt is still upstream-unconfirmed.
    expect(later.receipt).toMatchObject({ kind: 'send', clientCommandId: sendCommandId, conversationId,
      epoch: value.after.snapshot?.epoch, runId: value.beforeFact.command?.runId, state: 'admitted' });
    boundCommand(durable(later.fact, 'after later exact-ID admission and before explicit Stop'), {
      ...sendExpected(report), state: 'admitted', dispatchAttempted: 1,
    });
    expect(later.stopStatus).toBe(202);
    expect(later.stopReceipt).toMatchObject({ kind: 'stop', conversationId, clientCommandId: '88888888-8888-4888-8888-888888888888',
      runId: value.beforeFact.command?.runId, epoch: value.after.snapshot?.epoch, state: 'requested' });
    expect(later.interrupts).toEqual([{ sessionID: nativeId, resume: 'false' }]);
    expect(later.markdown.startsWith(value.markdownBefore)).toBe(true);
    expect(later.markdown.match(/"entry_id":"user:/g)).toHaveLength(2); // One entry's start/end framing.
    expect(later.markdown.match(/"entry_id":"ai:msg_fixture_late_admission_refresh:0:/g)).toHaveLength(2);
    expect(later.history.bodies.filter(item => item.ref.key.owner.kind === 'original').map(item => item.text)).toEqual([original]);
  });

  it.each([
    { scenario: 'cancelled-input-order', secondId: orderedSecondCommandId, timing: 'distinct registration times' },
    { scenario: 'cancelled-input-order-tie', secondId: '00000000-0000-4000-8000-000000000001', timing: 'equal registration times with lexical B before A' },
  ] as const)('GROUND-HYDRATE-02 preserves cancelled A before delivered B and its answer: $timing', async ({ scenario, secondId }) => {
    const report = await exercise(scenario);
    const order = report.cancelledOrder;
    expect(order, 'the fixture must cancel A locally, finish capturing it, complete B and reprepare the real server').toBeDefined();
    if (!order) throw new Error('missing ordered restart observations');
    expect(report.counts).toEqual({ creates: 1, prompts: 1, replies: 0 });
    expect(order.before.status).toBe(200);
    expect(order.after.status).toBe(200);
    expect(order.after.snapshot).toMatchObject({ conversationId, creation: 'ready', sendEligibility: 'available', contentHealth: 'complete' });
    expect(order.after.snapshot?.epoch).not.toBe(order.before.snapshot?.epoch);
    const first = order.firstReceipt as { runId: string };
    const second = order.secondReceipt as { runId: string };
    const firstExpected: ExpectedCommand = { ...sendExpected(report), state: 'cancelled-before-delivery', dispatchAttempted: 0 };
    const secondMessageId = `msg_memoryloop_${secondId.replaceAll('-', '')}`;
    const secondExpected: ExpectedCommand = { ...owned(report), commandId: secondId, kind: 'send', originalInput: orderedSecondOriginal,
      payloadSha256: digest(orderedSecondOriginal), runId: second.runId, nativeMessageId: secondMessageId, decisionId: null,
      state: 'completed', dispatchAttempted: 1 };
    const stopExpected: ExpectedCommand = { ...owned(report), commandId: orderedStopCommandId, kind: 'stop', originalInput: null,
      payloadSha256: null, runId: first.runId, nativeMessageId: null, decisionId: null, state: 'cancelled-before-delivery', dispatchAttempted: 0 };
    for (const probe of [order.firstFact, order.firstFactAfter]) boundCommand(durable(probe, 'for cancelled undelivered A'), firstExpected);
    for (const probe of [order.secondFact, order.secondFactAfter]) boundCommand(durable(probe, 'for completed B'), secondExpected);
    for (const probe of [order.stopFact, order.stopFactAfter]) boundCommand(durable(probe, 'for the observed local Stop'), stopExpected);
    boundCommand(durable(order.beforeSecondFirstFact, 'after capturing A but BEFORE admitting B'), firstExpected);
    expect(durable(order.beforeSecondSecondFact, 'before B is admitted').command).toBeNull();
    if (scenario === 'cancelled-input-order-tie') {
      expect(order.firstFact.command?.registeredAt, 'actual committed timestamps must tie without any post-admission rewrite').toBe(order.secondFact.command?.registeredAt);
      expect(sendCommandId > secondId, 'UUID order deliberately contradicts the observed A-then-B registration order').toBe(true);
    } else expect(order.firstFact.command?.registeredAt).toBeLessThan(order.secondFact.command?.registeredAt ?? 0);
    expect(order.firstAfter).toMatchObject({ kind: 'send', clientCommandId: sendCommandId, runId: first.runId,
      epoch: order.after.snapshot?.epoch, state: 'cancelled-before-delivery' });
    expect(order.stopAfter).toMatchObject({ kind: 'stop', clientCommandId: orderedStopCommandId, runId: first.runId,
      epoch: order.after.snapshot?.epoch, state: 'cancelled-before-delivery' });
    expect(order.secondAfter).toMatchObject({ kind: 'send', clientCommandId: secondId, runId: second.runId,
      epoch: order.after.snapshot?.epoch, state: 'completed' });
    expect(order.nativeHistory.filter(message => message.type === 'user')).toEqual([
      expect.objectContaining({ id: secondMessageId, text: orderedPreparedB }),
    ]);
    const prompt = report.observations.find(item => item.operation === 'prompt');
    expect(prompt?.input).toMatchObject({ id: secondMessageId, text: orderedSecondOriginal });
    boundCommand(durable(prompt?.probe, 'before native B prompt'), { ...secondExpected, state: 'registered' });
    expect(order.before.bodies.map(body => body.text)).toEqual([original, orderedSecondOriginal, ...assistantTexts]);
    for (const [id, text] of [[sendCommandId, original], [secondId, orderedSecondOriginal]]) {
      const captured = order.after.bodies.filter(body => body.ref.key.owner.kind === 'original' && body.ref.key.owner.clientCommandId === id);
      expect(captured).toHaveLength(1);
      expect(captured[0].text).toBe(text);
      expect(captured[0].ref).toMatchObject({ epoch: order.after.snapshot?.epoch, kind: 'canonical', sha256: digest(text) });
    }
    expect(order.markdownBefore).toContain(original);
    expect(order.markdownBefore).toContain(orderedSecondOriginal);
    expect(order.markdownBefore).not.toContain(orderedPreparedB);
    expect(order.markdownAfter).toBe(order.markdownBefore);
    expect(order.checkpointAfter).toEqual(order.checkpointBefore);
    const sequence = (snapshot: NonNullable<typeof order.before.snapshot>) => snapshot.entries.flatMap(entry =>
      entry.kind === 'original' ? [entry.clientCommandId === sendCommandId ? 'A' : entry.clientCommandId === secondId ? 'B' : 'foreign-original']
        : entry.kind === 'assistant-text' ? [`B-answer-${entry.ordinal}`] : []);
    if (!order.before.snapshot || !order.after.snapshot) throw new Error('missing ready snapshots');
    expect(sequence(order.before.snapshot)).toEqual(['A', 'B', 'B-answer-0', 'B-answer-1']);
    // Initial RED is a real restored ordering error, after all native/SQL/original/checkpoint controls passed.
    expect(sequence(order.after.snapshot)).toEqual(['A', 'B', 'B-answer-0', 'B-answer-1']);
  });

  it('keeps a genuinely registered but never-attempted input recoverable and reserved after restart, without dispatching it', async () => {
    const report = await exercise('hydrate-unattempted');
    const value = restored(report);
    recoveredOriginal(value);
    expect(value.activeAtRestart).toEqual({});
    expect(value.sessionAtRestart.time.busy).toBeUndefined();
    expect(value.beforeFact.command).toMatchObject({ state: 'registered', dispatchAttempted: 0, nativeMessageId: messageId });
    expect(value.afterFact.command).toMatchObject({ state: 'registered', dispatchAttempted: 0 });
    expect(value.receipt).toMatchObject({ state: 'registered', runId: value.beforeFact.command?.runId });
    expect(report.counts).toEqual({ creates: 1, prompts: 0, replies: 0 });
  });

  it('does not guess an original association from prepared text or time when a historical ledger lacks its native message ID', async () => {
    const report = await exercise('hydrate-missing-association');
    const value = restored(report);
    recoveredOriginal(value);
    expect(value.beforeFact.command).toMatchObject({ nativeMessageId: null, state: 'admitted', dispatchAttempted: 1 });
    expect(value.after.snapshot).toMatchObject({ contentHealth: 'incomplete', transcript: { warning: true } });
    const input = value.after.snapshot?.entries.find(entry => entry.kind === 'original');
    expect(input?.kind === 'original' ? input.messageId : null).not.toBe(messageId);
    expect(value.after.bodies.some(item => item.text.includes('plugin-prepared'))).toBe(false);
    expect(value.receipt).toMatchObject({ state: 'admitted', runId: value.beforeFact.command?.runId });
    expect(report.counts).toEqual({ creates: 1, prompts: 1, replies: 0 });
  });

  it('fails closed on a corrupted immutable original digest without falling back to native prepared input or touching the transcript', async () => {
    const report = await exercise('hydrate-corrupt-digest');
    const value = restored(report);
    expect(value.beforeFact.command).toMatchObject({ payloadSha256: '0'.repeat(64), state: 'completed', dispatchAttempted: 1 });
    expect(value.afterFact.command).toEqual(value.beforeFact.command);
    expect(value.after.status).toBe(503);
    expect(value.after.error).toMatchObject({ error: { code: 'think_unavailable' } });
    expect(value.after.snapshot).toBeNull();
    expect(value.after.bodies).toEqual([]);
    expect(value.repeated.status).toBe(503);
    expect(report.counts).toEqual({ creates: 1, prompts: 1, replies: 0 });
  });

  it('commits canonical original form-answer bytes before replying and preserves immutable retries', async () => {
    const report = await exercise('form');
    expect(report.createStatus).toBe(202);
    expect(report.ready).toBe(true);
    expect(report.commandStatus).toBe(202);
    expect(report.commandReceipt).toMatchObject({ kind: 'form-reply', clientCommandId: formCommandId, state: 'replied' });
    expect(report.duplicateStatus).toBe(202);
    expect(report.changedStatus).toBe(409);
    expect(report.counts).toEqual({ creates: 1, prompts: 0, replies: 1 });
    const reply = report.observations.find(item => item.operation === 'form-reply');
    expect(reply?.input).toEqual({ answer: JSON.parse(canonicalAnswer) });
    const expected: ExpectedCommand = { ...owned(report), commandId: formCommandId, kind: 'form-reply', originalInput: canonicalAnswer,
      payloadSha256: digest(JSON.stringify({ conversationId, decisionId, answer: JSON.parse(canonicalAnswer) })),
      runId: null, nativeMessageId: null, decisionId };
    boundCommand(durable(reply?.probe, 'before native form reply'), { ...expected, state: 'registered', dispatchAttempted: 1 });
    boundCommand(durable(report.acknowledged, 'before returning form acknowledgement'), expected);
    boundCommand(durable(report.afterClose, 'after service close'), { ...expected, state: 'replied', dispatchAttempted: 1 });
  });

  it('retains uncertain dispatch facts across preparation restart without replay or a premature resume claim', async () => {
    const report = await exercise('uncertain');
    expect(report.createStatus).toBe(202);
    expect(report.ready).toBe(true);
    expect(report.commandReceipt).toMatchObject({ kind: 'send', clientCommandId: sendCommandId, state: 'upstream-unconfirmed' });
    expect(report.duplicateStatus).toBe(202);
    expect(report.changedStatus).toBe(409);
    expect(report.secondCreateStatus).toBe(202);
    expect(report.counts).toEqual({ creates: 2, prompts: 1, replies: 0 });
    const expected = sendExpected(report);
    const prompt = report.observations.find(item => item.operation === 'prompt');
    boundCommand(durable(prompt?.probe, 'before the native prompt with lost acknowledgement'), { ...expected, state: 'registered', dispatchAttempted: 1 });
    boundCommand(durable(report.acknowledged, 'before returning uncertain Send acknowledgement'), expected);
    const beforeRestart = durable(report.afterClose, 'after uncertain native admission and close');
    const afterRestart = durable(report.after, 'after preparing a fresh daemon authority');
    boundCommand(beforeRestart, { ...expected, state: 'upstream-unconfirmed', dispatchAttempted: 1 });
    const retained = boundCommand(afterRestart, { ...expected, dispatchAttempted: 1 });
    expect(['upstream-unconfirmed', 'admitted']).toContain(retained.state);
  });

  it.for(['database-symlink', 'database-hardlink', 'wal-symlink', 'shm-symlink',
    'state-inside-vault'] as const)('fails closed for %s without native mutation or sibling read failure', async (scenario, { skip }) => {
    // Windows file symlinks need Developer Mode or elevation; the fixture cannot stage this attack without it.
    if (scenario.endsWith('-symlink') && !await fileSymlinksPermitted()) { skip(); return; }
    const report = await exercise(scenario);
    expect(report.createStatus, 'unsafe private durable state must fail before native ownership creation').toBe(503);
    expect(report.createReceipt).toMatchObject({ error: { code: 'think_unavailable' } });
    expect(report.counts).toEqual({ creates: 0, prompts: 0, replies: 0 });
  });
});
