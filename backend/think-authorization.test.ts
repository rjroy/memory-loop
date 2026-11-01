import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppOptions } from './app';
import type { ConversationState, CreateConversationCommand, CreateReceipt } from './think/service';
import { expectNoThinkDispatch, thinkHttpService } from './think-http-test-fixture';
import type { VaultReader } from './vault';

const authority = '127.0.0.1:3000';
const token = 'a'.repeat(64);
const conversationId = '11111111-1111-4111-8111-111111111111';
const clientCommandId = '22222222-2222-4222-8222-222222222222';
const epoch = '33333333-3333-4333-8333-333333333333';
const command: CreateConversationCommand = { conversationId, clientCommandId };
const receipt: CreateReceipt = { ...command, kind: 'create', epoch, state: 'registered' };
const state: ConversationState = { conversationId, epoch, revision: 1, creation: 'ready', sendEligibility: 'available' };
const snapshot = { ...state, entries: [], contentHealth: 'complete' as const };
const base = '/api/think/conversations';

function setup(unavailable = false) {
  const vault: VaultReader = {
    tree: vi.fn(async () => ({ entries: [] })),
    note: vi.fn(async () => ({ name: 'note.md', markdown: 'fixture' })),
    close: vi.fn(async () => {}),
  };
  const think = thinkHttpService();
  think.create.mockResolvedValue(receipt);
  think.conversation.mockResolvedValue(state);
  think.snapshot.mockResolvedValue(snapshot);
  think.command.mockResolvedValue(receipt);
  const options: AppOptions = { authority, serviceToken: token, vault: { reader: vault },
    think: unavailable ? { error: 'think_unavailable' } : think };
  const app = createApp(options);
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('host')) headers.set('host', authority);
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
    return app(new Request(`http://${authority}${path}`, { ...init, headers }));
  };
  const post = (body: string, headers?: Record<string, string>) => request(base, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
  });
  return { app, request, post, think, vault };
}

