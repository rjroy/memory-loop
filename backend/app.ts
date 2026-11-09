import { safeError, serverLogger } from '../src/server/logger';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { defaultUploadMaxBytes, isUploadName, isVaultDirectoryId, isVaultErrorCode, parseVaultSaveRequest, parseVaultAction, vaultActionBodyLimit, vaultErrors, vaultSaveBodyLimit, type VaultErrorCode, type VaultId } from './contract';
import type { ThinkService, ThinkUnavailableCode } from './think/service';
import { ThinkServiceError } from './think/errors';
import { thinkErrors, type ThinkErrorCode } from './think/contract';
import { parseContentRequest } from './think/content-transfer';
import { parseVaultId, type VaultReader } from './vault';
import { captureBodyLimit, captureErrors, parseCaptureRequest } from './capture-contract';
import { CaptureError, type CaptureWriter } from './capture';
import type { GroundReader } from './ground';
import { validViewToken, type ConversationService } from './think/conversations';
import { parseVaultSearchRequest, parseVaultSearchContextRequest, vaultSearchBodyLimit } from './contract';

export type VaultState = { reader: VaultReader } |
  { error: Extract<VaultErrorCode, 'config_missing' | 'config_invalid' | 'vault_unavailable'> };

export interface AppOptions {
  authority: string;
  serviceToken?: string;
  vault: VaultState;
  uploadMaxBytes?: number;
  capture?: CaptureWriter;
  ground?: GroundReader;
  groundError?: 'configuration' | 'io';
  groundDemand?: (job: 'questions' | 'quotes') => void;
  think?: ThinkService | { error: ThinkUnavailableCode };
  /** Registry-only capabilities remain usable without an authorized native attachment. */
  conversations?: ConversationService;
  watchPolicy?: { leaseMs: number; heartbeatMs: number };
  log?: typeof serverLogger.log;
}

function publicError(code: VaultErrorCode): Response {
  const { status, message } = vaultErrors[code];
  return Response.json({ error: { code, message } }, { status });
}

function serviceError(error: unknown): Response {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return publicError(isVaultErrorCode(code) ? code : 'vault_unavailable');
}

function thinkError(code: ThinkErrorCode): Response {
  const { status, message } = thinkErrors[code];
  return Response.json({ error: { code, message } }, { status });
}

