import type { BodyRef } from '../../backend/think/body-store';
import type { CreateFailureCode, CreateState, FormReplyCommand, FormReplyReceipt, SendReceipt, StopReceipt, TranscriptHealth } from '../../backend/think/contract';
import type { ThinkFormField } from './client';
import type { CaptureCompleteness, ToolCategory, ToolState } from '../../backend/think/projection';

/** Epoch is absent until the selected conversation is authoritatively opened. */
export interface ThinkKnownIdentity { readonly conversationId: string; readonly epoch: string }
export type ThinkIdentity =
  | ThinkKnownIdentity
  | { readonly conversationId: string; readonly epoch: null };

export interface ThinkDraft {
  readonly text: string;
  /** Incremented on each edit, including deliberate restoration of rejected text. */
  readonly version: number;
}

export type ThinkHandoffSource = 'quickActions' | 'prompts' | 'conversations';
export interface ThinkPrefillRequest {
  readonly kind: 'fresh-prefill';
  readonly text: string;
  readonly source: 'quickActions' | 'prompts';
  readonly triggerId: string;
}
export interface ThinkResumeRequest {
  readonly kind: 'resume';
  readonly conversationId: string;
  readonly source: 'conversations';
  readonly triggerId: string;
}
export type ThinkHandoffRequest = ThinkPrefillRequest | ThinkResumeRequest;
export interface ThinkHandoffState {
  readonly source: ThinkHandoffSource;
  readonly triggerId: string;
  readonly phase: 'confirm' | 'starting' | 'checking' | 'unavailable' | 'rejected' | 'stale';
  readonly canCheck: boolean;
  readonly kind: ThinkHandoffRequest['kind'];
}
export interface ThinkMessageFocus { readonly conversationId: string; readonly token: string; readonly immediate?: boolean }

/** The last verified text remains visible while a newer generation is loaded. */
export type ThinkTextContent =
  | { readonly state: 'unloaded'; readonly ref: BodyRef; readonly previousText?: never }
  | { readonly state: 'loading'; readonly ref: BodyRef; readonly previousText?: string }
  | { readonly state: 'ready'; readonly ref: BodyRef; readonly text: string }
  | { readonly state: 'replacing'; readonly ref: BodyRef; readonly previousText: string }
  | { readonly state: 'error'; readonly ref: BodyRef; readonly previousText?: string; readonly reason: 'unavailable' | 'unsupported' };

export interface ThinkMessagePart {
  readonly messageId: string;
  readonly ordinal: number;
  readonly content: ThinkTextContent;
  readonly closure: 'open' | 'closed';
  readonly capture: CaptureCompleteness;
}

export type ThinkAdmission =
  | { readonly state: 'submitting'; readonly clientCommandId: string }
  | { readonly state: 'checking'; readonly clientCommandId: string; readonly runId?: string }
  | { readonly state: 'registered' | 'admitted'; readonly clientCommandId: string; readonly runId: string }
  | { readonly state: 'cancelled-before-delivery' | 'completed' | 'failed' | 'interrupted' | 'rejected'; readonly clientCommandId: string; readonly runId: string; readonly failure?: SendReceipt['failure'] };

export type ThinkActivity =
  | { readonly kind: 'tool'; readonly id: string; readonly messageId: string; readonly category: ToolCategory; readonly state: ToolState; readonly durationMs?: number; readonly sourceTime?: number }
  | { readonly kind: 'compaction'; readonly id: string; readonly phase: 'started' | 'ended' | 'failed'; readonly sourceTime: number };

export type ThinkMessage =
  | { readonly role: 'user'; readonly messageId: string; readonly displayOrder: number; readonly parts: readonly ThinkMessagePart[]; readonly admission?: ThinkAdmission }
  | { readonly role: 'assistant'; readonly messageId: string; readonly displayOrder: number; readonly parts: readonly ThinkMessagePart[]; readonly activity: readonly ThinkActivity[] };

/** A Send control never doubles as a Stop shortcut. */
export type ThinkComposerAction =
  | { readonly kind: 'send'; readonly eligible: boolean; readonly reason?: 'empty' | 'opening' | 'busy' | 'unavailable' | 'resynchronizing' }
  | { readonly kind: 'stop'; readonly runId: string; readonly state: 'available' | 'requesting' | 'retry' | 'unavailable'; readonly receiptState?: StopReceipt['state'] }
  | { readonly kind: 'checking' };

