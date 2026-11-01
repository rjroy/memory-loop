import { createHash, randomUUID } from 'node:crypto';
import type { CommandReceipt, CreateReceipt, CreateFailureCode, FormReplyReceipt, SendReceipt, StopReceipt } from './contract';
import { ThinkStateError, type OwnedConversation, type StoredCommand, type ThinkStateStore, type TranscriptStateStore } from './state';
import { ThinkStateFile } from './state-file';
import type { NativeSession } from './native';
import { SQLiteTranscriptState, transcriptSchemaV2, validateTranscriptSchema } from './sqlite-transcript-state';

type Parameter = string | number | Uint8Array | null;
type Row = Record<string, unknown>;
export interface SQLite {
  exec(sql: string): void;
  get(sql: string, ...parameters: Parameter[]): Row | null;
  run(sql: string, ...parameters: Parameter[]): void;
  close(): void;
}

/** Bun is the daemon engine. Node's built-in engine supports the existing in-process API harness. */
async function connect(path: string): Promise<SQLite> {
  if (process.versions.bun) {
    const { Database } = await import('bun:sqlite');
    const db = new Database(path, { readwrite: true, create: false });
    return { exec: sql => { db.run(sql); }, get: (sql, ...parameters) => db.query<Row, Parameter[]>(sql).get(...parameters),
      run: (sql, ...parameters) => { db.query(sql).run(...parameters); }, close: () => db.close() };
  }
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path);
  return { exec: sql => db.exec(sql), get: (sql, ...parameters) => db.prepare(sql).get(...parameters) ?? null,
    run: (sql, ...parameters) => { db.prepare(sql).run(...parameters); }, close: () => db.close() };
}

