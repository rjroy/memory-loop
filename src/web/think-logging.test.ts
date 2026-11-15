import { describe, expect, it } from 'vitest';
import { createServerLogger } from '../server/logger';
import { handleThinkRequest } from './think-bff';
import type { LoadedTransport } from '../../backend/transport';

type Level = 'error' | 'warning' | 'info' | 'verbose';
type Entry = { level: Level; event: string; details: Record<string, unknown> };
const conversationId = '11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);
const transport: LoadedTransport = { config: { daemonOrigin: 'http://127.0.0.1:3001' }, serviceToken: token };
const request = () => new Request(`http://127.0.0.1:3000/api/think/conversations/${conversationId}`, { headers: { host: '127.0.0.1:3000' } });

function fixture(level: Level) {
  const entries: Entry[] = [];
  const logger = createServerLogger({ env: { MEMORY_LOOP_LOG_LEVEL: level }, sink: (level: Level, event: string, details: Record<string, unknown>) => entries.push({ level, event, details }) });
  return { entries, logger };
}

function expectSafeDiagnostic(value: unknown): void {
  expect(value).not.toBeInstanceOf(Error);
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    expect(key).not.toMatch(/^(?:secret|authorization|password|token|bytes|text|sha256|message|stack|cause)$/i);
    expectSafeDiagnostic(nested);
  }
}

describe('Think refresh logging boundary', () => {
  it.each(['info', 'verbose'] as const)('classifies successful snapshot refresh at %s', async level => {
    const { entries, logger } = fixture(level);
    const result = await handleThinkRequest(request(), {
      transport,
      fetch: async () => Response.json({ conversationId, epoch: conversationId, revision: 1, creation: 'ready', sendEligibility: 'available' }),
      log: logger.log,
    });
    expect(result.status).toBe(200);
    if (level === 'info') expect(entries).toEqual([]);
    else {
      expect(entries.map(entry => [entry.level, entry.event])).toEqual([
        ['verbose', 'think_bff_attempt'], ['verbose', 'think_bff_outcome'],
      ]);
      expect(entries[0].details.requestId).toEqual(expect.any(String));
      expect(entries[1].details.requestId).toBe(entries[0].details.requestId);
    }
  });

  it('reports a failed refresh with safe cause and correlation without exposing upstream details', async () => {
    const { entries, logger } = fixture('info');
    const secret = 'private-note-and-password';
    const result = await handleThinkRequest(request(), {
      transport,
      fetch: async () => { throw Object.assign(new Error(secret), { code: 'ECONNREFUSED', authorization: token }); },
      log: logger.log,
    });
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: { code: 'service_unavailable', message: 'Think service unavailable' } });
    expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({
      level: 'error', event: 'think_bff_outcome', details: expect.objectContaining({
        operation: 'snapshot', requestId: expect.any(String), status: 503, code: 'ECONNREFUSED',
      }),
    })]));
    expect(JSON.stringify(entries)).not.toContain(secret);
    expect(JSON.stringify(entries)).not.toContain(token);
  });
});

describe('Think content logging boundary', () => {
  const contentId = '22222222-2222-4222-8222-222222222222';
  const generation = '33333333-3333-4333-8333-333333333333';
  const contentRequest = () => new Request(`http://127.0.0.1:3000/api/think/conversations/${conversationId}/content/${contentId}?generation=${generation}&through=7&offset=0`, { headers: { host: '127.0.0.1:3000' } });

  it.each(['transport', 'http', 'identity', 'offset'] as const)('reports %s failure with safe content correlation', async failure => {
    const { entries, logger } = fixture('info');
    const secret = 'fixture-private-content-and-password';
    const result = await handleThinkRequest(contentRequest(), {
      transport, log: logger.log,
      fetch: async () => {
        if (failure === 'transport') throw Object.assign(new Error(secret), { code: 'ECONNREFUSED' });
        if (failure === 'http') return Response.json({ error: { code: 'service_unavailable', message: secret } }, { status: 503 });
        return Response.json({ conversationId: failure === 'identity' ? generation : conversationId, contentId, generation, through: 7,
          epoch: conversationId, transfer: generation, offset: failure === 'offset' ? 1 : 0,
          nextOffset: 7, bytes: Buffer.from('fixture').toString('base64'), secret });
      },
    });
    expect(result.status).toBe(503);
    expectSafeDiagnostic(entries);
    expect(JSON.stringify(entries)).not.toContain(secret);
    expect(JSON.stringify(entries)).not.toContain(token);
    expect(JSON.stringify(entries)).not.toContain(Buffer.from('fixture').toString('base64'));
    expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ event: 'think_bff_outcome', details: expect.objectContaining({
      operation: 'content', conversationId, contentId, requestId: expect.any(String), status: 503, reason: failure,
    }) })]));
  });
});
