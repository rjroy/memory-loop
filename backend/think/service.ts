import { safeError, serverLogger } from '../../src/server/logger';
import type { CommandReceipt, ConversationState, CreateConversationCommand, CreateReceipt, DeleteConversationCommand, DeleteReceipt, FormDecision, FormReplyCommand, FormReplyReceipt, RecentConversations, ResumeReceipt, SelectConversationCommand, SendCommand, SendReceipt, StopCommand, StopReceipt, ViewRegistration, ViewSelection } from './contract';
import type { FormInfo, SessionCreateInput } from '@opencode/client';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import type { NativeSession, NativeSessions } from './native';
import type { BodyKey, BodyReader, BodyRef, BodyStore, PreviewBodyRef } from './body-store';
import type { OriginalCaptureState, ProjectionEntry, ProjectionPage, ThinkContentReader } from './projection';
import type { ContentChunk, ContentChunkRequest } from './content-transfer';
import { createTranscriptWriter, type TranscriptOptions } from './transcript';
import { ThinkStateError, type CanonicalActivity, type RegisteredConversation, type ThinkOwner, type ThinkStateStore } from './state';
import { canonicalActivities, missingConfirmedText, projectNativeMessage, restoreHistory, terminalSend } from './history';
import { createConversationService, type ConversationAvailability } from './conversations';
import { ThinkServiceError } from './errors';
import { createDeletionService } from './deletion';
import { defaultNativeMinimum, nativeVersionStatus, validNativeVersion } from './native-version';
export { ThinkServiceError, type ThinkServiceErrorCode } from './errors';

export type ConversationSnapshot = ConversationState & Pick<ProjectionPage, 'entries' | 'contentHealth' | 'nextCursor'>;
export interface ConversationWatch {
  snapshot: ConversationSnapshot;
  next(): Promise<ConversationState | null>;
  close(): void;
}

/** Daemon-lifetime ownership boundary; request cancellation does not cancel accepted work. */
export interface ThinkService {
  create(command: CreateConversationCommand): Promise<CreateReceipt>;
  conversation(conversationId: string): Promise<ConversationState | null>;
  snapshot(conversationId: string, cursor?: string): Promise<ConversationSnapshot | null>;
  watch(conversationId: string): Promise<ConversationWatch | null>;
  contentChunk(request: ContentChunkRequest): Promise<ContentChunk>;
  command(conversationId: string, clientCommandId: string): Promise<CommandReceipt | null>;
  send(command: SendCommand): Promise<SendReceipt>;
  stop(command: StopCommand): Promise<StopReceipt>;
  decisions(conversationId: string): Promise<FormDecision[]>;
  decision(conversationId: string, decisionId: string): Promise<FormDecision | null>;
  reply(command: FormReplyCommand): Promise<FormReplyReceipt>;
  recentConversations(viewToken?: string): Promise<RecentConversations>;
  resume(command: CreateConversationCommand): Promise<ResumeReceipt>;
  registerView(): Promise<ViewRegistration>;
  selection(viewToken: string): Promise<ViewSelection>;
  select(command: SelectConversationCommand): Promise<ViewSelection>;
  delete(command: DeleteConversationCommand): Promise<DeleteReceipt>;
  startRecovery(): void;
  close(): Promise<void>;
  content: ThinkContentReader;
}

