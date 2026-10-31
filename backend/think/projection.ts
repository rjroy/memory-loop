import type { BodyReader, BodyRef } from './body-store';
import type { CreateReceipt, FormReplyReceipt, SendReceipt, StopReceipt } from './contract';

export type CaptureCompleteness = 'complete' | 'incomplete' | 'unknown';
export type ToolCategory = 'file-read' | 'file-write' | 'shell' | 'search' | 'subagent' | 'custom';
export type ToolState = 'started' | 'completed' | 'failed' | 'interrupted' | 'unknown';

interface ProjectionEntryBase {
  /** Stable ordering within the conversation projection. */
  displayOrder: number;
}

export type ProjectionEntry =
  | (ProjectionEntryBase & { kind: 'original'; clientCommandId: string; messageId: string; body: BodyRef })
  | (ProjectionEntryBase & { kind: 'assistant-text'; messageId: string; ordinal: number; body: BodyRef; closure: 'open' | 'closed'; capture: CaptureCompleteness })
  | (ProjectionEntryBase & { kind: 'form-reply'; clientCommandId: string; decisionId: string; body: BodyRef })
  | (ProjectionEntryBase & { kind: 'tool'; messageId: string; toolCallId: string; category: ToolCategory; state: ToolState; sourceTime?: number; durationMs?: number })
  | (ProjectionEntryBase & { kind: 'lifecycle'; clientCommandId: string; runId?: string; state: CreateReceipt['state'] | SendReceipt['state'] | StopReceipt['state'] | FormReplyReceipt['state']; sourceTime?: number });

export interface ProjectionPage {
  conversationId: string;
  epoch: string;
  revision: number;
  entries: ProjectionEntry[];
  contentHealth?: 'complete' | 'incomplete';
  /** Opaque continuation; absence means no further page. */
  nextCursor?: string;
}

/** Internal reader; page implementations bound both item count and encoded bytes. */
export interface ThinkContentReader {
  page(conversationId: string, cursor?: string): Promise<ProjectionPage>;
  open(ref: BodyRef): Promise<BodyReader>;
}
