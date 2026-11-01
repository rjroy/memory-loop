import { createHash, randomUUID } from 'node:crypto';
import type { SessionCreateInput } from '@opencode/client';
import type { SQLite } from './think/sqlite-state';
import { ThinkStateError } from './think/state';
import { SQLiteGenerationPublications, type GroundGenerationPublicationState } from './ground-generation-publication-state';

export interface GenerationSelection { agent?: string; model?: NonNullable<SessionCreateInput['model']> }
export interface GenerationAttempt {
  occurrenceId: string; attemptId: string; directory: string; timeZone: string; scheduledAt: number; count: number;
  nativeSessionId: string; nativeMessageId: string; inputSha256: string;
  state: 'preparing' | 'uncertain' | 'admitted' | 'failed' | 'settled';
  createAttempted: boolean; dispatchAttempted: boolean; requested: GenerationSelection; effective: GenerationSelection | null;
}
export interface GroundGenerationState {
  pending(): GenerationAttempt | null;
  claim(input: { directory: string; timeZone: string; scheduledAt: number; count: number; inputSha256: string; selection: GenerationSelection }): GenerationAttempt | null;
  creating(attemptId: string): void;
  verified(attemptId: string, selection: GenerationSelection): void;
  attempted(attemptId: string): void;
  admitted(attemptId: string): void;
  abandonUndispatched(attemptId: string): void;
  isTranscript(directory: string, noteId: readonly string[]): boolean;
}
export interface GenerationOccurrence { directory: string; timeZone: string; scheduledAt: number }
export interface GenerationPreflightFact { attempts: number; retryAt: number | null; blocked: boolean }
export interface GroundGenerationPreflight {
  beginPreflight(occurrence: GenerationOccurrence, now: number): { allowed: boolean; fact: GenerationPreflightFact };
  failedPreflight(occurrence: GenerationOccurrence, now: number, retryable: boolean): number | null;
}
export type GroundGenerationStore = GroundGenerationState & GroundGenerationPreflight & { readonly publications: GroundGenerationPublicationState };
export const generationOccurrenceId = (occurrence: Pick<GenerationOccurrence, 'timeZone' | 'scheduledAt'>) =>
  createHash('sha256').update(JSON.stringify(['questions', occurrence.timeZone, occurrence.scheduledAt])).digest('hex');

/** Reserve before read-only preflight too, so a crash/restart cannot reset the budget. */
export function reserveGenerationPreflight(prior: GenerationPreflightFact | null, now: number): { allowed: boolean; fact: GenerationPreflightFact } {
  if (prior && (prior.blocked || prior.attempts >= 3 || prior.retryAt !== null && prior.retryAt > now)) return { allowed: false, fact: prior };
  const attempts = (prior?.attempts ?? 0) + 1;
  return { allowed: true, fact: { attempts, retryAt: attempts < 3 ? now + 30000 * 2 ** (attempts - 1) : null, blocked: false } };
}
export function failedGenerationPreflight(prior: GenerationPreflightFact, now: number, retryable: boolean): GenerationPreflightFact {
  const blocked = prior.blocked || !retryable;
  return { attempts: prior.attempts, blocked, retryAt: !blocked && prior.attempts < 3 ? now + 30000 * 2 ** (prior.attempts - 1) : null };
}

