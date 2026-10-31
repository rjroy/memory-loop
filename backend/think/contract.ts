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

export type CommandReceipt = CreateReceipt | SendReceipt | StopReceipt | FormReplyReceipt;

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

export type ThinkUnavailableCode = 'think_unavailable' | 'think_config_missing' | 'think_config_invalid';
import type { FormField, SessionFormReplyInput } from '@opencode/client';
