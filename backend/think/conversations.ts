import { lstat } from 'node:fs/promises';
import type { CommandReceipt, CreateConversationCommand, DeleteConversationCommand, DeleteReceipt, RecentConversation, RecentConversations, ResumeReceipt, SelectConversationCommand, ViewRegistration, ViewSelection } from './contract';
import { ThinkStateError, type RegisteredConversation, type StoredView, type StoredTranscript, type ThinkStateStore } from './state';
import { ThinkServiceError } from './errors';
import { TranscriptNamespace, transcriptFingerprintMatches } from './transcript-file';
import { sameFileId } from '../file-identity';
import { createDeletionService, type DeletionService } from './deletion';
import { mintViewToken, viewHash } from './view-token';
export { validViewToken, viewHash, mintViewToken } from './view-token';

export const publicView = (view: StoredView): ViewSelection => ({ conversationId: view.conversationId,
  selectionRevision: view.selectionRevision, expiresAt: new Date(view.expiresAt).toISOString() });

export interface ConversationAvailability {
  state: RecentConversation['state']; busy: boolean; uncertain: boolean; ownershipMismatch?: boolean;
  delete?: RecentConversation['delete'];
}

/** Registry capabilities do not require an attached native service. Native access, when
 * present, only supplies bounded ownership/activity checks and verified hydration. */
export interface ConversationService {
  recentConversations(viewToken?: string): Promise<RecentConversations>;
  registerView(): Promise<ViewRegistration>;
  selection(viewToken: string): Promise<ViewSelection>;
  select(command: SelectConversationCommand): Promise<ViewSelection>;
  resume(command: CreateConversationCommand): Promise<ResumeReceipt>;
  delete(command: DeleteConversationCommand): Promise<DeleteReceipt>;
  command(conversationId: string, clientCommandId: string): Promise<ResumeReceipt | DeleteReceipt | null>;
  startRecovery(): void;
  close(): Promise<void>;
}

