import { randomBytes } from 'node:crypto';
import type { SQLite } from './think/sqlite-state';
import { ThinkStateError } from './think/state';
import { isVaultComponent } from './contract';
import { questionCandidates, questionDigest, questionResourceLimit } from './ground-generation-questions';

export interface PublicationIdentity { dev: number; ino: number }
export type PublicationBaseline = { kind: 'absent' } | { kind: 'file'; identity: PublicationIdentity; fingerprint: string; sha256: string };
export interface QuestionPublicationPlan {
  noteId: string[]; directories: PublicationIdentity[]; baseline: PublicationBaseline;
  candidatesJson: string; sourceMessageId: string; sourceSha256: string;
  output: string | null; outputSha256: string | null; writeRequired: boolean;
  tempName: string;
  /** Absent on historical v8 plans; reserved durably before a new exclusive create. */
  tempWitnessName?: string;
}
export interface QuestionPublication extends QuestionPublicationPlan {
  attemptId: string; phase: 'validated' | 'publishing' | 'settled' | 'conflict';
  tempIdentity: PublicationIdentity | null; publishAttempted: boolean;
}
export type PublicationFailure = 'invalid_output' | 'unsafe_target' | 'conflict';
export interface GroundGenerationPublicationState {
  get(attemptId: string): QuestionPublication | null;
  stage(attemptId: string, plan: QuestionPublicationPlan): QuestionPublication;
  directories(attemptId: string, identities: PublicationIdentity[]): void;
  temp(attemptId: string, identity: PublicationIdentity): void;
  clearTemp(attemptId: string, preserveCreationIntent?: boolean): void;
  publishing(attemptId: string): void;
  settle(attemptId: string): void;
  fail(attemptId: string, reason: PublicationFailure): void;
  cleanup(): QuestionPublication[];
}
export const publicationTempName = (attemptId: string) => `.memory-loop-questions-${attemptId}.tmp`;
export const generationSchemaV8 = `
  CREATE TABLE ground_generation_publications (
    attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES ground_generation_attempts(attempt_id),
    phase TEXT NOT NULL CHECK(phase IN ('validated', 'publishing', 'settled', 'conflict', 'rejected')),
    plan_json TEXT, output_text TEXT, output_sha256 TEXT, temp_dev INTEGER, temp_ino INTEGER,
    publish_attempted INTEGER NOT NULL DEFAULT 0 CHECK(publish_attempted IN (0, 1)),
    failure_code TEXT CHECK(failure_code IN ('invalid_output', 'unsafe_target', 'conflict')), finished_at INTEGER,
    CHECK((temp_dev IS NULL) = (temp_ino IS NULL)), CHECK(phase = 'rejected' OR plan_json IS NOT NULL)
  );
`;
export function validateGenerationPublicationSchema(db: SQLite): void {
  db.get(`SELECT attempt_id, phase, plan_json, output_text, output_sha256, temp_dev, temp_ino, publish_attempted, failure_code, finished_at FROM ground_generation_publications LIMIT 0`);
  if (db.get('PRAGMA foreign_key_check(ground_generation_publications)')) fail();
}
function fail(): never { throw new ThinkStateError('unavailable'); }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
const string = (value: unknown): string => typeof value === 'string' ? value : fail();
const digest = (value: unknown): string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : fail();
function identity(value: unknown): PublicationIdentity {
  if (!record(value) || Object.keys(value).length !== 2) return fail();
  return { dev: integer(value.dev), ino: integer(value.ino) };
}
function decode(row: Record<string, unknown>): QuestionPublication {
  const attemptId = string(row.attempt_id); const phase = row.phase;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attemptId) ||
      !['validated', 'publishing', 'settled', 'conflict'].includes(string(phase))) return fail();
  const json = string(row.plan_json); if (Buffer.byteLength(json) > 1024 * 1024) return fail();
  const raw: unknown = JSON.parse(json);
  if (!record(raw) || Object.keys(raw).filter(key => key !== 'tempWitnessName').sort().join(',') !== 'baseline,candidatesJson,directories,noteId,sourceMessageId,sourceSha256,tempName,writeRequired' ||
      !Array.isArray(raw.noteId) || raw.noteId.length < 3 || raw.noteId.length > 32 || raw.noteId.some(part => typeof part !== 'string' || !isVaultComponent(part)) ||
      raw.noteId[0] !== '03_Resources' || raw.noteId[1] !== 'Memory-Loop' || typeof raw.noteId.at(-1) !== 'string' || !raw.noteId.at(-1).endsWith('.md') ||
      !Array.isArray(raw.directories) || raw.directories.length < 1 || raw.directories.length > raw.noteId.length || typeof raw.writeRequired !== 'boolean' ||
      raw.tempName !== publicationTempName(attemptId)) return fail();
  const tempWitnessName = raw.tempWitnessName;
  if (tempWitnessName !== undefined && (typeof tempWitnessName !== 'string' || !new RegExp(`^\\.memory-loop-questions-${attemptId}-[a-f0-9]{32}\\.owner$`).test(tempWitnessName) || !raw.writeRequired)) return fail();
  const noteId = raw.noteId.map(string); const directories = raw.directories.map(identity);
  if (!record(raw.baseline)) return fail();
  let baseline: PublicationBaseline;
  if (raw.baseline.kind === 'absent' && Object.keys(raw.baseline).length === 1) baseline = { kind: 'absent' };
  else if (raw.baseline.kind === 'file' && Object.keys(raw.baseline).length === 4 && directories.length === noteId.length) {
    const fingerprint = string(raw.baseline.fingerprint); if (!fingerprint || fingerprint.length > 512) return fail();
    baseline = { kind: 'file', identity: identity(raw.baseline.identity), fingerprint, sha256: digest(raw.baseline.sha256) };
  } else return fail();
  const candidatesJson = string(raw.candidatesJson);
  if (JSON.stringify(questionCandidates(candidatesJson, 50)) !== candidatesJson) return fail();
  const output = row.output_text === null ? null : string(row.output_text);
  const outputSha256 = row.output_sha256 === null ? null : digest(row.output_sha256);
  if (output === null ? outputSha256 !== null || raw.writeRequired || baseline.kind !== 'absent'
    : Buffer.byteLength(output) > questionResourceLimit || questionDigest(output) !== outputSha256) return fail();
  if (!raw.writeRequired && baseline.kind === 'file' && outputSha256 !== baseline.sha256) return fail();
  const sourceMessageId = string(raw.sourceMessageId); if (!sourceMessageId || sourceMessageId.length > 256 || /[\x00-\x20\x7f]/.test(sourceMessageId)) return fail();
  const publishAttempted = row.publish_attempted === 1 ? true : row.publish_attempted === 0 ? false : fail();
  const tempIdentity = row.temp_dev === null && row.temp_ino === null ? null : identity({ dev: row.temp_dev, ino: row.temp_ino });
  if (phase === 'publishing' && !publishAttempted || publishAttempted && !raw.writeRequired) return fail();
  return { attemptId, phase: phase === 'validated' || phase === 'publishing' || phase === 'settled' ? phase : 'conflict', noteId, directories, baseline,
    candidatesJson, sourceMessageId, sourceSha256: digest(raw.sourceSha256),
    output, outputSha256, writeRequired: raw.writeRequired, tempName: string(raw.tempName),
    ...(typeof tempWitnessName === 'string' ? { tempWitnessName } : {}), tempIdentity, publishAttempted };
}
function serialized(plan: QuestionPublicationPlan): string {
  return JSON.stringify({ noteId: plan.noteId, directories: plan.directories, baseline: plan.baseline, candidatesJson: plan.candidatesJson,
    sourceMessageId: plan.sourceMessageId, sourceSha256: plan.sourceSha256, writeRequired: plan.writeRequired, tempName: plan.tempName,
    ...(plan.tempWitnessName === undefined ? {} : { tempWitnessName: plan.tempWitnessName }) });
}

