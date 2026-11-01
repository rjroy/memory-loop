import { ThinkStateError, type ConfirmedTranscriptEntry, type StoredTranscript, type StoredTranscriptEntry, type TranscriptAppendIdentity,
  type TranscriptDirectoryIdentity, type TranscriptFileCheckpoint, type TranscriptStateStore } from './state';
import type { SQLite } from './sqlite-state';
import { createHash } from 'node:crypto';

const emptySha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const sha = /^[a-f0-9]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Row = Record<string, unknown>;
function fail(code: 'conflict' | 'unavailable' = 'unavailable'): never { throw new ThinkStateError(code); }
function text(row: Row, name: string): string { const value = row[name]; return typeof value === 'string' ? value : fail(); }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(); }
function hash(value: unknown): string { return typeof value === 'string' && sha.test(value) ? value : fail(); }
function object(value: unknown): value is Row { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function identity(row: Row): StoredTranscriptEntry {
  return { id: text(row, 'entry_id'), semantic: text(row, 'semantic'), sourceIdentity: text(row, 'source_identity') };
}

export const transcriptSchemaV2 = `
  CREATE TABLE transcripts (
    conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversations(conversation_id),
    note_id_json TEXT NOT NULL, created_at INTEGER NOT NULL, namespace_json TEXT NOT NULL,
    creation_state TEXT NOT NULL CHECK(creation_state IN ('intent', 'owned')),
    file_dev INTEGER, file_ino INTEGER, file_fingerprint TEXT,
    confirmed_offset INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_offset >= 0), confirmed_sha256 TEXT NOT NULL,
    pending_entry_id TEXT, pending_semantic TEXT, pending_source_identity TEXT, pending_header INTEGER,
    pending_length INTEGER, pending_sha256 TEXT, pending_state TEXT CHECK(pending_state IN ('preparing', 'ready')),
    staged_length INTEGER NOT NULL DEFAULT 0, staged_chunks INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE transcript_entries (
    conversation_id TEXT NOT NULL REFERENCES transcripts(conversation_id), entry_id TEXT NOT NULL,
    semantic TEXT NOT NULL, source_identity TEXT NOT NULL, serialized_sha256 TEXT NOT NULL, end_offset INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, entry_id)
  );
  CREATE INDEX transcript_entries_semantic ON transcript_entries(conversation_id, semantic, end_offset);
  CREATE TABLE transcript_pending_chunks (
    conversation_id TEXT NOT NULL REFERENCES transcripts(conversation_id), chunk_index INTEGER NOT NULL CHECK(chunk_index >= 0),
    bytes BLOB NOT NULL CHECK(typeof(bytes) = 'blob' AND length(bytes) BETWEEN 1 AND 65536),
    PRIMARY KEY(conversation_id, chunk_index)
  );
`;
export function validateTranscriptSchema(db: SQLite): void {
  db.get(`SELECT t.conversation_id, t.note_id_json, t.created_at, t.namespace_json, t.creation_state,
    t.file_dev, t.file_ino, t.file_fingerprint, t.confirmed_offset, t.confirmed_sha256,
    t.pending_entry_id, t.pending_semantic, t.pending_source_identity, t.pending_header, t.pending_length,
    t.pending_sha256, t.pending_state, t.staged_length, t.staged_chunks,
    e.entry_id, e.semantic, e.source_identity, e.serialized_sha256, e.end_offset, p.chunk_index, p.bytes
    FROM transcripts t LEFT JOIN transcript_entries e ON e.conversation_id = t.conversation_id
    LEFT JOIN transcript_pending_chunks p ON p.conversation_id = t.conversation_id LIMIT 0`);
}

/** The existing database/short-transaction boundary, not an independent journal or history mirror. */
export class SQLiteTranscriptState implements TranscriptStateStore {
  constructor(private readonly db: SQLite, private readonly check: () => void,
    private readonly write: <T>(operation: () => T) => T, private readonly installationId: string) {}

  private read<T>(operation: () => T): T {
    try { this.check(); return operation(); }
    catch (error) { if (error instanceof ThinkStateError) throw error; return fail(); }
  }
  private owner(conversationId: string, vault?: string, writing = false): void {
    const row = this.db.get('SELECT native_session_id, vault_directory, owner_marker_json, creation_epoch, lifecycle_state FROM conversations WHERE conversation_id = ?', conversationId);
    if (!row || !uuid.test(conversationId) || (vault !== undefined && row.vault_directory !== vault) ||
        row.native_session_id !== `ses_memoryloop_${conversationId.replaceAll('-', '')}` || writing && row.lifecycle_state !== 'live') fail('conflict');
    const marker: unknown = JSON.parse(text(row, 'owner_marker_json'));
    if (!object(marker) || marker.owner !== 'memory-loop' || marker.conversationId !== conversationId ||
        marker.installationId !== this.installationId || marker.epoch !== row.creation_epoch) fail('conflict');
  }
  private required(conversationId: string): Row {
    this.owner(conversationId, undefined, true);
    return this.db.get('SELECT * FROM transcripts WHERE conversation_id = ?', conversationId) ?? fail('conflict');
  }
  load(conversationId: string, vaultDirectory: string): StoredTranscript | null {
    return this.read(() => {
      this.owner(conversationId, vaultDirectory);
      const row = this.db.get('SELECT * FROM transcripts WHERE conversation_id = ?', conversationId);
      if (!row) return null;
      const noteId: unknown = JSON.parse(text(row, 'note_id_json'));
      const namespace: unknown = JSON.parse(text(row, 'namespace_json'));
      if (!Array.isArray(noteId) || noteId.length < 2 || noteId.some(part => typeof part !== 'string' || !part || part.startsWith('.') || /[/\\\0]/.test(part)) ||
          noteId.at(-1) !== `think-${conversationId}.md` || !Array.isArray(namespace) || namespace.length !== noteId.length ||
          namespace.some(node => !object(node) || count(node.dev) !== node.dev || count(node.ino) !== node.ino)) fail();
      const offset = count(row.confirmed_offset);
      const digest = hash(row.confirmed_sha256);
      if (row.creation_state !== 'intent' && row.creation_state !== 'owned') fail();
      if (row.creation_state === 'intent' && (offset !== 0 || digest !== emptySha || row.file_dev !== null || row.file_ino !== null || row.file_fingerprint !== null)) fail();
      const pendingId = row.pending_entry_id;
      let pending: StoredTranscript['pending'] = null;
      if (pendingId !== null) {
        if (typeof pendingId !== 'string' || !['preparing', 'ready'].includes(text(row, 'pending_state')) || ![0, 1].includes(count(row.pending_header))) fail();
        pending = { id: pendingId, semantic: text(row, 'pending_semantic'), sourceIdentity: text(row, 'pending_source_identity'),
          header: row.pending_header === 1, length: count(row.pending_length), chunks: count(row.staged_chunks),
          state: row.pending_state === 'ready' ? 'ready' : 'preparing', sha256: row.pending_sha256 === null ? null : hash(row.pending_sha256) };
        if (pending.state === 'ready' && (!pending.sha256 || count(row.staged_length) !== pending.length)) fail();
      } else if (row.pending_state !== null || count(row.staged_chunks) || count(row.staged_length)) fail();
      return { conversationId, noteId: noteId as string[], namespace: namespace as TranscriptDirectoryIdentity[], createdAt: count(row.created_at),
        file: row.creation_state === 'owned' ? { dev: count(row.file_dev), ino: count(row.file_ino), fingerprint: text(row, 'file_fingerprint'), offset, sha256: digest } : null,
        pending };
    });
  }
  pending(vaultDirectory: string, after = ''): string[] {
    return this.read(() => {
      const ids: string[] = [];
      let cursor = after;
      for (let index = 0; index < 100; index++) {
        const row = this.db.get(`SELECT t.conversation_id FROM transcripts t JOIN conversations c ON c.conversation_id = t.conversation_id
          WHERE c.vault_directory = ? AND c.lifecycle_state = 'live' AND t.pending_entry_id IS NOT NULL AND t.conversation_id > ? ORDER BY t.conversation_id LIMIT 1`, vaultDirectory, cursor);
        if (!row) break;
        cursor = text(row, 'conversation_id'); this.owner(cursor, vaultDirectory); ids.push(cursor);
      }
      return ids;
    });
  }
  intent(conversationId: string, vaultDirectory: string, noteId: string[], createdAt: number, namespace: TranscriptDirectoryIdentity[]): void {
    this.write(() => {
      this.owner(conversationId, vaultDirectory, true); count(createdAt);
      if (noteId.at(-1) !== `think-${conversationId}.md` || namespace.length !== noteId.length || noteId.length < 2 ||
          noteId.some(part => !part || part.startsWith('.') || /[/\\\0]/.test(part))) fail();
      for (const node of namespace) { count(node.dev); count(node.ino); }
      if (this.db.get('SELECT 1 FROM transcripts WHERE conversation_id = ?', conversationId)) fail('conflict');
      this.db.run(`INSERT INTO transcripts(conversation_id, note_id_json, created_at, namespace_json, creation_state, confirmed_sha256)
        VALUES (?, ?, ?, ?, 'intent', ?)`, conversationId, JSON.stringify(noteId), createdAt, JSON.stringify(namespace), emptySha);
    });
  }
  acquire(conversationId: string, file: TranscriptFileCheckpoint): void {
    this.write(() => {
      const row = this.required(conversationId);
      if (row.creation_state !== 'intent' || file.offset !== 0 || file.sha256 !== emptySha) fail('conflict');
      count(file.dev); count(file.ino);
      this.db.run("UPDATE transcripts SET creation_state = 'owned', file_dev = ?, file_ino = ?, file_fingerprint = ? WHERE conversation_id = ?",
        file.dev, file.ino, file.fingerprint, conversationId);
    });
  }
  entry(conversationId: string, entryId: string): StoredTranscriptEntry | null {
    return this.read(() => { this.owner(conversationId); const row = this.db.get('SELECT * FROM transcript_entries WHERE conversation_id = ? AND entry_id = ?', conversationId, entryId); return row ? identity(row) : null; });
  }
  latest(conversationId: string, semantic: string): StoredTranscriptEntry | null {
    return this.read(() => { this.owner(conversationId); const row = this.db.get('SELECT * FROM transcript_entries WHERE conversation_id = ? AND semantic = ? ORDER BY end_offset DESC LIMIT 1', conversationId, semantic); return row ? identity(row) : null; });
  }
  confirmed(conversationId: string, afterEntryId = ''): ConfirmedTranscriptEntry[] {
    return this.read(() => {
      this.owner(conversationId);
      return this.db.all(`SELECT entry_id, semantic, source_identity, end_offset FROM transcript_entries
        WHERE conversation_id = ? AND entry_id > ? ORDER BY entry_id LIMIT 50`, conversationId, afterEntryId)
        .map(row => ({ ...identity(row), endOffset: count(row.end_offset) }));
    });
  }
  begin(conversationId: string, append: TranscriptAppendIdentity): void {
    this.write(() => {
      const row = this.required(conversationId); count(append.length);
      if (!append.id || !append.semantic || !sha.test(append.sourceIdentity) || append.length === 0 ||
          this.db.get('SELECT 1 FROM transcript_entries WHERE conversation_id = ? AND entry_id = ?', conversationId, append.id)) fail('conflict');
      if (append.header !== (count(row.confirmed_offset) === 0)) fail('conflict');
      if (append.id.startsWith('user:') || append.id.startsWith('form-reply:')) {
        const original = append.original;
        if (!original || append.id !== `${original.kind === 'send' ? 'user' : 'form-reply'}:${original.commandId}`) fail('conflict');
        const command = this.db.get('SELECT kind, conversation_id, original_input FROM commands WHERE command_id = ?', original.commandId);
        if (!command || command.conversation_id !== conversationId || command.kind !== original.kind || !(command.original_input instanceof Uint8Array) ||
            command.original_input.length !== original.length || createHash('sha256').update(command.original_input).digest('hex') !== original.sha256) fail('conflict');
      }
      if (row.pending_entry_id !== null && (row.pending_state !== 'preparing' || row.pending_entry_id !== append.id || row.pending_source_identity !== append.sourceIdentity)) fail('conflict');
      this.db.run('DELETE FROM transcript_pending_chunks WHERE conversation_id = ?', conversationId);
      this.db.run(`UPDATE transcripts SET pending_entry_id = ?, pending_semantic = ?, pending_source_identity = ?, pending_header = ?,
        pending_length = ?, pending_sha256 = NULL, pending_state = 'preparing', staged_length = 0, staged_chunks = 0 WHERE conversation_id = ?`,
      append.id, append.semantic, append.sourceIdentity, append.header ? 1 : 0, append.length, conversationId);
    });
  }
  chunk(conversationId: string, index: number): Uint8Array | null {
    return this.read(() => {
      count(index); this.owner(conversationId);
      const row = this.db.get('SELECT bytes FROM transcript_pending_chunks WHERE conversation_id = ? AND chunk_index = ?', conversationId, index);
      if (!row) return null;
      if (!(row.bytes instanceof Uint8Array) || !row.bytes.length || row.bytes.length > 65536) fail();
      return new Uint8Array(row.bytes);
    });
  }
  stage(conversationId: string, index: number, bytes: Uint8Array): void {
    this.write(() => {
      const row = this.required(conversationId);
      if (row.pending_state !== 'preparing' || index !== count(row.staged_chunks) || !bytes.length || bytes.length > 65536 ||
          count(row.staged_length) + bytes.length > count(row.pending_length)) fail('conflict');
      this.db.run('INSERT INTO transcript_pending_chunks VALUES (?, ?, ?)', conversationId, index, bytes);
      this.db.run('UPDATE transcripts SET staged_length = staged_length + ?, staged_chunks = staged_chunks + 1 WHERE conversation_id = ?', bytes.length, conversationId);
    });
  }
  seal(conversationId: string, digest: string): void {
    this.write(() => {
      const row = this.required(conversationId);
      if (row.pending_state !== 'preparing' || !sha.test(digest) || count(row.staged_length) !== count(row.pending_length)) fail('conflict');
      this.db.run("UPDATE transcripts SET pending_sha256 = ?, pending_state = 'ready' WHERE conversation_id = ?", digest, conversationId);
    });
  }
  confirm(conversationId: string, entryId: string, file: TranscriptFileCheckpoint): void {
    this.write(() => {
      const row = this.required(conversationId);
      if (row.pending_state !== 'ready' || row.pending_entry_id !== entryId || row.creation_state !== 'owned' ||
          file.dev !== row.file_dev || file.ino !== row.file_ino || count(file.offset) !== count(row.confirmed_offset) + count(row.pending_length) || !sha.test(file.sha256)) fail('conflict');
      if (row.pending_header !== 1) this.db.run(`INSERT INTO transcript_entries(conversation_id, entry_id, semantic, source_identity, serialized_sha256, end_offset)
        VALUES (?, ?, ?, ?, ?, ?)`, conversationId, entryId, text(row, 'pending_semantic'), text(row, 'pending_source_identity'), hash(row.pending_sha256), file.offset);
      this.db.run(`UPDATE transcripts SET confirmed_offset = ?, confirmed_sha256 = ?, file_fingerprint = ?,
        pending_entry_id = NULL, pending_semantic = NULL, pending_source_identity = NULL, pending_header = NULL,
        pending_length = NULL, pending_sha256 = NULL, pending_state = NULL, staged_length = 0, staged_chunks = 0 WHERE conversation_id = ?`,
      file.offset, file.sha256, file.fingerprint, conversationId);
      this.db.run('DELETE FROM transcript_pending_chunks WHERE conversation_id = ?', conversationId);
    });
  }
}
