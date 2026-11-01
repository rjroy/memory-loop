import type { SessionCreateInput } from '@opencode/client';
import type { CommandReceipt, CreateReceipt } from './contract';
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
}

export interface TranscriptDirectoryIdentity { dev: number; ino: number }
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
/** Transcript-only facts. Chunk calls and transactions never perform filesystem/native I/O. */
export interface TranscriptStateStore {
  load(conversationId: string, vaultDirectory: string): StoredTranscript | null;
  pending(vaultDirectory: string, after?: string): string[];
  intent(conversationId: string, vaultDirectory: string, noteId: string[], createdAt: number, namespace: TranscriptDirectoryIdentity[]): void;
  acquire(conversationId: string, identity: TranscriptFileCheckpoint): void;
  entry(conversationId: string, entryId: string): StoredTranscriptEntry | null;
  latest(conversationId: string, semantic: string): StoredTranscriptEntry | null;
  begin(conversationId: string, append: TranscriptAppendIdentity): void;
  chunk(conversationId: string, index: number): Uint8Array | null;
  stage(conversationId: string, index: number, bytes: Uint8Array): void;
  seal(conversationId: string, sha256: string): void;
  confirm(conversationId: string, entryId: string, checkpoint: TranscriptFileCheckpoint): void;
}

export class ThinkStateError extends Error {
  constructor(readonly code: 'conflict' | 'unavailable') {
    super('Think durable state is unavailable or conflicts with this command');
    this.name = 'ThinkStateError';
  }
}

/** Synchronous, short local transactions. No method dispatches native work or hydrates a chat. */
export interface ThinkStateStore {
  readonly installationId: string;
  /** Optional only for pre-existing controlled admission-only test adapters. SQLite always supplies it. */
  readonly transcripts?: TranscriptStateStore;
  command(commandId: string): StoredCommand | null;
  registerConversation(conversation: OwnedConversation, receipt: CreateReceipt, registeredAt: number): void;
  registerCommand(receipt: Exclude<CommandReceipt, CreateReceipt>, original: Uint8Array | null, digest: string | null, registeredAt: number): void;
  attempted(commandId: string): void;
  outcome(receipt: CommandReceipt, verifiedSelection?: Pick<NativeSession, 'agent' | 'model' | 'permissions'>): void;
  close(): void;
}
