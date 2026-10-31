import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventSubscribeInput, OpenCodeEvent, SessionCreateInput, SessionGetInput, SessionPromptInput, SessionPromptOutput } from '@opencode/client';
import type { SessionInboxListInput, SessionInboxListOutput, SessionInboxCancelInput, SessionInterruptInput, SessionInterruptOutput } from '@opencode/client';
import type { MessageListInput, MessageListOutput, ServerInfo, SessionActiveOutput, SessionInfo } from '@opencode/client';
import type { SessionFormListInput, SessionFormListOutput, SessionFormGetInput, SessionFormGetOutput, SessionFormReplyInput, SessionFormReplyOutput } from '@opencode/client';
import type { PermissionReplyInput, PermissionRequestListInput, PermissionRequestListOutput } from '@opencode/client';
import { createThinkService, type ThinkServiceOptions } from './think/service';
import { createApp } from './app';
import type { NativeSession, NativeSessions } from './think/native';
import type { BodyKey, BodyRef, BodyStore } from './think/body-store';
import * as bodyModule from './think/body-store';
import type { ThinkContentReader } from './think/projection';

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
    async close() { data.clear(); },
  };
}

function setup(selectedModel: ThinkServiceOptions['context']['model'] = model, bodies?: BodyStore, directory = vaultDirectory) {
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
  const native = { createSession, getSession, subscribe, prompt, listInbox, cancelInbox, interruptSession, activeSessions, listMessages, getServerInfo, listForms, getForm, replyForm, listPermissionRequests, replyPermission } satisfies NativeSessions & {
    subscribe(input: EventSubscribeInput, signal: AbortSignal): AsyncIterable<OpenCodeEvent>;
    prompt(input: SessionPromptInput, signal: AbortSignal): Promise<SessionPromptOutput>;
    listInbox(input: SessionInboxListInput, signal: AbortSignal): Promise<SessionInboxListOutput>;
    cancelInbox(input: SessionInboxCancelInput, signal: AbortSignal): Promise<void>;
    interruptSession(input: SessionInterruptInput, signal: AbortSignal): Promise<SessionInterruptOutput>;
    activeSessions(signal: AbortSignal): Promise<SessionActiveOutput>;
    listMessages(input: MessageListInput, signal: AbortSignal): Promise<MessageListOutput>;
    getServerInfo(signal: AbortSignal): Promise<ServerInfo>;
    listForms(input: SessionFormListInput, signal: AbortSignal): Promise<SessionFormListOutput>;
    getForm(input: SessionFormGetInput, signal: AbortSignal): Promise<SessionFormGetOutput>;
    replyForm(input: SessionFormReplyInput, signal: AbortSignal): Promise<SessionFormReplyOutput>;
    listPermissionRequests(input: PermissionRequestListInput, signal: AbortSignal): Promise<PermissionRequestListOutput>;
    replyPermission(input: PermissionReplyInput, signal: AbortSignal): Promise<void>;
  };
  const options: ThinkServiceOptions = { native, context: { directory, agent, model: selectedModel }, epoch,
    serviceIdentity: { pid: 49123, version: '2.2.2' }, bodies: bodies ?? unitBodies() };
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
  return { service, createSession, getSession, calls, sessions, complete, subscribe, prompt, prompts, order, listInbox, cancelInbox, cancels, interruptSession, inbox, activeSessions, listMessages, active, messages, setStatus, emit, endStream, getServerInfo, setServerInfo, listForms, getForm, replyForm, setForm, form: () => form, listPermissionRequests, pendingPermissions, replyPermission };
}

