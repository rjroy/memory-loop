import { createHash, randomBytes } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandReceipt, CreateConversationCommand, RecentConversation, RecentConversations, ResumeReceipt, SelectConversationCommand, ViewRegistration, ViewSelection } from './contract';
import { ThinkStateError, type RegisteredConversation, type StoredView, type StoredTranscript, type ThinkStateStore } from './state';
import { ThinkServiceError } from './errors';
import { transcriptFingerprint } from './transcript-file';

export const validViewToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43,256}$/.test(value);
export const mintViewToken = () => randomBytes(32).toString('base64url');
export function viewHash(token: string): string {
  if (!validViewToken(token)) throw new ThinkStateError('lease_unavailable');
  return createHash('sha256').update(token).digest('hex');
}
export const publicView = (view: StoredView): ViewSelection => ({ conversationId: view.conversationId,
  selectionRevision: view.selectionRevision, expiresAt: new Date(view.expiresAt).toISOString() });

export interface ConversationAvailability { state: RecentConversation['state']; busy: boolean; uncertain: boolean; ownershipMismatch?: boolean }

/** Registry capabilities do not require an attached native service. Native access, when
 * present, only supplies bounded ownership/activity checks and verified hydration. */
export interface ConversationService {
  recentConversations(viewToken?: string): Promise<RecentConversations>;
  registerView(): Promise<ViewRegistration>;
  selection(viewToken: string): Promise<ViewSelection>;
  select(command: SelectConversationCommand): Promise<ViewSelection>;
  resume(command: CreateConversationCommand): Promise<ResumeReceipt>;
  resumeCommand(conversationId: string, clientCommandId: string): Promise<ResumeReceipt | null>;
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
    inspect(owner: RegisteredConversation, deadline?: AbortSignal): Promise<ConversationAvailability>;
    prepare(conversationId: string): Promise<ConversationAvailability>;
  };
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
        if (error.code !== 'unavailable') throw new ThinkServiceError(error.code);
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
  const inspect = (owner: RegisteredConversation, signal?: AbortSignal): Promise<ConversationAvailability> =>
    options.native ? options.native.inspect(owner, signal) : Promise.resolve(unavailable);

  const service: ConversationService = {
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
          const observed = row.lifecycle === 'deleting' ? { ...unavailable, state: 'deleting' as const }
            : row.owner ? await inspect(row.owner, deadline.signal) : unavailable;
          requireOpen();
          const protection = operation(() => store.conversations.protection(row.conversationId, ownHash, clock.now()));
          let transcriptNoteId: string[] | undefined;
          if (row.owner && observed.state !== 'deleting') {
            try { transcriptNoteId = await verifiedTranscriptNote(directory, store.transcripts?.load(row.conversationId, directory) ?? null); }
            catch { /* Logging/mapping availability is independent of chat Resume. */ }
          }
          requireOpen();
          items.push({ conversationId: row.conversationId, title: observed.state === 'deleting' ? null : row.title,
            lastActivityAt: new Date(row.lastActivityAt).toISOString(), state: observed.state,
            ...(transcriptNoteId ? { transcriptNoteId } : {}),
            resume: observed.state === 'ready' ? { available: true } : { available: false, reason: observed.state },
            // No Delete capability before its real removal workflow exists.
            delete: { available: false, ...(protection ? { reason: protection } : observed.state === 'deleting' ? { reason: 'deleting' }
              : observed.busy ? { reason: 'running' } : observed.uncertain || row.uncertain ? { reason: 'status_unknown' } : {}) } });
        }
        return { state: 'ready', items };
      } finally { clearTimeout(timer); deadlines.delete(deadline); }
    },
    async resume(command) {
      const store = state();
      if (!uuid.test(command.conversationId) || !uuid.test(command.clientCommandId)) throw new ThinkServiceError('invalid_request');
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
    async resumeCommand(conversationId, clientCommandId) {
      state();
      if (!uuid.test(conversationId) || !uuid.test(clientCommandId)) throw new ThinkServiceError('invalid_request');
      const receipt = previousCommand(clientCommandId);
      if (receipt?.kind !== 'resume' || receipt.conversationId !== conversationId) return null;
      return receipt.state === 'registered' || receipt.state === 'upstream-unconfirmed'
        ? service.resume({ conversationId, clientCommandId }) : copyResume(receipt);
    },
    async close() {
      if (!closing) {
        closed = true;
        for (const controller of deadlines) controller.abort();
        closing = Promise.allSettled([...preparations.values()]).then(() => {});
      }
      await closing;
    },
  };
  return service;
}

/** A mapped, confirmed, unchanged file only. No filename/config guessing, content scan or writes. */
export async function verifiedTranscriptNote(directory: string, stored: StoredTranscript | null): Promise<string[] | undefined> {
  if (!stored?.file || stored.pending || await realpath(directory) !== directory) return;
  let path = directory;
  for (const [index, identity] of stored.namespace.entries()) {
    const node = await lstat(path);
    if (!node.isDirectory() || node.isSymbolicLink() || node.dev !== identity.dev || node.ino !== identity.ino) return;
    if (index < stored.noteId.length - 1) path = join(path, stored.noteId[index]);
  }
  const file = await lstat(join(path, stored.noteId[stored.noteId.length - 1]));
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.uid !== process.getuid?.() ||
      (file.mode & 0o7777) !== 0o600 || file.dev !== stored.file.dev || file.ino !== stored.file.ino ||
      file.size !== stored.file.offset || transcriptFingerprint(file) !== stored.file.fingerprint) return;
  return [...stored.noteId];
}
