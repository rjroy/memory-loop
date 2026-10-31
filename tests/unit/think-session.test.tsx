import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createThinkSession, type ThinkSessionOptions } from '../../src/think/session';
import { createThinkClient, ThinkClientError, type ThinkSnapshot, type ThinkWatchHandlers } from '../../src/think/client';
import type { CreateReceipt, SendReceipt } from '../../backend/think/contract';
import type { BodyRef } from '../../backend/think/body-store';
import { createHash, webcrypto } from 'node:crypto';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const c = '33333333-3333-4333-8333-333333333333';
const commandId = '44444444-4444-4444-8444-444444444444';
const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pageCursor = `page.${'a'.repeat(64)}`;
const snapshot = (id: string, extras: Partial<ThinkSnapshot> = {}): ThinkSnapshot => ({ conversationId: id, epoch, revision: 1, creation: 'ready', sendEligibility: 'available', entries: [], ...extras });
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('uninitialized fixture'); };
  let reject: (error: Error) => void = () => { throw new Error('uninitialized fixture'); };
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture(pointerValue: string | null = null) {
  const watches: Array<{ id: string; handlers: ThinkWatchHandlers; close: ReturnType<typeof vi.fn> }> = [];
  const client: NonNullable<ThinkSessionOptions['client']> = {
    snapshot: vi.fn(async id => snapshot(id)),
    watch: vi.fn((id, handlers) => { const close = vi.fn(); watches.push({ id, handlers, close }); return close; }),
    create: vi.fn(async command => ({ ...command, epoch, kind: 'create', state: 'registered' })),
    receipt: vi.fn<NonNullable<ThinkSessionOptions['client']>['receipt']>(async (id, clientCommandId) => ({ conversationId: id, clientCommandId, epoch, kind: 'create', state: 'registered' })),
    send: vi.fn<ReturnType<typeof createThinkClient>['send']>(async command => ({ conversationId: command.conversationId, clientCommandId: command.clientCommandId, epoch, kind: 'send', state: 'registered', runId: b })),
    stop: vi.fn<ReturnType<typeof createThinkClient>['stop']>(async command => ({ ...command, epoch, kind: 'stop', state: 'requested' })),
    decisions: vi.fn<ReturnType<typeof createThinkClient>['decisions']>(async () => []),
    decision: vi.fn<ReturnType<typeof createThinkClient>['decision']>(async () => { throw new Error('unexpected fixture decision'); }),
    reply: vi.fn<ReturnType<typeof createThinkClient>['reply']>(async () => { throw new Error('unexpected fixture reply'); }),
    chunk: vi.fn<ReturnType<typeof createThinkClient>['chunk']>(async () => { throw new Error('unexpected fixture chunk'); }),
  };
  const pointer = { read: vi.fn(() => pointerValue), write: vi.fn() };
  const navigate = vi.fn();
  const ids = [c, commandId];
  const session = createThinkSession({ client, pointer, navigate, randomUUID: () => ids.shift() ?? commandId });
  return { client, pointer, navigate, session, watches };
}
const think = (id: string) => ({ pathname: '/think', search: `?conversation=${id}` });

