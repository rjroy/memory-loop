import { captureBodyLimit, captureErrors, isCaptureResponse, parseCaptureRequest } from '../../backend/capture-contract';
import type { LoadedTransport } from '../../backend/transport';
import { safeError } from '../server/logger';
import { allowsWebRequest } from './request-policy';

export interface CaptureBffDependencies {
  transport: LoadedTransport;
  fetch: (target: URL, options: { token: string; body: Uint8Array; signal: AbortSignal }) => Promise<Response>;
  log: (event: string, details: Record<string, unknown>) => void;
}

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const errors = {
  forbidden: { status: 403, message: 'Request is not permitted' },
  not_found: { status: 404, message: 'Not found' },
  method_not_allowed: { status: 405, message: 'Method is not allowed' },
  ...captureErrors,
} as const;
function failure(code: keyof typeof errors): Response {
  const { status, message } = errors[code];
  return Response.json({ error: { code, message } }, { status, headers });
}

async function bounded(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { void reader.cancel().catch(() => {}); throw new Error('body too large'); }
        chunks.push(value);
      }
      return Uint8Array.from(Buffer.concat(chunks));
    };
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error('body timeout')); }, 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
}

export async function handleCaptureRequest(request: Request, dependencies: CaptureBffDependencies): Promise<Response> {
  const requestId = crypto.randomUUID();
  dependencies.log('capture_bff_attempt', { requestId, operation: 'capture' });
  let response: Response;
  let dispatched = false;
  let diagnostic: ReturnType<typeof safeError> | undefined;
  try {
    const url = new URL(request.url);
    if (!allowsWebRequest(request)) response = failure('forbidden');
    else if (url.pathname !== '/api/capture' || url.search || url.hash) response = failure('not_found');
    else if (request.method !== 'POST') response = failure('method_not_allowed');
    else {
      let body: Uint8Array;
      try {
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') || !request.body) throw new Error('invalid content type');
        body = await bounded(request.body, captureBodyLimit);
        const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
        if (!parseCaptureRequest(data)) throw new Error('invalid input');
      } catch {
        response = failure('invalid_request');
        dependencies.log('capture_bff_outcome', { requestId, status: response.status });
        return response;
      }
      const origin = new URL(dependencies.transport.config.daemonOrigin);
      if (origin.origin !== dependencies.transport.config.daemonOrigin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || !/^[a-f0-9]{64}$/.test(dependencies.transport.serviceToken)) throw new Error('invalid transport');
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        dispatched = true;
        const upstream = async () => {
          const result = await dependencies.fetch(new URL('/api/capture', origin), { token: dependencies.transport.serviceToken, body, signal: controller.signal });
          if (!/^application\/json(?:\s*;|\s*$)/i.test(result.headers.get('content-type') ?? '') || !result.body) throw new Error('invalid response');
          const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bounded(result.body, 65536)));
          if (result.status === 200 && isCaptureResponse(data)) return Response.json({ ok: true }, { headers });
          if (data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'code' in data.error) {
            const code = data.error.code;
            if ((code === 'invalid_request' || code === 'capture_unavailable' || code === 'capture_uncertain') && errors[code].status === result.status) return failure(code);
            if ((code === 'unauthorized' && result.status === 401) || (code === 'forbidden' && result.status === 403)) return failure('capture_unavailable');
          }
          throw new Error('unrecognized response');
        };
        response = await Promise.race([upstream(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); }, 5000); })]);
      } finally { if (timer) clearTimeout(timer); }
    }
  } catch (error) { diagnostic = safeError(error, 'upstream_or_protocol_failure'); response = failure(dispatched ? 'capture_uncertain' : 'capture_unavailable'); }
  dependencies.log('capture_bff_outcome', { requestId, operation: 'capture', status: response.status, ...(response.status >= 500 ? diagnostic ?? { category: 'upstream_response_failure' } : {}) });
  return response;
}
