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

export class ThinkStateError extends Error {
  constructor(readonly code: 'conflict' | 'unavailable') {
    super('Think durable state is unavailable or conflicts with this command');
    this.name = 'ThinkStateError';
  }
}

/** Synchronous, short local transactions. No method dispatches native work or hydrates a chat. */
export interface ThinkStateStore {
  readonly installationId: string;
  command(commandId: string): StoredCommand | null;
  registerConversation(conversation: OwnedConversation, receipt: CreateReceipt, registeredAt: number): void;
  registerCommand(receipt: Exclude<CommandReceipt, CreateReceipt>, original: Uint8Array | null, digest: string | null, registeredAt: number): void;
  attempted(commandId: string): void;
  outcome(receipt: CommandReceipt, verifiedSelection?: Pick<NativeSession, 'agent' | 'model' | 'permissions'>): void;
  close(): void;
}
