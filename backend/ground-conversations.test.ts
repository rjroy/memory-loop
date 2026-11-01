import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Http, Mode, Report } from '../tests/ground-conversations-fixture';

// The Bun program imports only current production factories. Node never imports bun:sqlite.
const runner = resolve(import.meta.dirname, '../tests/ground-conversations-fixture.ts');
const instant = 1_700_000_000_000;
const id = (group: number, index: number) => `${(group * 0x10000 + index).toString(16).padStart(8, '0')}-1111-4111-8111-000000000001`;
const conversation = (index: number) => id(1, index);
const firstOriginal = '\r\n \t\r\n   First   useful\tline 🧠  \r\nprivate second line, not a title';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
let root: string;
beforeEach(async () => { root = await mkdtemp('/tmp/opencode/ground-conversations-'); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

interface Recent {
  conversationId: string; title: string | null; lastActivityAt: string;
  transcriptNoteId?: string[];
  state: 'ready' | 'recovering' | 'unavailable' | 'deleting';
  resume: { available: boolean; reason?: string };
  delete?: { available: boolean; reason?: string };
}
function items(response: Http | undefined): Recent[] {
  expect(response).toBeDefined();
  if (!response) throw new Error('fixture observation missing');
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ state: 'ready', items: expect.any(Array) });
  return (response.body as { state: 'ready'; items: Recent[] }).items;
}
const activityFacts = (rows: Recent[]) => rows.map(({ conversationId, title, lastActivityAt }) => ({ conversationId, title, lastActivityAt }));

async function exercise(mode: Mode): Promise<Report> {
  const output = join(root, 'report.json');
  const child = spawnSync('/usr/bin/bun', ['--no-env-file', runner, root, mode, output], {
    cwd: root, timeout: 15000, maxBuffer: 512 * 1024, encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: '/usr/bin:/bin', HOME: root, XDG_CONFIG_HOME: root, XDG_DATA_HOME: root,
      XDG_CACHE_HOME: root, XDG_STATE_HOME: root, TMPDIR: root },
  });
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, `current factories/native protocol must work BEFORE new-route assertions:\n${child.stdout}\n${child.stderr}`).toBe(0);
  const report = JSON.parse(await readFile(output, 'utf8')) as Report;
  expect(report.mode).toBe(mode);
  expect(report.unexpected, 'a fake-native protocol mismatch is not a valid route RED').toEqual([]);
  expect(report.effects, 'reads, lease changes and Resume must never create, prompt, reply, cancel or Stop native work')
    .toEqual({ creates: 0, prompts: 0, cancels: 0, interrupts: 0, replies: 0 });
  expect(report.controls.snapshot).toMatchObject({ status: 200, body: { conversationId: conversation(1), creation: 'ready',
    sendEligibility: mode === 'resume' ? 'busy' : 'available' } });
  expect(report.controls.goals).toMatchObject({ status: 200, body: { state: 'ready', data: { markdown: 'Owned fixture goal' } } });
  expect(report.controls.tree.status).toBe(200);
  expect(report.controls.capture).toEqual({ status: 200, body: { ok: true } });
  expect(report.before.conversationIds).toEqual(Array.from({ length: 14 }, (_, index) => conversation(index + 1)));
  expect(report.before).toMatchObject({ sendCount: 13, originalHex: Buffer.from(firstOriginal).toString('hex'),
    originalSha256: sha(firstOriginal), nativeSessionId: `ses_memoryloop_${conversation(1).replaceAll('-', '')}` });
  expect(report.after, 'latest ten is not retention: item eleven, empty chat and all immutable originals stay registered').toEqual(report.before);
  expect(report.legacyUnchanged).toBe(true);
  expect(report.nativeLookalikesUnchanged).toBe(true);
  return report;
}

