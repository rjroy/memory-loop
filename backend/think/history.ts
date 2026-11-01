import { createHash } from 'node:crypto';
import type { MessageListOutput, SessionMessageInfo } from '@opencode/client';
import type { BodyRef, BodyStore } from './body-store';
import type { ProjectionEntry, ToolCategory } from './projection';
import type { CommandPosition, StoredCommand, ThinkRegistryReader, TranscriptStateStore } from './state';

const bytes = async function* (value: Uint8Array): AsyncIterable<Uint8Array> { yield value; };
export const textIdentity = (messageId: string, ordinal: number) => JSON.stringify([messageId, ordinal]);
export const terminalSend = (state: string) => ['completed', 'failed', 'interrupted', 'cancelled-before-delivery', 'rejected'].includes(state);

/** Shared ordinary-history projection. Text ordinals exclude reasoning/tools; raw payloads never escape. */
export async function projectNativeMessage(conversationId: string, message: SessionMessageInfo, bodies: BodyStore,
  existing: readonly ProjectionEntry[], runId?: string, missingUnfinished = false): Promise<{ entries: ProjectionEntry[]; succeeded: string[]; missing: string[] }> {
  const result: Awaited<ReturnType<typeof projectNativeMessage>> = { entries: [], succeeded: [], missing: [] };
  if (message.type !== 'assistant') return result;
  let ordinal = 0;
  for (const part of message.content) {
    if (part.type === 'text') {
      const at = ordinal++;
      const key = textIdentity(message.id, at);
      if (message.time.completed === undefined) { if (missingUnfinished) result.missing.push(key); continue; }
      const previous = existing.find(entry => entry.kind === 'assistant-text' && entry.messageId === message.id && entry.ordinal === at);
      try {
        const digest = createHash('sha256').update(part.text, 'utf8').digest('hex');
        const body = previous?.kind === 'assistant-text' && previous.body.kind === 'canonical' &&
          previous.body.sha256 === digest && previous.body.through === Buffer.byteLength(part.text) ? previous.body
          : await bodies.replace({ conversationId, owner: { kind: 'assistant-text', messageId: message.id, ordinal: at } }, bytes(Buffer.from(part.text)), 'canonical');
        result.entries.push({ kind: 'assistant-text', messageId: message.id, ordinal: at, body, closure: 'closed', capture: 'complete',
          displayOrder: 0, sourceTime: message.time.created, ...(previous?.runId ? { runId: previous.runId } : runId ? { runId } : {}) });
        result.succeeded.push(key);
      } catch {
        result.missing.push(key);
        if (previous?.kind === 'assistant-text') result.entries.push({ ...previous, capture: 'incomplete' });
        console.info('think_content_outcome', { status: 'unavailable' });
      }
    } else if (part.type === 'tool') {
      const category: ToolCategory = part.name === 'read' ? 'file-read' : ['write', 'edit'].includes(part.name) ? 'file-write'
        : part.name === 'bash' ? 'shell' : ['grep', 'glob', 'search'].includes(part.name) ? 'search' : part.name === 'subagent' ? 'subagent' : 'custom';
      result.entries.push({ kind: 'tool', messageId: message.id, toolCallId: createHash('sha256').update(part.id).digest('hex'), category,
        state: part.state.status === 'completed' ? 'completed' : part.state.status === 'error' ? 'failed' : 'started', sourceTime: part.time.created,
        ...(runId ? { runId } : {}), ...(part.time.completed === undefined ? {} : { durationMs: Math.max(0, part.time.completed - part.time.created) }), displayOrder: 0 });
    }
  }
  return result;
}

export type RestoredCommand = Omit<StoredCommand, 'original'>;
export interface RestoredHistory {
  entries: ProjectionEntry[];
  commands: RestoredCommand[];
  users: Set<string>;
  missing: Set<string>;
}

