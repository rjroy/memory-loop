import { serverLogger } from '../../src/server/logger';
import type { CommandReceipt, DeleteConversationCommand, DeleteReceipt } from './contract';
import type { RegisteredConversation, ThinkStateStore } from './state';
import { ThinkStateError } from './state';
import { ThinkServiceError } from './errors';
import { viewHash } from './view-token';
import { removeMappedTranscript } from './transcript-remove';
import { removeCacheNamespace } from './body-cleanup';
import { TranscriptError, type TranscriptIO } from './transcript-file';

interface DeletionOptions {
  state?: ThinkStateStore; directory: string; epoch: string; now(): number;
  requireOpen(): void;
  previous?(commandId: string): CommandReceipt | undefined;
  pendingCommand?(commandId: string): boolean;
  fence?(conversationId: string): void;
  quiesce?(conversationId: string): Promise<void>;
  purge?(conversationId: string): Promise<void>;
  native?: {
    inspect(owner: RegisteredConversation, signal: AbortSignal): Promise<void>;
    remove(owner: RegisteredConversation, signal: AbortSignal, beforeEffect: () => void): Promise<void>;
  };
  io?: TranscriptIO;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** One concrete three-effect operation. SQLite is its owner; request cancellation is not Undo. */
export function createDeletionService(options: DeletionOptions) {
  const active = new Map<string, { controller: AbortController; work: Promise<void> }>();
  const admitting = new Map<string, string>();
  let closed = false;
  let recovering = false;
  let closing: Promise<void> | undefined;
  const open = () => { if (closed) throw new ThinkServiceError('think_unavailable'); options.requireOpen(); };
  function store() {
    open();
    if (!options.state?.deletions || !options.state.registry || !options.state.transcripts || !options.state.cache) throw new ThinkServiceError('think_unavailable');
    return options.state;
  }
  function sql<T>(action: () => T): T {
    try { return action(); } catch (error) {
      if (error instanceof ThinkStateError) throw new ThinkServiceError(error.code === 'conflict' ? 'command_conflict' : error.code === 'unavailable' ? 'think_unavailable' : error.code, error.reason);
      throw new ThinkServiceError('think_unavailable');
    }
  }
  function receipt(commandId: string): DeleteReceipt | null {
    const record = sql(() => store().deletions.get(commandId));
    if (!record) return null;
    if (record.receipt.state === 'accepted' && !active.has(commandId)) return { ...record.receipt, epoch: options.epoch, state: 'pending', reason: 'status_unknown' };
    return { ...record.receipt, epoch: options.epoch };
  }
  // Exactly one locally initiated attempt. Unknown/failed effects stay pending;
  // reads, retries of the POST and restart never replay a destructive operation.
  function run(commandId: string): void {
    if (closed || active.has(commandId)) return;
    if (active.size >= 2) {
      try { sql(() => store().deletions.pendingReason(commandId, 'status_unknown')); } catch { /* Keep the accepted intent. */ }
      return;
    }
    const controller = new AbortController();
    const work = Promise.resolve().then(async () => {
      const state = store();
      let record = sql(() => state.deletions.get(commandId));
      if (!record || record.receipt.state === 'completed') return;
      const target = record.receipt.conversationId;
      options.fence?.(target);
      const stopping = () => closed || controller.signal.aborted;
      const check = () => { open(); if (stopping()) throw new ThinkServiceError('think_unavailable'); };
      serverLogger.log('think_delete_attempt', { conversationId: target, clientCommandId: commandId });
      try {
        await options.quiesce?.(target); check();
        // Reload every durable boundary; a failed acknowledgement may follow a committed fact.
        record = sql(() => state.deletions.get(commandId));
        if (!record || record.receipt.state === 'completed') return;
        if (!record.nativeRemoved) {
          const owner = sql(() => state.registry?.conversation(target));
          if (!owner || !options.native || record.nativeAttempted) throw new ThinkServiceError('delete_blocked', 'status_unknown');
          await options.native.remove(owner, controller.signal, () => {
            check(); sql(() => state.deletions.attempted(commandId));
          });
          check(); sql(() => state.deletions.progress(commandId, 'native'));
        }
        record = sql(() => state.deletions.get(commandId));
        if (!record?.transcriptRemoved) {
          const transcript = sql(() => state.transcripts?.load(target, options.directory) ?? null);
          await removeMappedTranscript(options.directory, transcript, index => sql(() => state.transcripts?.chunk(target, index) ?? null), stopping, options.io);
          check(); sql(() => state.deletions.progress(commandId, 'transcript'));
        }
        await options.purge?.(target); check();
        for (;;) {
          const namespaces = sql(() => state.cache.namespaces(target));
          if (!namespaces.length) break;
          for (const namespace of namespaces) {
            await removeCacheNamespace(namespace, options.directory); check();
            sql(() => state.cache.removed(target, namespace.epoch));
          }
        }
        sql(() => state.deletions.complete(commandId));
        serverLogger.log('think_delete_outcome', { conversationId: target, clientCommandId: commandId, state: 'completed' });
      } catch (error) {
        if (stopping()) return;
        const reason = error instanceof TranscriptError && error.reason === 'conflict' ||
          error instanceof ThinkServiceError && (error.code === 'command_conflict' || error.code === 'selection_conflict') ? 'conflict'
          : error instanceof ThinkServiceError && error.code === 'delete_blocked' ? 'status_unknown' : 'io_unavailable';
        try { sql(() => state.deletions.pendingReason(commandId, reason)); } catch { /* Durable intent remains; never claim completion after a write failure. */ }
        serverLogger.log('think_delete_outcome', { conversationId: target, clientCommandId: commandId, state: 'pending', reason });
      }
    }).catch(() => { serverLogger.log('think_delete_outcome', { clientCommandId: commandId, state: 'pending', reason: 'io_unavailable' }); })
      .finally(() => { active.delete(commandId); });
    active.set(commandId, { controller, work });
  }
  function recover(after?: string): void {
    if (closed) return;
    serverLogger.log('think_delete_recovery_attempt');
    try {
      const pending = sql(() => store().deletions.pending(options.directory, after));
      for (const record of pending) {
        options.fence?.(record.receipt.conversationId);
        if (!active.has(record.receipt.clientCommandId)) sql(() => store().deletions.pendingReason(record.receipt.clientCommandId, record.receipt.reason ?? 'status_unknown'));
      }
      serverLogger.log('think_delete_recovery_outcome', { status: 'ready', pending: pending.length });
      if (pending.length === 32) queueMicrotask(() => recover(pending.at(-1)?.receipt.clientCommandId));
    } catch { serverLogger.log('think_delete_recovery_outcome', { status: 'unavailable' }); }
  }
  return {
    preparing(commandId: string) { return admitting.has(commandId); },
    /** Restore pending facts/fences after listener ownership. Never resume destructive effects. */
    startRecovery() { if (!recovering && !closed) { recovering = true; recover(); } },
    async delete(command: DeleteConversationCommand): Promise<DeleteReceipt> {
      const state = store();
      if (!uuid.test(command.conversationId) || !uuid.test(command.clientCommandId)) throw new ThinkServiceError('invalid_request');
      const hash = viewHash(command.viewToken);
      const view = sql(() => state.conversations.view(hash, options.now()));
      if (!view) throw new ThinkServiceError('lease_unavailable');
      const preparing = admitting.get(command.clientCommandId);
      if (preparing) throw new ThinkServiceError(preparing === command.conversationId ? 'think_unavailable' : 'command_conflict');
      const previous = options.previous ? options.previous(command.clientCommandId) : sql(() => state.command(command.clientCommandId))?.receipt;
      if (previous) {
        if (previous.kind !== 'delete' || previous.conversationId !== command.conversationId) throw new ThinkServiceError('command_conflict');
        return receipt(command.clientCommandId) ?? previous;
      }
      if (options.pendingCommand?.(command.clientCommandId)) throw new ThinkServiceError('command_conflict');
      const owner = sql(() => state.registry?.conversation(command.conversationId));
      if (!owner || owner.directory !== options.directory || owner.purpose !== 'think') throw new ThinkServiceError('not_found');
      if (owner.lifecycle !== 'live') throw new ThinkServiceError('delete_blocked', 'deleting');
      const protection = sql(() => state.conversations.protection(command.conversationId, hash, options.now()));
      if (protection) throw new ThinkServiceError('delete_blocked', protection);
      if (!options.native) throw new ThinkServiceError('delete_blocked', 'status_unknown');
      const controller = new AbortController();
      // Admission reads are tracked too, so shutdown cannot accept a delayed result.
      const key = `admit:${command.clientCommandId}`;
      if (active.size >= 2 || active.has(key)) throw new ThinkServiceError('think_unavailable');
      admitting.set(command.clientCommandId, command.conversationId);
      const native = options.native;
      const inspection = Promise.resolve().then(() => native.inspect(owner, controller.signal));
      active.set(key, { controller, work: inspection.catch(() => {}) });
      try {
        try { await inspection; open(); } finally { active.delete(key); }
        const accepted: DeleteReceipt = { kind: 'delete', conversationId: command.conversationId, clientCommandId: command.clientCommandId, epoch: options.epoch, state: 'accepted' };
        try { sql(() => state.deletions.accept(accepted, hash, view.selectionRevision, owner.rowVersion, options.directory, options.now())); }
        catch (error) {
          // COMMIT can precede a lost acknowledgement. A readable committed intent still
          // fences immediately, but a failed/rolled-back guard never authorizes any effect.
          try {
            const committed = state.deletions.get(command.clientCommandId);
            if (committed?.receipt.conversationId === command.conversationId) {
              options.fence?.(command.conversationId);
              state.deletions.pendingReason(command.clientCommandId, 'io_unavailable');
            }
          } catch { /* Unreadable facts remain unavailable; recovery must verify the intent. */ }
          throw error;
        }
        options.fence?.(command.conversationId);
        run(command.clientCommandId);
        return accepted;
      } finally { admitting.delete(command.clientCommandId); }
    },
    async command(conversationId: string, commandId: string): Promise<DeleteReceipt | null> {
      const value = receipt(commandId);
      if (!value || value.conversationId !== conversationId) return null;
      return value;
    },
    async close() {
      if (!closing) {
        closed = true;
        for (const task of active.values()) task.controller.abort();
        closing = Promise.allSettled([...active.values()].map(task => task.work)).then(() => {});
      }
      await closing;
    },
  };
}
export type DeletionService = ReturnType<typeof createDeletionService>;
