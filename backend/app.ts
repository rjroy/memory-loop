import type { VaultErrorCode } from './contract';
import { parseVaultId, type VaultReader } from './vault';

export type VaultState =
  | { reader: VaultReader }
  | { error: Extract<VaultErrorCode, 'config_missing' | 'config_invalid' | 'vault_unavailable'> };

export interface AppOptions {
  /** Exact daemon Host authority, including port. */
  authority: string;
  /** Explicit browser origins, including the Vite development origin when proxied. */
  allowedOrigins: readonly string[];
  vault: VaultState;
}

const publicErrors: Record<VaultErrorCode, { status: number; message: string }> = {
  config_missing: { status: 503, message: 'Vault configuration is missing' },
  config_invalid: { status: 503, message: 'Vault configuration is invalid' },
  vault_unavailable: { status: 503, message: 'Vault directory is unavailable' },
  note_unavailable: { status: 404, message: 'Note is unavailable' },
  invalid_request: { status: 400, message: 'Invalid note identifier' },
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function publicError(code: VaultErrorCode): Response {
  const { status, message } = publicErrors[code];
  return json({ error: { code, message } }, status);
}

function errorCode(error: unknown): VaultErrorCode | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code: unknown = error.code;
  return typeof code === 'string' && Object.hasOwn(publicErrors, code) ? code as VaultErrorCode : undefined;
}

/** Creates the API boundary without starting a listener. */
export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  return async request => {
    const url = new URL(request.url);
    const operation = url.pathname === '/api/vault/tree' ? 'tree' :
      url.pathname === '/api/vault/note' ? 'note' : 'other';
    console.info('vault_api_attempt', { operation });

    async function handle(): Promise<Response> {
      const origin = request.headers.get('origin');
      const site = request.headers.get('sec-fetch-site');
      if (request.headers.get('host') !== options.authority ||
          (origin !== null && (origin === 'null' || !options.allowedOrigins.includes(origin))) ||
          site === 'cross-site') {
        return json({ error: { code: 'forbidden', message: 'Request is not permitted' } }, 403);
      }
      if (request.method !== 'GET') {
        return json({ error: { code: 'method_not_allowed', message: 'Method is not allowed' } }, 405);
      }
      if (operation === 'other') {
        return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
      }
      let id: ReturnType<typeof parseVaultId> | undefined;
      if (operation === 'note') {
        try {
          // URLSearchParams tolerates malformed escapes; validate the raw encoding first.
          decodeURIComponent(url.search.replace(/\+/g, ' '));
          const values = url.searchParams.getAll('id');
          if (values.length !== 1) return publicError('invalid_request');
          id = parseVaultId(values[0]);
        } catch {
          return publicError('invalid_request');
        }
      }
      if ('error' in options.vault) return publicError(options.vault.error);
      try {
        if (operation === 'tree') return json(await options.vault.reader.tree());
        if (id === undefined) return publicError('invalid_request');
        return json(await options.vault.reader.note(id));
      } catch (error: unknown) {
        return publicError(errorCode(error) ?? 'vault_unavailable');
      }
    }

    const response = await handle();
    console.info('vault_api_outcome', { operation, status: response.status });
    return response;
  };
}