export interface ThinkServiceOptions {
  native: NativeSessions;
  bodies: BodyStore;
  context: {
    directory: string;
    agent?: string;
    model?: NonNullable<SessionCreateInput['model']>;
  };
  epoch: string;
  /** Version is legacy metadata, not an identity or compatibility gate. */
  serviceIdentity: { pid: number; version?: string };
  minimumVersion?: string;
  clock?: { now(): number };
  transferIdleMs?: number;
  transcript?: TranscriptOptions;
  /** Production prepareServer always supplies durable state; direct fixtures can inject this seam. */
  state?: ThinkStateStore;
  /** Operator-selected new-chat defaults; stored creation selections govern restored chats. */
  validateCreation?(signal: AbortSignal): Promise<void>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function copyReceipt(receipt: CommandReceipt): CommandReceipt {
  if (receipt.kind === 'create' && receipt.state === 'rejected') return { ...receipt, failure: { ...receipt.failure } };
  if (receipt.kind === 'send' && receipt.failure) return { ...receipt, failure: { ...receipt.failure } };
  if (receipt.kind === 'form-reply' && receipt.failure) return { ...receipt, failure: { ...receipt.failure } };
  if (receipt.kind === 'resume' && receipt.state === 'rejected') return { ...receipt, failure: { ...receipt.failure } };
  return { ...receipt };
}

function nextOrAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T> | 'aborted'> {
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve('aborted');
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(() => iterator.next()).then(
      item => { signal.removeEventListener('abort', onAbort); resolve(item); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/** Register and retain create identities for this daemon lifetime. */
export function createThinkService(options: ThinkServiceOptions): ThinkService {
  const { epoch, native, bodies } = options;
  const identity = { ...options.serviceIdentity };
  const minimumVersion = options.minimumVersion ?? defaultNativeMinimum;
  const { agent } = options.context;
  const directory = normalize(options.context.directory);
  const model = options.context.model ? { ...options.context.model } : undefined;
  if (!bodies || typeof bodies.replace !== 'function' || typeof bodies.append !== 'function' || typeof bodies.open !== 'function' || typeof bodies.close !== 'function' ||
      !uuid.test(epoch) || !Number.isSafeInteger(identity.pid) || identity.pid < 1 || !validNativeVersion(minimumVersion) || !isAbsolute(directory) || directory.includes('\0')) throw new ThinkServiceError('invalid_request');
  const commands = new Map<string, CommandReceipt>();
  const registeredTimes = new Map<string, number>();
  const replyPayloads = new Map<string, string>();
  const preparingReplies = new Map<string, { payload: string; result: Promise<FormReplyReceipt> }>();
  const formLocks = new Set<string>();
  const conversations = new Map<string, ConversationState>();
  const owners = new Map<string, ThinkOwner>();
  const restoredOwners = new Map<string, RegisteredConversation>();
  const ownershipInvalid = new Set<string>();
  const deleting = new Set<string>();
  const activityUnknown = new Set<string>();
  const checkpointReadsPending = new Set<string>();
  const hydrations = new Map<string, Promise<void>>();
  const activityWritesPending = new Set<string>();
  const watchers = new Map<string, Set<(state: ConversationState | null) => void>>();
  function setConversation(id: string, state: ConversationState): void {
    if (deleting.has(id)) return;
    const previous = conversations.get(id);
    state = { ...state, sendEligibility: sendEligibility(id, state) };
    conversations.set(id, state);
    if (!previous || state.revision <= previous.revision) return;
    for (const notify of watchers.get(id) ?? []) notify({ ...state });
  }
  const sendDigests = new Map<string, string>();
  const projections = new Map<string, ProjectionEntry[]>();
  // Transcript source versions exclude watch health/eligibility changes, which do
  // not invalidate a manifest scan (including the eligibility fence during close).
  const projectionRevisions = new Map<string, number>();
  const published = new Set<string>();
  const publishedRefs = new Map<string, BodyRef>();
  const reclaimable = new Map<string, BodyRef>();
  const locators = new Map<string, { sessionID: string; messageID: string; ordinal: number }>();
  const rehydrations = new Map<string, { promise: Promise<BodyReader>; waiters: number }>();
  const transferKey = (conversationId: string, contentId: string, generation: string, through: number) => JSON.stringify([conversationId, contentId, generation, through]);
  const clock = options.clock ?? { now: () => Date.now() };
  const transferIdleMs = options.transferIdleMs ?? 60000;
  if (!Number.isSafeInteger(transferIdleMs) || transferIdleMs < 1) throw new ThinkServiceError('invalid_request');
  type Transfer = { ref: BodyRef; reader: BodyReader; expires: number; next: number; last?: number; busy: boolean };
  const transfers = new Map<string, Transfer>();
  const transferWork = new Set<Promise<unknown>>();
  const transferOwners = new Map<Promise<unknown>, string>();
  let openingTransfers = 0;
  function trackTransfer<T>(work: Promise<T>, conversationId?: string): Promise<T> {
    transferWork.add(work);
    if (conversationId) transferOwners.set(work, conversationId);
    const done = () => { transferWork.delete(work); transferOwners.delete(work); };
    void work.then(done, done);
    return work;
  }
  function expireTransfers(): void {
    for (const [nonce, transfer] of transfers) {
      if (!transfer.busy && transfer.expires <= clock.now()) {
        transfers.delete(nonce);
        void trackTransfer(transfer.reader.close()).catch(() => {});
      }
    }
  }
  const cursorKey = randomBytes(32);
  const runs = new Map<string, { conversationId: string; sendCommandId: string; nativeMessageId?: string }>();
  const activeRuns = new Map<string, string>();
  const activeSessions = new Set<string>();
  const missingCanonical = new Map<string, Set<string>>();
  const textKey = (messageId: string, ordinal: number) => JSON.stringify([messageId, ordinal]);
  function noteMissing(conversationId: string, messageId: string, ordinal: number): void {
    let keys = missingCanonical.get(conversationId);
    if (!keys) { keys = new Set(); missingCanonical.set(conversationId, keys); }
    keys.add(textKey(messageId, ordinal));
  }
  const sessionConversations = new Map<string, string>();
  const childConversations = new Map<string, string>();
  const refreshes = new Map<string, { generation: number; running: boolean }>();
  const stoppedRuns = new Set<string>();
  const dispatchedRuns = new Set<string>();
  const tasks = new Map<AbortController, Promise<void>>();
  const taskConversations = new Map<AbortController, string>();
  const quiescing = new Map<string, Promise<void>>();
  let monitor: { controller: AbortController; connected: Promise<boolean>; task: Promise<void>; healthy: boolean; generation: number } | undefined;
  let closed = false;
  let identityChanged = false;
  let available = true;
  let persistenceFailed = false;
  let closing: Promise<void> | undefined;
  if (options.state?.cache) bodies.bind(options.state.cache);

  function trackTask(controller: AbortController, work: Promise<void>, conversationId?: string): void {
    tasks.set(controller, work);
    if (conversationId) {
      taskConversations.set(controller, conversationId);
      const done = () => taskConversations.delete(controller);
      void work.then(done, done);
    }
  }
  function fenceConversation(conversationId: string): void {
    deleting.add(conversationId);
    bodies.revoke(conversationId);
    const refresh = refreshes.get(conversationId); if (refresh) refresh.generation++;
    for (const notify of watchers.get(conversationId) ?? []) notify(null);
    for (const [controller, id] of taskConversations) if (id === conversationId) controller.abort();
  }
  function requireTarget(conversationId: string): void {
    requireOpen();
    requireOwnedTarget(conversationId);
  }
  /** Ownership/deletion fences also apply to the private transcript drain after admission closes. */
  function requireOwnedTarget(conversationId: string): void {
    if (typeof conversationId !== 'string' || !uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
    if (deleting.has(conversationId) || options.state?.deletions?.blocked(conversationId)) {
      if (!deleting.has(conversationId)) fenceConversation(conversationId);
      throw new ThinkServiceError('not_found');
    }
  }
  function clearConversation(conversationId: string): void {
    for (const [id, receipt] of commands) if (receipt.conversationId === conversationId) {
      commands.delete(id); registeredTimes.delete(id); sendDigests.delete(id); replyPayloads.delete(id);
    }
    for (const [id, run] of runs) if (run.conversationId === conversationId) { runs.delete(id); stoppedRuns.delete(id); dispatchedRuns.delete(id); }
    for (const [key, ref] of publishedRefs) if (ref.key.conversationId === conversationId) publishedRefs.delete(key);
    for (const key of published) if (JSON.parse(key)[0] === conversationId) { published.delete(key); locators.delete(key); reclaimable.delete(key); }
    for (const [key, ref] of reclaimable) if (ref.key.conversationId === conversationId) reclaimable.delete(key);
    for (const [key, id] of sessionConversations) if (id === conversationId) sessionConversations.delete(key);
    for (const [key, id] of childConversations) if (id === conversationId) childConversations.delete(key);
    for (const [key, prepared] of preparingReplies) if (JSON.parse(prepared.payload).conversationId === conversationId) preparingReplies.delete(key);
    for (const key of formLocks) if (key.startsWith(`${conversationId}:`)) formLocks.delete(key);
    conversations.delete(conversationId); projections.delete(conversationId); projectionRevisions.delete(conversationId); owners.delete(conversationId); restoredOwners.delete(conversationId);
    activityUnknown.delete(conversationId); activeRuns.delete(conversationId); activeSessions.delete(conversationId);
    missingCanonical.delete(conversationId); checkpointReadsPending.delete(conversationId); activityWritesPending.delete(conversationId); refreshes.delete(conversationId);
  }
  function quiesceConversation(conversationId: string): Promise<void> {
    fenceConversation(conversationId);
    let work = quiescing.get(conversationId);
    if (!work) {
      work = (async () => {
        const pending = [...tasks].filter(([controller]) => taskConversations.get(controller) === conversationId).map(([, task]) => task);
        const transcript = transcripts.quiesce(conversationId);
        for (const [nonce, transfer] of transfers) if (transfer.ref.key.conversationId === conversationId) {
          transfers.delete(nonce); await transfer.reader.close();
        }
        await Promise.allSettled([...pending, ...[...transferOwners].filter(([, id]) => id === conversationId).map(([task]) => task)]);
        await transcript;
        clearConversation(conversationId);
      })();
      quiescing.set(conversationId, work);
      void work.catch(() => { if (quiescing.get(conversationId) === work) quiescing.delete(conversationId); });
    }
    return work;
  }

  function sendEligibility(id: string, state: ConversationState): ConversationState['sendEligibility'] {
    if (closed || deleting.has(id) || persistenceFailed || identityChanged || !available || ownershipInvalid.has(id) || activityUnknown.has(id) ||
        (monitor && !monitor.healthy) || state.creation !== 'ready') return 'unavailable';
    return activeRuns.has(id) || activeSessions.has(id) ? 'busy' : 'available';
  }
  function refreshEligibility(id: string): void {
    const state = conversations.get(id);
    if (state && state.sendEligibility !== sendEligibility(id, state)) setConversation(id, { ...state, revision: state.revision + 1 });
  }
  function refreshAllEligibility(): void {
    for (const id of conversations.keys()) refreshEligibility(id);
  }

  function disablePersistence(): void {
    persistenceFailed = true;
    refreshAllEligibility();
    serverLogger.log('think_state_outcome', { status: 'unavailable' });
  }

  function stateFailure(error: unknown): never {
    if (error instanceof ThinkStateError) {
      if (error.code === 'conflict') throw new ThinkServiceError('command_conflict');
      if (error.code !== 'unavailable') throw new ThinkServiceError(error.code, error.reason);
    }
    disablePersistence();
    throw new ThinkServiceError('think_unavailable');
  }

  function stateOperation<T>(operation: () => T): T {
    try { return operation(); } catch (error) { return stateFailure(error); }
  }

  function previousCommand(commandId: string): CommandReceipt | undefined {
    const resident = commands.get(commandId);
    if (resident) return resident;
    const stored = stateOperation(() => options.state?.command(commandId));
    if (!stored) return;
    if (stored.receipt.kind === 'send' && stored.payloadSha256) sendDigests.set(commandId, stored.payloadSha256);
    if (stored.receipt.kind === 'form-reply' && stored.payloadSha256) replyPayloads.set(commandId, stored.payloadSha256);
    // This exposes a durable command fact, not chat/history hydration or permission to redispatch.
    return { ...stored.receipt, epoch };
  }

  function persistOutcome(receipt: CommandReceipt, verifiedSelection?: NativeSession): void {
    if (deleting.has(receipt.conversationId)) return;
    if (!options.state) return;
    try { options.state.outcome(receipt, verifiedSelection); }
    catch {
      // Native observations remain factual in memory; a failed local write is never a native rejection.
      disablePersistence();
    }
  }

  function persistCanonical(conversationId: string, facts: readonly CanonicalActivity[]): void {
    if (deleting.has(conversationId)) return;
    if (!options.state || !facts.length) return;
    try { options.state.conversations.canonical(conversationId, facts); activityWritesPending.delete(conversationId); }
    catch {
      // Derivative recency failure never rewrites a native outcome or stops accepted work.
      // Keep retrying the verified source; do not present stale activity as a complete recent card.
      activityWritesPending.add(conversationId);
      serverLogger.log('think_activity_outcome', { status: 'unavailable' });
    }
  }

  function markAttempted(commandId: string, kind: 'work' | 'stop' = 'work'): boolean {
    // Explicit control still needs its own durable attempt, but an earlier outcome-write
    // failure must not veto that attempt when the store can now commit it.
    if (persistenceFailed && kind !== 'stop') return false;
    try { options.state?.attempted(commandId); return true; }
    catch { disablePersistence(); return false; }
  }

  const bodyBytes = async function* (value: string): AsyncIterable<Uint8Array> { yield Buffer.from(value, 'utf8'); };
  const refIdentity = (ref: BodyRef) => JSON.stringify([ref.key.conversationId, ref.key.owner.kind,
    ref.key.owner.kind === 'assistant-text' ? ref.key.owner.messageId : ref.key.owner.clientCommandId,
    ref.key.owner.kind === 'assistant-text' ? ref.key.owner.ordinal : ref.key.owner.kind === 'original' ? ref.key.owner.messageId : ref.key.owner.decisionId,
    ref.epoch, ref.contentId, ref.generation, ref.through, ref.kind, ref.kind === 'canonical' ? ref.sha256 : null]);
  function projectionChanged(conversationId: string, changes?: Partial<ConversationState>): void {
    // Invalidate the previous sync claim before any observer can read the new facts.
    // changed() can publish health itself, so fetch the resulting state, not a stale copy.
    projectionRevisions.set(conversationId, (projectionRevisions.get(conversationId) ?? 0) + 1);
    transcripts.changed(conversationId);
    const state = conversations.get(conversationId);
    if (state) setConversation(conversationId, { ...state, ...changes, revision: state.revision + 1 });
  }
  function putEntry(conversationId: string, entry: Omit<Extract<ProjectionEntry, { kind: 'original' }>, 'displayOrder'> | Omit<Extract<ProjectionEntry, { kind: 'assistant-text' }>, 'displayOrder'> | Omit<Extract<ProjectionEntry, { kind: 'tool' }>, 'displayOrder'> | Omit<Extract<ProjectionEntry, { kind: 'form-reply' }>, 'displayOrder'> | Omit<Extract<ProjectionEntry, { kind: 'compaction' }>, 'displayOrder'> | Omit<Extract<ProjectionEntry, { kind: 'original-capture' }>, 'displayOrder'>): void {
    if (deleting.has(conversationId)) return;
    const entries = projections.get(conversationId) ?? [];
    const index = entries.findIndex(existing => existing.kind === entry.kind && (
      entry.kind === 'original' && existing.kind === 'original' && existing.clientCommandId === entry.clientCommandId ||
      entry.kind === 'assistant-text' && existing.kind === 'assistant-text' && existing.messageId === entry.messageId && existing.ordinal === entry.ordinal ||
      entry.kind === 'tool' && existing.kind === 'tool' && existing.messageId === entry.messageId && existing.toolCallId === entry.toolCallId ||
      entry.kind === 'compaction' && existing.kind === 'compaction' && existing.sessionId === entry.sessionId && existing.eventId === entry.eventId ||
      entry.kind === 'original-capture' && existing.kind === 'original-capture' && existing.clientCommandId === entry.clientCommandId ||
      entry.kind === 'form-reply' && existing.kind === 'form-reply' && existing.clientCommandId === entry.clientCommandId));
    // An observed native event is immutable: replay cannot create or revise a second fact.
    if (index >= 0 && entry.kind === 'compaction') return;
    const old = index < 0 ? undefined : entries[index];
    if (old?.kind === 'assistant-text' && old.body.kind === 'preview' && entry.kind === 'assistant-text' && old.body.generation !== entry.body.generation) reclaimable.set(refIdentity(old.body), old.body);
    const next = { ...entry, displayOrder: index < 0 ? entries.length : entries[index].displayOrder } as ProjectionEntry;
    if ('body' in next) {
      published.add(refIdentity(next.body));
      publishedRefs.set(transferKey(conversationId, next.body.contentId, next.body.generation, next.body.through), next.body);
    }
    const changed = index < 0 || JSON.stringify(entries[index]) !== JSON.stringify(next);
    if (index < 0) entries.push(next); else entries[index] = next;
    projections.set(conversationId, entries);
    if (changed) projectionChanged(conversationId);
  }

  function markPreviewGaps(): void {
    for (const [conversationId, entries] of projections) {
      let changed = false;
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry.kind === 'assistant-text' && entry.closure === 'open' && entry.capture !== 'incomplete') { entries[index] = { ...entry, capture: 'incomplete' }; noteMissing(conversationId, entry.messageId, entry.ordinal); changed = true; }
      }
      if (changed) projectionChanged(conversationId);
    }
  }

  function lifecycle(receipt: CommandReceipt, changes?: Partial<ConversationState>): void {
    if (deleting.has(receipt.conversationId)) return;
    const now = clock.now();
    if (!registeredTimes.has(receipt.clientCommandId)) registeredTimes.set(receipt.clientCommandId, now);
    const entries = projections.get(receipt.conversationId) ?? [];
    entries.push({ kind: 'lifecycle', commandKind: receipt.kind, clientCommandId: receipt.clientCommandId, ...('runId' in receipt ? { runId: receipt.runId } : {}),
      state: receipt.state, sourceTime: now, displayOrder: entries.length });
    projections.set(receipt.conversationId, entries);
    projectionChanged(receipt.conversationId, changes);
  }

  function originalCapture(receipt: SendReceipt | FormReplyReceipt, state: OriginalCaptureState): void {
    if (closed || deleting.has(receipt.conversationId)) return;
    putEntry(receipt.conversationId, { kind: 'original-capture', commandKind: receipt.kind, clientCommandId: receipt.clientCommandId,
      state, sourceTime: clock.now(), ...(receipt.kind === 'send' ? { runId: receipt.runId } : {}) });
  }

  function captureCompaction(conversationId: string, event: Extract<import('@opencode/client').OpenCodeEvent,
    { type: 'session.compaction.started' | 'session.compaction.ended' | 'session.compaction.failed' }>): void {
    if (closed || identityChanged || !monitor?.healthy || monitor.controller.signal.aborted || conversations.get(conversationId)?.creation !== 'ready') return;
    const sessionId = event.data.sessionID;
    // Pinned 2.2.2 has event/session identities and a sequence, but no shared compaction ID.
    if ((sessionConversations.get(sessionId) ?? childConversations.get(sessionId)) !== conversationId ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId) || !/^[A-Za-z0-9_-]{1,128}$/.test(event.id) ||
        !Number.isSafeInteger(event.created) || event.created < 0 || event.created > 8640000000000000 ||
        event.durable.aggregateID !== sessionId || event.durable.version !== 1 || !Number.isSafeInteger(event.durable.seq) || event.durable.seq < 0) return;
    const phase = event.type === 'session.compaction.started' ? 'started' : event.type === 'session.compaction.ended' ? 'ended' : 'failed';
    putEntry(conversationId, { kind: 'compaction', sessionId, eventId: event.id, phase, sourceTime: event.created, sourceSequence: event.durable.seq });
  }

  async function captureText(conversationId: string, messageId: string, ordinal: number, text: string, kind: 'start' | 'delta' | 'end'): Promise<void> {
    if (deleting.has(conversationId) || ownershipInvalid.has(conversationId)) return;
    const key: BodyKey = { conversationId, owner: { kind: 'assistant-text', messageId, ordinal } };
    const existing = projections.get(conversationId)?.find(entry => entry.kind === 'assistant-text' && entry.messageId === messageId && entry.ordinal === ordinal);
    if (existing?.kind === 'assistant-text' && (existing.closure === 'closed' || existing.capture === 'incomplete') && kind !== 'end') return;
    try {
      let body: BodyRef;
      if (kind === 'end') body = await bodies.replace(key, bodyBytes(text), 'canonical');
      else if (existing?.kind === 'assistant-text' && existing.body.kind === 'preview') body = await bodies.append(existing.body, bodyBytes(text));
      else body = await bodies.replace(key, bodyBytes(text), 'preview');
      if (closed || deleting.has(conversationId) || identityChanged || ownershipInvalid.has(conversationId)) return;
      putEntry(conversationId, { kind: 'assistant-text', messageId, ordinal, body, closure: kind === 'end' ? 'closed' : 'open', capture: kind === 'delta' && !existing ? 'incomplete' : 'complete',
        ...(activeRuns.has(conversationId) ? { runId: activeRuns.get(conversationId) } : {}) });
    } catch {
      if (deleting.has(conversationId)) return;
      markPreviewGaps();
      const wasIncomplete = (missingCanonical.get(conversationId)?.size ?? 0) > 0;
      noteMissing(conversationId, messageId, ordinal);
      if (!wasIncomplete) {
        projectionChanged(conversationId);
      }
      serverLogger.log('think_content_outcome', { status: 'unavailable' });
    }
  }
  let maintenanceRunning = false;
  const refreshTimer = setInterval(() => {
    expireTransfers();
    if (!maintenanceRunning && reclaimable.size) {
      maintenanceRunning = true;
      const maintenance = (async () => {
        for (const [key, ref] of reclaimable) {
          if (closed) break;
          if (transcripts.retains(ref)) continue;
          try { const result = await bodies.evict(ref); if (result === 'evicted' || result === 'already-evicted') reclaimable.delete(key); }
          catch { serverLogger.log('think_content_reclaim_outcome', { status: 'unavailable' }); }
        }
      })().finally(() => { maintenanceRunning = false; });
      void trackTransfer(maintenance);
    }
    for (const conversationId of conversations.keys()) {
      // Restored completed chats need no continual history polling without a reader or unresolved work.
      if (restoredOwners.has(conversationId) && !watchers.has(conversationId) && !activeRuns.has(conversationId) &&
          !activeSessions.has(conversationId) && !activityUnknown.has(conversationId) && !checkpointReadsPending.has(conversationId) &&
          !activityWritesPending.has(conversationId) && !missingCanonical.get(conversationId)?.size) continue;
      if (!refreshes.get(conversationId)?.running) requestRefresh(conversationId);
    }
  }, 5000);
  refreshTimer.unref();

  function requireOpen(): void {
    if (closed) throw new ThinkServiceError('think_unavailable');
  }

  function requireAvailable(kind: 'work' | 'stop' = 'work'): void {
    requireOpen();
    if ((persistenceFailed && kind !== 'stop') || identityChanged || !available || (monitor && !monitor.healthy)) throw new ThinkServiceError('think_unavailable');
  }

  function update(receipt: CreateReceipt, state: 'ready' | 'upstream-unconfirmed' | 'rejected', verifiedSelection?: NativeSession): void {
    if (closed) return;
    const next: CreateReceipt = state === 'rejected'
      ? { ...receipt, state, failure: { code: 'ownership_mismatch' } }
      : { kind: 'create', conversationId: receipt.conversationId, clientCommandId: receipt.clientCommandId, epoch, state };
    const previous = conversations.get(receipt.conversationId);
    if (!previous) return;
    persistOutcome(next, verifiedSelection);
    commands.set(receipt.clientCommandId, next);
    lifecycle(next, { creation: state });
  }

  function matches(session: NativeSession, id: string, conversationId: string): boolean {
    const registered = restoredOwners.get(conversationId);
    if (registered) return matchesRegistered(session, registered);
    const marker = session.metadata?.memoryLoop;
    const owner = owners.get(conversationId);
    return owner !== undefined && session.id === id && session.parentID == null && session.location?.directory === directory &&
      typeof marker === 'object' && marker !== null && !Array.isArray(marker) &&
      marker.owner === 'memory-loop' && marker.conversationId === conversationId && marker.epoch === owner.epoch &&
      (owner.installationId === undefined || marker.installationId === owner.installationId) &&
      session.permissions?.length === 1 && session.permissions[0].action === '*' &&
      session.permissions[0].resource === '*' && session.permissions[0].effect === 'allow' &&
      (agent === undefined || session.agent === agent) &&
      (model === undefined || (session.model?.providerID === model.providerID && session.model.id === model.id &&
        (model.variant === undefined ? session.model.variant === undefined || session.model.variant === 'default' : session.model.variant === model.variant)));
  }

  function matchesRegistered(session: NativeSession, registered: RegisteredConversation): boolean {
    const marker = session.metadata?.memoryLoop;
    const expected = registered.selection ?? registered;
    const sameModel = (actual: NativeSession['model'], selected: NativeSession['model']) =>
      actual?.providerID === selected?.providerID && actual?.id === selected?.id && actual?.variant === selected?.variant;
    return registered.directory === directory && session.id === registered.nativeSessionId && session.parentID == null &&
      session.location?.directory === registered.directory && typeof marker === 'object' && marker !== null && !Array.isArray(marker) &&
      Object.keys(marker).length === Object.keys(registered.owner).length &&
      Object.entries(registered.owner).every(([key, value]) => marker[key] === value) &&
      session.permissions?.length === 1 && session.permissions[0].action === '*' && session.permissions[0].resource === '*' && session.permissions[0].effect === 'allow' &&
      (registered.selection ? session.agent === expected.agent && sameModel(session.model, expected.model)
        : (expected.agent === undefined || session.agent === expected.agent) && (expected.model === undefined || sameModel(session.model, expected.model)));
  }

  function invalidateOwnership(conversationId: string): void {
    ownershipInvalid.add(conversationId);
    refreshEligibility(conversationId);
    serverLogger.log('think_ownership_outcome', { conversationId, status: 'unavailable' });
  }

  function nativeBusy(session: Awaited<ReturnType<NativeSessions['getSession']>>): boolean {
    return session.time.busy !== undefined && (session.time.idle === undefined || session.time.busy > session.time.idle);
  }

  /** Call only after ownership/process/generation checks. Busy and timestamps are not admission proof. */
  function observedAdmission(sessionID: string, messageID: string | null | undefined, attempted: boolean,
    users: ReadonlySet<string>, inbox: Awaited<ReturnType<NativeSessions['listInbox']>> | undefined): boolean {
    return attempted && !!messageID && (users.has(messageID) ||
      inbox?.some(item => item.type === 'user' && item.sessionID === sessionID && item.id === messageID) === true);
  }

  async function nativeCall<T>(controller: AbortController, operation: 'create' | 'creation-selection' | 'readback' | 'monitor-connect' | 'prompt' | 'inbox-list' | 'inbox-cancel' | 'interrupt' | 'status' | 'active' | 'history' | 'identity' | 'form-list' | 'form-get' | 'form-reply' | 'permission-list' | 'message-get' | 'children' | 'remove', call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    serverLogger.log('think_native_attempt', { operation });
    const signal = controller.signal;
    if (signal.aborted) {
      serverLogger.log('think_native_outcome', { operation, outcome: 'aborted' });
      throw new Error('Native call aborted');
    }
    let timedOut = false;
    const timer = setTimeout(() => { if (!signal.aborted) { timedOut = true; controller.abort(); } }, 10000);
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Native call aborted'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const result = await Promise.race([call(signal), aborted]);
      serverLogger.log('think_native_outcome', { operation, outcome: 'success' });
      return result;
    } catch (error) {
      if (timedOut) serverLogger.warning('think_native_outcome', { operation, outcome: 'timeout', code: 'ETIMEDOUT', category: 'native_deadline' });
      else serverLogger.log('think_native_outcome', { operation, outcome: signal.aborted ? 'aborted' : 'failed', ...(!signal.aborted ? safeError(error, 'native_call_failure') : {}) });
      throw error;
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  async function verifyIdentity(controller: AbortController): Promise<boolean> {
    try {
      const info = await nativeCall(controller, 'identity', signal => native.getServerInfo(signal));
      if (info.pid !== identity.pid) {
        identityChanged = true;
        available = false;
        refreshAllEligibility();
        monitor?.controller.abort();
        serverLogger.log('think_identity_outcome', { status: 'changed' });
        return false;
      }
      const versionStatus = nativeVersionStatus(info.version, minimumVersion);
      if (versionStatus !== 'compatible') {
        available = false;
        refreshAllEligibility();
        serverLogger.log('think_native_version_outcome', { source: 'live', status: versionStatus, requiredVersion: minimumVersion });
        return false;
      }
      if (!identityChanged && !closed) { available = true; refreshAllEligibility(); }
      return !identityChanged && !closed;
    } catch {
      if (!closed) { available = false; refreshAllEligibility(); }
      return false;
    }
  }

  async function verifyRestoredOwner(conversationId: string, controller: AbortController): Promise<boolean> {
    const registered = restoredOwners.get(conversationId);
    if (!registered) return true;
    try {
      const current = await nativeCall(controller, 'readback', signal => native.getSession({ sessionID: registered.nativeSessionId }, signal));
      if (closed || controller.signal.aborted || identityChanged) return false;
      if (!matchesRegistered(current, registered)) { invalidateOwnership(conversationId); return false; }
      return !ownershipInvalid.has(conversationId);
    } catch {
      activityUnknown.add(conversationId); refreshEligibility(conversationId);
      return false;
    }
  }

  async function openPublishedBody(ref: BodyRef): Promise<BodyReader> {
    requireOwnedTarget(ref.key.conversationId);
    if (ownershipInvalid.has(ref.key.conversationId)) throw new ThinkServiceError('content_unavailable');
    const key = refIdentity(ref);
    if (!published.has(key)) throw new ThinkServiceError('not_found');
    try {
      const reader = await bodies.open(ref);
      if (deleting.has(ref.key.conversationId)) { await reader.close(); throw new ThinkServiceError('content_unavailable'); }
      return reader;
    }
    catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'unavailable' && 'reason' in error && error.reason === 'evicted') || ref.kind !== 'canonical') throw new ThinkServiceError('content_unavailable');
    }
    const locator = locators.get(key);
    if (!locator || closed) throw new ThinkServiceError('content_unavailable');
    let work = rehydrations.get(key);
    if (!work) {
      const controller = new AbortController();
      const promise = (async () => {
        if (!await verifyIdentity(controller) || !await verifyRestoredOwner(ref.key.conversationId, controller)) throw new ThinkServiceError('content_unavailable');
        const message = await nativeCall(controller, 'message-get', signal => native.getMessage({ sessionID: locator.sessionID, messageID: locator.messageID }, signal));
        if (message.id !== locator.messageID || message.type !== 'assistant' || message.time.completed === undefined) throw new ThinkServiceError('content_unavailable');
        const part = message.content.filter(item => item.type === 'text')[locator.ordinal];
        if (!part || part.type !== 'text' || Buffer.byteLength(part.text, 'utf8') !== ref.through || createHash('sha256').update(part.text, 'utf8').digest('hex') !== ref.sha256 ||
            !await verifyIdentity(controller) || !await verifyRestoredOwner(ref.key.conversationId, controller) || controller.signal.aborted || closed || deleting.has(ref.key.conversationId)) throw new ThinkServiceError('content_unavailable');
        const guard = await bodies.restore(ref, bodyBytes(part.text));
        if (closed || deleting.has(ref.key.conversationId) || controller.signal.aborted) { await guard.close(); throw new ThinkServiceError('content_unavailable'); }
        return guard;
      })();
      trackTask(controller, promise.then(() => {}, () => {}).finally(() => { tasks.delete(controller); }), ref.key.conversationId);
      work = { promise, waiters: 0 };
      rehydrations.set(key, work);
    }
    work.waiters++;
    try {
      await work.promise;
      if (closed || deleting.has(ref.key.conversationId)) throw new ThinkServiceError('content_unavailable');
      return await bodies.open(ref);
    } catch { throw new ThinkServiceError('content_unavailable'); }
    finally {
      work.waiters--;
      if (!work.waiters) {
        rehydrations.delete(key);
        const guard = await work.promise.catch(() => undefined);
        if (guard) { await guard.close(); if (!closed && !deleting.has(ref.key.conversationId)) reclaimable.set(key, ref); }
      }
    }
  }

