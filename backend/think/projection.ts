import type { BodyReader, BodyRef } from './body-store';
import type { CommandReceipt } from './contract';

export type CaptureCompleteness = 'complete' | 'incomplete' | 'unknown';
export type ToolCategory = 'file-read' | 'file-write' | 'shell' | 'search' | 'subagent' | 'custom';
export type ToolState = 'started' | 'completed' | 'failed' | 'interrupted' | 'unknown';
export type OriginalCaptureState = 'pending' | 'captured' | 'failed';

interface ProjectionEntryBase {
  /** Stable ordering within the conversation projection. */
  displayOrder: number;
  /** Known correlation only; background output need not belong to a user Send. */
  runId?: string;
  sourceTime?: number;
}

export type ProjectionEntry =
  | (ProjectionEntryBase & { kind: 'original'; clientCommandId: string; messageId: string; body: BodyRef })
  | (ProjectionEntryBase & { kind: 'assistant-text'; messageId: string; ordinal: number; body: BodyRef; closure: 'open' | 'closed'; capture: CaptureCompleteness })
  | (ProjectionEntryBase & { kind: 'form-reply'; clientCommandId: string; decisionId: string; body: BodyRef })
  /** Private retention result, independent of admission/cancellation and vault synchronization. */
  | (ProjectionEntryBase & { kind: 'original-capture'; commandKind: 'send' | 'form-reply'; clientCommandId: string; state: OriginalCaptureState; sourceTime: number })
  | (ProjectionEntryBase & { kind: 'tool'; messageId: string; toolCallId: string; category: ToolCategory; state: ToolState; sourceTime?: number; durationMs?: number })
  /** Observed live boundary only; the native summary/error/provider payload is deliberately absent. */
  | (ProjectionEntryBase & { kind: 'compaction'; sessionId: string; eventId: string; phase: 'started' | 'ended' | 'failed'; sourceTime: number; sourceSequence: number })
  | (ProjectionEntryBase & { kind: 'lifecycle'; commandKind: CommandReceipt['kind']; clientCommandId: string; runId?: string; state: CommandReceipt['state']; sourceTime?: number });

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
