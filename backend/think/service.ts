import type { CommandReceipt, ConversationState, CreateConversationCommand, CreateReceipt, FormDecision, FormReplyCommand, FormReplyReceipt, SendCommand, SendReceipt, StopCommand, StopReceipt } from './contract';
import type { FormInfo, SessionCreateInput } from '@opencode/client';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
import type { NativeSession, NativeSessions } from './native';
import type { BodyKey, BodyReader, BodyRef, BodyStore, PreviewBodyRef } from './body-store';
import type { ProjectionEntry, ProjectionPage, ThinkContentReader, ToolCategory, ToolState } from './projection';
import type { ContentChunk, ContentChunkRequest } from './content-transfer';

export type ConversationSnapshot = ConversationState & Pick<ProjectionPage, 'entries' | 'contentHealth' | 'nextCursor'>;
export interface ConversationWatch {
  snapshot: ConversationSnapshot;
  next(): Promise<ConversationState | null>;
  close(): void;
}

export type ThinkServiceErrorCode = 'invalid_request' | 'command_conflict' | 'not_found' | 'think_unavailable' | 'decision_unavailable' | 'content_unavailable';

export class ThinkServiceError extends Error {
  constructor(readonly code: ThinkServiceErrorCode) {
    super('Think service request failed');
    this.name = 'ThinkServiceError';
  }
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
  serviceIdentity: { pid: number; version: string };
  clock?: { now(): number };
  transferIdleMs?: number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function copyReceipt(receipt: CommandReceipt): CommandReceipt {
  if (receipt.kind === 'create' && receipt.state === 'rejected') return { ...receipt, failure: { ...receipt.failure } };
  if (receipt.kind === 'send' && receipt.failure) return { ...receipt, failure: { ...receipt.failure } };
  if (receipt.kind === 'form-reply' && receipt.failure) return { ...receipt, failure: { ...receipt.failure } };
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
  const { directory, agent } = options.context;
  const model = options.context.model ? { ...options.context.model } : undefined;
  if (!bodies || typeof bodies.replace !== 'function' || typeof bodies.append !== 'function' || typeof bodies.open !== 'function' || typeof bodies.close !== 'function' ||
      !uuid.test(epoch) || !Number.isSafeInteger(identity.pid) || identity.pid < 1 || identity.version !== '2.2.2' || !isAbsolute(directory) || normalize(directory) !== directory || directory.includes('\0')) throw new ThinkServiceError('invalid_request');
  const commands = new Map<string, CommandReceipt>();
  const replyPayloads = new Map<string, string>();
  const preparingReplies = new Map<string, { payload: string; result: Promise<FormReplyReceipt> }>();
  const formLocks = new Set<string>();
  const conversations = new Map<string, ConversationState>();
  const watchers = new Map<string, Set<(state: ConversationState | null) => void>>();
  function setConversation(id: string, state: ConversationState): void {
    const previous = conversations.get(id);
    conversations.set(id, state);
    if (!previous || state.revision <= previous.revision) return;
    for (const notify of watchers.get(id) ?? []) notify({ ...state });
  }
  const sendDigests = new Map<string, string>();
  const projections = new Map<string, ProjectionEntry[]>();
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
  let openingTransfers = 0;
  function trackTransfer<T>(work: Promise<T>): Promise<T> {
    transferWork.add(work);
    void work.then(() => transferWork.delete(work), () => transferWork.delete(work));
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
  const runs = new Map<string, { conversationId: string; sendCommandId: string }>();
  const activeRuns = new Map<string, string>();
  const activeSessions = new Set<string>();
  const incompleteContent = new Set<string>();
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
  let monitor: { controller: AbortController; connected: Promise<boolean>; task: Promise<void>; healthy: boolean; generation: number } | undefined;
  let closed = false;
  let identityChanged = false;
  let available = true;
  let closing: Promise<void> | undefined;

  const bodyBytes = async function* (value: string): AsyncIterable<Uint8Array> { yield Buffer.from(value, 'utf8'); };
  const refIdentity = (ref: BodyRef) => JSON.stringify([ref.key.conversationId, ref.key.owner.kind,
    ref.key.owner.kind === 'assistant-text' ? ref.key.owner.messageId : ref.key.owner.clientCommandId,
    ref.key.owner.kind === 'assistant-text' ? ref.key.owner.ordinal : ref.key.owner.kind === 'original' ? ref.key.owner.messageId : ref.key.owner.decisionId,
    ref.epoch, ref.contentId, ref.generation, ref.through, ref.kind, ref.kind === 'canonical' ? ref.sha256 : null]);
  function putEntry(conversationId: string, entry: Omit<Extract<ProjectionEntry, { kind: 'original' }>, 'displayOrder'> | Omit<Extract<ProjectionEntry, { kind: 'assistant-text' }>, 'displayOrder'> | Omit<Extract<ProjectionEntry, { kind: 'tool' }>, 'displayOrder'> | Omit<Extract<ProjectionEntry, { kind: 'form-reply' }>, 'displayOrder'>): void {
    const entries = projections.get(conversationId) ?? [];
    const index = entries.findIndex(existing => existing.kind === entry.kind && (
      entry.kind === 'original' && existing.kind === 'original' && existing.clientCommandId === entry.clientCommandId ||
      entry.kind === 'assistant-text' && existing.kind === 'assistant-text' && existing.messageId === entry.messageId && existing.ordinal === entry.ordinal ||
      entry.kind === 'tool' && existing.kind === 'tool' && existing.messageId === entry.messageId && existing.toolCallId === entry.toolCallId ||
      entry.kind === 'form-reply' && existing.kind === 'form-reply' && existing.clientCommandId === entry.clientCommandId));
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
    const state = conversations.get(conversationId);
    if (state && changed) setConversation(conversationId, { ...state, revision: state.revision + 1 });
  }

  function markPreviewGaps(): void {
    for (const [conversationId, entries] of projections) {
      let changed = false;
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry.kind === 'assistant-text' && entry.closure === 'open' && entry.capture !== 'incomplete') { entries[index] = { ...entry, capture: 'incomplete' }; noteMissing(conversationId, entry.messageId, entry.ordinal); changed = true; }
      }
      const state = conversations.get(conversationId);
      if (changed) incompleteContent.add(conversationId);
      if (changed && state) setConversation(conversationId, { ...state, revision: state.revision + 1 });
    }
  }

