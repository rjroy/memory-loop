import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventSubscribeInput, OpenCodeEvent, SessionCreateInput, SessionGetInput, SessionPromptInput, SessionPromptOutput } from '@opencode/client';
import type { SessionInboxListInput, SessionInboxListOutput, SessionInboxCancelInput, SessionInterruptInput, SessionInterruptOutput } from '@opencode/client';
import type { MessageListInput, MessageListOutput, ServerInfo, SessionActiveOutput, SessionInfo, SessionMessageGetInput, SessionMessageGetOutput } from '@opencode/client';
import type { SessionFormListInput, SessionFormListOutput, SessionFormGetInput, SessionFormGetOutput, SessionFormReplyInput, SessionFormReplyOutput } from '@opencode/client';
import type { PermissionReplyInput, PermissionRequestListInput, PermissionRequestListOutput } from '@opencode/client';
import { createThinkService, type ThinkServiceOptions } from './think/service';
import { createApp, type AppOptions } from './app';
import type { NativeSession, NativeSessions } from './think/native';
import { createBodyStore, type BodyKey, type BodyRef, type BodyStore } from './think/body-store';
import { constants } from 'node:fs';
import { transcriptIO, type TranscriptIO } from './think/transcript-file';
import type { TranscriptRuntime } from './think/transcript';
import { parseThinkConfig } from './think/config';
import { ThinkStateError, type RegisteredConversation, type StoredCommand, type ThinkStateStore } from './think/state';
import type { CommandReceipt } from './think/contract';

const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const vaultDirectory = '/fixture/canonical-vault';
const agent = 'fixture-agent';
const model = { providerID: 'fixture-provider', id: 'fixture-model' };
const a = { conversationId: '11111111-1111-4111-8111-111111111111', clientCommandId: '22222222-2222-4222-8222-222222222222' };
const b = { conversationId: '33333333-3333-4333-8333-333333333333', clientCommandId: '44444444-4444-4444-8444-444444444444' };
const sessionId = (id: string) => `ses_memoryloop_${id.replaceAll('-', '')}`;
const permissions = [{ action: '*', resource: '*', effect: 'allow' }] as const;

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('uninitialized deferred'); };
  let reject: (error: Error) => void = () => { throw new Error('uninitialized deferred'); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Admission/hydration units mock this derivative boundary; real SQLite behavior has its own fixture. */
function conversationStateSpies() {
  const unexpected = () => { throw new Error('Unexpected recent/view operation in this controlled unit'); };
  return {
    canonical: vi.fn<ThinkStateStore['conversations']['canonical']>(),
    recent: vi.fn<ThinkStateStore['conversations']['recent']>(unexpected),
    mintView: vi.fn<ThinkStateStore['conversations']['mintView']>(unexpected),
    view: vi.fn<ThinkStateStore['conversations']['view']>(unexpected),
    select: vi.fn<ThinkStateStore['conversations']['select']>(unexpected),
    protection: vi.fn<ThinkStateStore['conversations']['protection']>(unexpected),
  } satisfies ThinkStateStore['conversations'];
}

/** These admission-only units never accept or recover a deletion. */
function deletionStateSpies() {
  const unexpected = () => { throw new Error('Unexpected deletion/cache operation in this controlled unit'); };
  const deletions: ThinkStateStore['deletions'] = {
    get: vi.fn(unexpected), pending: vi.fn(unexpected), blocked: vi.fn(() => false), accept: vi.fn(unexpected),
    attempted: vi.fn(unexpected), progress: vi.fn(unexpected), pendingReason: vi.fn(unexpected), complete: vi.fn(unexpected),
  };
  const cache: ThinkStateStore['cache'] = { intent: vi.fn(unexpected), acquire: vi.fn(unexpected), namespaces: vi.fn(unexpected), removed: vi.fn(unexpected) };
  return { deletions, cache };
}

function unitBodies(): BodyStore {
  const data = new Map<string, Buffer>();
  let generation = 0;
  async function collect(source: AsyncIterable<Uint8Array>) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  return {
    async replace(key, source, kind) {
      const bytes = await collect(source);
      const id = `fixture-body-${++generation}`;
      data.set(id, bytes);
      const base = { key, epoch, contentId: id, generation: id, through: bytes.length };
      return kind === 'canonical' ? { ...base, kind, sha256: createHash('sha256').update(bytes).digest('hex') } : { ...base, kind };
    },
    async append(ref, source) {
      const before = data.get(ref.contentId);
      if (!before) throw new Error('fixture body missing');
      const bytes = Buffer.concat([before, await collect(source)]);
      data.set(ref.contentId, bytes);
      return { ...ref, through: bytes.length };
    },
    async open(ref) {
      const bytes = data.get(ref.contentId);
      if (!bytes) throw new Error('fixture body missing');
      return { async read(offset, length) { return bytes.subarray(offset, offset + length); }, async close() {} };
    },
    async evict() { return 'protected'; },
    async restore() { throw new Error('unexpected fixture restore'); },
    bind() {},
    revoke() { throw new Error('unexpected fixture revoke'); },
    async purge() { throw new Error('unexpected fixture purge'); },
    async close() { data.clear(); },
  };
}

function setup(selectedModel: ThinkServiceOptions['context']['model'] = model, bodies?: BodyStore, directory = vaultDirectory,
  serviceOptions?: Pick<ThinkServiceOptions, 'clock' | 'transferIdleMs' | 'state'>, transcript?: ThinkServiceOptions['transcript']) {
  const calls: Array<{ input: SessionCreateInput; signal: AbortSignal; result: ReturnType<typeof deferred<NativeSession>> }> = [];
  const prompts: Array<{ input: SessionPromptInput; signal: AbortSignal; result: ReturnType<typeof deferred<SessionPromptOutput>> }> = [];
  const cancels: Array<{ input: SessionInboxCancelInput; result: ReturnType<typeof deferred<void>> }> = [];
  const inbox: SessionInboxListOutput = [];
  const pendingPermissions: PermissionRequestListOutput['data'] = [];
  let form: SessionFormGetOutput = { id: 'form_fixture_question', sessionID: sessionId(a.conversationId), title: 'Fixture question',
    fields: [{ key: 'answer', type: 'string', title: 'Answer', required: true }], state: { status: 'pending' }, metadata: { privateFixture: 'do-not-expose' } };
  const messages: MessageListOutput['data'] = [];
  const active: SessionActiveOutput = {};
  let outcome: SessionInfo['outcome'];
  let time: SessionInfo['time'] = { created: 1, updated: 1 };
  const events: OpenCodeEvent[] = [];
  let streamEnd: 'eof' | 'error' | undefined;
  let serverInfo: ServerInfo = { pid: 49123, version: '2.2.2', urls: [], paths: { tmp: '/fixture/tmp' } };
  let wake: (() => void) | undefined;
  const order: string[] = [];
  const sessions = new Map<string, NativeSession>();
  const createSession = vi.fn((input: SessionCreateInput, signal: AbortSignal) => {
    const result = deferred<NativeSession>();
    signal.addEventListener('abort', () => result.reject(new Error('owned call aborted')), { once: true });
    calls.push({ input, signal, result });
    return result.promise;
  });
  const getSession = vi.fn(async (input: SessionGetInput, _signal: AbortSignal): Promise<NativeSession & Pick<SessionInfo, 'time' | 'outcome'>> => {
    const found = sessions.get(input.sessionID);
    if (!found) throw new Error('fixture session absent');
    return { ...found, time, ...(outcome === undefined ? {} : { outcome }) };
  });
  const subscribe = vi.fn((_input: EventSubscribeInput, signal: AbortSignal): AsyncIterable<OpenCodeEvent> => ({
    async *[Symbol.asyncIterator]() {
      order.push('monitor');
      order.push('monitor-connected');
      yield { id: 'evt_fixture_connected', type: 'server.connected', data: {} };
      while (!signal.aborted) {
        if (streamEnd) {
          const ended = streamEnd;
          streamEnd = undefined;
          if (ended === 'error') throw new Error('fixture stream failure');
          return;
        }
        const event = events.shift();
        if (event) { yield event; continue; }
        await new Promise<void>(resolve => {
          const finish = () => { signal.removeEventListener('abort', finish); resolve(); };
          wake = finish;
          signal.addEventListener('abort', finish, { once: true });
        });
      }
    },
  }));
  const prompt = vi.fn((input: SessionPromptInput, signal: AbortSignal) => {
    order.push('prompt');
    const result = deferred<SessionPromptOutput>();
    signal.addEventListener('abort', () => result.reject(new Error('owned prompt call aborted')), { once: true });
    prompts.push({ input, signal, result });
    return result.promise;
  });
  const listInbox = vi.fn(async (_input: SessionInboxListInput, _signal: AbortSignal): Promise<SessionInboxListOutput> => inbox);
  const cancelInbox = vi.fn((input: SessionInboxCancelInput, signal: AbortSignal): Promise<void> => {
    order.push('cancel');
    const result = deferred<void>();
    signal.addEventListener('abort', () => result.reject(new Error('owned cancel aborted')), { once: true });
    cancels.push({ input, result });
    return result.promise;
  });
  const interruptSession = vi.fn(async (_input: SessionInterruptInput, _signal: AbortSignal): Promise<SessionInterruptOutput> => {
    order.push('interrupt');
    return { interrupted: false };
  });
  const activeSessions = vi.fn(async (_signal: AbortSignal): Promise<SessionActiveOutput> => { order.push('active'); return { ...active }; });
  const listMessages = vi.fn(async (_input: MessageListInput, _signal: AbortSignal): Promise<MessageListOutput> => { order.push('history'); return { data: [...messages], cursor: {} }; });
  const getMessage = vi.fn(async (input: SessionMessageGetInput, _signal: AbortSignal): Promise<SessionMessageGetOutput> => {
    const found = messages.find(message => message.id === input.messageID);
    if (!found) throw new Error('fixture message missing');
    return found;
  });
  const getServerInfo = vi.fn(async (_signal: AbortSignal): Promise<ServerInfo> => ({ ...serverInfo }));
  const listForms = vi.fn(async (input: SessionFormListInput, _signal: AbortSignal): Promise<SessionFormListOutput> =>
    input.sessionID === form.sessionID && form.state.status === 'pending' ? [form] : []);
  const getForm = vi.fn(async (input: SessionFormGetInput, _signal: AbortSignal): Promise<SessionFormGetOutput> => {
    if (input.sessionID !== form.sessionID || input.formID !== form.id) throw new Error('fixture form unavailable');
    return form;
  });
  const replyForm = vi.fn(async (_input: SessionFormReplyInput, _signal: AbortSignal): Promise<SessionFormReplyOutput> => {});
  const listPermissionRequests = vi.fn(async (_input: PermissionRequestListInput, _signal: AbortSignal): Promise<PermissionRequestListOutput> => ({ location: { directory }, data: [...pendingPermissions] }));
  const replyPermission = vi.fn(async (_input: PermissionReplyInput, _signal: AbortSignal): Promise<void> => {});
  const listSessions = vi.fn<NativeSessions['listSessions']>(async () => { throw new Error('unexpected fixture child scan'); });
  const removeSession = vi.fn<NativeSessions['removeSession']>(async () => { throw new Error('unexpected fixture removal'); });
  const native = { createSession, getSession, listSessions, removeSession, subscribe, prompt, listInbox, cancelInbox, interruptSession, activeSessions, listMessages, getMessage, getServerInfo, listForms, getForm, replyForm, listPermissionRequests, replyPermission } satisfies NativeSessions & { replyPermission(input: PermissionReplyInput, signal: AbortSignal): Promise<void> };
  const options = { native, context: { directory, agent, model: selectedModel }, epoch,
    serviceIdentity: { pid: 49123, version: '2.2.2' }, bodies: bodies ?? unitBodies(), ...serviceOptions, ...(transcript ? { transcript } : {}) } satisfies ThinkServiceOptions;
  const service = createThinkService(options);
  function complete(index: number, changes: Partial<NativeSession> = {}) {
    const call = calls[index];
    if (!call || !call.input.id || !call.input.metadata) throw new Error('fixture expected a created session with metadata');
    const session: NativeSession = {
      id: call.input.id,
      metadata: call.input.metadata,
      location: { directory },
      permissions: permissions.map(rule => ({ ...rule })),
      agent,
      ...(selectedModel ? { model: selectedModel } : {}),
    };
    sessions.set(session.id, { ...session, ...changes });
    call.result.resolve(session);
  }
  const setStatus = (next: { outcome?: SessionInfo['outcome']; time: SessionInfo['time'] }) => { outcome = next.outcome; time = next.time; };
  const emit = (event: OpenCodeEvent) => { events.push(event); wake?.(); wake = undefined; };
  const endStream = (reason: 'eof' | 'error') => { streamEnd = reason; wake?.(); wake = undefined; };
  const setServerInfo = (info: ServerInfo) => { serverInfo = info; };
  const setForm = (next: SessionFormGetOutput) => { form = next; };
  return { service, createSession, getSession, calls, sessions, complete, subscribe, prompt, prompts, order, listInbox, cancelInbox, cancels, interruptSession, inbox, activeSessions, listMessages, getMessage, active, messages, setStatus, emit, endStream, getServerInfo, setServerInfo, listForms, getForm, replyForm, setForm, form: () => form, listPermissionRequests, pendingPermissions, replyPermission };
}

async function waitForCalls(calls: unknown[], count: number) {
  await vi.waitFor(() => expect(calls).toHaveLength(count));
}

async function authenticatedSnapshot(f: ReturnType<typeof setup>) {
  const token = 'a'.repeat(64);
  const app = createApp({ authority: '127.0.0.1:3000', serviceToken: token, think: f.service,
    vault: { reader: { tree: async () => ({ rootIdentity: 'root', entries: [] }), action: async () => ({ id: ['fixture'] }), file: async () => ({ name: 'fixture', kind: 'unsupported' as const }), content: async () => new Response(null, { status: 404 }), note: async () => ({ name: 'fixture', markdown: '', revision: 'fixture-revision', editable: true }), save: async () => ({ revision: 'fixture-revision' }), close: async () => {} } } });
  const response = await app(new Request(`http://127.0.0.1:3000/api/think/conversations/${a.conversationId}`, { headers: { host: '127.0.0.1:3000', authorization: `Bearer ${token}` } }));
  expect(response.status).toBe(200);
  return await response.json() as Record<string, unknown>;
}

describe('Phase 3 authenticated snapshot and watch', () => {
  const authority = '127.0.0.1:3000';
  const token = 'a'.repeat(64);
  const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: `fixture original ${'x'.repeat(70 * 1024)}` };
  async function readyFixture(watchPolicy?: { leaseMs: number; heartbeatMs: number }, leaseOptions?: { clock: { now(): number }; transferIdleMs: number }, bodies?: BodyStore, directory = vaultDirectory) {
    const f = setup(model, bodies, directory, leaseOptions);
    await f.service.create(a);
    await waitForCalls(f.calls, 1);
    f.complete(0);
    await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
    const receipt = await f.service.send(send);
    await waitForCalls(f.prompts, 1);
    await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'original', clientCommandId: send.clientCommandId })));
    const appOptions = { authority, serviceToken: token, think: f.service,
      vault: { reader: { tree: async () => ({ rootIdentity: 'root', entries: [] }), action: async () => ({ id: ['fixture'] }), file: async () => ({ name: 'fixture', kind: 'unsupported' as const }), content: async () => new Response(null, { status: 404 }), note: async () => ({ name: 'fixture', markdown: '', revision: 'fixture-revision', editable: true }), save: async () => ({ revision: 'fixture-revision' }), close: async () => {} } },
      ...(watchPolicy ? { watchPolicy } : {}) } satisfies AppOptions & { watchPolicy?: { leaseMs: number; heartbeatMs: number } };
    const app = createApp(appOptions);
    const base = `/api/think/conversations/${a.conversationId}`;
    const request = (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (!headers.has('host')) headers.set('host', authority);
      if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
      return app(new Request(`http://${authority}${path}`, { ...init, headers }));
    };
    return { f, receipt, base, request };
  }

  it('returns a bounded authoritative snapshot with stable body references, not inline user bytes', async () => {
    const { f, base, request } = await readyFixture();
    try {
      const response = await request(base);
      expect(response.status).toBe(200);
      const value: unknown = await response.json();
      expect(value).toMatchObject({ conversationId: a.conversationId, epoch, revision: expect.any(Number), entries: expect.arrayContaining([expect.objectContaining({ kind: 'original', clientCommandId: send.clientCommandId, body: expect.objectContaining({ epoch, generation: expect.any(String), through: Buffer.byteLength(send.text) }) })]) });
      expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(64 * 1024);
      expect(JSON.stringify(value)).not.toContain(send.text);
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  });

  it('pages hundreds of parts from one native message without losing ordinal identity', async () => {
    const { f } = await readyFixture();
    try {
      const sid = sessionId(a.conversationId);
      const messageId = 'msg_fixture_many_parts';
      f.messages.push({ id: messageId, type: 'assistant', agent, model, finish: 'stop', time: { created: 20, completed: 21 },
        content: Array.from({ length: 350 }, (_, index) => ({ type: 'text' as const, text: `fixture-part-${index}` })) });
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_many_parts', created: 22,
        durable: { aggregateID: sid, seq: 1, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).nextCursor).toEqual(expect.any(String)));
      const ordinals: number[] = [];
      let cursor: string | undefined;
      const cursors = new Set<string>();
      let pageCount = 0;
      do {
        const page = await f.service.content.page(a.conversationId, cursor);
        expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(64 * 1024);
        expect(JSON.stringify(page)).not.toContain('fixture-part-');
        for (const entry of page.entries) if (entry.kind === 'assistant-text' && entry.messageId === messageId) ordinals.push(entry.ordinal);
        cursor = page.nextCursor;
        if (cursor) { expect(cursors.has(cursor)).toBe(false); cursors.add(cursor); }
        pageCount++;
      } while (cursor);
      expect(pageCount).toBeGreaterThan(1);
      expect(ordinals).toEqual(Array.from({ length: 350 }, (_, index) => index));
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  });

  it('delivers snapshot first, follows newer revisions, and reconnects without cancelling or resending', async () => {
    const { f, base, request } = await readyFixture();
    const controllers: AbortController[] = [];
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    async function open(lastEventId?: string) {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await request(`${base}/events`, { signal: controller.signal, headers: lastEventId ? { 'last-event-id': lastEventId } : {} });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^text\/event-stream(?:;|$)/i);
      expect(response.headers.get('cache-control')).toMatch(/no-store|no-cache/);
      if (!response.body) throw new Error('watch response has no stream');
      const reader = response.body.getReader();
      readers.push(reader);
      let buffer = '';
      const decoder = new TextDecoder();
      const frame = async () => {
        for (;;) {
          const boundary = /\r?\n\r?\n/.exec(buffer);
          if (boundary && boundary.index !== undefined) {
            const raw = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            if (!raw.includes('data:')) continue;
            expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(64 * 1024);
            const type = /^event:\s*(.+)$/m.exec(raw)?.[1];
            const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            const value: unknown = JSON.parse(data);
            return { type, value };
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const chunk = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('fixture watch frame timed out')), 3000); })]);
            if (chunk.done) throw new Error('fixture watch ended unexpectedly');
            buffer += decoder.decode(chunk.value, { stream: true });
            expect(Buffer.byteLength(buffer)).toBeLessThanOrEqual(64 * 1024 + 4096);
          } finally { if (timer) clearTimeout(timer); }
        }
      };
      return { frame, controller };
    }
    try {
      const watch = await open();
      const first = await watch.frame();
      expect(first.type).toBe('snapshot');
      expect(first.value).toMatchObject({ conversationId: a.conversationId, epoch, revision: expect.any(Number), entries: expect.arrayContaining([expect.objectContaining({ kind: 'original', clientCommandId: send.clientCommandId })]) });
      expect(JSON.stringify(first.value)).not.toContain(send.text);
      if (!first.value || typeof first.value !== 'object' || !('revision' in first.value) || typeof first.value.revision !== 'number') throw new Error('invalid snapshot revision');
      const revision = first.value.revision;
      const page = await f.service.content.page(a.conversationId);
      const original = page.entries.find(entry => entry.kind === 'original' && entry.clientCommandId === send.clientCommandId);
      if (!original || original.kind !== 'original') throw new Error('fixture original missing');
      const sid = sessionId(a.conversationId);
      f.emit({ type: 'session.text.started', id: 'evt_fixture_watch', created: 20,
        durable: { aggregateID: sid, seq: 1, version: 1 }, data: { sessionID: sid, assistantMessageID: 'msg_fixture_watch', ordinal: 0 } });
      const update = await watch.frame();
      expect(update.value).toMatchObject({ conversationId: a.conversationId, epoch, revision: expect.any(Number) });
      if (!update.value || typeof update.value !== 'object' || !('revision' in update.value) || typeof update.value.revision !== 'number') throw new Error('invalid update revision');
      expect(update.value.revision).toBeGreaterThan(revision);
      watch.controller.abort();
      expect(f.prompts[0]?.signal.aborted).toBe(false);
      expect(f.interruptSession).not.toHaveBeenCalled();
      const reopened = await open('obsolete-event-id');
      const fresh = await reopened.frame();
      expect(fresh.type).toBe('snapshot');
      expect(fresh.value).toMatchObject({ conversationId: a.conversationId, epoch, entries: expect.arrayContaining([expect.objectContaining({ kind: 'original', clientCommandId: send.clientCommandId, body: original.body })]) });
      expect(f.prompt).toHaveBeenCalledOnce();
      expect(f.prompts[0]?.signal.aborted).toBe(false);
    } finally {
      for (const controller of controllers) controller.abort();
      for (const reader of readers) void reader.cancel().catch(() => {});
      await f.service.close();
    }
  });

  it('leases only the watch and preserves a progressing transfer across authenticated reconnection', async () => {
    let now = 0;
    const root = await mkdtemp('/tmp/opencode/think-watch-lease-test-');
    const vault = join(root, 'vault');
    await mkdir(vault, { mode: 0o700 });
    let bodies: BodyStore;
    try { bodies = await createBodyStore({ directory: join(root, 'bodies'), vaultDirectory: vault, epoch }); }
    catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
    let ready: Awaited<ReturnType<typeof readyFixture>>;
    try { ready = await readyFixture({ leaseMs: 300, heartbeatMs: 1000 }, { clock: { now: () => now }, transferIdleMs: 400 }, bodies, vault); }
    catch (error) { try { await bodies.close(); } finally { await rm(root, { recursive: true, force: true }); } throw error; }
    const { f, base, request } = ready;
    const firstAbort = new AbortController();
    const secondAbort = new AbortController();
    let firstReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let secondReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    vi.useFakeTimers();
    try {
      const original = (await f.service.content.page(a.conversationId)).entries.find(entry => entry.kind === 'original' && entry.clientCommandId === send.clientCommandId);
      if (!original || original.kind !== 'original') throw new Error('fixture original missing');
      const ref = original.body;
      const watch = await request(`${base}/events`, { signal: firstAbort.signal });
      expect(watch.status).toBe(200);
      if (!watch.body) throw new Error('fixture watch missing body');
      firstReader = watch.body.getReader();
      const first = await firstReader.read();
      expect(first.done).toBe(false);
      expect(new TextDecoder().decode(first.value)).toContain(ref.generation);
      let ended = false;
      const firstStream = firstReader;
      const drain = (async () => { while (!(await firstStream.read()).done) {} ended = true; })();
      void drain.catch(() => {});
      const path = (offset: number, transfer?: string) => `${base}/content/${encodeURIComponent(ref.contentId)}?${new URLSearchParams({ generation: ref.generation, through: String(ref.through), offset: String(offset), ...(transfer ? { transfer } : {}) })}`;
      async function read(offset: number, transfer?: string) {
        const response = await request(path(offset, transfer));
        if (response.status !== 200) {
          const diagnostic: unknown = await response.clone().json();
          expect(response.status, `fixture chunk error: ${JSON.stringify(diagnostic)}`).toBe(200);
        }
        const value: unknown = await response.json();
        if (!value || typeof value !== 'object' || !('transfer' in value) || typeof value.transfer !== 'string' || !('nextOffset' in value) || typeof value.nextOffset !== 'number') throw new Error('invalid fixture chunk');
        return { transfer: value.transfer, nextOffset: value.nextOffset };
      }
      const initial = await read(0);
      expect(initial.nextOffset).toBeGreaterThan(0);
      expect(initial.nextOffset).toBeLessThan(ref.through);
      now += 200;
      await vi.advanceTimersByTimeAsync(200);
      await read(0, initial.transfer); // A retry renews the transfer's idle lease.
      now += 101;
      await vi.advanceTimersByTimeAsync(101);
      expect(ended).toBe(true);
      const watchCalls = vi.spyOn(f.service, 'watch');
      const contentOpen = vi.spyOn(f.service.content, 'open');
      expect((await request(`${base}/events`, { headers: { authorization: `Bearer ${'b'.repeat(64)}` } })).status).toBe(401);
      expect(watchCalls).not.toHaveBeenCalled();
      expect(contentOpen).not.toHaveBeenCalled();
      const later = await read(initial.nextOffset, initial.transfer);
      expect(later.nextOffset).toBe(ref.through);
      const reopened = await request(`${base}/events`, { signal: secondAbort.signal });
      expect(reopened.status).toBe(200);
      if (!reopened.body) throw new Error('reconnected fixture watch missing body');
      secondReader = reopened.body.getReader();
      const snapshot = await secondReader.read();
      expect(snapshot.done).toBe(false);
      expect(new TextDecoder().decode(snapshot.value)).toContain(ref.generation);
      expect(f.prompt).toHaveBeenCalledOnce();
      expect(f.prompts[0]?.signal.aborted).toBe(false);
      expect(f.interruptSession).not.toHaveBeenCalled();
    } finally {
      firstAbort.abort(); secondAbort.abort();
      if (firstReader) void firstReader.cancel().catch(() => {});
      if (secondReader) void secondReader.cancel().catch(() => {});
      vi.useRealTimers();
      try { await f.service.close(); } finally { await rm(root, { recursive: true, force: true }); }
    }
  });

  it.each<Record<string, string>>([{ host: 'evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { authorization: `Bearer ${'b'.repeat(64)}` }])('denies watch before any protected native work %o', async headers => {
    const { f, base, request } = await readyFixture();
    try {
      const before = { subscribe: f.subscribe.mock.calls.length, prompt: f.prompt.mock.calls.length, history: f.listMessages.mock.calls.length };
      const response = await request(`${base}/events`, { headers });
      expect([401, 403]).toContain(response.status);
      expect(f.subscribe.mock.calls.length).toBe(before.subscribe);
      expect(f.prompt.mock.calls.length).toBe(before.prompt);
      expect(f.listMessages.mock.calls.length).toBe(before.history);
    } finally { await f.service.close(); }
  });
});

