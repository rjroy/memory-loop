import assert from 'node:assert/strict';
import { constants, writeFileSync } from 'node:fs';
import { access, chmod, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Database } from 'bun:sqlite';
import { createQuestionPublisher, createQuotePublisher, questionPublicationIO } from '../backend/ground-generation-publisher';
import type { GroundGenerationPublicationState } from '../backend/ground-generation-publication-state';
import { mergeQuestions, questionCandidates, questionDigest } from '../backend/ground-generation-questions';
import { openThinkState } from '../backend/think/sqlite-state';

const root = process.argv[2]; const scenario = process.argv[3];
if (!root || !['manual', 'absence', 'lost-confirmation', 'v7-migration', 'v8-migration', 'create-interruption', 'unbound-substitution', 'terminal-cleanup-interruption', 'case-duplicate', 'permissive-recovery', 'nonportable-publication', 'legacy-target-recovery', 'legacy-parent-recovery', 'nonportable-missing-parent', 'write-sync-normal', 'write-sync-recovery', 'write-sync-terminal-cleanup', 'write-sync-io-failure'].includes(scenario)) throw new Error('invalid owned publication fixture');
const project = join(root, 'project'); const vault = join(root, 'vault');
const noteId = ['03_Resources', 'Memory-Loop',
  ...(['legacy-parent-recovery', 'nonportable-missing-parent'].includes(scenario) ? ['legacy:folder'] : []),
  scenario === 'nonportable-publication' ? 'CON.md' : scenario === 'legacy-target-recovery' ? 'legacy:questions.md' : 'prompts.md'];
