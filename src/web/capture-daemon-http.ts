import 'server-only';
import { request } from 'node:http';

/** A single fixed daemon route; browser headers and redirects are never forwarded. */
export async function captureDaemonFetch(target: URL, options: { token: string; body: Uint8Array; signal: AbortSignal }): Promise<Response> {
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.pathname !== '/api/capture' || target.search || target.hash || !/^[a-f0-9]{64}$/.test(options.token)) throw new Error('Invalid Capture target');
  return new Promise((resolve, reject) => {
    const upstream = request(target, { method: 'POST', signal: options.signal, headers: { Accept: 'application/json', Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' } }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 65536) { response.destroy(new Error('Capture response too large')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Capture response abandoned')));
      response.on('end', () => {
        try {
          const status = response.statusCode ?? 503;
          if (status >= 300 && status < 400) throw new Error('Capture redirect rejected');
          resolve(new Response(Uint8Array.from(Buffer.concat(chunks)), { status, headers: { 'Content-Type': response.headers['content-type'] ?? '' } }));
        } catch (error) { reject(error); }
      });
    });
    upstream.on('error', reject);
    upstream.end(options.body);
  });
}
