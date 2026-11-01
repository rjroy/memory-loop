import { isVaultId } from '../../backend/contract';
import type { RecentConversation, RecentConversations, ViewRegistration, ViewSelection } from '../../backend/think/contract';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validViewToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43,256}$/.test(value);
export const validConversationId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const timestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

export function projectView(value: unknown, registration: true): ViewRegistration;
export function projectView(value: unknown, registration: false): ViewSelection;
export function projectView(value: unknown, registration: boolean): ViewRegistration | ViewSelection {
  if (!record(value) || typeof value.selectionRevision !== 'number' || !Number.isSafeInteger(value.selectionRevision) || value.selectionRevision < 0 ||
      !(value.conversationId === null || validConversationId(value.conversationId)) || !timestamp(value.expiresAt)) throw new Error('invalid view');
  const selection = { selectionRevision: value.selectionRevision, conversationId: value.conversationId, expiresAt: value.expiresAt };
  if (!registration) return selection;
  if (!validViewToken(value.viewToken) || value.selectionRevision !== 0 || value.conversationId !== null) throw new Error('invalid registration');
  return { ...selection, viewToken: value.viewToken };
}

function projectItem(value: unknown): RecentConversation {
  if (!record(value) || !validConversationId(value.conversationId) || !(value.title === null || typeof value.title === 'string' && !!value.title.trim() && Array.from(value.title).length <= 120) ||
      !timestamp(value.lastActivityAt) || !['ready', 'recovering', 'unavailable', 'deleting'].includes(String(value.state)) ||
      !record(value.resume) || typeof value.resume.available !== 'boolean' || !record(value.delete) || value.delete.available !== false) throw new Error('invalid conversation');
  const resumeReason = value.resume.reason;
  const deleteReason = value.delete.reason;
  if (resumeReason !== undefined && resumeReason !== 'recovering' && resumeReason !== 'unavailable' && resumeReason !== 'deleting' ||
      deleteReason !== undefined && deleteReason !== 'current' && deleteReason !== 'selected_elsewhere' && deleteReason !== 'running' && deleteReason !== 'status_unknown' && deleteReason !== 'deleting' ||
      value.transcriptNoteId !== undefined && (!isVaultId(value.transcriptNoteId) || !value.transcriptNoteId[value.transcriptNoteId.length - 1]?.endsWith('.md'))) throw new Error('invalid conversation fields');
  const state = value.state;
  if (state !== 'ready' && state !== 'recovering' && state !== 'unavailable' && state !== 'deleting') throw new Error('invalid conversation state');
  return { conversationId: value.conversationId, title: value.title, lastActivityAt: value.lastActivityAt, state,
    ...(value.transcriptNoteId === undefined ? {} : { transcriptNoteId: [...value.transcriptNoteId as string[]] }),
    resume: { available: value.resume.available, ...(resumeReason === undefined ? {} : { reason: resumeReason }) },
    delete: { available: value.delete.available, ...(deleteReason === undefined ? {} : { reason: deleteReason }) } };
}

export function projectRecentConversations(value: unknown, status: number): RecentConversations | { state: 'unavailable' } {
  if (!record(value)) throw new Error('invalid list');
  if (status === 503 && value.state === 'unavailable') return { state: 'unavailable' };
  if (status !== 200 || value.state !== 'ready' || !Array.isArray(value.items) || value.items.length > 10) throw new Error('invalid list');
  const items = value.items.map(projectItem);
  if (new Set(items.map(item => item.conversationId)).size !== items.length) throw new Error('duplicate conversation');
  return { state: 'ready', items };
}
