import type { DeleteReceipt } from './contract';
import { ThinkStateError, type BodyCacheStateStore, type DeletionStateStore, type RegisteredConversation, type StoredDeletion } from './state';
import type { SQLite } from './sqlite-state';
import { isAbsolute } from 'node:path';

/** Additive to v4: no original, command sequence, checkpoint or lease is rebuilt. */
export const deletionSchemaV5 = `
  CREATE TABLE deletions (
    command_id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL UNIQUE,
    registration_epoch TEXT NOT NULL, registered_at INTEGER NOT NULL, fencing_version INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('accepted', 'pending', 'completed')),
    reason TEXT CHECK(reason IN ('io_unavailable', 'conflict', 'status_unknown')),
    native_attempted INTEGER NOT NULL DEFAULT 0 CHECK(native_attempted IN (0, 1)),
    native_removed INTEGER NOT NULL DEFAULT 0 CHECK(native_removed IN (0, 1)),
    transcript_removed INTEGER NOT NULL DEFAULT 0 CHECK(transcript_removed IN (0, 1))
  );
  CREATE TABLE command_tombstones (command_id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL);
  CREATE TABLE conversation_tombstones (conversation_id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE body_namespaces (
    conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id), epoch TEXT NOT NULL,
    root_path TEXT NOT NULL, root_dev INTEGER NOT NULL, root_ino INTEGER NOT NULL,
    directory_dev INTEGER, directory_ino INTEGER,
    PRIMARY KEY(conversation_id, epoch)
  );
`;
export function validateDeletionSchema(db: SQLite): void {
  db.get('SELECT command_id, conversation_id, registration_epoch, registered_at, fencing_version, state, reason, native_attempted, native_removed, transcript_removed FROM deletions LIMIT 0');
  db.get('SELECT command_id, conversation_id FROM command_tombstones LIMIT 0');
  db.get('SELECT conversation_id FROM conversation_tombstones LIMIT 0');
  db.get('SELECT conversation_id, epoch, root_path, root_dev, root_ino, directory_dev, directory_ino FROM body_namespaces LIMIT 0');
  if (db.get('PRAGMA foreign_key_check(body_namespaces)')) fail();
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(code: ThinkStateError['code'] = 'unavailable'): never { throw new ThinkStateError(code); }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(); }
function id(value: unknown): string { return typeof value === 'string' && uuid.test(value) ? value : fail(); }
function bit(value: unknown): boolean { return value === 0 ? false : value === 1 ? true : fail(); }
type Row = Record<string, unknown>;
function decode(row: Row): StoredDeletion {
  const state = row.state;
  const reason = row.reason;
  if (state !== 'accepted' && state !== 'pending' && state !== 'completed' ||
      reason !== null && reason !== 'io_unavailable' && reason !== 'conflict' && reason !== 'status_unknown') fail();
  return { receipt: { kind: 'delete', clientCommandId: id(row.command_id), conversationId: id(row.conversation_id),
    epoch: id(row.registration_epoch), state, ...(reason ? { reason } : {}) }, registeredAt: count(row.registered_at),
    fence: count(row.fencing_version), nativeAttempted: bit(row.native_attempted), nativeRemoved: bit(row.native_removed), transcriptRemoved: bit(row.transcript_removed) };
}