  function lifecycle(receipt: CommandReceipt, changes?: Partial<ConversationState>): void {
    const entries = projections.get(receipt.conversationId) ?? [];
    entries.push({ kind: 'lifecycle', clientCommandId: receipt.clientCommandId, ...('runId' in receipt ? { runId: receipt.runId } : {}),
      state: receipt.state, sourceTime: Date.now(), displayOrder: entries.length });
    projections.set(receipt.conversationId, entries);
    const state = conversations.get(receipt.conversationId);
    if (state) setConversation(receipt.conversationId, { ...state, ...changes, revision: state.revision + 1 });
  }

  async function captureText(conversationId: string, messageId: string, ordinal: number, text: string, kind: 'start' | 'delta' | 'end'): Promise<void> {
    const key: BodyKey = { conversationId, owner: { kind: 'assistant-text', messageId, ordinal } };
    const existing = projections.get(conversationId)?.find(entry => entry.kind === 'assistant-text' && entry.messageId === messageId && entry.ordinal === ordinal);
    if (existing?.kind === 'assistant-text' && (existing.closure === 'closed' || existing.capture === 'incomplete') && kind !== 'end') return;
    try {
      let body: BodyRef;
      if (kind === 'end') body = await bodies.replace(key, bodyBytes(text), 'canonical');
      else if (existing?.kind === 'assistant-text' && existing.body.kind === 'preview') body = await bodies.append(existing.body, bodyBytes(text));
      else body = await bodies.replace(key, bodyBytes(text), 'preview');
      if (closed) return;
      putEntry(conversationId, { kind: 'assistant-text', messageId, ordinal, body, closure: kind === 'end' ? 'closed' : 'open', capture: kind === 'delta' && !existing ? 'incomplete' : 'complete' });
    } catch {
      markPreviewGaps();
      noteMissing(conversationId, messageId, ordinal);
      if (!incompleteContent.has(conversationId)) {
        incompleteContent.add(conversationId);
        const state = conversations.get(conversationId);
        if (state) setConversation(conversationId, { ...state, revision: state.revision + 1 });
      }
      console.info('think_content_outcome', { status: 'unavailable' });
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
          try { const result = await bodies.evict(ref); if (result === 'evicted' || result === 'already-evicted') reclaimable.delete(key); }
          catch { console.info('think_content_reclaim_outcome', { status: 'unavailable' }); }
        }
      })().finally(() => { maintenanceRunning = false; });
      void trackTransfer(maintenance);
    }
    for (const conversationId of conversations.keys()) {
      if (!refreshes.get(conversationId)?.running) requestRefresh(conversationId);
    }
  }, 5000);
  refreshTimer.unref();

  function requireOpen(): void {
    if (closed) throw new ThinkServiceError('think_unavailable');
  }

  function requireAvailable(): void {
    requireOpen();
    if (identityChanged || !available || (monitor && !monitor.healthy)) throw new ThinkServiceError('think_unavailable');
  }

  function update(receipt: CreateReceipt, state: 'ready' | 'upstream-unconfirmed' | 'rejected'): void {
    if (closed) return;
    const next: CreateReceipt = state === 'rejected'
      ? { ...receipt, state, failure: { code: 'ownership_mismatch' } }
      : { kind: 'create', conversationId: receipt.conversationId, clientCommandId: receipt.clientCommandId, epoch, state };
    const previous = conversations.get(receipt.conversationId);
    if (!previous) return;
    commands.set(receipt.clientCommandId, next);
    lifecycle(next, { creation: state });
  }

  function matches(session: NativeSession, id: string, conversationId: string): boolean {
    const marker = session.metadata?.memoryLoop;
    return session.id === id && session.parentID == null && session.location?.directory === directory &&
      typeof marker === 'object' && marker !== null && !Array.isArray(marker) &&
      marker.owner === 'memory-loop' && marker.conversationId === conversationId && marker.epoch === epoch &&
      session.permissions?.length === 1 && session.permissions[0].action === '*' &&
      session.permissions[0].resource === '*' && session.permissions[0].effect === 'allow' &&
      (agent === undefined || session.agent === agent) &&
      (model === undefined || (session.model?.providerID === model.providerID && session.model.id === model.id &&
        (model.variant === undefined ? session.model.variant === undefined || session.model.variant === 'default' : session.model.variant === model.variant)));
  }

  async function nativeCall<T>(controller: AbortController, operation: 'create' | 'readback' | 'monitor-connect' | 'prompt' | 'inbox-list' | 'inbox-cancel' | 'interrupt' | 'status' | 'active' | 'history' | 'identity' | 'form-list' | 'form-get' | 'form-reply' | 'permission-list' | 'message-get', call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    console.info('think_native_attempt', { operation });
    const signal = controller.signal;
    if (signal.aborted) {
      console.info('think_native_outcome', { operation, outcome: 'aborted' });
      throw new Error('Native call aborted');
    }
    const timer = setTimeout(() => controller.abort(), 10000);
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Native call aborted'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const result = await Promise.race([call(signal), aborted]);
      console.info('think_native_outcome', { operation, outcome: 'success' });
      return result;
    } catch (error) {
      console.info('think_native_outcome', { operation, outcome: signal.aborted ? 'aborted' : 'failed' });
      throw error;
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  async function verifyIdentity(controller: AbortController): Promise<boolean> {
    try {
      const info = await nativeCall(controller, 'identity', signal => native.getServerInfo(signal));
      if (info.pid !== identity.pid || info.version !== identity.version) {
        identityChanged = true;
        available = false;
        monitor?.controller.abort();
        console.info('think_identity_outcome', { status: 'changed' });
        return false;
      }
      if (!identityChanged && !closed) available = true;
      return !identityChanged && !closed;
    } catch {
      if (!closed) available = false;
      return false;
    }
  }

  async function openPublishedBody(ref: BodyRef): Promise<BodyReader> {
    const key = refIdentity(ref);
    if (!published.has(key)) throw new ThinkServiceError('not_found');
    try { return await bodies.open(ref); }
    catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'unavailable' && 'reason' in error && error.reason === 'evicted') || ref.kind !== 'canonical') throw new ThinkServiceError('content_unavailable');
    }
    const locator = locators.get(key);
    if (!locator || closed) throw new ThinkServiceError('content_unavailable');
    let work = rehydrations.get(key);
    if (!work) {
      const controller = new AbortController();
      const promise = (async () => {
        if (!await verifyIdentity(controller)) throw new ThinkServiceError('content_unavailable');
        const message = await nativeCall(controller, 'message-get', signal => native.getMessage({ sessionID: locator.sessionID, messageID: locator.messageID }, signal));
        if (message.id !== locator.messageID || message.type !== 'assistant' || message.time.completed === undefined) throw new ThinkServiceError('content_unavailable');
        const part = message.content.filter(item => item.type === 'text')[locator.ordinal];
        if (!part || part.type !== 'text' || Buffer.byteLength(part.text, 'utf8') !== ref.through || createHash('sha256').update(part.text, 'utf8').digest('hex') !== ref.sha256 ||
            !await verifyIdentity(controller) || controller.signal.aborted || closed) throw new ThinkServiceError('content_unavailable');
        const guard = await bodies.restore(ref, bodyBytes(part.text));
        if (closed || controller.signal.aborted) { await guard.close(); throw new ThinkServiceError('content_unavailable'); }
        return guard;
      })();
      tasks.set(controller, promise.then(() => {}, () => {}).finally(() => { tasks.delete(controller); }));
      work = { promise, waiters: 0 };
      rehydrations.set(key, work);
    }
    work.waiters++;
    try {
      await work.promise;
      if (closed) throw new ThinkServiceError('content_unavailable');
      return await bodies.open(ref);
    } catch { throw new ThinkServiceError('content_unavailable'); }
    finally {
      work.waiters--;
      if (!work.waiters) {
        rehydrations.delete(key);
        const guard = await work.promise.catch(() => undefined);
        if (guard) { await guard.close(); if (!closed) reclaimable.set(key, ref); }
      }
    }
  }

  async function verifyBeforeCreate(): Promise<void> {
    const controller = new AbortController();
    const check = verifyIdentity(controller);
    const owned = check.then(() => {});
    tasks.set(controller, owned);
    try {
      if (!await check) throw new ThinkServiceError('think_unavailable');
      requireAvailable();
    } finally { tasks.delete(controller); }
  }

  function ownedSession(conversationId: string): string {
    if (!uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
    const state = conversations.get(conversationId);
    if (!state) throw new ThinkServiceError('not_found');
    if (state.creation !== 'ready') throw new ThinkServiceError('think_unavailable');
    return `ses_memoryloop_${conversationId.replaceAll('-', '')}`;
  }

  async function ownedRead<T>(operation: 'form-list' | 'form-get', call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    requireAvailable();
    const controller = new AbortController();
    const task = (async () => {
      if (!await verifyIdentity(controller)) throw new ThinkServiceError('think_unavailable');
      try { return await nativeCall(controller, operation, call); }
      catch { throw new ThinkServiceError('think_unavailable'); }
    })();
    tasks.set(controller, task.then(() => {}, () => {}));
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
    const input: SessionCreateInput = {
      id, location: { directory }, permissions: [{ action: '*', resource: '*', effect: 'allow' }],
      metadata: { memoryLoop: { owner: 'memory-loop', conversationId: receipt.conversationId, epoch } },
      ...(agent === undefined ? {} : { agent }), ...(model === undefined ? {} : { model: { ...model } }),
    };
    try {
      if (!await verifyIdentity(controller)) throw new Error('Native identity unavailable');
      await nativeCall(controller, 'create', signal => native.createSession(input, signal));
      const session = await nativeCall(controller, 'readback', signal => native.getSession({ sessionID: id }, signal));
      const valid = matches(session, id, receipt.conversationId);
      console.info('think_create_readback', { outcome: valid ? 'verified' : 'mismatch' });
      update(receipt, valid ? 'ready' : 'rejected');
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
    current.task = (async () => {
      console.info('think_monitor_attempt');
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
                const conversationId = sessionConversations.get(item.value.data.sessionID) ?? (item.value.type.startsWith('permission.') ? childConversations.get(item.value.data.sessionID) : undefined);
                if (conversationId) {
                  const event = item.value;
                  if (event.type === 'permission.asked') setPermissionPending(conversationId, true);
                  if (event.type === 'session.text.started') await captureText(conversationId, event.data.assistantMessageID, event.data.ordinal, '', 'start');
                  else if (event.type === 'session.text.delta') await captureText(conversationId, event.data.assistantMessageID, event.data.ordinal, event.data.delta, 'delta');
                  else if (event.type === 'session.text.ended') await captureText(conversationId, event.data.assistantMessageID, event.data.ordinal, event.data.text, 'end');
                  requestRefresh(conversationId);
                }
              }
            }
            console.info('think_monitor_outcome', { outcome: controller.signal.aborted ? 'closed' : 'ended' });
          } catch {
            console.info('think_monitor_outcome', { outcome: 'failed' });
          } finally {
            if (current.healthy && !controller.signal.aborted) markPreviewGaps();
            current.healthy = false;
            current.generation++;
            if (!closed) available = false;
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
      }
    })();
    return current;
  }

  function updateSend(receipt: SendReceipt, state: SendReceipt['state']): void {
    if (closed) return;
    const current = commands.get(receipt.clientCommandId);
    if (current?.kind === 'send' && (current.state === 'completed' || current.state === 'failed' || current.state === 'interrupted' || current.state === 'rejected' || current.state === 'cancelled-before-delivery')) return;
    const { failure: _failure, ...base } = receipt;
    const next: SendReceipt = state === 'failed' ? { ...base, state, failure: { code: 'execution_failed' } }
      : state === 'rejected' ? { ...base, state, failure: { code: 'resource_failure' } } : { ...base, state };
    if (current?.kind === 'send' && current.state === state) return;
    commands.set(receipt.clientCommandId, next);
    lifecycle(next);
  }

  async function dispatchSend(receipt: SendReceipt, text: string, controller: AbortController): Promise<void> {
    if (controller.signal.aborted) return;
    const messageId = `msg_memoryloop_${receipt.clientCommandId.replaceAll('-', '')}`;
    try {
      console.info('think_original_capture_attempt');
      const body = await bodies.replace({ conversationId: receipt.conversationId, owner: { kind: 'original', clientCommandId: receipt.clientCommandId, messageId } }, bodyBytes(text), 'canonical');
      if (controller.signal.aborted || closed || stoppedRuns.has(receipt.runId)) return;
      putEntry(receipt.conversationId, { kind: 'original', clientCommandId: receipt.clientCommandId, messageId, body });
      console.info('think_original_capture_outcome', { status: 'stored' });
    } catch {
      console.info('think_original_capture_outcome', { status: 'failed' });
      if (!stoppedRuns.has(receipt.runId)) updateSend(receipt, 'rejected');
      if (activeRuns.get(receipt.conversationId) === receipt.runId) activeRuns.delete(receipt.conversationId);
      return;
    }
    const current = startMonitor();
    try {
      const connected = await nativeCall(controller, 'monitor-connect', () => current.connected);
      if (!connected || !current.healthy || !await verifyIdentity(controller) || !current.healthy) throw new Error('Monitor unavailable');
    } catch {
      if (!current.healthy) current.controller.abort();
      updateSend(receipt, stoppedRuns.has(receipt.runId) ? 'cancelled-before-delivery' : 'monitor-unavailable');
      return;
    }
    if (stoppedRuns.has(receipt.runId)) { updateSend(receipt, 'cancelled-before-delivery'); if (activeRuns.get(receipt.conversationId) === receipt.runId) activeRuns.delete(receipt.conversationId); return; }
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
    if (closed || identityChanged || conversations.get(conversationId)?.creation !== 'ready' || !monitor?.healthy) return;
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
        while (!controller.signal.aborted && !closed && monitor?.healthy && conversations.get(conversationId)?.creation === 'ready') {
          const generation = state.generation;
          processedGeneration = generation;
          const monitored = monitor;
          const monitorGeneration = monitored.generation;
          const runId = activeRuns.get(conversationId);
          const run = runId ? runs.get(runId) : undefined;
          if (runId && !run) break;
          const sessionID = `ses_memoryloop_${conversationId.replaceAll('-', '')}`;
          const promptID = run ? `msg_memoryloop_${run.sendCommandId.replaceAll('-', '')}` : undefined;
          if (!await verifyIdentity(controller)) break;
          // A failed read cancels its batch, not the owner needed to fence successful observations.
          const batch = new AbortController();
          const abortBatch = () => batch.abort();
          controller.signal.addEventListener('abort', abortBatch, { once: true });
          if (controller.signal.aborted) batch.abort();
          let session: Awaited<ReturnType<NativeSessions['getSession']>> | undefined;
          let active: Awaited<ReturnType<NativeSessions['activeSessions']>> | undefined;
          let permissions: Awaited<ReturnType<NativeSessions['listPermissionRequests']>> | undefined;
          const reads = [
            nativeCall(batch, 'status', signal => native.getSession({ sessionID }, signal)).then(value => { session = value; }),
            nativeCall(batch, 'active', signal => native.activeSessions(signal)).then(value => { active = value; }),
            nativeCall(batch, 'permission-list', signal => native.listPermissionRequests({ location: { directory } }, signal)).then(value => { permissions = value; }),
          ];
          try {
            await Promise.all(reads);
          } catch {
            // The bounded call wrappers settle on abort even if an adapter ignores its signal.
            batch.abort();
            await Promise.allSettled(reads);
            console.info('think_reconciliation_outcome', { outcome: controller.signal.aborted ? 'aborted' : 'unavailable' });
          } finally {
            controller.signal.removeEventListener('abort', abortBatch);
          }
          if (session && !matches(session, sessionID, conversationId)) break;
          if (!await verifyIdentity(controller)) break;
          if (state.generation !== generation) continue;
          if (closed || identityChanged || monitor !== monitored || !monitor?.healthy || monitored.generation !== monitorGeneration || activeRuns.get(conversationId) !== runId) break;
          // Only a successful read can replace its channel's facts; unrelated failures retain them.
          if (active) {
            if (active[sessionID]) activeSessions.add(conversationId); else activeSessions.delete(conversationId);
          }
          if (permissions) setPermissionPending(conversationId, permissions.data.some(permission => permission.sessionID === sessionID || childConversations.get(permission.sessionID) === conversationId));
          if (!session) break;
          let cursor: string | undefined;
          const seen = new Set<string>();
          let userTime: number | undefined;
          let assistantTime: { created: number; completed: number; outcome: 'completed' | 'failed' } | undefined;
          const captured: ProjectionEntry[] = [];
          let captureFailed = false;
          const succeededKeys = new Set<string>();
          const failedKeys = new Set<string>();
          do {
            const page = await nativeCall(controller, 'history', signal => native.listMessages(cursor
              ? { sessionID, cursor, limit: 50 } : { sessionID, order: 'asc', limit: 50 }, signal));
            for (const message of page.data) {
              if (message.type === 'assistant') {
                let ordinal = 0;
                for (const part of message.content) {
                  if (part.type === 'text') {
                    const textOrdinal = ordinal++;
                    if (message.time.completed === undefined) continue;
                    const key: BodyKey = { conversationId, owner: { kind: 'assistant-text', messageId: message.id, ordinal: textOrdinal } };
                    const digest = createHash('sha256').update(part.text, 'utf8').digest('hex');
                    const existing = projections.get(conversationId)?.find(entry => entry.kind === 'assistant-text' && entry.messageId === message.id && entry.ordinal === textOrdinal);
                    try {
                      const body = existing?.kind === 'assistant-text' && existing.body.kind === 'canonical' && existing.body.sha256 === digest && existing.body.through === Buffer.byteLength(part.text)
                        ? existing.body : await bodies.replace(key, bodyBytes(part.text), 'canonical');
                      captured.push({ kind: 'assistant-text', messageId: message.id, ordinal: textOrdinal, body, closure: 'closed', capture: 'complete', displayOrder: 0 });
                      succeededKeys.add(textKey(message.id, textOrdinal));
                    } catch {
                      captureFailed = true;
                      failedKeys.add(textKey(message.id, textOrdinal));
                      if (existing?.kind === 'assistant-text') captured.push({ ...existing, capture: 'incomplete' });
                      console.info('think_content_outcome', { status: 'unavailable' });
                    }
                  } else if (part.type === 'tool') {
                    const category: ToolCategory = part.name === 'read' ? 'file-read' : ['write', 'edit'].includes(part.name) ? 'file-write'
                      : part.name === 'bash' ? 'shell' : ['grep', 'glob', 'search'].includes(part.name) ? 'search' : part.name === 'subagent' ? 'subagent' : 'custom';
                    const toolState: ToolState = part.state.status === 'completed' ? 'completed' : part.state.status === 'error' ? 'failed' : 'started';
                    captured.push({ kind: 'tool', messageId: message.id, toolCallId: createHash('sha256').update(part.id).digest('hex'), category, state: toolState, sourceTime: part.time.created,
                      ...(part.time.completed === undefined ? {} : { durationMs: Math.max(0, part.time.completed - part.time.created) }), displayOrder: 0 });
                  }
                }
              }
              if (message.type === 'user') {
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
          if (!await verifyIdentity(controller)) break;
          if (state.generation !== generation) continue;
          if (closed || identityChanged || monitor !== monitored || !monitor?.healthy || monitored.generation !== monitorGeneration || activeRuns.get(conversationId) !== runId) break;
          const wasIncomplete = incompleteContent.has(conversationId);
          let missing = missingCanonical.get(conversationId);
          if (!missing) { missing = new Set(); missingCanonical.set(conversationId, missing); }
          for (const key of succeededKeys) missing.delete(key);
          for (const key of failedKeys) missing.add(key);
          const incomplete = captureFailed || missing.size > 0;
          if (incomplete) incompleteContent.add(conversationId); else incompleteContent.delete(conversationId);
          if (wasIncomplete !== incomplete) {
            const current = conversations.get(conversationId);
            if (current) setConversation(conversationId, { ...current, revision: current.revision + 1 });
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
          if (runId && receipt?.kind === 'send' && dispatchedRuns.has(runId) &&
              (receipt.state === 'registered' || receipt.state === 'admitted' || receipt.state === 'upstream-unconfirmed') && matches(session, sessionID, conversationId) &&
              active && !active[sessionID] && userTime !== undefined &&
              session.time.busy !== undefined && session.time.idle !== undefined && userTime <= session.time.idle &&
              session.time.idle >= session.time.busy) {
            const assistantCorrelated = assistantTime && assistantTime.created >= userTime && assistantTime.created >= session.time.busy && assistantTime.completed <= session.time.idle;
            const terminal = session.outcome === 'interrupted' ? 'interrupted'
              : session.outcome === 'succeeded' && assistantCorrelated && assistantTime?.outcome === 'completed' ? 'completed'
              : session.outcome === 'failed' && assistantCorrelated && assistantTime?.outcome === 'failed' ? 'failed' : undefined;
            if (terminal) {
              updateSend(receipt, terminal);
              activeRuns.delete(conversationId);
              console.info('think_run_reconciled', { outcome: terminal });
            }
          }
          if (state.generation === generation) break;
        }
      } catch {
        console.info('think_reconciliation_outcome', { outcome: controller.signal.aborted ? 'aborted' : 'unavailable' });
      } finally {
        state.running = false;
        tasks.delete(controller);
        if (!closed && !identityChanged && monitor?.healthy && state.generation !== processedGeneration) requestRefresh(conversationId);
      }
    });
    tasks.set(controller, task);
  }

  function updateStop(receipt: StopReceipt, state: StopReceipt['state']): void {
    if (closed) return;
    commands.set(receipt.clientCommandId, { ...receipt, state });
    lifecycle({ ...receipt, state });
  }

  async function dispatchStop(receipt: StopReceipt, sendCommandId: string, controller: AbortController): Promise<void> {
    const send = commands.get(sendCommandId);
    if (!send || send.kind !== 'send') { updateStop(receipt, 'upstream-unconfirmed'); return; }
    if (!dispatchedRuns.has(receipt.runId)) {
      updateSend(send, 'cancelled-before-delivery');
      if (activeRuns.get(receipt.conversationId) === receipt.runId) activeRuns.delete(receipt.conversationId);
      updateStop(receipt, 'cancelled-before-delivery');
      return;
    }
    if (send.state !== 'admitted') { updateStop(receipt, 'upstream-unconfirmed'); return; }
    const sessionID = `ses_memoryloop_${receipt.conversationId.replaceAll('-', '')}`;
    const inboxID = `msg_memoryloop_${sendCommandId.replaceAll('-', '')}`;
    try {
      if (!await verifyIdentity(controller)) throw new Error('Native identity unavailable');
      const inbox = await nativeCall(controller, 'inbox-list', signal => native.listInbox({ sessionID }, signal));
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

  const service: ThinkService = {
    content: {
      async page(conversationId, cursor) {
        requireOpen();
        if (!uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
        const state = conversations.get(conversationId);
        if (!state) throw new ThinkServiceError('not_found');
        let start = 0;
        if (cursor) {
          const parts = cursor.split('.');
          if (parts.length !== 2 || parts[0].length > 256 || !/^[a-f0-9]{64}$/.test(parts[1])) throw new ThinkServiceError('invalid_request');
          const expected = createHmac('sha256', cursorKey).update(parts[0]).digest();
          if (!timingSafeEqual(expected, Buffer.from(parts[1], 'hex'))) throw new ThinkServiceError('invalid_request');
          let decoded: unknown;
          try { decoded = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new ThinkServiceError('invalid_request'); }
          if (!Array.isArray(decoded) || decoded.length !== 3 || decoded[0] !== conversationId || decoded[1] !== state.revision ||
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
          const encoded = Buffer.from(JSON.stringify([conversationId, state.revision, index])).toString('base64url');
          nextCursor = `${encoded}.${createHmac('sha256', cursorKey).update(encoded).digest('hex')}`;
        }
        return { conversationId, epoch, revision: state.revision, entries: page, contentHealth: incompleteContent.has(conversationId) ? 'incomplete' : 'complete', ...(nextCursor ? { nextCursor } : {}) };
      },
      async open(ref) {
        requireOpen();
        return trackTransfer(openPublishedBody(ref));
      },
    },
    async create(command) {
      requireOpen();
      if (!command || typeof command.conversationId !== 'string' || !uuid.test(command.conversationId) ||
          typeof command.clientCommandId !== 'string' || !uuid.test(command.clientCommandId)) {
        throw new ThinkServiceError('invalid_request');
      }
      const { conversationId, clientCommandId } = command;
      if (preparingReplies.has(clientCommandId)) throw new ThinkServiceError('command_conflict');
      const previous = commands.get(clientCommandId);
      if (previous) {
        if (previous.kind !== 'create' || previous.conversationId !== conversationId) throw new ThinkServiceError('command_conflict');
        return previous.state === 'rejected' ? { ...previous, failure: { ...previous.failure } } : { ...previous };
      }
      requireAvailable();
      await verifyBeforeCreate();
      const raced = commands.get(clientCommandId);
      if (raced) {
        if (raced.kind !== 'create' || raced.conversationId !== conversationId) throw new ThinkServiceError('command_conflict');
        return raced.state === 'rejected' ? { ...raced, failure: { ...raced.failure } } : { ...raced };
      }
      if (conversations.has(conversationId)) throw new ThinkServiceError('command_conflict');
      const receipt: CreateReceipt = { kind: 'create', conversationId, clientCommandId, epoch, state: 'registered' };
      const state: ConversationState = { conversationId, epoch, revision: 1, creation: 'registered' };
      commands.set(clientCommandId, receipt);
      setConversation(conversationId, state);
      lifecycle(receipt);
      sessionConversations.set(`ses_memoryloop_${conversationId.replaceAll('-', '')}`, conversationId);
      console.info('think_create_registered');
      const controller = new AbortController();
      const task = Promise.resolve().then(() => dispatch(receipt, controller)).finally(() => { tasks.delete(controller); });
      tasks.set(controller, task);
      return { ...receipt };
    },
    async send(command) {
      requireOpen();
      if (!command || typeof command.conversationId !== 'string' || !uuid.test(command.conversationId) ||
          typeof command.clientCommandId !== 'string' || !uuid.test(command.clientCommandId) ||
          typeof command.text !== 'string' || !command.text.trim() || Buffer.byteLength(command.text, 'utf8') > 1024 * 1024) throw new ThinkServiceError('invalid_request');
      const { conversationId, clientCommandId, text } = command;
      const digest = createHash('sha256').update(text, 'utf8').digest('hex');
      if (preparingReplies.has(clientCommandId)) throw new ThinkServiceError('command_conflict');
      const previous = commands.get(clientCommandId);
      if (previous) {
        if (previous.kind !== 'send' || previous.conversationId !== conversationId || sendDigests.get(clientCommandId) !== digest) throw new ThinkServiceError('command_conflict');
        return previous.failure ? { ...previous, failure: { ...previous.failure } } : { ...previous };
      }
      requireAvailable();
      const conversation = conversations.get(conversationId);
      if (!conversation) throw new ThinkServiceError('not_found');
      if (conversation.creation !== 'ready' || activeRuns.has(conversationId) || activeSessions.has(conversationId)) throw new ThinkServiceError('command_conflict');
      const runId = randomUUID();
      const receipt: SendReceipt = { kind: 'send', conversationId, clientCommandId, runId, epoch, state: 'registered' };
      commands.set(clientCommandId, receipt);
      lifecycle(receipt);
      sendDigests.set(clientCommandId, digest);
      runs.set(runId, { conversationId, sendCommandId: clientCommandId });
      activeRuns.set(conversationId, runId);
      console.info('think_send_registered');
      const controller = new AbortController();
      const task = Promise.resolve().then(() => dispatchSend(receipt, text, controller)).finally(() => { tasks.delete(controller); });
      tasks.set(controller, task);
      return { ...receipt };
    },
    async stop(command) {
      requireOpen();
      if (!command || typeof command.conversationId !== 'string' || !uuid.test(command.conversationId) ||
          typeof command.clientCommandId !== 'string' || !uuid.test(command.clientCommandId) ||
          typeof command.runId !== 'string' || !uuid.test(command.runId)) throw new ThinkServiceError('invalid_request');
      const { conversationId, clientCommandId, runId } = command;
      if (preparingReplies.has(clientCommandId)) throw new ThinkServiceError('command_conflict');
      const previous = commands.get(clientCommandId);
      if (previous) {
        if (previous.kind !== 'stop' || previous.conversationId !== conversationId || previous.runId !== runId) throw new ThinkServiceError('command_conflict');
        return { ...previous };
      }
      requireAvailable();
      const run = runs.get(runId);
      if (!run || run.conversationId !== conversationId) throw new ThinkServiceError('not_found');
      if (activeRuns.get(conversationId) !== runId) throw new ThinkServiceError('command_conflict');
      const receipt: StopReceipt = { kind: 'stop', conversationId, clientCommandId, runId, epoch, state: 'registered' };
      commands.set(clientCommandId, receipt);
      lifecycle(receipt);
      stoppedRuns.add(runId);
      console.info('think_stop_registered');
      const controller = new AbortController();
      const task = Promise.resolve().then(() => dispatchStop(receipt, run.sendCommandId, controller)).finally(() => { tasks.delete(controller); });
      tasks.set(controller, task);
      return { ...receipt };
    },
    async decisions(conversationId) {
      requireAvailable();
      const sessionID = ownedSession(conversationId);
      const forms = await ownedRead('form-list', signal => native.listForms({ sessionID }, signal));
      const decisions = forms.map(form => projectForm(form, conversationId, sessionID));
      if (Buffer.byteLength(JSON.stringify({ decisions })) > 48 * 1024) throw new ThinkServiceError('decision_unavailable');
      return decisions;
    },
    async decision(conversationId, decisionId) {
      requireAvailable();
      const sessionID = ownedSession(conversationId);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(decisionId)) throw new ThinkServiceError('invalid_request');
      const form = await ownedRead('form-get', signal => native.getForm({ sessionID, formID: decisionId }, signal));
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
      const entries = Object.entries(command.answer).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      if (entries.some(([key, value]) => !key || key.length > 512 || !(typeof value === 'string' || typeof value === 'boolean' ||
          typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(item => typeof item === 'string')))) throw new ThinkServiceError('invalid_request');
      const answer = Object.fromEntries(entries.map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]));
      const payload = JSON.stringify({ conversationId, decisionId, answer });
      if (Buffer.byteLength(payload) > 32768) throw new ThinkServiceError('invalid_request');
      const digest = createHash('sha256').update(payload, 'utf8').digest('hex');
      const previous = commands.get(clientCommandId);
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
      const sessionID = ownedSession(conversationId);
      const lock = `${conversationId}:${decisionId}`;
      if (formLocks.has(lock)) throw new ThinkServiceError('command_conflict');
      formLocks.add(lock);
      const result = (async (): Promise<FormReplyReceipt> => {
        try {
          const form = await ownedRead('form-get', signal => native.getForm({ sessionID, formID: decisionId }, signal));
          if (form.id !== decisionId || form.sessionID !== sessionID || form.state.status !== 'pending') throw new ThinkServiceError('command_conflict');
          projectForm(form, conversationId, sessionID);
          requireAvailable();
          const receipt: FormReplyReceipt = { kind: 'form-reply', conversationId, clientCommandId, decisionId, epoch, state: 'registered' };
          commands.set(clientCommandId, receipt);
          lifecycle(receipt);
          replyPayloads.set(clientCommandId, digest);
          const controller = new AbortController();
          const task = Promise.resolve().then(async () => {
            let state: FormReplyReceipt['state'] = 'upstream-unconfirmed';
            let captureFailed = false;
            try {
              try {
                const body = await bodies.replace({ conversationId, owner: { kind: 'form-reply', clientCommandId, decisionId } }, bodyBytes(JSON.stringify(answer)), 'canonical');
                if (controller.signal.aborted || closed) return;
                putEntry(conversationId, { kind: 'form-reply', clientCommandId, decisionId, body });
              } catch { captureFailed = true; state = 'rejected'; return; }
              if (!await verifyIdentity(controller)) throw new Error('Identity unavailable');
              const current = await nativeCall(controller, 'form-get', signal => native.getForm({ sessionID, formID: decisionId }, signal));
              if (current.id !== decisionId || current.sessionID !== sessionID || current.state.status !== 'pending') state = 'stale';
              else { await nativeCall(controller, 'form-reply', signal => native.replyForm({ sessionID, formID: decisionId, answer }, signal)); state = 'replied'; }
            } catch { /* A lost reply response is not proof of failure or acceptance. */ }
            finally {
              if (!closed) {
                const next: FormReplyReceipt = captureFailed ? { ...receipt, state, failure: { code: 'resource_failure' } } : { ...receipt, state };
                commands.set(clientCommandId, next); lifecycle(next);
              }
              formLocks.delete(lock);
              tasks.delete(controller);
            }
          });
          tasks.set(controller, task);
          console.info('think_form_reply_registered');
          return { ...receipt };
        } catch (error) { formLocks.delete(lock); throw error; }
      })();
      preparingReplies.set(clientCommandId, { payload, result });
      try { return await result; } finally { preparingReplies.delete(clientCommandId); }
    },
    async conversation(conversationId) {
      requireOpen();
      if (typeof conversationId !== 'string' || !uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
      const state = conversations.get(conversationId);
      return state ? { ...state } : null;
    },
    async snapshot(conversationId, cursor) {
      requireOpen();
      if (typeof conversationId !== 'string' || !uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
      const state = conversations.get(conversationId);
      if (!state) return null;
      const page = await service.content.page(conversationId, cursor);
      return { ...state, entries: page.entries, contentHealth: page.contentHealth, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
    },
    contentChunk(input) {
      requireOpen();
      return trackTransfer((async () => {
        if (!input || !uuid.test(input.conversationId) || !uuid.test(input.contentId) || !uuid.test(input.generation) ||
            !Number.isSafeInteger(input.through) || input.through < 0 || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > input.through ||
            (input.transfer !== undefined && !uuid.test(input.transfer)) || (input.transfer === undefined && input.offset !== 0)) throw new ThinkServiceError('invalid_request');
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
            if (closed) { await reader.close(); throw new ThinkServiceError('content_unavailable'); }
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
          if (closed) throw new Error('service closed');
          const nextOffset = input.offset + bytes.length;
          if (input.offset === transfer.next) { transfer.last = input.offset; transfer.next = nextOffset; }
          transfer.expires = clock.now() + transferIdleMs;
          return { conversationId: input.conversationId, epoch, contentId: input.contentId, generation: input.generation, through: input.through, offset: input.offset, bytes: Buffer.from(bytes).toString('base64'), nextOffset, transfer: nonce };
        } catch {
          transfers.delete(nonce);
          await transfer.reader.close().catch(() => {});
          throw new ThinkServiceError('content_unavailable');
        } finally { transfer.busy = false; }
      })());
    },
    async watch(conversationId) {
      requireOpen();
      if (typeof conversationId !== 'string' || !uuid.test(conversationId)) throw new ThinkServiceError('invalid_request');
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
      const receipt = commands.get(clientCommandId);
      return receipt?.conversationId === conversationId ? copyReceipt(receipt) : null;
    },
    async close() {
      if (!closing) {
        closed = true;
        for (const listeners of watchers.values()) for (const notify of listeners) notify(null);
        clearInterval(refreshTimer);
        console.info('think_service_closed');
        const pending = [...tasks.entries()];
        const ownedMonitor = monitor;
        ownedMonitor?.controller.abort();
        for (const [controller] of pending) controller.abort();
        closing = Promise.all([...pending.map(([, task]) => task), ...(ownedMonitor ? [ownedMonitor.task] : [])]).then(async () => {
          await Promise.allSettled([...transferWork]);
          await Promise.all([...transfers.values()].map(transfer => transfer.reader.close()));
          transfers.clear();
          await bodies.close();
        });
      }
      await closing;
    },
  };
  return service;
}

export type { CommandReceipt, ConversationState, CreateConversationCommand, CreateReceipt, SendCommand, SendReceipt, StopCommand, StopReceipt, ThinkUnavailableCode } from './contract';