describe('Phase 3 authenticated content transfer', () => {
  const authority = '127.0.0.1:3000';
  const token = 'a'.repeat(64);
  async function fixture(text: string) {
    const root = await mkdtemp('/tmp/opencode/think-transfer-test-');
    const vault = join(root, 'vault');
    await mkdir(vault, { mode: 0o700 });
    const bodies = await createBodyStore({ directory: join(root, 'bodies'), vaultDirectory: vault, epoch });
    let now = 0;
    const f = setup(model, bodies, vault, { clock: { now: () => now }, transferIdleMs: 100 });
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text };
      await f.service.send(send); await waitForCalls(f.prompts, 1);
      const page = await f.service.content.page(a.conversationId);
      const original = page.entries.find(entry => entry.kind === 'original' && entry.clientCommandId === send.clientCommandId);
      if (!original || original.kind !== 'original') throw new Error('fixture original missing');
      const app = createApp({ authority, serviceToken: token, think: f.service,
        vault: { reader: { tree: async () => ({ rootIdentity: 'root', entries: [] }), action: async () => ({ id: ['fixture'] }), file: async () => ({ name: 'fixture', kind: 'unsupported' as const }), content: async () => new Response(null, { status: 404 }), note: async () => ({ name: 'fixture', markdown: '', revision: 'fixture-revision', editable: true }), save: async () => ({ revision: 'fixture-revision' }), close: async () => {} } } });
      const base = `/api/think/conversations/${a.conversationId}`;
      const request = (path: string, init: RequestInit = {}) => {
        const headers = new Headers(init.headers);
        if (!headers.has('host')) headers.set('host', authority);
        if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
        return app(new Request(`http://${authority}${path}`, { ...init, headers }));
      };
      const path = (ref: BodyRef, offset: number, transfer?: string, conversationId = a.conversationId) => {
        const query = new URLSearchParams({ generation: ref.generation, through: String(ref.through), offset: String(offset), ...(transfer === undefined ? {} : { transfer }) });
        return `/api/think/conversations/${conversationId}/content/${encodeURIComponent(ref.contentId)}?${query}`;
      };
      return { f, bodies, root, ref: original.body, request, path, base, advance(ms: number) { now += ms; },
        async close() { try { await f.service.close(); } finally { await rm(root, { recursive: true, force: true }); } } };
    } catch (error) {
      try { await f.service.close(); } finally { await rm(root, { recursive: true, force: true }); }
      throw error;
    }
  }
  async function chunk(response: Response, ref: BodyRef, offset: number) {
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toMatch(/no-store/);
    const raw = await response.text();
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(128 * 1024);
    const value: unknown = JSON.parse(raw);
    expect(value).toMatchObject({ conversationId: a.conversationId, epoch, contentId: ref.contentId, generation: ref.generation, through: ref.through, offset,
      bytes: expect.any(String), nextOffset: expect.any(Number), transfer: expect.any(String) });
    if (!value || typeof value !== 'object' || !('bytes' in value) || typeof value.bytes !== 'string' || !('nextOffset' in value) || typeof value.nextOffset !== 'number' || !('transfer' in value) || typeof value.transfer !== 'string') throw new Error('invalid fixture chunk');
    const data = Buffer.from(value.bytes, 'base64');
    expect(data.toString('base64')).toBe(value.bytes);
    expect(data.length).toBeLessThanOrEqual(64 * 1024);
    expect(value.nextOffset).toBe(offset + data.length);
    expect(value.nextOffset).toBeLessThanOrEqual(ref.through);
    if (offset < ref.through) expect(value.nextOffset).toBeGreaterThan(offset);
    return { data, nextOffset: value.nextOffset, transfer: value.transfer };
  }
  async function contentError(response: Response) {
    expect(response.status).toBeGreaterThanOrEqual(400);
    const value: unknown = await response.json();
    expect(value).toMatchObject({ error: { code: expect.stringMatching(/content|transfer|range|stale|invalid/i) } });
  }

  async function filesIn(path: string): Promise<number> {
    let count = 0;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) count += await filesIn(join(path, entry.name));
      else if (entry.isFile()) count++;
    }
    return count;
  }

  async function reclaimedFixture() {
    const x = await fixture('fixture original remains protected');
    try {
      const messageId = 'msg_fixture_reclaim';
      const text = 'canonical fixture 🧠';
      const message: SessionMessageGetOutput = { id: messageId, type: 'assistant', agent, model, finish: 'stop',
        time: { created: 22, completed: 23 }, content: [{ type: 'text', text }] };
      x.f.messages.push(message);
      const sid = sessionId(a.conversationId);
      x.f.emit({ type: 'session.execution.started', id: 'evt_fixture_reclaim', created: 24,
        durable: { aggregateID: sid, seq: 3, version: 1 }, data: { sessionID: sid } });
      let ref: BodyRef | undefined;
      await vi.waitFor(async () => {
        const entry = (await x.f.service.content.page(a.conversationId)).entries.find(item => item.kind === 'assistant-text' && item.messageId === messageId);
        expect(entry).toMatchObject({ kind: 'assistant-text', body: { kind: 'canonical' }, ordinal: 0 });
        if (entry?.kind === 'assistant-text') ref = entry.body;
      });
      if (!ref) throw new Error('fixture canonical missing');
      const resident = await filesIn(join(x.root, 'bodies'));
      expect(resident).toBeGreaterThanOrEqual(2);
      x.advance(1000);
      await vi.advanceTimersByTimeAsync(6000);
      await vi.waitFor(async () => expect(await filesIn(join(x.root, 'bodies'))).toBeLessThan(resident));
      expect(x.f.getMessage).not.toHaveBeenCalled();
      const snapshot = await x.f.service.snapshot(a.conversationId);
      expect(snapshot?.entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId, body: ref }));
      expect(x.f.getMessage).not.toHaveBeenCalled();
      return { ...x, canonical: ref, message, text, sid };
    } catch (error) { await x.close(); throw error; }
  }

  it('reclaims verified canonical bytes on maintenance and coalesces concurrent rehydration with independent readers', async () => {
    vi.useFakeTimers();
    let x: Awaited<ReturnType<typeof reclaimedFixture>> | undefined;
    const readback = deferred<SessionMessageGetOutput>();
    try {
      x = await reclaimedFixture();
      x.f.getMessage.mockImplementationOnce(() => readback.promise);
      const first = x.request(x.path(x.canonical, 0));
      const second = x.request(x.path(x.canonical, 0));
      await vi.waitFor(() => expect(x?.f.getMessage).toHaveBeenCalledOnce());
      expect(x.f.getMessage).toHaveBeenCalledWith({ sessionID: x.sid, messageID: x.message.id }, expect.any(AbortSignal));
      readback.resolve(x.message);
      const [one, two] = await Promise.all([first, second]);
      const left = await chunk(one, x.canonical, 0);
      const right = await chunk(two, x.canonical, 0);
      expect(left.data.toString('utf8')).toBe(x.text);
      expect(right.data.toString('utf8')).toBe(x.text);
      expect(left.transfer).not.toBe(right.transfer);
      expect(x.f.getMessage).toHaveBeenCalledOnce();
      expect(x.f.prompt).toHaveBeenCalledOnce();
    } finally { readback.resolve({ id: 'msg_fixture_cleanup', type: 'user', text: '', time: { created: 1 } }); try { await x?.close(); } finally { vi.useRealTimers(); } }
  }, 15000);

  it('retires an expired transfer pin on maintenance without a subsequent request', async () => {
    vi.useFakeTimers();
    let x: Awaited<ReturnType<typeof fixture>> | undefined;
    try {
      x = await fixture('fixture original');
      const originalOpen = x.bodies.open.bind(x.bodies);
      let closed = 0;
      vi.spyOn(x.bodies, 'open').mockImplementation(async ref => {
        const reader = await originalOpen(ref);
        return { read: (offset, length) => reader.read(offset, length), async close() { closed++; await reader.close(); } };
      });
      await chunk(await x.request(x.path(x.ref, 0)), x.ref, 0);
      expect(closed).toBe(0);
      x.advance(101);
      await vi.advanceTimersByTimeAsync(6000);
      expect(closed).toBe(1);
      expect(x.f.prompt).toHaveBeenCalledOnce();
      expect(x.f.interruptSession).not.toHaveBeenCalled();
    } finally { try { await x?.close(); } finally { vi.useRealTimers(); } }
  }, 15000);

  it.each(['digest', 'wrong-id', 'wrong-type', 'wrong-ordinal', 'missing'] as const)('returns a content-level error without candidate bytes for %s rehydration', async failure => {
    vi.useFakeTimers();
    let x: Awaited<ReturnType<typeof reclaimedFixture>> | undefined;
    const watchAbort = new AbortController();
    let watchReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      x = await reclaimedFixture();
      if (failure === 'missing') {
        const watch = await x.request(`${x.base}/events`, { signal: watchAbort.signal });
        expect(watch.status).toBe(200);
        if (!watch.body) throw new Error('fixture watch missing');
        watchReader = watch.body.getReader();
        expect((await watchReader.read()).done).toBe(false);
      }
      const candidate: SessionMessageGetOutput = failure === 'wrong-type'
        ? { id: x.message.id, type: 'user', text: x.text, time: { created: 22 } }
        : { id: failure === 'wrong-id' ? 'msg_fixture_wrong' : x.message.id, type: 'assistant', agent, model, finish: 'stop', time: { created: 22, completed: 23 },
          content: failure === 'wrong-ordinal' ? [] : [{ type: 'text', text: failure === 'digest' ? 'canonical fixture 🦊' : x.text }] };
      if (failure === 'missing') x.f.getMessage.mockRejectedValueOnce(new Error('fixture private native failure'));
      else x.f.getMessage.mockResolvedValueOnce(candidate);
      const response = await x.request(x.path(x.canonical, 0));
      expect(response.status).toBeGreaterThanOrEqual(400);
      const text = await response.text();
      expect(JSON.parse(text)).toMatchObject({ error: { code: expect.stringMatching(/content|unavailable|resource/i) } });
      expect(text).not.toMatch(/canonical fixture|fixture private native failure/);
      expect(x.f.prompt).toHaveBeenCalledOnce();
      expect(x.f.interruptSession).not.toHaveBeenCalled();
      if (watchReader) {
        let next: Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']>> | undefined;
        const pending = watchReader.read().then(value => { next = value; });
        const sid = sessionId(a.conversationId);
        x.f.emit({ type: 'session.text.started', id: 'evt_fixture_content_error_watch', created: 30,
          durable: { aggregateID: sid, seq: 4, version: 1 }, data: { sessionID: sid, assistantMessageID: 'msg_fixture_new_activity', ordinal: 0 } });
        await vi.waitFor(() => expect(next?.done).toBe(false));
        await pending;
        expect(new TextDecoder().decode(next?.value)).toContain('event: revision');
      }
    } finally { watchAbort.abort(); if (watchReader) void watchReader.cancel().catch(() => {}); try { await x?.close(); } finally { vi.useRealTimers(); } }
  }, 15000);

  it('does not resurrect reclaimed files when shutdown interrupts an owned rehydration', async () => {
    vi.useFakeTimers();
    let x: Awaited<ReturnType<typeof reclaimedFixture>> | undefined;
    const readback = deferred<SessionMessageGetOutput>();
    let closed = false;
    try {
      x = await reclaimedFixture();
      x.f.getMessage.mockImplementationOnce(() => readback.promise);
      const response = x.request(x.path(x.canonical, 0));
      await vi.waitFor(() => expect(x?.f.getMessage).toHaveBeenCalledOnce());
      const signal = x.f.getMessage.mock.calls[0]?.[1];
      const shutdown = x.close();
      await vi.advanceTimersByTimeAsync(11000);
      await shutdown;
      closed = true;
      expect(signal?.aborted).toBe(true);
      readback.resolve(x.message);
      await Promise.resolve();
      await expect(lstat(x.root)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await response).status).toBeGreaterThanOrEqual(400);
    } finally {
      readback.resolve({ id: 'msg_fixture_cleanup', type: 'user', text: '', time: { created: 1 } });
      try { if (x && !closed) await x.close(); } finally { vi.useRealTimers(); }
    }
  }, 15000);

  it('streams a large UTF-8 value in bounded pinned chunks and retries an offset without duplication', async () => {
    const text = `${'a'.repeat(65535)}🧠${'漢字'.repeat(34000)}`;
    const x = await fixture(text);
    try {
      const first = await chunk(await x.request(x.path(x.ref, 0)), x.ref, 0);
      const retry = await chunk(await x.request(x.path(x.ref, 0, first.transfer)), x.ref, 0);
      expect(retry).toEqual(first);
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let output = decoder.decode(first.data, { stream: true });
      let offset = first.nextOffset;
      while (offset < x.ref.through) {
        x.advance(50); // The injected 100 ms idle lease renews on each successful chunk.
        const next = await chunk(await x.request(x.path(x.ref, offset, first.transfer)), x.ref, offset);
        expect(next.transfer).toBe(first.transfer);
        output += decoder.decode(next.data, { stream: true });
        offset = next.nextOffset;
      }
      output += decoder.decode();
      expect(offset).toBe(x.ref.through);
      expect(output).toBe(text);
      expect(x.f.prompt).toHaveBeenCalledOnce();
    } finally { await x.close(); }
  });

  it('rejects wrong transfer scopes, stale generations and invalid ranges without opening content on denial', async () => {
    const x = await fixture('fixture body for scoped transfer');
    const open = vi.spyOn(x.bodies, 'open');
    try {
      const denied = await x.request(x.path(x.ref, 0), { headers: { authorization: `Bearer ${'b'.repeat(64)}` } });
      expect(denied.status).toBe(401);
      expect(open).not.toHaveBeenCalled();
      const first = await chunk(await x.request(x.path(x.ref, 0)), x.ref, 0);
      await contentError(await x.request(x.path(x.ref, 0, 'unknown-transfer')));
      await contentError(await x.request(x.path(x.ref, 0, first.transfer, b.conversationId)));
      await contentError(await x.request(x.path({ ...x.ref, contentId: '77777777-7777-4777-8777-777777777777' }, 0, first.transfer)));
      await contentError(await x.request(x.path({ ...x.ref, generation: 'unknown-generation' }, 0, first.transfer)));
      await contentError(await x.request(x.path(x.ref, x.ref.through + 1, first.transfer)));
      await contentError(await x.request(x.path({ ...x.ref, through: x.ref.through + 1 }, 0, first.transfer)));
      expect(x.f.prompt).toHaveBeenCalledOnce();
    } finally { open.mockRestore(); await x.close(); }
  });

  it('expires an idle transfer as a content error while keeping the watch and execution alive', async () => {
    const x = await fixture('fixture transfer with independent watch');
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const watch = await x.request(`${x.base}/events`, { signal: controller.signal });
      expect(watch.status).toBe(200);
      if (!watch.body) throw new Error('fixture watch missing body');
      reader = watch.body.getReader();
      expect((await reader.read()).done).toBe(false);
      const first = await chunk(await x.request(x.path(x.ref, 0)), x.ref, 0);
      x.advance(101);
      await contentError(await x.request(x.path(x.ref, 0, first.transfer)));
      expect(x.f.prompts[0]?.signal.aborted).toBe(false);
      expect(x.f.interruptSession).not.toHaveBeenCalled();
      const sid = sessionId(a.conversationId);
      x.f.emit({ type: 'session.text.started', id: 'evt_fixture_transfer_watch', created: 20,
        durable: { aggregateID: sid, seq: 1, version: 1 }, data: { sessionID: sid, assistantMessageID: 'msg_fixture_transfer', ordinal: 0 } });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const next = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('watch stopped after content failure')), 3000); })]);
        expect(next.done).toBe(false);
      } finally { if (timer) clearTimeout(timer); }
    } finally { controller.abort(); if (reader) void reader.cancel().catch(() => {}); await x.close(); }
  });

  it('finishes a pinned preview prefix after append and canonical replacement', async () => {
    const x = await fixture('fixture prompt');
    try {
      const sid = sessionId(a.conversationId);
      const messageId = 'msg_fixture_transfer_preview';
      const prefix = `${'p'.repeat(65535)}🧠${'q'.repeat(10000)}`;
      x.f.emit({ type: 'session.text.started', id: 'evt_fixture_transfer_start', created: 20,
        durable: { aggregateID: sid, seq: 1, version: 1 }, data: { sessionID: sid, assistantMessageID: messageId, ordinal: 0 } });
      x.f.emit({ type: 'session.text.delta', id: 'evt_fixture_transfer_delta', created: 21,
        data: { sessionID: sid, assistantMessageID: messageId, ordinal: 0, delta: prefix } });
      let preview: BodyRef | undefined;
      await vi.waitFor(async () => {
        const item = (await x.f.service.content.page(a.conversationId)).entries.find(entry => entry.kind === 'assistant-text' && entry.messageId === messageId);
        expect(item).toMatchObject({ kind: 'assistant-text', body: { kind: 'preview', through: Buffer.byteLength(prefix) } });
        if (item?.kind === 'assistant-text') preview = item.body;
      });
      if (!preview) throw new Error('fixture preview missing');
      const oldRef = preview;
      const first = await chunk(await x.request(x.path(oldRef, 0)), oldRef, 0);
      expect(first.nextOffset).toBeLessThan(oldRef.through);
      x.f.emit({ type: 'session.text.delta', id: 'evt_fixture_transfer_append', created: 22,
        data: { sessionID: sid, assistantMessageID: messageId, ordinal: 0, delta: ' later suffix' } });
      await vi.waitFor(async () => {
        const item = (await x.f.service.content.page(a.conversationId)).entries.find(entry => entry.kind === 'assistant-text' && entry.messageId === messageId);
        expect(item).toMatchObject({ body: { kind: 'preview', generation: oldRef.generation, through: Buffer.byteLength(`${prefix} later suffix`) } });
      });
      x.f.emit({ type: 'session.text.ended', id: 'evt_fixture_transfer_canonical', created: 23,
        durable: { aggregateID: sid, seq: 2, version: 1 }, data: { sessionID: sid, assistantMessageID: messageId, ordinal: 0, text: 'canonical replacement' } });
      await vi.waitFor(async () => {
        const item = (await x.f.service.content.page(a.conversationId)).entries.find(entry => entry.kind === 'assistant-text' && entry.messageId === messageId);
        expect(item).toMatchObject({ body: { kind: 'canonical' }, closure: 'closed' });
        if (item?.kind === 'assistant-text') expect(item.body.generation).not.toBe(oldRef.generation);
      });
      const chunks = [first.data];
      let offset = first.nextOffset;
      while (offset < oldRef.through) {
        const next = await chunk(await x.request(x.path(oldRef, offset, first.transfer)), oldRef, offset);
        chunks.push(next.data);
        offset = next.nextOffset;
      }
      expect(Buffer.concat(chunks).toString('utf8')).toBe(prefix);
      expect(x.f.prompt).toHaveBeenCalledOnce();
    } finally { await x.close(); }
  });
});

