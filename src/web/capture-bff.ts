import { captureBodyLimit, parseCaptureRequest } from '../../backend/capture-contract';
import type { LoadedTransport } from '../../backend/transport';
import { allowsWebRequest } from './request-policy';

export interface CaptureBffDependencies {
  transport: LoadedTransport;
  fetch: (target: URL, options: { token: string; body: Uint8Array; signal: AbortSignal }) => Promise<Response>;
  log: (event: string, details: Record<string, unknown>) => void;
}

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const errors = {
  forbidden: [403, 'Request is not permitted'],
  not_found: [404, 'Not found'],
  method_not_allowed: [405, 'Method is not allowed'],
  invalid_request: [400, 'Invalid Capture request (maximum 1 MiB of UTF-8 text)'],
  capture_unavailable: [503, 'Capture is unavailable'],
  capture_uncertain: [503, 'Capture save is unconfirmed'],
} as const;
function failure(code: keyof typeof errors): Response {
  const [status, message] = errors[code];
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
  dependencies.log('capture_bff_attempt', { requestId });
  let response: Response;
  let dispatched = false;
  try {
    const url = new URL(request.url);
    if (!allowsWebRequest(request, dependencies.transport.config.web)) response = failure('forbidden');
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
          if (result.status === 200 && data !== null && typeof data === 'object' && 'ok' in data && data.ok === true && Object.keys(data).length === 1) return Response.json({ ok: true }, { headers });
          if (data && typeof data === 'object' && 'error' in data && data.error && typeof data.error === 'object' && 'code' in data.error) {
            const code = data.error.code;
            if ((code === 'invalid_request' || code === 'capture_unavailable' || code === 'capture_uncertain') && errors[code][0] === result.status) return failure(code);
            if ((code === 'unauthorized' && result.status === 401) || (code === 'forbidden' && result.status === 403)) return failure('capture_unavailable');
          }
          throw new Error('unrecognized response');
        };
        response = await Promise.race([upstream(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 5000); })]);
      } finally { if (timer) clearTimeout(timer); }
    }
  } catch { response = failure(dispatched ? 'capture_uncertain' : 'capture_unavailable'); }
  dependencies.log('capture_bff_outcome', { requestId, status: response.status });
  return response;
}
