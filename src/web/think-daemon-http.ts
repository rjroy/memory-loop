import 'server-only';
import { request } from 'node:http';
import { parseContentRequest } from '../../backend/think/content-transfer';

const id = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const base = '/api/think/conversations';
const decision = '[A-Za-z0-9_-]{1,128}';
const getPath = new RegExp(`^${base}/${id}(?:/commands/${id}|/content/${id}|/decisions(?:/${decision})?)?$`);
const postPath = new RegExp(`^${base}(?:/${id}/(?:messages|runs/${id}/stop|decisions/${decision}/reply))?$`);

/** Fixed Think routes only; never forwards browser headers or follows redirects. */
export async function thinkDaemonFetch(target: URL, options: { method: 'GET' | 'POST'; token: string; body?: Uint8Array; signal: AbortSignal }): Promise<Response> {
  const parts = target.pathname.slice(base.length).split('/').filter(Boolean);
  const content = options.method === 'GET' && parts.length === 3 && parts[1] === 'content';
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.hash ||
      (content ? !parseContentRequest(parts[0], parts[2], target.searchParams) : (target.search && !(options.method === 'GET' && new RegExp(`^${base}/${id}$`).test(target.pathname) && [...target.searchParams.keys()].length === 1 && /^[A-Za-z0-9_-]{1,256}\.[a-f0-9]{64}$/.test(target.searchParams.get('cursor') ?? '')))) ||
      !(options.method === 'GET' ? getPath : postPath).test(target.pathname) || !/^[a-f0-9]{64}$/.test(options.token)) throw new Error('Invalid Think target');
  return new Promise((resolve, reject) => {
    const upstream = request(target, { method: options.method, signal: options.signal, headers: {
      Accept: 'application/json', Authorization: `Bearer ${options.token}`,
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