async function waitForCalls(calls: unknown[], count: number) {
  await vi.waitFor(() => expect(calls).toHaveLength(count));
}

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
    // NativeSessions exposes only create/get; close has no process-stop or interrupt capability.
    expect(f.createSession).toHaveBeenCalledOnce();
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

  it('exposes the flat content reader contract for downstream owners', async () => {
    const body = bodyFixture();
    const f = setup(model, body.bodies);
    try {
      const content: unknown = Reflect.get(f.service, 'content');
      expect(content).toMatchObject({ page: expect.any(Function), open: expect.any(Function) });
    } finally { await f.service.close(); }
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
    type Factory = (options: { directory: string; epoch: string; vaultDirectory: string }) => Promise<BodyStore>;
    const candidate: unknown = Reflect.get(bodyModule, 'createBodyStore');
    if (typeof candidate !== 'function') throw new Error('Missing requested createBodyStore factory export');
    const createBodyStore = candidate as Factory;
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
      const content: unknown = Reflect.get(f.service, 'content');
      function isContentReader(value: unknown): value is ThinkContentReader {
        return typeof value === 'object' && value !== null && 'page' in value && typeof value.page === 'function' && 'open' in value && typeof value.open === 'function';
      }
      if (!isContentReader(content)) throw new Error('Missing requested Think content reader');
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
    const bodies = await bodyModule.createBodyStore({ directory: join(root, 'bodies'), vaultDirectory: vault, epoch });
    const f = setup(model, bodies, vault);
    return { f, root, async close() { try { await f.service.close(); } finally { await rm(root, { recursive: true, force: true }); } } };
  }
  const send = { conversationId: a.conversationId, clientCommandId: '55555555-5555-4555-8555-555555555555', text: 'original fixture 🧠' };

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
      await f.service.send(send);
      await waitForCalls(f.prompts, 1);
      const sid = sessionId(a.conversationId);
      const messageId = 'msg_fixture_preview';
      f.emit({ type: 'session.text.started', id: 'evt_fixture_text_start', created: 20,
        durable: { aggregateID: sid, seq: 1, version: 1 }, data: { sessionID: sid, assistantMessageID: messageId, ordinal: 0 } });
      f.emit({ type: 'session.text.delta', id: 'evt_fixture_text_delta', created: 21,
        data: { sessionID: sid, assistantMessageID: messageId, ordinal: 0, delta: 'observed partial' } });
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId, closure: 'open' })));
      f.endStream('error');
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId, closure: 'open', capture: 'incomplete' })), { timeout: 8000 });
      const partial = (await f.service.content.page(a.conversationId)).entries.find(entry => entry.kind === 'assistant-text' && entry.messageId === messageId);
      if (!partial || partial.kind !== 'assistant-text') throw new Error('partial fixture projection missing');
      const partialReader = await f.service.content.open(partial.body);
      try { expect(Buffer.from(await partialReader.read(0, partial.body.through)).toString('utf8')).toBe('observed partial'); } finally { await partialReader.close(); }
      await vi.waitFor(() => expect(f.subscribe.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
      f.messages.push({ id: messageId, type: 'assistant', agent, model, finish: 'stop', time: { created: 22, completed: 23 }, content: [{ type: 'text', text: 'canonical fixture' }] });
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_text_end', created: 24,
        durable: { aggregateID: sid, seq: 2, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId, closure: 'closed', capture: 'complete' })));
      const canonical = (await f.service.content.page(a.conversationId)).entries.find(entry => entry.kind === 'assistant-text' && entry.messageId === messageId);
      if (!canonical || canonical.kind !== 'assistant-text') throw new Error('canonical fixture projection missing');
      const canonicalReader = await f.service.content.open(canonical.body);
      try { expect(Buffer.from(await canonicalReader.read(0, canonical.body.through)).toString('utf8')).toBe('canonical fixture'); } finally { await canonicalReader.close(); }
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
        vault: { reader: { tree: async () => ({ entries: [] }), note: async () => ({ name: 'fixture', markdown: '' }), close: async () => {} } } });
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
      await vi.waitFor(async () => expect(await f.service.command(a.conversationId, send.clientCommandId)).toMatchObject({ runId: receipt.runId }));
      expect(await f.service.send(send)).toMatchObject({ runId: receipt.runId });
      await expect(f.service.send({ ...send, clientCommandId: '77777777-7777-4777-8777-777777777777' })).rejects.toMatchObject({ code: 'command_conflict' });
      expect(f.prompt).toHaveBeenCalledOnce();
    } finally { await f.service.close(); }
  });
});

describe('R3 definitive local cancellation', () => {
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
      vault: { reader: { tree: async () => ({ entries: [] }), note: async () => ({ name: 'fixture', markdown: '' }), close: async () => {} } } });
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
      f.active[sid] = { type: 'running' };
      const before = f.activeSessions.mock.calls.length;
      emit('evt_fixture_background', 25);
      await vi.waitFor(() => expect(f.activeSessions.mock.calls.length).toBeGreaterThan(before));
      await new Promise<void>(resolve => setImmediate(resolve));
      const next = { ...send, clientCommandId: '66666666-6666-4666-8666-666666666666' };
      await expect(f.service.send(next)).rejects.toMatchObject({ code: 'command_conflict' });
      expect(f.prompt).toHaveBeenCalledOnce();
      delete f.active[sid];
      const after = f.activeSessions.mock.calls.length;
      emit('evt_fixture_background_settled', 26);
      await vi.waitFor(() => expect(f.activeSessions.mock.calls.length).toBeGreaterThan(after));
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
    let failAssistant = true;
    const replace = vi.fn<BodyStore['replace']>(async (key, source, kind) => {
      if (key.owner.kind === 'assistant-text' && failAssistant) throw new Error('fixture-private-disk-error');
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
      failAssistant = false;
      const before = f.listMessages.mock.calls.length;
      f.emit({ type: 'session.execution.succeeded', id: 'evt_fixture_catchup', created: 25,
        durable: { aggregateID: sid, seq: 3, version: 1 }, data: { sessionID: sid } });
      await vi.waitFor(() => expect(f.listMessages.mock.calls.length).toBeGreaterThan(before));
      await vi.waitFor(async () => expect((await f.service.content.page(a.conversationId)).entries).toContainEqual(expect.objectContaining({ kind: 'assistant-text', messageId: 'msg_fixture_capture', closure: 'closed' })));
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