describe('Think read-side session ownership', () => {
  it('creates exactly one first conversation only on bare Think activation and keeps typing during creation', async () => {
    const f = fixture();
    const ack = deferred<CreateReceipt>();
    vi.mocked(f.client.create).mockReturnValue(ack.promise);
    try {
      f.session.setLocation({ pathname: '/ground', search: '' });
      expect(f.client.create).not.toHaveBeenCalled();
      f.session.setLocation({ pathname: '/think', search: '' });
      await waitFor(() => expect(f.client.create).toHaveBeenCalledOnce());
      expect(vi.mocked(f.client.create).mock.calls[0]?.[0]).toEqual({ conversationId: c, clientCommandId: commandId });
      expect(f.navigate).toHaveBeenCalledWith(`/think?conversation=${c}`, { replace: true, focus: 'preserve' });
      expect(f.pointer.write).toHaveBeenCalledWith(c);
      expect(f.session.getSnapshot().identity).toEqual({ conversationId: c, epoch: null });
      f.session.editDraft('typing while created');
      f.session.setLocation(think(c));
      f.session.setLocation(think(c));
      expect(f.client.create).toHaveBeenCalledOnce();
      ack.resolve({ conversationId: c, clientCommandId: commandId, epoch, kind: 'create', state: 'registered' });
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: c, epoch }));
      expect(f.session.getSnapshot().draft.text).toBe('typing while created');
      f.session.setLocation({ pathname: '/ground', search: '' });
      f.session.setLocation(think(c));
      await waitFor(() => expect(f.client.snapshot).toHaveBeenCalled());
      expect(f.client.create).toHaveBeenCalledOnce();
    } finally { f.session.close(); }
  });

  it('keeps the first identity after an ambiguous create and checks that receipt without replay', async () => {
    const f = fixture();
    vi.mocked(f.client.create).mockRejectedValue(new ThinkClientError('transport', undefined, undefined, 'unknown'));
    try {
      f.session.setLocation({ pathname: '/think', search: '' });
      await waitFor(() => expect(f.client.create).toHaveBeenCalledOnce());
      expect(f.navigate).toHaveBeenCalledWith(`/think?conversation=${c}`, { replace: true, focus: 'preserve' });
      expect(f.pointer.write).toHaveBeenCalledWith(c);
      await waitFor(() => expect(f.session.getSnapshot().newChat).toBe('unavailable'));
      expect(f.session.getSnapshot().identity?.conversationId).toBe(c);
      f.session.checkConnection();
      await waitFor(() => expect(vi.mocked(f.client.receipt).mock.calls.some(([id, command]) => id === c && command === commandId)).toBe(true));
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: c, epoch }));
      expect(f.client.create).toHaveBeenCalledOnce();
      expect(f.navigate).toHaveBeenCalledTimes(1);
    } finally { f.session.close(); }
  });

  it('prefers the explicit URL identity to the tab pointer and rejects an unsafe target', async () => {
    const f = fixture(b);
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: a, epoch }));
      expect(f.client.snapshot).toHaveBeenCalledWith(a, undefined, expect.any(AbortSignal));
      expect(f.pointer.read).not.toHaveBeenCalled();
      expect(f.client.create).not.toHaveBeenCalled();
      f.session.setLocation(think('../outside'));
      expect(f.session.getSnapshot().connection).toBe('unavailable');
      expect(f.client.snapshot).toHaveBeenCalledTimes(1);
      expect(f.client.create).not.toHaveBeenCalled();
    } finally { f.session.close(); }
  });

  it('uses the valid per-tab pointer only when URL has no identity', async () => {
    const f = fixture(b);
    try {
      f.session.setLocation({ pathname: '/think', search: '' });
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: b, epoch }));
      expect(f.navigate).toHaveBeenCalledWith(`/think?conversation=${b}`, { replace: true, focus: 'preserve' });
      expect(f.client.snapshot).toHaveBeenCalledWith(b, undefined, expect.any(AbortSignal));
      expect(f.client.create).not.toHaveBeenCalled();
    } finally { f.session.close(); }
  });

  it('retains a versioned draft across deactivation and reactivation while closing only its watch', async () => {
    const f = fixture();
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.watches).toHaveLength(1));
      f.session.editDraft('draft 🧠');
      const draft = f.session.getSnapshot().draft;
      f.session.setLocation({ pathname: '/recall', search: '' });
      expect(f.watches[0].close).toHaveBeenCalledOnce();
      expect(f.session.getSnapshot().connection).toBe('inactive');
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.watches).toHaveLength(2));
      expect(f.session.getSnapshot().draft).toEqual(draft);
      expect(f.client.create).not.toHaveBeenCalled();
    } finally { f.session.close(); }
    expect(f.watches[1].close).toHaveBeenCalledOnce();
  });

  it('fences a delayed old-conversation snapshot after selecting a different conversation', async () => {
    const f = fixture();
    const old = deferred<ThinkSnapshot>();
    vi.mocked(f.client.snapshot).mockImplementation(id => id === a ? old.promise : Promise.resolve(snapshot(id)));
    try {
      f.session.setLocation(think(a));
      f.session.setLocation(think(b));
      old.resolve(snapshot(a));
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: b, epoch }));
      expect(f.session.getSnapshot().snapshot?.conversationId).toBe(b);
      expect(f.watches.every(watch => watch.id === b)).toBe(true);
    } finally { f.session.close(); }
  });

  it('loads oldest-first manifest pages forward before declaring history complete', async () => {
    const f = fixture();
    const entry = (id: string, order: number): ThinkSnapshot['entries'][number] => ({ kind: 'compaction', displayOrder: order, sessionId: 'ses_fixture', eventId: id, phase: 'ended', sourceTime: order, sourceSequence: order });
    vi.mocked(f.client.snapshot).mockImplementation(async (id, cursor) => cursor === undefined
      ? snapshot(id, { entries: [entry('evt_first', 1)], nextCursor: pageCursor })
      : snapshot(id, { entries: [entry('evt_next', 2)] }));
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getSnapshot().history).toBe('complete'));
      expect(f.session.getSnapshot().entries.map(item => item.displayOrder)).toEqual([1, 2]);
      expect(f.client.snapshot).toHaveBeenNthCalledWith(2, a, pageCursor, expect.any(AbortSignal));
    } finally { f.session.close(); }
  });

  it('rechecks the same conversation after watch loss without creating or resending', async () => {
    const f = fixture();
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.watches).toHaveLength(1));
      f.watches[0].handlers.snapshot(snapshot(a));
      await waitFor(() => expect(f.session.getSnapshot().connection).toBe('following'));
      f.watches[0].handlers.error(new ThinkClientError('transport'));
      expect(f.session.getSnapshot().connection).toBe('reconnecting');
      f.session.checkConnection();
      await waitFor(() => expect(f.watches).toHaveLength(2));
      expect(f.client.create).not.toHaveBeenCalled();
      expect(f.client.receipt).not.toHaveBeenCalled();
      expect(vi.mocked(f.client.snapshot).mock.calls.every(([id]) => id === a)).toBe(true);
    } finally { f.session.close(); }
  });

  it('confirms a nonempty draft before creating exactly one New chat and closes the old watch', async () => {
    const f = fixture();
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.watches).toHaveLength(1));
      f.session.editDraft('unsent');
      f.session.requestNewChat();
      expect(f.session.getSnapshot().newChat).toBe('confirm-discard');
      f.session.cancelNewChat();
      expect(f.session.getSnapshot().draft.text).toBe('unsent');
      expect(f.client.create).not.toHaveBeenCalled();
      f.session.requestNewChat();
      f.session.confirmNewChat();
      f.session.confirmNewChat();
      await waitFor(() => expect(f.client.create).toHaveBeenCalledOnce());
      expect(f.client.create).toHaveBeenCalledWith({ conversationId: c, clientCommandId: commandId });
      expect(f.watches[0].close).toHaveBeenCalledOnce();
      expect(f.session.getSnapshot().draft.text).toBe('');
      expect(f.navigate).toHaveBeenCalledWith(`/think?conversation=${c}`, { replace: true, focus: 'preserve' });
    } finally { f.session.close(); }
  });
});