export type ThinkMonitoring = 'opening' | 'following' | 'reconnecting' | 'resynchronizing' | 'denied' | 'service-changed' | 'unavailable';
export type ThinkRun =
  | { readonly state: 'none' | 'unknown' }
  | { readonly state: 'working' | 'completed' | 'failed' | 'interrupted' | 'cancelled-before-delivery'; readonly runId: string };

/** Only server-classified persistent symptoms, not ordinary transient retries. */
export interface ThinkTranscriptWarning {
  readonly current?: { readonly reason?: NonNullable<TranscriptHealth['reason']> };
  readonly otherCount: number;
}

export type ThinkQuestionDetail = { readonly state: 'ready'; readonly title: string; readonly fields: ReadonlyArray<Readonly<ThinkFormField>> };

export interface ThinkQuestion {
  readonly decisionId: string;
  readonly detail: ThinkQuestionDetail;
  readonly answer: Readonly<FormReplyCommand['answer']>;
  readonly reply: 'idle' | FormReplyReceipt['state'];
}

export type ThinkHistory = { readonly state: 'loading' | 'complete' | 'unavailable' };

export interface ThinkRejectedSubmission {
  readonly clientCommandId: string;
  readonly text: string;
  readonly reason: 'resource_failure' | 'unavailable' | 'unknown';
}

export interface ThinkPresentationState {
  readonly identity: ThinkIdentity | null;
  readonly revision: number | null;
  readonly creation: CreateState | 'opening' | 'missing' | 'unavailable';
  readonly creationFailure?: CreateFailureCode;
  readonly messages: readonly ThinkMessage[];
  /** Captured submission not yet represented by a manifest entry. */
  readonly pendingSubmission?: { readonly clientCommandId: string; readonly text: string; readonly admission: ThinkAdmission };
  readonly backgroundActivity: readonly ThinkActivity[];
  readonly draft: ThinkDraft;
  readonly composer: ThinkComposerAction;
  readonly run: ThinkRun;
  readonly monitoring: ThinkMonitoring;
  readonly contentHealth?: 'complete' | 'incomplete';
  readonly permissionCompatibility?: 'incompatible';
  readonly permissionPending?: boolean;
  readonly transcriptWarning?: ThinkTranscriptWarning;
  readonly questions: readonly ThinkQuestion[];
  readonly history: ThinkHistory;
  readonly newChat: 'idle' | 'confirm-discard' | 'starting' | 'unavailable';
  readonly rejectedSubmissions: readonly ThinkRejectedSubmission[];
  /** One explicit Ground handoff, not routine route/message focus. */
  readonly messageFocus?: ThinkMessageFocus;
  readonly preparedDraft?: boolean;
  readonly selectionUnavailable?: boolean;
  readonly mutationsAvailable?: boolean;
}

/** Identity arguments bind delayed actions to the chat that originated them. */
export interface ThinkPresentationActions {
  editDraft(text: string): void;
  send(identity: ThinkKnownIdentity, draftVersion: number): void;
  stop(identity: ThinkKnownIdentity, runId: string): void;
  requestNewChat(): void;
  cancelNewChat(): void;
  confirmNewChat(): void;
  checkConnection(): void;
  retryBody(identity: ThinkKnownIdentity, ref: BodyRef): void;
  editQuestion(identity: ThinkKnownIdentity, decisionId: string, answer: FormReplyCommand['answer']): void;
  replyQuestion(identity: ThinkKnownIdentity, decisionId: string, answer: FormReplyCommand['answer']): void;
  recoverRejected(identity: ThinkKnownIdentity, clientCommandId: string, replaceDraftVersion?: number): void;
  claimMessageFocus?(token: string): boolean;
  startPreparedDraft?(): void;
}

export interface ThinkPresentation {
  readonly state: ThinkPresentationState;
  readonly actions: ThinkPresentationActions;
}

export interface ThinkPresenterProps {
  readonly presentation: ThinkPresentation;
}
