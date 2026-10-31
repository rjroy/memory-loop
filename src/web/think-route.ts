import 'server-only';
import { isAbsolute } from 'node:path';
import { loadTransport } from '../../backend/transport';
import { handleThinkRequest } from './think-bff';
import { thinkDaemonFetch } from './think-daemon-http';

export async function thinkRoute(request: Request): Promise<Response> {
  try {
    const file = process.env.MEMORY_LOOP_TRANSPORT_FILE;
    if (!file || !isAbsolute(file)) throw new Error('Transport selector unavailable');
    const transport = await loadTransport(file);
    return await handleThinkRequest(request, { transport, fetch: thinkDaemonFetch, log: (event, details) => console.info(event, details) });
  } catch {
    console.info('think_bff_configuration_outcome', { status: 'unavailable' });
    return Response.json({ error: { code: 'service_unavailable', message: 'Think service unavailable' } }, { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  }
}
