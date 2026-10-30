import 'server-only';
import { isAbsolute } from 'node:path';
import { loadTransport } from '../../backend/transport';
import { handleVaultRequest } from './vault-bff';
import { daemonFetch } from './daemon-http';

/** Runtime-only binding. Neither imports nor page rendering open private metadata. */
export async function vaultRoute(request: Request): Promise<Response> {
  try {
    const file = process.env.MEMORY_LOOP_TRANSPORT_FILE;
    if (!file || !isAbsolute(file)) throw new Error('Transport selector is unavailable');
    const transport = await loadTransport(file);
    return await handleVaultRequest(request, { transport, fetch: daemonFetch, log: (event, details) => console.info(event, details) });
  } catch {
    console.info('vault_bff_configuration_outcome', { status: 'unavailable' });
    return Response.json({ error: { code: 'service_unavailable', message: 'Vault service unavailable' } }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
    });
  }
}
