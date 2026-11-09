import { safeError, serverLogger } from '../server/logger';
import 'server-only';
import { isAbsolute } from 'node:path';
import { loadTransport } from '../../backend/transport';
import { captureErrors } from '../../backend/capture-contract';
import { handleCaptureRequest } from './capture-bff';
import { captureDaemonFetch } from './capture-daemon-http';

export async function captureRoute(request: Request): Promise<Response> {
  try {
    const file = process.env.MEMORY_LOOP_TRANSPORT_FILE;
    if (!file || !isAbsolute(file)) throw new Error('Transport selector unavailable');
    const transport = await loadTransport(file);
    return await handleCaptureRequest(request, { transport, fetch: captureDaemonFetch, log: (event, details) => serverLogger.log(event, details) });
  } catch (error) {
    serverLogger.warning('capture_bff_configuration_outcome', { operation: 'load_transport', status: 'unavailable', ...safeError(error, 'transport_configuration_failure') });
    return Response.json({ error: { code: 'capture_unavailable', message: captureErrors.capture_unavailable.message } }, { status: captureErrors.capture_unavailable.status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  }
}
