import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { VaultErrorCode } from './contract';
import { parseVaultId, type VaultReader } from './vault';

export type VaultState = { reader: VaultReader } |
  { error: Extract<VaultErrorCode, 'config_missing' | 'config_invalid' | 'vault_unavailable'> };

export interface AppOptions {
  authority: string;
  /** Transitional caller compatibility only; never used as an authorization bypass. */
  allowedOrigins?: readonly string[];
  serviceToken?: string;
  vault: VaultState;
}

const errors: Record<VaultErrorCode, { status: 400 | 404 | 503; message: string }> = {
  config_missing: { status: 503, message: 'Vault configuration is missing' },
  config_invalid: { status: 503, message: 'Vault configuration is invalid' },
  vault_unavailable: { status: 503, message: 'Vault directory is unavailable' },
  note_unavailable: { status: 404, message: 'Note is unavailable' },
  invalid_request: { status: 400, message: 'Invalid note identifier' },
};

function publicError(code: VaultErrorCode): Response {
  const { status, message } = errors[code];
  return Response.json({ error: { code, message } }, { status });
}

function serviceError(error: unknown): Response {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return publicError(typeof code === 'string' && Object.hasOwn(errors, code) ? code as VaultErrorCode : 'vault_unavailable');
}

export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  if (!options.serviceToken || !/^[a-f0-9]{64}$/.test(options.serviceToken)) throw new Error('Service credential unavailable');
  const expected = Buffer.from(options.serviceToken, 'hex');
  const app = new Hono();
  app.use('*', async (context, next) => {
    const requestId = randomUUID();
    const path = context.req.path;
    const operation = path === '/api/vault/tree' ? 'tree' : path === '/api/vault/note' ? 'note' : 'other';
    console.info('vault_api_attempt', { requestId, operation });
    try {
      const headers = context.req.raw.headers;
      if (headers.get('host') !== options.authority || headers.has('origin') ||
          [...headers.keys()].some(name => name.startsWith('sec-fetch-'))) {
        context.res = Response.json({ error: { code: 'forbidden', message: 'Request is not permitted' } }, { status: 403 });
      } else {
        const match = /^Bearer ([a-f0-9]{64})$/.exec(headers.get('authorization') ?? '');
        if (!match || !timingSafeEqual(expected, Buffer.from(match[1], 'hex'))) {
          context.res = Response.json({ error: { code: 'unauthorized', message: 'Service authentication required' } }, { status: 401 });
        } else if (context.req.method !== 'GET') {
          context.res = Response.json({ error: { code: 'method_not_allowed', message: 'Method is not allowed' } }, { status: 405 });
        } else await next();
      }
    } catch {
      context.res = publicError('vault_unavailable');
    }
    context.header('Cache-Control', 'no-store');
    context.header('X-Content-Type-Options', 'nosniff');
    console.info('vault_api_outcome', { requestId, operation, status: context.res.status });
  });
  app.get('/api/vault/tree', async context => {
    if ('error' in options.vault) return publicError(options.vault.error);
    try { return context.json(await options.vault.reader.tree()); } catch (error: unknown) { return serviceError(error); }
  });
  app.get('/api/vault/note', async context => {
    let id: ReturnType<typeof parseVaultId>;
    try {
      const url = new URL(context.req.url);
      decodeURIComponent(url.search.replace(/\+/g, ' '));
      const values = url.searchParams.getAll('id');
      if (values.length !== 1) return publicError('invalid_request');
      id = parseVaultId(values[0]);
    } catch { return publicError('invalid_request'); }
    if ('error' in options.vault) return publicError(options.vault.error);
    try { return context.json(await options.vault.reader.note(id)); } catch (error: unknown) { return serviceError(error); }
  });
  app.notFound(() => Response.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 }));
  return async request => app.fetch(request);
}
