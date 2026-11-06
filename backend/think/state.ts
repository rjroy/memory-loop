import type { SessionCreateInput } from '@opencode/client';
import type { CommandReceipt, CreateReceipt, DeleteBlockReason, DeleteReceipt } from './contract';
import type { NativeSession } from './native';

export interface ThinkOwner {
  owner: 'memory-loop';
  conversationId: string;
  epoch: string;
  installationId?: string;
}

export interface OwnedConversation {
  conversationId: string;
  nativeSessionId: string;
  directory: string;
  owner: ThinkOwner;
  agent?: string;
  model?: NonNullable<SessionCreateInput['model']>;
}

export interface StoredCommand {
  receipt: CommandReceipt;
  payloadSha256: string | null;
  original: Uint8Array | null;
  registeredAt: number;
  attempted: boolean;
  /** Optional for old admission-only adapters; null is never permission to guess an association. */
  nativeMessageId?: string | null;
}

export interface RegisteredConversation extends OwnedConversation {
  createdAt: number;
  creation: CreateReceipt['state'];
  selection: Pick<NativeSession, 'agent' | 'model' | 'permissions'> | null;
  purpose: 'think' | 'ground-generation';
  lifecycle: 'live' | 'deleting';
  rowVersion: number;
}
export interface CanonicalActivity { messageId: string; ordinal: number; sha256: string; length: number; at: number }
export interface RecentRegistration {
  conversationId: string; title: string | null; lastActivityAt: number; rowVersion: number;
  lifecycle: RegisteredConversation['lifecycle']; owner: RegisteredConversation | null; uncertain: boolean;
}
export interface StoredView { conversationId: string | null; selectionRevision: number; expiresAt: number }
export interface StoredDeletion {
  receipt: DeleteReceipt;
  registeredAt: number;
  fence: number;
  nativeAttempted: boolean;
  nativeRemoved: boolean;
  transcriptRemoved: boolean;
}
export interface CacheNamespace {
  conversationId: string; epoch: string; path: string;
  root: TranscriptDirectoryIdentity; directory: TranscriptDirectoryIdentity | null;
}
export interface BodyCacheStateStore {
  intent(namespace: CacheNamespace): void;
  acquire(conversationId: string, epoch: string, identity: TranscriptDirectoryIdentity): void;
  namespaces(conversationId: string, afterEpoch?: string): CacheNamespace[];
  removed(conversationId: string, epoch: string): void;
}
/** Concrete, restartable paired removal facts. No operation performs external I/O. */
export interface DeletionStateStore {
  get(commandId: string): StoredDeletion | null;
  pending(directory: string, after?: string): StoredDeletion[];
  blocked(conversationId: string): boolean;
  accept(receipt: DeleteReceipt, viewHash: string, revision: number, rowVersion: number, directory: string, now: number): StoredDeletion;
  attempted(commandId: string): void;
  progress(commandId: string, effect: 'native' | 'transcript'): void;
  pendingReason(commandId: string, reason: NonNullable<DeleteReceipt['reason']>): void;
  complete(commandId: string): void;
}
/** Concrete recent-chat/selection operations; all writes are short local transactions. */
export interface ConversationStateStore {
  recent(directory: string): RecentRegistration[];
  canonical(conversationId: string, facts: readonly CanonicalActivity[]): void;
  mintView(tokenHash: string, now: number): StoredView;
  view(tokenHash: string, now: number): StoredView | null;
  select(tokenHash: string, revision: number, conversationId: string | null, now: number, directory: string): StoredView;
  protection(conversationId: string, tokenHash: string | null, now: number): 'current' | 'selected_elsewhere' | undefined;
}
export interface CommandPosition { commandId: string }
export interface ThinkRegistryReader {
  conversation(conversationId: string): RegisteredConversation | null;
  /** Bounded keyset page in durable registration order, independent of timestamps and command IDs. */
  commands(conversationId: string, after?: CommandPosition): StoredCommand[];
}

/** Exact `dev`/`ino` as canonical decimal strings (see ../file-identity); persisted as TEXT. */
export interface TranscriptDirectoryIdentity { dev: string; ino: string }
export interface TranscriptFileCheckpoint extends TranscriptDirectoryIdentity {
  fingerprint: string;
  offset: number;
  sha256: string;
}
export interface TranscriptAppendIdentity {
  id: string;
  semantic: string;
  sourceIdentity: string;
  header: boolean;
  length: number;
  original?: { commandId: string; kind: 'send' | 'form-reply'; sha256: string; length: number };
}
export interface StoredTranscript {
  conversationId: string;
  noteId: string[];
  createdAt: number;
  namespace: TranscriptDirectoryIdentity[];
  file: TranscriptFileCheckpoint | null;
  pending: (TranscriptAppendIdentity & { state: 'preparing' | 'ready'; sha256: string | null; chunks: number }) | null;
}
export interface StoredTranscriptEntry {
  id: string;
  semantic: string;
  sourceIdentity: string;
}
export interface ConfirmedTranscriptEntry extends StoredTranscriptEntry { endOffset: number }
/** Transcript-only facts. Chunk calls and transactions never perform filesystem/native I/O. */
export interface TranscriptStateStore {
  load(conversationId: string, vaultDirectory: string): StoredTranscript | null;
  pending(vaultDirectory: string, after?: string): string[];
  intent(conversationId: string, vaultDirectory: string, noteId: string[], createdAt: number, namespace: TranscriptDirectoryIdentity[]): void;
  acquire(conversationId: string, identity: TranscriptFileCheckpoint): void;
  entry(conversationId: string, entryId: string): StoredTranscriptEntry | null;
  latest(conversationId: string, semantic: string): StoredTranscriptEntry | null;
  /** SQLite supplies this bounded read; older writer-only adapters need not enumerate facts. */
  confirmed?(conversationId: string, afterEntryId?: string): ConfirmedTranscriptEntry[];
  begin(conversationId: string, append: TranscriptAppendIdentity): void;
  chunk(conversationId: string, index: number): Uint8Array | null;
  stage(conversationId: string, index: number, bytes: Uint8Array): void;
  seal(conversationId: string, sha256: string): void;
  confirm(conversationId: string, entryId: string, checkpoint: TranscriptFileCheckpoint): void;
}

export class ThinkStateError extends Error {
  constructor(readonly code: 'conflict' | 'unavailable' | 'selection_conflict' | 'lease_unavailable' | 'not_found' | 'delete_blocked', readonly reason?: DeleteBlockReason) {
    super('Think durable state is unavailable or conflicts with this command');
    this.name = 'ThinkStateError';
  }
}

/** Synchronous, short local transactions. No method dispatches native work or hydrates a chat. */
export interface ThinkStateStore {
  readonly installationId: string;
  /** Optional only for pre-existing controlled admission-only test adapters. SQLite always supplies it. */
  readonly transcripts?: TranscriptStateStore;
  /** SQLite supplies registry reads; admission-only controlled adapters may omit them. */
  readonly registry?: ThinkRegistryReader;
  readonly conversations: ConversationStateStore;
  readonly deletions: DeletionStateStore;
  readonly cache: BodyCacheStateStore;
  command(commandId: string): StoredCommand | null;
  registerConversation(conversation: OwnedConversation, receipt: CreateReceipt, registeredAt: number): void;
  registerCommand(receipt: Exclude<CommandReceipt, CreateReceipt>, original: Uint8Array | null, digest: string | null, registeredAt: number): void;
  attempted(commandId: string): void;
  outcome(receipt: CommandReceipt, verifiedSelection?: Pick<NativeSession, 'agent' | 'model' | 'permissions'>): void;
  close(): void;
}