function thinkServiceError(error: unknown): Response {
  if (error instanceof ThinkServiceError && error.code === 'delete_blocked' && error.reason) {
    return Response.json({ error: { code: error.code, message: thinkErrors.delete_blocked.message, reason: error.reason } }, { status: 409 });
  }
  return thinkError(error instanceof ThinkServiceError ? error.code : 'think_unavailable');
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const thinkBase = '/api/think/conversations';

async function jsonInput(request: Request, limit: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(text) as unknown;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export function createApp(options: AppOptions): (request: Request) => Promise<Response> {
  const log = options.log ?? serverLogger.log;
  const watchPolicy = options.watchPolicy ?? { leaseMs: 300000, heartbeatMs: 15000 };
  if (!Number.isSafeInteger(watchPolicy.leaseMs) || watchPolicy.leaseMs < 1 || !Number.isSafeInteger(watchPolicy.heartbeatMs) || watchPolicy.heartbeatMs < 1) throw new Error('Invalid watch policy');
  if (!options.serviceToken || !/^[a-f0-9]{64}$/.test(options.serviceToken)) throw new Error('Service credential unavailable');
  const expected = Buffer.from(options.serviceToken, 'hex');
  const app = new Hono();
  app.use('*', async (context, next) => {
    const requestId = randomUUID();
    const path = context.req.path;
    const operation = path === '/api/vault/search' || path === '/api/vault/search/context' ? 'search' : path === '/api/vault/tree' ? 'tree' : path === '/api/vault/directory' ? 'directory' : path === '/api/vault/note' ? 'note' : path === '/api/vault/file' ? 'file' : path === '/api/vault/content' ? 'content' : path === '/api/vault/attachments' ? 'attachments' : path === '/api/vault/actions' ? 'actions' : path === '/api/capture' ? 'capture' : path.startsWith('/api/think/') ? 'think' : 'other';
    log('vault_api_attempt', { requestId, operation });
    try {
      const headers = context.req.raw.headers;
      if (headers.get('host') !== options.authority || headers.has('origin') ||
          [...headers.keys()].some(name => name.startsWith('sec-fetch-'))) {
        context.res = Response.json({ error: { code: 'forbidden', message: 'Request is not permitted' } }, { status: 403 });
      } else {
        const match = /^Bearer ([a-f0-9]{64})$/.exec(headers.get('authorization') ?? '');
        if (!match || !timingSafeEqual(expected, Buffer.from(match[1], 'hex'))) {
          context.res = Response.json({ error: { code: 'unauthorized', message: 'Service authentication required' } }, { status: 401 });
        } else if (context.req.method !== 'GET' && !(context.req.raw.method === 'HEAD' && path === '/api/vault/content') && !(context.req.method === 'POST' && (path === '/api/vault/search' || path === '/api/vault/search/context' || path === '/api/vault/note' || path === '/api/vault/actions' || path === '/api/vault/attachments' || path === '/api/capture' || path === thinkBase ||
          path === '/api/think/views' || path === '/api/think/selection' ||
          /^\/api\/think\/conversations\/[^/]+\/(?:resume|delete|messages|runs\/[^/]+\/stop|decisions\/[^/]+\/reply)$/.test(path)))) {
          context.res = Response.json({ error: { code: 'method_not_allowed', message: 'Method is not allowed' } }, { status: 405 });
        } else await next();
      }
    } catch (error) {
      serverLogger.error('vault_api_failure', { requestId, operation, ...safeError(error, 'request_handler_failure') });
      context.res = operation === 'think' ? thinkError('think_unavailable') : publicError(operation === 'search' ? 'search_unavailable' : path === '/api/vault/actions' && context.req.method === 'POST' ? 'file_action_uncertain' : path === '/api/vault/note' && context.req.method === 'POST' ? 'note_save_uncertain' : 'vault_unavailable');
    }
    context.header('Cache-Control', 'no-store');
    context.header('X-Content-Type-Options', 'nosniff');
    log('vault_api_outcome', { requestId, operation, status: context.res.status, ...(context.res.status >= 500 ? { category: 'service_response_failure' } : {}) });
  });
  app.post('/api/capture', async context => {
    const input = parseCaptureRequest(await jsonInput(context.req.raw, captureBodyLimit));
    if (!input) return Response.json({ error: { code: 'invalid_request', message: captureErrors.invalid_request.message } }, { status: captureErrors.invalid_request.status });
    if (!options.capture) return Response.json({ error: { code: 'capture_unavailable', message: captureErrors.capture_unavailable.message } }, { status: captureErrors.capture_unavailable.status });
    try {
      await options.capture.capture(input.text);
      return context.json({ ok: true });
    } catch (error: unknown) {
      const code = error instanceof CaptureError ? error.code : 'capture_uncertain';
      return Response.json({ error: { code, message: captureErrors[code].message } }, { status: captureErrors[code].status });
    }
  });
  for (const [path, kind] of [
    ['quick-actions', 'quickActions'], ['inspiration', 'inspiration'], ['prompts', 'prompts'], ['goals', 'goals'], ['recent-captures', 'captures'],
  ] as const) {
    app.get(`/api/ground/${path}`, async context => {
      if (new URL(context.req.url).search) return Response.json({ error: { code: 'invalid_request', message: 'Invalid Ground request' } }, { status: 400 });
      serverLogger.log('ground_read_attempt', { resource: path });
      let result;
      try { result = options.ground ? kind === 'captures' ? await options.ground.captures() : await options.ground.resource(kind) : { state: 'unavailable' as const, reason: options.groundError ?? 'configuration' }; }
      catch { result = { state: 'unavailable' as const, reason: 'io' as const }; }
      if (kind === 'prompts' || kind === 'inspiration') options.groundDemand?.(kind === 'prompts' ? 'questions' : 'quotes');
      serverLogger.log('ground_read_outcome', { resource: path, state: result.state });
      return Response.json(result, { status: result.state === 'unavailable' ? 503 : 200 });
    });
  }
  app.get('/api/ground/recent-conversations', async context => {
    if (new URL(context.req.url).search) return thinkError('invalid_request');
    const viewToken = context.req.header('X-Memory-Loop-View');
    if (viewToken !== undefined && !validViewToken(viewToken)) return thinkError('invalid_request');
    const service = options.conversations ?? options.think;
    serverLogger.log('ground_read_attempt', { resource: 'recent-conversations' });
    try {
      if (!service || 'error' in service) throw new Error('Registry unavailable');
      const result = await service.recentConversations(viewToken);
      serverLogger.log('ground_read_outcome', { resource: 'recent-conversations', state: result.state });
      return context.json(result);
    } catch {
      serverLogger.log('ground_read_outcome', { resource: 'recent-conversations', state: 'unavailable' });
      return context.json({ state: 'unavailable' }, 503);
    }
  });
  app.post('/api/think/views', async context => {
    const value = await jsonInput(context.req.raw, 4096);
    if (new URL(context.req.url).search || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) return thinkError('invalid_request');
    const service = options.conversations ?? options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { return context.json(await service.registerView(), 201); } catch (error) { return thinkServiceError(error); }
  });
  app.get('/api/think/selection', async context => {
    if (new URL(context.req.url).search) return thinkError('invalid_request');
    const viewToken = context.req.header('X-Memory-Loop-View');
    if (!validViewToken(viewToken)) return thinkError('lease_unavailable');
    const service = options.conversations ?? options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { return context.json(await service.selection(viewToken)); } catch (error) { return thinkServiceError(error); }
  });
  app.post('/api/think/selection', async context => {
    const value = await jsonInput(context.req.raw, 4096);
    if (new URL(context.req.url).search || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3 ||
        !('viewToken' in value) || !validViewToken(value.viewToken) || !('expectedRevision' in value) || typeof value.expectedRevision !== 'number' ||
        !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || !('conversationId' in value) ||
        value.conversationId !== null && (typeof value.conversationId !== 'string' || !uuid.test(value.conversationId))) return thinkError('invalid_request');
    const service = options.conversations ?? options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { return context.json(await service.select({ viewToken: value.viewToken, expectedRevision: value.expectedRevision, conversationId: value.conversationId })); }
    catch (error) { return thinkServiceError(error); }
  });
  app.get('/api/vault/tree', async context => {
    if ('error' in options.vault) return publicError(options.vault.error);
    try { return context.json(await options.vault.reader.tree()); } catch (error: unknown) { return serviceError(error); }
  });
  app.get('/api/vault/directory', async context => {
    let id: VaultId;
    try {
      const url = new URL(context.req.url);
      decodeURIComponent(url.search.replace(/\+/g, ' '));
      const values = url.searchParams.getAll('id');
      if (values.length !== 1 || [...url.searchParams.keys()].some(key => key !== 'id')) return publicError('invalid_request');
      const parsed: unknown = JSON.parse(values[0]);
      if (!isVaultDirectoryId(parsed)) return publicError('invalid_request');
      id = parsed;
    } catch { return publicError('invalid_request'); }
    if ('error' in options.vault) return publicError(options.vault.error);
    try { return context.json(await options.vault.reader.directory(id)); } catch (error: unknown) { return serviceError(error); }
  });
  for (const path of ['/api/vault/search', '/api/vault/search/context']) {
    app.get(path, () => Response.json({ error: { code: 'method_not_allowed', message: 'Method is not allowed' } }, { status: 405 }));
  }
  app.post('/api/vault/search', async context => {
    if (new URL(context.req.url).search) return publicError('invalid_request');
    const input = parseVaultSearchRequest(await jsonInput(context.req.raw, vaultSearchBodyLimit));
    if (!input) return publicError('invalid_request');
    if ('error' in options.vault) return publicError('search_unavailable');
    const started = performance.now();
    serverLogger.log('vault_search_attempt', { mode: input.mode, queryLength: input.query.replace(/\s/gu, '').length });
    try {
      const result = await options.vault.reader.search(input, context.req.raw.signal);
      serverLogger.log('vault_search_outcome', { mode: input.mode, durationMs: performance.now() - started, counts: result.counts, coverage: result.coverage, limited: result.limited });
      return context.json(result);
    } catch (error) {
      serverLogger.log('vault_search_outcome', { mode: input.mode, durationMs: performance.now() - started, status: 'unavailable' });
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      return publicError(code === 'invalid_request' ? code : 'search_unavailable');
    }
  });
  app.post('/api/vault/search/context', async context => {
    if (new URL(context.req.url).search) return publicError('invalid_request');
    const input = parseVaultSearchContextRequest(await jsonInput(context.req.raw, vaultSearchBodyLimit));
    if (!input) return publicError('invalid_request');
    if ('error' in options.vault) return publicError('search_unavailable');
    const started = performance.now();
    serverLogger.log('vault_search_context_attempt', { queryLength: input.query.replace(/\s/gu, '').length });
    try {
      const result = await options.vault.reader.searchContext(input, context.req.raw.signal);
      serverLogger.log('vault_search_context_outcome', { durationMs: performance.now() - started, status: 'loaded', truncated: result.truncated });
      return context.json(result);
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      const failure = code === 'search_context_changed' || code === 'invalid_request' ? code : 'search_unavailable';
      serverLogger.log('vault_search_context_outcome', { durationMs: performance.now() - started, status: failure });
      return publicError(failure);
    }
  });
  app.get('/api/vault/attachments', context => {
    if (new URL(context.req.url).search) return publicError('invalid_request');
    if ('error' in options.vault) return publicError(options.vault.error);
    return context.json({ maxFileBytes: options.uploadMaxBytes ?? defaultUploadMaxBytes });
  });
  app.post('/api/vault/attachments', async context => {
    let name: string;
    try {
      const url = new URL(context.req.url);
      decodeURIComponent(url.search.replace(/\+/g, ' '));
      const names = url.searchParams.getAll('name');
      if (names.length !== 1 || [...url.searchParams.keys()].some(key => key !== 'name') || !isUploadName(names[0])) return publicError('invalid_request');
      name = names[0];
    } catch { return publicError('invalid_request'); }
    const request = context.req.raw;
    const limit = options.uploadMaxBytes ?? defaultUploadMaxBytes;
    const length = request.headers.get('content-length');
    if (request.headers.get('content-type')?.toLowerCase() !== 'application/octet-stream' || !request.body || (length !== null && /^0+$/.test(length))) return publicError('invalid_request');
    if (length !== null && (!/^\d+$/.test(length) || BigInt(length) > BigInt(limit))) return publicError(/^\d+$/.test(length) ? 'upload_too_large' : 'invalid_request');
    if ('error' in options.vault) return publicError(options.vault.error);
    try { return context.json(await options.vault.reader.upload(name, request.body, limit, request.signal)); }
    catch (error) { return serviceError(error); }
  });
  for (const operation of ['file', 'content'] as const) {
    app.get(`/api/vault/${operation}`, async context => {
      let id: ReturnType<typeof parseVaultId>;
      let download = false;
      try {
        const url = new URL(context.req.url);
        decodeURIComponent(url.search.replace(/\+/g, ' '));
        const values = url.searchParams.getAll('id');
        const downloads = url.searchParams.getAll('download');
        if (values.length !== 1 || [...url.searchParams.keys()].some(key => key !== 'id' && (operation !== 'content' || key !== 'download')) || downloads.length > 1 || (downloads.length && downloads[0] !== '1')) return publicError('invalid_request');
        download = downloads.length === 1;
        id = parseVaultId(values[0]);
      } catch { return publicError('invalid_request'); }
      if ('error' in options.vault) return publicError(options.vault.error);
      try {
        if (operation === 'file') return context.json(await options.vault.reader.file(id));
        return await options.vault.reader.content(id, context.req.raw.method, context.req.raw.headers.get('range'), download, context.req.raw.signal);
      } catch (error: unknown) { return serviceError(error); }
    });
  }
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
  app.post('/api/vault/note', async context => {
    if (new URL(context.req.url).search) return publicError('invalid_request');
    const input = parseVaultSaveRequest(await jsonInput(context.req.raw, vaultSaveBodyLimit));
    if (!input) return publicError('invalid_request');
    if ('error' in options.vault) return publicError(options.vault.error);
    try { return context.json(await options.vault.reader.save(input.id, input.markdown, input.expectedRevision)); }
    catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      return publicError(isVaultErrorCode(code) ? code : 'note_save_uncertain');
    }
  });
  app.post('/api/vault/actions', async context => {
    if (new URL(context.req.url).search) return publicError('invalid_request');
    const input = parseVaultAction(await jsonInput(context.req.raw, vaultActionBodyLimit));
    if (!input) return publicError('invalid_request');
    if ('error' in options.vault) return publicError(options.vault.error);
    try { return context.json(await options.vault.reader.action(input)); }
    catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
      return publicError(isVaultErrorCode(code) ? code : 'file_action_uncertain');
    }
  });
  app.post(thinkBase, async context => {
    const value = await jsonInput(context.req.raw, 4096);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
        !('conversationId' in value) || typeof value.conversationId !== 'string' || !uuid.test(value.conversationId) ||
        !('clientCommandId' in value) || typeof value.clientCommandId !== 'string' || !uuid.test(value.clientCommandId)) return thinkError('invalid_request');
    const command = { conversationId: value.conversationId, clientCommandId: value.clientCommandId };
    const service = options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { return context.json(await service.create(command), 202); }
    catch (error: unknown) { return thinkServiceError(error); }
  });
  app.post(`${thinkBase}/:id/resume`, async context => {
    const conversationId = context.req.param('id');
    const value = await jsonInput(context.req.raw, 4096);
    if (new URL(context.req.url).search || !uuid.test(conversationId) || !value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== 1 || !('clientCommandId' in value) || typeof value.clientCommandId !== 'string' || !uuid.test(value.clientCommandId)) return thinkError('invalid_request');
    const service = options.conversations ?? options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { return context.json(await service.resume({ conversationId, clientCommandId: value.clientCommandId }), 202); }
    catch (error) { return thinkServiceError(error); }
  });
  app.post(`${thinkBase}/:id/delete`, async context => {
    const conversationId = context.req.param('id');
    const value = await jsonInput(context.req.raw, 4096);
    if (new URL(context.req.url).search || !uuid.test(conversationId) || !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
        !('clientCommandId' in value) || typeof value.clientCommandId !== 'string' || !uuid.test(value.clientCommandId) || !('viewToken' in value)) return thinkError('invalid_request');
    if (!validViewToken(value.viewToken)) return thinkError('lease_unavailable');
    const service = options.conversations ?? options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { return context.json(await service.delete({ conversationId, clientCommandId: value.clientCommandId, viewToken: value.viewToken }), 202); }
    catch (error) { return thinkServiceError(error); }
  });
  app.post(`${thinkBase}/:id/messages`, async context => {
    const conversationId = context.req.param('id');
    const value = await jsonInput(context.req.raw, 6 * 1024 * 1024 + 4096);
    if (!uuid.test(conversationId) || !value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== 2 || !('clientCommandId' in value) || typeof value.clientCommandId !== 'string' || !uuid.test(value.clientCommandId) ||
        !('text' in value) || typeof value.text !== 'string' || !value.text.trim() || Buffer.byteLength(value.text, 'utf8') > 1024 * 1024) return thinkError('invalid_request');
    const service = options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { return context.json(await service.send({ conversationId, clientCommandId: value.clientCommandId, text: value.text }), 202); }
    catch (error: unknown) { return thinkServiceError(error); }
  });
  app.post(`${thinkBase}/:id/runs/:runId/stop`, async context => {
    const { id: conversationId, runId } = context.req.param();
    const value = await jsonInput(context.req.raw, 4096);
    if (!uuid.test(conversationId) || !uuid.test(runId) || !value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== 1 || !('clientCommandId' in value) || typeof value.clientCommandId !== 'string' || !uuid.test(value.clientCommandId)) return thinkError('invalid_request');
    const service = options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { return context.json(await service.stop({ conversationId, runId, clientCommandId: value.clientCommandId }), 202); }
    catch (error: unknown) { return thinkServiceError(error); }
  });
  app.get(`${thinkBase}/:id`, async context => {
    const id = context.req.param('id');
    if (!uuid.test(id)) return thinkError('invalid_request');
    const service = options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try {
      const state = await service.snapshot(id, context.req.query('cursor'));
      return state ? context.json(state) : thinkError('not_found');
    } catch (error: unknown) { return thinkServiceError(error); }
  });
  app.get(`${thinkBase}/:id/events`, async context => {
    const id = context.req.param('id');
    if (!uuid.test(id)) return thinkError('invalid_request');
    const service = options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    let watch: Awaited<ReturnType<ThinkService['watch']>>;
    try { watch = await service.watch(id); } catch (error: unknown) { return thinkServiceError(error); }
    if (!watch) return thinkError('not_found');
    const owned = watch;
    return streamSSE(context, async stream => {
      const signal = context.req.raw.signal;
      const lease = setTimeout(() => owned.close(), watchPolicy.leaseMs);
      lease.unref();
      const stop = () => { owned.close(); stream.abort(); };
      stream.onAbort(() => owned.close());
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      const write = async (event: string, value: unknown) => {
        const data = JSON.stringify(value);
        if (Buffer.byteLength(data) > 60 * 1024) throw new Error('control frame too large');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([stream.writeSSE({ event, data }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('slow subscriber')), 10000); })]);
        } finally { if (timer) clearTimeout(timer); }
      };
      try {
        if (signal.aborted) return;
        await write('snapshot', owned.snapshot);
        let next = owned.next();
        while (!signal.aborted && !stream.aborted) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const item = await Promise.race([next, new Promise<'heartbeat'>(resolve => { timer = setTimeout(() => resolve('heartbeat'), watchPolicy.heartbeatMs); })]);
          if (timer) clearTimeout(timer);
          if (item === 'heartbeat') { await write('heartbeat', {}); continue; }
          if (!item) break;
          await write('revision', item);
          next = owned.next();
        }
      } catch { stream.abort(); }
      finally { clearTimeout(lease); signal.removeEventListener('abort', stop); owned.close(); }
    });
  });
  app.get(`${thinkBase}/:id/commands/:commandId`, async context => {
    const { id, commandId } = context.req.param();
    if (!uuid.test(id) || !uuid.test(commandId)) return thinkError('invalid_request');
    const service = options.think;
    if ((!service || 'error' in service) && !options.conversations) return thinkError(service && 'error' in service ? service.error : 'think_config_missing');
    try {
      const receipt = service && !('error' in service) ? await service.command(id, commandId)
        : await options.conversations?.command(id, commandId);
      return receipt ? context.json(receipt) : thinkError('not_found');
    } catch (error: unknown) { return thinkServiceError(error); }
  });
  app.get(`${thinkBase}/:id/content/:contentId`, async context => {
    const { id, contentId } = context.req.param();
    const input = parseContentRequest(id, contentId, new URL(context.req.url).searchParams);
    if (!input) return thinkError('invalid_request');
    const service = options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { return context.json(await service.contentChunk(input)); }
    catch (error: unknown) { return thinkServiceError(error); }
  });
  app.get(`${thinkBase}/:id/decisions`, async context => {
    const id = context.req.param('id');
    if (!uuid.test(id)) return thinkError('invalid_request');
    const service = options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { return context.json({ decisions: await service.decisions(id) }); }
    catch (error: unknown) { return thinkServiceError(error); }
  });
  app.get(`${thinkBase}/:id/decisions/:decisionId`, async context => {
    const { id, decisionId } = context.req.param();
    if (!uuid.test(id) || !/^[A-Za-z0-9_-]{1,128}$/.test(decisionId)) return thinkError('invalid_request');
    const service = options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try { const decision = await service.decision(id, decisionId); return decision ? context.json(decision) : thinkError('not_found'); }
    catch (error: unknown) { return thinkServiceError(error); }
  });
  app.post(`${thinkBase}/:id/decisions/:decisionId/reply`, async context => {
    const { id, decisionId } = context.req.param();
    const value = await jsonInput(context.req.raw, 256 * 1024);
    if (!uuid.test(id) || !/^[A-Za-z0-9_-]{1,128}$/.test(decisionId) || !value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== 2 || !('clientCommandId' in value) || typeof value.clientCommandId !== 'string' || !uuid.test(value.clientCommandId) ||
        !('answer' in value) || !value.answer || typeof value.answer !== 'object' || Array.isArray(value.answer) ||
        Object.values(value.answer).some(item => !(typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || Array.isArray(item) && item.every(entry => typeof entry === 'string')))) return thinkError('invalid_request');
    const service = options.think;
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    const answer: Record<string, string | number | boolean | string[]> = Object.fromEntries(Object.entries(value.answer));
    try { return context.json(await service.reply({ conversationId: id, decisionId, clientCommandId: value.clientCommandId, answer }), 202); }
    catch (error: unknown) { return thinkServiceError(error); }
  });
  app.notFound(() => Response.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 }));
  return async request => app.fetch(request);
}
