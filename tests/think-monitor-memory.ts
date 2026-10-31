import type { OpenCodeEvent, ServerInfo, SessionCreateInput } from '@opencode/client';
import { createHash } from 'node:crypto';
import { createThinkService } from '../backend/think/service';
import type { NativeSession, NativeSessions } from '../backend/think/native';
import type { BodyStore } from '../backend/think/body-store';

// Isolated Bun process: no native service, filesystem configuration, or provider.
console.info = () => {};
const warmup = 20_000;
const sample = 200_000;
let count = 0;
let release: (() => void) | undefined;
let reached: (() => void) | undefined;
let checkpoint = new Promise<void>(resolve => { reached = resolve; });
let session: NativeSession | undefined;
let monitorSignal: AbortSignal | undefined;
const connected: OpenCodeEvent = { type: 'server.connected', id: 'evt_fixture', data: {} };
const serverInfo: ServerInfo = { pid: 49123, version: '2.2.2', urls: [], paths: { tmp: '/fixture/tmp' } };

const native: NativeSessions = {
  async createSession(input: SessionCreateInput) {
    if (!input.id || !input.metadata || !input.location || !input.permissions) throw new Error('invalid fixture create');
    session = { id: input.id, metadata: input.metadata, location: input.location, permissions: input.permissions.map(rule => ({ ...rule })) };
    return session;
  },
  async getSession() {
    if (!session) throw new Error('fixture session missing');
    return { ...session, time: { created: 1, updated: 1 } };
  },
  subscribe(_input, signal) {
    monitorSignal = signal;
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<OpenCodeEvent>> {
            if (count === warmup || count === warmup + sample) {
              reached?.();
              await new Promise<void>(resolve => { release = resolve; });
            }
            count++;
            return { done: false, value: connected };
          },
          async return() { return { done: true, value: undefined }; },
        };
      },
    };
  },
  async prompt(_input, signal) {
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('fixture abort')), { once: true }));
  },
  async listInbox() { throw new Error('unexpected fixture inbox list'); },
  async cancelInbox() { throw new Error('unexpected fixture inbox cancel'); },
  async interruptSession() { throw new Error('unexpected fixture interrupt'); },
  async activeSessions() { return {}; },
  async listMessages() { return { data: [], cursor: {} }; },
  async getMessage() { throw new Error('unexpected fixture message readback'); },
  async listPermissionRequests() { return { location: { directory: '/fixture/vault' }, data: [] }; },
  async getServerInfo() { return serverInfo; },
  async listForms() { throw new Error('unexpected fixture form list'); },
  async getForm() { throw new Error('unexpected fixture form detail'); },
  async replyForm() { throw new Error('unexpected fixture form reply'); },
};
const epoch = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const conversationId = '11111111-1111-4111-8111-111111111111';
const bodies: BodyStore = {
  async replace(key, source, kind) {
    let size = 0;
    const hash = createHash('sha256');
    for await (const chunk of source) { size += chunk.length; hash.update(chunk); }
    const base = { key, epoch, contentId: 'fixture-body', generation: 'fixture-generation', through: size };
    return kind === 'canonical' ? { ...base, kind, sha256: hash.digest('hex') } : { ...base, kind };
  },
  async append() { throw new Error('unexpected fixture append'); },
  async open() { throw new Error('unexpected fixture open'); },
  async evict() { return 'protected'; },
  async restore() { throw new Error('unexpected fixture restore'); },
  async close() {},
};
const service = createThinkService({ native, bodies, context: { directory: '/fixture/vault' }, epoch,
  serviceIdentity: { pid: serverInfo.pid, version: serverInfo.version } });
await service.create({ conversationId, clientCommandId: '22222222-2222-4222-8222-222222222222' });
while ((await service.conversation(conversationId))?.creation !== 'ready') await new Promise(resolve => setTimeout(resolve, 0));
await service.send({ conversationId, clientCommandId: '33333333-3333-4333-8333-333333333333', text: 'fixture' });
await checkpoint;
Bun.gc(true);
const before = process.memoryUsage().heapUsed;
checkpoint = new Promise<void>(resolve => { reached = resolve; });
release?.();
await checkpoint;
Bun.gc(true);
const after = process.memoryUsage().heapUsed;
const closed = await Promise.race([service.close().then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1_000))]);
if (!closed || !monitorSignal?.aborted || count !== warmup + sample) throw new Error('monitor failed to consume or close');
console.log(JSON.stringify({ count, growth: after - before, closed }));
