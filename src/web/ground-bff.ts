import type { LoadedTransport } from '../../backend/transport';
import { allowsWebRequest } from './request-policy';
import { projectGround, type GroundRoute } from './ground-projection';
import { projectRecentConversations, validViewToken } from './ground-conversations-projection';

type GroundTarget = GroundRoute | 'recent-conversations';
export const groundRoutes: readonly GroundTarget[] = ['quick-actions', 'inspiration', 'prompts', 'goals', 'recent-captures', 'recent-conversations'];
export function isGroundRoute(value: string): value is GroundTarget { return groundRoutes.some(item => item === value); }
export interface GroundBffDependencies {
  transport: LoadedTransport;
  fetch: (target: URL, options: { token: string; signal: AbortSignal; limit: number; viewToken?: string }) => Promise<Response>;
  log: (event: string, details: Record<string, unknown>) => void;
}
export const groundHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const errors = {
  forbidden: { status: 403, message: 'Request is not permitted' },
  not_found: { status: 404, message: 'Not found' },
  method_not_allowed: { status: 405, message: 'Method is not allowed' },
  invalid_request: { status: 400, message: 'Invalid Ground request' },
  service_unavailable: { status: 503, message: 'Ground service unavailable' },
} as const;
export function groundFailure(code: keyof typeof errors): Response {
  const { status, message } = errors[code];
  return Response.json({ error: { code, message } }, { status, headers: groundHeaders });
}
async function readBounded(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw new Error('response too large'); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { reader.releaseLock(); }
}

export async function handleGroundRequest(request: Request, dependencies: GroundBffDependencies): Promise<Response> {
  const requestId = crypto.randomUUID();
  dependencies.log('ground_bff_attempt', { requestId });
  let response: Response;
  try {
    const url = new URL(request.url);
    const route = url.pathname.slice('/api/ground/'.length);
    if (!allowsWebRequest(request, dependencies.transport.config.web)) response = groundFailure('forbidden');
    else if (url.pathname !== `/api/ground/${route}` || !isGroundRoute(route)) response = groundFailure('not_found');
    else if (request.method !== 'GET') response = groundFailure('method_not_allowed');
    else if (url.search || url.hash) response = groundFailure('invalid_request');
    else if (route === 'recent-conversations' && request.headers.has('x-memory-loop-view') && !validViewToken(request.headers.get('x-memory-loop-view'))) response = groundFailure('invalid_request');
    else {
      const origin = new URL(dependencies.transport.config.daemonOrigin);
      if (origin.origin !== dependencies.transport.config.daemonOrigin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || !/^[a-f0-9]{64}$/.test(dependencies.transport.serviceToken)) throw new Error('invalid transport');
      const limit = route === 'goals' || route === 'quick-actions' ? 512 * 1024 : 64 * 1024;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const upstream = async () => {
          const viewToken = route === 'recent-conversations' ? request.headers.get('x-memory-loop-view') : null;
          const result = await dependencies.fetch(new URL(`/api/ground/${route}`, origin), { token: dependencies.transport.serviceToken, signal: controller.signal, limit, ...(viewToken === null ? {} : { viewToken }) });
          if (!/^application\/json(?:\s*;|\s*$)/i.test(result.headers.get('content-type') ?? '') || !result.body) throw new Error('invalid response');
          const bytes = await readBounded(result.body, limit);
          const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
          return Response.json(route === 'recent-conversations' ? projectRecentConversations(value, result.status) : projectGround(value, route, result.status), { status: result.status, headers: groundHeaders });
        };
        response = await Promise.race([upstream(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 5000); })]);
      } finally { if (timer) clearTimeout(timer); }
    }
  } catch { response = groundFailure('service_unavailable'); }
  dependencies.log('ground_bff_outcome', { requestId, status: response.status });
  return response;
}