describe('daemon-owned Think conversation creation', () => {
  it('accepts native default model variant readback when the configured variant is omitted', async () => {
    // Pinned native session readback represents an absent stored variant as "default".
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0, { model: { ...model, variant: 'default' } });
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
    } finally { await f.service.close(); }
  });

  it('rejects a different native variant when an explicit model variant is configured', async () => {
    const f = setup({ ...model, variant: 'fixture-variant' });
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0, { model: { ...model, variant: 'default' } });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, a.clientCommandId)).toMatchObject({ state: 'rejected', failure: { code: 'ownership_mismatch' } }));
    } finally { await f.service.close(); }
  });

  it('registers promptly, creates a deterministic owned root with full grants, and verifies native readback before ready', async () => {
    const f = setup();
    try {
      const receipt = await f.service.create(a);
      expect(receipt).toMatchObject({ ...a, epoch, kind: 'create', state: 'registered' });
      await waitForCalls(f.calls, 1);
      const input = f.calls[0]?.input;
      expect(input).toMatchObject({ id: sessionId(a.conversationId), location: { directory: vaultDirectory }, permissions, agent, model });
      expect(input?.parentID == null).toBe(true);
      expect(JSON.stringify(input?.metadata)).toContain(a.conversationId);
      expect(JSON.stringify(input?.metadata)).toContain(epoch);
      expect(JSON.stringify(input?.metadata).toLowerCase()).toContain('memory');
      expect((await f.service.conversation(a.conversationId))?.creation).not.toBe('ready');
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      expect(f.getSession).toHaveBeenCalledWith({ sessionID: sessionId(a.conversationId) }, expect.any(AbortSignal));
      expect((await f.service.command(a.conversationId, a.clientCommandId))).toMatchObject({ ...a, epoch, state: 'ready' });
    } finally { await f.service.close(); }
  });

  it('deduplicates the command, rejects a different target, and allows an independent create while the first is held', async () => {
    const f = setup();
    try {
      const first = await f.service.create(a);
      expect(await f.service.create(a)).toEqual(first);
      await waitForCalls(f.calls, 1);
      await expect(f.service.create({ ...b, clientCommandId: a.clientCommandId })).rejects.toMatchObject({ code: 'command_conflict' });
      expect(f.createSession).toHaveBeenCalledTimes(1);
      expect(await f.service.create(b)).toMatchObject({ ...b, state: 'registered' });
      await waitForCalls(f.calls, 2);
      expect(f.calls[1]?.input.id).toBe(sessionId(b.conversationId));
      f.complete(1);
      await vi.waitFor(async () => expect((await f.service.conversation(b.conversationId))?.creation).toBe('ready'));
      expect((await f.service.conversation(a.conversationId))?.creation).not.toBe('ready');
    } finally { await f.service.close(); }
  });

  it.each([
    ['parent', { parentID: 'ses_fixture_parent' }],
    ['ownership', { metadata: { owner: 'other' } }],
    ['location', { location: { directory: '/fixture/other' } }],
    ['permissions', { permissions: [] }],
    ['agent', { agent: 'other-agent' }],
    ['model', { model: { providerID: 'fixture-provider', id: 'other-model' } }],
  ] satisfies Array<[string, Partial<NativeSession>]>)( 'rejects mismatched %s on ordinary readback without leaking native data', async (_label, changes) => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0, changes);
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, a.clientCommandId)).toMatchObject({ state: 'rejected', failure: { code: 'ownership_mismatch' } }));
      expect(JSON.stringify(await f.service.command(a.conversationId, a.clientCommandId))).not.toContain('/fixture/other');
      expect(f.getSession).toHaveBeenCalled();
    } finally { await f.service.close(); }
  });

  it('keeps ambiguous native failure unconfirmed and never automatically redispatches', async () => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.calls[0]?.result.reject(new Error('fixture private transport detail'));
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, a.clientCommandId)).toMatchObject({ state: 'upstream-unconfirmed' }));
      expect(await f.service.create(a)).toMatchObject({ state: 'upstream-unconfirmed' });
      expect(f.createSession).toHaveBeenCalledOnce();
      expect(JSON.stringify(await f.service.command(a.conversationId, a.clientCommandId))).not.toContain('private transport detail');
    } finally { await f.service.close(); }
  });

  it('does not adopt a native session for an unknown application conversation', async () => {
    const f = setup();
    try {
      expect(await f.service.conversation(a.conversationId)).toBeNull();
      expect(await f.service.command(a.conversationId, a.clientCommandId)).toBeNull();
      expect(f.getSession).not.toHaveBeenCalled();
      expect(f.createSession).not.toHaveBeenCalled();
    } finally { await f.service.close(); }
  });

  it('closes its owned pending call without invoking an upstream interrupt', async () => {
    const f = setup();
    await f.service.create(a);
    await waitForCalls(f.calls, 1);
    const signal = f.calls[0]?.signal;
    await f.service.close();
    expect(signal?.aborted).toBe(true);
    expect(f.interruptSession).not.toHaveBeenCalled();
    expect(f.createSession).toHaveBeenCalledOnce();
  });
});