describe('Think session command ownership', () => {
  it('sends one immutable command for a draft version and preserves a newer edit after acknowledgement', async () => {
    const f = fixture();
    const ack = deferred<SendReceipt>();
    vi.mocked(f.client.send).mockReturnValue(ack.promise);
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: a, epoch }));
      f.session.editDraft('first text');
      const version = f.session.getSnapshot().draft.version;
      const view = f.session.getPresentation();
      view.actions.send({ conversationId: a, epoch }, version);
      view.actions.send({ conversationId: a, epoch }, version);
      await waitFor(() => expect(f.client.send).toHaveBeenCalledOnce());
      expect(vi.mocked(f.client.send).mock.calls[0]?.[0]).toMatchObject({ conversationId: a, clientCommandId: c, text: 'first text' });
      f.session.editDraft('newer text');
      ack.resolve({ conversationId: a, clientCommandId: c, epoch, kind: 'send', state: 'registered', runId: b });
      await waitFor(() => expect(f.session.getPresentation().state.composer).toMatchObject({ kind: 'stop', runId: b }));
      expect(f.session.getSnapshot().draft.text).toBe('newer text');
      expect(f.client.send).toHaveBeenCalledOnce();
    } finally { f.session.close(); }
  });

  it('clears only an acknowledged unchanged draft and leaves the editor available', async () => {
    const f = fixture();
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: a, epoch }));
      f.session.editDraft('exact captured text');
      const view = f.session.getPresentation();
      view.actions.send({ conversationId: a, epoch }, f.session.getSnapshot().draft.version);
      await waitFor(() => expect(f.client.send).toHaveBeenCalledOnce());
      await waitFor(() => expect(f.session.getSnapshot().draft.text).toBe(''));
    } finally { f.session.close(); }
  });

  it('checks unknown Send delivery using the same receipt identity without a second POST', async () => {
    const f = fixture();
    vi.mocked(f.client.send).mockRejectedValue(new ThinkClientError('transport', undefined, undefined, 'unknown'));
    vi.mocked(f.client.receipt).mockResolvedValue({ conversationId: a, clientCommandId: c, epoch, kind: 'send', state: 'admitted', runId: b });
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: a, epoch }));
      f.session.editDraft('uncertain original');
      const view = f.session.getPresentation();
      view.actions.send({ conversationId: a, epoch }, f.session.getSnapshot().draft.version);
      await waitFor(() => expect(vi.mocked(f.client.receipt).mock.calls.some(([id, command]) => id === a && command === c)).toBe(true));
      expect(f.client.send).toHaveBeenCalledOnce();
    } finally { f.session.close(); }
  });

  it('requests Stop only for the recorded run and does not assert interruption from its acknowledgement', async () => {
    const f = fixture();
    const ack = deferred<SendReceipt>();
    vi.mocked(f.client.send).mockReturnValue(ack.promise);
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: a, epoch }));
      f.session.editDraft('fixture work');
      const view = f.session.getPresentation();
      view.actions.send({ conversationId: a, epoch }, f.session.getSnapshot().draft.version);
      ack.resolve({ conversationId: a, clientCommandId: c, epoch, kind: 'send', state: 'admitted', runId: b });
      await waitFor(() => expect(f.session.getPresentation().state.composer).toMatchObject({ kind: 'stop', runId: b }));
      f.session.getPresentation().actions.stop({ conversationId: a, epoch }, b);
      await waitFor(() => expect(f.client.stop).toHaveBeenCalledOnce());
      expect(vi.mocked(f.client.stop).mock.calls[0]?.[0]).toMatchObject({ conversationId: a, runId: b });
      expect(f.session.getPresentation().state.run.state).not.toBe('interrupted');
      expect(f.client.send).toHaveBeenCalledOnce();
    } finally { f.session.close(); }
  });
});

