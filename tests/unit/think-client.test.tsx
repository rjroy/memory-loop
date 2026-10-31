import { describe, expect, it, vi } from 'vitest';
import { createThinkClient, type ThinkWatchHandlers } from '../../src/think/client';
import type { BodyRef } from '../../backend/think/body-store';

const conversationId = '11111111-1111-4111-8111-111111111111';
const epoch = '22222222-2222-4222-8222-222222222222';
const commandId = '33333333-3333-4333-8333-333333333333';
const runId = '44444444-4444-4444-8444-444444444444';
const contentId = '55555555-5555-4555-8555-555555555555';
const generation = '66666666-6666-4666-8666-666666666666';
const transfer = '77777777-7777-4777-8777-777777777777';
const cursor = `page.${'a'.repeat(64)}`;
const ref: BodyRef = { epoch, contentId, generation, through: 7, kind: 'canonical', sha256: 'b'.repeat(64),
  key: { conversationId, owner: { kind: 'original', clientCommandId: commandId, messageId: 'msg_fixture' } } };
const original = { kind: 'original', displayOrder: 1, clientCommandId: commandId, messageId: 'msg_fixture', body: ref, nativeSecret: 'fixture-private' };
const snapshot = { conversationId, epoch, revision: 1, creation: 'ready', sendEligibility: 'available', entries: [original,
  { kind: 'original-capture', displayOrder: 2, clientCommandId: commandId, commandKind: 'send', state: 'captured', sourceTime: 2 },
  { kind: 'compaction', displayOrder: 3, sessionId: 'ses_fixture', eventId: 'evt_fixture', phase: 'ended', sourceTime: 3, sourceSequence: 1 }], nextCursor: cursor, nativeSecret: 'fixture-private' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const send = { conversationId, clientCommandId: commandId, text: 'fixture original' };
const sendReceipt = { conversationId, clientCommandId: commandId, epoch, kind: 'send', state: 'registered', runId };
const chunk = { conversationId, epoch, contentId, generation, through: 7, offset: 0, bytes: btoa('fixture'), nextOffset: 7, transfer };
class Watch extends EventTarget {
  readonly close = vi.fn();
  emit(name: string, value: unknown) { this.dispatchEvent(new MessageEvent(name, { data: typeof value === 'string' ? value : JSON.stringify(value) })); }
}
const handlers = (): ThinkWatchHandlers => ({ snapshot: vi.fn(), revision: vi.fn(), heartbeat: vi.fn(), error: vi.fn() });

describe('Think browser protocol client', () => {
  it('requests same-origin paginated snapshots and preserves sanitized original, capture and compaction facts', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(snapshot));
    const client = createThinkClient({ fetch: fetcher });
    const result = await client.snapshot(conversationId, cursor);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(`/api/think/conversations/${conversationId}?cursor=${encodeURIComponent(cursor)}`);
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin', redirect: 'error' });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(result).toMatchObject({ conversationId, epoch, sendEligibility: 'available', nextCursor: cursor, entries: [
      expect.objectContaining({ kind: 'original', body: ref }), expect.objectContaining({ kind: 'original-capture', state: 'captured' }), expect.objectContaining({ kind: 'compaction', phase: 'ended' })] });
    expect(JSON.stringify(result)).not.toContain('fixture-private');
  });

  it('reports ambiguous POST transport failure once without resubmitting', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fixture disconnect'));
    const client = createThinkClient({ fetch: fetcher });
    await expect(client.send(send)).rejects.toMatchObject({ kind: 'transport', delivery: 'unknown' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/think/conversations/${conversationId}/messages`);
  });

  it('validates receipt correlation and strips extra native fields', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ ...sendReceipt, nativeSecret: 'fixture-private' }, 202))
      .mockResolvedValueOnce(json({ ...sendReceipt, conversationId: runId }, 202))
      .mockResolvedValueOnce(json({ ...sendReceipt, kind: 'stop', state: 'requested', runId: transfer }, 202));
    const client = createThinkClient({ fetch: fetcher });
    expect(await client.send(send)).toEqual(sendReceipt);
    await expect(client.send(send)).rejects.toMatchObject({ kind: 'invalid-response', delivery: 'unknown' });
    await expect(client.stop({ conversationId, clientCommandId: commandId, runId })).rejects.toMatchObject({ kind: 'invalid-response', delivery: 'unknown' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('reads chunks with a stable transfer nonce and validates the requested immutable scope', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(chunk)).mockResolvedValueOnce(json({ ...chunk, offset: 7, bytes: '', nextOffset: 7 }));
    const client = createThinkClient({ fetch: fetcher });
    expect(await client.chunk(ref, 0)).toEqual(chunk);
    expect(await client.chunk(ref, 7, transfer)).toMatchObject({ offset: 7, bytes: '', transfer });
    const url = String(fetcher.mock.calls[1]?.[0]);
    expect(url).toContain(`transfer=${transfer}`);
    expect(url).toContain('offset=7');
    expect(url.startsWith(`/api/think/conversations/${conversationId}/content/${contentId}?`)).toBe(true);
  });

  it.each([
    { ...chunk, transfer: runId }, { ...chunk, epoch: runId }, { ...chunk, offset: 1 },
    { ...chunk, bytes: 'not base64!' }, { ...chunk, bytes: btoa('x'.repeat(65537)), nextOffset: 65537 },
    { ...chunk, bytes: '', nextOffset: 0 },
  ])('rejects malformed chunk scope, nonce, bytes or progress', async value => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(value));
    await expect(createThinkClient({ fetch: fetcher }).chunk(ref, 0, transfer)).rejects.toMatchObject({ kind: 'invalid-response' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('delivers snapshot then revision and abort removes listeners without reconnecting or issuing commands', () => {
    const source = new Watch();
    const openWatch = vi.fn(() => source);
    const fetcher = vi.fn<typeof fetch>();
    const callbacks = handlers();
    const abort = new AbortController();
    const client = createThinkClient({ fetch: fetcher, openWatch });
    client.watch(conversationId, callbacks, abort.signal);
    expect(openWatch).toHaveBeenCalledExactlyOnceWith(`/api/think/conversations/${conversationId}/events`);
    source.emit('snapshot', snapshot);
    source.emit('revision', { conversationId, epoch, revision: 2, creation: 'ready', sendEligibility: 'busy' });
    source.emit('heartbeat', {});
    expect(callbacks.snapshot).toHaveBeenCalledOnce();
    expect(callbacks.revision).toHaveBeenCalledOnce();
    expect(callbacks.heartbeat).toHaveBeenCalledOnce();
    abort.abort();
    source.emit('revision', { conversationId, epoch, revision: 3, creation: 'ready', sendEligibility: 'available' });
    expect(callbacks.revision).toHaveBeenCalledOnce();
    expect(callbacks.error).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledOnce();
    expect(openWatch).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['{', 'x'.repeat(61 * 1024)])('closes a malformed or oversized watch without reconnecting', raw => {
    const source = new Watch();
    const openWatch = vi.fn(() => source);
    const fetcher = vi.fn<typeof fetch>();
    const callbacks = handlers();
    createThinkClient({ fetch: fetcher, openWatch }).watch(conversationId, callbacks);
    source.emit('snapshot', raw);
    source.emit('snapshot', snapshot);
    expect(callbacks.error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'invalid-response' }));
    expect(callbacks.snapshot).not.toHaveBeenCalled();
    expect(source.close).toHaveBeenCalledOnce();
    expect(openWatch).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('projects owned form details and validates the reply decision identity', async () => {
    const decision = { conversationId, decisionId: 'form_fixture', kind: 'form', title: 'Fixture question', fields: [{ key: 'answer', type: 'string', title: 'Answer', nativeSecret: 'fixture-private' }], nativeSecret: 'fixture-private' };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ decisions: [decision] })).mockResolvedValueOnce(json(decision))
      .mockResolvedValueOnce(json({ conversationId, epoch, clientCommandId: commandId, kind: 'form-reply', decisionId: 'form_other', state: 'registered' }, 202));
    const client = createThinkClient({ fetch: fetcher });
    const list = await client.decisions(conversationId);
    expect(list).toEqual([{ conversationId, decisionId: 'form_fixture', kind: 'form', title: 'Fixture question', fields: [{ key: 'answer', type: 'string', title: 'Answer' }] }]);
    expect(await client.decision(conversationId, 'form_fixture')).toEqual(list[0]);
    await expect(client.reply({ conversationId, clientCommandId: commandId, decisionId: 'form_fixture', answer: { answer: 'fixture' } })).rejects.toMatchObject({ kind: 'invalid-response', delivery: 'unknown' });
  });
});
