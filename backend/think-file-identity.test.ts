import type { BigIntStats } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exactFingerprint, fingerprintMatches, parseFileIdValue, parseFileIdentity } from './file-identity';
import { openThinkState } from './think/sqlite-state';
import { RegisteredTranscript } from './think/transcript-durable';
import { TranscriptNamespace, transcriptIO, type TranscriptBytes, type TranscriptIO } from './think/transcript-file';
import { removeMappedTranscript } from './think/transcript-remove';

/** An NTFS-sized file ID: above Number.MAX_SAFE_INTEGER, where doubles are spaced 4 apart. */
const largeId = 26458647810952040n;
const conversationId = '11111111-1111-4111-8111-111111111111';
const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const emptySha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const running = () => false;
const bytes = (text: string): TranscriptBytes => {
  const data = Buffer.from(text);
  return { length: data.length, async *chunks(offset) { if (offset < data.length) yield data.subarray(offset); } };
};

describe('exact file identity values', () => {
  it('keeps 64-bit IDs exact and accepts only the legacy safe-integer number form', () => {
    expect(Number.isSafeInteger(Number(largeId))).toBe(false);
    expect(parseFileIdValue(largeId.toString())).toBe('26458647810952040');
    expect(parseFileIdValue('26458647810952041')).toBe('26458647810952041');
    expect(parseFileIdValue('18446744073709551615')).toBe('18446744073709551615');
    expect(parseFileIdValue('0')).toBe('0');
    expect(parseFileIdValue(123)).toBe('123');
    expect(parseFileIdValue(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
    for (const invalid of ['18446744073709551616', '-1', '01', '1.5', '1e3', ' 1', '', '0x10', -1, 1.5, 2 ** 53, Number.NaN, null, undefined, 1n]) {
      expect(parseFileIdValue(invalid), String(invalid)).toBeUndefined();
    }
    expect(parseFileIdentity({ dev: '1', ino: '26458647810952041' })).toEqual({ dev: '1', ino: '26458647810952041' });
    expect(parseFileIdentity({ dev: 1, ino: 2 })).toEqual({ dev: '1', ino: '2' });
    expect(parseFileIdentity({ dev: '1', ino: '2', extra: 3 })).toBeUndefined();
    expect(parseFileIdentity({ dev: '1' })).toBeUndefined();
  });

  it('matches legacy numeric fingerprints only for the same exact safe-integer identity and time', () => {
    const stat = (ino: bigint) => ({ dev: 5n, ino, size: 12n, mtimeNs: 1793934703423122400n, ctimeNs: 1793934703426122000n,
      nlink: 1n, uid: 0n, mode: 33188n }) as BigIntStats;
    // Exactly what number Stats serialized before exact identities: double milliseconds.
    const legacy = (ino: number, mtimeMs = 1793934703423.1224) => JSON.stringify([5, ino, 12, mtimeMs, 1793934703426.122, 1, 0, 33188]);
    expect(fingerprintMatches(stat(42n), legacy(42), true)).toBe(true);
    expect(fingerprintMatches(stat(42n), exactFingerprint(stat(42n), true), true)).toBe(true);
    expect(fingerprintMatches(stat(43n), legacy(42), true)).toBe(false);
    expect(fingerprintMatches(stat(42n), legacy(42, 1793934703424.1224), true)).toBe(false);
    expect(fingerprintMatches(stat(42n), exactFingerprint(stat(43n), true), true)).toBe(false);
    // A large ID was never valid in the legacy form, so its rounded number cannot match either neighbour.
    expect(fingerprintMatches(stat(largeId), legacy(Number(largeId)), true)).toBe(false);
    expect(exactFingerprint(stat(largeId), true)).not.toBe(exactFingerprint(stat(largeId + 1n), true));
    expect(exactFingerprint(stat(largeId), false)).toBe(exactFingerprint({ ...stat(largeId), ctimeNs: 1n } as BigIntStats, false));
  });
});

describe('persisted Think identities above Number.MAX_SAFE_INTEGER', () => {
  let base: string; let project: string; let vault: string;
  beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'think-file-identity-')));
    project = join(base, 'project'); vault = join(base, 'vault');
    await mkdir(join(project, '.memory-loop'), { recursive: true, mode: 0o700 });
    await mkdir(vault);
  });
  afterEach(async () => { await rm(base, { recursive: true, force: true }); });

  async function registered() {
    const state = await openThinkState(project, vault);
    const owner = { owner: 'memory-loop' as const, conversationId, epoch, installationId: state.installationId };
    const receipt = { kind: 'create' as const, conversationId, clientCommandId: '22222222-2222-4222-8222-222222222222', epoch, state: 'registered' as const };
    state.registerConversation({ conversationId, nativeSessionId: `ses_memoryloop_${conversationId.replaceAll('-', '')}`, directory: vault, owner }, receipt, 1);
    return state;
  }
  const raw = <T>(read: (db: DatabaseSync) => T): T => {
    const db = new DatabaseSync(join(project, '.memory-loop', 'application.sqlite'));
    try { return read(db); } finally { db.close(); }
  };

  /** Real files behind the existing I/O seam, reported with large file IDs (exactly as NTFS can). */
  const large = (stat: BigIntStats): BigIntStats => Object.assign(Object.create(Object.getPrototypeOf(stat) as object) as BigIntStats, stat, { ino: stat.ino + largeId });
  const io: TranscriptIO = { ...transcriptIO,
    async lstat(path) { return large(await transcriptIO.lstat(path)); },
    async open(path, flags, mode) { const handle = await transcriptIO.open(path, flags, mode); return { ...handle, stat: async () => large(await handle.stat()) }; } };

  it('persists, reloads and verifies exact transcript identities, distinguishing IDs that doubles would merge', async () => {
    const text = '---\nmemory_loop_transcript: 1\n---\n';
    let state = await registered();
    try {
      const transcript = new RegisteredTranscript(state.transcripts, vault, conversationId, new TranscriptNamespace(vault, 'Conversations/Memory Loop', io), io);
      await transcript.append(bytes(text), 1, null, running);
      await transcript.close();
    } finally { state.close(); }

    const path = join(vault, 'Conversations', 'Memory Loop', `think-${conversationId}.md`);
    const file = await lstat(path, { bigint: true });
    const expectedIno = (file.ino + largeId).toString();
    expect(Number.isSafeInteger(Number(expectedIno))).toBe(false);
    const columns = raw(db => db.prepare('SELECT typeof(file_dev) AS devType, typeof(file_ino) AS inoType, file_ino AS ino, namespace_json AS namespace FROM transcripts').get());
    expect(columns).toMatchObject({ devType: 'text', inoType: 'text', ino: expectedIno });
    const namespace: unknown = JSON.parse(String(columns?.namespace));
    expect(Array.isArray(namespace) && namespace.every(node => typeof node.ino === 'string' && BigInt(node.ino) > BigInt(Number.MAX_SAFE_INTEGER))).toBe(true);

    state = await openThinkState(project, vault);
    try {
      const stored = state.transcripts.load(conversationId, vault);
      expect(stored?.file).toMatchObject({ dev: file.dev.toString(), ino: expectedIno, offset: Buffer.byteLength(text) });
      if (!stored?.file) throw new Error('missing exact checkpoint');
      // A neighbouring ID rounds to the same double; exact identity must still refuse it.
      const neighbour = (BigInt(expectedIno) + 1n).toString();
      const rounded = Number(BigInt(expectedIno)) === Number(BigInt(neighbour)) ? neighbour : (BigInt(expectedIno) - 1n).toString();
      expect(Number(rounded)).toBe(Number(expectedIno));
      await expect(removeMappedTranscript(vault, { ...stored, file: { ...stored.file, ino: rounded } }, () => null, running, io))
        .rejects.toMatchObject({ reason: 'conflict' });
      expect(await readFile(path, 'utf8')).toBe(text);
      await removeMappedTranscript(vault, stored, () => null, running, io);
      await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { state.close(); }
  });

  it('persists exact body-cache identities and rejects rounded or malformed writes', async () => {
    let state = await registered();
    const root = { dev: '18446744073709551615', ino: largeId.toString() };
    const directory = { dev: '7', ino: (largeId + 1n).toString() };
    try {
      state.cache.intent({ conversationId, epoch, path: join(base, 'cache'), root, directory: null });
      expect(() => state.cache.acquire(conversationId, epoch, { dev: '7', ino: Number(largeId + 1n) as unknown as string })).toThrow();
      expect(() => state.cache.acquire(conversationId, epoch, { dev: '7', ino: '01' })).toThrow();
      state.cache.acquire(conversationId, epoch, directory);
    } finally { state.close(); }
    expect(raw(db => db.prepare('SELECT typeof(root_ino) AS root, typeof(directory_ino) AS directory FROM body_namespaces').get()))
      .toEqual({ root: 'text', directory: 'text' });
    state = await openThinkState(project, vault);
    try { expect(state.cache.namespaces(conversationId)).toEqual([{ conversationId, epoch, path: join(base, 'cache'), root, directory }]); }
    finally { state.close(); }
  });

  it('migrates v10 INTEGER identities losslessly to exact TEXT', async () => {
    (await registered()).close();
    const name = `think-${conversationId}.md`;
    const legacyFingerprint = JSON.stringify([5, 9007199254740991, 0, 1.5, 1.5, 1, 0, 33188]);
    raw(db => {
      // Recreate the historical v10 column types holding valid (safe-integer) legacy values.
      db.exec(`ALTER TABLE transcripts DROP COLUMN file_dev; ALTER TABLE transcripts DROP COLUMN file_ino;
        ALTER TABLE transcripts ADD COLUMN file_dev INTEGER; ALTER TABLE transcripts ADD COLUMN file_ino INTEGER;
        DROP TABLE body_namespaces;
        CREATE TABLE body_namespaces (conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id), epoch TEXT NOT NULL,
          root_path TEXT NOT NULL, root_dev INTEGER NOT NULL, root_ino INTEGER NOT NULL, directory_dev INTEGER, directory_ino INTEGER,
          PRIMARY KEY(conversation_id, epoch));
        DROP TABLE ground_generation_publications;
        CREATE TABLE ground_generation_publications (attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES ground_generation_attempts(attempt_id),
          phase TEXT NOT NULL CHECK(phase IN ('validated', 'publishing', 'settled', 'conflict', 'rejected')),
          plan_json TEXT, output_text TEXT, output_sha256 TEXT, temp_dev INTEGER, temp_ino INTEGER,
          publish_attempted INTEGER NOT NULL DEFAULT 0 CHECK(publish_attempted IN (0, 1)),
          failure_code TEXT CHECK(failure_code IN ('invalid_output', 'unsafe_target', 'conflict')), finished_at INTEGER,
          CHECK((temp_dev IS NULL) = (temp_ino IS NULL)), CHECK(phase = 'rejected' OR plan_json IS NOT NULL));`);
      db.prepare(`INSERT INTO transcripts(conversation_id, note_id_json, created_at, namespace_json, creation_state,
        file_dev, file_ino, file_fingerprint, confirmed_offset, confirmed_sha256) VALUES (?, ?, 1, ?, 'owned', 5, 9007199254740991, ?, 0, ?)`)
        .run(conversationId, JSON.stringify(['Conversations', 'Memory Loop', name]),
          JSON.stringify([{ dev: 5, ino: 1 }, { dev: 5, ino: 2 }, { dev: 5, ino: 3 }]), legacyFingerprint, emptySha);
      db.prepare('INSERT INTO body_namespaces VALUES (?, ?, ?, 5, 9007199254740990, 5, 42)').run(conversationId, epoch, join(base, 'cache'));
      db.exec('PRAGMA user_version = 10');
    });
    const state = await openThinkState(project, vault);
    try {
      expect(raw(db => db.prepare('PRAGMA user_version').get())).toEqual({ user_version: 11 });
      expect(state.transcripts.load(conversationId, vault)).toMatchObject({
        namespace: [{ dev: '5', ino: '1' }, { dev: '5', ino: '2' }, { dev: '5', ino: '3' }],
        file: { dev: '5', ino: '9007199254740991', fingerprint: legacyFingerprint, offset: 0, sha256: emptySha } });
      expect(state.cache.namespaces(conversationId)).toEqual([{ conversationId, epoch, path: join(base, 'cache'),
        root: { dev: '5', ino: '9007199254740990' }, directory: { dev: '5', ino: '42' } }]);
      const types = raw(db => ['transcripts', 'body_namespaces', 'ground_generation_publications'].flatMap(table =>
        db.prepare(`SELECT name, type FROM pragma_table_info('${table}') WHERE name GLOB '*_dev' OR name GLOB '*_ino'`).all()));
      expect(types.map(column => column.type)).toEqual(Array(8).fill('TEXT'));
      expect(raw(db => db.prepare('SELECT typeof(file_ino) AS type, file_ino AS ino FROM transcripts').get())).toEqual({ type: 'text', ino: '9007199254740991' });
    } finally { state.close(); }
  });
});
