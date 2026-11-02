import { createThinkClient, ThinkClientError } from './client';
import type { ThinkManifestEntry, ThinkSnapshot } from './client';
import type { BodyRef } from '../../backend/think/body-store';
import type { CommandReceipt, SendReceipt, StopReceipt, FormReplyReceipt, FormReplyCommand } from '../../backend/think/contract';
import { finalReceipt, mergeReceipt, rejectedPost } from './receipts';
import type { ThinkActivity, ThinkAdmission, ThinkDraft, ThinkHandoffRequest, ThinkHandoffState, ThinkIdentity, ThinkKnownIdentity, ThinkMessage, ThinkMessageFocus, ThinkPresentation, ThinkPresentationActions, ThinkPresentationState, ThinkQuestion, ThinkRejectedSubmission, ThinkTextContent } from './types';
import { createConversationClient } from './conversation-client';
import { createThinkView, type ThinkViewState } from './view';
import { secureUuid, sha256Hex } from '../browser-crypto';

type Client = ReturnType<typeof createThinkClient>;
export interface ThinkSessionClock {
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}
export interface ThinkSessionOptions {
  client?: Client;
  clock?: ThinkSessionClock;
  randomUUID?: () => string;
  /** This is the single current-chat pointer, not a draft or chat list. */
  pointer?: { read(): string | null; write(conversationId: string): void };
  navigate(href: string, options: { replace: true; focus?: 'preserve' }): void;
  navigationGeneration?(): number | undefined;
  conversations?: ReturnType<typeof createConversationClient>;
  view?: ReturnType<typeof createThinkView>;
}
export interface ThinkSessionState {
  readonly identity: ThinkIdentity | null;
  readonly draft: ThinkDraft;
  readonly connection: 'inactive' | 'opening' | 'following' | 'reconnecting' | 'denied' | 'unavailable' | 'service-changed';
  readonly snapshot: ThinkSnapshot | null;
  readonly entries: readonly ThinkManifestEntry[];
  readonly history: 'loading' | 'complete' | 'unavailable';
  readonly newChat: 'idle' | 'confirm-discard' | 'starting' | 'unavailable';
  readonly handoff: ThinkHandoffState | null;
  readonly messageFocus?: ThinkMessageFocus;
  readonly view: ThinkViewState;
}
export interface ThinkSession {
  getSnapshot(): ThinkSessionState;
  getPresentation(): ThinkPresentation;
  subscribe(listener: () => void): () => void;
  setLocation(location: { pathname: string; search: string; hash?: string; key?: string; isNavigating?: boolean }): void;
  requestHandoff(request: ThinkHandoffRequest): void;
  confirmHandoff(): void;
  cancelHandoff(): void;
  checkHandoff(): void;
  editDraft(text: string): void;
  requestNewChat(): void;
  cancelNewChat(): void;
  confirmNewChat(): void;
  checkConnection(): void;
  refreshView(): void;
  prepareDeletion(conversationId: string): Promise<{ viewToken: string; valid(): boolean; invalidate(): void } | null>;
  close(): void;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const emptyDraft: ThinkDraft = { text: '', version: 0 };
const defaultClock: ThinkSessionClock = { setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds), clearTimeout: timer => clearTimeout(timer) };