export class SQLiteGenerationPublications implements GroundGenerationPublicationState {
  constructor(private readonly db: SQLite, private readonly check: () => void, private readonly write: <T>(action: () => T) => T) {}
  private read<T>(action: () => T): T { try { this.check(); return action(); } catch { return fail(); } }
  get(attemptId: string): QuestionPublication | null {
    return this.read(() => { const row = this.db.get("SELECT * FROM ground_generation_publications WHERE attempt_id = ? AND phase != 'rejected'", attemptId); return row ? decode(row) : null; });
  }
  private active(attemptId: string): string {
    const row = this.db.get(`SELECT o.occurrence_id FROM ground_generation_occurrences o JOIN ground_generation_attempts a ON a.occurrence_id = o.occurrence_id
      WHERE a.attempt_id = ? AND a.dispatch_attempted = 1 AND o.state = 'admitted'`, attemptId);
    return row ? string(row.occurrence_id) : fail();
  }
  stage(attemptId: string, plan: QuestionPublicationPlan): QuestionPublication {
    return this.write(() => {
      this.active(attemptId); const prior = this.get(attemptId);
      if (prior && (serialized(prior) !== serialized(plan) || prior.output !== plan.output || prior.outputSha256 !== plan.outputSha256)) return fail();
      // Enrich a historical plan only with a fresh creation witness, never new content or a new baseline.
      const reserved = prior ?? plan;
      if (reserved.writeRequired && !prior?.tempIdentity && !reserved.tempWitnessName) {
        reserved.tempWitnessName = `.memory-loop-questions-${attemptId}-${randomBytes(16).toString('hex')}.owner`;
      }
      const json = serialized(reserved);
      if (prior) { this.db.run('UPDATE ground_generation_publications SET plan_json = ? WHERE attempt_id = ?', json, attemptId); return this.get(attemptId) ?? fail(); }
      this.db.run(`INSERT INTO ground_generation_publications(attempt_id, phase, plan_json, output_text, output_sha256) VALUES (?, 'validated', ?, ?, ?)`,
        attemptId, json, plan.output, plan.outputSha256);
      return this.get(attemptId) ?? fail();
    });
  }
  directories(attemptId: string, identities: PublicationIdentity[]): void {
    this.write(() => {
      this.active(attemptId); const plan = this.get(attemptId); if (!plan || identities.length !== plan.noteId.length ||
        plan.directories.some((old, index) => old.dev !== identities[index]?.dev || old.ino !== identities[index]?.ino)) return fail();
      this.db.run('UPDATE ground_generation_publications SET plan_json = ? WHERE attempt_id = ?', serialized({ ...plan, directories: identities }), attemptId);
    });
  }
  temp(attemptId: string, value: PublicationIdentity): void {
    this.write(() => {
      const plan = this.get(attemptId); if (!plan?.writeRequired || plan.tempIdentity || !plan.tempWitnessName) return fail();
      // Cleanup may acquire a proven inode without reopening or regressing terminal work.
      const expectedState = plan.phase === 'conflict' ? 'failed' : plan.phase === 'settled' ? 'settled' : 'admitted';
      const owner = this.db.get(`SELECT 1 FROM ground_generation_occurrences o JOIN ground_generation_attempts a ON a.occurrence_id = o.occurrence_id
        WHERE a.attempt_id = ? AND a.dispatch_attempted = 1 AND o.job_key = 'questions' AND o.state = ?`, attemptId, expectedState);
      if (!owner) return fail();
      this.db.run(`UPDATE ground_generation_publications SET temp_dev = ?, temp_ino = ?
        WHERE attempt_id = ? AND phase = ? AND temp_dev IS NULL AND temp_ino IS NULL`, integer(value.dev), integer(value.ino), attemptId, plan.phase);
    });
  }
  clearTemp(attemptId: string, preserveCreationIntent = false): void {
    this.write(() => {
      const plan = this.get(attemptId); if (!plan) return fail();
      if (!preserveCreationIntent) delete plan.tempWitnessName;
      this.db.run('UPDATE ground_generation_publications SET temp_dev = NULL, temp_ino = NULL, plan_json = ? WHERE attempt_id = ?', serialized(plan), attemptId);
    });
  }
  publishing(attemptId: string): void {
    this.write(() => { this.active(attemptId); const plan = this.get(attemptId); if (!plan?.writeRequired || !plan.tempIdentity) return fail();
      this.db.run("UPDATE ground_generation_publications SET phase = 'publishing', publish_attempted = 1 WHERE attempt_id = ?", attemptId); });
  }
  settle(attemptId: string): void {
    this.write(() => {
      const occurrence = this.active(attemptId); const plan = this.get(attemptId); if (!plan || plan.tempIdentity || plan.tempWitnessName) return fail();
      this.db.run("UPDATE ground_generation_publications SET phase = 'settled', finished_at = ? WHERE attempt_id = ?", Date.now(), attemptId);
      this.db.run("UPDATE ground_generation_occurrences SET state = 'settled', reason = NULL WHERE occurrence_id = ?", occurrence);
      this.db.run('UPDATE ground_generation_preflight SET blocked = 1, retry_at = NULL WHERE occurrence_id = ?', occurrence);
    });
  }
  fail(attemptId: string, reason: PublicationFailure): void {
    this.write(() => {
      const occurrence = this.active(attemptId);
      this.db.run(`INSERT INTO ground_generation_publications(attempt_id, phase, failure_code, finished_at) VALUES (?, 'rejected', ?, ?)
        ON CONFLICT(attempt_id) DO UPDATE SET phase = 'conflict', failure_code = excluded.failure_code, finished_at = excluded.finished_at`, attemptId, reason, Date.now());
      this.db.run("UPDATE ground_generation_occurrences SET state = 'failed', reason = NULL WHERE occurrence_id = ?", occurrence);
      this.db.run('UPDATE ground_generation_preflight SET blocked = 1, retry_at = NULL WHERE occurrence_id = ?', occurrence);
    });
  }
  cleanup(): QuestionPublication[] {
    return this.read(() => this.db.all(`SELECT * FROM ground_generation_publications WHERE phase IN ('settled', 'conflict')
      AND (temp_ino IS NOT NULL OR json_type(plan_json, '$.tempWitnessName') = 'text') ORDER BY finished_at, attempt_id LIMIT 8`).map(decode));
  }
}
