import type { LoadedTransport } from '../../backend/transport';
import type { VaultEntry, VaultId, VaultErrorCode } from '../../backend/contract';
import { allowsWebRequest } from './request-policy';

export interface BffDependencies {
  transport: LoadedTransport;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  log: (event: string, details: Record<string, unknown>) => void;
}

const errors: Record<VaultErrorCode | 'service_unavailable' | 'forbidden' | 'not_found' | 'method_not_allowed', { status: number; message: string }> = {
  config_missing: { status: 503, message: 'Vault configuration is missing' },
  config_invalid: { status: 503, message: 'Vault configuration is invalid' },
  vault_unavailable: { status: 503, message: 'Vault directory is unavailable' },
  note_unavailable: { status: 404, message: 'Note is unavailable' },
  invalid_request: { status: 400, message: 'Invalid note identifier' },
  service_unavailable: { status: 503, message: 'Vault service unavailable' },
  forbidden: { status: 403, message: 'Request is not permitted' },
  not_found: { status: 404, message: 'Not found' },
  method_not_allowed: { status: 405, message: 'Method is not allowed' },
};
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
function failure(code: keyof typeof errors): Response {
  const { status, message } = errors[code];
  return Response.json({ error: { code, message } }, { status, headers });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validId(value: unknown): value is VaultId {
  return Array.isArray(value) && value.length > 0 && value.every((part: unknown) =>
    typeof part === 'string' && part.length > 0 && !part.startsWith('.') && !part.includes('/') && !part.includes('\\') && !part.includes('\0'));
}
function entry(value: unknown): VaultEntry {
  if (!record(value) || typeof value.name !== 'string' || !validId(value.id)) throw new Error('invalid');
  const id = [...value.id];
  if (value.kind === 'note') return { kind: 'note', name: value.name, id };
  if (value.kind === 'directory' && Array.isArray(value.children)) return { kind: 'directory', name: value.name, id, children: value.children.map(entry) };
  throw new Error('invalid');
}
function project(value: unknown, operation: 'tree' | 'note') {
  if (!record(value)) throw new Error('invalid');
  if (operation === 'tree' && Array.isArray(value.entries)) return { entries: value.entries.map(entry) };
  if (operation === 'note' && typeof value.name === 'string' && typeof value.markdown === 'string') return { name: value.name, markdown: value.markdown };
  throw new Error('invalid');
}
function validDaemonOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password;
  } catch { return false; }
}
function domainError(value: unknown, status: number): VaultErrorCode | undefined {
  if (!record(value) || !record(value.error) || typeof value.error.message !== 'string') return;
  const code = value.error.code;
  if (code === 'config_missing' || code === 'config_invalid' || code === 'vault_unavailable' || code === 'note_unavailable' || code === 'invalid_request') {
    if (errors[code].status === status) return code;
  }
}

export async function handleVaultRequest(request: Request, dependencies: BffDependencies): Promise<Response> {
  const { transport, log } = dependencies;
  const url = new URL(request.url);
  const operation = url.pathname === '/api/vault/tree' ? 'tree' : url.pathname === '/api/vault/note' ? 'note' : 'other';
  const requestId = crypto.randomUUID();
  log('vault_bff_attempt', { requestId, operation });
  let response: Response;
  try {
    if (!allowsWebRequest(request, transport.config.web)) response = failure('forbidden');
    else if (operation === 'other') response = failure('not_found');
    else if (request.method !== 'GET') response = failure('method_not_allowed');
    else {
      let id: VaultId | undefined;
      if (operation === 'note') {
        try {
          decodeURIComponent(url.search.replace(/\+/g, ' '));
          const values = url.searchParams.getAll('id');
          const parsed: unknown = values.length === 1 ? JSON.parse(values[0]) : undefined;
          if (validId(parsed)) id = parsed;
        } catch { /* A malformed identifier is a client error. */ }
      }
      if (operation === 'note' && !id) response = failure('invalid_request');
      else if (!validDaemonOrigin(transport.config.daemonOrigin) || !/^[a-f0-9]{64}$/.test(transport.serviceToken)) response = failure('service_unavailable');
      else {
        const target = new URL(`/api/vault/${operation}`, transport.config.daemonOrigin);
        if (id) target.searchParams.set('id', JSON.stringify(id));
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 5000);
          });
          const upstream = async () => {
            const result = await dependencies.fetch(target, { headers: { Accept: 'application/json', Authorization: `Bearer ${transport.serviceToken}` }, cache: 'no-store', redirect: 'error', signal: controller.signal });
            if (!/^application\/json(?:\s*;|\s*$)/i.test(result.headers.get('content-type') ?? '')) throw new Error('invalid');
            const value: unknown = await result.json();
            if (result.status === 200) return Response.json(project(value, operation), { headers });
            const code = domainError(value, result.status);
            return code ? failure(code) : failure('service_unavailable');
          };
          response = await Promise.race([upstream(), timeout]);
        } finally { if (timer !== undefined) clearTimeout(timer); }
      }
    }
  } catch { response = failure('service_unavailable'); }
  log('vault_bff_outcome', { requestId, operation, status: response.status });
  return response;
}
