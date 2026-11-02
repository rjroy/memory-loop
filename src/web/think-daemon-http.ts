import 'server-only';
import { request } from 'node:http';
import { classifyThinkJsonRoute } from './think-json-route';

/** Fixed Think routes only; never forwards browser headers or follows redirects. */
export async function thinkDaemonFetch(target: URL, options: { method: 'GET' | 'POST'; token: string; body?: Uint8Array; signal: AbortSignal; viewToken?: string }): Promise<Response> {
  const route = classifyThinkJsonRoute(target, options.method);
  const content = route?.operation === 'content' && options.method === 'GET';
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password ||
      !route || route.method !== options.method || !/^[a-f0-9]{64}$/.test(options.token) ||
      options.viewToken !== undefined && (route.operation !== 'selection' || options.method !== 'GET' || !/^[A-Za-z0-9_-]{43,256}$/.test(options.viewToken))) throw new Error('Invalid Think target');
  return new Promise((resolve, reject) => {
    const upstream = request(target, { method: options.method, signal: options.signal, headers: {
      Accept: 'application/json', Authorization: `Bearer ${options.token}`,
      ...(options.viewToken === undefined ? {} : { 'X-Memory-Loop-View': options.viewToken }),
      ...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    } }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (content ? 131072 : 65536)) { response.destroy(new Error('Think response too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Think response abandoned')));
      response.on('end', () => {
        try {
          const status = response.statusCode ?? 503;
          if (status >= 300 && status < 400) throw new Error('Think redirect rejected');
          resolve(new Response(Uint8Array.from(Buffer.concat(chunks)), { status, headers: { 'Content-Type': response.headers['content-type'] ?? '' } }));
        } catch (error) { reject(error); }
      });
    });
    upstream.on('error', reject);
    upstream.end(options.body);
  });
}
