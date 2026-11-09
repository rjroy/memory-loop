import type { LoadedTransport } from '../../backend/transport';
import { allowsWebRequest } from './request-policy';
import { projectConversation } from './think-projection';
import { safeError, serverLogger } from '../server/logger';

const route = /^\/api\/think\/conversations\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/events$/;
const safeHeaders = { 'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers: safeHeaders });

export async function handleThinkWatch(request: Request, dependencies: {
  transport: LoadedTransport;
  fetch: (target: URL, token: string, signal: AbortSignal) => Promise<Response>;
}): Promise<Response> {
  if (!allowsWebRequest(request)) return fail(403, 'forbidden', 'Request is not permitted');
  const url = new URL(request.url);
  const match = route.exec(url.pathname);
  if (!match || url.search || url.hash) return fail(404, 'not_found', 'Think resource not found');
  if (request.method !== 'GET') return fail(405, 'method_not_allowed', 'Method is not allowed');
  const requestId = crypto.randomUUID();
  const origin = new URL(dependencies.transport.config.daemonOrigin);
  if (origin.origin !== dependencies.transport.config.daemonOrigin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || !/^[a-f0-9]{64}$/.test(dependencies.transport.serviceToken)) return fail(503, 'service_unavailable', 'Think service unavailable');
  const abort = new AbortController();
  let dispose = () => abort.abort();
  const onAbort = () => dispose();
  request.signal.addEventListener('abort', onAbort, { once: true });
  if (request.signal.aborted) abort.abort();
  let upstream: Response;
  try { upstream = await dependencies.fetch(new URL(url.pathname, origin), dependencies.transport.serviceToken, abort.signal); }
  catch (error) { if (!request.signal.aborted) serverLogger.error('think_watch_outcome', { operation: 'connect', requestId, conversationId: match[1], ...safeError(error, 'watch_connection_failure') }); request.signal.removeEventListener('abort', onAbort); abort.abort(); return fail(503, 'service_unavailable', 'Think service unavailable'); }
  if (upstream.status !== 200 || !/^text\/event-stream(?:\s*;|\s*$)/i.test(upstream.headers.get('content-type') ?? '') || !upstream.body) {
    serverLogger.error('think_watch_outcome', { operation: 'connect', requestId, conversationId: match[1], status: upstream.status, category: 'invalid_watch_response' });
    request.signal.removeEventListener('abort', onAbort); abort.abort(); return fail(503, 'service_unavailable', 'Think service unavailable');
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  let buffer = '';
  let epoch: string | undefined;
  let revision = -1;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    request.signal.removeEventListener('abort', onAbort);
    abort.abort();
    void reader.cancel().catch(() => {});
  };
  dispose = cleanup;
  if (request.signal.aborted) cleanup();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!closed) {
          const boundary = /\r?\n\r?\n/.exec(buffer);
          if (boundary && boundary.index !== undefined) {
            const raw = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            if (Buffer.byteLength(raw) > 60 * 1024) throw new Error('frame too large');
            let event: string | undefined;
            const data: string[] = [];
            for (const line of raw.split(/\r?\n/)) {
              if (line.startsWith(':')) continue;
              if (line.startsWith('event:')) { if (event !== undefined) throw new Error('duplicate event'); event = line.slice(6).trim(); }
              else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
              else if (!line.startsWith('id:') && !line.startsWith('retry:')) throw new Error('invalid frame');
            }
            if (!event || !data.length) throw new Error('invalid frame');
            const parsed: unknown = JSON.parse(data.join('\n'));
            let projected: object;
            if (event === 'heartbeat') {
              if (epoch === undefined || !parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length) throw new Error('invalid heartbeat');
              projected = {};
            } else if (event === 'snapshot' && epoch === undefined) {
              const snapshot = projectConversation(parsed, match[1], true);
              projected = snapshot;
              epoch = snapshot.epoch;
              revision = snapshot.revision;
            } else if (event === 'revision' && epoch !== undefined) {
              const next = projectConversation(parsed, match[1], false);
              if (next.epoch !== epoch || next.revision <= revision) throw new Error('invalid revision');
              projected = next;
              revision = next.revision;
            } else throw new Error('unexpected event');
            const frame = `event: ${event}\ndata: ${JSON.stringify(projected)}\n\n`;
            if (Buffer.byteLength(frame) > 60 * 1024) throw new Error('frame too large');
            controller.enqueue(encoder.encode(frame));
            return;
          }
          if (Buffer.byteLength(buffer) > 60 * 1024) throw new Error('frame too large');
          const item = await reader.read();
          if (item.done) { if (buffer) throw new Error('truncated frame'); cleanup(); controller.close(); return; }
          buffer += decoder.decode(item.value, { stream: true });
        }
        controller.close();
      } catch (error) { if (!request.signal.aborted) serverLogger.error('think_watch_outcome', { operation: 'read', requestId, conversationId: match[1], ...safeError(error, 'watch_stream_failure') }); cleanup(); controller.error(new Error('watch unavailable')); }
    },
    cancel() { cleanup(); },
  }, { highWaterMark: 1 });
  return new Response(body, { status: 200, headers: { ...safeHeaders, 'content-type': 'text/event-stream; charset=utf-8' } });
}
