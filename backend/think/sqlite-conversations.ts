import { createHash } from 'node:crypto';
import type { SQLite } from './sqlite-state';
import { ThinkStateError, type CanonicalActivity, type ConversationStateStore, type RecentRegistration, type RegisteredConversation, type StoredView } from './state';

// Existing v3 tables/command order are deliberately not rebuilt. Resume is a read-only
// preparation intent, not a Send or a transcript event; cross-kind command IDs are checked
// inside the same admission transaction in SQLiteThinkState.
export const conversationSchemaV4 = `
  ALTER TABLE conversations ADD COLUMN purpose TEXT NOT NULL DEFAULT 'think' CHECK(purpose IN ('think', 'ground-generation'));
  ALTER TABLE conversations ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'live' CHECK(lifecycle_state IN ('live', 'deleting'));
  ALTER TABLE conversations ADD COLUMN row_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE conversations ADD COLUMN last_activity_at INTEGER;
  UPDATE conversations SET last_activity_at = (SELECT max(registered_at) FROM commands d
    WHERE d.conversation_id = conversations.conversation_id AND d.kind IN ('send', 'form-reply'));
  CREATE INDEX conversations_recent ON conversations(vault_directory, purpose, last_activity_at DESC, conversation_id);
  CREATE TABLE resume_commands (
    command_id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
    state TEXT NOT NULL CHECK(state IN ('registered', 'ready', 'upstream-unconfirmed', 'rejected')),
    registration_epoch TEXT NOT NULL, registered_at INTEGER NOT NULL, failure_code TEXT
  );
  CREATE TABLE view_leases (
    token_sha256 TEXT PRIMARY KEY NOT NULL, access_scope TEXT NOT NULL REFERENCES application_metadata(installation_id),
    conversation_id TEXT REFERENCES conversations(conversation_id), selection_revision INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX view_leases_selection ON view_leases(conversation_id, expires_at);
  CREATE TABLE canonical_activity (
    conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id), message_id TEXT NOT NULL,
    part_ordinal INTEGER NOT NULL, payload_sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL, source_at INTEGER NOT NULL,
    PRIMARY KEY(conversation_id, message_id, part_ordinal, payload_sha256, byte_length)
  );
`;
export function validateConversationSchema(db: SQLite): void {
  db.get('SELECT purpose, lifecycle_state, row_version, last_activity_at FROM conversations LIMIT 0');
  db.get('SELECT command_id, conversation_id, state, registration_epoch, registered_at, failure_code FROM resume_commands LIMIT 0');
  db.get('SELECT token_sha256, access_scope, conversation_id, selection_revision, expires_at FROM view_leases LIMIT 0');
  db.get('SELECT conversation_id, message_id, part_ordinal, payload_sha256, byte_length, source_at FROM canonical_activity LIMIT 0');
  if (db.get('SELECT 1 FROM commands d JOIN resume_commands r ON r.command_id = d.command_id LIMIT 1') ||
      db.get('PRAGMA foreign_key_check(resume_commands)') || db.get('PRAGMA foreign_key_check(view_leases)') || db.get('PRAGMA foreign_key_check(canonical_activity)')) fail();
}
function fail(code: ThinkStateError['code'] = 'unavailable'): never { throw new ThinkStateError(code); }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(); }
function time(value: unknown): number { const at = count(value); return at <= 8640000000000000 ? at : fail(); }
const hash = /^[a-f0-9]{64}$/;
const ttl = 120000;
type Write = <T>(operation: 'view-register' | 'selection' | 'activity', action: () => T) => T;

/** One installation's private recent facts and view leases, never browser-supplied user/device identities. */
export class SQLiteConversations implements ConversationStateStore {
  constructor(private readonly db: SQLite, private readonly check: () => void, private readonly write: Write,
    private readonly installationId: string, private readonly decodeOwner: (row: Record<string, unknown>) => RegisteredConversation) {}