describe('durable admission storage faults', () => {
  const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: '  fault fixture 🧠\r\noriginal bytes  ' };
  const reply = { conversationId: a.conversationId, clientCommandId: '88888888-8888-4888-8888-888888888888',
    decisionId: 'form_fixture_question', answer: { answer: '  form fixture 🧠\r\noriginal bytes  ', zeta: 'second field' } };

  // Controlled state facade tests the existing production injection boundary.
  // The separate Bun/SQLite admission suite proves real commit visibility and joins.
  function stateFixture() {
    const records = new Map<string, StoredCommand>();
    const put = (receipt: CommandReceipt, original: Uint8Array | null, digest: string | null, at: number) => {
      records.set(receipt.clientCommandId, { receipt: structuredClone(receipt), original: original ? new Uint8Array(original) : null,
        payloadSha256: digest, registeredAt: at, attempted: false });
    };
    const required = (id: string) => {
      const found = records.get(id);
      if (!found) throw new Error('fixture received a state mutation without a registered command');
      return found;
    };
    const state = {
      installationId: '99999999-9999-4999-8999-999999999999',
      conversations: conversationStateSpies(),
      ...deletionStateSpies(),
      command: vi.fn<ThinkStateStore['command']>(id => { const found = records.get(id); return found ? structuredClone(found) : null; }),
      registerConversation: vi.fn<ThinkStateStore['registerConversation']>((_owner, receipt, at) => put(receipt, null, null, at)),
      registerCommand: vi.fn<ThinkStateStore['registerCommand']>(put),
      attempted: vi.fn<ThinkStateStore['attempted']>(id => { required(id).attempted = true; }),
      outcome: vi.fn<ThinkStateStore['outcome']>(receipt => { required(receipt.clientCommandId).receipt = structuredClone(receipt); }),
      close: vi.fn<ThinkStateStore['close']>(),
    } satisfies ThinkStateStore;
    return { state, records, required };
  }

  async function ready(state: ThinkStateStore) {
    const f = setup(model, undefined, vaultDirectory, { state });
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      return f;
    } catch (error) { await f.service.close(); throw error; }
  }

  function noStop(f: ReturnType<typeof setup>) {
    expect(f.cancelInbox).not.toHaveBeenCalled();
    expect(f.interruptSession).not.toHaveBeenCalled();
  }

  async function refresh(f: ReturnType<typeof setup>) {
    const reads = f.listMessages.mock.calls.length;
    f.emit({ type: 'session.execution.started', id: 'evt_fixture_fault_refresh', created: 21,
      durable: { aggregateID: sessionId(a.conversationId), seq: 1, version: 1 }, data: { sessionID: sessionId(a.conversationId) } });
    await vi.waitFor(() => expect(f.listMessages.mock.calls.length).toBeGreaterThan(reads));
    await new Promise<void>(resolve => setImmediate(resolve));
    await f.service.snapshot(a.conversationId);
  }

  function admit(f: ReturnType<typeof setup>, loseAcknowledgement = false) {
    const pending = f.prompts[0];
    if (!pending?.input.id) throw new Error('fixture expected an identified native prompt');
    const accepted: SessionPromptOutput = { id: pending.input.id, sessionID: sessionId(a.conversationId), time: { created: 20 },
      type: 'user', payload: { text: 'fixture native-prepared text' }, delivery: 'queue' };
    f.inbox.push(accepted);
    f.messages.push({ id: accepted.id, type: 'user', text: accepted.payload.text, time: { created: 20 }, metadata: pending.input.metadata });
    f.active[accepted.sessionID] = { type: 'running' };
    if (loseAcknowledgement) pending.result.reject(new Error('fixture lost native acknowledgement'));
    else pending.result.resolve(accepted);
    return pending;
  }

  it('rejects failed ownership registration before native creation or an accepted receipt exists', async () => {
    const s = stateFixture();
    s.state.registerConversation.mockImplementationOnce(() => { throw new ThinkStateError('unavailable'); });
    const f = setup(model, undefined, vaultDirectory, { state: s.state });
    try {
      await expect(f.service.create(a)).rejects.toMatchObject({ code: 'think_unavailable' });
      expect(s.state.registerConversation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ conversationId: a.conversationId,
        nativeSessionId: sessionId(a.conversationId), directory: vaultDirectory }), expect.objectContaining({ ...a, state: 'registered' }), expect.any(Number));
      expect(s.records.has(a.clientCommandId)).toBe(false);
      expect(await f.service.command(a.conversationId, a.clientCommandId)).toBeNull();
      expect(await f.service.conversation(a.conversationId)).toBeNull();
      await expect(f.service.create(a)).rejects.toMatchObject({ code: 'think_unavailable' });
      expect(s.state.registerConversation).toHaveBeenCalledOnce();
      expect(s.state.attempted).not.toHaveBeenCalled();
      expect(f.createSession).not.toHaveBeenCalled();
      noStop(f);
    } finally { await f.service.close(); }
  });

  it('keeps a failed create-attempt write unconfirmed and never invokes native creation', async () => {
    const s = stateFixture();
    s.state.attempted.mockImplementationOnce(() => { throw new ThinkStateError('unavailable'); });
    const f = setup(model, undefined, vaultDirectory, { state: s.state });
    try {
      expect(await f.service.create(a)).toMatchObject({ ...a, kind: 'create', state: 'registered' });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, a.clientCommandId)).toMatchObject({ state: 'upstream-unconfirmed' }));
      expect(s.state.attempted).toHaveBeenCalledExactlyOnceWith(a.clientCommandId);
      expect(s.required(a.clientCommandId).attempted).toBe(false);
      expect(await f.service.create(a)).toMatchObject({ ...a, state: 'upstream-unconfirmed' });
      expect(await f.service.snapshot(a.conversationId)).toMatchObject({ creation: 'upstream-unconfirmed', sendEligibility: 'unavailable' });
      await expect(f.service.create(b)).rejects.toMatchObject({ code: 'think_unavailable' });
      expect(f.createSession).not.toHaveBeenCalled();
      expect(f.getSession).not.toHaveBeenCalled();
      noStop(f);
    } finally { await f.service.close(); }
  });

  it.each(['send', 'form-reply'] as const)('rejects %s registration failure before acceptance, original capture or native mutation', async kind => {
    const s = stateFixture();
    const f = await ready(s.state);
    const id = kind === 'send' ? send.clientCommandId : reply.clientCommandId;
    const action = () => kind === 'send' ? f.service.send(send) : f.service.reply(reply);
    const bytes = Buffer.from(kind === 'send' ? send.text : JSON.stringify(reply.answer), 'utf8');
    const payload = kind === 'send' ? send.text : JSON.stringify({ conversationId: reply.conversationId, decisionId: reply.decisionId, answer: reply.answer });
    s.state.registerCommand.mockImplementationOnce(() => { throw new ThinkStateError('unavailable'); });
    try {
      await expect(action()).rejects.toMatchObject({ code: 'think_unavailable' });
      expect(s.state.registerCommand).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind, conversationId: a.conversationId,
        clientCommandId: id, state: 'registered' }), bytes, createHash('sha256').update(payload).digest('hex'), expect.any(Number));
      expect(s.records.has(id)).toBe(false);
      expect(await f.service.command(a.conversationId, id)).toBeNull();
      expect((await f.service.content.page(a.conversationId)).entries.some(entry =>
        (entry.kind === 'original' || entry.kind === 'form-reply' || entry.kind === 'original-capture') && entry.clientCommandId === id)).toBe(false);
      await expect(action()).rejects.toMatchObject({ code: 'think_unavailable' });
      expect(s.state.registerCommand).toHaveBeenCalledOnce();
      expect(s.state.attempted.mock.calls.filter(([commandId]) => commandId === id)).toHaveLength(0);
      expect(f.prompt).not.toHaveBeenCalled();
      expect(f.replyForm).not.toHaveBeenCalled();
      noStop(f);
    } finally { await f.service.close(); }
  });

  it.each(['send', 'form-reply'] as const)('preserves registered %s input when its dispatch-attempt write fails, without dispatch or replay', async kind => {
    const s = stateFixture();
    const f = await ready(s.state);
    const id = kind === 'send' ? send.clientCommandId : reply.clientCommandId;
    const action = () => kind === 'send' ? f.service.send(send) : f.service.reply(reply);
    const bytes = Buffer.from(kind === 'send' ? send.text : JSON.stringify(reply.answer), 'utf8');
    const attempt = s.state.attempted.getMockImplementation();
    s.state.attempted.mockImplementation(commandId => {
      if (commandId === id) throw new ThinkStateError('unavailable');
      attempt?.(commandId);
    });
    try {
      const registered = await action();
      expect(registered).toMatchObject({ kind, clientCommandId: id, state: 'registered' });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, id)).toMatchObject({ state: 'upstream-unconfirmed' }));
      expect(s.state.attempted.mock.calls.filter(([commandId]) => commandId === id)).toEqual([[id]]);
      expect(s.required(id)).toMatchObject({ original: new Uint8Array(bytes), attempted: false,
        receipt: { conversationId: a.conversationId, clientCommandId: id, state: 'upstream-unconfirmed' } });
      expect(await action()).toMatchObject({ ...registered, state: 'upstream-unconfirmed' });
      if (kind === 'send') {
        await expect(f.service.send({ ...send, text: 'changed input' })).rejects.toMatchObject({ code: 'command_conflict' });
        await refresh(f);
      } else {
        await expect(f.service.reply({ ...reply, answer: { answer: 'changed input' } })).rejects.toMatchObject({ code: 'command_conflict' });
        await f.service.snapshot(a.conversationId);
      }
      expect(await action()).toMatchObject({ ...registered, state: 'upstream-unconfirmed' });
      expect(s.state.registerCommand).toHaveBeenCalledOnce();
      expect(s.state.attempted.mock.calls.filter(([commandId]) => commandId === id)).toHaveLength(1);
      expect(f.prompt).not.toHaveBeenCalled();
      expect(f.replyForm).not.toHaveBeenCalled();
      noStop(f);
    } finally { await f.service.close(); }
  });

  it.each(['send', 'form-reply', 'lost-ack'] as const)('does not reject or replay native-accepted %s when recording its observed outcome fails', async kind => {
    const s = stateFixture();
    const f = await ready(s.state);
    const isForm = kind === 'form-reply';
    const id = isForm ? reply.clientCommandId : send.clientCommandId;
    const targetState = isForm ? 'replied' : kind === 'lost-ack' ? 'upstream-unconfirmed' : 'admitted';
    const action = () => isForm ? f.service.reply(reply) : f.service.send(send);
    const outcome = s.state.outcome.getMockImplementation();
    s.state.outcome.mockImplementation((receipt, selection) => {
      if (receipt.clientCommandId === id && receipt.state === targetState) throw new ThinkStateError('unavailable');
      outcome?.(receipt, selection);
    });
    try {
      const registered = await action();
      let accepted: ReturnType<typeof admit> | undefined;
      if (isForm) await vi.waitFor(() => expect(f.replyForm).toHaveBeenCalledOnce());
      else { await waitForCalls(f.prompts, 1); accepted = admit(f, kind === 'lost-ack'); }
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, id)).toMatchObject({ state: targetState }));
      expect(s.state.outcome.mock.calls.some(([receipt]) => receipt.clientCommandId === id && receipt.state === targetState)).toBe(true);
      expect(s.required(id)).toMatchObject({ attempted: true, receipt: { state: 'registered', clientCommandId: id },
        original: new Uint8Array(Buffer.from(isForm ? JSON.stringify(reply.answer) : send.text, 'utf8')) });
      const observed = await f.service.command(a.conversationId, id);
      expect(observed).toMatchObject({ ...registered, state: targetState });
      expect(observed).not.toHaveProperty('failure');
      expect(await action()).toEqual(observed);
      if (isForm) {
        await expect(f.service.reply({ ...reply, answer: { answer: 'changed input' } })).rejects.toMatchObject({ code: 'command_conflict' });
        await f.service.snapshot(a.conversationId);
        expect(f.replyForm).toHaveBeenCalledExactlyOnceWith({ sessionID: sessionId(a.conversationId), formID: reply.decisionId, answer: reply.answer }, expect.any(AbortSignal));
      } else {
        await expect(f.service.send({ ...send, text: 'changed input' })).rejects.toMatchObject({ code: 'command_conflict' });
        await refresh(f);
        expect(f.prompt).toHaveBeenCalledOnce();
        expect(accepted?.input).toMatchObject({ id: `msg_memoryloop_${send.clientCommandId.replaceAll('-', '')}`, text: send.text,
          metadata: { memoryLoop: { runId: 'runId' in registered ? registered.runId : undefined, clientCommandId: id, epoch } } });
        expect(accepted?.signal.aborted).toBe(false);
      }
      expect(await action()).toEqual(observed);
      await expect(f.service.send({ ...send, clientCommandId: '66666666-6666-4666-8666-666666666666' })).rejects.toMatchObject({ code: 'think_unavailable' });
      expect((await f.service.conversation(a.conversationId))?.sendEligibility).toBe('unavailable');
      expect(s.state.registerCommand).toHaveBeenCalledOnce();
      expect(s.state.attempted.mock.calls.filter(([commandId]) => commandId === id)).toEqual([[id]]);
      noStop(f);
      if (kind === 'send') {
        // The local write failure must not prevent a later authoritative native completion.
        delete f.active[sessionId(a.conversationId)];
        f.inbox.splice(0);
        f.messages.push({ id: 'msg_fixture_after_state_fault', type: 'assistant', agent, model, content: [], finish: 'stop',
          time: { created: 22, completed: 23 } });
        f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
        f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_after_state_fault', created: 24,
          durable: { aggregateID: sessionId(a.conversationId), seq: 2, version: 1 }, data: { sessionID: sessionId(a.conversationId) } });
        await vi.waitFor(async () => expect(await f.service.command(a.conversationId, id)).toMatchObject({ state: 'completed' }));
        expect(s.required(id)).toMatchObject({ receipt: { state: 'completed' }, attempted: true,
          original: new Uint8Array(Buffer.from(send.text, 'utf8')) });
        expect(await action()).toMatchObject({ ...registered, state: 'completed' });
        expect(f.prompt).toHaveBeenCalledOnce();
        expect(accepted?.signal.aborted).toBe(false);
        noStop(f);
      }
    } finally { await f.service.close(); }
  });
});

describe('daemon-owned original body foundation', () => {
  const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: '  fixture original 🧠\n' };
  function bodyFixture() {
    const commit = deferred<BodyRef>();
    let observedKey: BodyKey | undefined;
    let observedBytes: Buffer | undefined;
    const replace = vi.fn<BodyStore['replace']>(async (key, source) => {
      observedKey = key;
      const chunks: Uint8Array[] = [];
      for await (const chunk of source) chunks.push(chunk);
      observedBytes = Buffer.concat(chunks);
      return commit.promise;
    });
    const bodies: BodyStore = {
      replace,
      append: vi.fn<BodyStore['append']>(async () => { throw new Error('unexpected append'); }),
      open: vi.fn<BodyStore['open']>(async () => { throw new Error('unexpected open'); }),
      evict: vi.fn<BodyStore['evict']>(async () => 'protected'),
      restore: vi.fn<BodyStore['restore']>(async () => { throw new Error('unexpected restore'); }),
      bind: vi.fn<BodyStore['bind']>(),
      revoke: vi.fn<BodyStore['revoke']>(() => { throw new Error('unexpected revoke'); }),
      purge: vi.fn<BodyStore['purge']>(async () => { throw new Error('unexpected purge'); }),
      close: vi.fn(async () => {}),
    };
    const ref = (): BodyRef => ({ key: observedKey ?? { conversationId: send.conversationId, owner: { kind: 'original', clientCommandId: send.clientCommandId, messageId: `msg_memoryloop_${send.clientCommandId.replaceAll('-', '')}` } },
      epoch, contentId: 'fixture-content', generation: 'fixture-generation', through: (observedBytes ?? Buffer.from(send.text)).length, kind: 'canonical',
      sha256: createHash('sha256').update(observedBytes ?? Buffer.from(send.text)).digest('hex') });
    return { bodies, replace, commit, ref, key: () => observedKey, bytes: () => observedBytes };
  }

  it('spills the exact original UTF-8 before dispatching a registered Send', async () => {
    const body = bodyFixture();
    const f = setup(model, body.bodies);
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const receipt = await f.service.send(send);
      expect(receipt).toMatchObject({ kind: 'send', state: 'registered', clientCommandId: send.clientCommandId });
      expect(JSON.stringify(receipt)).not.toContain(send.text);
      await vi.waitFor(() => expect(body.replace.mock.calls.length + f.prompt.mock.calls.length).toBeGreaterThan(0));
      expect(f.prompt).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(body.bytes()).toEqual(Buffer.from(send.text, 'utf8')));
      expect(body.key()).toEqual({ conversationId: send.conversationId, owner: { kind: 'original', clientCommandId: send.clientCommandId, messageId: `msg_memoryloop_${send.clientCommandId.replaceAll('-', '')}` } });
      expect(body.replace).toHaveBeenCalledOnce();
      expect(body.replace.mock.calls[0]?.[2]).toBe('canonical');
      expect(f.prompt).not.toHaveBeenCalled();
      expect(await f.service.send(send)).toMatchObject({ runId: receipt.runId });
      expect(body.replace).toHaveBeenCalledOnce();
      await expect(f.service.send({ ...send, text: `${send.text}changed` })).rejects.toMatchObject({ code: 'command_conflict' });
      body.commit.resolve(body.ref());
      await waitForCalls(f.prompts, 1);
      expect(f.prompts[0]?.input.text).toBe(send.text);
    } finally { body.commit.resolve(body.ref()); await f.service.close(); }
  });

  it('rejects the registered Send as a resource failure when original capture fails and never prompts', async () => {
    const body = bodyFixture();
    const f = setup(model, body.bodies);
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      await f.service.send(send);
      await vi.waitFor(() => expect(body.replace.mock.calls.length + f.prompt.mock.calls.length).toBeGreaterThan(0));
      expect(f.prompt).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(body.bytes()).toEqual(Buffer.from(send.text, 'utf8')));
      body.commit.reject(new Error('private fixture filesystem detail'));
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'rejected', failure: { code: 'resource_failure' } }));
      const receipt = await f.service.command(a.conversationId, send.clientCommandId);
      expect(JSON.stringify(receipt)).not.toContain('private fixture filesystem detail');
      expect(f.prompt).not.toHaveBeenCalled();
    } finally { body.commit.resolve(body.ref()); await f.service.close(); }
  });

  it.each(['commit', 'failure'] as const)('captures a form reply before native dispatch (%s)', async result => {
    const body = bodyFixture();
    const f = setup(model, body.bodies);
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const command = { conversationId: a.conversationId, clientCommandId: '88888888-8888-4888-8888-888888888888', decisionId: 'form_fixture_question', answer: { answer: 'fixture 🧠 answer' } };
      expect(await f.service.reply(command)).toMatchObject({ kind: 'form-reply', state: 'registered' });
      await vi.waitFor(() => expect(body.bytes()).toEqual(Buffer.from(JSON.stringify(command.answer), 'utf8')));
      expect(body.key()).toEqual({ conversationId: a.conversationId, owner: { kind: 'form-reply', clientCommandId: command.clientCommandId, decisionId: command.decisionId } });
      expect(f.replyForm).not.toHaveBeenCalled();
      if (result === 'commit') {
        body.commit.resolve(body.ref());
        await vi.waitFor(() => expect(f.replyForm).toHaveBeenCalledOnce());
        expect(f.replyForm).toHaveBeenCalledWith({ sessionID: sessionId(a.conversationId), formID: command.decisionId, answer: command.answer }, expect.any(AbortSignal));
      } else {
        body.commit.reject(new Error('fixture private storage failure'));
        await vi.waitFor(async () => expect(await f.service.command(a.conversationId, command.clientCommandId)).toMatchObject({ state: 'rejected', failure: { code: 'resource_failure' } }));
        expect(f.replyForm).not.toHaveBeenCalled();
      }
    } finally { body.commit.resolve(body.ref()); await f.service.close(); }
  });

  it('retains original UTF-8 through the real private store and exposes it in the content projection', async () => {
    const root = await mkdtemp('/tmp/opencode/think-content-test-');
    const vault = join(root, 'vault');
    let f: ReturnType<typeof setup> | undefined;
    let bodies: BodyStore | undefined;
    try {
      await mkdir(vault, { mode: 0o700 });
      bodies = await createBodyStore({ directory: join(root, 'private-bodies'), epoch, vaultDirectory: vault });
      f = setup(model, bodies, vault);
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f?.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const receipt = await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      const content = f.service.content;
      const page = await content.page(a.conversationId);
      const original = page.entries.find(entry => entry.kind === 'original' && entry.clientCommandId === send.clientCommandId);
      if (!original || original.kind !== 'original') throw new Error('Missing original body projection');
      expect(original.messageId).toBe(`msg_memoryloop_${send.clientCommandId.replaceAll('-', '')}`);
      const reader = await content.open(original.body);
      try { expect(Buffer.from(await reader.read(0, original.body.through)).toString('utf8')).toBe(send.text); }
      finally { await reader.close(); }
      expect(JSON.stringify(receipt)).not.toContain(send.text);
    } finally {
      try { await f?.service.close(); } finally { try { await bodies?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
    }
  });
});