export class SQLiteDeletions implements DeletionStateStore {
  readonly cache: BodyCacheStateStore;
  constructor(private readonly db: SQLite, private readonly check: () => void,
    private readonly write: <T>(action: () => T) => T,
    private readonly cacheWrite: <T>(action: () => T) => T,
    private readonly owner: (id: string) => RegisteredConversation | null,
    private readonly hasCommand: (id: string) => boolean, private readonly installationId: string) {
    this.cache = {
      intent: namespace => this.cacheWrite(() => {
        const owner = this.live(namespace.conversationId);
        if (!uuid.test(namespace.epoch) || !isAbsolute(namespace.path) || namespace.path.includes('\0') || namespace.directory !== null || !owner) fail();
        count(namespace.root.dev); count(namespace.root.ino);
        this.db.run('INSERT INTO body_namespaces VALUES (?, ?, ?, ?, ?, NULL, NULL)', namespace.conversationId, namespace.epoch, namespace.path, namespace.root.dev, namespace.root.ino);
      }),
      acquire: (conversationId, epoch, identity) => this.cacheWrite(() => {
        this.live(conversationId); count(identity.dev); count(identity.ino);
        const row = this.db.get('SELECT directory_dev FROM body_namespaces WHERE conversation_id = ? AND epoch = ?', conversationId, epoch);
        if (!row || row.directory_dev !== null) fail('conflict');
        this.db.run('UPDATE body_namespaces SET directory_dev = ?, directory_ino = ? WHERE conversation_id = ? AND epoch = ?', identity.dev, identity.ino, conversationId, epoch);
      }),
      namespaces: (conversationId, afterEpoch = '') => this.read(() => this.db.all('SELECT * FROM body_namespaces WHERE conversation_id = ? AND epoch > ? ORDER BY epoch LIMIT 32', conversationId, afterEpoch).map(row => {
        const path = row.root_path;
        if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) fail();
        return { conversationId: id(row.conversation_id), epoch: id(row.epoch), path,
          root: { dev: count(row.root_dev), ino: count(row.root_ino) },
          directory: row.directory_dev === null && row.directory_ino === null ? null : { dev: count(row.directory_dev), ino: count(row.directory_ino) } };
      })),
      removed: (conversationId, epoch) => this.cacheWrite(() => { this.db.run('DELETE FROM body_namespaces WHERE conversation_id = ? AND epoch = ?', conversationId, epoch); }),
    };
  }
  private read<T>(action: () => T): T {
    try { this.check(); return action(); } catch (error) { if (error instanceof ThinkStateError) throw error; return fail(); }
  }
  private live(conversationId: string, directory?: string): RegisteredConversation {
    const owner = this.owner(conversationId);
    if (!owner || owner.purpose !== 'think' || directory !== undefined && owner.directory !== directory) fail('not_found');
    if (owner.lifecycle !== 'live') fail('selection_conflict');
    return owner;
  }
  get(commandId: string): StoredDeletion | null {
    return this.read(() => { const row = this.db.get('SELECT * FROM deletions WHERE command_id = ?', commandId); return row ? decode(row) : null; });
  }
  pending(directory: string, after = ''): StoredDeletion[] {
    return this.read(() => this.db.all(`SELECT d.* FROM deletions d JOIN conversations c ON c.conversation_id = d.conversation_id
      WHERE c.vault_directory = ? AND d.state != 'completed' AND d.command_id > ? ORDER BY d.command_id LIMIT 32`, directory, after).map(decode));
  }
  blocked(conversationId: string): boolean {
    return this.read(() => !!(this.db.get('SELECT 1 FROM deletions WHERE conversation_id = ?', conversationId) ||
      this.db.get('SELECT 1 FROM conversation_tombstones WHERE conversation_id = ?', conversationId)));
  }
  accept(receipt: DeleteReceipt, tokenHash: string, revision: number, rowVersion: number, directory: string, now: number): StoredDeletion {
    return this.write(() => {
      id(receipt.clientCommandId); id(receipt.conversationId); id(receipt.epoch); count(now); count(rowVersion); count(revision);
      if (receipt.state !== 'accepted' || this.hasCommand(receipt.clientCommandId)) fail('conflict');
      const view = this.db.get('SELECT * FROM view_leases WHERE token_sha256 = ? AND access_scope = ? AND expires_at > ?', tokenHash, this.installationId, now);
      if (!view) fail('lease_unavailable');
      if (view.selection_revision !== revision) fail('selection_conflict');
      const owner = this.live(receipt.conversationId, directory);
      if (view.conversation_id === receipt.conversationId) throw new ThinkStateError('delete_blocked', 'current');
      if (this.db.get('SELECT 1 FROM view_leases WHERE access_scope = ? AND conversation_id = ? AND expires_at > ? LIMIT 1', this.installationId, receipt.conversationId, now)) throw new ThinkStateError('delete_blocked', 'selected_elsewhere');
      if (owner.rowVersion !== rowVersion) fail('selection_conflict');
      if (owner.creation !== 'ready' || this.db.get(`SELECT 1 FROM commands WHERE conversation_id = ? AND
        (kind = 'send' AND state NOT IN ('completed', 'failed', 'interrupted', 'cancelled-before-delivery', 'rejected')
        OR kind = 'form-reply' AND state IN ('registered', 'upstream-unconfirmed')) LIMIT 1`, receipt.conversationId)) throw new ThinkStateError('delete_blocked', 'status_unknown');
      this.db.run("UPDATE conversations SET lifecycle_state = 'deleting', row_version = row_version + 1 WHERE conversation_id = ?", receipt.conversationId);
      this.db.run(`INSERT INTO deletions(command_id, conversation_id, registration_epoch, registered_at, fencing_version, state)
        VALUES (?, ?, ?, ?, ?, 'accepted')`, receipt.clientCommandId, receipt.conversationId, receipt.epoch, now, rowVersion + 1);
      return this.get(receipt.clientCommandId) ?? fail();
    });
  }
  private required(commandId: string): StoredDeletion {
    const record = this.get(commandId);
    if (!record || record.receipt.state === 'completed') fail('conflict');
    const owner = this.owner(record.receipt.conversationId);
    if (!owner || owner.lifecycle !== 'deleting' || owner.rowVersion !== record.fence) fail('conflict');
    return record;
  }
  attempted(commandId: string): void { this.write(() => {
    const record = this.required(commandId);
    if (record.nativeAttempted) fail('conflict');
    this.db.run("UPDATE deletions SET native_attempted = 1, state = 'pending', reason = NULL WHERE command_id = ?", commandId);
  }); }
  progress(commandId: string, effect: 'native' | 'transcript'): void { this.write(() => {
    const record = this.required(commandId);
    if (effect === 'transcript' && !record.nativeRemoved) fail('conflict');
    this.db.run(effect === 'native' ? "UPDATE deletions SET native_removed = 1, state = 'pending', reason = NULL WHERE command_id = ?"
      : "UPDATE deletions SET transcript_removed = 1, state = 'pending', reason = NULL WHERE command_id = ?", commandId);
  }); }
  pendingReason(commandId: string, reason: NonNullable<DeleteReceipt['reason']>): void { this.write(() => {
    this.required(commandId);
    this.db.run("UPDATE deletions SET state = 'pending', reason = ? WHERE command_id = ?", reason, commandId);
  }); }
  complete(commandId: string): void { this.write(() => {
    const record = this.required(commandId); const target = record.receipt.conversationId;
    if (!record.nativeRemoved || !record.transcriptRemoved || this.db.get('SELECT 1 FROM body_namespaces WHERE conversation_id = ? LIMIT 1', target)) fail('conflict');
    this.db.run('INSERT INTO command_tombstones SELECT command_id, conversation_id FROM commands WHERE conversation_id = ?', target);
    this.db.run('INSERT INTO command_tombstones SELECT command_id, conversation_id FROM resume_commands WHERE conversation_id = ?', target);
    for (const table of ['transcript_pending_chunks', 'transcript_entries', 'transcripts', 'canonical_activity', 'command_order', 'resume_commands', 'commands', 'view_leases']) {
      this.db.run(`DELETE FROM ${table} WHERE conversation_id = ?`, target);
    }
    this.db.run('INSERT INTO conversation_tombstones VALUES (?)', target);
    this.db.run('DELETE FROM conversations WHERE conversation_id = ?', target);
    this.db.run("UPDATE deletions SET state = 'completed', reason = NULL WHERE command_id = ?", commandId);
  }); }
}