/** Owns only the current identity, volatile drafts, and read-side observation. */
export function createThinkSession(options: ThinkSessionOptions): ThinkSession {
  const client = options.client ?? createThinkClient();
  const clock = options.clock ?? defaultClock;
  const conversations = options.conversations ?? createConversationClient();
  const view = options.view ?? createThinkView(conversations, clock);
  const randomUUID = options.randomUUID ?? secureUuid;
  const drafts = new Map<string, ThinkDraft>();
  const listeners = new Set<() => void>();
  let state: ThinkSessionState = { identity: null, draft: emptyDraft, connection: 'inactive', snapshot: null, entries: [], history: 'loading', newChat: 'idle', handoff: null, view: view.getSnapshot() };
  let active = false;
  let generation = 0;
  let closed = false;
  let refreshRunning = false;
  let refreshRequested = false;
  let watchClose: (() => void) | undefined;
  let watchHealthy = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 250;
  let readController: AbortController | undefined;
  let initialReadRecovery: { attempts: number; timer?: ReturnType<typeof setTimeout> } | undefined;
  let pendingCreate: { conversationId: string; clientCommandId: string } | undefined;
  let selectionAfterCreate: string | undefined;
  let navigationVersion = 0;
  let locationSignature = '';
  let initialEntry: { url: string; navigationGeneration: number | undefined } | undefined;
  let locationPath = '';
  let navigationPending = false;
  let viewStarted = false;
  type PrefillHandoff = {
    request: ThinkHandoffRequest;
    originId: string | null;
    originDraftVersion: number;
    navigationVersion: number;
    shellNavigationGeneration?: number;
    target?: { conversationId: string; clientCommandId: string; draftVersion: number; dispatched: boolean; snapshot?: ThinkSnapshot };
    checking: boolean;
    pollDelay: number;
  };
  let handoff: PrefillHandoff | undefined;
  let handoffTimer: ReturnType<typeof setTimeout> | undefined;
  let handoffFocusAwaitingVisit = false;
  let focusNavigationGeneration: number | undefined;
  type Command<R extends CommandReceipt> = { identity: ThinkKnownIdentity; commandId: string; receipt?: R; delivery: 'posting' | 'unknown' | 'known' | 'rejected' };
  type OwnedSend = Command<SendReceipt> & { kind: 'send'; text: string; draftVersion: number; stop?: OwnedStop };
  type OwnedStop = Command<StopReceipt> & { kind: 'stop'; runId: string };
  type OwnedReply = Command<FormReplyReceipt> & { kind: 'form-reply'; decisionId: string; request: string; answer: FormReplyCommand['answer'] };
  type OwnedCommand = OwnedSend | OwnedStop | OwnedReply;
  const sends = new Map<string, OwnedSend>();
  const commands = new Map<string, OwnedCommand>();
  const receipts = new Map<string, CommandReceipt>();
  const replies = new Map<string, OwnedReply>();
  const identityKey = (identity: ThinkKnownIdentity) => JSON.stringify([identity.conversationId, identity.epoch]);
  const commandKey = (identity: ThinkKnownIdentity, commandId: string) => JSON.stringify([identity.conversationId, identity.epoch, commandId]);
  const questionKey = (identity: ThinkKnownIdentity, decisionId: string) => JSON.stringify([identity.conversationId, identity.epoch, decisionId]);
  const questionRequest = (question: ThinkQuestion) => JSON.stringify([question.detail.title, question.detail.fields]);
  type CommandRead = { id: string; version: number; controller: AbortController; requested: boolean };
  let commandRead: CommandRead | undefined;
  let commandTimer: ReturnType<typeof setTimeout> | undefined;
  let commandDelay = 500;
  let commandManifest = '';
  const rejected = new Map<string, ThinkRejectedSubmission[]>();
  const bodies = new Map<string, ThinkTextContent>();
  const bodyOwners = new Map<string, string>();
  const bodyQueue: Array<{ ref: BodyRef; id: string; version: number }> = [];
  const queuedBodies = new Set<string>();
  type BodyProgress = { decoder: TextDecoder; chunks: Uint8Array[]; text: string; offset: number; transfer?: string };
  const bodyProgress = new Map<string, BodyProgress>();
  const bodyControllers = new Map<string, AbortController>();
  let bodyWorkers = 0;
  const questions = new Map<string, ThinkQuestion[]>();
  const questionReads = new Map<string, AbortController>();
  const questionEpochs = new Map<string, string>();
  let presentation: ThinkPresentation;

  function ownedIdentity(identity: ThinkKnownIdentity): boolean {
    return active && state.connection !== 'service-changed' && state.connection !== 'denied' && state.identity?.conversationId === identity.conversationId && state.identity.epoch === identity.epoch;
  }
  function mutationLease(id: string): boolean {
    if (view.canMutate(id)) return true;
    view.refresh();
    return false; // Reauthorization never queues or replays the user's mutation.
  }
  const keyOf = (ref: BodyRef) => JSON.stringify(ref);
  const checkingSend = (send: OwnedSend | undefined) => !!send && !send.receipt && (send.delivery === 'posting' || send.delivery === 'unknown');
  const rejectedSend = (send: OwnedSend) => send.delivery === 'rejected' || send.receipt?.state === 'rejected';
  function validRun(send: OwnedSend | undefined): send is OwnedSend & { receipt: SendReceipt } {
    return !!send?.receipt && !finalReceipt(send.receipt);
  }
  function stopState(stop: OwnedStop | undefined): 'available' | 'requesting' | 'retry' {
    if (!stop) return 'available';
    if (stop.delivery === 'rejected' || stop.receipt?.state === 'upstream-unconfirmed') return 'retry';
    return 'requesting';
  }
  function admission(send: OwnedSend): ThinkAdmission {
    const receipt = send.receipt;
    if (!receipt || receipt.state === 'upstream-unconfirmed' || receipt.state === 'monitor-unavailable') return { state: 'checking', clientCommandId: send.commandId, ...(receipt ? { runId: receipt.runId } : {}) };
    if (receipt.state === 'registered' || receipt.state === 'admitted') return { state: receipt.state, clientCommandId: send.commandId, runId: receipt.runId };
    return { state: receipt.state, clientCommandId: send.commandId, runId: receipt.runId, ...(receipt.failure ? { failure: receipt.failure } : {}) };
  }
  function project(): ThinkPresentationState {
    const identity = state.identity;
    const send = identity ? sends.get(identity.conversationId) : undefined;
    const currentSend = send && identity?.epoch === send.identity.epoch ? send : undefined;
    const run = currentSend?.receipt;
    const grouped = new Map<string, ThinkMessage>();
    const backgroundActivity: ThinkActivity[] = [];
    const messageActivity = new Map<string, ThinkActivity[]>();
    for (const entry of state.entries) {
      if (entry.kind === 'original' || entry.kind === 'assistant-text') {
        const role = entry.kind === 'original' ? 'user' : 'assistant';
        const ordinal = entry.kind === 'original' ? 0 : entry.ordinal;
        const content = bodies.get(keyOf(entry.body)) ?? { state: 'unloaded' as const, ref: entry.body };
        const part = { messageId: entry.messageId, ordinal, content, closure: entry.kind === 'original' ? 'closed' as const : entry.closure, capture: entry.kind === 'original' ? 'complete' as const : entry.capture };
        const previous = grouped.get(entry.messageId);
        if (previous) grouped.set(entry.messageId, { ...previous, parts: [...previous.parts, part].sort((a, b) => a.ordinal - b.ordinal) });
        else if (role === 'assistant') grouped.set(entry.messageId, { role, messageId: entry.messageId, displayOrder: entry.displayOrder, parts: [part], activity: [] });
        else grouped.set(entry.messageId, { role, messageId: entry.messageId, displayOrder: entry.displayOrder, parts: [part], ...(entry.kind === 'original' && currentSend?.commandId === entry.clientCommandId ? { admission: admission(currentSend) } : {}) });
      } else if (entry.kind === 'tool') {
        const activity: ThinkActivity = { kind: 'tool', id: entry.toolCallId, messageId: entry.messageId, category: entry.category, state: entry.state, ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }), ...(entry.sourceTime === undefined ? {} : { sourceTime: entry.sourceTime }) };
        const items = messageActivity.get(entry.messageId) ?? [];
        items.push(activity); messageActivity.set(entry.messageId, items);
      } else if (entry.kind === 'compaction') backgroundActivity.push({ kind: 'compaction', id: entry.eventId, phase: entry.phase, sourceTime: entry.sourceTime });
    }
    for (const [messageId, items] of messageActivity) {
      const message = grouped.get(messageId);
      if (message?.role === 'assistant') grouped.set(messageId, { ...message, activity: items });
      else backgroundActivity.push(...items);
    }
    const unavailable = !identity?.epoch || !view.canMutate(identity.conversationId) || !state.snapshot || state.snapshot.sendEligibility === 'unavailable' || state.connection === 'unavailable' || state.connection === 'denied' || state.connection === 'service-changed' || state.connection === 'inactive';
    const sendUnavailable = unavailable || state.connection === 'reconnecting';
    const composer: ThinkPresentationState['composer'] = validRun(currentSend)
      ? { kind: 'stop', runId: currentSend.receipt.runId, state: unavailable ? 'unavailable' : stopState(currentSend.stop), ...(currentSend.stop?.receipt ? { receiptState: currentSend.stop.receipt.state } : {}) }
      : checkingSend(currentSend) ? { kind: 'checking' }
      : { kind: 'send', eligible: !sendUnavailable && state.snapshot?.sendEligibility === 'available' && !!state.draft.text.trim(),
        ...(state.connection === 'reconnecting' ? { reason: 'resynchronizing' as const } : unavailable ? { reason: 'unavailable' as const } : state.snapshot?.sendEligibility === 'busy' ? { reason: 'busy' as const } : !state.draft.text.trim() ? { reason: 'empty' as const } : state.snapshot?.sendEligibility !== 'available' ? { reason: 'unavailable' as const } : {}) };
    const runState: ThinkPresentationState['run'] = !run ? { state: checkingSend(currentSend) ? 'unknown' : 'none' }
      : run.state === 'completed' || run.state === 'failed' || run.state === 'interrupted' || run.state === 'cancelled-before-delivery' ? { state: run.state, runId: run.runId }
      : run.state === 'rejected' ? { state: 'none' } : { state: 'working', runId: run.runId };
    const transcript = state.snapshot?.transcript;
    return { identity, revision: state.snapshot?.revision ?? null, creation: state.snapshot?.creation ?? (state.connection === 'opening' ? 'opening' : 'unavailable'),
      messages: [...grouped.values()].sort((a, b) => a.displayOrder - b.displayOrder),
      ...(currentSend && currentSend.text && !rejectedSend(currentSend) && !state.entries.some(entry => entry.kind === 'original' && entry.clientCommandId === currentSend.commandId) ? { pendingSubmission: { clientCommandId: currentSend.commandId, text: currentSend.text, admission: admission(currentSend) } } : {}),
      backgroundActivity, draft: state.draft, composer, run: runState,
      monitoring: state.connection === 'inactive' ? 'unavailable' : state.connection, ...(state.snapshot?.contentHealth ? { contentHealth: state.snapshot.contentHealth } : {}),
      ...(state.snapshot?.permissionCompatibility ? { permissionCompatibility: state.snapshot.permissionCompatibility } : {}),
      ...(state.snapshot?.permissionPending === undefined ? {} : { permissionPending: state.snapshot.permissionPending }),
      ...(transcript?.warning || state.snapshot?.otherTranscriptWarnings ? { transcriptWarning: { ...(transcript?.warning ? { current: { ...(transcript.reason ? { reason: transcript.reason } : {}) } } : {}), otherCount: state.snapshot?.otherTranscriptWarnings ?? 0 } } : {}),
      questions: identity ? questions.get(identity.conversationId) ?? [] : [], history: { state: state.history }, newChat: state.newChat,
      rejectedSubmissions: identity?.epoch ? rejected.get(identityKey(identity)) ?? [] : [],
      ...(state.messageFocus ? { messageFocus: state.messageFocus } : {}),
      selectionUnavailable: !!identity && state.view.status === 'unavailable', mutationsAvailable: !unavailable && state.connection !== 'reconnecting' };
  }

  const update = (changes: Partial<ThinkSessionState>) => {
    if (closed) return;
    state = { ...state, ...changes };
    presentation = { state: project(), actions };
    for (const listener of listeners) listener();
  };
  const current = (id: string, version: number) => !closed && active && generation === version && state.identity?.conversationId === id;
  const stopWatch = () => {
    watchClose?.(); watchClose = undefined;
    watchHealthy = false;
    if (retryTimer !== undefined) { clock.clearTimeout(retryTimer); retryTimer = undefined; }
  };
  const stopInitialReadRecovery = () => {
    if (initialReadRecovery?.timer !== undefined) clock.clearTimeout(initialReadRecovery.timer);
    initialReadRecovery = undefined;
  };
  const stopRead = () => { readController?.abort(); readController = undefined; stopInitialReadRecovery(); };
  const stopCommands = () => {
    commandRead?.controller.abort(); commandRead = undefined;
    if (commandTimer !== undefined) { clock.clearTimeout(commandTimer); commandTimer = undefined; }
    commandDelay = 500;
    commandManifest = '';
    for (const controller of questionReads.values()) controller.abort();
    questionReads.clear();
  };
  const stopBodies = () => {
    const markUnloaded = (key: string) => {
      const content = bodies.get(key);
      if (content?.state === 'loading') bodies.set(key, { state: 'unloaded', ref: content.ref });
      else if (content?.state === 'replacing') bodies.set(key, { state: 'error', ref: content.ref, reason: 'unavailable', previousText: content.previousText });
    };
    for (const key of bodyControllers.keys()) markUnloaded(key);
    for (const controller of bodyControllers.values()) controller.abort();
    bodyProgress.clear();
    for (const item of bodyQueue.splice(0)) { const key = keyOf(item.ref); markUnloaded(key); queuedBodies.delete(key); }
  };
  const classify = (error: unknown): ThinkSessionState['connection'] => error instanceof ThinkClientError && (error.status === 401 || error.status === 403) ? 'denied' : 'unavailable';
  const remember = (id: string) => { try { options.pointer?.write(id); } catch { /* The URL remains authoritative. */ } };
  const readPointer = () => { try { return options.pointer?.read() ?? null; } catch { return null; } };

  function pumpBodies(): void {
    while (bodyWorkers < 2 && bodyQueue.length) {
      const item = bodyQueue.shift();
      if (!item) break;
      const key = keyOf(item.ref);
      if (!current(item.id, item.version)) { queuedBodies.delete(key); continue; }
      bodyWorkers++;
      const controller = new AbortController();
      bodyControllers.set(key, controller);
      void (async () => {
        let progress = bodyProgress.get(key);
        if (!progress) {
          progress = { decoder: new TextDecoder('utf-8', { fatal: true }), chunks: [], text: '', offset: 0 };
          bodyProgress.set(key, progress);
        }
        try {
          do {
            const chunk = await client.chunk(item.ref, progress.offset, progress.transfer, controller.signal);
            if (!current(item.id, item.version) || controller.signal.aborted || bodyProgress.get(key) !== progress) return;
            const binary = atob(chunk.bytes);
            const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
            if (chunk.conversationId !== item.id || chunk.epoch !== item.ref.epoch || chunk.contentId !== item.ref.contentId || chunk.generation !== item.ref.generation ||
                chunk.through !== item.ref.through || chunk.offset !== progress.offset || (progress.transfer !== undefined && chunk.transfer !== progress.transfer) ||
                btoa(binary) !== chunk.bytes || bytes.length > 65536 || chunk.nextOffset !== progress.offset + bytes.length || chunk.nextOffset > item.ref.through ||
                (progress.offset < item.ref.through && !bytes.length)) throw new Error('invalid content chunk');
            progress.transfer = chunk.transfer;
            if (item.ref.kind === 'canonical') progress.chunks.push(bytes);
            progress.text += progress.decoder.decode(bytes, { stream: true });
            progress.offset = chunk.nextOffset;
          } while (progress.offset < item.ref.through);
          const text = progress.text + progress.decoder.decode();
          if (item.ref.kind === 'canonical') {
            const bytes = new Uint8Array(item.ref.through);
            let index = 0;
            for (const chunk of progress.chunks) { bytes.set(chunk, index); index += chunk.length; }
            if (await sha256Hex(bytes) !== item.ref.sha256) throw new Error('digest mismatch');
          }
          if (!current(item.id, item.version) || controller.signal.aborted || bodyProgress.get(key) !== progress || !state.entries.some(entry => 'body' in entry && keyOf(entry.body) === key)) return;
          bodyProgress.delete(key);
          bodies.set(key, { state: 'ready', ref: item.ref, text });
          update({});
        } catch (error) {
          // Only an uncertain GET failure is resumable. Expired transfers and
          // malformed content require a fresh, fully validated immutable read.
          if (!(error instanceof ThinkClientError && error.kind === 'transport') && bodyProgress.get(key) === progress) bodyProgress.delete(key);
          if (current(item.id, item.version) && !controller.signal.aborted && state.entries.some(entry => 'body' in entry && keyOf(entry.body) === key)) {
            const previous = bodies.get(key);
            const previousText = previous?.state === 'ready' ? previous.text : previous && 'previousText' in previous ? previous.previousText : undefined;
            bodies.set(key, { state: 'error', ref: item.ref, reason: 'unavailable', ...(previousText === undefined ? {} : { previousText }) });
            update({});
          }
        } finally {
          if (bodyControllers.get(key) === controller) bodyControllers.delete(key);
          queuedBodies.delete(key); bodyWorkers--; pumpBodies();
          if (controller.signal.aborted && active && state.identity?.conversationId === item.id && state.identity.epoch === item.ref.epoch &&
              bodies.get(key)?.state === 'unloaded' && state.entries.some(entry => 'body' in entry && keyOf(entry.body) === key)) loadBody(item.ref, item.id, generation);
        }
      })();
    }
  }
  function loadBody(ref: BodyRef, id: string, version: number): void {
    const key = keyOf(ref);
    if (queuedBodies.has(key)) return;
    const owner = JSON.stringify([ref.epoch, ref.key]);
    const oldKey = bodyOwners.get(owner);
    const previous = bodies.get(key) ?? (oldKey ? bodies.get(oldKey) : undefined);
    const previousText = previous?.state === 'ready' ? previous.text : previous && 'previousText' in previous ? previous.previousText : undefined;
    if (oldKey && oldKey !== key) { bodies.delete(oldKey); bodyProgress.delete(oldKey); bodyControllers.get(oldKey)?.abort(); }
    bodyOwners.set(owner, key);
    bodies.set(key, previousText === undefined ? { state: 'loading', ref } : { state: 'replacing', ref, previousText });
    for (let index = bodyQueue.length - 1; index >= 0; index--) {
      const queued = bodyQueue[index];
      if (JSON.stringify([queued.ref.epoch, queued.ref.key]) === owner) { queuedBodies.delete(keyOf(queued.ref)); bodyQueue.splice(index, 1); }
    }
    if (bodyQueue.length >= 24) {
      const dropped = bodyQueue.shift();
      if (dropped) {
        const droppedKey = keyOf(dropped.ref);
        queuedBodies.delete(droppedKey);
        const old = bodies.get(droppedKey);
        const saved = old?.state === 'ready' ? old.text : old && 'previousText' in old ? old.previousText : undefined;
        bodies.set(droppedKey, saved === undefined ? { state: 'unloaded', ref: dropped.ref } : { state: 'error', ref: dropped.ref, reason: 'unavailable', previousText: saved });
      }
    }
    queuedBodies.add(key); bodyQueue.push({ ref, id, version }); pumpBodies();
  }
  function refreshQuestions(id: string, version: number): void {
    const epoch = state.identity?.epoch;
    if (!epoch) return;
    const identity = { conversationId: id, epoch };
    const key = JSON.stringify([id, epoch, version, 'list']);
    if (questionReads.has(key)) return;
    const controller = new AbortController();
    questionReads.set(key, controller);
    void Promise.resolve().then(() => client.decisions(id, controller.signal)).then(items => {
      if (!scoped(identity, version) || controller.signal.aborted) return;
      const existing = questions.get(id) ?? [];
      const next = items.map(item => {
        const prior = existing.find(question => question.decisionId === item.decisionId);
        const question: ThinkQuestion = { decisionId: item.decisionId, detail: { state: 'ready', title: item.title, fields: item.fields }, answer: prior?.answer ?? {}, reply: prior?.reply ?? 'idle' };
        const reply = replies.get(questionKey(identity, item.decisionId));
        return withReply(!prior && reply && reply.request === questionRequest(question) ? { ...question, answer: reply.answer } : question, identity);
      });
      for (const prior of existing) {
        const reply = replies.get(questionKey(identity, prior.decisionId));
        if (!next.some(item => item.decisionId === prior.decisionId) && reply && commandPending(reply)) next.push(withReply(prior, identity));
      }
      questions.set(id, next);
      update({});
    }).catch(() => {}).finally(() => { if (questionReads.get(key) === controller) questionReads.delete(key); });
  }

  function scoped(identity: ThinkKnownIdentity, version: number): boolean {
    return current(identity.conversationId, version) && ownedIdentity(identity);
  }
  /** Command outcomes belong to retained records, not to the view that initiated their POST. */
  function commandOwned(command: OwnedCommand): boolean {
    if (closed) return false;
    if (commands.get(commandKey(command.identity, command.commandId)) === command) return true;
    if (command.kind === 'send') return sends.get(command.identity.conversationId) === command;
    if (command.kind === 'stop') return sends.get(command.identity.conversationId)?.stop === command;
    return replies.get(questionKey(command.identity, command.decisionId)) === command;
  }
  function replyState(reply: OwnedReply): ThinkQuestion['reply'] {
    return reply.delivery === 'rejected' ? 'rejected' : reply.receipt?.state ?? (reply.delivery === 'unknown' ? 'upstream-unconfirmed' : 'registered');
  }
  function withReply(question: ThinkQuestion, identity: ThinkKnownIdentity): ThinkQuestion {
    const reply = replies.get(questionKey(identity, question.decisionId));
    if (!reply) return question;
    return { ...question, reply: reply.request === questionRequest(question) ? replyState(reply) : 'idle' };
  }
  function publishReply(reply: OwnedReply): void {
    if (!ownedIdentity(reply.identity) || replies.get(questionKey(reply.identity, reply.decisionId)) !== reply) return;
    questions.set(reply.identity.conversationId, (questions.get(reply.identity.conversationId) ?? []).map(question =>
      question.decisionId === reply.decisionId && questionRequest(question) === reply.request ? { ...question, reply: replyState(reply) } : question));
  }
  function applyReceipt(command: OwnedCommand, incoming: CommandReceipt): boolean {
    if (!commandOwned(command) || incoming.epoch !== command.identity.epoch || incoming.conversationId !== command.identity.conversationId ||
        incoming.clientCommandId !== command.commandId || incoming.kind !== command.kind ||
        command.kind === 'stop' && incoming.kind === 'stop' && incoming.runId !== command.runId ||
        command.kind === 'form-reply' && incoming.kind === 'form-reply' && incoming.decisionId !== command.decisionId) return false;
    const key = commandKey(command.identity, command.commandId);
    const receipt = mergeReceipt(receipts.get(key), incoming);
    receipts.set(key, receipt);
    command.delivery = 'known';
    if (finalReceipt(receipt)) commands.delete(key);
    const publish = ownedIdentity(command.identity);
    if (command.kind === 'send' && receipt.kind === 'send') {
      const changed = command.receipt !== receipt;
      command.receipt = receipt;
      if (rejectedSend(command) && command.text) rememberRejected(command, receipt.failure?.code === 'resource_failure' ? 'resource_failure' : 'unknown');
      if (publish && !rejectedSend(command) && sends.get(command.identity.conversationId) === command && state.draft.version === command.draftVersion && state.draft.text === command.text) {
        const draft = { text: '', version: state.draft.version + 1 };
        drafts.set(command.identity.conversationId, draft); update({ draft });
      } else if (publish && changed) update({});
      return changed;
    }
    if (command.kind === 'stop' && receipt.kind === 'stop') {
      const changed = command.receipt !== receipt;
      command.receipt = receipt;
      if (publish && changed) update({});
      return changed;
    }
    if (command.kind === 'form-reply' && receipt.kind === 'form-reply') {
      const changed = command.receipt !== receipt;
      command.receipt = receipt;
      if (publish) { publishReply(command); if (changed) update({}); }
      return changed;
    }
    return false;
  }
  function rememberRejected(send: OwnedSend, reason: ThinkRejectedSubmission['reason']): void {
    const key = identityKey(send.identity);
    const list = rejected.get(key) ?? [];
    if (!list.some(item => item.clientCommandId === send.commandId)) rejected.set(key, [...list, { clientCommandId: send.commandId, text: send.text, reason }]);
  }
  function commandPending(command: OwnedCommand): boolean {
    if (command.delivery === 'rejected' || command.receipt && finalReceipt(command.receipt)) return false;
    if (command.kind === 'stop') {
      const send = sends.get(command.identity.conversationId);
      return validRun(send) && send.receipt.runId === command.runId && send.stop === command;
    }
    if (command.kind === 'form-reply') return replies.get(questionKey(command.identity, command.decisionId)) === command;
    return true;
  }
  function commandAcknowledged(command: OwnedCommand, receipt: CommandReceipt): void {
    if (!commandOwned(command)) return;
    applyReceipt(command, receipt);
    if (!ownedIdentity(command.identity)) return;
    requestRefresh(command.identity.conversationId, generation);
    requestCommands(command.identity.conversationId, generation, true);
  }
  function commandFailure(command: OwnedCommand, error: unknown): void {
    if (!commandOwned(command)) return;
    // A delivered receipt is stronger than a delayed POST error as well as a delayed POST ack.
    if (!command.receipt) {
      command.delivery = rejectedPost(error) ? 'rejected' : 'unknown';
      if (command.delivery === 'rejected') commands.delete(commandKey(command.identity, command.commandId));
      if (command.kind === 'send' && rejectedSend(command)) rememberRejected(command, 'unknown');
    }
    if (!ownedIdentity(command.identity)) return;
    if (command.kind === 'form-reply') publishReply(command);
    if (error instanceof ThinkClientError && (error.status === 401 || error.status === 403)) {
      stopWatch(); stopCommands(); update({ connection: 'denied' });
    } else { update({}); requestCommands(command.identity.conversationId, generation, true); }
  }

  function requestCommands(id: string, version: number, urgent = false): void {
    const epoch = state.identity?.epoch;
    if (!epoch || !scoped({ conversationId: id, epoch }, version)) return;
    if (commandTimer !== undefined) {
      if (!urgent) return;
      clock.clearTimeout(commandTimer); commandTimer = undefined;
    }
    if (commandRead) { if (urgent) commandRead.requested = true; return; }
    const identity = { conversationId: id, epoch };
    const owner: CommandRead = { id, version, controller: new AbortController(), requested: false };
    commandRead = owner;
    let retry = false;
    const valid = () => commandRead === owner && scoped(identity, version) && !owner.controller.signal.aborted;
    void (async () => {
      try {
        do {
          owner.requested = false; retry = false;
          const read = new Set<string>();
          const get = async (commandId: string): Promise<CommandReceipt | undefined> => {
            const key = commandKey(identity, commandId);
            const known = receipts.get(key);
            if (known && (finalReceipt(known) || read.has(commandId))) return known;
            read.add(commandId);
            try {
              const receipt = await client.receipt(id, commandId, owner.controller.signal);
              if (!valid() || receipt.epoch !== epoch || receipt.conversationId !== id || receipt.clientCommandId !== commandId) return undefined;
              const local = commands.get(key);
              if (local) {
                const changed = applyReceipt(local, receipt);
                if (changed && local.kind !== 'stop') requestRefresh(id, version);
                if (receipt.kind !== local.kind) { retry = true; return known; }
                return receipts.get(key);
              }
              const merged = mergeReceipt(known, receipt); receipts.set(key, merged); return merged;
            } catch (error) {
              if (valid()) {
                retry = true;
                if (error instanceof ThinkClientError && (error.status === 401 || error.status === 403)) { stopWatch(); stopCommands(); update({ connection: 'denied' }); }
              }
              return known;
            }
          };
          const manifest = commandManifest;
          const lifecycle = [...state.entries].reverse().filter(entry => entry.kind === 'lifecycle' && entry.runId);
          const seen = new Set<string>();
          for (const entry of lifecycle) {
            if (!valid() || entry.kind !== 'lifecycle' || seen.has(entry.clientCommandId)) continue;
            seen.add(entry.clientCommandId);
            const key = commandKey(identity, entry.clientCommandId);
            let receipt = receipts.get(key);
            if (!receipt || !finalReceipt(receipt) && (receipt.state !== entry.state || commands.has(key))) receipt = await get(entry.clientCommandId);
            if (!valid()) return;
            if (!receipt) { retry = true; break; }
            if (receipt.kind !== 'send') continue;
            if (commandManifest !== manifest || owner.requested) break;
            let send = sends.get(id);
            if (send?.identity.epoch !== epoch) send = undefined;
            const currentCommandId = send?.commandId;
            const listed = lifecycle.some(item => item.kind === 'lifecycle' && item.clientCommandId === currentCommandId);
            // Only unresolved admission reserves a missing local command; rejected text is retained separately.
            if (send && send.commandId !== receipt.clientCommandId && !listed && (commandPending(send) || finalReceipt(receipt))) break;
            if (!send || send.commandId !== receipt.clientCommandId) {
              send = { kind: 'send', identity, commandId: receipt.clientCommandId, delivery: 'known', text: '', draftVersion: -1 };
              commands.set(key, send); sends.set(id, send);
            }
            applyReceipt(send, receipt);
            break;
          }
          for (const command of commands.values()) {
            if (!valid()) return;
            if (command.identity.conversationId === id && command.identity.epoch === epoch && commandPending(command) && !read.has(command.commandId)) await get(command.commandId);
          }
        } while (valid() && owner.requested);
      } finally {
        if (commandRead === owner) {
          commandRead = undefined;
          if (scoped(identity, version) && (retry || [...commands.values()].some(command => command.identity.conversationId === id && command.identity.epoch === epoch && commandPending(command)))) {
            const delay = commandDelay; commandDelay = Math.min(commandDelay * 2, 5000);
            commandTimer = clock.setTimeout(() => { commandTimer = undefined; requestCommands(id, version); }, delay);
          }
        }
      }
    })();
  }

  function connect(id: string, version: number): void {
    if (!current(id, version) || state.connection === 'denied' || state.connection === 'service-changed' || watchClose) return;
    try {
      watchClose = client.watch(id, {
        snapshot(value) {
          if (!current(id, version)) return;
          if (state.identity?.epoch && state.identity.epoch !== value.epoch) { refreshRequested = false; stopWatch(); stopCommands(); update({ connection: 'service-changed' }); return; }
          retryDelay = 250;
          watchHealthy = true;
          requestRefresh(id, version);
        },
        revision(value) {
          if (!current(id, version)) return;
          if (state.identity?.epoch && state.identity.epoch !== value.epoch) { refreshRequested = false; stopWatch(); stopCommands(); update({ connection: 'service-changed' }); return; }
          requestRefresh(id, version);
        },
        heartbeat() {},
        error() {
          if (!current(id, version)) return;
          watchClose = undefined;
          watchHealthy = false;
          update({ connection: 'reconnecting' });
          if (retryTimer !== undefined) return;
          const delay = retryDelay;
          retryDelay = Math.min(retryDelay * 2, 5000);
          retryTimer = clock.setTimeout(() => { retryTimer = undefined; if (current(id, version)) { requestRefresh(id, version); connect(id, version); } }, delay);
        },
      });
    } catch { if (current(id, version)) update({ connection: 'unavailable' }); }
  }

  function retryInitialRead(id: string, version: number, error: unknown): void {
    if (!current(id, version)) return;
    const transient = error instanceof ThinkClientError && (error.kind === 'transport' ||
      error.kind === 'api' && [408, 429, 500, 502, 503, 504].includes(error.status ?? 0));
    if (!transient || state.identity?.epoch) { stopInitialReadRecovery(); return; }
    // Bootstrap has no SSE connection yet. Recover transient hydration/selection
    // races with at most five extra reads, never by replaying a native command.
    const recovery = initialReadRecovery ??= { attempts: 0 };
    if (recovery.timer !== undefined) return;
    if (recovery.attempts >= 5) {
      console.info('think_initial_read_recovery_outcome', { state: 'exhausted', attempts: recovery.attempts });
      return;
    }
    const delay = 250 * 2 ** recovery.attempts++;
    console.info('think_initial_read_retry_scheduled', { attempt: recovery.attempts, delay });
    recovery.timer = clock.setTimeout(() => {
      recovery.timer = undefined;
      if (initialReadRecovery === recovery && current(id, version) && !state.identity?.epoch) requestRefresh(id, version);
    }, delay);
  }

  function requestRefresh(id: string, version: number): void {
    if (!current(id, version)) return;
    refreshRequested = true;
    if (refreshRunning) return;
    refreshRunning = true;
    void (async () => {
      try {
        while (current(id, version) && refreshRequested) {
          refreshRequested = false;
          const controller = new AbortController();
          readController = controller;
          try {
            const first = await client.snapshot(id, undefined, controller.signal);
            if (!current(id, version)) return;
            if (state.identity?.epoch && state.identity.epoch !== first.epoch) { refreshRequested = false; stopWatch(); stopCommands(); update({ connection: 'service-changed' }); return; }
            const entries: ThinkManifestEntry[] = [...first.entries];
            let cursor = first.nextCursor;
            const seen = new Set<string>();
            while (cursor) {
              if (seen.has(cursor)) throw new ThinkClientError('invalid-response');
              seen.add(cursor);
              const page = await client.snapshot(id, cursor, controller.signal);
              if (!current(id, version)) return;
              if (page.epoch !== first.epoch || page.revision !== first.revision) throw new ThinkClientError('invalid-response');
              entries.push(...page.entries);
              cursor = page.nextCursor;
            }
            if (!current(id, version)) return;
            if (initialReadRecovery) console.info('think_initial_read_recovery_outcome', { state: 'ready', attempts: initialReadRecovery.attempts });
            stopInitialReadRecovery();
            if (questionEpochs.get(id) !== first.epoch) { questions.delete(id); questionEpochs.set(id, first.epoch); }
            update({ identity: { conversationId: id, epoch: first.epoch }, snapshot: first, entries, history: 'complete', connection: watchHealthy ? 'following' : 'opening' });
            if (first.creation === 'ready' && selectionAfterCreate === id) {
              selectionAfterCreate = undefined;
              view.setDesired(id);
            }
            for (const entry of entries.filter(entry => entry.kind === 'original' || entry.kind === 'assistant-text').slice(-12)) {
              if ('body' in entry && (!bodies.has(keyOf(entry.body)) || bodies.get(keyOf(entry.body))?.state === 'unloaded')) loadBody(entry.body, id, version);
            }
            update({});
            refreshQuestions(id, version);
            const lifecycle = entries.filter(entry => entry.kind === 'lifecycle');
            const manifest = JSON.stringify([id, first.epoch, lifecycle]);
            const changed = manifest !== commandManifest;
            commandManifest = manifest;
            if (lifecycle.some(entry => entry.runId) || [...commands.values()].some(command => command.identity.conversationId === id && command.identity.epoch === first.epoch && commandPending(command))) requestCommands(id, version, changed);
            remember(id);
            connect(id, version);
          } catch (error) {
            if (!current(id, version) || controller.signal.aborted) return;
            const connection = classify(error);
            if (connection === 'denied') { stopWatch(); stopCommands(); }
            update({ connection, history: 'unavailable' });
            retryInitialRead(id, version, error);
          } finally { if (readController === controller) readController = undefined; }
        }
      } finally {
        refreshRunning = false;
        if (active && refreshRequested && state.identity) requestRefresh(state.identity.conversationId, generation);
      }
    })();
  }

  function select(id: string): void {
    if (pendingCreate?.conversationId !== id) view.setDesired(uuid.test(id) ? id : null, !view.canMutate(id));
    if (state.identity?.conversationId === id && active) { if (pendingCreate?.conversationId !== id) requestRefresh(id, generation); return; }
    stopWatch(); stopRead(); stopBodies(); stopCommands();
    generation++;
    refreshRequested = false;
    update({ identity: { conversationId: id, epoch: null }, draft: drafts.get(id) ?? emptyDraft, snapshot: null, entries: [], history: 'loading', connection: 'opening', newChat: 'idle' });
    if (!uuid.test(id)) { update({ connection: 'unavailable', history: 'unavailable' }); return; }
    requestRefresh(id, generation);
  }

  async function startNew(initial = false): Promise<void> {
    if (!active || closed || state.newChat === 'starting') return;
    const source = { id: state.identity?.conversationId, draft: state.draft.version, navigation: options.navigationGeneration?.(), version: navigationVersion };
    update({ newChat: 'starting' });
    if (!await view.ensureRegistered()) { if (!closed) update({ newChat: 'unavailable' }); return; }
    if (closed || !active || source.id !== state.identity?.conversationId || (!initial && source.draft !== state.draft.version) || source.version !== navigationVersion || source.navigation !== options.navigationGeneration?.()) {
      if (!closed) update({ newChat: 'idle' });
      return;
    }
    const old = state.identity;
    const draft = initial ? state.draft : emptyDraft;
    if (!initial && old) drafts.delete(old.conversationId);
    const conversationId = randomUUID();
    const clientCommandId = randomUUID();
    if (!uuid.test(conversationId) || !uuid.test(clientCommandId)) { update({ newChat: 'unavailable' }); return; }
    pendingCreate = { conversationId, clientCommandId };
    selectionAfterCreate = conversationId;
    stopWatch(); stopRead(); stopBodies(); stopCommands();
    generation++;
    refreshRequested = false;
    const version = generation;
    if (initial) drafts.set(conversationId, draft);
    update({ identity: { conversationId, epoch: null }, draft, snapshot: null, entries: [], history: 'loading', connection: 'opening', newChat: 'starting' });
    remember(conversationId);
    options.navigate(`/think?${new URLSearchParams({ conversation: conversationId })}`, { replace: true, focus: 'preserve' });
    try {
      const receipt = await client.create({ conversationId, clientCommandId });
      if (!current(conversationId, version)) return;
      if (receipt.kind !== 'create' || receipt.state === 'rejected') { update({ newChat: 'unavailable', connection: 'unavailable' }); return; }
      pendingCreate = undefined;
      update({ newChat: 'idle' });
      requestRefresh(conversationId, version);
    } catch {
      if (current(conversationId, version)) update({ newChat: 'unavailable', connection: 'unavailable' });
    }
  }

  function handoffPhase(owner: PrefillHandoff, phase: ThinkHandoffState['phase']): void {
    if (closed || handoff !== owner) return;
    update({ handoff: { source: owner.request.source, triggerId: owner.request.triggerId, kind: owner.request.kind, phase, canCheck: !!owner.target?.dispatched } });
  }
  function unchangedHandoff(owner: PrefillHandoff): boolean {
    return navigationVersion === owner.navigationVersion && (state.identity?.conversationId ?? null) === owner.originId &&
      options.navigationGeneration?.() === owner.shellNavigationGeneration && state.draft.version === owner.originDraftVersion &&
      (!owner.target || drafts.get(owner.target.conversationId)?.version === owner.target.draftVersion);
  }
  function clearObsoleteResumedTransport(id: string, epoch: string): void {
    // A same-epoch Resume changes selection, not ownership of pending commands
    // or their recoverable text. Only a verified new epoch obsoletes that state.
    for (const [key, command] of commands) if (command.identity.conversationId === id && command.identity.epoch !== epoch) commands.delete(key);
    for (const [key, value] of bodies) if (value.ref.key.conversationId === id && value.ref.epoch !== epoch) { bodies.delete(key); bodyProgress.delete(key); }
    for (const key of bodyOwners.keys()) {
      const [ownerEpoch, body] = JSON.parse(key);
      if (body.conversationId === id && ownerEpoch !== epoch) bodyOwners.delete(key);
    }
    for (const map of [receipts, replies, rejected]) for (const key of map.keys()) {
      const [conversationId, ownerEpoch] = JSON.parse(key);
      if (conversationId === id && ownerEpoch !== epoch) map.delete(key);
    }
    if (sends.get(id)?.identity.epoch !== epoch) sends.delete(id);
    if (questionEpochs.get(id) !== epoch) { questions.delete(id); questionEpochs.delete(id); }
  }
  function commitHandoff(owner: PrefillHandoff): void {
    const target = owner.target;
    if (closed || handoff !== owner || !target?.snapshot) return;
    if (!unchangedHandoff(owner)) { handoffPhase(owner, 'stale'); return; }
    // This is a context commit, not New chat's explicit draft-discard branch.
    const draft = drafts.get(target.conversationId)!;
    stopWatch(); stopRead(); stopBodies(); stopCommands();
    if (owner.request.kind === 'resume') clearObsoleteResumedTransport(target.conversationId, target.snapshot.epoch);
    generation++;
    refreshRequested = false;
    handoff = undefined;
    handoffFocusAwaitingVisit = true;
    if (handoffTimer !== undefined) { clock.clearTimeout(handoffTimer); handoffTimer = undefined; }
    // Only an explicit, target-verified Resume can adopt a fresh transport epoch.
    const snapshot = target.snapshot;
    if (selectionAfterCreate === target.conversationId) selectionAfterCreate = undefined;
    update({ handoff: null, identity: { conversationId: target.conversationId, epoch: snapshot.epoch }, draft,
      snapshot, entries: snapshot.entries, history: snapshot.nextCursor ? 'loading' : 'complete', newChat: 'idle', connection: 'inactive' });
    remember(target.conversationId);
    console.info('think_handoff_commit', { source: owner.request.source });
    options.navigate(`/think?${new URLSearchParams({ conversation: target.conversationId })}`, { replace: true, focus: 'preserve' });
    focusNavigationGeneration = options.navigationGeneration?.();
    if (!closed && state.identity?.conversationId === target.conversationId) update({ messageFocus: { conversationId: target.conversationId, token: target.clientCommandId } });
  }
  async function acceptHandoffReceipt(owner: PrefillHandoff, receipt: CommandReceipt): Promise<void> {
    if (closed || handoff !== owner || !owner.target) return;
    const target = owner.target;
    const expectedKind = owner.request.kind === 'resume' ? 'resume' : 'create';
    if (receipt.kind !== expectedKind || receipt.conversationId !== target.conversationId || receipt.clientCommandId !== target.clientCommandId || !uuid.test(receipt.epoch)) {
      handoffPhase(owner, 'unavailable'); return;
    }
    if (receipt.state === 'rejected') { handoffPhase(owner, 'rejected'); return; }
    if (receipt.state === 'ready') {
      // A durable create fact can outlive the daemon's ability to serve its target.
      // Verify availability without changing the origin; commit rechecks draft/navigation fences.
      console.info('think_handoff_target_attempt', { source: owner.request.source });
      try {
        const snapshot = await client.snapshot(target.conversationId);
        if (snapshot.conversationId !== target.conversationId || snapshot.epoch !== receipt.epoch || snapshot.creation !== 'ready') throw new ThinkClientError('invalid-response');
        target.snapshot = snapshot;
        console.info('think_handoff_target_outcome', { state: 'ready' });
      } catch {
        console.info('think_handoff_target_outcome', { state: 'unavailable' });
        handoffPhase(owner, 'unavailable'); return;
      }
      const result = await view.transition(target.conversationId, () => !closed && handoff === owner && unchangedHandoff(owner), () => commitHandoff(owner));
      if (result !== 'committed') handoffPhase(owner, result === 'stale' ? 'stale' : 'unavailable');
      return;
    }
    handoffPhase(owner, 'checking');
    handoffTimer = clock.setTimeout(() => { handoffTimer = undefined; void reconcileHandoff(owner); }, owner.pollDelay);
    owner.pollDelay = Math.min(owner.pollDelay * 2, 5000);
  }
  async function reconcileHandoff(owner: PrefillHandoff): Promise<void> {
    if (closed || handoff !== owner || !owner.target || owner.checking) return;
    if (handoffTimer !== undefined) { clock.clearTimeout(handoffTimer); handoffTimer = undefined; }
    owner.checking = true;
    handoffPhase(owner, 'checking');
    console.info('think_handoff_check_attempt', { source: owner.request.source });
    try {
      const receipt = await client.receipt(owner.target.conversationId, owner.target.clientCommandId);
      console.info('think_handoff_check_outcome', { state: receipt.state });
      await acceptHandoffReceipt(owner, receipt);
    } catch {
      console.info('think_handoff_check_outcome', { state: 'unavailable' });
      handoffPhase(owner, 'unavailable');
    } finally { owner.checking = false; }
  }
  async function prepareHandoff(owner: PrefillHandoff): Promise<void> {
    if (closed || handoff !== owner || owner.target) return;
    let conversationId: string;
    let clientCommandId: string;
    try { conversationId = owner.request.kind === 'resume' ? owner.request.conversationId : randomUUID(); clientCommandId = randomUUID(); }
    catch { handoffPhase(owner, 'rejected'); return; }
    if (!uuid.test(conversationId) || !uuid.test(clientCommandId) || owner.request.kind === 'fresh-prefill' && (conversationId === state.identity?.conversationId || drafts.has(conversationId))) {
      handoffPhase(owner, 'rejected'); return;
    }
    // Initialize exactly once, before the first create await, under its own key.
    const draft: ThinkDraft = owner.request.kind === 'fresh-prefill' ? { text: owner.request.text, version: 1 } : drafts.get(conversationId) ?? emptyDraft;
    drafts.set(conversationId, draft);
    owner.target = { conversationId, clientCommandId, draftVersion: draft.version, dispatched: false };
    handoffPhase(owner, 'starting');
    if (!await view.ensureRegistered()) { handoffPhase(owner, 'rejected'); return; }
    if (closed || handoff !== owner) return;
    if (!unchangedHandoff(owner)) { handoffPhase(owner, 'rejected'); return; }
    const operation = owner.request.kind === 'resume' ? 'resume' : 'create';
    console.info(`think_handoff_${operation}_attempt`, { source: owner.request.source });
    try {
      owner.target.dispatched = true;
      const receipt = owner.request.kind === 'resume' ? await conversations.resume(conversationId, clientCommandId) : await client.create({ conversationId, clientCommandId });
      console.info(`think_handoff_${operation}_outcome`, { state: receipt.state });
      await acceptHandoffReceipt(owner, receipt);
    } catch (error) {
      console.info(`think_handoff_${operation}_outcome`, { state: 'unavailable' });
      handoffPhase(owner, rejectedPost(error) ? 'rejected' : 'unavailable');
    }
  }

  let session: ThinkSession;
  const actions: ThinkPresentationActions = {
    editDraft(text) { session.editDraft(text); },
    send(identity, draftVersion) {
      if (!ownedIdentity(identity) || !mutationLease(identity.conversationId) || state.draft.version !== draftVersion || !state.draft.text.trim() || state.snapshot?.sendEligibility !== 'available' || state.connection === 'denied' || state.connection === 'service-changed' || state.connection === 'unavailable' || state.connection === 'inactive' || state.connection === 'reconnecting') return;
      const existing = sends.get(identity.conversationId);
      if (existing && (checkingSend(existing) || validRun(existing))) return;
      const commandId = randomUUID();
      if (!uuid.test(commandId)) return;
      const send: OwnedSend = { kind: 'send', identity: { ...identity }, commandId, delivery: 'posting', text: state.draft.text, draftVersion };
      sends.set(identity.conversationId, send);
      commands.set(commandKey(identity, commandId), send);
      update({});
      void Promise.resolve().then(() => client.send({ conversationId: identity.conversationId, clientCommandId: commandId, text: send.text }))
        .then(receipt => commandAcknowledged(send, receipt)).catch(error => commandFailure(send, error));
    },
    stop(identity, runId) {
      const send = sends.get(identity.conversationId);
      if (!ownedIdentity(identity) || !mutationLease(identity.conversationId) || !validRun(send) || send.receipt.runId !== runId || stopState(send.stop) === 'requesting' || state.snapshot?.sendEligibility === 'unavailable' || state.connection === 'denied' || state.connection === 'service-changed' || state.connection === 'unavailable') return;
      const commandId = randomUUID();
      if (!uuid.test(commandId)) return;
      const stop: OwnedStop = { kind: 'stop', identity: { ...identity }, commandId, runId, delivery: 'posting' };
      commands.set(commandKey(identity, commandId), stop);
      send.stop = stop; update({});
      void Promise.resolve().then(() => client.stop({ conversationId: identity.conversationId, clientCommandId: commandId, runId }))
        .then(receipt => commandAcknowledged(stop, receipt)).catch(error => commandFailure(stop, error));
    },
    requestNewChat() { session.requestNewChat(); },
    cancelNewChat() { session.cancelNewChat(); },
    confirmNewChat() { session.confirmNewChat(); },
    checkConnection() {
      session.checkConnection();
    },
    retryBody(identity, ref) {
      if (!ownedIdentity(identity) || ref.key.conversationId !== identity.conversationId || ref.epoch !== identity.epoch || !state.entries.some(entry => 'body' in entry && keyOf(entry.body) === keyOf(ref))) return;
      loadBody(ref, identity.conversationId, generation); update({});
    },
    editQuestion(identity, decisionId, answer) {
      if (!ownedIdentity(identity)) return;
      const value = structuredClone(answer);
      questions.set(identity.conversationId, (questions.get(identity.conversationId) ?? []).map(question => question.decisionId === decisionId && (question.reply === 'idle' || question.reply === 'rejected') ? { ...question, answer: value } : question)); update({});
    },
    replyQuestion(identity, decisionId, answer) {
      if (!ownedIdentity(identity) || !mutationLease(identity.conversationId)) return;
      const list = questions.get(identity.conversationId) ?? [];
      const question = list.find(item => item.decisionId === decisionId);
      if (!question || question.reply !== 'idle' && question.reply !== 'rejected') return;
      const clientCommandId = randomUUID();
      if (!uuid.test(clientCommandId)) return;
      const captured: FormReplyCommand['answer'] = structuredClone(answer);
      const reply: OwnedReply = { kind: 'form-reply', identity: { ...identity }, commandId: clientCommandId, decisionId,
        request: JSON.stringify([question.detail.title, question.detail.fields]), answer: captured, delivery: 'posting' };
      commands.set(commandKey(identity, clientCommandId), reply); replies.set(questionKey(identity, decisionId), reply);
      questions.set(identity.conversationId, list.map(item => item.decisionId === decisionId ? { ...item, answer: captured, reply: 'registered' } : item)); update({});
      void Promise.resolve().then(() => client.reply({ conversationId: identity.conversationId, clientCommandId, decisionId, answer: captured }))
        .then(receipt => commandAcknowledged(reply, receipt)).catch(error => commandFailure(reply, error));
    },
    recoverRejected(identity, clientCommandId, replaceDraftVersion) {
      const item = rejected.get(identityKey(identity))?.find(entry => entry.clientCommandId === clientCommandId);
      if (!ownedIdentity(identity) || !item || (state.draft.text.length && replaceDraftVersion !== state.draft.version)) return;
      session.editDraft(item.text);
    },
    claimMessageFocus(token) {
      if (state.messageFocus?.token !== token) return false;
      const eligible = options.navigationGeneration?.() === focusNavigationGeneration;
      handoffFocusAwaitingVisit = false;
      update({ messageFocus: undefined });
      return eligible;
    },
  };
  presentation = { state: project(), actions };
  session = {
    getSnapshot: () => state,
    getPresentation: () => presentation,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setLocation(location) {
      if (closed) return;
      const signature = JSON.stringify([location.pathname, location.search, location.hash ?? '', location.key ?? '']);
      const locationChanged = signature !== locationSignature;
      const pendingChanged = navigationPending !== !!location.isNavigating;
      const url = JSON.stringify([location.pathname, location.search, location.hash ?? '']);
      const shellGeneration = options.navigationGeneration?.();
      const adoptingInitialEntry = initialEntry && !!location.key && location.key !== 'initial' &&
        initialEntry.url === url && initialEntry.navigationGeneration === shellGeneration && !navigationPending && !location.isNavigating;
      if (!locationSignature && location.key === 'initial' && !location.isNavigating) initialEntry = { url, navigationGeneration: shellGeneration };
      else if (locationChanged || pendingChanged) initialEntry = undefined;
      if (adoptingInitialEntry) {
        // Presentation's one-time synthetic key adoption is the same activation,
        // not a navigation that cancels creation waiting on view registration.
        locationSignature = signature;
        return;
      }
      if (locationChanged || pendingChanged) {
        locationSignature = signature;
        locationPath = location.pathname;
        navigationPending = !!location.isNavigating;
        navigationVersion++;
        if (handoff && !handoff.target) { handoff = undefined; update({ handoff: null }); }
      }
      // A Next transition can still render Ground while its requested Think URL
      // is being prepared. Preserve our one-shot focus until that visit commits.
      if (state.messageFocus) {
        const expected = location.pathname === '/think' && new URLSearchParams(location.search).get('conversation') === state.messageFocus.conversationId;
        const arriving = expected && locationChanged && handoffFocusAwaitingVisit;
        if (expected && locationChanged) handoffFocusAwaitingVisit = false;
        if ((!navigationPending && !expected) || (pendingChanged && navigationPending && !arriving && !handoffFocusAwaitingVisit) || (locationChanged && location.pathname !== '/ground' && !expected)) {
          handoffFocusAwaitingVisit = false;
          update({ messageFocus: undefined });
        }
      }
      if (pendingChanged && !locationChanged) return;
      const nowActive = location.pathname === '/think';
      if (!viewStarted) {
        viewStarted = true;
        if (!nowActive && !state.identity) {
          const pointer = readPointer();
          if (pointer && uuid.test(pointer)) update({ identity: { conversationId: pointer, epoch: null }, draft: drafts.get(pointer) ?? emptyDraft });
        }
        view.setDesired(state.identity?.conversationId ?? null);
      } else if (locationChanged && !nowActive) view.refresh();
      if (!nowActive) {
        if (active) { active = false; generation++; refreshRequested = false; stopWatch(); stopRead(); stopBodies(); stopCommands(); update({ connection: 'inactive' }); }
        return;
      }
      const wasActive = active;
      active = true;
      const params = new URLSearchParams(location.search);
      const explicit = params.getAll('conversation');
      if (explicit.length > 1) { select(''); return; }
      const selected = explicit.length ? explicit[0] : readPointer() ?? state.identity?.conversationId ?? null;
      if (selected === null) { void startNew(true); return; }
      if (!explicit.length && uuid.test(selected)) options.navigate(`/think?${new URLSearchParams({ conversation: selected })}`, { replace: true, focus: 'preserve' });
      select(selected);
      if (!wasActive && pendingCreate?.conversationId === selected) session.checkConnection();
    },
    requestHandoff(request) {
      if (closed || handoff || navigationPending || locationPath !== '/ground') return;
      if (request.kind === 'fresh-prefill' ? !request.text.trim() || new TextEncoder().encode(request.text).length > 2048 : !uuid.test(request.conversationId)) return;
      const owner: PrefillHandoff = { request: { ...request }, originId: state.identity?.conversationId ?? null,
        originDraftVersion: state.draft.version, navigationVersion, shellNavigationGeneration: options.navigationGeneration?.(), checking: false, pollDelay: 500 };
      handoff = owner;
      if (state.identity) drafts.set(state.identity.conversationId, state.draft);
      if (state.draft.text.length && (request.kind !== 'resume' || request.conversationId !== state.identity?.conversationId)) handoffPhase(owner, 'confirm'); else void prepareHandoff(owner);
    },
    confirmHandoff() {
      if (!handoff || navigationPending || state.handoff?.phase !== 'confirm' && state.handoff?.phase !== 'stale') return;
      const owner = handoff;
      owner.originId = state.identity?.conversationId ?? null;
      owner.originDraftVersion = state.draft.version;
      owner.navigationVersion = navigationVersion;
      owner.shellNavigationGeneration = options.navigationGeneration?.();
      if (owner.target) {
        // Explicit reconfirmation honors later target edits; it never restores prefill.
        owner.target.draftVersion = drafts.get(owner.target.conversationId)?.version ?? owner.target.draftVersion;
        void reconcileHandoff(owner);
      } else void prepareHandoff(owner);
    },
    cancelHandoff() {
      if (!handoff || !['confirm', 'stale', 'rejected'].includes(state.handoff?.phase ?? '')) return;
      // Prepared drafts remain keyed in memory; dismissing never deletes/stops a chat.
      handoff = undefined;
      if (handoffTimer !== undefined) { clock.clearTimeout(handoffTimer); handoffTimer = undefined; }
      update({ handoff: null });
    },
    checkHandoff() { if (handoff) void reconcileHandoff(handoff); },
    refreshView() { view.refresh(); },
    async prepareDeletion(conversationId) {
      const origin = state.identity?.conversationId ?? null;
      const version = navigationVersion;
      const shellGeneration = options.navigationGeneration?.();
      const valid = () => !closed && locationPath === '/ground' && !navigationPending && !handoff &&
        navigationVersion === version && options.navigationGeneration?.() === shellGeneration &&
        (state.identity?.conversationId ?? null) === origin && conversationId !== origin &&
        view.getSnapshot().status === 'ready' && view.getSnapshot().selection?.conversationId === origin &&
        (origin === null || view.canMutate(origin));
      if (closed || locationPath !== '/ground' || navigationPending || handoff || conversationId === origin) return null;
      if (!await view.ensureRegistered() || !valid()) return null;
      const token = view.getSnapshot().token;
      return token ? { viewToken: token, valid: () => valid() && view.getSnapshot().token === token, invalidate: () => view.refresh() } : null;
    },
    editDraft(text) {
      if (closed || typeof text !== 'string') return;
      const draft = { text, version: state.draft.version + 1 };
      if (state.identity) drafts.set(state.identity.conversationId, draft);
      // Someone already writing in the pending target does not need delayed focus.
      if (state.messageFocus) handoffFocusAwaitingVisit = false;
      update({ draft, ...(state.messageFocus ? { messageFocus: undefined } : {}) });
    },
    requestNewChat() { if (state.draft.text.length) update({ newChat: 'confirm-discard' }); else void startNew(); },
    cancelNewChat() { if (state.newChat === 'confirm-discard') update({ newChat: 'idle' }); },
    confirmNewChat() { if (state.newChat === 'confirm-discard') void startNew(); },
    checkConnection() {
      view.refresh();
      const id = state.identity?.conversationId;
      if (!id || !uuid.test(id) || !active) return;
      const version = generation;
      if (pendingCreate?.conversationId === id) {
        const command = pendingCreate;
        void client.receipt(id, command.clientCommandId).then(receipt => {
          if (!current(id, version)) return;
          if (receipt.kind !== 'create' || receipt.state === 'rejected') { update({ newChat: 'unavailable', connection: 'unavailable' }); return; }
          pendingCreate = undefined; update({ newChat: 'idle' }); requestRefresh(id, version);
        }, error => { if (current(id, version)) update({ connection: classify(error), newChat: 'unavailable' }); });
        return;
      }
      stopWatch();
      if (state.connection === 'service-changed') return;
      requestCommands(id, version, true);
      update({ connection: 'opening' }); requestRefresh(id, version);
    },
    close() { if (closed) return; closed = true; generation++; stopWatch(); stopRead(); stopBodies(); stopCommands();
      if (handoffTimer !== undefined) clock.clearTimeout(handoffTimer); handoff = undefined; unsubscribeView(); view.close(); listeners.clear(); },
  };
  const unsubscribeView = view.subscribe(() => update({ view: view.getSnapshot() }));
  return session;
}