describe('Think session content and decision ownership', () => {
  const identity = { conversationId: a, epoch };
  const transfer = '55555555-5555-4555-8555-555555555555';
  const makeRef = (text: string, generation: string, canonical = true): BodyRef => {
    const common = { epoch, contentId: '66666666-6666-4666-8666-666666666666', generation, through: Buffer.byteLength(text),
      key: { conversationId: a, owner: { kind: 'assistant-text' as const, messageId: 'msg_fixture', ordinal: 0 } } };
    return canonical ? { ...common, kind: 'canonical', sha256: createHash('sha256').update(text).digest('hex') } : { ...common, kind: 'preview' };
  };
  const withBody = (ref: BodyRef, revision = 1): ThinkSnapshot => snapshot(a, { revision, entries: [{ kind: 'assistant-text', displayOrder: 1, messageId: 'msg_fixture', ordinal: 0, body: ref, closure: 'closed', capture: 'complete' }] });
  const content = (f: ReturnType<typeof fixture>) => f.session.getPresentation().state.messages[0]?.parts[0]?.content;

  it('retries a failed multibyte chunk at the same offset and transfer without resending or restarting the watch', async () => {
    const f = fixture();
    const bytes = Buffer.from('A🧠B');
    const ref = makeRef('A🧠B', '77777777-7777-4777-8777-777777777777', false);
    vi.mocked(f.client.snapshot).mockResolvedValue(withBody(ref));
    let failed = false;
    vi.mocked(f.client.chunk).mockImplementation(async (_ref, offset, nonce) => {
      if (offset === 3 && !failed) { failed = true; throw new ThinkClientError('transport'); }
      const nextOffset = offset === 0 ? 3 : bytes.length;
      return { conversationId: a, epoch, contentId: ref.contentId, generation: ref.generation, through: ref.through, offset,
        bytes: bytes.subarray(offset, nextOffset).toString('base64'), nextOffset, transfer: nonce ?? transfer };
    });
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(content(f)?.state).toBe('error'));
      const watchCount = f.watches.length;
      f.session.getPresentation().actions.retryBody(identity, ref);
      await waitFor(() => expect(vi.mocked(f.client.chunk).mock.calls.length).toBeGreaterThanOrEqual(3));
      const retry = vi.mocked(f.client.chunk).mock.calls[2];
      expect(retry).toEqual([ref, 3, transfer, expect.any(AbortSignal)]);
      expect(retry?.[3]?.aborted).toBe(false);
      await waitFor(() => expect(content(f)).toMatchObject({ state: 'ready', text: 'A🧠B', ref }));
      expect(f.watches).toHaveLength(watchCount);
      expect(f.client.send).not.toHaveBeenCalled();
    } finally { f.session.close(); }
  });

  it('rejects canonical digest mismatch rather than presenting empty or fabricated text', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const f = fixture();
    const ref = makeRef('expected', '77777777-7777-4777-8777-777777777777');
    vi.mocked(f.client.snapshot).mockResolvedValue(withBody(ref));
    vi.mocked(f.client.chunk).mockResolvedValue({ conversationId: a, epoch, contentId: ref.contentId, generation: ref.generation,
      through: ref.through, offset: 0, bytes: Buffer.from('mismatch').toString('base64'), nextOffset: ref.through, transfer });
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(content(f)).toMatchObject({ state: 'error', reason: 'unavailable' }));
      expect(content(f)).not.toMatchObject({ state: 'ready', text: '' });
    } finally { f.session.close(); }
  });

  it('does not publish an old generation after a newer authoritative body replaces it', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const f = fixture();
    const old = makeRef('older', '77777777-7777-4777-8777-777777777777');
    const latest = makeRef('newer', '88888888-8888-4888-8888-888888888888');
    const delayed = deferred<Awaited<ReturnType<typeof f.client.chunk>>>();
    vi.mocked(f.client.snapshot).mockResolvedValueOnce(withBody(old)).mockResolvedValue(withBody(latest, 2));
    vi.mocked(f.client.chunk).mockImplementation(async ref => ref.generation === old.generation ? delayed.promise :
      { conversationId: a, epoch, contentId: ref.contentId, generation: ref.generation, through: ref.through, offset: 0, bytes: Buffer.from('newer').toString('base64'), nextOffset: ref.through, transfer });
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.watches).toHaveLength(1));
      f.watches[0].handlers.revision({ conversationId: a, epoch, revision: 2, creation: 'ready', sendEligibility: 'available' });
      await waitFor(() => expect(content(f)).toMatchObject({ state: 'ready', ref: latest, text: 'newer' }));
      delayed.resolve({ conversationId: a, epoch, contentId: old.contentId, generation: old.generation, through: old.through, offset: 0, bytes: Buffer.from('older').toString('base64'), nextOffset: old.through, transfer });
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(content(f)).toMatchObject({ state: 'ready', ref: latest, text: 'newer' });
    } finally { f.session.close(); }
  });

  it('binds owned question replies to their conversation and ignores a late acknowledgement after selection changes', async () => {
    const f = fixture();
    const answer = { answer: 'fixture 🧠' };
    const decision = { conversationId: a, decisionId: 'form_fixture', kind: 'form' as const, title: 'Fixture question', fields: [{ key: 'answer', type: 'string' as const }] };
    const ack = deferred<Awaited<ReturnType<typeof f.client.reply>>>();
    vi.mocked(f.client.decisions).mockImplementation(async id => id === a ? [decision] : []);
    vi.mocked(f.client.reply).mockReturnValue(ack.promise);
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getPresentation().state.questions).toHaveLength(1));
      f.session.getPresentation().actions.editQuestion(identity, decision.decisionId, answer);
      f.session.getPresentation().actions.replyQuestion(identity, decision.decisionId, answer);
      await waitFor(() => expect(f.client.reply).toHaveBeenCalledOnce());
      expect(vi.mocked(f.client.reply).mock.calls[0]?.[0]).toEqual({ conversationId: a, clientCommandId: c, decisionId: decision.decisionId, answer });
      f.session.setLocation(think(b));
      ack.resolve({ conversationId: a, clientCommandId: c, epoch, kind: 'form-reply', decisionId: decision.decisionId, state: 'replied' });
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: b, epoch }));
      expect(f.session.getPresentation().state.questions).toEqual([]);
      expect(f.client.reply).toHaveBeenCalledOnce();
    } finally { f.session.close(); }
  });

  it('keeps background-busy Send unavailable without inventing a stoppable run', async () => {
    const f = fixture();
    vi.mocked(f.client.snapshot).mockResolvedValue(snapshot(a, { sendEligibility: 'busy' }));
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: a, epoch }));
      f.session.editDraft('editable despite background work');
      expect(f.session.getPresentation().state.composer).toMatchObject({ kind: 'send', eligible: false, reason: 'busy' });
      expect(f.session.getPresentation().state.draft.text).toBe('editable despite background work');
      expect(f.client.stop).not.toHaveBeenCalled();
    } finally { f.session.close(); }
  });

  it('resolves an owned run from the lifecycle command receipt after reload without guessing commandKind', async () => {
    const f = fixture();
    vi.mocked(f.client.snapshot).mockResolvedValue(snapshot(a, { sendEligibility: 'busy', entries: [
      { kind: 'lifecycle', displayOrder: 1, clientCommandId: commandId, runId: b, state: 'admitted' },
    ] }));
    vi.mocked(f.client.receipt).mockResolvedValue({ conversationId: a, clientCommandId: commandId, epoch, kind: 'send', state: 'admitted', runId: b });
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.client.receipt).toHaveBeenCalled());
      await waitFor(() => expect(f.session.getPresentation().state.composer).toMatchObject({ kind: 'stop', runId: b }));
      expect(f.client.send).not.toHaveBeenCalled();
      expect(f.client.stop).not.toHaveBeenCalled();
    } finally { f.session.close(); }
  });

  it('retains rejected submission text without discarding an edit made before its receipt', async () => {
    const f = fixture();
    const ack = deferred<SendReceipt>();
    vi.mocked(f.client.send).mockReturnValue(ack.promise);
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual({ conversationId: a, epoch }));
      f.session.editDraft('rejected original');
      f.session.getPresentation().actions.send(identity, f.session.getSnapshot().draft.version);
      await waitFor(() => expect(f.client.send).toHaveBeenCalledOnce());
      f.session.editDraft('newer draft');
      ack.resolve({ conversationId: a, clientCommandId: c, epoch, kind: 'send', state: 'rejected', runId: b, failure: { code: 'resource_failure' } });
      await waitFor(() => expect(f.session.getPresentation().state.rejectedSubmissions).toContainEqual(expect.objectContaining({ clientCommandId: c, text: 'rejected original' })));
      expect(f.session.getSnapshot().draft.text).toBe('newer draft');
      f.session.getPresentation().actions.recoverRejected(identity, c);
      expect(f.session.getSnapshot().draft.text).toBe('newer draft');
    } finally { f.session.close(); }
  });
});

