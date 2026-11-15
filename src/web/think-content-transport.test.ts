import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../backend/app';
import { thinkHttpService } from '../../backend/think-http-test-fixture';
import { ThinkServiceError } from '../../backend/think/errors';
import { createServerLogger } from '../server/logger';
import { handleThinkRequest } from './think-bff';

vi.mock('server-only', () => ({}));
import { thinkDaemonFetch } from './think-daemon-http';

describe('Think content diagnostics across the private HTTP boundary', () => {
  it('correlates a sanitized 4xx response from daemon through the actual transport and BFF', async () => {
    const conversationId = '11111111-1111-4111-8111-111111111111';
    const contentId = '22222222-2222-4222-8222-222222222222';
    const generation = '33333333-3333-4333-8333-333333333333';
    const token = 'a'.repeat(64);
    const secret = 'fixture-private-body-and-password';
    const entries: Array<{ level: string; event: string; details: Record<string, unknown> }> = [];
    const logger = createServerLogger({ env: { MEMORY_LOOP_LOG_LEVEL: 'info' }, sink: (level, event, details) => entries.push({ level, event, details }) });
    const think = thinkHttpService();
    think.contentChunk.mockRejectedValue(Object.assign(new ThinkServiceError('not_found'), { secret, authorization: token }));
    let app: ReturnType<typeof createApp>;
    let forwardedId: string | undefined;
    const server = createServer(async (incoming, outgoing) => {
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        forwardedId = headers.get('x-memory-loop-request-id') ?? undefined;
        const response = await app(new Request(`http://${incoming.headers.host}${incoming.url}`, { method: incoming.method, headers }));
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch { outgoing.destroy(); }
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('fixture listener unavailable');
      const authority = `127.0.0.1:${address.port}`;
      app = createApp({ authority, serviceToken: token, vault: { error: 'config_missing' }, think, log: logger.log });
      const path = `/api/think/conversations/${conversationId}/content/${contentId}?generation=${generation}&through=7&offset=0`;
      const response = await handleThinkRequest(new Request(`http://127.0.0.1:3000${path}`, { headers: { host: '127.0.0.1:3000' } }), {
        transport: { config: { daemonOrigin: `http://${authority}` }, serviceToken: token }, fetch: thinkDaemonFetch, log: logger.log,
      });
      const requestId = response.headers.get('x-memory-loop-request-id');
      expect(response.status).toBe(404);
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(forwardedId).toBe(requestId);
      expect(think.contentChunk).toHaveBeenCalledOnce();
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ level: 'warning', event: 'think_content_outcome', details: expect.objectContaining({ requestId, conversationId, contentId, generation, status: 404, code: 'not_found' }) }),
        expect.objectContaining({ level: 'warning', event: 'think_bff_outcome', details: expect.objectContaining({ requestId, conversationId, contentId, generation, status: 404, reason: 'http', upstreamStatus: 404 }) }),
      ]));
      const checkSafe = (value: unknown): void => {
        expect(value).not.toBeInstanceOf(Error);
        if (value === null || typeof value !== 'object') return;
        for (const [key, nested] of Object.entries(value)) {
          expect(key).not.toMatch(/^(?:secret|authorization|password|token|bytes|text|sha256|message|stack|cause)$/i);
          checkSafe(nested);
        }
      };
      checkSafe(entries);
      expect(JSON.stringify(entries)).not.toContain(secret);
      expect(JSON.stringify(entries)).not.toContain(token);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
