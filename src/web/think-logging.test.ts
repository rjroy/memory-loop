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
