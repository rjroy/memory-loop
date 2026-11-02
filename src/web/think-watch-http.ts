import 'server-only';
import { request } from 'node:http';

const path = /^\/api\/think\/conversations\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/events$/;

/** Dedicated long-lived watch transport; it never forwards browser headers. */
export function thinkWatchFetch(target: URL, token: string, signal: AbortSignal): Promise<Response> {
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password || target.search || target.hash || !path.test(target.pathname) || !/^[a-f0-9]{64}$/.test(token)) return Promise.reject(new Error('invalid watch target'));
  return new Promise((resolve, reject) => {
    const upstream = request(target, { method: 'GET', signal, headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` } });
    const connectTimer = setTimeout(() => upstream.destroy(new Error('watch connection timeout')), 5000);
    upstream.once('error', error => { clearTimeout(connectTimer); reject(error); });
    upstream.once('response', response => {
      clearTimeout(connectTimer);
      if (response.statusCode !== 200 || !/^text\/event-stream(?:\s*;|\s*$)/i.test(response.headers['content-type'] ?? '')) {
        response.destroy(); reject(new Error('invalid watch response')); return;
      }
      upstream.setTimeout(45000, () => upstream.destroy(new Error('watch idle timeout')));
      const iterator = response[Symbol.asyncIterator]();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const item = await iterator.next();
            if (item.done) controller.close(); else controller.enqueue(new Uint8Array(item.value as Buffer));
          } catch { controller.error(new Error('watch unavailable')); }
        },
        cancel() { response.destroy(); upstream.destroy(); },
      }, { highWaterMark: 1 });
      resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    });
    upstream.end();
  });
}