/** Additive to v5. Job sessions never enter Think commands, originals, leases or transcripts. */
export const generationSchemaV6 = `
  CREATE TABLE ground_generation_occurrences (
    occurrence_id TEXT PRIMARY KEY NOT NULL, job_key TEXT NOT NULL CHECK(job_key IN ('questions', 'quotes')),
    time_zone TEXT NOT NULL, scheduled_at INTEGER NOT NULL, vault_directory TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('preparing', 'uncertain', 'admitted', 'failed', 'settled')),
    reason TEXT CHECK(reason IN ('status_unknown', 'not_dispatched')),
    UNIQUE(job_key, time_zone, scheduled_at)
  );
  CREATE UNIQUE INDEX ground_generation_active ON ground_generation_occurrences(job_key)
    WHERE state NOT IN ('failed', 'settled');
  CREATE TABLE ground_generation_attempts (
    attempt_id TEXT PRIMARY KEY NOT NULL, occurrence_id TEXT NOT NULL UNIQUE REFERENCES ground_generation_occurrences(occurrence_id),
    native_session_id TEXT NOT NULL UNIQUE, native_message_id TEXT NOT NULL UNIQUE, input_sha256 TEXT NOT NULL,
    question_count INTEGER NOT NULL CHECK(question_count BETWEEN 1 AND 50), requested_context_json TEXT NOT NULL,
    effective_context_json TEXT, create_attempted INTEGER NOT NULL DEFAULT 0 CHECK(create_attempted IN (0, 1)),
    dispatch_attempted INTEGER NOT NULL DEFAULT 0 CHECK(dispatch_attempted IN (0, 1))
  );
  CREATE INDEX ground_generation_transcript_path ON transcripts(note_id_json);
`;
/** Pre-dispatch read failures have their own facts, not invented prompt/digest rows. */
export const generationSchemaV7 = `
  CREATE TABLE ground_generation_preflight (
    occurrence_id TEXT PRIMARY KEY NOT NULL, job_key TEXT NOT NULL CHECK(job_key = 'questions'),
    time_zone TEXT NOT NULL, scheduled_at INTEGER NOT NULL, vault_directory TEXT NOT NULL,
    attempts INTEGER NOT NULL CHECK(attempts BETWEEN 1 AND 3), retry_at INTEGER,
    blocked INTEGER NOT NULL CHECK(blocked IN (0, 1)), UNIQUE(job_key, time_zone, scheduled_at)
  );
`;
export function validateGenerationSchema(db: SQLite): void {
  db.get(`SELECT o.occurrence_id, o.job_key, o.time_zone, o.scheduled_at, o.vault_directory, o.state, o.reason,
    a.attempt_id, a.native_session_id, a.native_message_id, a.input_sha256, a.question_count,
    a.requested_context_json, a.effective_context_json, a.create_attempted, a.dispatch_attempted
    FROM ground_generation_occurrences o JOIN ground_generation_attempts a ON a.occurrence_id = o.occurrence_id LIMIT 0`);
  if (db.get('PRAGMA foreign_key_check(ground_generation_attempts)')) fail();
}
export function validateGenerationPreflightSchema(db: SQLite): void {
  db.get(`SELECT occurrence_id, job_key, time_zone, scheduled_at, vault_directory, attempts, retry_at, blocked FROM ground_generation_preflight LIMIT 0`);
}
function fail(): never { throw new ThinkStateError('unavailable'); }
function text(row: Record<string, unknown>, key: string): string { const value = row[key]; return typeof value === 'string' && value.length > 0 ? value : fail(); }
function integer(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail(); }
function bit(value: unknown): boolean { return value === 1 ? true : value === 0 ? false : fail(); }
function selection(json: string): GenerationSelection {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  if (Object.keys(value).some(key => key !== 'agent' && key !== 'model')) return fail();
  const agent = 'agent' in value ? value.agent : undefined;
  const model = 'model' in value ? value.model : undefined;
  if (agent !== undefined && (typeof agent !== 'string' || !agent)) return fail();
  if (model !== undefined && (!model || typeof model !== 'object' || !('id' in model) || typeof model.id !== 'string' || !model.id ||
      !('providerID' in model) || typeof model.providerID !== 'string' || !model.providerID ||
      'variant' in model && typeof model.variant !== 'string' || Object.keys(model).some(key => !['id', 'providerID', 'variant'].includes(key)))) return fail();
  return { ...(typeof agent === 'string' ? { agent } : {}), ...(model && typeof model === 'object' && 'id' in model && typeof model.id === 'string' &&
    'providerID' in model && typeof model.providerID === 'string' ? { model: { id: model.id, providerID: model.providerID,
      ...('variant' in model && typeof model.variant === 'string' ? { variant: model.variant } : {}) } } : {}) };
}
const joined = `SELECT o.*, a.* FROM ground_generation_occurrences o JOIN ground_generation_attempts a ON a.occurrence_id = o.occurrence_id`;
function decode(row: Record<string, unknown>): GenerationAttempt {
  const state = row.state;
  if (state !== 'preparing' && state !== 'uncertain' && state !== 'admitted' && state !== 'failed' && state !== 'settled') return fail();
  if (row.reason !== null && row.reason !== 'status_unknown' && row.reason !== 'not_dispatched') return fail();
  const inputSha256 = text(row, 'input_sha256'); if (!/^[a-f0-9]{64}$/.test(inputSha256)) return fail();
  const count = integer(row.question_count); if (count < 1 || count > 50) return fail();
  const occurrenceId = text(row, 'occurrence_id'); const attemptId = text(row, 'attempt_id');
  const timeZone = text(row, 'time_zone'); const scheduledAt = integer(row.scheduled_at); const suffix = attemptId.replaceAll('-', '');
  const createAttempted = bit(row.create_attempted); const dispatchAttempted = bit(row.dispatch_attempted);
  const effective = row.effective_context_json === null ? null : selection(text(row, 'effective_context_json'));
  if (row.job_key !== 'questions' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(attemptId) ||
      occurrenceId !== generationOccurrenceId({ timeZone, scheduledAt }) ||
      row.native_session_id !== `ses_memoryloop_generation_${suffix}` || row.native_message_id !== `msg_memoryloop_generation_${suffix}` ||
      dispatchAttempted && (!createAttempted || !effective) || state === 'admitted' && !dispatchAttempted) return fail();
  return { occurrenceId, attemptId, directory: text(row, 'vault_directory'), timeZone, scheduledAt, count, state,
    nativeSessionId: text(row, 'native_session_id'), nativeMessageId: text(row, 'native_message_id'), inputSha256,
    createAttempted, dispatchAttempted, requested: selection(text(row, 'requested_context_json')), effective };
}

