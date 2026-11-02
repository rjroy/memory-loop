import 'server-only';
import { isAbsolute } from 'node:path';
import { loadTransport } from '../../backend/transport';
import { groundFailure, handleGroundRequest } from './ground-bff';
import { groundDaemonFetch } from './ground-daemon-http';

export async function groundRoute(request: Request): Promise<Response> {
  try {
    const file = process.env.MEMORY_LOOP_TRANSPORT_FILE;
    if (!file || !isAbsolute(file)) throw new Error('Transport selector unavailable');
    const transport = await loadTransport(file);
    return await handleGroundRequest(request, { transport, fetch: groundDaemonFetch, log: (event, details) => console.info(event, details) });
  } catch {
    console.info('ground_bff_configuration_outcome', { status: 'unavailable' });
    return groundFailure('service_unavailable');
  }
}
