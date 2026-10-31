import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import type { ThinkService } from './think/service';
import type { SendCommand, SendReceipt, StopCommand, StopReceipt } from './think/contract';
import type { VaultReader } from './vault';

const authority = '127.0.0.1:3000';
const token = 'a'.repeat(64);
const conversationId = '11111111-1111-4111-8111-111111111111';
const clientCommandId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const epoch = '44444444-4444-4444-8444-444444444444';
const base = `/api/think/conversations/${conversationId}`;

function setup() {
  const vault: VaultReader = {
    tree: vi.fn(async () => ({ entries: [] })),
    note: vi.fn(async () => ({ name: 'fixture.md', markdown: 'fixture' })),
    close: vi.fn(async () => {}),
  };
  const sendReceipt: SendReceipt = { kind: 'send', conversationId, clientCommandId, runId, epoch, state: 'registered' };
  const stopReceipt: StopReceipt = { kind: 'stop', conversationId, clientCommandId, runId, epoch, state: 'registered' };
  const think = {
    create: vi.fn<ThinkService['create']>(),
    conversation: vi.fn<ThinkService['conversation']>(),
    snapshot: vi.fn<ThinkService['snapshot']>(async () => { throw new Error('Unexpected snapshot'); }),
    watch: vi.fn<ThinkService['watch']>(async () => { throw new Error('Unexpected watch'); }),
    contentChunk: vi.fn<ThinkService['contentChunk']>(async () => { throw new Error('Unexpected content chunk'); }),
    command: vi.fn<ThinkService['command']>(),
    close: vi.fn(async () => {}),
    send: vi.fn(async (_command: SendCommand) => sendReceipt),
    stop: vi.fn(async (_command: StopCommand) => stopReceipt),
    decisions: vi.fn<ThinkService['decisions']>(async () => { throw new Error('Unexpected decisions'); }),
    decision: vi.fn<ThinkService['decision']>(async () => { throw new Error('Unexpected decision'); }),
    reply: vi.fn<ThinkService['reply']>(async () => { throw new Error('Unexpected reply'); }),
    content: { page: vi.fn<ThinkService['content']['page']>(async () => { throw new Error('Unexpected page'); }),
      open: vi.fn<ThinkService['content']['open']>(async () => { throw new Error('Unexpected open'); }) },
  } satisfies ThinkService;
  const app = createApp({ authority, serviceToken: token, vault: { reader: vault }, think });
  const post = (path: string, body: string, headers: Record<string, string> = {}) => app(new Request(`http://${authority}${path}`, {
    method: 'POST', headers: { host: authority, authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body,
  }));
  return { post, think, sendReceipt, stopReceipt };
}

describe('Think Send and Stop HTTP boundary', () => {
  it('registers a Send and returns the service receipt without altering text', async () => {
    const f = setup();
    const text = '  fixture text\nsecond line  ';
    const response = await f.post(`${base}/messages`, JSON.stringify({ clientCommandId, text }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(f.sendReceipt);
    expect(f.think.send).toHaveBeenCalledExactlyOnceWith({ conversationId, clientCommandId, text });
  });

  it('registers a Stop for the specific run without claiming the run stopped', async () => {
    const f = setup();
    const response = await f.post(`${base}/runs/${runId}/stop`, JSON.stringify({ clientCommandId }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(f.stopReceipt);
    expect(f.think.stop).toHaveBeenCalledExactlyOnceWith({ conversationId, clientCommandId, runId });
  });

  it.each([
    ['host', { host: 'other.example:3000' }, 403],
    ['credential', { authorization: `Bearer ${'b'.repeat(64)}` }, 401],
    ['origin', { origin: 'http://other.example' }, 403],
  ])('rejects %s for both commands before service dispatch', async (_label, headers, status) => {
    const f = setup();
    expect((await f.post(`${base}/messages`, JSON.stringify({ clientCommandId, text: 'fixture' }), headers)).status).toBe(status);
    expect((await f.post(`${base}/runs/${runId}/stop`, JSON.stringify({ clientCommandId }), headers)).status).toBe(status);
    expect(f.think.send).not.toHaveBeenCalled();
    expect(f.think.stop).not.toHaveBeenCalled();
    expect(f.think.create).not.toHaveBeenCalled();
    expect(f.think.conversation).not.toHaveBeenCalled();
    expect(f.think.snapshot).not.toHaveBeenCalled();
    expect(f.think.watch).not.toHaveBeenCalled();
    expect(f.think.contentChunk).not.toHaveBeenCalled();
    expect(f.think.command).not.toHaveBeenCalled();
    expect(f.think.decisions).not.toHaveBeenCalled();
    expect(f.think.decision).not.toHaveBeenCalled();
    expect(f.think.reply).not.toHaveBeenCalled();
    expect(f.think.content.page).not.toHaveBeenCalled();
    expect(f.think.content.open).not.toHaveBeenCalled();
  });

  it.each([
    [`${base}/messages`, 'not json'],
    [`${base}/messages`, JSON.stringify({ clientCommandId: 'invalid', text: 'fixture' })],
    [`${base}/messages`, JSON.stringify({ clientCommandId })],
    [`${base}/runs/${runId}/stop`, JSON.stringify({ clientCommandId: 'invalid' })],
    [`${base}/runs/not-a-uuid/stop`, JSON.stringify({ clientCommandId })],
  ])('rejects malformed command %s', async (path, body) => {
    const f = setup();
    expect((await f.post(path, body)).status).toBe(400);
    expect(f.think.send).not.toHaveBeenCalled();
    expect(f.think.stop).not.toHaveBeenCalled();
  });
});