describe('Ground 3ry real registry listing, explicit Resume and view selection routes', () => {
  it('control: current prepareServer hydrates the seeded owned chat and keeps existing Ground/Capture/Recall usable without native effects', async () => {
    await exercise('recent');
  });

  it('lists ten registered-Send chats by meaningful fact time with UUID ties and plain bounded original titles, without polling bumps or legacy adoption', async () => {
    const report = await exercise('recent');
    expect(report.list?.status, 'GET /api/ground/recent-conversations must be the real registered-chat card').toBe(200);
    const rows = items(report.list);
    const expected = [1, 12, 13, 11, 10, 9, 8, 7, 6, 5];
    expect(rows.map(row => row.conversationId)).toEqual(expected.map(conversation));
    expect(rows.map(row => row.lastActivityAt)).toEqual(expected.map(index =>
      new Date(instant + (index === 1 ? 30000 : index >= 12 ? 13000 : index * 1000)).toISOString()));
    expect(rows.find(row => row.conversationId === conversation(1))?.title).toBe('First useful line 🧠');
    expect(rows.find(row => row.conversationId === conversation(12))?.title).toBe('🧠'.repeat(120));
    expect(rows.every(row => row.state === 'ready' && row.resume.available)).toBe(true);
    expect(activityFacts(items(report.repeatedList))).toEqual(activityFacts(rows));
    const browserData = JSON.stringify(report.list?.body);
    for (const forbidden of [root, 'ses_memoryloop_', 'native prepared input', 'private second line', 'private form answer',
      conversation(14), conversation(99), 'ses_fixture_ground_generation']) expect(browserData).not.toContain(forbidden);
  });

  it('prepares the exact busy registered conversation with one target-bound Resume command, immutable retries and no recency bump or native replay', async () => {
    const report = await exercise('resume');
    expect(report.resume?.requested.status, 'POST /api/think/conversations/:id/resume must prepare rather than create or Send').toBe(202);
    if (!report.resume) throw new Error('fixture Resume observation missing');
    const expected = { kind: 'resume', conversationId: conversation(1), clientCommandId: id(6, 1), state: 'ready',
      epoch: (report.controls.snapshot.body as { epoch: string }).epoch };
    expect(report.resume.ready).toMatchObject({ status: 200, body: expected });
    expect(report.resume.retry).toMatchObject({ status: 202, body: expected });
    expect(report.resume.wrongTarget).toMatchObject({ status: 409, body: { error: { code: 'command_conflict' } } });
    expect(report.resume.snapshot).toMatchObject({ status: 200, body: { conversationId: conversation(1), creation: 'ready', sendEligibility: 'busy' } });
    expect(activityFacts(items(report.resume.listAfter))).toEqual(activityFacts(items(report.resume.listBefore)));
    expect(items(report.resume.listAfter).find(row => row.conversationId === conversation(1))?.resume).toMatchObject({ available: true });
  });

  it('advances recency once at a verified native canonical timestamp, retaining it through polling, Resume and fresh daemon history recovery', async () => {
    const report = await exercise('canonical');
    const value = report.canonical;
    expect(value).toBeDefined();
    if (!value) throw new Error('missing canonical observations');
    expect(items(value.beforeList).some(row => row.conversationId === conversation(4))).toBe(false);
    const text = 'Verified canonical fixture Ω\nbody';
    const expectedFact = { conversationId: conversation(4), nativeSessionId: `ses_memoryloop_${conversation(4).replaceAll('-', '')}`,
      messageId: 'msg_ground_canonical_activity', ordinal: 0, sha256: sha(text), length: Buffer.byteLength(text), at: instant + 60000 };
    const expectedInput = '  Conversation 4\nprivate second line, not a title';
    for (const proof of [value.first, value.repeated, value.restarted]) {
      expect(proof.facts, 'same native message/ordinal/bytes must remain ONE committed activity fact').toEqual([expectedFact]);
      expect(proof).toMatchObject({ activityAt: instant + 60000, originalHex: Buffer.from(expectedInput).toString('hex'), originalSha256: sha(expectedInput) });
    }
    expect(value.first.resumeCount).toBe(0);
    expect(value.repeated.resumeCount).toBe(1);
    expect(value.restarted.resumeCount).toBe(1);
    const expectedActivity = { conversationId: conversation(4), title: 'Conversation 4', lastActivityAt: new Date(instant + 60000).toISOString() };
    for (const list of [value.firstList, value.repeatedList, value.restartList]) expect(items(list)[0]).toMatchObject(expectedActivity);
    expect(activityFacts(items(value.repeatedList))).toEqual(activityFacts(items(value.firstList)));
    expect(activityFacts(items(value.restartList))).toEqual(activityFacts(items(value.firstList)));
    expect(value.snapshot).toMatchObject({ status: 200, body: { conversationId: conversation(4), creation: 'ready', entries: expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant-text', messageId: expectedFact.messageId, ordinal: 0,
        body: expect.objectContaining({ kind: 'canonical', sha256: sha(text), through: Buffer.byteLength(text) }) }),
    ]) } });
    expect(value.restartSnapshot).toMatchObject({ status: 200, body: { conversationId: conversation(4), creation: 'ready' } });
    const oldEpoch = (value.snapshot.body as { epoch: string }).epoch;
    const newEpoch = (value.restartSnapshot.body as { epoch: string }).epoch;
    expect(newEpoch).not.toBe(oldEpoch);
    expect(value.resumed).toMatchObject({ status: 202, body: { kind: 'resume', conversationId: conversation(4), clientCommandId: id(6, 4), state: 'ready', epoch: oldEpoch } });
    for (const response of [value.commandAfterRestart, value.retryAfterRestart]) expect(response).toMatchObject({
      body: { kind: 'resume', conversationId: conversation(4), clientCommandId: id(6, 4), state: 'ready', epoch: newEpoch } });
    expect(value.commandAfterRestart.status).toBe(200);
    expect(value.retryAfterRestart.status).toBe(202);
  });

  it('keeps a healthy ten-row registry card and its siblings readable after starting a fresh daemon lifetime with native offline', async () => {
    const report = await exercise('offline');
    const value = report.offline;
    expect(value).toBeDefined();
    if (!value) throw new Error('missing offline observations');
    const rows = items(value.list);
    expect(rows.map(row => row.conversationId)).toEqual([1, 12, 13, 11, 10, 9, 8, 7, 6, 5].map(conversation));
    expect(rows[0]).toMatchObject({ title: 'First useful line 🧠', lastActivityAt: new Date(instant + 30000).toISOString() });
    for (const row of rows) expect(row).toMatchObject({ state: 'unavailable', resume: { available: false, reason: 'unavailable' },
      delete: { available: false, reason: 'status_unknown' } });
    expect(value.siblings.goals).toMatchObject({ status: 200, body: { state: 'ready', data: { markdown: 'Owned fixture goal' } } });
    expect(value.siblings.tree.status).toBe(200);
    expect(value.siblings.capture).toEqual({ status: 200, body: { ok: true } });
    for (const secret of [root, 'fixture-private-native-error', 'ses_memoryloop_', 'native-registration.json']) expect(JSON.stringify(value.list.body)).not.toContain(secret);
  });

  it('GROUND-CONVERSATIONS-01 retains the real recent list after the owned native descriptor is removed before fresh prepareServer startup', async () => {
    const report = await exercise('registration-absent');
    const value = report.registrationAbsent;
    expect(value).toBeDefined();
    if (!value) throw new Error('missing descriptor-removal observations');
    expect(value.descriptorMissing, 'only the test-owned native registration file is absent').toBe(true);
    expect(value.databaseIntegrity).toBe('ok');
    expect(value.databaseMode).toBe(0o600);
    expect(value.directoryMode).toBe(0o700);
    const transcript = Buffer.from(value.transcriptBefore.bytesHex, 'hex');
    expect(value.transcriptBefore).toMatchObject({ noteId: ['Conversations', 'Memory Loop', `think-${conversation(1)}.md`],
      creationState: 'owned', offset: transcript.length, sha256: createHash('sha256').update(transcript).digest('hex'), pendingEntryId: null });
    expect(value.transcriptBefore.entries).toContain(`user:${id(3, 1)}`);
    expect(transcript.toString('utf8')).toContain(firstOriginal);
    expect(value.transcriptAfter, 'restart/list reads cannot rewrite a retained owned transcript or its checkpoint').toEqual(value.transcriptBefore);
    expect(value.siblings.goals).toMatchObject({ status: 200, body: { state: 'ready', data: { markdown: 'Owned fixture goal' } } });
    expect(value.siblings.tree.status).toBe(200);
    expect(value.siblings.capture).toEqual({ status: 200, body: { ok: true } });
    expect(value.list.status, 'healthy private registry must stay readable when normal native shutdown removes its descriptor').toBe(200);
    // Initial RED is 503 above. These retained DTO assertions must run after the production fix.
    const rows = items(value.list);
    expect(rows.map(row => row.conversationId)).toEqual([1, 12, 13, 11, 10, 9, 8, 7, 6, 5].map(conversation));
    expect(rows[0]).toMatchObject({ title: 'First useful line 🧠', lastActivityAt: new Date(instant + 30000).toISOString() });
    expect(rows.find(row => row.conversationId === conversation(12))?.title).toBe('🧠'.repeat(120));
    for (const row of rows) expect(row).toMatchObject({ state: 'unavailable', resume: { available: false, reason: 'unavailable' },
      delete: { available: false, reason: 'status_unknown' } });
    for (const secret of [root, 'ses_memoryloop_', 'native-registration.json']) expect(JSON.stringify(value.list.body)).not.toContain(secret);
  });

  it('retains one target-bound uncertain Resume across restart and resolves that same intent from later native reads without dispatch or selection', async () => {
    const report = await exercise('resume-unknown');
    const value = report.resumeUnknown;
    expect(value).toBeDefined();
    if (!value) throw new Error('missing uncertain Resume observations');
    const target = { kind: 'resume', conversationId: conversation(1), clientCommandId: id(6, 1) };
    expect(value.first).toMatchObject({ status: 202, body: { ...target, state: 'upstream-unconfirmed' } });
    expect(value.unknownAfterRestart).toMatchObject({ status: 200, body: { ...target, state: 'upstream-unconfirmed' } });
    expect(value.beforeRestart).toMatchObject({ commandId: target.clientCommandId, conversationId: target.conversationId,
      nativeSessionId: `ses_memoryloop_${target.conversationId.replaceAll('-', '')}`, state: 'upstream-unconfirmed', failureCode: null, count: 1 });
    expect(value.afterUnknown).toEqual(value.beforeRestart);
    expect(value.afterKnown).toEqual({ ...value.beforeRestart, state: 'ready' });
    expect((value.first.body as { epoch: string }).epoch).toBe(value.beforeRestart.registrationEpoch);
    const newEpoch = (value.snapshot.body as { epoch: string }).epoch;
    expect(newEpoch).not.toBe(value.beforeRestart.registrationEpoch);
    expect(value.known).toMatchObject({ status: 200, body: { ...target, state: 'ready', epoch: newEpoch } });
    expect(value.retry).toMatchObject({ status: 202, body: { ...target, state: 'ready', epoch: newEpoch } });
    expect(value.snapshot).toMatchObject({ status: 200, body: { conversationId: target.conversationId, creation: 'ready', sendEligibility: 'available' } });
    expect(activityFacts(items(value.listAfter))).toEqual(activityFacts(items(value.listBefore)));
  });

  it('mints hash-only owned views and preserves strict selection CAS, independent clients and two-minute protection across Ground reads and a quick restart', async () => {
    const report = await exercise('leases');
    expect(report.leases?.registration.status, 'POST /api/think/views must register a daemon-minted view, not a caller ID').toBe(201);
    if (!report.leases) throw new Error('fixture lease observations missing');
    const lease = report.leases;
    const at = instant + 1_000_000;
    expect(lease.registration.body).toEqual({ selectionRevision: 0, conversationId: null, expiresAt: new Date(at + 120000).toISOString() });
    expect(lease.secondRegistration).toEqual(lease.registration);
    expect(lease.tokenShape).toBe(true);
    expect(lease.tokensDistinct).toBe(true);
    expect(lease.selected).toEqual({ status: 200, body: { selectionRevision: 1, conversationId: conversation(1), expiresAt: new Date(at + 120000).toISOString() } });
    const selectedAfterRenewal = { selectionRevision: 1, conversationId: conversation(1), expiresAt: new Date(at + 150000).toISOString() };
    expect(lease.renewed).toEqual({ status: 200, body: selectedAfterRenewal });
    expect(lease.preparedResume).toMatchObject({ status: 202, body: { kind: 'resume', conversationId: conversation(13), clientCommandId: id(6, 13) } });
    expect(lease.selectionAfterResume, 'Resume prepares a target; it never commits selection').toEqual(lease.renewed);
    expect(lease.stale).toMatchObject({ status: 409, body: { error: { code: 'selection_conflict' } } });
    expect(lease.staleRenewal, 'the fixed readback route must not silently weaken CAS for renewals').toMatchObject({ status: 409, body: { error: { code: 'selection_conflict' } } });
    // Accepted fixed readback: header-authenticated, with no mutation/renewal.
    expect(lease.readback, 'lost POST acknowledgements need current revision without relaxing compare-and-set').toEqual(lease.renewed);
    expect(lease.otherSelected).toEqual({ status: 200, body: { selectionRevision: 1, conversationId: conversation(12), expiresAt: new Date(at + 150000).toISOString() } });
    expect(lease.cleared).toEqual({ status: 200, body: { selectionRevision: 2, conversationId: null, expiresAt: new Date(at + 150000).toISOString() } });
    expect(lease.foreignHash).toMatchObject({ status: 403, body: { error: { code: 'lease_unavailable' } } });
    expect(lease.unownedTarget).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
    expect(items(lease.ownList).find(row => row.conversationId === conversation(12))?.delete).toMatchObject({ available: false, reason: 'selected_elsewhere' });
    expect(items(lease.otherList).find(row => row.conversationId === conversation(12))?.delete).toMatchObject({ available: false, reason: 'current' });
    expect(lease.rows).toMatchObject([
      { tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), conversationId: null, selectionRevision: 2, expiresAt: at + 150000 },
      { tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), conversationId: conversation(12), selectionRevision: 1, expiresAt: at + 150000 },
    ]);
    expect(lease.rows?.[0].tokenHash).not.toBe(lease.rows?.[1].tokenHash);
    expect(lease.foreignKey).toBe(true);
    expect(lease.plaintextStored).toBe(false);
    expect(lease.tokenDataExposed).toBe(false);
    expect(lease.afterRestart, 'a read must preserve the committed binding/revision/expiry across daemon lifetime').toEqual(lease.cleared);
    expect(lease.rowsAfterRestart).toEqual(lease.rows);
    expect(items(lease.restartList).find(row => row.conversationId === conversation(12))?.delete).toMatchObject({ available: false, reason: 'current' });
    expect(lease.expired).toMatchObject({ status: 403, body: { error: { code: 'lease_unavailable' } } });
    expect(lease.expiredRead).toMatchObject({ status: 403, body: { error: { code: 'lease_unavailable' } } });
    expect(items(lease.afterExpiryList).every(row => !['current', 'selected_elsewhere'].includes(row.delete?.reason ?? ''))).toBe(true);
  });

  it('recovers an unobserved successful selection acknowledgement by read-only GET, then uses the learned revision without changing another client', async () => {
    const report = await exercise('lease-lost-ack');
    const value = report.lostAck;
    expect(value).toBeDefined();
    if (!value) throw new Error('missing lost-selection-ack observations');
    const at = instant + 1_000_000;
    expect(value.acceptedStatus).toBe(200);
    expect(value.beforeRead.rows).toMatchObject([
      { conversationId: conversation(1), selectionRevision: 1, expiresAt: at + 120000 },
      { conversationId: conversation(12), selectionRevision: 1, expiresAt: at + 120000 },
    ]);
    expect(value.readback, 'GET happens 45 seconds AFTER the accepted POST and must not extend expiry').toEqual({ status: 200,
      body: { selectionRevision: 1, conversationId: conversation(1), expiresAt: new Date(at + 120000).toISOString() } });
    expect(value.afterRead, 'GET must not mutate either lease or its conversation version/activity').toEqual(value.beforeRead);
    expect(value.stale).toMatchObject({ status: 409, body: { error: { code: 'selection_conflict' } } });
    expect(value.beforeCorrectCas).toEqual(value.beforeRead);
    expect(value.changed).toEqual({ status: 200, body: { selectionRevision: 2, conversationId: conversation(13), expiresAt: new Date(at + 170000).toISOString() } });
    expect(value.afterChange.rows[0]).toEqual({ ...value.beforeRead.rows[0], conversationId: conversation(13), selectionRevision: 2, expiresAt: at + 170000 });
    expect(value.afterChange.rows[1]).toEqual(value.beforeRead.rows[1]);
    expect(value.afterChange.versions.find(row => row.conversationId === conversation(12))).toEqual(
      value.beforeRead.versions.find(row => row.conversationId === conversation(12)));
  });

  it('rejects an unregistered opaque selection token without mutating a conversation or accepting a caller-owned identity', async () => {
    const report = await exercise('unknown-selection');
    expect(report.unknownSelection).toMatchObject({ status: 403, body: { error: { code: 'lease_unavailable' } } });
    expect(report.unknownRead).toMatchObject({ status: 403, body: { error: { code: 'lease_unavailable' } } });
  });
});