describe('real private-store normalized projection', () => {
  async function fixture() {
    const root = await mkdtemp('/tmp/opencode/think-projection-test-');
    const vault = join(root, 'vault');
    await mkdir(vault, { mode: 0o700 });
    const bodies = await createBodyStore({ directory: join(root, 'bodies'), vaultDirectory: vault, epoch });
    const f = setup(model, bodies, vault);
    return { f, root, async close() { try { await f.service.close(); } finally { await rm(root, { recursive: true, force: true }); } } };
  }
  const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'original fixture 🧠' };

  it.each(['form-reply', 'cancelled-send'] as const)('P4-03 reports lost original %s capture as content gap, not a pending or saved transcript', async kind => {
    const root = await mkdtemp('/tmp/opencode/think-capture-gap-');
    const vault = join(root, 'vault');
    await mkdir(vault, { mode: 0o700 });
    const actual = await createBodyStore({ directory: join(root, 'bodies'), vaultDirectory: vault, epoch });
    const capture = deferred<BodyRef>();
    const held = vi.fn();
    const bodies: BodyStore = { ...actual, async replace(key, source, mode) {
      if (key.owner.kind === (kind === 'form-reply' ? 'form-reply' : 'original')) { held(); return capture.promise; }
      return actual.replace(key, source, mode);
    } };
    const f = setup(model, bodies, vault);
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      if (kind === 'form-reply') {
        await f.service.send(send); await waitForCalls(f.prompts, 1);
        await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.transcript?.state).toBe('up-to-date'));
        const command = { conversationId: a.conversationId, clientCommandId: '88888888-8888-4888-8888-888888888888', decisionId: 'form_fixture_question', answer: { answer: 'fixture missing answer' } };
        await f.service.reply(command);
        await vi.waitFor(() => expect(held).toHaveBeenCalledOnce());
        expect((await f.service.conversation(a.conversationId))?.transcript?.warning).not.toBe(true);
        capture.reject(new Error('fixture private capture failure'));
        await vi.waitFor(async () => expect(await f.service.command(a.conversationId, command.clientCommandId)).toMatchObject({ state: 'rejected', failure: { code: 'resource_failure' } }));
        expect(f.replyForm).not.toHaveBeenCalled();
      } else {
        const receipt = await f.service.send(send);
        await vi.waitFor(() => expect(held).toHaveBeenCalledOnce());
        expect((await f.service.conversation(a.conversationId))?.transcript?.warning).not.toBe(true);
        await f.service.stop({ conversationId: a.conversationId, clientCommandId: '88888888-8888-4888-8888-888888888888', runId: receipt.runId });
        capture.reject(new Error('fixture private capture failure'));
        await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'cancelled-before-delivery' }));
        expect(f.prompt).not.toHaveBeenCalled();
      }
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.transcript).toMatchObject({ warning: true, reason: 'content_gap' }));
      expect((await f.service.content.page(a.conversationId)).entries).not.toContainEqual(expect.objectContaining({ kind: kind === 'form-reply' ? 'form-reply' : 'original', clientCommandId: kind === 'form-reply' ? '88888888-8888-4888-8888-888888888888' : send.clientCommandId }));
    } finally { try { await f.service.close(); } finally { await rm(root, { recursive: true, force: true }); } }
  });

  it('Phase 4 retries unavailable transcript storage autonomously while execution continues and clears warning only after sync', async () => {
    const root = await mkdtemp('/tmp/opencode/think-transcript-retry-');
    const vault = join(root, 'vault');
    await mkdir(vault, { mode: 0o700 });
    const bodies = await createBodyStore({ directory: join(root, 'bodies'), vaultDirectory: vault, epoch });
    let now = 1_700_000_000_000;
    const timers = new Set<{ at: number; callback: () => void }>();
    const runtime: TranscriptRuntime = { now: () => now, random: () => 0.5, schedule(callback, delay) {
      const task = { at: now + delay, callback }; timers.add(task); return () => { timers.delete(task); };
    } };
    let fault: 'write' | 'sync' | 'none' = 'write';
    let failures = 0;
    let fileReads = 0;
    const io: TranscriptIO = { ...transcriptIO, async open(path, flags, mode) {
      const handle = await transcriptIO.open(path, flags, mode);
      if (!(flags & constants.O_APPEND)) return handle;
      return { fd: handle.fd, stat: () => handle.stat(), close: () => handle.close(),
        async read(buffer, offset, length, position) { const result = await handle.read(buffer, offset, length, position); fileReads += result.bytesRead; return result; },
        async write(buffer, offset, length, position) {
          if (fault === 'write') { failures++; throw Object.assign(new Error('fixture unavailable'), { code: 'ENOSPC' }); }
          return handle.write(buffer, offset, length, position);
        },
        async sync() { if (fault === 'sync') { failures++; throw Object.assign(new Error('fixture sync unavailable'), { code: 'EIO' }); } await handle.sync(); },
      };
    } };
    const f = setup(model, bodies, vault, undefined, { io, runtime, warningAfterMs: 5000 });
    const target = join(vault, 'Conversations', 'Memory Loop', `think-${a.conversationId}.md`);
    const advance = async () => {
      const next = Math.min(...[...timers].map(task => task.at));
      if (!Number.isFinite(next)) throw new Error('fixture retry not scheduled');
      now = next;
      for (const task of [...timers]) if (task.at <= now) { timers.delete(task); task.callback(); }
      await new Promise<void>(resolve => setImmediate(resolve));
    };
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const app = createApp({ authority: '127.0.0.1:3000', serviceToken: 'a'.repeat(64), think: f.service,
        vault: { reader: { tree: async () => ({ rootIdentity: 'root', entries: [] }), action: async () => ({ id: ['fixture'] }), file: async () => ({ name: 'fixture', kind: 'unsupported' as const }), content: async () => new Response(null, { status: 404 }), note: async () => ({ name: 'fixture', markdown: '', revision: 'fixture-revision', editable: true }), save: async () => ({ revision: 'fixture-revision' }), close: async () => {} } } });
      const caller = new AbortController();
      const response = await app(new Request(`http://127.0.0.1:3000/api/think/conversations/${a.conversationId}/messages`, {
        method: 'POST', signal: caller.signal, headers: { host: '127.0.0.1:3000', authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }, body: JSON.stringify({ clientCommandId: send.clientCommandId, text: send.text }),
      }));
      expect(response.status).toBe(202); caller.abort();
      await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture prompt missing');
      await vi.waitFor(() => expect(failures).toBeGreaterThan(0));
      expect((await f.service.conversation(a.conversationId))?.transcript).toMatchObject({ state: 'retrying', warning: false });
      await f.service.create(b); await waitForCalls(f.calls, 2); f.complete(1);
      pending.result.resolve({ id: pending.input.id, sessionID: sessionId(a.conversationId), time: { created: 20 }, type: 'user', payload: { text: 'prepared fixture' }, delivery: 'queue' });
      f.messages.push({ id: pending.input.id, type: 'user', text: 'prepared fixture', time: { created: 20 } },
        { id: 'msg_fixture_retry', type: 'assistant', agent, model, finish: 'stop', time: { created: 22, completed: 23 }, content: [{ type: 'text', text: 'fixture answer after failure' },
          { type: 'tool', id: 'tool_fixture_retry', name: 'read', time: { created: 22, completed: 23 }, state: { status: 'error', input: { path: 'private-retry-tool-path' }, error: { type: 'fixture', message: 'private-retry-tool-error' } } }] });
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_retry', created: 24, durable: { aggregateID: sessionId(a.conversationId), seq: 1, version: 1 }, data: { sessionID: sessionId(a.conversationId) } });
      await vi.waitFor(async () => expect((await f.service.command(a.conversationId, send.clientCommandId))?.state).toBe('completed'));
      for (let i = 0; i < 10; i++) {
        const previous = failures;
        do { await advance(); } while (failures === previous && timers.size);
        await vi.waitFor(() => expect(failures).toBeGreaterThan(previous));
      }
      expect(now - 1_700_000_000_000).toBeGreaterThan(120000);
      expect((await f.service.conversation(a.conversationId))?.transcript).toMatchObject({ warning: true, state: 'retrying' });
      expect(fileReads).toBe(0);
      fault = 'sync';
      const beforeSync = failures;
      await advance();
      await vi.waitFor(() => expect(failures).toBeGreaterThan(beforeSync));
      expect((await f.service.conversation(a.conversationId))?.transcript).toMatchObject({ warning: true, state: 'retrying' });
      fault = 'none';
      await advance();
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.transcript).toMatchObject({ warning: false, state: 'up-to-date' }));
      const markdown = await readFile(target, 'utf8');
      expect(markdown.split(send.text)).toHaveLength(2);
      expect(markdown.split('fixture answer after failure')).toHaveLength(2);
      expect(markdown).toContain('File read');
      expect(markdown).not.toMatch(/private-retry-tool-path|private-retry-tool-error/);
      expect(markdown).not.toContain('prepared fixture');
      expect(f.prompt).toHaveBeenCalledOnce();
      expect(f.interruptSession).not.toHaveBeenCalled();
    } finally { try { await f.service.close(); } finally { await rm(root, { recursive: true, force: true }); } }
  });

  it('Phase 4 records observed native compaction without exporting its summary or removing earlier full history', async () => {
    const state = await fixture();
    const { f, root } = state;
    const path = join(root, 'vault', 'Conversations', 'Memory Loop', `think-${a.conversationId}.md`);
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      await f.service.send(send); await waitForCalls(f.prompts, 1);
      await vi.waitFor(async () => expect(await readFile(path, 'utf8')).toContain(send.text));
      f.emit({ type: 'session.compaction.ended', id: 'evt_fixture_compaction', created: 30,
        durable: { aggregateID: sessionId(a.conversationId), seq: 5, version: 1 },
        data: { sessionID: sessionId(a.conversationId), reason: 'auto', text: 'fixture-secret-compaction-summary' } });
      f.emit({ type: 'session.compaction.ended', id: 'evt_fixture_compaction', created: 30,
        durable: { aggregateID: sessionId(a.conversationId), seq: 5, version: 1 },
        data: { sessionID: sessionId(a.conversationId), reason: 'auto', text: 'fixture-secret-compaction-summary' } });
      f.emit({ type: 'session.compaction.ended', id: 'evt_fixture_unowned', created: 31,
        durable: { aggregateID: 'ses_unowned_fixture', seq: 6, version: 1 },
        data: { sessionID: 'ses_unowned_fixture', reason: 'manual', text: 'fixture-unowned-summary' } });
      await vi.waitFor(async () => {
        const markdown = await readFile(path, 'utf8');
        expect(markdown).toMatch(/compact/i);
        expect(markdown).toContain(send.text);
        expect(markdown).not.toContain('fixture-secret-compaction-summary');
        expect(markdown).not.toContain('fixture-unowned-summary');
        expect(markdown).not.toContain('evt_fixture_unowned');
        expect(markdown.split('Context compacted.')).toHaveLength(2);
      }, { timeout: 3000 });
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await state.close(); }
  });

  it('Phase 4 records the original UTF-8 form reply after the user entry without exposing native form metadata', async () => {
    const state = await fixture();
    const { f, root } = state;
    const path = join(root, 'vault', 'Conversations', 'Memory Loop', `think-${a.conversationId}.md`);
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      await f.service.send(send); await waitForCalls(f.prompts, 1);
      await vi.waitFor(async () => expect(await readFile(path, 'utf8')).toContain(send.text));
      const command = { conversationId: a.conversationId, clientCommandId: '88888888-8888-4888-8888-888888888888', decisionId: 'form_fixture_question', answer: { answer: 'form 🧠 original Ω' } };
      expect(await f.service.reply(command)).toMatchObject({ kind: 'form-reply', state: 'registered' });
      await vi.waitFor(() => expect(f.replyForm).toHaveBeenCalledOnce());
      await vi.waitFor(async () => {
        const markdown = await readFile(path, 'utf8');
        expect(markdown).toContain(JSON.stringify(command.answer));
        expect(markdown).toContain('"kind":"form-reply"');
        expect(markdown.indexOf(send.text)).toBeLessThan(markdown.indexOf('form 🧠 original Ω'));
        expect(markdown).not.toContain('do-not-expose');
      });
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await state.close(); }
  });

  it('Phase 4 reports external edits until the same owned file is restored and synchronized without a retry route', async () => {
    const root = await mkdtemp('/tmp/opencode/think-transcript-health-');
    const vault = join(root, 'vault');
    await mkdir(vault, { mode: 0o700 });
    const bodies = await createBodyStore({ directory: join(root, 'bodies'), vaultDirectory: vault, epoch });
    let now = 1_700_000_000_000;
    const timers = new Set<{ at: number; callback: () => void }>();
    const runtime: TranscriptRuntime = { now: () => now, random: () => 0.5, schedule(callback, delay) {
      const task = { at: now + delay, callback }; timers.add(task); return () => { timers.delete(task); };
    } };
    const f = setup(model, bodies, vault, undefined, { runtime });
    const path = join(vault, 'Conversations', 'Memory Loop', `think-${a.conversationId}.md`);
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      await f.service.send(send); await waitForCalls(f.prompts, 1);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.transcript).toMatchObject({ state: 'up-to-date' }));
      const original = await readFile(path);
      const identity = await lstat(path);
      await appendFile(path, 'external fixture edit');
      const changed = await readFile(path);
      f.emit({ type: 'session.compaction.ended', id: 'evt_health_compaction', created: 30,
        durable: { aggregateID: sessionId(a.conversationId), seq: 6, version: 1 }, data: { sessionID: sessionId(a.conversationId), reason: 'auto', text: 'private summary' } });
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.transcript).toMatchObject({ warning: true, reason: 'conflict' }));
      expect(await readFile(path)).toEqual(changed);
      const nativeCalls = f.prompt.mock.calls.length;
      const app = createApp({ authority: '127.0.0.1:3000', serviceToken: 'a'.repeat(64), think: f.service,
        vault: { reader: { tree: async () => ({ rootIdentity: 'root', entries: [] }), action: async () => ({ id: ['fixture'] }), file: async () => ({ name: 'fixture', kind: 'unsupported' as const }), content: async () => new Response(null, { status: 404 }), note: async () => ({ name: 'fixture', markdown: '', revision: 'fixture-revision', editable: true }), save: async () => ({ revision: 'fixture-revision' }), close: async () => {} } } });
      const response = await app(new Request(`http://127.0.0.1:3000/api/think/conversations/${a.conversationId}/transcript/retry`, {
        method: 'POST', headers: { host: '127.0.0.1:3000', authorization: `Bearer ${'a'.repeat(64)}` },
      }));
      expect([404, 405]).toContain(response.status);
      expect(f.prompt.mock.calls.length).toBe(nativeCalls);
      expect(await readFile(path)).toEqual(changed);
      await writeFile(path, original);
      expect((await lstat(path)).ino).toBe(identity.ino);
      expect((await f.service.conversation(a.conversationId))?.transcript).toMatchObject({ warning: true, reason: 'conflict' });
      await vi.waitFor(() => expect(timers.size).toBeGreaterThan(0));
      now = Math.min(...[...timers].map(task => task.at));
      for (const task of [...timers]) if (task.at <= now) { timers.delete(task); task.callback(); }
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.transcript).toMatchObject({ warning: false, state: 'up-to-date' }));
      const caughtUp = await readFile(path, 'utf8');
      expect(caughtUp.startsWith(original.toString('utf8'))).toBe(true);
      expect(caughtUp).toContain('Context compacted.');
      expect(caughtUp).not.toContain('external fixture edit');
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { try { await f.service.close(); } finally { await rm(root, { recursive: true, force: true }); } }
  });

  it('Phase 4 invalid transcript path degrades logging without disabling Recall or native execution', async () => {
    const config = parseThinkConfig({ service: { registrationFile: '/fixture/registration.json', requiredVersion: '2.2.2' }, location: { kind: 'vault' }, transcriptDirectory: '../outside' });
    expect(config?.transcriptDirectory).toBe('../outside');
    const root = await mkdtemp('/tmp/opencode/think-transcript-config-');
    const vault = join(root, 'vault');
    await mkdir(vault, { mode: 0o700 });
    const bodies = await createBodyStore({ directory: join(root, 'bodies'), vaultDirectory: vault, epoch });
    const f = setup(model, bodies, vault, undefined, { directory: config?.transcriptDirectory });
    try {
      const app = createApp({ authority: '127.0.0.1:3000', serviceToken: 'a'.repeat(64), think: f.service,
        vault: { reader: { tree: async () => ({ rootIdentity: 'root', entries: [] }), action: async () => ({ id: ['fixture'] }), file: async () => ({ name: 'fixture', kind: 'unsupported' as const }), content: async () => new Response(null, { status: 404 }), note: async () => ({ name: 'fixture', markdown: 'recall fixture', revision: 'fixture-revision', editable: true }), save: async () => ({ revision: 'fixture-revision' }), close: async () => {} } } });
      const response = await app(new Request('http://127.0.0.1:3000/api/vault/tree', { headers: { host: '127.0.0.1:3000', authorization: `Bearer ${'a'.repeat(64)}` } }));
      expect(response.status).toBe(200);
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      expect(await f.service.send(send)).toMatchObject({ state: 'registered' });
      await waitForCalls(f.prompts, 1);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.transcript).toMatchObject({ warning: true, reason: 'invalid_configuration' }));
      await expect(lstat(join(root, 'outside'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { try { await f.service.close(); } finally { await rm(root, { recursive: true, force: true }); } }
  });

  it('Phase 4 writes original and canonical text to the owned conversation Markdown after caller abort and New chat', async () => {
    const state = await fixture();
    const { f, root } = state;
    const original = 'original 🧠\r\n````\n<!-- memory-loop-end fake -->';
    const assistant = 'assistant fixture\n```\nfull text Ω';
    const path = join(root, 'vault', 'Conversations', 'Memory Loop', `think-${a.conversationId}.md`);
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const token = 'a'.repeat(64);
      const app = createApp({ authority: '127.0.0.1:3000', serviceToken: token, think: f.service,
        vault: { reader: { tree: async () => ({ rootIdentity: 'root', entries: [] }), action: async () => ({ id: ['fixture'] }), file: async () => ({ name: 'fixture', kind: 'unsupported' as const }), content: async () => new Response(null, { status: 404 }), note: async () => ({ name: 'fixture', markdown: '', revision: 'fixture-revision', editable: true }), save: async () => ({ revision: 'fixture-revision' }), close: async () => {} } } });
      const abort = new AbortController();
      const response = await app(new Request(`http://127.0.0.1:3000/api/think/conversations/${a.conversationId}/messages`, {
        method: 'POST', signal: abort.signal, headers: { host: '127.0.0.1:3000', authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ clientCommandId: send.clientCommandId, text: original }),
      }));
      expect(response.status).toBe(202);
      abort.abort();
      await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture prompt missing');
      await f.service.create(b);
      await waitForCalls(f.calls, 2);
      f.complete(1);
      await vi.waitFor(async () => expect((await f.service.conversation(b.conversationId))?.creation).toBe('ready'));
      expect(pending.signal.aborted).toBe(false);
      pending.result.resolve({ id: pending.input.id, sessionID: sessionId(a.conversationId), time: { created: 20 }, type: 'user', payload: { text: 'plugin-expanded-secret' }, delivery: 'queue' });
      f.messages.push(
        { id: pending.input.id, type: 'user', text: 'plugin-expanded-secret', time: { created: 20 } },
        { id: 'msg_fixture_transcript', type: 'assistant', agent, model, finish: 'stop', time: { created: 22, completed: 23 }, content: [
          { type: 'reasoning', text: 'fixture-hidden-reasoning' },
          { type: 'text', text: assistant },
          { type: 'tool', id: 'fixture-transcript-tool', name: 'unknown-custom-tool', time: { created: 22, completed: 23 }, state: { status: 'error', input: { path: 'fixture-private-tool-argument' }, error: { type: 'fixture', message: 'fixture-private-tool-error' } } },
        ] },
      );
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
      const emit = (id: string, seq: number) => f.emit({ type: 'session.execution.succeeded', id, created: 24,
        durable: { aggregateID: sessionId(a.conversationId), seq, version: 1 }, data: { sessionID: sessionId(a.conversationId) } });
      emit('evt_fixture_transcript', 1);
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId: 'msg_fixture_transcript' })));
      let markdown = '';
      await vi.waitFor(async () => {
        markdown = await readFile(path, 'utf8');
        expect(markdown).toContain(assistant);
      }, { timeout: 3000 });
      expect(markdown).toContain(`conversation_id: "${a.conversationId}"`);
      expect(markdown).toContain(`\`\`\`\`\`text\n${original}\n\`\`\`\`\``);
      expect(markdown).toContain(`\`\`\`\`text\n${assistant}\n\`\`\`\``);
      expect(markdown).toMatch(/Custom tool/);
      expect(markdown).not.toMatch(/plugin-expanded-secret|fixture-hidden-reasoning|fixture-private-tool-argument|fixture-private-tool-error/);
      await expect(lstat(join(root, 'vault', 'Conversations', 'Memory Loop', `think-${b.conversationId}.md`))).rejects.toMatchObject({ code: 'ENOENT' });
      const prior = f.listMessages.mock.calls.length;
      emit('evt_fixture_transcript_repeat', 2);
      await vi.waitFor(() => expect(f.listMessages.mock.calls.length).toBeGreaterThan(prior));
      await vi.waitFor(async () => expect(await readFile(path, 'utf8')).toBe(markdown));
      expect(f.prompt).toHaveBeenCalledOnce();
      expect(f.interruptSession).not.toHaveBeenCalled();
    } finally { await state.close(); }
  });

  it('keeps original text distinct from prepared input and normalizes mixed text and safe custom tool facts', async () => {
    const fixtureState = await fixture();
    const { f } = fixtureState;
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture prompt missing');
      const promptId = pending.input.id;
      pending.result.resolve({ id: promptId, sessionID: sessionId(a.conversationId), time: { created: 20 }, type: 'user', payload: { text: 'plugin-expanded fixture' }, delivery: 'queue' });
      f.messages.push(
        { id: promptId, type: 'user', text: 'plugin-expanded fixture', time: { created: 20 } },
        { id: 'msg_fixture_mixed', type: 'assistant', agent, model, finish: 'stop', time: { created: 22, completed: 23 }, content: [
          { type: 'reasoning', text: 'fixture-secret-reasoning' },
          { type: 'text', text: 'first fixture text' },
          { type: 'tool', id: 'fixture-tool-id', name: 'unknown-custom-tool', time: { created: 22, completed: 23 }, state: { status: 'error', input: { path: '/fixture-secret-path', arg: 'fixture-secret-argument' }, error: { type: 'fixture', message: 'fixture-secret-error' } } },
          { type: 'text', text: 'second fixture text' },
        ] },
      );
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_projection', created: 24,
        durable: { aggregateID: sessionId(a.conversationId), seq: 4, version: 1 }, data: { sessionID: sessionId(a.conversationId) } });
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries.filter(entry => entry.kind === 'assistant-text')).toHaveLength(2));
      const page = await f.service.content.page(a.conversationId);
      const original = page.entries.find(entry => entry.kind === 'original');
      if (!original || original.kind !== 'original') throw new Error('original fixture projection missing');
      const reader = await f.service.content.open(original.body);
      try { expect(Buffer.from(await reader.read(0, original.body.through)).toString('utf8')).toBe(send.text); } finally { await reader.close(); }
      const mixed = page.entries.filter(entry => (entry.kind === 'assistant-text' || entry.kind === 'tool') && entry.messageId === 'msg_fixture_mixed');
      expect(mixed.map(entry => entry.kind === 'assistant-text' ? `text-${entry.ordinal}` : entry.kind)).toEqual(['text-0', 'tool', 'text-1']);
      expect(mixed[0].displayOrder).toBeLessThan(mixed[1].displayOrder);
      expect(mixed[1].displayOrder).toBeLessThan(mixed[2].displayOrder);
      expect(mixed[1]).toMatchObject({ kind: 'tool', category: 'custom', state: 'failed' });
      expect(JSON.stringify(page)).not.toMatch(/plugin-expanded fixture|fixture-secret|unknown-custom-tool/);
      const refs = mixed.filter(entry => entry.kind === 'assistant-text').map(entry => entry.body);
      const prior = f.listMessages.mock.calls.length;
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_projection_again', created: 25,
        durable: { aggregateID: sessionId(a.conversationId), seq: 5, version: 1 }, data: { sessionID: sessionId(a.conversationId) } });
      await vi.waitFor(() => expect(f.listMessages.mock.calls.length).toBeGreaterThan(prior));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect((await f.service.content.page(a.conversationId)).entries.filter(entry => entry.kind === 'assistant-text').map(entry => entry.body)).toEqual(refs);
    } finally { await fixtureState.close(); }
  });

  it('keeps an observed partial incomplete after a stream gap until canonical history replaces it', async () => {
    const fixtureState = await fixture();
    const { f } = fixtureState;
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const receipt = await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      const sid = sessionId(a.conversationId);
      const messageId = 'msg_fixture_preview';
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture prompt missing');
      pending.result.resolve({ id: pending.input.id, sessionID: sid, time: { created: 19 }, type: 'user', payload: { text: send.text }, delivery: 'queue' });
      await vi.waitFor(async () => expect((await f.service.command(a.conversationId, send.clientCommandId))?.state).toBe('admitted'));
      f.emit({ type: 'session.text.started', id: 'evt_fixture_text_start', created: 20,
        durable: { aggregateID: sid, seq: 1, version: 1 }, data: { sessionID: sid, assistantMessageID: messageId, ordinal: 0 } });
      f.emit({ type: 'session.text.delta', id: 'evt_fixture_text_delta', created: 21,
        data: { sessionID: sid, assistantMessageID: messageId, ordinal: 0, delta: 'observed partial' } });
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId, closure: 'open' })));
      const subscriptionsBeforeGap = f.subscribe.mock.calls.length;
      const historyBeforeGap = f.listMessages.mock.calls.length;
      f.endStream('error');
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId, closure: 'open', capture: 'incomplete' })), { timeout: 8000 });
      expect((await f.service.content.page(a.conversationId)).contentHealth).toBe('incomplete');
      const transcript = join(fixtureState.root, 'vault', 'Conversations', 'Memory Loop', `think-${a.conversationId}.md`);
      await vi.waitFor(async () => {
        const markdown = await readFile(transcript, 'utf8');
        expect(markdown).toContain('observed partial');
        expect(markdown).toContain('"capture":"observed-partial"');
      });
      // The controlled adapter emits server.connected on each subscription; a
      // subsequent authority query proves that reconnection has been accepted.
      await vi.waitFor(() => expect(f.subscribe.mock.calls.length).toBeGreaterThan(subscriptionsBeforeGap), { timeout: 8000 });
      await vi.waitFor(() => expect(f.listMessages.mock.calls.length).toBeGreaterThan(historyBeforeGap), { timeout: 8000 });
      await f.service.stop({ conversationId: a.conversationId, clientCommandId: '88888888-8888-4888-8888-888888888888', runId: receipt.runId });
      await vi.waitFor(() => expect(f.interruptSession).toHaveBeenCalledOnce());
      const partial = (await f.service.content.page(a.conversationId)).entries.find(entry => entry.kind === 'assistant-text' && entry.messageId === messageId);
      if (!partial || partial.kind !== 'assistant-text') throw new Error('partial fixture projection missing');
      const partialReader = await f.service.content.open(partial.body);
      try { expect(Buffer.from(await partialReader.read(0, partial.body.through)).toString('utf8')).toBe('observed partial'); } finally { await partialReader.close(); }
      await vi.waitFor(() => expect(f.subscribe.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
      f.messages.push({ id: messageId, type: 'assistant', agent, model, finish: 'stop', time: { created: 22, completed: 23 }, content: [{ type: 'text', text: 'canonical fixture' }] });
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_text_end', created: 24,
        durable: { aggregateID: sid, seq: 2, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId, closure: 'closed', capture: 'complete' })));
      expect((await f.service.content.page(a.conversationId)).contentHealth).toBe('complete');
      const canonical = (await f.service.content.page(a.conversationId)).entries.find(entry => entry.kind === 'assistant-text' && entry.messageId === messageId);
      if (!canonical || canonical.kind !== 'assistant-text') throw new Error('canonical fixture projection missing');
      const canonicalReader = await f.service.content.open(canonical.body);
      try { expect(Buffer.from(await canonicalReader.read(0, canonical.body.through)).toString('utf8')).toBe('canonical fixture'); } finally { await canonicalReader.close(); }
      await vi.waitFor(async () => {
        const markdown = await readFile(transcript, 'utf8');
        expect(markdown).toContain('AI (replacement)');
        expect(markdown).toContain('"supersedes_entry_id"');
        expect(markdown.split('canonical fixture')).toHaveLength(2);
        expect(markdown.split('observed partial')).toHaveLength(2);
      });
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await fixtureState.close(); }
  }, 15000);

  it('does not publish a stale history query after a newer event invalidates it', async () => {
    const fixtureState = await fixture();
    const { f } = fixtureState;
    const oldQuery = deferred<MessageListOutput>();
    const newQuery = deferred<MessageListOutput>();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      await vi.waitFor(() => expect(f.listMessages).toHaveBeenCalled());
      await new Promise<void>(resolve => setImmediate(resolve));
      f.listMessages.mockImplementationOnce(() => oldQuery.promise).mockImplementationOnce(() => newQuery.promise);
      const previous = f.listMessages.mock.calls.length;
      const sid = sessionId(a.conversationId);
      const notify = (id: string, seq: number) => f.emit({ type: 'session.execution.started', id, created: seq,
        durable: { aggregateID: sid, seq, version: 1 }, data: { sessionID: sid } });
      notify('evt_fixture_old', 10);
      await vi.waitFor(() => expect(f.listMessages.mock.calls.length).toBeGreaterThan(previous));
      notify('evt_fixture_new', 11);
      oldQuery.resolve({ data: [{ id: 'msg_fixture_old_projection', type: 'assistant', agent, model, finish: 'stop', time: { created: 20, completed: 21 }, content: [{ type: 'text', text: 'stale fixture' }] }], cursor: {} });
      await vi.waitFor(() => expect(f.listMessages.mock.calls.length).toBeGreaterThan(previous + 1));
      expect((await f.service.content.page(a.conversationId)).entries).not.toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId: 'msg_fixture_old_projection' }));
      newQuery.resolve({ data: [{ id: 'msg_fixture_new_projection', type: 'assistant', agent, model, finish: 'stop', time: { created: 22, completed: 23 }, content: [{ type: 'text', text: 'new fixture' }] }], cursor: {} });
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId: 'msg_fixture_new_projection' })));
    } finally {
      oldQuery.resolve({ data: [], cursor: {} });
      newQuery.resolve({ data: [], cursor: {} });
      await fixtureState.close();
    }
  });
});

