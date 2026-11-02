import 'server-only';
import { request } from 'node:http';
import { once } from 'node:events';
import { vaultActionBodyLimit, vaultSaveBodyLimit, vaultSearchBodyLimit } from '../../backend/contract';

/** Node fetch adds Sec-Fetch-Mode even with fresh headers. The service protocol
 * deliberately forbids browser metadata, so use the standard Node HTTP client. */
export async function daemonFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!(input instanceof URL)) throw new Error('Invalid service target');
  if (input.protocol !== 'http:' || input.hostname !== '127.0.0.1' || input.username || input.password ||
      !['/api/vault/tree', '/api/vault/directory', '/api/vault/note', '/api/vault/actions', '/api/vault/file', '/api/vault/attachments', '/api/vault/search', '/api/vault/search/context'].includes(input.pathname) || input.hash) throw new Error('Invalid service target');
  const method = init?.method ?? 'GET';
  const searching = input.pathname === '/api/vault/search' || input.pathname === '/api/vault/search/context';
  const saving = method === 'POST' && (input.pathname === '/api/vault/note' || input.pathname === '/api/vault/actions' || searching) && !input.search;
  if (method !== 'GET' && !saving || method === 'GET' && (input.pathname === '/api/vault/actions' || searching)) throw new Error('Invalid service method');
  if (saving && (typeof init?.body !== 'string' || Buffer.byteLength(init.body) > (searching ? vaultSearchBodyLimit : input.pathname === '/api/vault/actions' ? vaultActionBodyLimit : vaultSaveBodyLimit))) throw new Error('Invalid service body');
  const supplied = new Headers(init?.headers);
  const headers = { Accept: supplied.get('accept') ?? 'application/json', Authorization: supplied.get('authorization') ?? '', ...(saving ? { 'Content-Type': 'application/json' } : {}) };
  return new Promise<Response>((resolve, reject) => {
    const upstream = request(input, { method, headers, signal: init?.signal ?? undefined }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (searching && size > 4 * 1024 * 1024) { response.destroy(new Error('Service response too large')); return; }
        chunks.push(chunk);
      });
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

export async function daemonUploadFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!(input instanceof URL) || input.protocol !== 'http:' || input.hostname !== '127.0.0.1' || input.username || input.password || input.pathname !== '/api/vault/attachments' || input.hash || init?.method !== 'POST' || !(init.body instanceof ReadableStream)) throw new Error('Invalid service upload');
  const supplied = new Headers(init.headers);
  const reader = init.body.getReader();
  return new Promise<Response>((resolve, reject) => {
    const upstream = request(input, { method: 'POST', headers: { accept: 'application/json', authorization: supplied.get('authorization') ?? '', 'content-type': 'application/octet-stream' }, signal: init.signal ?? undefined }, response => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > 65536) { response.destroy(); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('aborted', () => reject(new Error('Service response abandoned')));
      response.on('end', () => {
        try {
          const status = response.statusCode ?? 503;
          if (status >= 300 && status < 400) throw new Error('Service redirect rejected');
          resolve(new Response(Uint8Array.from(Buffer.concat(chunks)), { status, headers: { 'content-type': response.headers['content-type'] ?? '' } }));
        } catch (error) { reject(error); }
      });
    });
    upstream.on('error', error => { void reader.cancel(error).catch(() => {}); reject(error); });
    void (async () => {
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          if (!upstream.write(item.value)) await once(upstream, 'drain');
        }
        upstream.end();
      } catch (error) { upstream.destroy(); reject(error); }
      finally { reader.releaseLock(); }
    })();
  });
}

/** Content has a separate streaming transport; it must not use the JSON buffer. */
export async function daemonContentFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!(input instanceof URL) || input.protocol !== 'http:' || input.hostname !== '127.0.0.1' || input.username || input.password || input.pathname !== '/api/vault/content' || input.hash) throw new Error('Invalid service target');
  const method = init?.method ?? 'GET';
  if ((method !== 'GET' && method !== 'HEAD') || init?.body) throw new Error('Invalid service method');
  const supplied = new Headers(init?.headers);
  const range = method === 'GET' ? supplied.get('range') : null;
  if (range !== null && (range.length > 256 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))) throw new Error('Invalid service range');
  const headers = { Accept: '*/*', Authorization: supplied.get('authorization') ?? '', ...(range ? { Range: range } : {}) };
  return new Promise<Response>((resolve, reject) => {
    const upstream = request(input, { method, headers, signal: init?.signal ?? undefined }, response => {
      try {
        const status = response.statusCode ?? 503;
        if (status >= 300 && status < 400) throw new Error('Service redirect rejected');
        const forwarded = new Headers();
        for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition', 'content-security-policy']) {
          const value = response.headers[name];
          if (typeof value === 'string') forwarded.set(name, value);
        }
        if (method === 'HEAD' || status === 204 || status === 304) {
          response.resume();
          resolve(new Response(null, { status, headers: forwarded }));
        } else {
          const iterator = response[Symbol.asyncIterator]();
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const item = await iterator.next();
                if (item.done) { controller.close(); return; }
                const bytes: unknown = item.value;
                if (!(bytes instanceof Uint8Array)) throw new Error('Invalid service bytes');
                controller.enqueue(bytes);
              } catch (error) { response.destroy(); controller.error(error); }
            },
            cancel() { response.destroy(); },
          }, { highWaterMark: 0 });
          resolve(new Response(body, { status, headers: forwarded }));
        }
      } catch (error) { response.destroy(); reject(error); }
    });
    upstream.on('error', reject);
    upstream.end();
  });
}