const file = join(vault, ...noteId);
await mkdir(join(project, '.memory-loop'), { recursive: true, mode: 0o700 });
await mkdir(join(vault, ...noteId.slice(0, scenario === 'nonportable-missing-parent' ? -2 : -1)), { recursive: true, mode: 0o700 });
const initial = '# Owned questions\n\n## Question\nOriginal fixture question?\n';
const text = JSON.stringify([{ text: 'New fixture question?' }]);
const candidate = { messageId: 'msg_owned_candidate', text, sha256: questionDigest(text) };
let store = await openThinkState(project, vault);
const attempt = store.generation.claim({ directory: vault, timeZone: 'UTC', scheduledAt: 1000, count: 2, inputSha256: questionDigest('owned input'), selection: {} });
if (!attempt) throw new Error('fixture attempt missing');
store.generation.creating(attempt.attemptId); store.generation.verified(attempt.attemptId, {});
store.generation.attempted(attempt.attemptId); store.generation.admitted(attempt.attemptId);
const signal = new AbortController().signal;
function wrap(base: GroundGenerationPublicationState, overrides: Partial<GroundGenerationPublicationState>): GroundGenerationPublicationState {
  return { get: base.get.bind(base), stage: base.stage.bind(base), directories: base.directories.bind(base), temp: base.temp.bind(base),
    clearTemp: base.clearTemp.bind(base), publishing: base.publishing.bind(base), settle: base.settle.bind(base),
    fail: base.fail.bind(base), cleanup: base.cleanup.bind(base), ...overrides };
}
// Model write-required file fsync using real owned handles; this is not a native Windows test.
const writeSyncIO = {
  ...questionPublicationIO,
  async open(path: string, flags: number, mode?: number) {
    const handle = await questionPublicationIO.open(path, flags, mode);
    const writable = (flags & (constants.O_WRONLY | constants.O_RDWR)) !== 0;
    return {
      fd: handle.fd, stat: handle.stat.bind(handle), read: handle.read.bind(handle),
      write: handle.write.bind(handle), close: handle.close.bind(handle),
      async sync() {
        if (!writable) throw Object.assign(new Error('fixture read-only fsync'), { code: 'EBADF' });
        await handle.sync();
      },
    };
  },
};
try {
  if (scenario === 'write-sync-io-failure') {
    await writeFile(file, initial);
    let failed = false;
    const publisher = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications,
      io: { ...writeSyncIO, async open(path, flags, mode) {
        const handle = await writeSyncIO.open(path, flags, mode);
        return { ...handle, async sync() {
          if (!failed && (flags & (constants.O_WRONLY | constants.O_RDWR)) !== 0) {
            failed = true;
            throw Object.assign(new Error('fixture writable fsync failure'), { code: 'EIO' });
          }
          await handle.sync();
        } };
      } } });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'pending');
    assert.equal(failed, true);
    assert.equal(await readFile(file, 'utf8'), initial);
    const plan = store.generation.publications.get(attempt.attemptId);
    if (!plan?.tempWitnessName) throw new Error('fixture witness missing');
    assert.equal(plan.tempIdentity, null);
    const temp = join(vault, ...noteId.slice(0, -1), plan.tempName);
    const witness = join(vault, ...noteId.slice(0, -1), plan.tempWitnessName);
    const tempStat = await stat(temp); const witnessStat = await stat(witness);
    assert.equal(tempStat.ino, witnessStat.ino); assert.equal(tempStat.nlink, 2);
    store.close(); store = await openThinkState(project, vault);
    const pending = store.generation.pending(); if (!pending) throw new Error('fixture pending attempt missing after reopening');
    const recovered = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications, io: writeSyncIO });
    assert.equal(await recovered.resume(pending, signal), 'settled');
    assert.match(await readFile(file, 'utf8'), /New fixture question\?/);
    await assert.rejects(access(temp), { code: 'ENOENT' });
    await assert.rejects(access(witness), { code: 'ENOENT' });
  } else if (scenario === 'write-sync-normal') {
    await writeFile(file, initial);
    const sentinel = join(vault, ...noteId.slice(0, -1), 'manual-sentinel');
    await writeFile(sentinel, 'Unrelated manual file\n');
    const publisher = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications, io: writeSyncIO });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'settled');
    const bytes = await readFile(file, 'utf8');
    assert.match(bytes, /Original fixture question\?/);
    assert.match(bytes, /New fixture question\?/);
    assert.equal(store.generation.publications.get(attempt.attemptId)?.phase, 'settled');
    assert.equal(store.generation.pending(), null);
    assert.equal(await readFile(sentinel, 'utf8'), 'Unrelated manual file\n');
  } else if (scenario === 'nonportable-missing-parent') {
    const publisher = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'failed');
    await assert.rejects(access(join(vault, ...noteId.slice(0, -1))), { code: 'ENOENT' });
    assert.deepEqual(await readdir(join(vault, '03_Resources', 'Memory-Loop')), []);
  } else if (scenario === 'nonportable-publication') {
    const publisher = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'failed');
    assert.deepEqual(await readdir(join(vault, ...noteId.slice(0, -1))), []);
  } else if (scenario === 'permissive-recovery') {
    await writeFile(file, initial);
    await chmod(vault, 0o777);
    await chmod(join(vault, '03_Resources'), 0o777);
    await chmod(join(vault, ...noteId.slice(0, -1)), 0o777);
    await chmod(file, 0o666);
    const base = store.generation.publications;
    const state = wrap(base, { settle() { throw new Error('fixture lost database confirmation'); } });
    let tempCreated = false;
    const publisher = createQuestionPublisher({ directory: vault, noteId, state,
      io: { ...questionPublicationIO, async open(path, flags, mode) {
        const handle = await questionPublicationIO.open(path, flags, mode);
        if ((flags & constants.O_CREAT) !== 0 && (flags & constants.O_EXCL) !== 0) {
          tempCreated = true;
          await chmod(path, 0o666);
        }
        return handle;
      } } });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'pending');
    assert.equal(tempCreated, true);
    const bytes = await readFile(file, 'utf8'); const before = await stat(file);
    assert.match(bytes, /New fixture question\?/);
    assert.equal(base.get(attempt.attemptId)?.phase, 'publishing');
    store.close(); store = await openThinkState(project, vault);
    const pending = store.generation.pending(); if (!pending) throw new Error('fixture pending attempt missing after reopening');
    const recovered = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications });
    assert.equal(await recovered.resume(pending, signal), 'settled');
    assert.equal(await readFile(file, 'utf8'), bytes);
    assert.equal((await stat(file)).ino, before.ino);
    assert.equal(store.generation.publications.get(attempt.attemptId)?.phase, 'settled');
  } else if (scenario === 'manual') {
    await writeFile(file, initial);
    const base = store.generation.publications;
    const state = wrap(base, { publishing(id) { base.publishing(id); writeFileSync(file, 'Owned manual change\n'); } });
    const publisher = createQuestionPublisher({ directory: vault, noteId, state });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'failed');
    assert.equal(await readFile(file, 'utf8'), 'Owned manual change\n');
    assert.equal(base.get(attempt.attemptId)?.phase, 'conflict');
    await publisher.cleanup(signal);
  } else if (scenario === 'absence') {
    let finalLinkReached = false;
    const publisher = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications,
      io: { ...questionPublicationIO, async link(from, to) {
        if (basename(to) === noteId[noteId.length - 1]) { finalLinkReached = true; await writeFile(file, 'Owned concurrent file\n', { flag: 'wx' }); }
        await questionPublicationIO.link(from, to);
      } } });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'failed');
    assert.equal(finalLinkReached, true);
    assert.equal(await readFile(file, 'utf8'), 'Owned concurrent file\n');
    assert.equal(store.generation.publications.get(attempt.attemptId)?.phase, 'conflict');
    await publisher.cleanup(signal);
  } else if (['lost-confirmation', 'legacy-target-recovery', 'legacy-parent-recovery', 'write-sync-recovery'].includes(scenario)) {
    await writeFile(file, initial);
    const sentinel = join(vault, ...noteId.slice(0, -1), 'manual-sentinel');
    if (scenario !== 'lost-confirmation') await writeFile(sentinel, 'Unrelated manual file\n');
    const state = wrap(store.generation.publications, { settle() { throw new Error('fixture lost database confirmation'); } });
    const publisher = createQuestionPublisher({ directory: vault, noteId, state, ...(scenario === 'write-sync-recovery' ? { io: writeSyncIO } : {}) });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'pending');
    const bytes = await readFile(file, 'utf8'); const before = await stat(file);
    assert.match(bytes, /New fixture question\?/);
    assert.match(bytes, /Original fixture question\?/);
    assert.equal(store.generation.publications.get(attempt.attemptId)?.phase, 'publishing');
    store.close(); store = await openThinkState(project, vault);
    const pending = store.generation.pending(); if (!pending) throw new Error('fixture pending attempt missing after reopening');
    const recovered = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications, ...(scenario === 'write-sync-recovery' ? { io: writeSyncIO } : {}) });
    assert.equal(await recovered.resume(pending, signal), 'settled');
    assert.equal(await readFile(file, 'utf8'), bytes);
    const after = await stat(file); assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(store.generation.pending(), null);
    assert.equal(store.generation.publications.get(attempt.attemptId)?.phase, 'settled');
    if (scenario !== 'lost-confirmation') assert.equal(await readFile(sentinel, 'utf8'), 'Unrelated manual file\n');
  } else if (scenario === 'create-interruption') {
    await writeFile(file, initial);
    const sentinel = join(vault, ...noteId.slice(0, -1), 'manual-sentinel');
    await writeFile(sentinel, 'Unrelated manual file\n');
    let interrupted = false;
    const publisher = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications,
      io: { ...questionPublicationIO, async open(path, flags, mode) {
        const handle = await questionPublicationIO.open(path, flags, mode);
        if (!interrupted && (flags & constants.O_CREAT) !== 0 && (flags & constants.O_EXCL) !== 0) {
          interrupted = true;
          return { fd: handle.fd, async stat() { throw new Error('fixture interrupted after exclusive create'); },
            read: handle.read.bind(handle), write: handle.write.bind(handle), sync: handle.sync.bind(handle), close: handle.close.bind(handle) };
        }
        return handle;
      } } });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'pending');
    assert.equal(interrupted, true);
    const plan = store.generation.publications.get(attempt.attemptId);
    if (!plan) throw new Error('fixture publication plan missing');
    assert.equal(plan.tempIdentity, null);
    const temp = join(vault, ...noteId.slice(0, -1), plan.tempName);
    await access(temp);
    assert.equal(await readFile(file, 'utf8'), initial);
    store.close(); store = await openThinkState(project, vault);
    const pending = store.generation.pending(); if (!pending) throw new Error('fixture pending attempt missing after reopening');
    const recovered = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications });
    let result = await recovered.resume(pending, signal);
    if (result === 'pending') {
      // A clean retry is also acceptable if the unrecorded temporary file was removed first.
      await assert.rejects(access(temp), { code: 'ENOENT' });
      assert.equal(await readFile(file, 'utf8'), initial);
      result = await recovered.resume(pending, signal);
    }
    assert.equal(result, 'settled');
    assert.match(await readFile(file, 'utf8'), /New fixture question\?/);
    await assert.rejects(access(temp), { code: 'ENOENT' });
    assert.equal(await readFile(sentinel, 'utf8'), 'Unrelated manual file\n');
    assert.equal(store.generation.pending(), null);
  } else if (scenario === 'unbound-substitution') {
    await writeFile(file, initial);
    const sentinel = join(vault, ...noteId.slice(0, -1), 'manual-sentinel');
    await writeFile(sentinel, 'Unrelated manual file\n');
    const sentinelBefore = await stat(sentinel);
    let interrupted = false;
    const publisher = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications,
      io: { ...questionPublicationIO, async link(from, to) {
        await questionPublicationIO.link(from, to);
        if (basename(to).endsWith('.owner')) { interrupted = true; throw new Error('fixture interrupted after witness link'); }
      } } });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'pending');
    assert.equal(interrupted, true);
    const plan = store.generation.publications.get(attempt.attemptId);
    if (!plan?.tempWitnessName) throw new Error('fixture stored witness intent missing');
    assert.equal(plan.tempIdentity, null);
    const temp = join(vault, ...noteId.slice(0, -1), plan.tempName);
    const witness = join(vault, ...noteId.slice(0, -1), plan.tempWitnessName);
    const original = await stat(temp); const proof = await stat(witness);
    assert.equal(original.dev, proof.dev); assert.equal(original.ino, proof.ino);
    assert.equal(original.nlink, 2); assert.equal(original.size, 0);
    await unlink(temp);
    await writeFile(temp, 'Substituted manual file\n', { flag: 'wx', mode: 0o600 });
    const substitute = await stat(temp);
    assert.notEqual(substitute.ino, proof.ino);
    store.close(); store = await openThinkState(project, vault);
    const reopenedPlan = store.generation.publications.get(attempt.attemptId);
    assert.equal(reopenedPlan?.tempWitnessName, plan.tempWitnessName);
    assert.equal(reopenedPlan?.tempIdentity, null);
    const pending = store.generation.pending(); if (!pending) throw new Error('fixture pending attempt missing after reopening');
    const recovered = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications });
    assert.equal(await recovered.resume(pending, signal), 'failed');
    assert.equal(store.generation.publications.get(attempt.attemptId)?.phase, 'conflict');
    await recovered.cleanup(signal);
    assert.equal(await readFile(file, 'utf8'), initial);
    assert.equal(await readFile(temp, 'utf8'), 'Substituted manual file\n');
    assert.equal((await stat(temp)).ino, substitute.ino);
    assert.equal((await stat(witness)).ino, proof.ino);
    assert.equal(await readFile(sentinel, 'utf8'), 'Unrelated manual file\n');
    assert.equal((await stat(sentinel)).ino, sentinelBefore.ino);
  } else if (scenario === 'terminal-cleanup-interruption' || scenario === 'write-sync-terminal-cleanup') {
    await writeFile(file, initial);
    const sentinel = join(vault, ...noteId.slice(0, -1), 'manual-sentinel');
    await writeFile(sentinel, 'Unrelated manual file\n');
    const sentinelBefore = await stat(sentinel);
    let creationInterrupted = false;
    const io = scenario === 'write-sync-terminal-cleanup' ? writeSyncIO : questionPublicationIO;
    const publisher = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications,
      io: { ...io, async link(from, to) {
        await io.link(from, to);
        if (basename(to).endsWith('.owner')) { creationInterrupted = true; throw new Error('fixture interrupted after witness link'); }
      } } });
    assert.equal(await publisher.complete(attempt, candidate, signal), 'pending');
    assert.equal(creationInterrupted, true);
    const plan = store.generation.publications.get(attempt.attemptId);
    if (!plan?.tempWitnessName) throw new Error('fixture stored witness intent missing');
    assert.equal(plan.tempIdentity, null);
    const temp = join(vault, ...noteId.slice(0, -1), plan.tempName);
    const witness = join(vault, ...noteId.slice(0, -1), plan.tempWitnessName);
    const original = await stat(temp); const proof = await stat(witness);
    assert.equal(original.dev, proof.dev); assert.equal(original.ino, proof.ino);
    assert.equal(original.nlink, 2); assert.equal(original.size, 0);
    const manual = 'Owned manual target change\n';
    await writeFile(file, manual);
    const targetBefore = await stat(file);
    const recovered = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications, io });
    assert.equal(await recovered.resume(attempt, signal), 'failed');
    assert.equal(store.generation.publications.get(attempt.attemptId)?.phase, 'conflict');
    assert.equal(store.generation.publications.get(attempt.attemptId)?.tempIdentity, null);
    let cleanupInterrupted = false;
    const interruptedCleanup = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications,
      io: { ...io, async unlink(path) {
        await io.unlink(path);
        if (basename(path) === plan.tempWitnessName) { cleanupInterrupted = true; throw new Error('fixture interrupted after witness removal'); }
      } } });
    await interruptedCleanup.cleanup(signal);
    assert.equal(cleanupInterrupted, true);
    await assert.rejects(access(witness), { code: 'ENOENT' });
    assert.equal((await stat(temp)).ino, original.ino);
    store.close(); store = await openThinkState(project, vault);
    const reopened = store.generation.publications.get(attempt.attemptId);
    assert.equal(reopened?.phase, 'conflict');
    const retry = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications, io });
    await retry.cleanup(signal);
    await assert.rejects(access(temp), { code: 'ENOENT' });
    assert.deepEqual(reopened?.tempIdentity, { dev: original.dev, ino: original.ino });
    assert.equal(await readFile(file, 'utf8'), manual);
    assert.equal((await stat(file)).ino, targetBefore.ino);
    assert.equal(await readFile(sentinel, 'utf8'), 'Unrelated manual file\n');
    assert.equal((await stat(sentinel)).ino, sentinelBefore.ino);
  } else if (scenario === 'case-duplicate') {
    const source = `# Owned questions\n\n${Array.from({ length: 50 }, (_, i) => `## Question\nQuestion ${i}?\n`).join('\n')}`;
    await writeFile(file, source);
    const duplicateText = JSON.stringify([{ text: 'question 49?' }]);
    const candidates = questionCandidates(duplicateText, 1);
    assert.deepEqual(candidates, [{ text: 'question 49?' }]);
    let mutations = 0;
    const publisher = createQuestionPublisher({ directory: vault, noteId, state: store.generation.publications,
      io: { ...questionPublicationIO,
        async open(path, flags, mode) { if ((flags & constants.O_CREAT) !== 0) mutations++; return questionPublicationIO.open(path, flags, mode); },
        async rename(from, to) { mutations++; await questionPublicationIO.rename(from, to); },
        async link(from, to) { mutations++; await questionPublicationIO.link(from, to); },
        async unlink(path) { mutations++; await questionPublicationIO.unlink(path); } } });
    const before = await stat(file);
    assert.equal(await publisher.complete(attempt, { messageId: 'msg_case_duplicate', text: duplicateText, sha256: questionDigest(duplicateText) }, signal), 'settled');
    assert.equal(mutations, 0);
    assert.equal(await readFile(file, 'utf8'), source);
    const after = await stat(file); assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs);
    assert.deepEqual(mergeQuestions(source, candidates), { output: source, writeRequired: false });
  } else {
    const oldAttempt = store.generation.pending();
    const occurrence = { directory: vault, timeZone: 'UTC', scheduledAt: 2000 };
    const reserved = store.generation.beginPreflight(occurrence, 100000);
    assert.equal(reserved.allowed, true);
    if (scenario === 'v8-migration') {
      await writeFile(file, initial);
      const state = wrap(store.generation.publications, { publishing() { throw new Error('owned pre-publication interruption'); } });
      assert.equal(await createQuestionPublisher({ directory: vault, noteId, state }).complete(attempt, candidate, signal), 'pending');
    }
    const oldPlan = store.generation.publications.get(attempt.attemptId);
    if (oldPlan && scenario === 'v8-migration') delete oldPlan.job;
    store.close();
    const db = new Database(join(project, '.memory-loop', 'application.sqlite'));
    try {
      db.exec('DROP TABLE ground_generation_period_attempts');
      if (scenario === 'v7-migration') db.exec('DROP TABLE ground_generation_publications');
      else db.query("UPDATE ground_generation_publications SET plan_json = json_remove(plan_json, '$.job') WHERE attempt_id = ?").run(attempt.attemptId);
      db.exec(`CREATE TABLE ground_generation_preflight_old (
        occurrence_id TEXT PRIMARY KEY NOT NULL, job_key TEXT NOT NULL CHECK(job_key = 'questions'),
        time_zone TEXT NOT NULL, scheduled_at INTEGER NOT NULL, vault_directory TEXT NOT NULL,
        attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 3), retry_at INTEGER,
        blocked INTEGER NOT NULL CHECK(blocked IN (0, 1)), UNIQUE(job_key, time_zone, scheduled_at));
        INSERT INTO ground_generation_preflight_old SELECT * FROM ground_generation_preflight;
        DROP TABLE ground_generation_preflight;
        ALTER TABLE ground_generation_preflight_old RENAME TO ground_generation_preflight;`);
      db.exec(`PRAGMA user_version = ${scenario === 'v7-migration' ? 7 : 8}`);
    }
    finally { db.close(); }
    store = await openThinkState(project, vault);
    assert.deepEqual(store.generation.pending(), oldAttempt);
    const retained = store.generation.beginPreflight(occurrence, 100001);
    assert.equal(retained.allowed, false); assert.deepEqual(retained.fact, reserved.fact);
    if (scenario === 'v8-migration') {
      assert.deepEqual(store.generation.publications.get(attempt.attemptId), oldPlan);
      const quoteOccurrence = { ...occurrence, job: 'quotes' as const };
      assert.equal(store.generation.beginPreflight(quoteOccurrence, 100001).allowed, true);
      const quoteAttempt = store.generation.claim({ ...quoteOccurrence, count: 2, inputSha256: questionDigest('quote input'), selection: {} });
      assert(quoteAttempt); store.generation.creating(quoteAttempt.attemptId); store.generation.verified(quoteAttempt.attemptId, {});
      store.generation.attempted(quoteAttempt.attemptId); store.generation.admitted(quoteAttempt.attemptId);
      const quoteText = JSON.stringify([{ text: 'Fictional fixture quote', attribution: 'Fixture author' }]);
      const publisher = createQuotePublisher({ directory: vault, noteId: ['03_Resources', 'Memory-Loop', 'inspiration.md'], state: store.generation.publications });
      assert.equal(await publisher.complete(quoteAttempt, { messageId: 'msg_owned_quote', text: quoteText, sha256: questionDigest(quoteText) }, signal), 'settled');
      assert.deepEqual(store.generation.publications.get(attempt.attemptId), oldPlan);
    }
  }
  console.log(JSON.stringify({ scenario, passed: true }));
} finally { store.close(); }
