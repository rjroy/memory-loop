import type { BodyOwner, BodyRef } from '../../backend/think/body-store';
import type { ConversationState, TranscriptHealth } from '../../backend/think/contract';
import type { ProjectionEntry } from '../../backend/think/projection';

/** The public lifecycle entry deliberately omits the daemon's commandKind. */
export type ThinkManifestEntry = Exclude<ProjectionEntry, { kind: 'lifecycle' }> |
  Omit<Extract<ProjectionEntry, { kind: 'lifecycle' }>, 'commandKind'>;
export interface ThinkSnapshot extends ConversationState {
  entries: ThinkManifestEntry[];
  contentHealth?: 'complete' | 'incomplete';
  nextCursor?: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const identifier = /^[A-Za-z0-9_-]{1,128}$/;
const obj = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const ident = (value: unknown): value is string => typeof value === 'string' && identifier.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const choices = <T extends string>(value: unknown, allowed: readonly T[]): value is T => typeof value === 'string' && allowed.some(item => item === value);

function bodyRef(value: unknown, conversationId: string, epoch: string): BodyRef {
  if (!obj(value) || !obj(value.key) || value.key.conversationId !== conversationId || !obj(value.key.owner) ||
      value.epoch !== epoch || !id(value.contentId) || !id(value.generation) || !number(value.through) ||
      !choices(value.kind, ['preview', 'canonical'])) throw new Error('invalid body reference');
  const owner = value.key.owner;
  let projected: BodyOwner;
  if (owner.kind === 'original' && id(owner.clientCommandId) && ident(owner.messageId)) projected = { kind: owner.kind, clientCommandId: owner.clientCommandId, messageId: owner.messageId };
  else if (owner.kind === 'assistant-text' && ident(owner.messageId) && number(owner.ordinal)) projected = { kind: owner.kind, messageId: owner.messageId, ordinal: owner.ordinal };
  else if (owner.kind === 'form-reply' && id(owner.clientCommandId) && ident(owner.decisionId)) projected = { kind: owner.kind, clientCommandId: owner.clientCommandId, decisionId: owner.decisionId };
  else throw new Error('invalid body owner');
  const base = { key: { conversationId, owner: projected }, epoch, contentId: value.contentId, generation: value.generation, through: value.through };
  if (value.kind === 'canonical') {
    if (typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error('invalid body digest');
    return { ...base, kind: 'canonical', sha256: value.sha256 };
  }
  return { ...base, kind: 'preview' };
}

function entry(value: unknown, conversationId: string, epoch: string): ThinkManifestEntry {
  if (!obj(value) || !number(value.displayOrder)) throw new Error('invalid entry');
  const base = { displayOrder: value.displayOrder };
  if (value.kind === 'original' && id(value.clientCommandId) && ident(value.messageId) || value.kind === 'form-reply' && id(value.clientCommandId) && ident(value.decisionId) || value.kind === 'assistant-text' && ident(value.messageId) && number(value.ordinal) && choices(value.closure, ['open', 'closed']) && choices(value.capture, ['complete', 'incomplete', 'unknown'])) {
    const body = bodyRef(value.body, conversationId, epoch);
    const owner = body.key.owner;
    if (value.kind === 'original' && id(value.clientCommandId) && ident(value.messageId) && owner.kind === 'original' && owner.clientCommandId === value.clientCommandId && owner.messageId === value.messageId)
      return { ...base, kind: 'original', clientCommandId: value.clientCommandId, messageId: value.messageId, body };
    if (value.kind === 'form-reply' && id(value.clientCommandId) && ident(value.decisionId) && owner.kind === 'form-reply' && owner.clientCommandId === value.clientCommandId && owner.decisionId === value.decisionId)
      return { ...base, kind: 'form-reply', clientCommandId: value.clientCommandId, decisionId: value.decisionId, body };
    if (value.kind === 'assistant-text' && ident(value.messageId) && number(value.ordinal) && choices(value.closure, ['open', 'closed']) && choices(value.capture, ['complete', 'incomplete', 'unknown']) && owner.kind === 'assistant-text' && owner.messageId === value.messageId && owner.ordinal === value.ordinal)
      return { ...base, kind: 'assistant-text', messageId: value.messageId, ordinal: value.ordinal, closure: value.closure, capture: value.capture, body };
    throw new Error('body ownership mismatch');
  }
  if (value.kind === 'tool' && ident(value.messageId) && ident(value.toolCallId) && choices(value.category, ['file-read', 'file-write', 'shell', 'search', 'subagent', 'custom']) && choices(value.state, ['started', 'completed', 'failed', 'interrupted', 'unknown']) && (value.sourceTime === undefined || number(value.sourceTime)) && (value.durationMs === undefined || number(value.durationMs))) return { ...base, kind: 'tool', messageId: value.messageId, toolCallId: value.toolCallId, category: value.category, state: value.state, ...(value.sourceTime === undefined ? {} : { sourceTime: value.sourceTime }), ...(value.durationMs === undefined ? {} : { durationMs: value.durationMs }) };
  if (value.kind === 'compaction' && ident(value.sessionId) && ident(value.eventId) && choices(value.phase, ['started', 'ended', 'failed']) &&
      number(value.sourceTime) && value.sourceTime <= 8640000000000000 && number(value.sourceSequence)) {
    return { ...base, kind: 'compaction', sessionId: value.sessionId, eventId: value.eventId, phase: value.phase, sourceTime: value.sourceTime, sourceSequence: value.sourceSequence };
  }
  if (value.kind === 'original-capture' && choices(value.commandKind, ['send', 'form-reply']) && id(value.clientCommandId) &&
      choices(value.state, ['pending', 'captured', 'failed']) && number(value.sourceTime) && value.sourceTime <= 8640000000000000 &&
      (value.runId === undefined || id(value.runId))) {
    return { ...base, kind: 'original-capture', commandKind: value.commandKind, clientCommandId: value.clientCommandId, state: value.state, sourceTime: value.sourceTime,
      ...(value.runId === undefined ? {} : { runId: value.runId }) };
  }
  if (value.kind === 'lifecycle' && id(value.clientCommandId) && (value.runId === undefined || id(value.runId)) && choices(value.state, ['registered', 'ready', 'upstream-unconfirmed', 'rejected', 'admitted', 'monitor-unavailable', 'cancelled-before-delivery', 'completed', 'failed', 'interrupted', 'requested', 'replied', 'stale']) && (value.sourceTime === undefined || number(value.sourceTime))) return { ...base, kind: 'lifecycle', clientCommandId: value.clientCommandId, state: value.state, ...(value.runId === undefined ? {} : { runId: value.runId }), ...(value.sourceTime === undefined ? {} : { sourceTime: value.sourceTime }) };
  throw new Error('invalid projection entry');
}

function transcriptHealth(value: unknown, conversationId: string): TranscriptHealth {
  if (!obj(value) || !choices(value.state, ['not-started', 'writing', 'up-to-date', 'degraded', 'retrying']) ||
      typeof value.warning !== 'boolean' || typeof value.liveTextPending !== 'boolean' ||
      (value.reason !== undefined && !choices(value.reason, ['io_unavailable', 'conflict', 'content_gap', 'invalid_configuration'])) ||
      (value.lastSyncedAt !== undefined && (typeof value.lastSyncedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.lastSyncedAt)))) throw new Error('invalid transcript health');
  if (value.noteId !== undefined && (!Array.isArray(value.noteId) || value.noteId.length < 2 ||
      !value.noteId.every(component => typeof component === 'string' && component.length > 0 && !component.startsWith('.') && !/[/\\\0]/.test(component)) ||
      value.noteId[value.noteId.length - 1] !== `think-${conversationId}.md`)) throw new Error('invalid transcript identity');
  return { state: value.state, warning: value.warning, liveTextPending: value.liveTextPending,
    ...(value.reason === undefined ? {} : { reason: value.reason }), ...(value.lastSyncedAt === undefined ? {} : { lastSyncedAt: value.lastSyncedAt }),
    ...(value.noteId === undefined ? {} : { noteId: [...value.noteId] }) };
}

export function projectConversation(value: unknown, conversationId: string, snapshot: true): ThinkSnapshot;
export function projectConversation(value: unknown, conversationId: string, snapshot: false): ConversationState;
export function projectConversation(value: unknown, conversationId: string, snapshot: boolean): ConversationState | ThinkSnapshot;
export function projectConversation(value: unknown, conversationId: string, snapshot: boolean): ConversationState | ThinkSnapshot {
  if (!obj(value) || value.conversationId !== conversationId || !id(value.epoch) || !number(value.revision) || !choices(value.creation, ['registered', 'ready', 'upstream-unconfirmed', 'rejected']) ||
      !choices(value.sendEligibility, ['available', 'busy', 'unavailable']) ||
      (value.permissionCompatibility !== undefined && value.permissionCompatibility !== 'incompatible') || (value.permissionPending !== undefined && typeof value.permissionPending !== 'boolean')) throw new Error('invalid conversation');
  const result: ConversationState = { conversationId, epoch: value.epoch, revision: value.revision, creation: value.creation,
    sendEligibility: value.sendEligibility,
    ...(value.permissionCompatibility === undefined ? {} : { permissionCompatibility: value.permissionCompatibility }), ...(value.permissionPending === undefined ? {} : { permissionPending: value.permissionPending }) };
  if (value.transcript !== undefined) result.transcript = transcriptHealth(value.transcript, conversationId);
  if (value.otherTranscriptWarnings !== undefined) {
    if (!number(value.otherTranscriptWarnings)) throw new Error('invalid background transcript health');
    result.otherTranscriptWarnings = value.otherTranscriptWarnings;
  }
  if (snapshot) {
    if (!Array.isArray(value.entries) || value.entries.length > 50 || (value.contentHealth !== undefined && !choices(value.contentHealth, ['complete', 'incomplete'])) ||
        (value.nextCursor !== undefined && (typeof value.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,256}\.[a-f0-9]{64}$/.test(value.nextCursor)))) throw new Error('invalid manifest');
    const epoch = value.epoch;
    return { ...result, entries: value.entries.map(item => entry(item, conversationId, epoch)),
      ...(value.contentHealth === undefined ? {} : { contentHealth: value.contentHealth }),
      ...(value.nextCursor === undefined ? {} : { nextCursor: value.nextCursor }) };
  }
  return result;
}