describe('daemon-owned native prompt dispatch', () => {
  const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: '  original fixture text\n' };

  it('keeps an accepted HTTP Send owned after the caller aborts', async () => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const token = 'a'.repeat(64);
      const authority = '127.0.0.1:3000';
      const app = createApp({ authority, serviceToken: token, think: f.service,
        vault: { reader: { tree: async () => ({ rootIdentity: 'root', entries: [] }), action: async () => ({ id: ['fixture'] }), file: async () => ({ name: 'fixture', kind: 'unsupported' as const }), content: async () => new Response(null, { status: 404 }), note: async () => ({ name: 'fixture', markdown: '', revision: 'fixture-revision', editable: true }), save: async () => ({ revision: 'fixture-revision' }), close: async () => {} } } });
      const caller = new AbortController();
      const response = await app(new Request(`http://${authority}/api/think/conversations/${a.conversationId}/messages`, {
        method: 'POST', signal: caller.signal,
        headers: { host: authority, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ clientCommandId: send.clientCommandId, text: send.text }),
      }));
      expect(response.status).toBe(202);
      await waitForCalls(f.prompts, 1);
      caller.abort();
      expect(f.prompts[0]?.signal.aborted).toBe(false);
      expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ kind: 'send', clientCommandId: send.clientCommandId });
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  });

  it('registers immediately, consumes the monitor before dispatch, and sends original text once with stable identities', async () => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const receipt = await f.service.send(send);
      expect(receipt).toMatchObject({ kind: 'send', state: 'registered', conversationId: a.conversationId, clientCommandId: send.clientCommandId });
      expect(receipt.runId).toEqual(expect.any(String));
      expect(await f.service.send(send)).toEqual(receipt);
      await waitForCalls(f.prompts, 1);
      expect(f.order.indexOf('monitor')).toBeGreaterThanOrEqual(0);
      expect(f.order.indexOf('monitor')).toBeLessThan(f.order.indexOf('prompt'));
      const input = f.prompts[0]?.input;
      expect(input).toMatchObject({ sessionID: sessionId(a.conversationId), text: send.text });
      expect(input?.id).toMatch(/^msg_/);
      expect(JSON.stringify(input?.metadata)).toContain(receipt.runId);
      expect(JSON.stringify(input?.metadata)).toContain(send.clientCommandId);
      expect(f.prompt).toHaveBeenCalledOnce();
      await expect(f.service.send({ ...send, text: 'changed' })).rejects.toMatchObject({ code: 'command_conflict' });
      await expect(f.service.send({ ...send, clientCommandId: '66666666-6666-4666-8666-666666666666' })).rejects.toMatchObject({ code: 'command_conflict' });
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  });

  it('does not redispatch an ambiguous prompt and does not cancel it when a new chat is created', async () => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const receipt = await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      const promptCall = f.prompts[0];
      if (!promptCall) throw new Error('fixture expected prompt dispatch');
      await f.service.create(b);
      await waitForCalls(f.calls, 2);
      f.complete(1);
      await vi.waitFor(async () => expect((await f.service.conversation(b.conversationId))?.creation).toBe('ready'));
      expect(promptCall.signal.aborted).toBe(false);
      promptCall.result.reject(new Error('fixture ambiguous transport failure'));
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ runId: receipt.runId, state: 'upstream-unconfirmed' }));
      expect(await f.service.send(send)).toMatchObject({ runId: receipt.runId });
      await expect(f.service.send({ ...send, clientCommandId: '77777777-7777-4777-8777-777777777777' })).rejects.toMatchObject({ code: 'command_conflict' });
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  });
});

describe('R3 definitive local cancellation', () => {
  it('does not release a newer reservation when the cancelled Send capture fails late', async () => {
    const firstCapture = deferred<void>();
    const secondCapture = deferred<void>();
    const base = unitBodies();
    const replace = vi.fn<BodyStore['replace']>(async (key, source, kind) => {
      if (key.owner.kind === 'original') await (key.owner.clientCommandId === '55555555-5555-4555-8555-555555555555' ? firstCapture.promise : secondCapture.promise);
      return base.replace(key, source, kind);
    });
    const f = setup(model, { ...base, replace });
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'first fixture' };
      const first = await f.service.send(send);
      await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());
      const stop = { conversationId: a.conversationId, clientCommandId: '88888888-8888-4888-8888-888888888888', runId: first.runId };
      await f.service.stop(stop);
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, stop.clientCommandId)).toMatchObject({ state: 'cancelled-before-delivery' }));
      const second = { ...send, clientCommandId: '66666666-6666-4666-8666-666666666666', text: 'second fixture' };
      await f.service.send(second);
      await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
      firstCapture.reject(new Error('fixture late capture failure'));
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'original-capture', clientCommandId: send.clientCommandId, state: 'failed' })));
      expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'cancelled-before-delivery' });
      await expect(f.service.send({ ...send, clientCommandId: '77777777-7777-4777-8777-777777777777' })).rejects.toMatchObject({ code: 'command_conflict' });
      expect(f.prompt).not.toHaveBeenCalled();
    } finally { firstCapture.resolve(); secondCapture.resolve(); await f.service.close(); }
  });

  it('releases the Send reservation without resurrecting its command tombstone', async () => {
    const gate = deferred<void>();
    const base = unitBodies();
    const replace = vi.fn<BodyStore['replace']>(async (key, source, kind) => { await gate.promise; return base.replace(key, source, kind); });
    const f = setup(model, { ...base, replace });
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture held body' };
      const registered = await f.service.send(send);
      await vi.waitFor(() => expect(replace).toHaveBeenCalledOnce());
      expect(f.prompt).not.toHaveBeenCalled();
      const stop = { conversationId: a.conversationId, clientCommandId: '88888888-8888-4888-8888-888888888888', runId: registered.runId };
      await f.service.stop(stop);
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, stop.clientCommandId)).toMatchObject({ state: 'cancelled-before-delivery' }));
      expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'cancelled-before-delivery' });
      const next = { ...send, clientCommandId: '66666666-6666-4666-8666-666666666666', text: 'new fixture' };
      expect(await f.service.send(next)).toMatchObject({ kind: 'send', clientCommandId: next.clientCommandId });
      expect(await f.service.send(send)).toMatchObject({ runId: registered.runId, state: 'cancelled-before-delivery' });
      expect(f.prompt).not.toHaveBeenCalled();
      gate.resolve();
      await waitForCalls(f.prompts, 1);
      expect(f.prompts[0]?.input.text).toBe(next.text);
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { gate.resolve(); await f.service.close(); }
  });
});

describe('daemon-owned best-effort Stop dispatch', () => {
  it('registers promptly, cancels the owned pending input, then requests interruption without claiming success', async () => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const sendCommand = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture text' };
      const sent = await f.service.send(sendCommand);
      await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending || !pending.input.id) throw new Error('fixture expected an identified prompt');
      const admitted: SessionPromptOutput = {
        id: pending.input.id, sessionID: sessionId(a.conversationId), time: { created: 1 },
        type: 'user', payload: { text: sendCommand.text }, delivery: 'queue',
      };
      f.inbox.push(admitted);
      pending.result.resolve(admitted);
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, sendCommand.clientCommandId)).toMatchObject({ state: 'admitted' }));
      const stopCommand = { conversationId: a.conversationId, clientCommandId: '88888888-8888-4888-8888-888888888888', runId: sent.runId };
      const receipt = await f.service.stop(stopCommand);
      expect(receipt).toMatchObject({ ...stopCommand, kind: 'stop', state: 'registered' });
      await waitForCalls(f.cancels, 1);
      expect(f.listInbox).toHaveBeenCalledWith({ sessionID: sessionId(a.conversationId) }, expect.any(AbortSignal));
      expect(f.cancelInbox).toHaveBeenCalledExactlyOnceWith({ sessionID: sessionId(a.conversationId), inboxID: pending.input.id }, expect.any(AbortSignal));
      expect(f.interruptSession).not.toHaveBeenCalled();
      expect(await f.service.stop(stopCommand)).toEqual(receipt);
      f.cancels[0]?.result.resolve();
      await vi.waitFor(() => expect(f.interruptSession).toHaveBeenCalledOnce());
      expect(f.interruptSession).toHaveBeenCalledExactlyOnceWith({ sessionID: sessionId(a.conversationId), resume: false }, expect.any(AbortSignal));
      expect(f.order.indexOf('cancel')).toBeLessThan(f.order.indexOf('interrupt'));
      // The fixture interrupt returns false: an acknowledgement is not terminal evidence.
      await expect(f.service.send({ ...sendCommand, clientCommandId: '99999999-9999-4999-8999-999999999999' })).rejects.toMatchObject({ code: 'command_conflict' });
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  });
});

describe('daemon-owned upstream monitor recovery', () => {
  it.each(['eof', 'error'] as const)('reconnects after %s before authority reads without reissuing accepted work', async reason => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture' };
      const receipt = await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      const held = f.prompts[0];
      if (!held) throw new Error('fixture expected owned prompt');
      f.endStream(reason);
      await vi.waitFor(() => expect(f.subscribe.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
      await vi.waitFor(() => {
        const secondConnected = f.order.lastIndexOf('monitor-connected');
        expect(secondConnected).toBeGreaterThan(f.order.indexOf('monitor-connected'));
        expect(f.order.slice(secondConnected + 1)).toContain('active');
      }, { timeout: 8000 });
      expect(held.signal.aborted).toBe(false);
      expect(f.prompt).toHaveBeenCalledOnce();
      expect(f.createSession).toHaveBeenCalledOnce();
      expect(f.interruptSession).not.toHaveBeenCalled();
      expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ runId: receipt.runId });
    } finally { await f.service.close(); }
  }, 12000);

  it('does not adopt a replacement native service after its reported process identity changes', async () => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture' };
      const receipt = await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      f.setServerInfo({ pid: 49124, version: '2.2.2', urls: [], paths: { tmp: '/fixture/tmp' } });
      f.endStream('eof');
      await vi.waitFor(() => expect(f.getServerInfo).toHaveBeenCalled(), { timeout: 8000 });
      await vi.waitFor(async () => await expect(f.service.create(b)).rejects.toMatchObject({ code: 'think_unavailable' }), { timeout: 8000 });
      expect(await authenticatedSnapshot(f)).toMatchObject({ sendEligibility: 'unavailable' });
      expect(await f.service.command(a.conversationId, send.clientCommandId)).not.toMatchObject({ state: 'completed' });
      expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ runId: receipt.runId });
      expect(f.createSession).toHaveBeenCalledOnce();
      expect(f.prompt).toHaveBeenCalledOnce();
      expect(f.interruptSession).not.toHaveBeenCalled();
    } finally { await f.service.close(); }
  }, 12000);

  it('does not reconnect after the daemon service closes', async () => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      await f.service.send({ conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture' });
      await waitForCalls(f.prompts, 1);
      vi.useFakeTimers();
      f.endStream('error');
      await Promise.resolve();
      await Promise.resolve();
      await f.service.close();
      const callsAtClose = f.subscribe.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(f.subscribe).toHaveBeenCalledTimes(callsAtClose);
      expect(f.interruptSession).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await f.service.close();
    }
  });
});