/** Build privately, then the service verifies ownership/process fences again before publishing any refs. */
export async function restoreHistory(options: {
  conversationId: string;
  registry: ThinkRegistryReader;
  bodies: BodyStore;
  readPage(cursor?: string): Promise<MessageListOutput>;
  stopping(): boolean;
}): Promise<RestoredHistory> {
  const { conversationId, registry, bodies } = options;
  const result: RestoredHistory = { entries: [], commands: [], users: new Set(), missing: new Set() };
  const originals = new Map<string, Extract<ProjectionEntry, { kind: 'original' }>>();
  const originalOrder: Array<{ entry: Extract<ProjectionEntry, { kind: 'original' }>; nativeMessageId?: string | null; undelivered: boolean }> = [];
  const unattached: Array<Extract<ProjectionEntry, { kind: 'original' }>> = [];
  const forms: Array<Extract<ProjectionEntry, { kind: 'form-reply' }>> = [];
  let position: CommandPosition | undefined;
  for (;;) {
    if (options.stopping()) throw new Error('History restoration closed');
    const page = registry.commands(conversationId, position);
    if (!page.length) break;
    for (const command of page) {
      const { original, ...fact } = command;
      result.commands.push(fact);
      const receipt = command.receipt;
      if ((receipt.kind === 'send' || receipt.kind === 'form-reply') && original) {
        const messageId = command.nativeMessageId ?? `original_${receipt.clientCommandId.replaceAll('-', '')}`;
        const owner = receipt.kind === 'send' ? { kind: 'original' as const, clientCommandId: receipt.clientCommandId, messageId }
          : { kind: 'form-reply' as const, clientCommandId: receipt.clientCommandId, decisionId: receipt.decisionId };
        const body: BodyRef = await bodies.replace({ conversationId, owner }, bytes(original), 'canonical');
        if (receipt.kind === 'send') {
          const entry: Extract<ProjectionEntry, { kind: 'original' }> = { kind: 'original', clientCommandId: receipt.clientCommandId,
            messageId, body, runId: receipt.runId, sourceTime: command.registeredAt, displayOrder: 0 };
          originalOrder.push({ entry, nativeMessageId: command.nativeMessageId,
            undelivered: !command.attempted && (receipt.state === 'cancelled-before-delivery' || receipt.state === 'rejected') });
          if (command.nativeMessageId) originals.set(command.nativeMessageId, entry);
          else { unattached.push(entry); result.missing.add(`original-association:${receipt.clientCommandId}`); }
        } else forms.push({ kind: 'form-reply', clientCommandId: receipt.clientCommandId, decisionId: receipt.decisionId,
          body, sourceTime: command.registeredAt, displayOrder: 0 });
      }
    }
    const last = page[page.length - 1];
    position = { commandId: last.receipt.clientCommandId };
  }
  let cursor: string | undefined;
  let runId: string | undefined;
  let formAt = 0;
  const seenCursors = new Set<string>();
  const seenMessages = new Set<string>();
  do {
    if (options.stopping()) throw new Error('History restoration closed');
    const page = await options.readPage(cursor);
    for (const message of page.data) {
      if (seenMessages.has(message.id)) throw new Error('Repeated native message');
      seenMessages.add(message.id);
      // Form ordering uses its admitted registration time, never a guessed native-message association.
      while (formAt < forms.length && (forms[formAt].sourceTime ?? Infinity) <= message.time.created) result.entries.push(forms[formAt++]);
      if (message.type === 'user') {
        result.users.add(message.id);
        const original = originals.get(message.id);
        runId = original?.runId;
        if (original) { result.entries.push(original); originals.delete(message.id); }
        else result.missing.add(`original-native:${message.id}`); // Never substitute prepared native text.
      } else if (message.type === 'synthetic') runId = undefined;
      const projected = await projectNativeMessage(conversationId, message, bodies, [], runId, true);
      result.entries.push(...projected.entries);
      for (const key of projected.missing) result.missing.add(key);
    }
    cursor = page.cursor.next ?? undefined;
    if (cursor && seenCursors.has(cursor)) throw new Error('Repeated native history cursor');
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  // Native order remains authoritative. Only definitively undelivered originals can be
  // placed using ledger order before the NEXT exact-associated command anchor. A local
  // input after the last anchor stays after that native turn; no native/app clock comparison.
  const beforeAnchor = new Map<string, ProjectionEntry[]>();
  const trailing: ProjectionEntry[] = [];
  const placed = new Set<string>();
  let nextAnchor: string | undefined;
  for (let index = originalOrder.length - 1; index >= 0; index--) {
    const original = originalOrder[index];
    if (original.nativeMessageId && result.users.has(original.nativeMessageId)) nextAnchor = original.entry.clientCommandId;
    else if (original.undelivered) {
      if (nextAnchor) {
        const bucket = beforeAnchor.get(nextAnchor) ?? [];
        bucket.push(original.entry); beforeAnchor.set(nextAnchor, bucket);
      } else trailing.push(original.entry);
      placed.add(original.entry.clientCommandId);
    }
  }
  const merged: ProjectionEntry[] = [];
  for (const entry of result.entries) {
    if (entry.kind === 'original') merged.push(...(beforeAnchor.get(entry.clientCommandId)?.reverse() ?? []));
    merged.push(entry);
  }
  // Uncertain/missing associations remain conservative retained inputs, not invented native messages.
  merged.push(...trailing.reverse(), ...[...originals.values(), ...unattached].filter(entry => !placed.has(entry.clientCommandId)), ...forms.slice(formAt));
  result.entries = merged;
  for (const command of result.commands) {
    const receipt = command.receipt;
    // Only the retained current fact; do not invent missed Stop/compaction/intermediate transitions or timestamps.
    result.entries.push({ kind: 'lifecycle', commandKind: receipt.kind, clientCommandId: receipt.clientCommandId,
      ...('runId' in receipt ? { runId: receipt.runId } : {}), state: receipt.state, displayOrder: 0 });
  }
  result.entries = result.entries.map((entry, displayOrder) => ({ ...entry, displayOrder }));
  return result;
}

/** Missing known canonical parts stay explicit gaps; confirmed text is not read back from Markdown. */
export function missingConfirmedText(store: TranscriptStateStore | undefined, conversationId: string, entries: readonly ProjectionEntry[]): string[] {
  if (!store?.confirmed) return [];
  const present = new Set<string>();
  for (const entry of entries) if (entry.kind === 'assistant-text' && entry.closure === 'closed') present.add(`ai:${entry.messageId}:${entry.ordinal}`);
  const missing: string[] = [];
  let after: string | undefined;
  for (;;) {
    const page = store.confirmed(conversationId, after);
    if (!page.length) return missing;
    for (const entry of page) {
      const match = /^ai:([A-Za-z0-9_-]+):(\d+)$/.exec(entry.semantic);
      if (match && !present.has(entry.semantic)) missing.push(textIdentity(match[1], Number(match[2])));
      after = entry.id;
    }
  }
}
