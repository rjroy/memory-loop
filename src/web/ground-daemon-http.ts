import 'server-only';
import { request } from 'node:http';
import { isGroundRoute } from './ground-bff';

/** The daemon rejects browser Fetch Metadata; forward only fixed routes via Node HTTP. */
export async function groundDaemonFetch(target: URL, options: { token: string; signal: AbortSignal; limit: number }): Promise<Response> {
  const route = target.pathname.slice('/api/ground/'.length);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.search || target.hash ||
      target.pathname !== `/api/ground/${route}` || !isGroundRoute(route) || !/^[a-f0-9]{64}$/.test(options.token)) throw new Error('Invalid Ground target');
  return new Promise((resolve, reject) => {
    const upstream = request(target, { method: 'GET', signal: options.signal, headers: { Accept: 'application/json', Authorization: `Bearer ${options.token}` } }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.limit) { response.destroy(new Error('Ground response too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Ground response abandoned')));
      response.on('end', () => {
        try {
          const status = response.statusCode ?? 503;
          if (status >= 300 && status < 400) throw new Error('Ground redirect rejected');
          resolve(new Response(Uint8Array.from(Buffer.concat(chunks)), { status, headers: { 'Content-Type': response.headers['content-type'] ?? '' } }));
        } catch (error) { reject(error); }
      });
    });
    upstream.on('error', reject);
    upstream.end();
  });
}
