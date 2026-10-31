import 'server-only';
import { isAbsolute } from 'node:path';
import { loadTransport } from '../../backend/transport';
import { handleCaptureRequest } from './capture-bff';
import { captureDaemonFetch } from './capture-daemon-http';

export async function captureRoute(request: Request): Promise<Response> {
  try {
    const file = process.env.MEMORY_LOOP_TRANSPORT_FILE;
    if (!file || !isAbsolute(file)) throw new Error('Transport selector unavailable');
    const transport = await loadTransport(file);
    return await handleCaptureRequest(request, { transport, fetch: captureDaemonFetch, log: (event, details) => console.info(event, details) });
  } catch {
    console.info('capture_bff_configuration_outcome', { status: 'unavailable' });
    return Response.json({ error: { code: 'capture_unavailable', message: 'Capture is unavailable' } }, { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  }
}
