import { safeError, serverLogger } from '../server/logger';
import 'server-only';
import { isAbsolute } from 'node:path';
import { loadTransport } from '../../backend/transport';
import { handleThinkRequest } from './think-bff';
import { thinkDaemonFetch } from './think-daemon-http';
import { handleThinkWatch } from './think-watch-bff';
import { thinkWatchFetch } from './think-watch-http';

export async function thinkRoute(request: Request): Promise<Response> {
  try {
    const file = process.env.MEMORY_LOOP_TRANSPORT_FILE;
    if (!file || !isAbsolute(file)) throw new Error('Transport selector unavailable');
    const transport = await loadTransport(file);
    if (new URL(request.url).pathname.endsWith('/events')) return await handleThinkWatch(request, { transport, fetch: thinkWatchFetch });
    return await handleThinkRequest(request, { transport, fetch: thinkDaemonFetch, log: (event, details) => serverLogger.log(event, details) });
  } catch (error) {
    serverLogger.warning('think_bff_configuration_outcome', { operation: 'load_transport', status: 'unavailable', ...safeError(error, 'transport_configuration_failure') });
    return Response.json({ error: { code: 'service_unavailable', message: 'Think service unavailable' } }, { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  }
}
