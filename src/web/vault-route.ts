import 'server-only';
import { isAbsolute } from 'node:path';
import { loadTransport } from '../../backend/transport';
import { vaultErrors } from '../../backend/contract';
import { handleVaultRequest } from './vault-bff';
import { daemonContentFetch, daemonFetch, daemonUploadFetch } from './daemon-http';

/** Runtime-only binding. Neither imports nor page rendering open private metadata. */
export async function vaultRoute(request: Request): Promise<Response> {
  let loading = true;
  try {
    const file = process.env.MEMORY_LOOP_TRANSPORT_FILE;
    if (!file || !isAbsolute(file)) throw new Error('Transport selector is unavailable');
    const transport = await loadTransport(file);
    loading = false;
    return await handleVaultRequest(request, { transport, fetch: (target, init) => new URL(String(target)).pathname === '/api/vault/content' ? daemonContentFetch(target, init) : new URL(String(target)).pathname === '/api/vault/attachments' && init?.method === 'POST' ? daemonUploadFetch(target, init) : daemonFetch(target, init), log: (event, details) => console.info(event, details) });
  } catch {
    console.info('vault_bff_configuration_outcome', { status: 'unavailable' });
    const path = new URL(request.url).pathname;
    const search = loading && (path === '/api/vault/search' || path === '/api/vault/search/context');
    const error = search ? { code: 'search_unavailable', message: vaultErrors.search_unavailable.message } : { code: 'service_unavailable', message: 'Vault service unavailable' };
    return Response.json({ error }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' },
    });
  }
}