  private read<T>(action: () => T): T {
    try { this.check(); return action(); }
    catch (error) { if (error instanceof ThinkStateError) throw error; return fail(); }
  }
  /** Inside an existing transaction: no filesystem/native calls. Shared by admission and selection. */
  requireLive(conversationId: string, directory?: string): RegisteredConversation {
    const row = this.db.get('SELECT * FROM conversations WHERE conversation_id = ?', conversationId);
    if (!row || row.purpose !== 'think' || directory !== undefined && row.vault_directory !== directory) fail('not_found');
    if (row.lifecycle_state !== 'live') fail('selection_conflict');
    return this.decodeOwner(row);
  }
  recent(directory: string): RecentRegistration[] {
    return this.read(() => this.db.all(`SELECT c.* FROM conversations c WHERE c.vault_directory = ? AND c.purpose = 'think'
      AND EXISTS(SELECT 1 FROM commands d WHERE d.conversation_id = c.conversation_id AND d.kind = 'send')
      ORDER BY c.last_activity_at DESC, c.conversation_id ASC LIMIT 10`, directory).map(row => {
      const conversationId = row.conversation_id;
      if (typeof conversationId !== 'string' || !/^[0-9a-f-]{36}$/.test(conversationId)) fail();
      const result: RecentRegistration = { conversationId, title: null, lastActivityAt: time(row.last_activity_at),
        rowVersion: count(row.row_version), lifecycle: row.lifecycle_state === 'live' ? 'live' : row.lifecycle_state === 'deleting' ? 'deleting' : fail(), owner: null,
        uncertain: !!this.db.get(`SELECT 1 FROM commands WHERE conversation_id = ? AND
          (kind = 'send' AND state NOT IN ('completed', 'failed', 'interrupted', 'cancelled-before-delivery', 'rejected')
          OR kind = 'form-reply' AND state IN ('registered', 'upstream-unconfirmed')) LIMIT 1`, conversationId) };
      // A bad individual owner/original is local unavailability, not permission to use native prepared text.
      const first = this.db.get(`SELECT d.original_input, d.payload_sha256 FROM commands d JOIN command_order o
        ON o.command_id = d.command_id AND o.conversation_id = d.conversation_id
        WHERE d.conversation_id = ? AND d.kind = 'send' ORDER BY o.registration_sequence LIMIT 1`, conversationId);
      try {
        result.owner = this.decodeOwner(row);
        if (!first || !(first.original_input instanceof Uint8Array) || first.original_input.length > 1024 * 1024 ||
            createHash('sha256').update(first.original_input).digest('hex') !== first.payload_sha256) fail();
        const original = new TextDecoder('utf-8', { fatal: true }).decode(first.original_input);
        const line = original.split(/\r\n|\r|\n/u).map(value => value.trim().replace(/\s+/gu, ' ')).find(Boolean);
        result.title = line ? [...line].slice(0, 120).join('') : null;
      } catch { result.owner = null; }
      return result;
    }));
  }
  canonical(conversationId: string, facts: readonly CanonicalActivity[]): void {
    if (!facts.length) return;
    const seen = (fact: CanonicalActivity) => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(fact.messageId) || !hash.test(fact.sha256)) fail();
      count(fact.ordinal); count(fact.length); time(fact.at);
      return !!this.db.get(`SELECT 1 FROM canonical_activity WHERE conversation_id = ? AND message_id = ?
        AND part_ordinal = ? AND payload_sha256 = ? AND byte_length = ?`, conversationId, fact.messageId, fact.ordinal, fact.sha256, fact.length);
    };
    // Reobserving old history needs no write transaction. New facts commit in short batches;
    // a partial failure is safe to retry because each immutable fact has its own exact identity.
    const pending = this.read(() => facts.filter(fact => !seen(fact)));
    for (let start = 0; start < pending.length; start += 50) this.write('activity', () => {
      this.requireLive(conversationId);
      for (const fact of pending.slice(start, start + 50)) {
        if (seen(fact)) continue;
        this.db.run('INSERT INTO canonical_activity VALUES (?, ?, ?, ?, ?, ?)', conversationId, fact.messageId, fact.ordinal, fact.sha256, fact.length, fact.at);
        this.db.run(`UPDATE conversations SET last_activity_at = max(coalesce(last_activity_at, 0), ?), row_version = row_version + 1
          WHERE conversation_id = ?`, fact.at, conversationId);
      }
    });
  }
  private lookup(tokenHash: string, now: number): StoredView | null {
    if (!hash.test(tokenHash)) fail('lease_unavailable'); time(now);
    const row = this.db.get('SELECT * FROM view_leases WHERE token_sha256 = ? AND access_scope = ? AND expires_at > ?', tokenHash, this.installationId, now);
    if (!row) return null;
    if (row.conversation_id !== null && typeof row.conversation_id !== 'string') fail();
    return { conversationId: row.conversation_id, selectionRevision: count(row.selection_revision), expiresAt: time(row.expires_at) };
  }
  mintView(tokenHash: string, now: number): StoredView {
    if (!hash.test(tokenHash)) fail(); time(now); time(now + ttl);
    return this.write('view-register', () => {
      this.db.run(`DELETE FROM view_leases WHERE token_sha256 IN
        (SELECT token_sha256 FROM view_leases WHERE expires_at <= ? ORDER BY expires_at LIMIT 32)`, now);
      this.db.run('INSERT INTO view_leases(token_sha256, access_scope, expires_at) VALUES (?, ?, ?)', tokenHash, this.installationId, now + ttl);
      return { selectionRevision: 0, conversationId: null, expiresAt: now + ttl };
    });
  }
  view(tokenHash: string, now: number): StoredView | null { return this.read(() => this.lookup(tokenHash, now)); }
  select(tokenHash: string, revision: number, conversationId: string | null, now: number, directory: string): StoredView {
    count(revision); time(now); time(now + ttl);
    return this.write('selection', () => {
      const previous = this.lookup(tokenHash, now);
      if (!previous) fail('lease_unavailable');
      if (previous.selectionRevision !== revision) fail('selection_conflict');
      if (conversationId !== null) this.requireLive(conversationId, directory);
      const selectionRevision = revision + (conversationId === previous.conversationId ? 0 : 1); count(selectionRevision);
      this.db.run('UPDATE view_leases SET conversation_id = ?, selection_revision = ?, expires_at = ? WHERE token_sha256 = ? AND access_scope = ?',
        conversationId, selectionRevision, now + ttl, tokenHash, this.installationId);
      // Renewals/clears also invalidate a deletion precheck that observed the old protection.
      for (const target of new Set([conversationId, previous.conversationId])) if (target !== null) {
        this.db.run('UPDATE conversations SET row_version = row_version + 1 WHERE conversation_id = ?', target);
      }
      return { conversationId, selectionRevision, expiresAt: now + ttl };
    });
  }
  protection(conversationId: string, tokenHash: string | null, now: number): 'current' | 'selected_elsewhere' | undefined {
    return this.read(() => {
      const own = tokenHash ? this.lookup(tokenHash, now) : null;
      if (own?.conversationId === conversationId) return 'current';
      return this.db.get('SELECT 1 FROM view_leases WHERE access_scope = ? AND conversation_id = ? AND expires_at > ? LIMIT 1',
        this.installationId, conversationId, now) ? 'selected_elsewhere' : undefined;
    });
  }
}