describe('registry-owned restart hydration fences', () => {
  const creationEpoch = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const sendId = '55555555-5555-4555-8555-555555555555';
  const promptId = `msg_memoryloop_${sendId.replaceAll('-', '')}`;
  const original = '  restart-owned original 🧠\r\nnot plugin text  ';
  const assistantId = 'msg_fixture_owned_restart';

  function restoredFixture(currentModel = model) {
    const owner: RegisteredConversation = { conversationId: a.conversationId, nativeSessionId: sessionId(a.conversationId),
      directory: vaultDirectory, owner: { owner: 'memory-loop', conversationId: a.conversationId, epoch: creationEpoch,
        installationId: '99999999-9999-4999-8999-999999999999' }, agent, model, createdAt: 1, creation: 'ready',
      selection: { agent, model, permissions: permissions.map(rule => ({ ...rule })) }, purpose: 'think', lifecycle: 'live', rowVersion: 0 };
    const facts: StoredCommand[] = [
      { receipt: { kind: 'create', ...a, epoch: creationEpoch, state: 'ready' }, payloadSha256: null, original: null,
        registeredAt: 1, attempted: true, nativeMessageId: null },
      { receipt: { kind: 'send', conversationId: a.conversationId, clientCommandId: sendId, epoch: creationEpoch,
        runId: '66666666-6666-4666-8666-666666666666', state: 'completed' },
      payloadSha256: createHash('sha256').update(original).digest('hex'), original: Buffer.from(original),
      registeredAt: 20, attempted: true, nativeMessageId: promptId },
    ];
    let registered = true;
    const state = {
      installationId: owner.owner.installationId ?? '',
      conversations: conversationStateSpies(),
      ...deletionStateSpies(),
      registry: { conversation: vi.fn((id: string) => registered && id === a.conversationId ? structuredClone(owner) : null),
        commands: vi.fn<NonNullable<ThinkStateStore['registry']>['commands']>((id, after) =>
          id === a.conversationId && !after ? structuredClone(facts) : []) },
      command: vi.fn<ThinkStateStore['command']>(id => structuredClone(facts.find(item => item.receipt.clientCommandId === id) ?? null)),
      registerConversation: vi.fn<ThinkStateStore['registerConversation']>(() => { throw new Error('restart must not create ownership'); }),
      registerCommand: vi.fn<ThinkStateStore['registerCommand']>(() => { throw new Error('read-only hydration must not admit work'); }),
      attempted: vi.fn<ThinkStateStore['attempted']>(() => { throw new Error('hydration must not dispatch commands'); }),
      outcome: vi.fn<ThinkStateStore['outcome']>(), close: vi.fn<ThinkStateStore['close']>(),
    } satisfies ThinkStateStore;
    const staged: BodyRef[] = [];
    const bodies = unitBodies();
    const f = setup(currentModel, { ...bodies, async replace(...input) { const ref = await bodies.replace(...input); staged.push(ref); return ref; } },
      vaultDirectory, { state });
    f.sessions.set(owner.nativeSessionId, { id: owner.nativeSessionId, metadata: { memoryLoop: { ...owner.owner } },
      location: { directory: vaultDirectory }, agent, model, permissions: permissions.map(rule => ({ ...rule })) });
    f.messages.push({ id: promptId, type: 'user', text: 'fixture plugin-prepared input', time: { created: 20 } },
      { id: assistantId, type: 'assistant', agent, model, finish: 'stop', time: { created: 22, completed: 23 },
        content: [{ type: 'text', text: 'verified restart answer' }] });
    f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
    return { f, state, owner, staged, unregister() { registered = false; } };
  }
  function noMutation(x: ReturnType<typeof restoredFixture>): void {
    expect(x.f.createSession).not.toHaveBeenCalled();
    expect(x.f.prompt).not.toHaveBeenCalled();
    expect(x.f.cancelInbox).not.toHaveBeenCalled();
    expect(x.f.interruptSession).not.toHaveBeenCalled();
    expect(x.f.replyForm).not.toHaveBeenCalled();
    expect(x.f.replyPermission).not.toHaveBeenCalled();
    expect(x.state.registerConversation).not.toHaveBeenCalled();
    expect(x.state.registerCommand).not.toHaveBeenCalled();
    expect(x.state.attempted).not.toHaveBeenCalled();
  }

  it('never scans or adopts a lookalike native owner without its application registry record', async () => {
    const x = restoredFixture();
    x.unregister();
    const nativeBefore = structuredClone(x.f.sessions.get(x.owner.nativeSessionId));
    try {
      expect(await x.f.service.snapshot(a.conversationId)).toBeNull();
      expect(await x.f.service.snapshot(a.conversationId)).toBeNull();
      expect(x.f.getSession).not.toHaveBeenCalled();
      expect(x.f.listMessages).not.toHaveBeenCalled();
      expect(x.state.registry.commands).not.toHaveBeenCalled();
      expect(x.state.conversations.canonical).not.toHaveBeenCalled();
      expect(x.f.sessions.get(x.owner.nativeSessionId)).toEqual(nativeBefore);
      noMutation(x);
    } finally { await x.f.service.close(); }
  });

  it('rejects changed native vault, identity and pinned selection without publishing or changing ownership', async () => {
    const results: Array<{ binding: string; denied: boolean; staged: number }> = [];
    for (const binding of ['vault', 'native-id', 'selection'] as const) {
      const x = restoredFixture();
      const current = x.f.sessions.get(x.owner.nativeSessionId);
      if (!current) throw new Error('test-owned session missing');
      x.f.sessions.set(x.owner.nativeSessionId, { ...current, ...(binding === 'vault' ? { location: { directory: '/fixture/wrong-vault' } }
        : binding === 'native-id' ? { id: 'ses_fixture_foreign_identity' } : { model: { ...model, id: 'foreign-selection' } }) });
      const nativeBefore = structuredClone(x.f.sessions.get(x.owner.nativeSessionId));
      const storedBefore = structuredClone(x.owner);
      try {
        const result = await x.f.service.snapshot(a.conversationId).then(() => false,
          (error: unknown) => error instanceof Error && 'code' in error && error.code === 'think_unavailable');
        results.push({ binding, denied: result, staged: x.staged.length });
        expect(x.owner).toEqual(storedBefore);
        expect(x.f.sessions.get(x.owner.nativeSessionId)).toEqual(nativeBefore);
        expect(x.state.conversations.canonical).not.toHaveBeenCalled();
        noMutation(x);
      } finally { await x.f.service.close(); }
    }
    expect(results).toEqual(['vault', 'native-id', 'selection'].map(binding => ({ binding, denied: true, staged: 0 })));
  });

  it('uses the stored creation selection rather than different current new-chat model settings', async () => {
    const x = restoredFixture({ ...model, id: 'different-new-chat-model' });
    const nativeBefore = structuredClone(x.f.sessions.get(x.owner.nativeSessionId));
    try {
      const snapshot = await x.f.service.snapshot(a.conversationId);
      expect(snapshot).toMatchObject({ conversationId: a.conversationId, epoch, creation: 'ready', sendEligibility: 'available' });
      expect(snapshot?.epoch).not.toBe(creationEpoch);
      expect(snapshot?.entries).toContainEqual(expect.objectContaining({ kind: 'original', messageId: promptId, clientCommandId: sendId }));
      expect(x.f.sessions.get(x.owner.nativeSessionId)).toEqual(nativeBefore);
      expect(x.state.outcome).not.toHaveBeenCalled();
      noMutation(x);
    } finally { await x.f.service.close(); }
  });

  it.each(['ready', 'owner-changed', 'process-changed', 'service-close'] as const)(
    'coalesces held-history requests and fences publication when %s', async change => {
      const x = restoredFixture();
      const held = deferred<MessageListOutput>();
      x.f.listMessages.mockImplementationOnce(() => held.promise); // Deliberately ignores abort, like a late adapter response.
      let settled = 0;
      const observe = () => x.f.service.snapshot(a.conversationId).then(value => { settled++; return { value }; },
        (error: unknown) => { settled++; return { error }; });
      try {
        const first = observe();
        const second = observe();
        await vi.waitFor(() => expect(x.f.listMessages).toHaveBeenCalledOnce());
        expect(settled).toBe(0);
        const staged = x.staged[0];
        expect(staged, 'the immutable original is privately staged before the held native-history boundary').toBeDefined();
        if (!staged) throw new Error('missing staged original');
        await expect(x.f.service.content.open(staged)).rejects.toMatchObject({ code: 'not_found' });
        if (change === 'owner-changed') {
          const current = x.f.sessions.get(x.owner.nativeSessionId);
          if (!current) throw new Error('test-owned session missing');
          x.f.sessions.set(x.owner.nativeSessionId, { ...current, metadata: { memoryLoop: { ...x.owner.owner, epoch } } });
        } else if (change === 'process-changed') x.f.setServerInfo({ pid: 49124, version: '2.2.2', urls: [], paths: { tmp: '/fixture/tmp' } });
        else if (change === 'service-close') await x.f.service.close();
        held.resolve({ data: [...x.f.messages], cursor: {} });
        const outcomes = await Promise.all([first, second]);
        if (change === 'ready') {
          for (const outcome of outcomes) expect(outcome).toMatchObject({ value: { epoch, creation: 'ready', entries: expect.any(Array) } });
          const [left, right] = outcomes.map(outcome => 'value' in outcome ? outcome.value : null);
          expect(left?.entries.filter(entry => 'body' in entry)).toEqual(right?.entries.filter(entry => 'body' in entry));
          const reader = await x.f.service.content.open(staged);
          try { expect(Buffer.from(await reader.read(0, staged.through)).toString('utf8')).toBe(original); }
          finally { await reader.close(); }
        } else {
          for (const outcome of outcomes) expect(outcome).toMatchObject({ error: { code: 'think_unavailable' } });
          await expect(x.f.service.content.open(staged)).rejects.toMatchObject({ code: change === 'service-close' ? 'think_unavailable' : 'not_found' });
          expect(x.state.conversations.canonical).not.toHaveBeenCalled();
        }
        noMutation(x);
      } finally { held.resolve({ data: [], cursor: {} }); await x.f.service.close(); }
    });
});

describe('owned ordinary form HTTP boundary', () => {
  const authority = '127.0.0.1:3000';
  const token = 'a'.repeat(64);
  const decisionId = 'form_fixture_question';
  const commandId = '88888888-8888-4888-8888-888888888888';
  const base = `/api/think/conversations/${a.conversationId}/decisions`;
  async function readyFixture() {
    const f = setup();
    await f.service.create(a);
    await waitForCalls(f.calls, 1);
    f.complete(0);
    await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
    const app = createApp({ authority, serviceToken: token, think: f.service,
      vault: { reader: { tree: async () => ({ rootIdentity: 'root', entries: [] }), action: async () => ({ id: ['fixture'] }), file: async () => ({ name: 'fixture', kind: 'unsupported' as const }), content: async () => new Response(null, { status: 404 }), note: async () => ({ name: 'fixture', markdown: '', revision: 'fixture-revision', editable: true }), save: async () => ({ revision: 'fixture-revision' }), close: async () => {} } } });
    const request = (path: string, init: RequestInit = {}) => app(new Request(`http://${authority}${path}`, {
      ...init, headers: { host: authority, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    }));
    return { f, request };
  }

  it('lists and reads only owned forms with sanitized public detail', async () => {
    const { f, request } = await readyFixture();
    try {
      const list = await request(base);
      expect(list.status).toBe(200);
      const listBody: unknown = await list.json();
      expect(listBody).toMatchObject({ decisions: [expect.objectContaining({ decisionId, kind: 'form' })] });
      expect(f.listForms).toHaveBeenCalledWith({ sessionID: sessionId(a.conversationId) }, expect.any(AbortSignal));
      const detail = await request(`${base}/${decisionId}`);
      expect(detail.status).toBe(200);
      const detailBody: unknown = await detail.json();
      expect(detailBody).toMatchObject({ decisionId, kind: 'form', title: 'Fixture question', fields: [{ key: 'answer', type: 'string', title: 'Answer', required: true }] });
      expect(JSON.stringify([listBody, detailBody])).not.toContain('do-not-expose');
      expect(JSON.stringify([listBody, detailBody])).not.toContain(sessionId(a.conversationId));
      expect(f.getForm).toHaveBeenCalledWith({ sessionID: sessionId(a.conversationId), formID: decisionId }, expect.any(AbortSignal));
      const unknown = await request(`/api/think/conversations/${b.conversationId}/decisions`);
      expect(unknown.status).toBe(404);
      expect(f.listForms).not.toHaveBeenCalledWith({ sessionID: sessionId(b.conversationId) }, expect.anything());
    } finally { await f.service.close(); }
  });

  it('revalidates an exact pending form before reply and refuses a new stale submission', async () => {
    const { f, request } = await readyFixture();
    try {
      expect((await request(base)).status).toBe(200);
      f.getForm.mockClear();
      const post = (clientCommandId: string, answer: string) => request(`${base}/${decisionId}/reply`, {
        method: 'POST', body: JSON.stringify({ clientCommandId, answer: { answer } }),
      });
      const first = await post(commandId, 'fixture answer');
      expect(first.status).toBe(202);
      const receipt: unknown = await first.json();
      expect(receipt).toMatchObject({ conversationId: a.conversationId, clientCommandId: commandId, decisionId });
      await vi.waitFor(() => expect(f.replyForm).toHaveBeenCalledOnce());
      expect(f.getForm).toHaveBeenCalledWith({ sessionID: sessionId(a.conversationId), formID: decisionId }, expect.any(AbortSignal));
      expect(f.replyForm).toHaveBeenCalledExactlyOnceWith({ sessionID: sessionId(a.conversationId), formID: decisionId, answer: { answer: 'fixture answer' } }, expect.any(AbortSignal));
      expect(f.getForm.mock.invocationCallOrder[0]).toBeLessThan(f.replyForm.mock.invocationCallOrder[0]);
      f.setForm({ ...f.form(), state: { status: 'answered', answer: { answer: 'fixture answer' } } });
      const duplicate = await post(commandId, 'fixture answer');
      expect(duplicate.status).toBe(202);
      expect(await duplicate.json()).toMatchObject({ conversationId: a.conversationId, clientCommandId: commandId, decisionId });
      expect((await post(commandId, 'different answer')).status).toBe(409);
      expect((await post('99999999-9999-4999-8999-999999999999', 'different answer')).status).toBe(409);
      expect(f.replyForm).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  });

  it('rejects unauthenticated form reads and replies before native calls', async () => {
    const { f, request } = await readyFixture();
    try {
      expect((await request(base, { headers: { authorization: `Bearer ${'b'.repeat(64)}` } })).status).toBe(401);
      expect((await request(`${base}/${decisionId}/reply`, { method: 'POST', headers: { origin: 'http://evil.example' }, body: JSON.stringify({ clientCommandId: commandId, answer: { answer: 'fixture' } }) })).status).toBe(403);
      expect(f.listForms).not.toHaveBeenCalled();
      expect(f.getForm).not.toHaveBeenCalled();
      expect(f.replyForm).not.toHaveBeenCalled();
    } finally { await f.service.close(); }
  });
});

describe('R6 positive owned permission incompatibility', () => {
  it('R6 preserves owned pending permission evidence when history fails and ignores stale query results', async () => {
    const f = setup();
    const stale = deferred<PermissionRequestListOutput>();
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      await f.service.send({ conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture' });
      await waitForCalls(f.prompts, 1);
      await vi.waitFor(() => expect(f.listMessages).toHaveBeenCalled());
      await new Promise<void>(resolve => setImmediate(resolve));
      const sid = sessionId(a.conversationId);
      const owned = { id: 'per_fixture_owned', sessionID: sid, action: 'read', resources: ['/fixture-private-path'], message: 'fixture-private-message' };
      f.pendingPermissions.push(owned, { id: 'per_fixture_unrelated', sessionID: 'ses_fixture_tui', action: 'read', resources: ['/fixture-other-private'] });
      f.listMessages.mockImplementation(async () => { throw new Error('fixture-private-history-error'); });
      f.listPermissionRequests.mockImplementationOnce(() => stale.promise);
      const before = f.listPermissionRequests.mock.calls.length;
      f.emit({ type: 'session.execution.started', id: 'evt_fixture_old_query', created: 20,
        durable: { aggregateID: sid, seq: 1, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(() => expect(f.listPermissionRequests.mock.calls.length).toBeGreaterThan(before));
      f.emit({ type: 'permission.asked', id: 'evt_fixture_owned_ask', created: 21, data: owned });
      stale.resolve({ location: { directory: vaultDirectory }, data: [] });
      await vi.waitFor(() => expect(f.listPermissionRequests.mock.calls.length).toBeGreaterThan(before + 1));
      await vi.waitFor(async () => expect(await f.service.conversation(a.conversationId)).toMatchObject({ permissionCompatibility: 'incompatible', permissionPending: true }));
      const state = await f.service.conversation(a.conversationId);
      expect(JSON.stringify(state)).not.toMatch(/fixture-private|fixture-other-private|ses_fixture_tui|per_fixture_unrelated/);
      expect(f.replyPermission).not.toHaveBeenCalled();
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { stale.resolve({ location: { directory: vaultDirectory }, data: [] }); await f.service.close(); }
  });

  it('reports an owned pending ask, recovers it after reconnect, and ignores unrelated permissions without automatic replies', async () => {
    const f = setup();
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture' };
      await f.service.send(send); await waitForCalls(f.prompts, 1);
      const sid = sessionId(a.conversationId);
      const unrelated = { id: 'per_fixture_other', sessionID: 'ses_fixture_unrelated_tui', action: 'read', resources: ['/fixture-secret-other'] };
      f.pendingPermissions.push(unrelated);
      f.emit({ type: 'permission.asked', id: 'evt_fixture_other_permission', created: 20, data: unrelated });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(await f.service.conversation(a.conversationId)).not.toMatchObject({ permissionCompatibility: 'incompatible' });
      const owned = { id: 'per_fixture_owned', sessionID: sid, action: 'read', resources: ['/fixture-secret-owned'], message: 'fixture-secret-message' };
      f.pendingPermissions.push(owned);
      f.emit({ type: 'permission.asked', id: 'evt_fixture_owned_permission', created: 21, data: owned });
      await vi.waitFor(async () => expect(await f.service.conversation(a.conversationId)).toMatchObject({ permissionCompatibility: 'incompatible', permissionPending: true }));
      const status = await f.service.conversation(a.conversationId);
      expect(JSON.stringify(status)).not.toMatch(/fixture-secret|ses_fixture_unrelated_tui|per_fixture_other/);
      f.endStream('error');
      await vi.waitFor(() => expect(f.subscribe.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
      await vi.waitFor(() => expect(f.listPermissionRequests).toHaveBeenCalled(), { timeout: 8000 });
      expect(f.listPermissionRequests).toHaveBeenCalledWith({ location: { directory: vaultDirectory } }, expect.any(AbortSignal));
      expect(await f.service.conversation(a.conversationId)).toMatchObject({ permissionCompatibility: 'incompatible', permissionPending: true });
      expect(f.replyPermission).not.toHaveBeenCalled();
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  }, 12000);
});

describe('R5 positively observed background execution', () => {
  it('R5 keeps a positive background-running observation when a concurrent history read fails', async () => {
    const f = setup();
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture' };
      await f.service.send(send); await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture prompt missing');
      const sid = sessionId(a.conversationId);
      pending.result.resolve({ id: pending.input.id, sessionID: sid, time: { created: 20 }, type: 'user', payload: { text: send.text }, delivery: 'queue' });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'admitted' }));
      f.messages.push({ id: pending.input.id, type: 'user', text: send.text, time: { created: 20 } },
        { id: 'msg_fixture_done', type: 'assistant', agent, model, finish: 'stop', content: [], time: { created: 22, completed: 23 } });
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
      const emit = (id: string, seq: number) => f.emit({ type: 'session.execution.started', id, created: seq,
        durable: { aggregateID: sid, seq, version: 1 }, data: { sessionID: sid } });
      emit('evt_fixture_completed', 24);
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'completed' }));
      f.active[sid] = { type: 'running' };
      const beforeActive = f.activeSessions.mock.calls.length;
      const beforeHistory = f.listMessages.mock.calls.length;
      f.listMessages.mockImplementation(async () => { throw new Error('fixture-private-history-error'); });
      emit('evt_fixture_background', 25);
      await vi.waitFor(() => { expect(f.activeSessions.mock.calls.length).toBeGreaterThan(beforeActive); expect(f.listMessages.mock.calls.length).toBeGreaterThan(beforeHistory); });
      await new Promise<void>(resolve => setImmediate(resolve));
      await vi.waitFor(async () => expect(await authenticatedSnapshot(f)).toMatchObject({ sendEligibility: 'busy' }));
      await expect(f.service.send({ ...send, clientCommandId: '66666666-6666-4666-8666-666666666666' })).rejects.toMatchObject({ code: 'command_conflict' });
      expect(f.prompt).toHaveBeenCalledOnce();
      expect(f.replyPermission).not.toHaveBeenCalled();
      expect(await f.service.conversation(a.conversationId)).not.toMatchObject({ permissionCompatibility: 'incompatible' });
    } finally { await f.service.close(); }
  });

  it('blocks a new Send while background execution is observed and permits it after an inactive refresh', async () => {
    const f = setup();
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      expect(await authenticatedSnapshot(f)).toMatchObject({ sendEligibility: 'available' });
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture original' };
      await f.service.send(send); await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture prompt missing');
      const sid = sessionId(a.conversationId);
      pending.result.resolve({ id: pending.input.id, sessionID: sid, time: { created: 20 }, type: 'user', payload: { text: send.text }, delivery: 'queue' });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'admitted' }));
      f.messages.push({ id: pending.input.id, type: 'user', text: send.text, time: { created: 20 } },
        { id: 'msg_fixture_done', type: 'assistant', agent, model, finish: 'stop', content: [], time: { created: 22, completed: 23 } });
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
      const emit = (id: string, seq: number) => f.emit({ type: 'session.execution.started', id, created: seq,
        durable: { aggregateID: sid, seq, version: 1 }, data: { sessionID: sid } });
      emit('evt_fixture_completion_refresh', 24);
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'completed' }));
      await vi.waitFor(async () => expect(await authenticatedSnapshot(f)).toMatchObject({ sendEligibility: 'available' }));
      f.active[sid] = { type: 'running' };
      const before = f.activeSessions.mock.calls.length;
      emit('evt_fixture_background', 25);
      await vi.waitFor(() => expect(f.activeSessions.mock.calls.length).toBeGreaterThan(before));
      await new Promise<void>(resolve => setImmediate(resolve));
      await vi.waitFor(async () => expect(await authenticatedSnapshot(f)).toMatchObject({ sendEligibility: 'busy' }));
      const next = { ...send, clientCommandId: '66666666-6666-4666-8666-666666666666' };
      await expect(f.service.send(next)).rejects.toMatchObject({ code: 'command_conflict' });
      expect(f.prompt).toHaveBeenCalledOnce();
      delete f.active[sid];
      const after = f.activeSessions.mock.calls.length;
      emit('evt_fixture_background_settled', 26);
      await vi.waitFor(() => expect(f.activeSessions.mock.calls.length).toBeGreaterThan(after));
      await vi.waitFor(async () => expect(await authenticatedSnapshot(f)).toMatchObject({ sendEligibility: 'available' }));
      await vi.waitFor(async () => expect(await f.service.send(next)).toMatchObject({ kind: 'send' }));
    } finally { await f.service.close(); }
  });
});