interface ConversationServiceOptions {
  state?: ThinkStateStore;
  directory: string;
  epoch: string;
  clock?: { now(): number };
  requireOpen?(): void;
  onPersistenceFailure?(): void;
  activityPending?(): boolean;
  /** Share the full Think service's accepted, not-yet-persisted command identities. */
  commands?: {
    previous(id: string): CommandReceipt | undefined;
    pending(id: string): boolean;
    remember(receipt: ResumeReceipt): void;
  };
  native?: {
    inspect(owner: RegisteredConversation, deadline?: AbortSignal, checkDelete?: boolean): Promise<ConversationAvailability>;
    prepare(conversationId: string): Promise<ConversationAvailability>;
  };
  deletion?: DeletionService;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const unavailable: ConversationAvailability = { state: 'unavailable', busy: false, uncertain: true };
const copyResume = (receipt: ResumeReceipt): ResumeReceipt => receipt.state === 'rejected'
  ? { ...receipt, failure: { ...receipt.failure } } : { ...receipt };

/** Does not own SQLite: its lifetime owner closes it after draining this capability. */
export function createConversationService(options: ConversationServiceOptions): ConversationService {
  const { directory, epoch } = options;
  const clock = options.clock ?? { now: () => Date.now() };
  const receipts = new Map<string, ResumeReceipt>();
  const preparations = new Map<string, Promise<ResumeReceipt>>();
  const deadlines = new Set<AbortController>();
  let closed = false;
  let closing: Promise<void> | undefined;
  function requireOpen(): void {
    if (closed) throw new ThinkServiceError('think_unavailable');
    options.requireOpen?.();
  }
  function state(): ThinkStateStore {
    requireOpen();
    if (!options.state?.registry) throw new ThinkServiceError('think_unavailable');
    return options.state;
  }
  function operation<T>(action: () => T): T {
    try { return action(); } catch (error) {
      if (error instanceof ThinkStateError) {
        if (error.code === 'conflict') throw new ThinkServiceError('command_conflict');
        if (error.code !== 'unavailable') throw new ThinkServiceError(error.code, error.reason);
      }
      options.onPersistenceFailure?.();
      throw new ThinkServiceError('think_unavailable');
    }
  }
  function previousCommand(id: string): CommandReceipt | undefined {
    const resident = receipts.get(id);
    if (resident) return resident;
    if (options.commands) return options.commands.previous(id);
    const stored = operation(() => state().command(id));
    return stored ? { ...stored.receipt, epoch } : undefined;
  }
  function remember(receipt: ResumeReceipt): void {
    receipts.set(receipt.clientCommandId, receipt);
    options.commands?.remember(receipt);
  }
  const inspect = (owner: RegisteredConversation, signal?: AbortSignal, checkDelete = false): Promise<ConversationAvailability> =>
    options.native ? options.native.inspect(owner, signal, checkDelete) : Promise.resolve(unavailable);
  const deletion = options.deletion ?? createDeletionService({ state: options.state, directory, epoch, now: () => clock.now(), requireOpen });

  const service: ConversationService = {
    delete: deletion.delete,
    startRecovery: deletion.startRecovery,
    async registerView() {
      const store = state(); const viewToken = mintViewToken();
      const selected = operation(() => store.conversations.mintView(viewHash(viewToken), clock.now()));
      return { ...publicView(selected), viewToken };
    },
    async selection(viewToken) {
      const store = state();
      const selected = operation(() => store.conversations.view(viewHash(viewToken), clock.now()));
      if (!selected) throw new ThinkServiceError('lease_unavailable');
      return publicView(selected);
    },
    async select(command) {
      const store = state();
      if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 0 ||
          command.conversationId !== null && !uuid.test(command.conversationId)) throw new ThinkServiceError('invalid_request');
      return publicView(operation(() => store.conversations.select(viewHash(command.viewToken), command.expectedRevision,
        command.conversationId, clock.now(), directory)));
    },
    async recentConversations(viewToken) {
      const store = state();
      if (options.activityPending?.()) throw new ThinkServiceError('think_unavailable');
      const ownHash = viewToken ? viewHash(viewToken) : null;
      const rows = operation(() => store.conversations.recent(directory));
      const items: RecentConversations['items'] = [];
      const deadline = new AbortController();
      deadlines.add(deadline);
      const timer = setTimeout(() => deadline.abort(), 3000);
      // Ten rows, at most one row's bounded native reads at a time; no history scan.
      try {
        for (const row of rows) {
          const protectedAtStart = operation(() => store.conversations.protection(row.conversationId, ownHash, clock.now()));
          const observed = row.lifecycle === 'deleting' ? { ...unavailable, state: 'deleting' as const }
            : row.owner ? await inspect(row.owner, deadline.signal, !protectedAtStart && !row.uncertain && row.owner.creation === 'ready') : unavailable;
          requireOpen();
          let transcriptNoteId: string[] | undefined;
          if (row.owner && observed.state !== 'deleting') {
            try { transcriptNoteId = await verifiedTranscriptNote(directory, store.transcripts?.load(row.conversationId, directory) ?? null); }
            catch { /* Logging/mapping availability is independent of chat Resume. */ }
          }
          requireOpen();
          const protection = operation(() => store.conversations.protection(row.conversationId, ownHash, clock.now()));
          const deleteReason: RecentConversation['delete']['reason'] = protection ?? (observed.state === 'deleting' ? 'deleting'
            : observed.busy ? 'running' : observed.state !== 'ready' || observed.uncertain || row.uncertain ? 'status_unknown'
              : observed.delete?.available ? undefined : observed.delete?.reason ?? 'status_unknown');
          items.push({ conversationId: row.conversationId, title: observed.state === 'deleting' ? null : row.title,
            lastActivityAt: new Date(row.lastActivityAt).toISOString(), state: observed.state,
            ...(transcriptNoteId ? { transcriptNoteId } : {}),
            resume: observed.state === 'ready' ? { available: true } : { available: false, reason: observed.state },
            delete: deleteReason ? { available: false, reason: deleteReason } : { available: true } });
        }
        // A deletion may have committed while another row or its mapped file was being read.
        // Final synchronous fences cover the ENTIRE response, not just the last awaited row.
        const current: RecentConversations['items'] = [];
        for (const item of items) {
          if (!operation(() => store.deletions?.blocked(item.conversationId))) { current.push(item); continue; }
          if (!operation(() => store.registry?.conversation(item.conversationId))) continue;
          current.push({ conversationId: item.conversationId, title: null, lastActivityAt: item.lastActivityAt, state: 'deleting',
            resume: { available: false, reason: 'deleting' }, delete: { available: false, reason: 'deleting' } });
        }
        return { state: 'ready', items: current };
      } finally { clearTimeout(timer); deadlines.delete(deadline); }
    },
    async resume(command) {
      const store = state();
      if (!uuid.test(command.conversationId) || !uuid.test(command.clientCommandId)) throw new ThinkServiceError('invalid_request');
      if (operation(() => store.deletions?.blocked(command.conversationId))) throw new ThinkServiceError('not_found');
      const previous = previousCommand(command.clientCommandId);
      if (previous && (previous.kind !== 'resume' || previous.conversationId !== command.conversationId) || options.commands?.pending(command.clientCommandId)) throw new ThinkServiceError('command_conflict');
      const preparing = preparations.get(command.clientCommandId);
      if (preparing) return copyResume(await preparing);
      if (previous?.kind === 'resume' && previous.state === 'rejected') return copyResume(previous);
      if (preparations.size >= 16) throw new ThinkServiceError('think_unavailable');
      const owner = operation(() => store.registry?.conversation(command.conversationId));
      if (!owner || owner.directory !== directory || owner.purpose !== 'think') throw new ThinkServiceError('not_found');
      if (owner.lifecycle !== 'live') throw new ThinkServiceError('command_conflict');
      const receipt: ResumeReceipt = previous?.kind === 'resume' ? previous : { ...command, kind: 'resume', epoch, state: 'registered' };
      if (!previous) operation(() => store.registerCommand(receipt, null, null, clock.now()));
      remember(receipt);
      const work = Promise.resolve().then(async (): Promise<ResumeReceipt> => {
        let observed = await inspect(owner);
        if (options.native && (observed.state === 'ready' || observed.state === 'recovering')) {
          try {
            observed = await options.native.prepare(command.conversationId);
          } catch (error) {
            if (error instanceof ThinkServiceError && error.code !== 'think_unavailable') throw error;
            observed = unavailable;
          }
        }
        requireOpen();
        if (receipt.state === 'ready' && observed.state !== 'ready') throw new ThinkServiceError('think_unavailable'); // Historical fact is not current navigation authority.
        const next: ResumeReceipt = observed.ownershipMismatch ? { ...command, kind: 'resume', epoch, state: 'rejected', failure: { code: 'ownership_mismatch' } }
          : !options.native ? { ...command, kind: 'resume', epoch, state: 'rejected', failure: { code: 'service_unavailable' } }
          : { ...command, kind: 'resume', epoch, state: observed.state === 'ready' ? 'ready' : 'upstream-unconfirmed' };
        try { store.outcome(next); }
        catch { options.onPersistenceFailure?.(); console.info('think_resume_outcome', { status: 'persistence_unavailable' }); }
        remember(next);
        return next;
      }).finally(() => preparations.delete(command.clientCommandId));
      preparations.set(command.clientCommandId, work);
      return copyResume(await work);
    },
    async command(conversationId, clientCommandId) {
      state();
      if (!uuid.test(conversationId) || !uuid.test(clientCommandId)) throw new ThinkServiceError('invalid_request');
      const receipt = previousCommand(clientCommandId);
      if (receipt?.kind === 'delete') return deletion.command(conversationId, clientCommandId);
      if (receipt?.kind !== 'resume' || receipt.conversationId !== conversationId) return null;
      return receipt.state === 'registered' || receipt.state === 'upstream-unconfirmed'
        ? service.resume({ conversationId, clientCommandId }) : copyResume(receipt);
    },
    async close() {
      if (!closing) {
        closed = true;
        for (const controller of deadlines) controller.abort();
        closing = Promise.allSettled([...preparations.values(), deletion.close()]).then(() => {});
      }
      await closing;
    },
  };
  return service;
}

/** A mapped, confirmed, unchanged file only. No filename/config guessing, content scan or writes. */
export async function verifiedTranscriptNote(directory: string, stored: StoredTranscript | null): Promise<string[] | undefined> {
  if (!stored?.file || stored.pending || stored.namespace.length !== stored.noteId.length ||
      stored.noteId.at(-1) !== `think-${stored.conversationId}.md`) return;
  const namespace = new TranscriptNamespace(directory, stored.noteId.slice(0, -1).join('/'));
  try {
    await namespace.prepare(false);
    if (JSON.stringify(namespace.identities()) !== JSON.stringify(stored.namespace)) return;
    const name = stored.noteId[stored.noteId.length - 1];
    const file = await lstat(await namespace.resolve(name, 'file'), { bigint: true });
    if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1n || !sameFileId(file, stored.file) ||
        file.size !== BigInt(stored.file.offset) || !transcriptFingerprintMatches(file, stored.file.fingerprint)) return;
    await namespace.validate();
    return [...stored.noteId];
  } finally {
    await namespace.close();
  }
}