function unavailable(): never { throw new ThinkStateError('unavailable'); }
function conflict(): never { throw new ThinkStateError('conflict'); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function text(row: Row, key: string): string { const value = row[key]; return typeof value === 'string' ? value : unavailable(); }
function nullableText(row: Row, key: string): string | null { return row[key] === null ? null : text(row, key); }
function integer(row: Row, key: string): number {
  const value = row[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : unavailable();
}
function oneOf<T extends string>(value: string, choices: readonly T[]): T {
  const found = choices.find(choice => choice === value);
  return found ?? unavailable();
}

function checkOriginal(receipt: CommandReceipt, original: Uint8Array | null, digest: string | null): void {
  if (receipt.kind !== 'send' && receipt.kind !== 'form-reply') {
    if (original !== null || digest !== null) unavailable();
    return;
  }
  if (!original || original.length > (receipt.kind === 'send' ? 1024 * 1024 : 32768) || !digest || !/^[a-f0-9]{64}$/.test(digest)) unavailable();
  const value = receipt.kind === 'send' ? original : JSON.stringify({ conversationId: receipt.conversationId,
    decisionId: receipt.decisionId, answer: JSON.parse(Buffer.from(original).toString('utf8')) });
  if (createHash('sha256').update(value).digest('hex') !== digest) unavailable();
}

function decodeCommand(row: Row): StoredCommand {
  const kind = text(row, 'kind');
  const state = text(row, 'state');
  const base = { conversationId: text(row, 'conversation_id'), clientCommandId: text(row, 'command_id'), epoch: text(row, 'registration_epoch') };
  const failure = nullableText(row, 'failure_code');
  let receipt: CommandReceipt;
  if (kind === 'create') {
    const parsed = oneOf(state, ['registered', 'ready', 'upstream-unconfirmed', 'rejected']);
    const codes: readonly CreateFailureCode[] = ['upstream_rejected', 'ownership_mismatch', 'configuration_invalid', 'service_unavailable'];
    receipt = parsed === 'rejected' ? { ...base, kind, state: parsed, failure: { code: oneOf(failure ?? '', codes) } }
      : { ...base, kind, state: parsed };
  } else if (kind === 'send') {
    const parsed: SendReceipt['state'] = oneOf(state, ['registered', 'admitted', 'upstream-unconfirmed', 'monitor-unavailable',
      'cancelled-before-delivery', 'completed', 'failed', 'interrupted', 'rejected']);
    receipt = { ...base, kind, state: parsed, runId: text(row, 'run_id'),
      ...(failure ? { failure: { code: oneOf(failure, ['execution_failed', 'resource_failure']) } } : {}) };
  } else if (kind === 'stop') {
    const parsed: StopReceipt['state'] = oneOf(state, ['registered', 'requested', 'upstream-unconfirmed', 'cancelled-before-delivery']);
    receipt = { ...base, kind, state: parsed, runId: text(row, 'run_id') };
  } else if (kind === 'form-reply') {
    const parsed: FormReplyReceipt['state'] = oneOf(state, ['registered', 'replied', 'upstream-unconfirmed', 'stale', 'rejected']);
    if (failure !== null && failure !== 'resource_failure') unavailable();
    receipt = { ...base, kind, state: parsed, decisionId: text(row, 'decision_id'),
      ...(failure ? { failure: { code: 'resource_failure' as const } } : {}) };
  } else return unavailable();
  const original = row.original_input;
  if (original !== null && !(original instanceof Uint8Array)) unavailable();
  const attempted = integer(row, 'dispatch_attempted');
  if (attempted > 1) unavailable();
  const payloadSha256 = nullableText(row, 'payload_sha256');
  checkOriginal(receipt, original, payloadSha256);
  return { receipt, original: original === null ? null : new Uint8Array(original), payloadSha256,
    registeredAt: integer(row, 'registered_at'), attempted: attempted === 1 };
}

const schemaV1 = `
  CREATE TABLE application_metadata (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1), installation_id TEXT NOT NULL UNIQUE
  );
  CREATE TABLE conversations (
    conversation_id TEXT PRIMARY KEY NOT NULL, native_session_id TEXT NOT NULL UNIQUE,
    vault_directory TEXT NOT NULL, owner_marker_json TEXT NOT NULL, creation_epoch TEXT NOT NULL,
    context_json TEXT NOT NULL, effective_context_json TEXT, created_at INTEGER NOT NULL, creation_state TEXT NOT NULL
  );
  CREATE TABLE commands (
    command_id TEXT PRIMARY KEY NOT NULL,
    conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id),
    kind TEXT NOT NULL CHECK(kind IN ('create', 'send', 'stop', 'form-reply')),
    state TEXT NOT NULL, original_input BLOB, payload_sha256 TEXT,
    dispatch_attempted INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_attempted IN (0, 1)),
    run_id TEXT, native_message_id TEXT, decision_id TEXT,
    registered_at INTEGER NOT NULL, registration_epoch TEXT NOT NULL, failure_code TEXT,
    CHECK((kind IN ('send', 'form-reply') AND typeof(original_input) = 'blob'
      AND payload_sha256 IS NOT NULL AND typeof(payload_sha256) = 'text' AND length(payload_sha256) = 64)
      OR (kind IN ('create', 'stop') AND original_input IS NULL AND payload_sha256 IS NULL))
  );
  CREATE INDEX commands_conversation ON commands(conversation_id, registered_at);
`;

function validateV1(db: SQLite): string {
  const metadata = db.get('SELECT installation_id FROM application_metadata WHERE singleton = 1');
  if (!metadata) unavailable();
  const id = text(metadata, 'installation_id');
  if (!uuid.test(id)) unavailable();
  // Compile the actual versioned columns without scanning or importing any conversations.
  db.get(`SELECT c.conversation_id, c.native_session_id, c.owner_marker_json, c.vault_directory,
    c.context_json, c.effective_context_json, c.creation_epoch, c.created_at, c.creation_state,
    d.command_id, d.kind, d.state, d.original_input, d.payload_sha256, d.dispatch_attempted,
    d.run_id, d.native_message_id, d.decision_id, d.registered_at, d.registration_epoch, d.failure_code
    FROM conversations c LEFT JOIN commands d ON d.conversation_id = c.conversation_id LIMIT 0`);
  return id;
}

class SQLiteThinkState implements ThinkStateStore {
  private closed = false;
  readonly installationId: string;
  readonly transcripts: SQLiteTranscriptState;

  constructor(private readonly db: SQLite, private readonly file: ThinkStateFile) {
    file.validate();
    if (db.get('PRAGMA quick_check')?.quick_check !== 'ok') unavailable();
    const version = Number(db.get('PRAGMA user_version')?.user_version);
    if (version !== 0 && version !== 1 && version !== 2) unavailable();
    if (version === 0) {
      const existing = db.get("SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
      if (existing?.count !== 0) unavailable();
    } else { validateV1(db); if (version === 2) validateTranscriptSchema(db); }
    db.exec('PRAGMA foreign_keys = ON; PRAGMA synchronous = EXTRA; PRAGMA busy_timeout = 1000;');
    if (db.get('PRAGMA foreign_keys')?.foreign_keys !== 1 || db.get('PRAGMA synchronous')?.synchronous !== 3) unavailable();
    // EXTRA syncs rollback-journal deletion too; no WAL/checkpointer service is needed.
    if (db.get('PRAGMA journal_mode = DELETE')?.journal_mode !== 'delete') unavailable();
    if (version === 0) this.write('migrate', () => {
      if (Number(db.get('PRAGMA user_version')?.user_version) !== 0) unavailable();
      const existing = db.get("SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
      if (existing?.count !== 0) unavailable();
      db.exec(schemaV1);
      db.run('INSERT INTO application_metadata(singleton, installation_id) VALUES (1, ?)', randomUUID());
      db.exec('PRAGMA user_version = 1');
    });
    if (version < 2) this.write('migrate', () => {
      if (Number(db.get('PRAGMA user_version')?.user_version) !== 1) unavailable();
      db.exec(transcriptSchemaV2);
      db.exec('PRAGMA user_version = 2');
    });
    this.installationId = validateV1(db);
    validateTranscriptSchema(db);
    this.transcripts = new SQLiteTranscriptState(db, () => this.check(), operation => this.write('transcript', operation), this.installationId);
    file.syncDirectory();
  }

  private check(): void { if (this.closed) unavailable(); this.file.validate(); }

  private write<T>(name: 'migrate' | 'create-register' | 'command-register' | 'dispatch-attempt' | 'outcome' | 'transcript', operation: () => T): T {
    console.info('think_state_write_attempt', { operation: name });
    let inTransaction = false;
    let committed = false;
    try {
      this.check();
      this.db.exec('BEGIN IMMEDIATE'); inTransaction = true;
      const result = operation();
      this.db.exec('COMMIT'); inTransaction = false; committed = true;
      this.file.validate();
      console.info('think_state_write_outcome', { operation: name, status: 'committed' });
      return result;
    } catch (error) {
      if (inTransaction) try { this.db.exec('ROLLBACK'); } catch { /* Keep the original controlled failure. */ }
      console.info('think_state_write_outcome', { operation: name, status: 'unavailable', commit: committed ? 'confirmed' : 'not-confirmed' });
      if (error instanceof ThinkStateError) throw error;
      return unavailable();
    }
  }

  command(commandId: string): StoredCommand | null {
    try {
      this.check();
      const row = this.db.get('SELECT * FROM commands WHERE command_id = ?', commandId);
      return row ? decodeCommand(row) : null;
    } catch (error) { if (error instanceof ThinkStateError) throw error; return unavailable(); }
  }

  private insert(receipt: CommandReceipt, original: Uint8Array | null, digest: string | null, at: number): void {
    this.db.run(`INSERT INTO commands(command_id, conversation_id, kind, state, original_input, payload_sha256,
      dispatch_attempted, run_id, native_message_id, decision_id, registered_at, registration_epoch, failure_code)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, NULL)`,
    receipt.clientCommandId, receipt.conversationId, receipt.kind, receipt.state, original, digest,
    'runId' in receipt ? receipt.runId : null,
    receipt.kind === 'send' ? `msg_memoryloop_${receipt.clientCommandId.replaceAll('-', '')}` : null,
    receipt.kind === 'form-reply' ? receipt.decisionId : null, at, receipt.epoch);
  }

  registerConversation(conversation: OwnedConversation, receipt: CreateReceipt, at: number): void {
    if (conversation.owner.installationId !== this.installationId || conversation.owner.conversationId !== receipt.conversationId ||
        conversation.conversationId !== receipt.conversationId || receipt.state !== 'registered' || !Number.isSafeInteger(at) || at < 0) unavailable();
    this.write('create-register', () => {
      if (this.db.get('SELECT 1 FROM commands WHERE command_id = ?', receipt.clientCommandId) ||
          this.db.get('SELECT 1 FROM conversations WHERE conversation_id = ?', receipt.conversationId)) conflict();
      this.db.run(`INSERT INTO conversations(conversation_id, native_session_id, vault_directory, owner_marker_json,
        creation_epoch, context_json, created_at, creation_state) VALUES (?, ?, ?, ?, ?, ?, ?, 'registered')`,
      conversation.conversationId, conversation.nativeSessionId, conversation.directory, JSON.stringify(conversation.owner),
      conversation.owner.epoch, JSON.stringify({ agent: conversation.agent, model: conversation.model,
        permissions: [{ action: '*', resource: '*', effect: 'allow' }] }), at);
      this.insert(receipt, null, null, at);
    });
  }

  registerCommand(receipt: Exclude<CommandReceipt, CreateReceipt>, original: Uint8Array | null, digest: string | null, at: number): void {
    if (receipt.state !== 'registered' || !Number.isSafeInteger(at) || at < 0) unavailable();
    checkOriginal(receipt, original, digest);
    this.write('command-register', () => {
      if (this.db.get('SELECT 1 FROM commands WHERE command_id = ?', receipt.clientCommandId)) conflict();
      const owner = this.db.get('SELECT creation_state FROM conversations WHERE conversation_id = ?', receipt.conversationId);
      if (owner?.creation_state !== 'ready') unavailable();
      this.insert(receipt, original, digest, at);
    });
  }

  attempted(commandId: string): void {
    this.write('dispatch-attempt', () => {
      const row = this.db.get('SELECT dispatch_attempted, state FROM commands WHERE command_id = ?', commandId);
      if (!row || row.dispatch_attempted !== 0 || row.state !== 'registered') conflict();
      this.db.run('UPDATE commands SET dispatch_attempted = 1 WHERE command_id = ?', commandId);
    });
  }

  outcome(receipt: CommandReceipt, verifiedSelection?: Pick<NativeSession, 'agent' | 'model' | 'permissions'>): void {
    if (receipt.kind === 'create' && receipt.state === 'ready' && !verifiedSelection) unavailable();
    this.write('outcome', () => {
      const row = this.db.get('SELECT conversation_id, kind FROM commands WHERE command_id = ?', receipt.clientCommandId);
      if (row?.conversation_id !== receipt.conversationId || row.kind !== receipt.kind) conflict();
      this.db.run('UPDATE commands SET state = ?, failure_code = ? WHERE command_id = ?', receipt.state,
        'failure' in receipt ? receipt.failure?.code ?? null : null, receipt.clientCommandId);
      if (receipt.kind === 'create') this.db.run('UPDATE conversations SET creation_state = ? WHERE conversation_id = ?', receipt.state, receipt.conversationId);
      if (receipt.kind === 'create' && receipt.state === 'ready' && verifiedSelection) {
        this.db.run('UPDATE conversations SET effective_context_json = ? WHERE conversation_id = ?', JSON.stringify({
          agent: verifiedSelection.agent ?? null, model: verifiedSelection.model ?? null, permissions: verifiedSelection.permissions ?? null,
        }), receipt.conversationId);
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.db.close(); } finally { this.file.close(); }
  }
}

export async function openThinkState(projectRoot: string, vaultDirectory: string): Promise<ThinkStateStore & { readonly transcripts: TranscriptStateStore }> {
  console.info('think_state_setup_attempt');
  let file: ThinkStateFile | undefined;
  let db: SQLite | undefined;
  try {
    file = new ThinkStateFile(projectRoot, vaultDirectory);
    db = await connect(file.path);
    const store = new SQLiteThinkState(db, file);
    console.info('think_state_setup_outcome', { status: 'ready', schema: 2 });
    return store;
  } catch {
    try { db?.close(); } catch { console.info('think_state_cleanup_outcome', { status: 'failed' }); }
    try { file?.close(); } catch { console.info('think_state_cleanup_outcome', { status: 'failed' }); }
    console.info('think_state_setup_outcome', { status: 'unavailable' });
    throw new ThinkStateError('unavailable');
  }
}