describe('R5/R6 independent authority channels', () => {
  it('publishes successful activity and pending-permission reads when the concurrent status read rejects after a completed Send', async () => {
    const f = setup();
    const statusFailure = deferred<NativeSession & Pick<SessionInfo, 'time' | 'outcome'>>();
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture original' };
      await f.service.send(send); await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture prompt missing');
      const sid = sessionId(a.conversationId);
      pending.result.resolve({ id: pending.input.id, sessionID: sid, time: { created: 20 }, type: 'user', payload: { text: send.text }, delivery: 'queue' });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'admitted' }));
      f.messages.push({ id: pending.input.id, type: 'user', text: send.text, time: { created: 20 } },
        { id: 'msg_fixture_done', type: 'assistant', agent, model, finish: 'stop', content: [], time: { created: 22, completed: 23 } });
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_completed', created: 24,
        durable: { aggregateID: sid, seq: 1, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'completed' }));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(await f.service.conversation(a.conversationId)).not.toMatchObject({ permissionPending: true });

      // No permission.asked event: only the successful pending read can publish this evidence.
      f.active[sid] = { type: 'running' };
      const owned = { id: 'per_fixture_owned', sessionID: sid, action: 'read', resources: ['/fixture-private-owned'], message: 'fixture-private-permission-message' };
      f.pendingPermissions.push(owned, { id: 'per_fixture_unrelated', sessionID: 'ses_fixture_tui', action: 'read', resources: ['/fixture-private-other'] });
      f.getSession.mockImplementation(() => statusFailure.promise);
      const beforeStatus = f.getSession.mock.calls.length;
      const beforeActive = f.activeSessions.mock.calls.length;
      const beforePermissions = f.listPermissionRequests.mock.calls.length;
      f.emit({ type: 'session.execution.started', id: 'evt_fixture_background', created: 25,
        durable: { aggregateID: sid, seq: 2, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(() => {
        expect(f.getSession.mock.calls.length).toBeGreaterThan(beforeStatus);
        expect(f.activeSessions.mock.calls.length).toBeGreaterThan(beforeActive);
        expect(f.listPermissionRequests.mock.calls.length).toBeGreaterThan(beforePermissions);
      });
      await expect(f.activeSessions.mock.results[beforeActive]?.value).resolves.toEqual({ [sid]: { type: 'running' } });
      await expect(f.listPermissionRequests.mock.results[beforePermissions]?.value).resolves.toMatchObject({ data: [owned, expect.objectContaining({ sessionID: 'ses_fixture_tui' })] });
      // Let both successful nativeCall wrappers settle before rejecting their status sibling.
      await new Promise<void>(resolve => setImmediate(resolve));
      statusFailure.reject(new Error('fixture-private-status-error'));
      await new Promise<void>(resolve => setImmediate(resolve));

      // Soft assertions expose both lost observations instead of hiding R6 behind R5's failure.
      await expect.soft(f.service.send({ ...send, clientCommandId: '66666666-6666-4666-8666-666666666666' })).rejects.toMatchObject({ code: 'command_conflict' });
      const state = await f.service.conversation(a.conversationId);
      expect.soft(state).toMatchObject({ permissionCompatibility: 'incompatible', permissionPending: true });
      expect(JSON.stringify(state)).not.toMatch(/fixture-private|per_fixture|ses_fixture_tui/);
      expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'completed' });
      expect(f.replyPermission).not.toHaveBeenCalled();
      expect.soft(f.prompt).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  });
});

describe('R4 projection capture failure', () => {
  it('settles the run and retains safe tool facts while explicitly reporting missing content, then catches up', async () => {
    const base = unitBodies();
    const failedOrdinals = new Set([0, 1]);
    const replace = vi.fn<BodyStore['replace']>(async (key, source, kind) => {
      if (key.owner.kind === 'assistant-text' && failedOrdinals.has(key.owner.ordinal)) throw new Error('fixture-private-disk-error');
      return base.replace(key, source, kind);
    });
    const f = setup(model, { ...base, replace });
    try {
      await f.service.create(a); await waitForCalls(f.calls, 1); f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture original' };
      await f.service.send(send); await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture prompt missing');
      const sid = sessionId(a.conversationId);
      pending.result.resolve({ id: pending.input.id, sessionID: sid, time: { created: 20 }, type: 'user', payload: { text: send.text }, delivery: 'queue' });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'admitted' }));
      f.messages.push({ id: pending.input.id, type: 'user', text: send.text, time: { created: 20 } },
        { id: 'msg_fixture_capture', type: 'assistant', agent, model, finish: 'stop', time: { created: 22, completed: 23 }, content: [
          { type: 'text', text: 'fixture canonical' },
          { type: 'text', text: 'fixture second canonical' },
          { type: 'tool', id: 'fixture-tool', name: 'custom', time: { created: 22, completed: 23 }, state: { status: 'error', input: {}, error: { type: 'fixture', message: 'fixture-generic-tool-error' } } },
        ] });
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_capture', created: 24,
        durable: { aggregateID: sid, seq: 2, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'completed' }));
      const page = await f.service.content.page(a.conversationId);
      expect(page).toMatchObject({ contentHealth: 'incomplete' });
      expect(page.entries).toContainEqual(expect.objectContaining({ kind: 'tool', category: 'custom', state: 'failed' }));
      expect(await f.service.conversation(a.conversationId)).not.toMatchObject({ permissionCompatibility: 'incompatible' });
      expect(JSON.stringify(page)).not.toMatch(/fixture-private-disk-error|fixture-generic-tool-error/);
      failedOrdinals.delete(0);
      const before = f.listMessages.mock.calls.length;
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_catchup', created: 25,
        durable: { aggregateID: sid, seq: 3, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(() => expect(f.listMessages.mock.calls.length).toBeGreaterThan(before));
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId: 'msg_fixture_capture', ordinal: 0, closure: 'closed' })));
      expect((await f.service.content.page(a.conversationId)).contentHealth).toBe('incomplete');
      failedOrdinals.delete(1);
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_second_catchup', created: 26,
        durable: { aggregateID: sid, seq: 4, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(async () => {
        const repaired = await f.service.content.page(a.conversationId);
        expect(repaired.entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId: 'msg_fixture_capture', ordinal: 1, closure: 'closed' }));
        expect(repaired.contentHealth).toBe('complete');
      });
      expect(f.prompt).toHaveBeenCalledOnce();
      expect(await f.service.send({ ...send, clientCommandId: '66666666-6666-4666-8666-666666666666' })).toMatchObject({ kind: 'send' });
    } finally { await f.service.close(); }
  });
});

describe('daemon-owned authoritative terminal reconciliation', () => {
  it('reconciles a quiet completed run without a terminal event or browser subscriber', async () => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'quiet fixture' };
      await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture expected an identified prompt');
      pending.result.resolve({ id: pending.input.id, sessionID: sessionId(a.conversationId), time: { created: 20 }, type: 'user', payload: { text: send.text }, delivery: 'queue' });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'admitted' }));
      // Ensure the first refresh has observed the incomplete snapshot before changing it.
      await vi.waitFor(() => expect(f.listMessages).toHaveBeenCalled());
      await new Promise<void>(resolve => setImmediate(resolve));
      f.messages.push(
        { id: pending.input.id, type: 'user', text: send.text, time: { created: 20 }, metadata: pending.input.metadata },
        { id: 'msg_fixture_answer', type: 'assistant', agent, model, content: [], finish: 'stop', time: { created: 22, completed: 23 } },
      );
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
      const previous = f.listMessages.mock.calls.length;
      await vi.waitFor(async () => {
        expect(f.listMessages.mock.calls.length).toBeGreaterThan(previous);
        expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'completed' });
      }, { timeout: 12_000, interval: 50 });
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  }, 15_000);

  it.each(['failed', 'interrupted'] as const)('settles the current %s run honestly and releases its reservation', async outcome => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture text' };
      const receipt = await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture expected an identified prompt');
      const promptId = pending.input.id;
      pending.result.resolve({ id: promptId, sessionID: sessionId(a.conversationId), time: { created: 20 }, type: 'user', payload: { text: send.text }, delivery: 'queue' });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'admitted' }));
      f.messages.push({ id: promptId, type: 'user', text: send.text, time: { created: 20 } });
      const sid = sessionId(a.conversationId);
      f.active[sid] = { type: 'running' };
      f.setStatus({ time: { created: 1, updated: 21, busy: 21 } });
      const beforeStart = f.activeSessions.mock.calls.length;
      f.emit({ type: 'session.execution.started', id: 'evt_fixture_started', created: 21,
        durable: { aggregateID: sid, seq: 1, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(() => expect(f.activeSessions.mock.calls.length).toBeGreaterThan(beforeStart));
      const next = { ...send, clientCommandId: '66666666-6666-4666-8666-666666666666' };
      await expect(f.service.send(next)).rejects.toMatchObject({ code: 'command_conflict' });

      delete f.active[sid];
      f.setStatus({ outcome, time: { created: 1, updated: 24, busy: 21, idle: 24 } });
      const error = { type: 'fixture_error', message: 'controlled fixture error' };
      if (outcome === 'failed') f.messages.push({ id: 'msg_fixture_error', type: 'assistant', agent, model, content: [], finish: 'error', error, time: { created: 22, completed: 23 } });
      const common = { id: 'evt_fixture_terminal', created: 24, durable: { aggregateID: sid, seq: 2, version: 1 as const } };
      f.emit(outcome === 'failed'
        ? { ...common, type: 'session.execution.failed', data: { sessionID: sid, error } }
        : { ...common, type: 'session.execution.interrupted', data: { sessionID: sid, reason: 'user' } });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ runId: receipt.runId, state: outcome }));
      expect(JSON.stringify(await f.service.command(a.conversationId, send.clientCommandId))).not.toContain(error.message);
      expect(await f.service.send(next)).toMatchObject({ kind: 'send', clientCommandId: next.clientCommandId });
    } finally { await f.service.close(); }
  });

  it('aborts a failed refresh sibling before another refresh or service close', async () => {
    const f = setup();
    const statusFailure = deferred<NativeSession & Pick<SessionInfo, 'time' | 'outcome'>>();
    const heldActive = deferred<SessionActiveOutput>();
    let firstSignal: AbortSignal | undefined;
    let overlap = false;
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      f.getSession.mockImplementationOnce(() => statusFailure.promise);
      f.activeSessions.mockImplementationOnce(signal => {
        firstSignal = signal;
        return heldActive.promise;
      });
      f.activeSessions.mockImplementation(async () => {
        if (firstSignal && !firstSignal.aborted) overlap = true;
        return {};
      });
      await f.service.send({ conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture text' });
      await vi.waitFor(() => expect(firstSignal).toBeDefined());
      statusFailure.reject(new Error('fixture status read failed'));
      // Allow the rejected public read to settle before requesting another refresh.
      await new Promise<void>(resolve => setImmediate(resolve));
      f.emit({ type: 'session.execution.started', id: 'evt_fixture_refresh', created: 21,
        durable: { aggregateID: sessionId(a.conversationId), seq: 1, version: 1 }, data: { sessionID: sessionId(a.conversationId) } });
      await vi.waitFor(() => expect(f.activeSessions.mock.calls.length).toBeGreaterThanOrEqual(2));
      await f.service.close();
      expect(firstSignal?.aborted).toBe(true);
      expect(overlap).toBe(false);
    } finally {
      heldActive.resolve({});
      await f.service.close();
    }
  });

  it('keeps stale work reserved and completes when native busy precedes the current user message', async () => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'current fixture text' };
      await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      const promptCall = f.prompts[0];
      if (!promptCall?.input.id) throw new Error('fixture expected an identified prompt');
      const promptId = promptCall.input.id;
      promptCall.result.resolve({ id: promptId, sessionID: sessionId(a.conversationId), time: { created: 20 }, type: 'user', payload: { text: send.text }, delivery: 'queue' });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'admitted' }));
      const next = { ...send, clientCommandId: '66666666-6666-4666-8666-666666666666', text: 'next fixture text' };
      await expect(f.service.send(next)).rejects.toMatchObject({ code: 'command_conflict' });

      // An old successful exchange and an inactive map are not evidence for this Send.
      f.messages.push(
        { id: 'msg_fixture_old', type: 'user', text: 'old fixture', time: { created: 2 } },
        { id: 'msg_fixture_old_answer', type: 'assistant', agent, model, content: [], finish: 'stop', time: { created: 3, completed: 4 } },
      );
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 4, busy: 2, idle: 4 } });
      f.emit({ type: 'session.execution.started', id: 'evt_fixture_started', created: 21,
        durable: { aggregateID: sessionId(a.conversationId), seq: 1, version: 1 }, data: { sessionID: sessionId(a.conversationId) } });
      await vi.waitFor(() => { expect(f.activeSessions).toHaveBeenCalled(); expect(f.listMessages).toHaveBeenCalled(); });
      expect(f.order.indexOf('monitor')).toBeLessThan(f.order.indexOf('active'));
      await expect(f.service.send(next)).rejects.toMatchObject({ code: 'command_conflict' });

      f.messages.push(
        { id: promptId, type: 'user', text: send.text, time: { created: 20 }, metadata: promptCall.input.metadata },
        { id: 'msg_fixture_current_answer', type: 'assistant', agent, model, content: [], finish: 'stop', time: { created: 22, completed: 23 } },
      );
      // Native 2.2.2 can mark busy before promoting the admitted user message.
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 19, idle: 24 } });
      const previousQueries = f.listMessages.mock.calls.length;
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_succeeded', created: 24,
        durable: { aggregateID: sessionId(a.conversationId), seq: 2, version: 1 }, data: { sessionID: sessionId(a.conversationId) } });
      await vi.waitFor(() => expect(f.listMessages.mock.calls.length).toBeGreaterThan(previousQueries));
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'completed' }));
      await vi.waitFor(async () => expect(await f.service.send(next)).toMatchObject({ kind: 'send', clientCommandId: next.clientCommandId }));
    } finally { await f.service.close(); }
  });

  it('does not attribute an answer after an intervening user message to the current Send', async () => {
    const f = setup();
    try {
      await f.service.create(a);
      await waitForCalls(f.calls, 1);
      f.complete(0);
      await vi.waitFor(async () => expect((await f.service.conversation(a.conversationId))?.creation).toBe('ready'));
      const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'fixture text' };
      await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      const pending = f.prompts[0];
      if (!pending?.input.id) throw new Error('fixture expected an identified prompt');
      const promptId = pending.input.id;
      pending.result.resolve({ id: promptId, sessionID: sessionId(a.conversationId), time: { created: 20 }, type: 'user', payload: { text: send.text }, delivery: 'queue' });
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'admitted' }));
      f.messages.push(
        { id: promptId, type: 'user', text: send.text, time: { created: 20 } },
        { id: 'msg_fixture_other', type: 'user', text: 'other fixture input', time: { created: 21 } },
        { id: 'msg_fixture_other_answer', type: 'assistant', agent, model, content: [], finish: 'stop', time: { created: 22, completed: 23 } },
      );
      f.setStatus({ outcome: 'succeeded', time: { created: 1, updated: 24, busy: 21, idle: 24 } });
      const previousQueries = f.listMessages.mock.calls.length;
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_other', created: 24,
        durable: { aggregateID: sessionId(a.conversationId), seq: 2, version: 1 }, data: { sessionID: sessionId(a.conversationId) } });
      await vi.waitFor(() => expect(f.listMessages.mock.calls.length).toBeGreaterThan(previousQueries));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ state: 'admitted' });
      await expect(f.service.send({ ...send, clientCommandId: '66666666-6666-4666-8666-666666666666' })).rejects.toMatchObject({ code: 'command_conflict' });
    } finally { await f.service.close(); }
  });
});
