/** Browser-owned identifiers remain stable across retries of the same create. */
export interface CreateConversationCommand {
  conversationId: string;
  clientCommandId: string;
}

export type CreateState = 'registered' | 'ready' | 'upstream-unconfirmed' | 'rejected';

/** Public categories only; native error details are not part of the contract. */
export type CreateFailureCode = 'upstream_rejected' | 'ownership_mismatch' | 'configuration_invalid' | 'service_unavailable';

interface CreateReceiptBase extends CreateConversationCommand {
  kind: 'create';
  epoch: string;
}

export type CreateReceipt = CreateReceiptBase & (
  | { state: Exclude<CreateState, 'rejected'>; failure?: never }
  | { state: 'rejected'; failure: { code: CreateFailureCode } }
);

export interface SendCommand extends CreateConversationCommand { text: string }
export interface StopCommand extends CreateConversationCommand { runId: string }

export interface SendReceipt extends CreateConversationCommand {
  kind: 'send';
  runId: string;
  epoch: string;
  state: 'registered' | 'admitted' | 'upstream-unconfirmed' | 'monitor-unavailable' | 'cancelled-before-delivery' | 'completed' | 'failed' | 'interrupted' | 'rejected';
  failure?: { code: 'execution_failed' | 'resource_failure' };
}

export interface StopReceipt extends StopCommand {
  kind: 'stop';
  epoch: string;
  state: 'registered' | 'requested' | 'upstream-unconfirmed' | 'cancelled-before-delivery';
}

export interface FormDecision {
  conversationId: string;
  decisionId: string;
  kind: 'form';
  title: string;
  fields: Array<Exclude<FormField, { type: 'external' }>>;
}

export interface FormReplyCommand extends CreateConversationCommand {
  decisionId: string;
  answer: SessionFormReplyInput['answer'];
}

export interface FormReplyReceipt extends CreateConversationCommand {
  kind: 'form-reply';
  decisionId: string;
  epoch: string;
  state: 'registered' | 'replied' | 'upstream-unconfirmed' | 'stale' | 'rejected';
  failure?: { code: 'resource_failure' };
}

export type ResumeReceipt = CreateConversationCommand & { kind: 'resume'; epoch: string } & (
  | { state: 'registered' | 'ready' | 'upstream-unconfirmed'; failure?: never }
  | { state: 'rejected'; failure: { code: 'ownership_mismatch' | 'service_unavailable' } }
);
export interface ViewSelection { selectionRevision: number; conversationId: string | null; expiresAt: string }
export interface ViewRegistration extends ViewSelection { viewToken: string }
export interface SelectConversationCommand { viewToken: string; expectedRevision: number; conversationId: string | null }
export interface RecentConversation {
  conversationId: string; title: string | null; lastActivityAt: string; transcriptNoteId?: string[];
  state: 'ready' | 'recovering' | 'unavailable' | 'deleting';
  resume: { available: boolean; reason?: 'recovering' | 'unavailable' | 'deleting' };
  delete: { available: boolean; reason?: 'current' | 'selected_elsewhere' | 'running' | 'status_unknown' | 'deleting' };
}
export interface RecentConversations { state: 'ready'; items: RecentConversation[] }
export type CommandReceipt = CreateReceipt | SendReceipt | StopReceipt | FormReplyReceipt | ResumeReceipt;

export interface TranscriptHealth {
  state: 'not-started' | 'writing' | 'up-to-date' | 'degraded' | 'retrying';
  warning: boolean;
  liveTextPending: boolean;
  reason?: 'io_unavailable' | 'conflict' | 'content_gap' | 'invalid_configuration';
  lastSyncedAt?: string;
  /** Ordinary Recall identity, never an absolute path or private body-cache locator. */
  noteId?: string[];
}

export interface ConversationState {
  conversationId: string;
  epoch: string;
  revision: number;
  creation: CreateState;
  sendEligibility: 'available' | 'busy' | 'unavailable';
  permissionCompatibility?: 'incompatible';
  permissionPending?: boolean;
  transcript?: TranscriptHealth;
  otherTranscriptWarnings?: number;
}

export const thinkErrors = {
  invalid_request: { status: 400, message: 'Invalid Think request' },
  command_conflict: { status: 409, message: 'Command conflicts with a previous request' },
  selection_conflict: { status: 409, message: 'Think selection has changed' },
  lease_unavailable: { status: 403, message: 'Think view is unavailable' },
  not_found: { status: 404, message: 'Think resource not found' },
  think_unavailable: { status: 503, message: 'Think service is unavailable' },
  think_config_missing: { status: 503, message: 'Think setup is required' },
  think_config_invalid: { status: 503, message: 'Think configuration is invalid' },
  decision_unavailable: { status: 503, message: 'Decision details are unavailable' },
  content_unavailable: { status: 404, message: 'Content is unavailable' },
} as const;

export type ThinkErrorCode = keyof typeof thinkErrors;
export function isThinkErrorCode(value: unknown): value is ThinkErrorCode {
  return typeof value === 'string' && Object.hasOwn(thinkErrors, value);
}

export type ThinkUnavailableCode = Extract<ThinkErrorCode, 'think_unavailable' | 'think_config_missing' | 'think_config_invalid'>;
import type { FormField, SessionFormReplyInput } from '@opencode/client';