export class SQLiteGroundGeneration implements GroundGenerationStore {
  readonly publications: GroundGenerationPublicationState;
  constructor(private readonly db: SQLite, private readonly check: () => void, private readonly write: <T>(action: () => T) => T) {
    this.publications = new SQLiteGenerationPublications(db, check, write);
  }
  private read<T>(action: () => T): T {
    try { this.check(); return action(); } catch (error) { if (error instanceof ThinkStateError) throw error; return fail(); }
  }
  pending(): GenerationAttempt | null {
    return this.read(() => { const row = this.db.get(`${joined} WHERE o.job_key = 'questions' AND o.state NOT IN ('failed', 'settled') LIMIT 1`); return row ? decode(row) : null; });
  }
  private preflight(occurrence: GenerationOccurrence): GenerationPreflightFact | null {
    const row = this.db.get('SELECT * FROM ground_generation_preflight WHERE occurrence_id = ?', generationOccurrenceId(occurrence));
    if (!row) return null;
    const attempts = integer(row.attempts); const retryAt = row.retry_at === null ? null : integer(row.retry_at); const blocked = bit(row.blocked);
    if (attempts < 1 || attempts > 3 || attempts === 3 && retryAt !== null || attempts < 3 && !blocked && retryAt === null ||
        row.job_key !== 'questions' || row.time_zone !== occurrence.timeZone || row.scheduled_at !== occurrence.scheduledAt || row.vault_directory !== occurrence.directory) return fail();
    return { attempts, retryAt, blocked };
  }
  beginPreflight(occurrence: GenerationOccurrence, now: number): ReturnType<GroundGenerationPreflight['beginPreflight']> {
    return this.write(() => {
      integer(now); integer(occurrence.scheduledAt);
      const id = generationOccurrenceId(occurrence);
      const reservation = reserveGenerationPreflight(this.preflight(occurrence), now);
      if (reservation.allowed) this.db.run(`INSERT INTO ground_generation_preflight(occurrence_id, job_key, time_zone, scheduled_at, vault_directory, attempts, retry_at, blocked)
        VALUES (?, 'questions', ?, ?, ?, ?, ?, 0) ON CONFLICT(occurrence_id) DO UPDATE SET attempts = excluded.attempts, retry_at = excluded.retry_at`,
      id, occurrence.timeZone, occurrence.scheduledAt, occurrence.directory, reservation.fact.attempts, reservation.fact.retryAt);
      return reservation;
    });
  }
  failedPreflight(occurrence: GenerationOccurrence, now: number, retryable: boolean): number | null {
    return this.write(() => {
      integer(now); const prior = this.preflight(occurrence); if (!prior) return fail();
      const fact = failedGenerationPreflight(prior, now, retryable);
      this.db.run('UPDATE ground_generation_preflight SET blocked = ?, retry_at = ? WHERE occurrence_id = ?',
        fact.blocked ? 1 : 0, fact.retryAt, generationOccurrenceId(occurrence));
      return fact.retryAt;
    });
  }
  claim(input: Parameters<GroundGenerationState['claim']>[0]): GenerationAttempt | null {
    return this.write(() => {
      if (this.pending()) return null;
      integer(input.scheduledAt); if (input.count < 1 || input.count > 50 || !Number.isSafeInteger(input.count) || !/^[a-f0-9]{64}$/.test(input.inputSha256)) return fail();
      const occurrenceId = generationOccurrenceId(input);
      if (this.db.get('SELECT 1 FROM ground_generation_occurrences WHERE occurrence_id = ?', occurrenceId)) return null;
      const attemptId = randomUUID(); const suffix = attemptId.replaceAll('-', '');
      this.db.run(`INSERT INTO ground_generation_occurrences(occurrence_id, job_key, time_zone, scheduled_at, vault_directory, state)
        VALUES (?, 'questions', ?, ?, ?, 'preparing')`, occurrenceId, input.timeZone, input.scheduledAt, input.directory);
      this.db.run(`INSERT INTO ground_generation_attempts(attempt_id, occurrence_id, native_session_id, native_message_id, input_sha256, question_count, requested_context_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, attemptId, occurrenceId, `ses_memoryloop_generation_${suffix}`, `msg_memoryloop_generation_${suffix}`, input.inputSha256,
      input.count, JSON.stringify(input.selection));
      return this.required(attemptId);
    });
  }
  private required(attemptId: string): GenerationAttempt {
    const row = this.db.get(`${joined} WHERE a.attempt_id = ? AND o.state NOT IN ('failed', 'settled')`, attemptId);
    return row ? decode(row) : fail();
  }
  creating(attemptId: string): void {
    this.write(() => {
      const attempt = this.required(attemptId); if (attempt.createAttempted) return fail();
      this.db.run('UPDATE ground_generation_attempts SET create_attempted = 1 WHERE attempt_id = ?', attemptId);
      this.db.run("UPDATE ground_generation_occurrences SET state = 'uncertain', reason = 'status_unknown' WHERE occurrence_id = ?", attempt.occurrenceId);
    });
  }
  verified(attemptId: string, effective: GenerationSelection): void {
    this.write(() => {
      const attempt = this.required(attemptId); if (!attempt.createAttempted || attempt.dispatchAttempted) return fail();
      this.db.run('UPDATE ground_generation_attempts SET effective_context_json = ? WHERE attempt_id = ?', JSON.stringify(effective), attemptId);
    });
  }
  attempted(attemptId: string): void {
    this.write(() => {
      const attempt = this.required(attemptId); if (!attempt.effective || attempt.dispatchAttempted) return fail();
      this.db.run('UPDATE ground_generation_attempts SET dispatch_attempted = 1 WHERE attempt_id = ?', attemptId);
    });
  }
  admitted(attemptId: string): void {
    this.write(() => {
      const attempt = this.required(attemptId); if (!attempt.dispatchAttempted) return fail();
      if (attempt.state !== 'admitted') this.db.run("UPDATE ground_generation_occurrences SET state = 'admitted', reason = NULL WHERE occurrence_id = ?", attempt.occurrenceId);
    });
  }
  abandonUndispatched(attemptId: string): void {
    this.write(() => {
      const attempt = this.required(attemptId); if (attempt.dispatchAttempted) return fail();
      this.db.run("UPDATE ground_generation_occurrences SET state = 'failed', reason = 'not_dispatched' WHERE occurrence_id = ?", attempt.occurrenceId);
      this.db.run('UPDATE ground_generation_preflight SET blocked = 1, retry_at = NULL WHERE occurrence_id = ?', attempt.occurrenceId);
    });
  }
  isTranscript(directory: string, noteId: readonly string[]): boolean {
    return this.read(() => !!this.db.get(`SELECT 1 FROM transcripts t JOIN conversations c ON c.conversation_id = t.conversation_id
      WHERE c.vault_directory = ? AND t.note_id_json = ? LIMIT 1`, directory, JSON.stringify(noteId)));
  }
}
