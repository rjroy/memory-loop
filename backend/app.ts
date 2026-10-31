import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { VaultErrorCode } from './contract';
import type { ThinkService, ThinkUnavailableCode } from './think/service';
import { ThinkServiceError } from './think/service';
import { parseContentRequest } from './think/content-transfer';
import { parseVaultId, type VaultReader } from './vault';
import { captureBodyLimit, captureErrors, parseCaptureRequest } from './capture-contract';
import { CaptureError, type CaptureWriter } from './capture';

export type VaultState = { reader: VaultReader } |
  { error: Extract<VaultErrorCode, 'config_missing' | 'config_invalid' | 'vault_unavailable'> };

export interface AppOptions {
  authority: string;
  /** Transitional caller compatibility only; never used as an authorization bypass. */
  allowedOrigins?: readonly string[];
  serviceToken?: string;
  vault: VaultState;
  capture?: CaptureWriter;
  think?: ThinkService | { error: ThinkUnavailableCode };
  watchPolicy?: { leaseMs: number; heartbeatMs: number };
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

const thinkErrors = {
  invalid_request: { status: 400, message: 'Invalid Think request' },
  command_conflict: { status: 409, message: 'Command conflicts with a previous request' },
  not_found: { status: 404, message: 'Think resource not found' },
  think_unavailable: { status: 503, message: 'Think service is unavailable' },
  think_config_missing: { status: 503, message: 'Think setup is required' },
  think_config_invalid: { status: 503, message: 'Think configuration is invalid' },
  decision_unavailable: { status: 503, message: 'Decision details are unavailable' },
  content_unavailable: { status: 404, message: 'Content is unavailable' },
} as const;

function thinkError(code: keyof typeof thinkErrors): Response {
  const { status, message } = thinkErrors[code];
  return Response.json({ error: { code, message } }, { status });
}

function thinkServiceError(error: unknown): Response {
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
  const watchPolicy = options.watchPolicy ?? { leaseMs: 300000, heartbeatMs: 15000 };
  if (!Number.isSafeInteger(watchPolicy.leaseMs) || watchPolicy.leaseMs < 1 || !Number.isSafeInteger(watchPolicy.heartbeatMs) || watchPolicy.heartbeatMs < 1) throw new Error('Invalid watch policy');
  if (!options.serviceToken || !/^[a-f0-9]{64}$/.test(options.serviceToken)) throw new Error('Service credential unavailable');
  const expected = Buffer.from(options.serviceToken, 'hex');
  const app = new Hono();
  app.use('*', async (context, next) => {
    const requestId = randomUUID();
    const path = context.req.path;
    const operation = path === '/api/vault/tree' ? 'tree' : path === '/api/vault/note' ? 'note' : path === '/api/capture' ? 'capture' : path === thinkBase || path.startsWith(`${thinkBase}/`) ? 'think' : 'other';
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
        } else if (context.req.method !== 'GET' && !(context.req.method === 'POST' && (path === '/api/capture' || path === thinkBase ||
          /^\/api\/think\/conversations\/[^/]+\/(?:messages|runs\/[^/]+\/stop|decisions\/[^/]+\/reply)$/.test(path)))) {
          context.res = Response.json({ error: { code: 'method_not_allowed', message: 'Method is not allowed' } }, { status: 405 });
        } else await next();
      }
    } catch {
      context.res = operation === 'think' ? thinkError('think_unavailable') : publicError('vault_unavailable');
    }
    context.header('Cache-Control', 'no-store');
    context.header('X-Content-Type-Options', 'nosniff');
    console.info('vault_api_outcome', { requestId, operation, status: context.res.status });
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
    if (!service) return thinkError('think_config_missing');
    if ('error' in service) return thinkError(service.error);
    try {
      const receipt = await service.command(id, commandId);
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