  async function verifyBeforeCreate(): Promise<void> {
    const controller = new AbortController();
    const check = (async () => {
      if (!await verifyIdentity(controller)) throw new ThinkServiceError('think_unavailable');
      if (options.validateCreation) {
        const validateCreation = options.validateCreation;
        try { await nativeCall(controller, 'creation-selection', signal => validateCreation(signal)); }
        catch { throw new ThinkServiceError('think_unavailable'); }
        if (!await verifyIdentity(controller)) throw new ThinkServiceError('think_unavailable');
      }
    })();
    const owned = check.catch(() => {});
    tasks.set(controller, owned);
    try {
      await check;
      requireAvailable();
    } finally { tasks.delete(controller); }
  }

  function ownedSession(conversationId: string): string {
    requireTarget(conversationId);
    if (!uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
    const state = conversations.get(conversationId);
    if (!state) throw new ThinkServiceError('not_found');
    if (state.creation !== 'ready' || ownershipInvalid.has(conversationId)) throw new ThinkServiceError('think_unavailable');
    return `ses_memoryloop_${conversationId.replaceAll('-', '')}`;
  }

  async function ownedRead<T>(conversationId: string, operation: 'form-list' | 'form-get', call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    requireTarget(conversationId);
    requireAvailable();
    const controller = new AbortController();
    const task = (async () => {
      if (!await verifyIdentity(controller) || !await verifyRestoredOwner(conversationId, controller)) throw new ThinkServiceError('think_unavailable');
      try {
        const value = await nativeCall(controller, operation, call);
        if (!await verifyRestoredOwner(conversationId, controller)) throw new ThinkServiceError('think_unavailable');
        requireTarget(conversationId);
        return value;
      }
      catch { throw new ThinkServiceError('think_unavailable'); }
    })();
    trackTask(controller, task.then(() => {}, () => {}), conversationId);
    try { return await task; } finally { tasks.delete(controller); }
  }

  function projectForm(form: FormInfo, conversationId: string, sessionID: string): FormDecision {
    if (form.sessionID !== sessionID || !/^[A-Za-z0-9_-]{1,128}$/.test(form.id) || typeof form.title !== 'string' || !Array.isArray(form.fields)) throw new ThinkServiceError('decision_unavailable');
    const fields: FormDecision['fields'] = [];
    const keys = ['key', 'type', 'title', 'description', 'required', 'hidden', 'when', 'minimum', 'maximum', 'default', 'format', 'minLength', 'maxLength', 'pattern', 'placeholder', 'options', 'custom', 'minItems', 'maxItems'];
    for (const field of form.fields) {
      if (!field || field.type === 'external' || !['string', 'number', 'integer', 'boolean', 'multiselect'].includes(field.type)) throw new ThinkServiceError('decision_unavailable');
      const projected = Object.fromEntries(Object.entries(field).filter(([key]) => keys.includes(key)));
      if ('when' in field && field.when) projected.when = field.when.map(item => ({ key: item.key, op: item.op, value: item.value }));
      if ('options' in field && field.options) projected.options = field.options.map(item => ({ value: item.value, label: item.label, ...(item.description === undefined ? {} : { description: item.description }) }));
      fields.push(projected as FormDecision['fields'][number]);
    }
    const decision: FormDecision = { conversationId, decisionId: form.id, kind: 'form', title: form.title, fields };
    if (Buffer.byteLength(JSON.stringify(decision)) > 48 * 1024) throw new ThinkServiceError('decision_unavailable');
    return decision;
  }

  async function dispatch(receipt: CreateReceipt, controller: AbortController): Promise<void> {
    const id = `ses_memoryloop_${receipt.conversationId.replaceAll('-', '')}`;
    const owner = owners.get(receipt.conversationId);
    if (!owner) return;
    const input: SessionCreateInput = {
      id, location: { directory }, permissions: [{ action: '*', resource: '*', effect: 'allow' }],
      metadata: { memoryLoop: { ...owner } },
      ...(agent === undefined ? {} : { agent }), ...(model === undefined ? {} : { model: { ...model } }),
    };
    try {
      if (!await verifyIdentity(controller)) throw new Error('Native identity unavailable');
      if (!markAttempted(receipt.clientCommandId)) { update(receipt, 'upstream-unconfirmed'); return; }
      await nativeCall(controller, 'create', signal => native.createSession(input, signal));
      const session = await nativeCall(controller, 'readback', signal => native.getSession({ sessionID: id }, signal));
      const valid = matches(session, id, receipt.conversationId);
      serverLogger.log('think_create_readback', { outcome: valid ? 'verified' : 'mismatch' });
      update(receipt, valid ? 'ready' : 'rejected', valid ? session : undefined);
    } catch {
      update(receipt, 'upstream-unconfirmed');
    }
  }

  function setPermissionPending(conversationId: string, pending: boolean): void {
    const state = conversations.get(conversationId);
    if (!state || (pending === (state.permissionPending ?? false) && (!pending || state.permissionCompatibility === 'incompatible'))) return;
    setConversation(conversationId, { ...state, revision: state.revision + 1, permissionPending: pending,
      ...(pending ? { permissionCompatibility: 'incompatible' as const } : {}) });
  }

  function startMonitor() {
    if (monitor) return monitor;
    const controller = new AbortController();
    let setConnected: (value: boolean) => void = () => {};
    const connected = new Promise<boolean>(resolve => { setConnected = resolve; });
    const current = { controller, connected, task: Promise.resolve(), healthy: false, generation: 0 };
    monitor = current;
    refreshAllEligibility();
    current.task = (async () => {
      serverLogger.log('think_monitor_attempt');
      try {
        let delay = 100;
        while (!controller.signal.aborted && !identityChanged) {
          let iterator: AsyncIterator<import('@opencode/client').OpenCodeEvent> | undefined;
          let connectedAt: number | undefined;
          try {
            iterator = native.subscribe({}, controller.signal)[Symbol.asyncIterator]();
            while (!controller.signal.aborted) {
              const item = await nextOrAbort(iterator, controller.signal);
              if (item === 'aborted' || item.done) break;
              if (item.value.type === 'server.connected' && !current.healthy) {
                const identityController = new AbortController();
                const abortIdentity = () => identityController.abort();
                controller.signal.addEventListener('abort', abortIdentity, { once: true });
                let valid: boolean;
                try { valid = await verifyIdentity(identityController); }
                finally { controller.signal.removeEventListener('abort', abortIdentity); }
                if (!valid || controller.signal.aborted) break;
                current.healthy = true;
                refreshAllEligibility();
                current.generation++;
                connectedAt = Date.now();
                setConnected(true);
                for (const conversationId of conversations.keys()) requestRefresh(conversationId);
              } else if (current.healthy && item.value.type === 'session.created' && item.value.data.parentID && item.value.data.location.directory === directory) {
                const owner = sessionConversations.get(item.value.data.parentID) ?? childConversations.get(item.value.data.parentID);
                if (owner) { childConversations.set(item.value.data.sessionID, owner); requestRefresh(owner); }
              } else if (current.healthy && (item.value.type.startsWith('session.') || item.value.type.startsWith('permission.')) && 'data' in item.value &&
                  typeof item.value.data === 'object' && item.value.data !== null && 'sessionID' in item.value.data &&
                  typeof item.value.data.sessionID === 'string') {
                const compaction = item.value.type === 'session.compaction.started' || item.value.type === 'session.compaction.ended' || item.value.type === 'session.compaction.failed';
                const conversationId = sessionConversations.get(item.value.data.sessionID) ?? (item.value.type.startsWith('permission.') || compaction ? childConversations.get(item.value.data.sessionID) : undefined);
                if (conversationId) {
                  const event = item.value;
                  if (event.type === 'permission.asked') setPermissionPending(conversationId, true);
                  if (event.type === 'session.text.started') await captureText(conversationId, event.data.assistantMessageID, event.data.ordinal, '', 'start');
                  else if (event.type === 'session.text.delta') await captureText(conversationId, event.data.assistantMessageID, event.data.ordinal, event.data.delta, 'delta');
                  else if (event.type === 'session.text.ended') await captureText(conversationId, event.data.assistantMessageID, event.data.ordinal, event.data.text, 'end');
                  else if (event.type === 'session.compaction.started' || event.type === 'session.compaction.ended' || event.type === 'session.compaction.failed') captureCompaction(conversationId, event);
                  requestRefresh(conversationId);
                }
              }
            }
            serverLogger.log('think_monitor_outcome', { outcome: controller.signal.aborted ? 'closed' : 'ended' });
          } catch (error) {
            serverLogger.log('think_monitor_outcome', { operation: 'event_stream', outcome: 'failed', ...safeError(error, 'native_stream_failure') });
          } finally {
            if (current.healthy && !controller.signal.aborted) markPreviewGaps();
            current.healthy = false;
            current.generation++;
            if (!closed) available = false;
            refreshAllEligibility();
            if (iterator?.return) void Promise.resolve().then(() => iterator?.return?.()).catch(() => {});
          }
          if (controller.signal.aborted || identityChanged) break;
          if (connectedAt !== undefined && Date.now() - connectedAt >= 30000) delay = 100;
          await new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
            const timer = setTimeout(done, delay);
            timer.unref();
            controller.signal.addEventListener('abort', done, { once: true });
            if (controller.signal.aborted) done();
          });
          delay = Math.min(delay * 2, 5000);
        }
      } finally {
        current.healthy = false;
        setConnected(false);
        if (monitor === current) monitor = undefined;
        refreshAllEligibility();
      }
    })();
    return current;
  }

  /** Request cancellation never owns shared recovery. Close/process/monitor fences do. */
  async function ensureConversation(conversationId: string): Promise<void> {
    requireTarget(conversationId);
    if (!uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
    if (conversations.has(conversationId)) return;
    const registry = options.state?.registry;
    if (!registry) return;
    const pending = hydrations.get(conversationId);
    if (pending) return pending;
    // No unbounded recovery fan-out; another read can retry when a slot is free.
    if (hydrations.size >= 2) throw new ThinkServiceError('think_unavailable');
    const registered = stateOperation(() => registry.conversation(conversationId));
    if (!registered) return; // Native metadata alone never authorizes adoption.
    if (registered.directory !== directory || registered.creation === 'rejected' || registered.lifecycle !== 'live' || registered.purpose !== 'think') throw new ThinkServiceError('think_unavailable');
    const controller = new AbortController();
    const task = Promise.resolve().then(async () => {
      serverLogger.log('think_hydration_attempt', { conversationId });
      try {
        if (!await verifyIdentity(controller)) throw new Error('Native process unavailable');
        const session = await nativeCall(controller, 'readback', signal => native.getSession({ sessionID: registered.nativeSessionId }, signal));
        if (!matchesRegistered(session, registered)) throw new Error('Native owner mismatch');
        const monitored = startMonitor();
        if (!await nativeCall(controller, 'monitor-connect', () => monitored.connected) || !monitored.healthy) throw new Error('Monitor unavailable');
        const generation = monitored.generation;
        const history = await restoreHistory({ conversationId, registry, bodies,
          readPage: cursor => nativeCall(controller, 'history', signal => native.listMessages(cursor
            ? { sessionID: registered.nativeSessionId, cursor, limit: 50 } : { sessionID: registered.nativeSessionId, order: 'asc', limit: 50 }, signal)),
          stopping: () => closed || deleting.has(conversationId) || controller.signal.aborted || identityChanged });
        const [current, active, inbox, permissions] = await Promise.all([
          nativeCall(controller, 'status', signal => native.getSession({ sessionID: registered.nativeSessionId }, signal)),
          nativeCall(controller, 'active', signal => native.activeSessions(signal)),
          nativeCall(controller, 'inbox-list', signal => native.listInbox({ sessionID: registered.nativeSessionId }, signal)),
          nativeCall(controller, 'permission-list', signal => native.listPermissionRequests({ location: { directory } }, signal)),
        ]);
        if (!matchesRegistered(current, registered) || !await verifyIdentity(controller) || closed || deleting.has(conversationId) || controller.signal.aborted ||
            monitor !== monitored || !monitored.healthy || monitored.generation !== generation) throw new Error('Hydration authority changed');
        const latest = stateOperation(() => registry.conversation(conversationId));
        if (!latest || latest.lifecycle !== 'live' || latest.rowVersion !== registered.rowVersion) throw new Error('Hydration registry changed');
        persistCanonical(conversationId, history.activities);
        const unresolved = history.commands.filter(command => command.receipt.kind === 'send' && !terminalSend(command.receipt.state));
        if (unresolved.length > 1) throw new Error('Multiple unresolved Send reservations');
        // Transcript read failure is a logging gap, never failure of original admission or native work.
        try { for (const key of missingConfirmedText(options.state?.transcripts, conversationId, history.entries)) history.missing.add(key); }
        catch {
          checkpointReadsPending.add(conversationId);
          serverLogger.log('think_transcript_read_outcome', { conversationId, status: 'unavailable' });
          // Ordinary storage failure keeps the writer's existing delayed I/O warning policy.
        }
        const creates = history.commands.filter(command => command.receipt.kind === 'create');
        if (creates.length !== 1 || creates[0].receipt.kind !== 'create') throw new Error('Missing registered creation');
        const creation: CreateReceipt = { conversationId, clientCommandId: creates[0].receipt.clientCommandId, kind: 'create', epoch, state: 'ready' };
        if (creates[0].receipt.state !== 'ready') persistOutcome(creation, current);
        for (const command of history.commands) {
          let receipt = { ...command.receipt, epoch };
          if (receipt.kind === 'create') receipt = creation;
          if (receipt.kind === 'send' && !terminalSend(receipt.state) &&
              observedAdmission(registered.nativeSessionId, command.nativeMessageId, command.attempted, history.users, inbox)) {
            receipt = { ...receipt, state: 'admitted' };
            if (command.receipt.state !== 'admitted') persistOutcome(receipt);
          }
          commands.set(receipt.clientCommandId, receipt);
          registeredTimes.set(receipt.clientCommandId, command.registeredAt);
          if (receipt.kind === 'send') {
            if (command.payloadSha256) sendDigests.set(receipt.clientCommandId, command.payloadSha256);
            runs.set(receipt.runId, { conversationId, sendCommandId: receipt.clientCommandId, ...(command.nativeMessageId ? { nativeMessageId: command.nativeMessageId } : {}) });
            if (!terminalSend(receipt.state)) activeRuns.set(conversationId, receipt.runId);
            if (command.attempted) dispatchedRuns.add(receipt.runId);
          } else if (receipt.kind === 'form-reply' && command.payloadSha256) replyPayloads.set(receipt.clientCommandId, command.payloadSha256);
          if (receipt.kind === 'stop') stoppedRuns.add(receipt.runId);
          const fact = history.entries.find(entry => entry.kind === 'lifecycle' && entry.clientCommandId === receipt.clientCommandId);
          if (fact?.kind === 'lifecycle') fact.state = receipt.state;
        }
        owners.set(conversationId, registered.owner);
        restoredOwners.set(conversationId, registered);
        sessionConversations.set(registered.nativeSessionId, conversationId);
        if (active[registered.nativeSessionId] || nativeBusy(current) || inbox.some(item => item.sessionID === registered.nativeSessionId)) activeSessions.add(conversationId);
        missingCanonical.set(conversationId, history.missing);
        // Publish all manifests/refs together, only after the final native/process checks.
        for (const entry of history.entries) {
          if (!('body' in entry)) continue;
          published.add(refIdentity(entry.body));
          publishedRefs.set(transferKey(conversationId, entry.body.contentId, entry.body.generation, entry.body.through), entry.body);
          if (entry.kind === 'assistant-text' && entry.body.kind === 'canonical') {
            const key = refIdentity(entry.body);
            locators.set(key, { sessionID: registered.nativeSessionId, messageID: entry.messageId, ordinal: entry.ordinal });
            reclaimable.set(key, entry.body);
          }
        }
        projections.set(conversationId, history.entries);
        projectionRevisions.set(conversationId, (projectionRevisions.get(conversationId) ?? 0) + 1);
        transcripts.changed(conversationId);
        const transcript = transcripts.health(conversationId);
        const otherTranscriptWarnings = transcripts.warningCount() - (transcript.warning ? 1 : 0);
        setConversation(conversationId, { conversationId, epoch, creation: 'ready', revision: 1, sendEligibility: 'unavailable',
          ...(transcript.state !== 'not-started' ? { transcript } : {}),
          ...(otherTranscriptWarnings ? { otherTranscriptWarnings } : {}) });
        setPermissionPending(conversationId, permissions.data.some(permission => permission.sessionID === registered.nativeSessionId));
        requestRefresh(conversationId);
        serverLogger.log('think_hydration_outcome', { conversationId, status: 'ready' });
      } catch {
        controller.abort();
        serverLogger.log('think_hydration_outcome', { conversationId, status: 'unavailable' });
        throw new ThinkServiceError('think_unavailable');
      }
    });
    hydrations.set(conversationId, task);
    trackTask(controller, task.then(() => {}, () => {}), conversationId);
    try { await task; }
    finally { hydrations.delete(conversationId); tasks.delete(controller); }
  }

  function updateSend(receipt: SendReceipt, state: SendReceipt['state']): void {
    if (closed || deleting.has(receipt.conversationId)) return;
    const current = commands.get(receipt.clientCommandId);
    if (current?.kind === 'send' && (current.state === 'completed' || current.state === 'failed' || current.state === 'interrupted' || current.state === 'rejected' || current.state === 'cancelled-before-delivery')) return;
    const { failure: _failure, ...base } = receipt;
    const next: SendReceipt = state === 'failed' ? { ...base, state, failure: { code: 'execution_failed' } }
      : state === 'rejected' ? { ...base, state, failure: { code: 'resource_failure' } } : { ...base, state };
    if (current?.kind === 'send' && current.state === state) return;
    persistOutcome(next);
    commands.set(receipt.clientCommandId, next);
    lifecycle(next);
  }

  function settleSend(receipt: SendReceipt, state?: 'rejected' | 'cancelled-before-delivery' | 'completed' | 'failed' | 'interrupted'): void {
    if (state) updateSend(receipt, state);
    if (activeRuns.get(receipt.conversationId) === receipt.runId) {
      activeRuns.delete(receipt.conversationId);
      refreshEligibility(receipt.conversationId);
    }
  }

  async function dispatchSend(receipt: SendReceipt, text: string, controller: AbortController): Promise<void> {
    if (controller.signal.aborted || deleting.has(receipt.conversationId)) return;
    const messageId = `msg_memoryloop_${receipt.clientCommandId.replaceAll('-', '')}`;
    try {
      serverLogger.log('think_original_capture_attempt');
      const body = await bodies.replace({ conversationId: receipt.conversationId, owner: { kind: 'original', clientCommandId: receipt.clientCommandId, messageId } }, bodyBytes(text), 'canonical');
      if (controller.signal.aborted || closed || deleting.has(receipt.conversationId)) return;
      putEntry(receipt.conversationId, { kind: 'original', clientCommandId: receipt.clientCommandId, messageId, body, runId: receipt.runId, sourceTime: registeredTimes.get(receipt.clientCommandId) });
      originalCapture(receipt, 'captured');
      serverLogger.log('think_original_capture_outcome', { status: 'stored' });
      if (stoppedRuns.has(receipt.runId)) return;
    } catch {
      serverLogger.log('think_original_capture_outcome', { status: 'failed' });
      originalCapture(receipt, 'failed');
      // Stop owns the cancellation receipt when capture fails after Stop was registered.
      settleSend(receipt, stoppedRuns.has(receipt.runId) ? undefined : 'rejected');
      return;
    }
    const current = startMonitor();
    try {
      const connected = await nativeCall(controller, 'monitor-connect', () => current.connected);
      if (!connected || !current.healthy || !await verifyIdentity(controller) ||
          !await verifyRestoredOwner(receipt.conversationId, controller) || !current.healthy) throw new Error('Monitor unavailable');
    } catch {
      if (!current.healthy) current.controller.abort();
      updateSend(receipt, stoppedRuns.has(receipt.runId) ? 'cancelled-before-delivery' : 'monitor-unavailable');
      return;
    }
    if (stoppedRuns.has(receipt.runId)) { settleSend(receipt, 'cancelled-before-delivery'); return; }
    if (!markAttempted(receipt.clientCommandId)) { updateSend(receipt, 'upstream-unconfirmed'); return; }
    const id = messageId;
    dispatchedRuns.add(receipt.runId);
    try {
      const result = await nativeCall(controller, 'prompt', signal => native.prompt({
        sessionID: `ses_memoryloop_${receipt.conversationId.replaceAll('-', '')}`, id, text,
        metadata: { memoryLoop: { runId: receipt.runId, clientCommandId: receipt.clientCommandId, epoch } },
      }, signal));
      updateSend(receipt, result.id === id ? 'admitted' : 'upstream-unconfirmed');
      requestRefresh(receipt.conversationId);
    } catch {
      updateSend(receipt, 'upstream-unconfirmed');
      requestRefresh(receipt.conversationId);
    }
  }

  function requestRefresh(conversationId: string): void {
    if (closed || deleting.has(conversationId) || identityChanged || conversations.get(conversationId)?.creation !== 'ready' || !monitor?.healthy) return;
    let refresh = refreshes.get(conversationId);
    if (!refresh) { refresh = { generation: 0, running: false }; refreshes.set(conversationId, refresh); }
    refresh.generation++;
    if (refresh.running) return;
    refresh.running = true;
    const state = refresh;
    const controller = new AbortController();
    const task = Promise.resolve().then(async () => {
      let processedGeneration = state.generation;
      try {
        while (!controller.signal.aborted && !closed && !deleting.has(conversationId) && monitor?.healthy && conversations.get(conversationId)?.creation === 'ready') {
          const generation = state.generation;
          processedGeneration = generation;
          const monitored = monitor;
          const monitorGeneration = monitored.generation;
          const runId = activeRuns.get(conversationId);
          const run = runId ? runs.get(runId) : undefined;
          if (runId && !run) break;
          const sessionID = `ses_memoryloop_${conversationId.replaceAll('-', '')}`;
          const promptID = run?.nativeMessageId;
          const registryAtStart = options.state?.registry?.conversation(conversationId);
          if (registryAtStart && (registryAtStart.lifecycle !== 'live' || registryAtStart.purpose !== 'think')) break;
          if (!await verifyIdentity(controller)) break;
          // A failed read cancels its batch, not the owner needed to fence successful observations.
          const batch = new AbortController();
          const abortBatch = () => batch.abort();
          controller.signal.addEventListener('abort', abortBatch, { once: true });
          if (controller.signal.aborted) batch.abort();
          let session: Awaited<ReturnType<NativeSessions['getSession']>> | undefined;
          let active: Awaited<ReturnType<NativeSessions['activeSessions']>> | undefined;
          let inbox: Awaited<ReturnType<NativeSessions['listInbox']>> | undefined;
          let permissions: Awaited<ReturnType<NativeSessions['listPermissionRequests']>> | undefined;
          const reads = [
            nativeCall(batch, 'status', signal => native.getSession({ sessionID }, signal)).then(value => { session = value; }),
            nativeCall(batch, 'active', signal => native.activeSessions(signal)).then(value => { active = value; }),
            nativeCall(batch, 'permission-list', signal => native.listPermissionRequests({ location: { directory } }, signal)).then(value => { permissions = value; }),
          ];
          if (restoredOwners.has(conversationId)) reads.push(nativeCall(batch, 'inbox-list', signal => native.listInbox({ sessionID }, signal)).then(value => { inbox = value; }));
          try {
            await Promise.all(reads);
          } catch (error) {
            // The bounded call wrappers settle on abort even if an adapter ignores its signal.
            batch.abort();
            await Promise.allSettled(reads);
            serverLogger.log('think_reconciliation_outcome', { operation: 'read_batch', conversationId, runId, outcome: controller.signal.aborted ? 'aborted' : 'unavailable', ...(!controller.signal.aborted ? safeError(error, 'native_read_failure') : {}) });
          } finally {
            controller.signal.removeEventListener('abort', abortBatch);
          }
          if (session && !matches(session, sessionID, conversationId)) { invalidateOwnership(conversationId); break; }
          if (!await verifyIdentity(controller)) break;
          if (state.generation !== generation) continue;
          if (closed || deleting.has(conversationId) || identityChanged || monitor !== monitored || !monitor?.healthy || monitored.generation !== monitorGeneration || activeRuns.get(conversationId) !== runId) break;
          // Only a successful read can replace its channel's facts; unrelated failures retain them.
          if (active) {
            if (active[sessionID] || restoredOwners.has(conversationId) && ((session && nativeBusy(session)) || (inbox?.length ?? 0) > 0)) activeSessions.add(conversationId);
            else activeSessions.delete(conversationId);
            refreshEligibility(conversationId);
          }
          if (restoredOwners.has(conversationId)) {
            if (session && active && inbox) activityUnknown.delete(conversationId); else activityUnknown.add(conversationId);
            refreshEligibility(conversationId);
          }
          if (permissions) setPermissionPending(conversationId, permissions.data.some(permission => permission.sessionID === sessionID || childConversations.get(permission.sessionID) === conversationId));
          if (!session) break;
          let cursor: string | undefined;
          const seen = new Set<string>();
          let userTime: number | undefined;
          const observedUsers = new Set<string>();
          let assistantTime: { created: number; completed: number; outcome: 'completed' | 'failed' } | undefined;
          const captured: ProjectionEntry[] = [];
          const succeededKeys = new Set<string>();
          const failedKeys = new Set<string>();
          const activities: CanonicalActivity[] = [];
          do {
            const page = await nativeCall(controller, 'history', signal => native.listMessages(cursor
              ? { sessionID, cursor, limit: 50 } : { sessionID, order: 'asc', limit: 50 }, signal));
            for (const message of page.data) {
              const projected = await projectNativeMessage(conversationId, message, bodies, projections.get(conversationId) ?? [], runId && userTime !== undefined ? runId : undefined);
              captured.push(...projected.entries);
              activities.push(...canonicalActivities(message, projected.entries));
              for (const key of projected.succeeded) succeededKeys.add(key);
              for (const key of projected.missing) failedKeys.add(key);
              if (message.type === 'user') {
                observedUsers.add(message.id);
                userTime = message.id === promptID ? message.time.created : undefined;
                assistantTime = undefined;
              } else if (message.type === 'synthetic') {
                userTime = undefined;
                assistantTime = undefined;
              } else if (userTime !== undefined && message.type === 'assistant') {
                assistantTime = message.time.completed !== undefined && (message.finish === 'stop' && !message.error || message.finish === 'error' && message.error)
                  ? { created: message.time.created, completed: message.time.completed, outcome: message.error ? 'failed' : 'completed' } : undefined;
              }
            }
            const next = page.cursor.next;
            if (next && seen.has(next)) throw new Error('Repeated history cursor');
            if (next) seen.add(next);
            cursor = next ?? undefined;
          } while (cursor);
          if (restoredOwners.has(conversationId)) {
            const currentOwner = await nativeCall(controller, 'readback', signal => native.getSession({ sessionID }, signal));
            if (!matches(currentOwner, sessionID, conversationId)) { invalidateOwnership(conversationId); break; }
          }
          if (!await verifyIdentity(controller)) break;
          if (state.generation !== generation) continue;
          if (closed || deleting.has(conversationId) || identityChanged || monitor !== monitored || !monitor?.healthy || monitored.generation !== monitorGeneration || activeRuns.get(conversationId) !== runId) break;
          const registration = options.state?.registry?.conversation(conversationId);
          if (registration && (registration.lifecycle !== 'live' || registration.purpose !== 'think')) break;
          if (registryAtStart && (!registration || registration.rowVersion !== registryAtStart.rowVersion)) continue;
          persistCanonical(conversationId, activities);
          const wasIncomplete = (missingCanonical.get(conversationId)?.size ?? 0) > 0;
          let missing = missingCanonical.get(conversationId);
          if (!missing) { missing = new Set(); missingCanonical.set(conversationId, missing); }
          for (const key of succeededKeys) missing.delete(key);
          for (const key of failedKeys) missing.add(key);
          if (restoredOwners.has(conversationId)) {
            const present = new Set(captured.filter(entry => entry.kind === 'assistant-text').map(entry =>
              entry.kind === 'assistant-text' ? textKey(entry.messageId, entry.ordinal) : ''));
            for (const entry of projections.get(conversationId) ?? []) {
              if (entry.kind === 'assistant-text' && entry.closure === 'closed' && !present.has(textKey(entry.messageId, entry.ordinal))) missing.add(textKey(entry.messageId, entry.ordinal));
            }
            if (checkpointReadsPending.has(conversationId)) {
              try {
                for (const key of missingConfirmedText(options.state?.transcripts, conversationId, captured)) missing.add(key);
                checkpointReadsPending.delete(conversationId);
              } catch { /* Keep the unresolved read gap; the next owned reconciliation retries it. */ }
            }
          }
          const incomplete = missing.size > 0;
          if (wasIncomplete !== incomplete) {
            projectionChanged(conversationId);
          }
          for (const entry of captured) {
            if (entry.kind === 'assistant-text' || entry.kind === 'tool') {
              putEntry(conversationId, entry);
              if (entry.kind === 'assistant-text' && entry.body.kind === 'canonical' && entry.capture === 'complete') {
                const key = refIdentity(entry.body);
                const first = !locators.has(key);
                locators.set(key, { sessionID, messageID: entry.messageId, ordinal: entry.ordinal });
                if (first) reclaimable.set(key, entry.body);
              }
            }
          }
          const receipt = run ? commands.get(run.sendCommandId) : undefined;
          let terminal: 'interrupted' | 'completed' | 'failed' | undefined;
          if (runId && receipt?.kind === 'send' && dispatchedRuns.has(runId) &&
              (receipt.state === 'registered' || receipt.state === 'admitted' || receipt.state === 'upstream-unconfirmed') && matches(session, sessionID, conversationId) &&
              (!restoredOwners.has(conversationId) || inbox?.every(item => item.id !== promptID)) &&
              active && !active[sessionID] && userTime !== undefined &&
              session.time.busy !== undefined && session.time.idle !== undefined && userTime <= session.time.idle &&
              session.time.idle >= session.time.busy) {
            const assistantCorrelated = assistantTime && assistantTime.created >= userTime && assistantTime.created >= session.time.busy && assistantTime.completed <= session.time.idle;
            terminal = session.outcome === 'interrupted' ? 'interrupted'
              : session.outcome === 'succeeded' && assistantCorrelated && assistantTime?.outcome === 'completed' ? 'completed'
              : session.outcome === 'failed' && assistantCorrelated && assistantTime?.outcome === 'failed' ? 'failed' : undefined;
            if (terminal) {
              settleSend(receipt, terminal);
              serverLogger.log('think_run_reconciled', { outcome: terminal });
            }
          }
          if (!terminal && restoredOwners.has(conversationId) && runId && receipt?.kind === 'send' &&
              receipt.epoch === epoch && receipt.conversationId === conversationId && receipt.runId === runId &&
              (receipt.state === 'registered' || receipt.state === 'upstream-unconfirmed' || receipt.state === 'monitor-unavailable') &&
              observedAdmission(sessionID, promptID, dispatchedRuns.has(runId), observedUsers, inbox)) {
            // The same durable reservation is now verifiably admitted, even while native work
            // remains queued/running. Preserve it; only terminal evidence may release the run.
            updateSend(receipt, 'admitted');
            serverLogger.log('think_run_reconciled', { outcome: 'admitted' });
          }
          if (state.generation === generation) break;
        }
      } catch (error) {
        serverLogger.log('think_reconciliation_outcome', { operation: 'refresh', conversationId, outcome: controller.signal.aborted ? 'aborted' : 'unavailable', ...(!controller.signal.aborted ? safeError(error, 'reconciliation_failure') : {}) });
      } finally {
        state.running = false;
        tasks.delete(controller);
        if (!closed && !identityChanged && monitor?.healthy && state.generation !== processedGeneration) requestRefresh(conversationId);
      }
    });
    trackTask(controller, task, conversationId);
  }

  function updateStop(receipt: StopReceipt, state: StopReceipt['state']): void {
    if (closed || deleting.has(receipt.conversationId)) return;
    persistOutcome({ ...receipt, state });
    commands.set(receipt.clientCommandId, { ...receipt, state });
    lifecycle({ ...receipt, state });
  }

  async function dispatchStop(receipt: StopReceipt, sendCommandId: string, controller: AbortController): Promise<void> {
    const send = commands.get(sendCommandId);
    if (!send || send.kind !== 'send') { updateStop(receipt, 'upstream-unconfirmed'); return; }
    if (!dispatchedRuns.has(receipt.runId)) {
      settleSend(send, 'cancelled-before-delivery');
      updateStop(receipt, 'cancelled-before-delivery');
      return;
    }
    if (send.state !== 'admitted') { updateStop(receipt, 'upstream-unconfirmed'); return; }
    const sessionID = `ses_memoryloop_${receipt.conversationId.replaceAll('-', '')}`;
    const inboxID = runs.get(receipt.runId)?.nativeMessageId;
    if (!inboxID) { updateStop(receipt, 'upstream-unconfirmed'); return; }
    try {
      if (!await verifyIdentity(controller) || !await verifyRestoredOwner(receipt.conversationId, controller)) throw new Error('Native identity unavailable');
      const inbox = await nativeCall(controller, 'inbox-list', signal => native.listInbox({ sessionID }, signal));
      if (!markAttempted(receipt.clientCommandId, 'stop')) { updateStop(receipt, 'upstream-unconfirmed'); return; }
      if (inbox.some(item => item.id === inboxID && item.sessionID === sessionID && item.type === 'user')) {
        await nativeCall(controller, 'inbox-cancel', signal => native.cancelInbox({ sessionID, inboxID }, signal));
      }
      if (activeRuns.get(receipt.conversationId) !== receipt.runId) { updateStop(receipt, 'upstream-unconfirmed'); return; }
      const result = await nativeCall(controller, 'interrupt', signal => native.interruptSession({ sessionID, resume: false }, signal));
      updateStop(receipt, result.interrupted ? 'requested' : 'upstream-unconfirmed');
    } catch {
      updateStop(receipt, 'upstream-unconfirmed');
    }
  }

  /** Synchronous manifest/state read after recovery: no await can split their revision/cursor. */
  function projectionPage(conversationId: string, cursor?: string, sourceRevision?: number): ProjectionPage {
    requireOwnedTarget(conversationId);
    if (ownershipInvalid.has(conversationId)) throw new ThinkServiceError('think_unavailable');
    const state = conversations.get(conversationId);
    if (!state) throw new ThinkServiceError('not_found');
    const revision = sourceRevision ?? state.revision;
    let start = 0;
    if (cursor) {
      const parts = cursor.split('.');
      if (parts.length !== 2 || parts[0].length > 256 || !/^[a-f0-9]{64}$/.test(parts[1])) throw new ThinkServiceError('invalid_request');
      const expected = createHmac('sha256', cursorKey).update(parts[0]).digest();
      if (!timingSafeEqual(expected, Buffer.from(parts[1], 'hex'))) throw new ThinkServiceError('invalid_request');
      let decoded: unknown;
      try { decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new ThinkServiceError('invalid_request'); }
      if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== conversationId || decoded[1] !== revision ||
          !Number.isSafeInteger(decoded[2]) || decoded[2] < 0) throw new ThinkServiceError('invalid_request');
      start = decoded[2];
    }
    const entries = projections.get(conversationId) ?? [];
    const page: ProjectionEntry[] = [];
    let index = start;
    while (index < entries.length && page.length < 50) {
      const candidate = [...page, entries[index]];
      if (Buffer.byteLength(JSON.stringify(candidate)) > 48 * 1024) {
        if (!page.length) throw new ThinkServiceError('think_unavailable');
        break;
      }
      page.push(structuredClone(entries[index])); index++;
    }
    let nextCursor: string | undefined;
    if (index < entries.length) {
      const encoded = Buffer.from(JSON.stringify([conversationId, revision, index])).toString('base64url');
      nextCursor = `${encoded}.${createHmac('sha256', cursorKey).update(encoded).digest('hex')}`;
    }
    return { conversationId, epoch, revision, entries: page, contentHealth: (missingCanonical.get(conversationId)?.size ?? 0) > 0 ? 'incomplete' : 'complete', ...(nextCursor ? { nextCursor } : {}) };
  }

  function managedState(): ThinkStateStore {
    requireOpen();
    if (!options.state?.registry) throw new ThinkServiceError('think_unavailable');
    return options.state;
  }

  /** A bounded read, not history hydration or native mutation. Private version checks follow all external calls. */
  async function inspectConversation(owner: RegisteredConversation, deadline?: AbortSignal, checkDelete = false): Promise<ConversationAvailability> {
    requireOpen();
    const controller = new AbortController();
    const abort = () => controller.abort();
    deadline?.addEventListener('abort', abort, { once: true });
    if (deadline?.aborted) controller.abort();
    const task = (async (): Promise<ConversationAvailability> => {
      let session: Awaited<ReturnType<NativeSessions['getSession']>>;
      let active: Awaited<ReturnType<NativeSessions['activeSessions']>>;
      let inbox: Awaited<ReturnType<NativeSessions['listInbox']>>;
      const unavailable: ConversationAvailability = { state: 'unavailable', busy: false, uncertain: true };
      try {
        if (!await verifyIdentity(controller)) return unavailable;
        [session, active, inbox] = await Promise.all([
          nativeCall(controller, 'status', signal => native.getSession({ sessionID: owner.nativeSessionId }, signal)),
          nativeCall(controller, 'active', signal => native.activeSessions(signal)),
          nativeCall(controller, 'inbox-list', signal => native.listInbox({ sessionID: owner.nativeSessionId }, signal)),
        ]);
      } catch { return unavailable; }
      const busy = nativeBusy(session) || inbox.length > 0 || Object.keys(active).some(id => id === owner.nativeSessionId || childConversations.get(id) === owner.conversationId);
      let deletion: ConversationAvailability['delete'];
      if (checkDelete && !busy) {
        try {
          // Reuse these reads only for advisory capability; POST always inspects independently.
          await inspectDeletion(owner, controller.signal, { root: session, active, inbox });
          deletion = { available: true };
        } catch (error) {
          deletion = { available: false, reason: error instanceof ThinkServiceError && error.code === 'delete_blocked' && error.reason === 'running' ? 'running' : 'status_unknown' };
        }
      }
      try {
        if (!await verifyIdentity(controller)) return unavailable;
      } catch { return unavailable; }
      requireOpen();
      if (controller.signal.aborted || identityChanged) return unavailable;
      const latest = stateOperation(() => managedState().registry?.conversation(owner.conversationId));
      if (!latest || latest.lifecycle !== 'live') return { ...unavailable, state: latest?.lifecycle === 'deleting' ? 'deleting' : 'unavailable' };
      if (!matchesRegistered(session, owner)) { invalidateOwnership(owner.conversationId); return { ...unavailable, ownershipMismatch: true }; }
      if (latest.rowVersion !== owner.rowVersion) return { ...unavailable, state: 'recovering' };
      return { state: owner.creation === 'ready' ? 'ready' : 'recovering', busy, uncertain: false, ...(deletion ? { delete: deletion } : {}) };
    })();
    trackTask(controller, task.then(() => {}, () => {}), owner.conversationId);
    try { return await task; } finally { tasks.delete(controller); deadline?.removeEventListener('abort', abort); }
  }

  /** The owned session-remove-2.2.2 proof confirms cascade even onto ACTIVE children;
   * native removal is not a safety guard or proof that a provider stopped. Conservatively
   * refuse every parent with a child, rather than add subtree removal/recovery machinery. */
  async function inspectDeletion(owner: RegisteredConversation, signal: AbortSignal, observed?: {
    root: Awaited<ReturnType<NativeSessions['getSession']>>;
    active: Awaited<ReturnType<NativeSessions['activeSessions']>>;
    inbox: Awaited<ReturnType<NativeSessions['listInbox']>>;
  }): Promise<void> {
    const controller = new AbortController();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const unknown = () => new ThinkServiceError('delete_blocked', 'status_unknown');
    try {
      if (!observed && !await verifyIdentity(controller)) throw unknown();
      const root = observed?.root ?? await nativeCall(controller, 'status', signal => native.getSession({ sessionID: owner.nativeSessionId }, signal));
      if (!matchesRegistered(root, owner)) throw new ThinkServiceError('command_conflict');
      const active = observed?.active ?? await nativeCall(controller, 'active', signal => native.activeSessions(signal));
      if (active[owner.nativeSessionId] || nativeBusy(root)) throw new ThinkServiceError('delete_blocked', 'running');
      // Do not filter children by location: a cross-directory child must block too.
      const children = await nativeCall(controller, 'children', signal => native.listSessions({ parentID: owner.nativeSessionId, order: 'asc', limit: 1 }, signal));
      const child = children.data[0];
      if (child) {
        if (child.parentID !== owner.nativeSessionId || child.location.directory !== directory) throw unknown();
        if (active[child.id] || nativeBusy(child)) throw new ThinkServiceError('delete_blocked', 'running');
        throw unknown();
      }
      if (children.cursor.next) throw unknown();
      const [inbox, forms, permissions, readback] = await Promise.all([
        observed ? Promise.resolve(observed.inbox) : nativeCall(controller, 'inbox-list', signal => native.listInbox({ sessionID: owner.nativeSessionId }, signal)),
        nativeCall(controller, 'form-list', signal => native.listForms({ sessionID: owner.nativeSessionId }, signal)),
        nativeCall(controller, 'permission-list', signal => native.listPermissionRequests({ location: { directory } }, signal)),
        nativeCall(controller, 'readback', signal => native.getSession({ sessionID: owner.nativeSessionId }, signal)),
      ]);
      if (!matchesRegistered(readback, owner)) throw new ThinkServiceError('command_conflict');
      if (nativeBusy(readback) || inbox.length) throw new ThinkServiceError('delete_blocked', 'running');
      if (forms.length > 50 || permissions.data.some(item => item.sessionID === owner.nativeSessionId)) throw unknown();
      for (const form of forms) {
        if (form.sessionID !== owner.nativeSessionId) throw unknown();
        const detail = await nativeCall(controller, 'form-get', signal => native.getForm({ sessionID: owner.nativeSessionId, formID: form.id }, signal));
        if (detail.id !== form.id || detail.sessionID !== owner.nativeSessionId || detail.state.status === 'pending') throw unknown();
      }
      if (!await verifyIdentity(controller) || closed || controller.signal.aborted || identityChanged) throw unknown();
      const current = stateOperation(() => options.state?.registry?.conversation(owner.conversationId));
      if (!current || current.lifecycle !== owner.lifecycle || current.rowVersion !== owner.rowVersion) throw new ThinkServiceError('selection_conflict');
    } catch (error) {
      if (error instanceof ThinkServiceError) throw error;
      throw unknown();
    } finally { signal.removeEventListener('abort', abort); }
  }
  const deletion = createDeletionService({ state: options.state, directory, epoch, now: () => clock.now(), requireOpen,
    previous: previousCommand, pendingCommand: id => preparingReplies.has(id), fence: fenceConversation,
    quiesce: quiesceConversation, purge: id => bodies.purge(id), io: options.transcript?.io,
    native: {
      async inspect(owner, signal) { await inspectDeletion(owner, signal); },
      async remove(owner, signal, beforeEffect) {
        await inspectDeletion(owner, signal);
        const controller = new AbortController(); const abort = () => controller.abort();
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) controller.abort();
        try {
          beforeEffect();
          await nativeCall(controller, 'remove', signal => native.removeSession({ sessionID: owner.nativeSessionId }, signal));
          if (!await verifyIdentity(controller)) throw new ThinkServiceError('delete_blocked', 'status_unknown');
        } finally { signal.removeEventListener('abort', abort); }
      },
    } });

  const registryConversations = createConversationService({ state: options.state, directory, epoch, clock, deletion,
    requireOpen, onPersistenceFailure: disablePersistence, activityPending: () => activityWritesPending.size > 0,
    commands: { previous: previousCommand, pending: id => preparingReplies.has(id) || deletion.preparing(id), remember: receipt => { commands.set(receipt.clientCommandId, receipt); } },
    native: { inspect: inspectConversation, async prepare(conversationId) {
      await ensureConversation(conversationId);
      const current = stateOperation(() => managedState().registry?.conversation(conversationId));
      const observed = current ? await inspectConversation(current) : { state: 'unavailable' as const, busy: false, uncertain: true };
      return conversations.get(conversationId)?.creation === 'ready' ? observed : { state: 'unavailable', busy: false, uncertain: true };
    } } });

  const service: ThinkService = {
    delete: registryConversations.delete,
    startRecovery: registryConversations.startRecovery,
    registerView: registryConversations.registerView,
    selection: registryConversations.selection,
    select: registryConversations.select,
    recentConversations: registryConversations.recentConversations,
    resume: registryConversations.resume,
    content: {
      async page(conversationId, cursor) {
        requireTarget(conversationId);
        if (!uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
        await ensureConversation(conversationId);
        requireTarget(conversationId);
        return projectionPage(conversationId, cursor);
      },
      async open(ref) {
        requireTarget(ref.key.conversationId);
        return trackTransfer(openPublishedBody(ref), ref.key.conversationId);
      },
    },
    async create(command) {
      requireOpen();
      if (!command || typeof command.conversationId !== 'string' || !uuid.test(command.conversationId) ||
          typeof command.clientCommandId !== 'string' || !uuid.test(command.clientCommandId)) {
        throw new ThinkServiceError('invalid_request');
      }
      const { conversationId, clientCommandId } = command;
      if (preparingReplies.has(clientCommandId) || deletion.preparing(clientCommandId)) throw new ThinkServiceError('command_conflict');
      const previous = previousCommand(clientCommandId);
      if (previous) {
        if (previous.kind !== 'create' || previous.conversationId !== conversationId) throw new ThinkServiceError('command_conflict');
        return previous.state === 'rejected' ? { ...previous, failure: { ...previous.failure } } : { ...previous };
      }
      requireAvailable();
      await verifyBeforeCreate();
      const raced = previousCommand(clientCommandId);
      if (raced) {
        if (raced.kind !== 'create' || raced.conversationId !== conversationId) throw new ThinkServiceError('command_conflict');
        return raced.state === 'rejected' ? { ...raced, failure: { ...raced.failure } } : { ...raced };
      }
      if (conversations.has(conversationId)) throw new ThinkServiceError('command_conflict');
      const receipt: CreateReceipt = { kind: 'create', conversationId, clientCommandId, epoch, state: 'registered' };
      const registeredAt = clock.now();
      const owner: ThinkOwner = { owner: 'memory-loop', conversationId, epoch,
        ...(options.state ? { installationId: options.state.installationId } : {}) };
      stateOperation(() => options.state?.registerConversation({ conversationId,
        nativeSessionId: `ses_memoryloop_${conversationId.replaceAll('-', '')}`, directory, owner,
        ...(agent === undefined ? {} : { agent }), ...(model === undefined ? {} : { model }) }, receipt, registeredAt));
      registeredTimes.set(clientCommandId, registeredAt);
      owners.set(conversationId, owner);
      const otherTranscriptWarnings = transcripts.warningCount();
      const state: ConversationState = { conversationId, epoch, revision: 1, creation: 'registered', sendEligibility: 'unavailable', ...(otherTranscriptWarnings ? { otherTranscriptWarnings } : {}) };
      commands.set(clientCommandId, receipt);
      setConversation(conversationId, state);
      lifecycle(receipt);
      sessionConversations.set(`ses_memoryloop_${conversationId.replaceAll('-', '')}`, conversationId);
      serverLogger.log('think_create_registered');
      const controller = new AbortController();
      const task = Promise.resolve().then(() => dispatch(receipt, controller)).finally(() => { tasks.delete(controller); });
      trackTask(controller, task, conversationId);
      return { ...receipt };
    },
    async send(command) {
      requireOpen();
      if (!command || typeof command.conversationId !== 'string' || !uuid.test(command.conversationId) ||
          typeof command.clientCommandId !== 'string' || !uuid.test(command.clientCommandId) ||
          typeof command.text !== 'string' || !command.text.trim() || Buffer.byteLength(command.text, 'utf8') > 1024 * 1024) throw new ThinkServiceError('invalid_request');
      const { conversationId, clientCommandId, text } = command;
      requireTarget(conversationId);
      const digest = createHash('sha256').update(text, 'utf8').digest('hex');
      if (preparingReplies.has(clientCommandId) || deletion.preparing(clientCommandId)) throw new ThinkServiceError('command_conflict');
      const previous = previousCommand(clientCommandId);
      if (previous) {
        if (previous.kind !== 'send' || previous.conversationId !== conversationId || sendDigests.get(clientCommandId) !== digest) throw new ThinkServiceError('command_conflict');
        return previous.failure ? { ...previous, failure: { ...previous.failure } } : { ...previous };
      }
      requireAvailable();
      await ensureConversation(conversationId);
      const raced = previousCommand(clientCommandId);
      if (raced) {
        if (raced.kind !== 'send' || raced.conversationId !== conversationId || sendDigests.get(clientCommandId) !== digest) throw new ThinkServiceError('command_conflict');
        return raced.failure ? { ...raced, failure: { ...raced.failure } } : { ...raced };
      }
      requireAvailable();
      const conversation = conversations.get(conversationId);
      if (!conversation) throw new ThinkServiceError('not_found');
      if (sendEligibility(conversationId, conversation) !== 'available') throw new ThinkServiceError('command_conflict');
      const runId = randomUUID();
      const receipt: SendReceipt = { kind: 'send', conversationId, clientCommandId, runId, epoch, state: 'registered' };
      const registeredAt = clock.now();
      stateOperation(() => options.state?.registerCommand(receipt, Buffer.from(text, 'utf8'), digest, registeredAt));
      registeredTimes.set(clientCommandId, registeredAt);
      commands.set(clientCommandId, receipt);
      runs.set(runId, { conversationId, sendCommandId: clientCommandId, nativeMessageId: `msg_memoryloop_${clientCommandId.replaceAll('-', '')}` });
      activeRuns.set(conversationId, runId);
      lifecycle(receipt);
      originalCapture(receipt, 'pending');
      sendDigests.set(clientCommandId, digest);
      serverLogger.log('think_send_registered');
      const controller = new AbortController();
      const task = Promise.resolve().then(() => dispatchSend(receipt, text, controller)).finally(() => { tasks.delete(controller); });
      trackTask(controller, task, conversationId);
      return { ...receipt };
    },
    async stop(command) {
      requireOpen();
      if (!command || typeof command.conversationId !== 'string' || !uuid.test(command.conversationId) ||
          typeof command.clientCommandId !== 'string' || !uuid.test(command.clientCommandId) ||
          typeof command.runId !== 'string' || !uuid.test(command.runId)) throw new ThinkServiceError('invalid_request');
      const { conversationId, clientCommandId, runId } = command;
      requireTarget(conversationId);
      if (preparingReplies.has(clientCommandId) || deletion.preparing(clientCommandId)) throw new ThinkServiceError('command_conflict');
      const previous = previousCommand(clientCommandId);
      if (previous) {
        if (previous.kind !== 'stop' || previous.conversationId !== conversationId || previous.runId !== runId) throw new ThinkServiceError('command_conflict');
        return { ...previous };
      }
      requireAvailable('stop');
      await ensureConversation(conversationId);
      const raced = previousCommand(clientCommandId);
      if (raced) {
        if (raced.kind !== 'stop' || raced.conversationId !== conversationId || raced.runId !== runId) throw new ThinkServiceError('command_conflict');
        return { ...raced };
      }
      requireAvailable('stop');
      if (ownershipInvalid.has(conversationId)) throw new ThinkServiceError('think_unavailable');
      const run = runs.get(runId);
      if (!run || run.conversationId !== conversationId) throw new ThinkServiceError('not_found');
      if (activeRuns.get(conversationId) !== runId) throw new ThinkServiceError('command_conflict');
      const receipt: StopReceipt = { kind: 'stop', conversationId, clientCommandId, runId, epoch, state: 'registered' };
      const registeredAt = clock.now();
      stateOperation(() => options.state?.registerCommand(receipt, null, null, registeredAt));
      registeredTimes.set(clientCommandId, registeredAt);
      commands.set(clientCommandId, receipt);
      lifecycle(receipt);
      stoppedRuns.add(runId);
      serverLogger.log('think_stop_registered');
      const controller = new AbortController();
      const task = Promise.resolve().then(() => dispatchStop(receipt, run.sendCommandId, controller)).finally(() => { tasks.delete(controller); });
      trackTask(controller, task, conversationId);
      return { ...receipt };
    },
    async decisions(conversationId) {
      requireAvailable();
      await ensureConversation(conversationId);
      const sessionID = ownedSession(conversationId);
      const forms = await ownedRead(conversationId, 'form-list', signal => native.listForms({ sessionID }, signal));
      const decisions = forms.map(form => projectForm(form, conversationId, sessionID));
      if (Buffer.byteLength(JSON.stringify({ decisions })) > 48 * 1024) throw new ThinkServiceError('decision_unavailable');
      return decisions;
    },
    async decision(conversationId, decisionId) {
      requireAvailable();
      await ensureConversation(conversationId);
      const sessionID = ownedSession(conversationId);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(decisionId)) throw new ThinkServiceError('invalid_request');
      const form = await ownedRead(conversationId, 'form-get', signal => native.getForm({ sessionID, formID: decisionId }, signal));
      if (form.id !== decisionId || form.sessionID !== sessionID || form.state.status !== 'pending') return null;
      return projectForm(form, conversationId, sessionID);
    },
    async reply(command) {
      requireOpen();
      if (!command || typeof command.conversationId !== 'string' || !uuid.test(command.conversationId) ||
          typeof command.clientCommandId !== 'string' || !uuid.test(command.clientCommandId) ||
          typeof command.decisionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(command.decisionId) ||
          !command.answer || typeof command.answer !== 'object' || Array.isArray(command.answer)) throw new ThinkServiceError('invalid_request');
      const { conversationId, clientCommandId, decisionId } = command;
      requireTarget(conversationId);
      if (deletion.preparing(clientCommandId)) throw new ThinkServiceError('command_conflict');
      const entries = Object.entries(command.answer).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      if (entries.some(([key, value]) => !key || key.length > 512 || !(typeof value === 'string' || typeof value === 'boolean' ||
          typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(item => typeof item === 'string')))) throw new ThinkServiceError('invalid_request');
      const answer = Object.fromEntries(entries.map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
      const payload = JSON.stringify({ conversationId, decisionId, answer });
      if (Buffer.byteLength(payload) > 32768) throw new ThinkServiceError('invalid_request');
      const digest = createHash('sha256').update(payload, 'utf8').digest('hex');
      const previous = previousCommand(clientCommandId);
      if (previous) {
        if (previous.kind !== 'form-reply' || replyPayloads.get(clientCommandId) !== digest) throw new ThinkServiceError('command_conflict');
        return previous.failure ? { ...previous, failure: { ...previous.failure } } : { ...previous };
      }
      const preparing = preparingReplies.get(clientCommandId);
      if (preparing) {
        if (preparing.payload !== payload) throw new ThinkServiceError('command_conflict');
        return { ...await preparing.result };
      }
      requireAvailable();
      await ensureConversation(conversationId);
      const raced = previousCommand(clientCommandId);
      if (raced) {
        if (raced.kind !== 'form-reply' || replyPayloads.get(clientCommandId) !== digest) throw new ThinkServiceError('command_conflict');
        return raced.failure ? { ...raced, failure: { ...raced.failure } } : { ...raced };
      }
      const racedPreparation = preparingReplies.get(clientCommandId);
      if (racedPreparation) {
        if (racedPreparation.payload !== payload) throw new ThinkServiceError('command_conflict');
        return { ...await racedPreparation.result };
      }
      const sessionID = ownedSession(conversationId);
      const lock = `${conversationId}:${decisionId}`;
      if (formLocks.has(lock)) throw new ThinkServiceError('command_conflict');
      formLocks.add(lock);
      const result = (async (): Promise<FormReplyReceipt> => {
        try {
          const form = await ownedRead(conversationId, 'form-get', signal => native.getForm({ sessionID, formID: decisionId }, signal));
          if (form.id !== decisionId || form.sessionID !== sessionID || form.state.status !== 'pending') throw new ThinkServiceError('command_conflict');
          projectForm(form, conversationId, sessionID);
          requireAvailable();
          const receipt: FormReplyReceipt = { kind: 'form-reply', conversationId, clientCommandId, decisionId, epoch, state: 'registered' };
          const registeredAt = clock.now();
          stateOperation(() => options.state?.registerCommand(receipt, Buffer.from(JSON.stringify(answer), 'utf8'), digest, registeredAt));
          registeredTimes.set(clientCommandId, registeredAt);
          commands.set(clientCommandId, receipt);
          lifecycle(receipt);
          originalCapture(receipt, 'pending');
          replyPayloads.set(clientCommandId, digest);
          const controller = new AbortController();
          const task = Promise.resolve().then(async () => {
            let state: FormReplyReceipt['state'] = 'upstream-unconfirmed';
            let resourceFailed = false;
            try {
              try {
                const body = await bodies.replace({ conversationId, owner: { kind: 'form-reply', clientCommandId, decisionId } }, bodyBytes(JSON.stringify(answer)), 'canonical');
                if (controller.signal.aborted || closed || deleting.has(conversationId)) return;
                putEntry(conversationId, { kind: 'form-reply', clientCommandId, decisionId, body, sourceTime: registeredTimes.get(clientCommandId) });
                originalCapture(receipt, 'captured');
              } catch { originalCapture(receipt, 'failed'); resourceFailed = true; state = 'rejected'; return; }
              if (!await verifyIdentity(controller) || !await verifyRestoredOwner(conversationId, controller)) throw new Error('Identity unavailable');
              const current = await nativeCall(controller, 'form-get', signal => native.getForm({ sessionID, formID: decisionId }, signal));
              if (current.id !== decisionId || current.sessionID !== sessionID || current.state.status !== 'pending') state = 'stale';
              else {
                if (!markAttempted(clientCommandId)) { state = 'upstream-unconfirmed'; return; }
                await nativeCall(controller, 'form-reply', signal => native.replyForm({ sessionID, formID: decisionId, answer }, signal)); state = 'replied';
              }
            } catch { /* A lost reply response is not proof of failure or acceptance. */ }
            finally {
              if (!closed && !deleting.has(conversationId)) {
                const next: FormReplyReceipt = resourceFailed ? { ...receipt, state, failure: { code: 'resource_failure' } } : { ...receipt, state };
                persistOutcome(next);
                commands.set(clientCommandId, next); lifecycle(next);
              }
              formLocks.delete(lock);
              tasks.delete(controller);
            }
          });
          trackTask(controller, task, conversationId);
          serverLogger.log('think_form_reply_registered');
          return { ...receipt };
        } catch (error) { formLocks.delete(lock); throw error; }
      })();
      preparingReplies.set(clientCommandId, { payload, result });
      try { return await result; } finally { preparingReplies.delete(clientCommandId); }
    },
    async conversation(conversationId) {
      requireTarget(conversationId);
      if (typeof conversationId !== 'string' || !uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
      await ensureConversation(conversationId);
      requireTarget(conversationId);
      const state = conversations.get(conversationId);
      return state ? { ...state } : null;
    },
    async snapshot(conversationId, cursor) {
      requireTarget(conversationId);
      if (typeof conversationId !== 'string' || !uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
      await ensureConversation(conversationId);
      requireTarget(conversationId);
      if (ownershipInvalid.has(conversationId)) throw new ThinkServiceError('think_unavailable');
      const state = conversations.get(conversationId);
      if (!state) return null;
      const page = projectionPage(conversationId, cursor);
      return { ...state, entries: page.entries, contentHealth: page.contentHealth, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
    },
    contentChunk(input) {
      requireOpen();
      return trackTransfer((async () => {
        if (!input || !uuid.test(input.conversationId) || !uuid.test(input.contentId) || !uuid.test(input.generation) ||
            !Number.isSafeInteger(input.through) || input.through < 0 || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > input.through ||
            (input.transfer !== undefined && !uuid.test(input.transfer)) || (input.transfer === undefined && input.offset !== 0)) throw new ThinkServiceError('invalid_request');
        requireTarget(input.conversationId);
        if (ownershipInvalid.has(input.conversationId)) throw new ThinkServiceError('content_unavailable');
        expireTransfers();
        const key = transferKey(input.conversationId, input.contentId, input.generation, input.through);
        let nonce = input.transfer;
        let transfer = nonce ? transfers.get(nonce) : undefined;
        if (nonce) {
          if (!transfer || transferKey(transfer.ref.key.conversationId, transfer.ref.contentId, transfer.ref.generation, transfer.ref.through) !== key || transfer.busy ||
              (input.offset !== transfer.next && input.offset !== transfer.last)) throw new ThinkServiceError('content_unavailable');
        } else {
          const ref = publishedRefs.get(key);
          if (!ref || transfers.size + openingTransfers >= 64) throw new ThinkServiceError('content_unavailable');
          openingTransfers++;
          try {
            const reader = await openPublishedBody(ref);
            if (closed || deleting.has(input.conversationId)) { await reader.close(); throw new ThinkServiceError('content_unavailable'); }
            nonce = randomUUID();
            transfer = { ref, reader, expires: clock.now() + transferIdleMs, next: 0, busy: false };
            transfers.set(nonce, transfer);
          } catch { throw new ThinkServiceError('content_unavailable'); }
          finally { openingTransfers--; }
        }
        if (!transfer || !nonce) throw new ThinkServiceError('content_unavailable');
        transfer.busy = true;
        try {
          const bytes = await transfer.reader.read(input.offset, Math.min(65536, input.through - input.offset));
          if (bytes.length > Math.min(65536, input.through - input.offset) || (input.offset < input.through && !bytes.length)) throw new Error('invalid body read');
          if (closed || deleting.has(input.conversationId) || ownershipInvalid.has(input.conversationId)) throw new Error('service closed or ownership unavailable');
          const nextOffset = input.offset + bytes.length;
          if (input.offset === transfer.next) { transfer.last = input.offset; transfer.next = nextOffset; }
          transfer.expires = clock.now() + transferIdleMs;
          return { conversationId: input.conversationId, epoch, contentId: input.contentId, generation: input.generation, through: input.through, offset: input.offset, bytes: Buffer.from(bytes).toString('base64'), nextOffset, transfer: nonce };
        } catch {
          transfers.delete(nonce);
          await transfer.reader.close().catch(() => {});
          throw new ThinkServiceError('content_unavailable');
        } finally { transfer.busy = false; }
      })(), input?.conversationId);
    },
    async watch(conversationId) {
      requireTarget(conversationId);
      if (typeof conversationId !== 'string' || !uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
      await ensureConversation(conversationId);
      requireOpen();
      if (!conversations.has(conversationId)) return null;
      let pending: ConversationState | undefined;
      let waiter: ((state: ConversationState | null) => void) | undefined;
      let stopped = false;
      const listeners = watchers.get(conversationId) ?? new Set<(state: ConversationState | null) => void>();
      watchers.set(conversationId, listeners);
      const close = () => {
        if (stopped) return;
        stopped = true;
        listeners.delete(notify);
        if (!listeners.size) watchers.delete(conversationId);
        waiter?.(null);
        waiter = undefined;
      };
      const notify = (state: ConversationState | null) => {
        if (!state) { close(); return; }
        if (waiter) { const resolve = waiter; waiter = undefined; resolve(state); }
        else if (pending) close();
        else pending = state;
      };
      listeners.add(notify);
      try {
        const snapshot = await service.snapshot(conversationId);
        if (!snapshot) { close(); return null; }
        if (pending && pending.revision <= snapshot.revision) pending = undefined;
        return { snapshot, close, next: () => {
          if (stopped) return Promise.resolve(null);
          if (pending) { const next = pending; pending = undefined; return Promise.resolve(next); }
          return new Promise(resolve => { waiter = resolve; });
        } };
      } catch (error) { close(); throw error; }
    },
    async command(conversationId, clientCommandId) {
      requireOpen();
      if (typeof conversationId !== 'string' || !uuid.test(conversationId) ||
          typeof clientCommandId !== 'string' || !uuid.test(clientCommandId)) throw new ThinkServiceError('invalid_request');
      const receipt = previousCommand(clientCommandId);
      if (receipt?.kind === 'delete') return registryConversations.command(conversationId, clientCommandId);
      requireTarget(conversationId);
      if (receipt?.conversationId === conversationId && receipt.kind === 'resume' &&
          (receipt.state === 'registered' || receipt.state === 'upstream-unconfirmed')) return service.resume({ conversationId, clientCommandId });
      return receipt?.conversationId === conversationId ? copyReceipt(receipt) : null;
    },
    async close() {
      if (!closing) {
        closed = true;
        const registryClose = registryConversations.close();
        for (const listeners of watchers.values()) for (const notify of listeners) notify(null);
        clearInterval(refreshTimer);
        serverLogger.log('think_service_closed');
        const pending = [...tasks.entries()];
        const ownedMonitor = monitor;
        ownedMonitor?.controller.abort();
        for (const [controller] of pending) controller.abort();
        closing = (async () => {
          try {
            const settled = await Promise.allSettled([...pending.map(([, task]) => task), ...(ownedMonitor ? [ownedMonitor.task] : []), registryClose]);
            const failed = settled.find(result => result.status === 'rejected');
            if (failed?.status === 'rejected') throw failed.reason;
          } finally {
            try {
              await Promise.allSettled([...transferWork]);
              await Promise.all([...transfers.values()].map(transfer => transfer.reader.close()));
              transfers.clear();
            } finally {
              // Native/public producers are fenced and settled; the private transcript
              // reader can still drain every already-published fact before its sources close.
              try { await transcripts.close(); } finally { try { await bodies.close(); } finally { options.state?.close(); } }
            }
          }
        })();
      }
      await closing;
    },
  };
  // Already-published projections and resident immutable bodies outlive public/native
  // admission during close. This reader never hydrates a chat; closed-body fallback
  // cannot start native history reads, and deletion/ownership fences still apply.
  const transcripts = createTranscriptWriter(directory, {
    async page(conversationId, cursor) { return projectionPage(conversationId, cursor, projectionRevisions.get(conversationId) ?? 0); },
    open: openPublishedBody,
  }, () => {
    const count = transcripts.warningCount();
    for (const [conversationId, state] of conversations) {
      const transcript = transcripts.health(conversationId);
      const otherTranscriptWarnings = count - (transcript.warning ? 1 : 0);
      if (!state.transcript && transcript.state === 'not-started' && !otherTranscriptWarnings) continue;
      if (JSON.stringify(state.transcript) !== JSON.stringify(transcript) || (state.otherTranscriptWarnings ?? 0) !== otherTranscriptWarnings) {
        setConversation(conversationId, { ...state, transcript, otherTranscriptWarnings, revision: state.revision + 1 });
      }
    }
  }, { ...options.transcript, ...(options.state?.transcripts ? { state: options.state.transcripts } : {}) });
  return service;
}

export type { CommandReceipt, ConversationState, CreateConversationCommand, CreateReceipt, SendCommand, SendReceipt, StopCommand, StopReceipt, ThinkUnavailableCode } from './contract';
