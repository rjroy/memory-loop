import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandFact, FixtureReport, Probe, Scenario } from '../tests/think-durable-admission-fixture';

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
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
let root: string;

beforeEach(async () => { root = await mkdtemp('/tmp/opencode/think-durable-admission-'); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function exercise(scenario: Scenario): Promise<FixtureReport> {
  const output = join(root, 'report.json');
  const child = spawnSync('/usr/bin/bun', ['--no-env-file', runner, root, scenario, output], {
    cwd: root, timeout: 15000, maxBuffer: 512 * 1024, encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: '/usr/bin:/bin', HOME: root, XDG_CONFIG_HOME: root,
      XDG_DATA_HOME: root, XDG_CACHE_HOME: root, XDG_STATE_HOME: root, TMPDIR: root },
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
  expect(probe.schemaVersion).toBe(1);
  expect(probe.fileMode).toBe(0o600);
  expect(probe.directoryMode).toBe(0o700);
  expect(probe.ownerMatches).toBe(true);
  expect(probe.writerAvailable, 'a SQLite write transaction must not span an external native call').toBe(true);
  return probe;
}

type Ownership = Pick<CommandFact, 'conversationId' | 'nativeSessionId' | 'vaultDirectory' | 'creationEpoch'> & { ownerMarker: unknown };
interface ExpectedCommand extends Ownership {
  commandId: string;
  kind: 'create' | 'send' | 'form-reply';
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

  it('GROUND-DURABLE-01 retains historical creation readiness without pretending the target snapshot was restored', async () => {
    const report = await exercise('create-ready-restart');
    expect(report.createStatus).toBe(202);
    expect(report.ready).toBe(true);
    expect(report.counts).toEqual({ creates: 1, prompts: 0, replies: 0 });
    const expected: ExpectedCommand = { ...owned(report), commandId: createCommandId, kind: 'create', originalInput: null,
      payloadSha256: null, runId: null, nativeMessageId: null, decisionId: null, state: 'ready', dispatchAttempted: 1 };
    boundCommand(durable(report.afterClose, 'before the restart'), expected);
    boundCommand(durable(report.after, 'after the restart'), expected);
    expect(report.restart?.snapshotStatus).toBe(404);
    expect(report.restart?.snapshot).toMatchObject({ error: { code: 'not_found' } });
    // The fix may keep historical ready facts readable or guard their serving status.
    // It must not erase/change the immutable DB fact or replay native creation to hide this gap.
    if (report.restart?.commandStatus === 200) {
      expect(report.restart.commandReceipt).toMatchObject({ conversationId, clientCommandId: createCommandId, kind: 'create', epoch: expect.any(String) });
      const receipt = report.restart.commandReceipt as { epoch: string };
      expect(receipt.epoch).not.toBe(expected.creationEpoch);
    } else expect([409, 503]).toContain(report.restart?.commandStatus);
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

  it.each(['database-symlink', 'database-hardlink', 'database-permissions', 'wal-symlink', 'shm-symlink',
    'metadata-permissions', 'state-inside-vault'] as const)('fails closed for %s without native mutation or sibling read failure', async scenario => {
    const report = await exercise(scenario);
    expect(report.createStatus, 'unsafe private durable state must fail before native ownership creation').toBe(503);
    expect(report.createReceipt).toMatchObject({ error: { code: 'think_unavailable' } });
    expect(report.counts).toEqual({ creates: 0, prompts: 0, replies: 0 });
  });
});