describe('Phase 5 reviewed command reconciliation', () => {
  const identity = { conversationId: a, epoch };
  const form = { conversationId: a, decisionId: 'form_fixture', kind: 'form' as const, title: 'Fixture question', fields: [{ key: 'answer', type: 'string' as const }] };
  const lifecycle = (clientCommandId: string, runId: string, state: 'completed' | 'admitted'): ThinkSnapshot['entries'][number] =>
    ({ kind: 'lifecycle', displayOrder: 1, clientCommandId, runId, state });

  it('THINK-TS-02 rejected local HTTP 409 does not veto the newly observed owned run', async () => {
    const f = fixture();
    let current = snapshot(a);
    vi.mocked(f.client.snapshot).mockImplementation(async () => current);
    vi.mocked(f.client.send).mockRejectedValue(new ThinkClientError('api', 409, 'command_conflict'));
    vi.mocked(f.client.receipt).mockImplementation(async (id, command) => ({ conversationId: id, clientCommandId: command, epoch, kind: 'send', runId: commandId, state: 'admitted' }));
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.watches).toHaveLength(1));
      f.session.editDraft('local rejected text');
      f.session.getPresentation().actions.send({ conversationId: a, epoch }, f.session.getSnapshot().draft.version);
      await waitFor(() => expect(f.session.getPresentation().state.rejectedSubmissions).toContainEqual(expect.objectContaining({ clientCommandId: c, text: 'local rejected text' })));
      current = snapshot(a, { revision: 2, sendEligibility: 'busy', entries: [lifecycle(b, commandId, 'admitted')] });
      f.watches[0].handlers.revision(current);
      await waitFor(() => expect(vi.mocked(f.client.receipt).mock.calls.some(([id, command]) => id === a && command === b)).toBe(true));
      await waitFor(() => expect(f.session.getPresentation().state.composer).toMatchObject({ kind: 'stop', runId: commandId }));
      expect(f.session.getPresentation().state.rejectedSubmissions).toContainEqual(expect.objectContaining({ clientCommandId: c, text: 'local rejected text' }));
      expect(f.client.send).toHaveBeenCalledOnce();
      expect(f.client.stop).not.toHaveBeenCalled();
    } finally { f.session.close(); }
  });

  it('THINK-TS-04 inactive owner retains definitive form HTTP 400 for the original command and permits correction on return', async () => {
    const f = fixture();
    const held = deferred<Awaited<ReturnType<typeof f.client.reply>>>();
    vi.mocked(f.client.decisions).mockResolvedValue([form]);
    vi.mocked(f.client.reply).mockReturnValue(held.promise);
    vi.mocked(f.client.receipt).mockRejectedValue(new ThinkClientError('api', 404, 'not_found'));
    const answer = { answer: 'original invalid fixture answer' };
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getPresentation().state.questions).toHaveLength(1));
      f.session.getPresentation().actions.editQuestion(identity, form.decisionId, answer);
      f.session.getPresentation().actions.replyQuestion(identity, form.decisionId, answer);
      await waitFor(() => expect(f.client.reply).toHaveBeenCalledOnce());
      expect(vi.mocked(f.client.reply).mock.calls[0]?.[0]).toEqual({ conversationId: a, clientCommandId: c, decisionId: form.decisionId, answer });
      f.session.setLocation({ pathname: '/recall', search: '' });
      held.reject(new ThinkClientError('api', 400, 'invalid_request'));
      await held.promise.catch(() => {});
      await Promise.resolve();
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.session.getSnapshot().identity).toEqual(identity));
      f.session.getPresentation().actions.checkConnection();
      await waitFor(() => expect(f.session.getPresentation().state.questions[0]).toMatchObject({ decisionId: form.decisionId, reply: 'rejected', answer }));
      f.session.getPresentation().actions.editQuestion(identity, form.decisionId, { answer: 'corrected fixture answer' });
      expect(f.session.getPresentation().state.questions[0]?.answer).toEqual({ answer: 'corrected fixture answer' });
      expect(f.client.reply).toHaveBeenCalledOnce();
      expect(vi.mocked(f.client.receipt).mock.calls.every(([id, command]) => id === a && command === c)).toBe(true);
    } finally { f.session.close(); }
  });

  it('THINK-TS-01 does not regress a terminal receipt when an older registered POST acknowledgement arrives', async () => {
    const f = fixture();
    const held = deferred<SendReceipt>();
    let current = snapshot(a);
    vi.mocked(f.client.snapshot).mockImplementation(async () => current);
    vi.mocked(f.client.send).mockReturnValue(held.promise);
    vi.mocked(f.client.receipt).mockResolvedValue({ conversationId: a, clientCommandId: c, epoch, kind: 'send', runId: b, state: 'completed' });
    try {
      f.session.setLocation(think(a));
      await waitFor(() => expect(f.watches).toHaveLength(1));
      f.session.editDraft('first submission');
      f.session.getPresentation().actions.send(identity, f.session.getSnapshot().draft.version);
      await waitFor(() => expect(f.client.send).toHaveBeenCalledOnce());
      f.session.editDraft('newer draft');
      current = snapshot(a, { revision: 2, sendEligibility: 'available', entries: [lifecycle(c, b, 'completed')] });
      f.watches[0].handlers.revision(current);
      await waitFor(() => expect(f.session.getPresentation().state.run).toMatchObject({ state: 'completed', runId: b }));
      const reads = vi.mocked(f.client.snapshot).mock.calls.length;
      held.resolve({ conversationId: a, clientCommandId: c, epoch, kind: 'send', runId: b, state: 'registered' });
      await waitFor(() => expect(vi.mocked(f.client.snapshot).mock.calls.length).toBeGreaterThan(reads));
      expect(f.session.getPresentation().state.run).toMatchObject({ state: 'completed', runId: b });
      expect(f.session.getPresentation().state.composer).toMatchObject({ kind: 'send', eligible: true });
      expect(f.session.getSnapshot().draft.text).toBe('newer draft');
      f.session.getPresentation().actions.checkConnection();
      expect(f.session.getPresentation().state.run).toMatchObject({ state: 'completed', runId: b });
      expect(f.client.send).toHaveBeenCalledOnce();
    } finally { f.session.close(); }
  });

  it('THINK-TS-02 discovers a different authoritative Send after a local completed run', async () => {
    const f = fixture();
    let current = snapshot(a);
    vi.mocked(f.client.snapshot).mockImplementation(async () => current);
    vi.mocked(f.client.send).mockResolvedValue({ conversationId: a, clientCommandId: c, epoch, kind: 'send', runId: b, state: 'completed' });
    vi.mocked(f.client.receipt).mockImplementation(async (id, command) => ({ conversationId: id, clientCommandId: command, epoch, kind: 'send', runId: commandId, state: 'admitted' }));
    try {
      f.session.setLocation(think(a)); await waitFor(() => expect(f.watches).toHaveLength(1));
      f.session.editDraft('local run');
      f.session.getPresentation().actions.send(identity, f.session.getSnapshot().draft.version);
      await waitFor(() => expect(f.session.getPresentation().state.run).toMatchObject({ state: 'completed', runId: b }));
      current = snapshot(a, { revision: 2, sendEligibility: 'busy', entries: [lifecycle(c, b, 'completed'), { ...lifecycle(b, commandId, 'admitted'), displayOrder: 2 }] });
      f.watches[0].handlers.revision(current);
      await waitFor(() => expect(vi.mocked(f.client.receipt).mock.calls.some(([id, command]) => id === a && command === b)).toBe(true));
      await waitFor(() => expect(f.session.getPresentation().state.composer).toMatchObject({ kind: 'stop', runId: commandId }));
      expect(f.client.send).toHaveBeenCalledOnce();
    } finally { f.session.close(); }
  });

  it('THINK-TS-03 keeps a registered Stop pending and checks its original receipt instead of issuing another Stop', async () => {
    const f = fixture();
    vi.mocked(f.client.send).mockResolvedValue({ conversationId: a, clientCommandId: c, epoch, kind: 'send', runId: b, state: 'admitted' });
    vi.mocked(f.client.stop).mockResolvedValue({ conversationId: a, clientCommandId: commandId, epoch, kind: 'stop', runId: b, state: 'registered' });
    vi.mocked(f.client.receipt).mockResolvedValue({ conversationId: a, clientCommandId: commandId, epoch, kind: 'stop', runId: b, state: 'requested' });
    try {
      f.session.setLocation(think(a)); await waitFor(() => expect(f.session.getSnapshot().identity).toEqual(identity));
      f.session.editDraft('fixture work'); f.session.getPresentation().actions.send(identity, f.session.getSnapshot().draft.version);
      await waitFor(() => expect(f.session.getPresentation().state.composer).toMatchObject({ kind: 'stop', runId: b }));
      f.session.getPresentation().actions.stop(identity, b);
      await waitFor(() => expect(f.client.stop).toHaveBeenCalledOnce());
      await waitFor(() => expect(f.session.getPresentation().state.composer).toMatchObject({ kind: 'stop', state: 'requesting', runId: b }));
      f.session.getPresentation().actions.stop(identity, b);
      f.session.getPresentation().actions.checkConnection();
      await waitFor(() => expect(vi.mocked(f.client.receipt).mock.calls.some(([id, command]) => id === a && command === commandId)).toBe(true));
      expect(f.client.stop).toHaveBeenCalledOnce();
      expect(f.session.getPresentation().state.run.state).not.toBe('interrupted');
    } finally { f.session.close(); }
  });

  it('THINK-TS-03 checks an unknown Stop acknowledgement by its original command without replay', async () => {
    const f = fixture();
    vi.mocked(f.client.send).mockResolvedValue({ conversationId: a, clientCommandId: c, epoch, kind: 'send', runId: b, state: 'admitted' });
    vi.mocked(f.client.stop).mockRejectedValue(new ThinkClientError('transport', undefined, undefined, 'unknown'));
    vi.mocked(f.client.receipt).mockResolvedValue({ conversationId: a, clientCommandId: commandId, epoch, kind: 'stop', runId: b, state: 'requested' });
    try {
      f.session.setLocation(think(a)); await waitFor(() => expect(f.session.getSnapshot().identity).toEqual(identity));
      f.session.editDraft('fixture work'); f.session.getPresentation().actions.send(identity, f.session.getSnapshot().draft.version);
      await waitFor(() => expect(f.session.getPresentation().state.composer).toMatchObject({ kind: 'stop', runId: b }));
      f.session.getPresentation().actions.stop(identity, b);
      await waitFor(() => expect(vi.mocked(f.client.receipt).mock.calls.some(([id, command]) => id === a && command === commandId)).toBe(true));
      expect(f.client.stop).toHaveBeenCalledOnce();
      expect(f.session.getPresentation().state.run.state).not.toBe('interrupted');
    } finally { f.session.close(); }
  });

  it('THINK-TS-04 reconciles an acknowledged form reply by its original receipt and preserves its answer', async () => {
    const f = fixture();
    vi.mocked(f.client.decisions).mockResolvedValue([form]);
    vi.mocked(f.client.reply).mockResolvedValue({ conversationId: a, clientCommandId: c, epoch, kind: 'form-reply', decisionId: form.decisionId, state: 'registered' });
    vi.mocked(f.client.receipt).mockResolvedValue({ conversationId: a, clientCommandId: c, epoch, kind: 'form-reply', decisionId: form.decisionId, state: 'replied' });
    const answer = { answer: 'fixture original answer' };
    try {
      f.session.setLocation(think(a)); await waitFor(() => expect(f.session.getPresentation().state.questions).toHaveLength(1));
      f.session.getPresentation().actions.editQuestion(identity, form.decisionId, answer);
      f.session.getPresentation().actions.replyQuestion(identity, form.decisionId, answer);
      await waitFor(() => expect(f.client.reply).toHaveBeenCalledOnce());
      expect(vi.mocked(f.client.reply).mock.calls[0]?.[0]).toEqual({ conversationId: a, clientCommandId: c, decisionId: form.decisionId, answer });
      f.session.getPresentation().actions.checkConnection();
      await waitFor(() => expect(vi.mocked(f.client.receipt).mock.calls.some(([id, command]) => id === a && command === c)).toBe(true));
      await waitFor(() => expect(f.session.getPresentation().state.questions[0]).toMatchObject({ decisionId: form.decisionId, answer, reply: 'replied' }));
      expect(f.client.reply).toHaveBeenCalledOnce();
    } finally { f.session.close(); }
  });

  it('THINK-TS-04 permits correcting a definitively rejected form reply without automatic POST replay', async () => {
    const f = fixture();
    vi.mocked(f.client.decisions).mockResolvedValue([form]);
    vi.mocked(f.client.reply).mockRejectedValue(new ThinkClientError('api', 400, 'invalid_request'));
    vi.mocked(f.client.receipt).mockRejectedValue(new ThinkClientError('api', 404, 'not_found'));
    try {
      f.session.setLocation(think(a)); await waitFor(() => expect(f.session.getPresentation().state.questions).toHaveLength(1));
      f.session.getPresentation().actions.replyQuestion(identity, form.decisionId, { answer: 'bad' });
      await waitFor(() => expect(f.session.getPresentation().state.questions[0]?.reply).toBe('rejected'));
      expect(f.client.reply).toHaveBeenCalledOnce();
      f.session.getPresentation().actions.editQuestion(identity, form.decisionId, { answer: 'corrected' });
      expect(f.session.getPresentation().state.questions[0]?.answer).toEqual({ answer: 'corrected' });
      f.session.getPresentation().actions.replyQuestion(identity, form.decisionId, { answer: 'corrected' });
      await waitFor(() => expect(f.client.reply).toHaveBeenCalledTimes(2));
      expect(vi.mocked(f.client.reply).mock.calls[1]?.[0].clientCommandId).not.toBe(c);
    } finally { f.session.close(); }
  });
});