describe('Think HTTP command boundary', () => {
  it('registers a valid create and returns its receipt', async () => {
    const { post, think } = setup();
    const response = await post(JSON.stringify(command));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(receipt);
    expect(think.create).toHaveBeenCalledExactlyOnceWith(command);
    expect(think.send).not.toHaveBeenCalled();
    expect(think.stop).not.toHaveBeenCalled();
    expect(think.decisions).not.toHaveBeenCalled();
    expect(think.decision).not.toHaveBeenCalled();
    expect(think.reply).not.toHaveBeenCalled();
    expect(think.content.page).not.toHaveBeenCalled();
    expect(think.content.open).not.toHaveBeenCalled();
  });

  it('reads current state and the registered command receipt', async () => {
    const { request, think } = setup();
    const conversation = await request(`${base}/${conversationId}`);
    expect(conversation.status).toBe(200);
    expect(await conversation.json()).toEqual(snapshot);
    expect(think.snapshot).toHaveBeenCalledExactlyOnceWith(conversationId, undefined);
    const commandResponse = await request(`${base}/${conversationId}/commands/${clientCommandId}`);
    expect(commandResponse.status).toBe(200);
    expect(await commandResponse.json()).toEqual(receipt);
    expect(think.command).toHaveBeenCalledExactlyOnceWith(conversationId, clientCommandId);
  });

  it.each([
    ['wrong host', { host: 'other.example:3000' }, 403],
    ['wrong credential', { authorization: `Bearer ${'b'.repeat(64)}` }, 401],
    ['origin', { origin: 'http://other.example' }, 403],
  ])('rejects %s before any Think service call', async (_name, headers, status) => {
    const { post, think } = setup();
    const response = await post(JSON.stringify(command), headers);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expectNoThinkDispatch(think);
  });

  it('rejects a missing credential before any Think service call', async () => {
    const { post, think } = setup();
    const response = await post(JSON.stringify(command), { authorization: '' });
    expect(response.status).toBe(401);
    expectNoThinkDispatch(think);
  });

  // Daemon policy only: these spies do not establish external proxy/human authentication.
  it.each([
    ['wrong service credential', { authorization: `Bearer ${'b'.repeat(64)}` }, 401],
    ['browser Origin', { origin: 'https://fixture.invalid' }, 403],
    ['browser Fetch Metadata', { 'sec-fetch-site': 'same-origin' }, 403],
  ] as const)('denies %s before ANY new recent/Resume/view service operation', async (_name, deniedHeaders, status) => {
    const { request, think } = setup();
    const routes = [
      { path: '/api/ground/recent-conversations' },
      { path: '/api/think/views', body: {} },
      { path: '/api/think/selection', body: { viewToken: 'b'.repeat(64), expectedRevision: 0, conversationId } },
      { path: '/api/think/selection' },
      { path: `${base}/${conversationId}/resume`, body: { clientCommandId } },
    ];
    for (const route of routes) {
      const response = await request(route.path, { method: route.body === undefined ? 'GET' : 'POST',
        headers: { ...deniedHeaders, 'content-type': 'application/json', 'X-Memory-Loop-View': 'b'.repeat(64) },
        ...(route.body === undefined ? {} : { body: JSON.stringify(route.body) }) });
      expect(response.status, route.path).toBe(status);
      expectNoThinkDispatch(think);
    }
  });

  it.each([
    { name: 'caller-chosen view token', path: '/api/think/views', body: { viewToken: 'b'.repeat(64) }, status: 400 },
    { name: 'unknown view-registration key', path: '/api/think/views', body: { deviceId: 'not a client identity' }, status: 400 },
    { name: 'missing read header', path: '/api/think/selection', status: 403 },
    { name: 'malformed read header', path: '/api/think/selection', header: 'not a view token', status: 403 },
    { name: 'malformed selection token', path: '/api/think/selection', body: { viewToken: 'bad', expectedRevision: 0, conversationId }, status: 400 },
    { name: 'negative selection revision', path: '/api/think/selection', body: { viewToken: 'b'.repeat(64), expectedRevision: -1, conversationId }, status: 400 },
  ])('rejects $name before dispatch, including nested content operations', async input => {
    const { request, think } = setup();
    const response = await request(input.path, { method: input.body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(input.header ? { 'X-Memory-Loop-View': input.header } : {}) },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }) });
    expect(response.status).toBe(input.status);
    expectNoThinkDispatch(think);
  });

  it.each(['not json', JSON.stringify({ ...command, conversationId: 'not-a-uuid' }), JSON.stringify({ conversationId })])(
    'rejects invalid create input without calling the service', async body => {
      const { post, think } = setup();
      expect((await post(body)).status).toBe(400);
      expect(think.create).not.toHaveBeenCalled();
    },
  );

  it('reports configured Think unavailability', async () => {
    const { post } = setup(true);
    const response = await post(JSON.stringify(command));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'think_unavailable' } });
  });

  it('reports unknown conversations and commands from the service', async () => {
    const { request, think } = setup();
    think.snapshot.mockResolvedValueOnce(null);
    think.command.mockResolvedValueOnce(null);
    expect((await request(`${base}/${conversationId}`)).status).toBe(404);
    expect(think.snapshot).toHaveBeenCalledExactlyOnceWith(conversationId, undefined);
    expect((await request(`${base}/${conversationId}/commands/${clientCommandId}`)).status).toBe(404);
    expect(think.command).toHaveBeenCalledExactlyOnceWith(conversationId, clientCommandId);
  });

  it('keeps Recall GET available and Recall POST forbidden', async () => {
    const { request, vault, think } = setup();
    expect((await request('/api/vault/tree')).status).toBe(200);
    expect(vault.tree).toHaveBeenCalledOnce();
    expect((await request('/api/vault/tree', { method: 'POST' })).status).toBe(405);
    expect(think.create).not.toHaveBeenCalled();
  });
});
