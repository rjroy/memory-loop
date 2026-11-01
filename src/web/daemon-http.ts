import 'server-only';
import { request } from 'node:http';
import { vaultSaveBodyLimit } from '../../backend/contract';

/** Node fetch adds Sec-Fetch-Mode even with fresh headers. The service protocol
 * deliberately forbids browser metadata, so use the standard Node HTTP client. */
export async function daemonFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!(input instanceof URL)) throw new Error('Invalid service target');
  if (input.protocol !== 'http:' || input.hostname !== '127.0.0.1' || input.username || input.password ||
      !['/api/vault/tree', '/api/vault/note'].includes(input.pathname) || input.hash) throw new Error('Invalid service target');
  const method = init?.method ?? 'GET';
  const saving = method === 'POST' && input.pathname === '/api/vault/note' && !input.search;
  if (method !== 'GET' && !saving) throw new Error('Invalid service method');
  if (saving && (typeof init?.body !== 'string' || Buffer.byteLength(init.body) > vaultSaveBodyLimit)) throw new Error('Invalid service body');
  const supplied = new Headers(init?.headers);
  const headers = { Accept: supplied.get('accept') ?? 'application/json', Authorization: supplied.get('authorization') ?? '', ...(saving ? { 'Content-Type': 'application/json' } : {}) };
  return new Promise<Response>((resolve, reject) => {
    const upstream = request(input, { method, headers, signal: init?.signal ?? undefined }, response => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Service response abandoned')));
      response.on('end', () => {
        try {
          const status = response.statusCode ?? 503;
          if (status >= 300 && status < 400) throw new Error('Service redirect rejected');
          resolve(new Response(Uint8Array.from(Buffer.concat(chunks)), {
            status, headers: { 'Content-Type': response.headers['content-type'] ?? '' },
          }));
        } catch (error) { reject(error); }
      });
    });
    upstream.on('error', reject);
    upstream.end(saving && typeof init?.body === 'string' ? init.body : undefined);
  });
}
