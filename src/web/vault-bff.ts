import type { LoadedTransport } from '../../backend/transport';
import { safeError } from '../server/logger';
import { hardUploadMaxBytes, isUploadName, isVaultComponent, isVaultDirectoryId, isVaultErrorCode, isVaultId, parseVaultSaveRequest, parseVaultAction, vaultActionBodyLimit, vaultErrors, vaultSaveBodyLimit, type VaultEntry, type VaultDirectoryEntry, type VaultDirectoryResponse, type VaultId, type VaultErrorCode } from '../../backend/contract';
import { allowsWebRequest } from './request-policy';
import { handleSearchRequest } from './vault-search-bff';

export interface BffDependencies {
  transport: LoadedTransport;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  log: (event: string, details: Record<string, unknown>) => void;
}

const errors: Record<VaultErrorCode | 'service_unavailable' | 'forbidden' | 'not_found' | 'method_not_allowed', { status: number; message: string }> = {
  ...vaultErrors,
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
function entry(value: unknown): VaultEntry {
  if (!record(value) || typeof value.name !== 'string' || !isVaultId(value.id) || typeof value.identity !== 'string' || !value.identity || typeof value.version !== 'string' || !value.version) throw new Error('invalid');
  const id = [...value.id];
  if (value.kind === 'note' || value.kind === 'file') return { kind: value.kind, name: value.name, id, identity: value.identity, version: value.version };
  if (value.kind === 'directory' && Array.isArray(value.children)) return { kind: 'directory', name: value.name, id, identity: value.identity, version: value.version, children: value.children.map(entry) };
  throw new Error('invalid');
}
function directoryProjection(value: unknown, id: VaultId): VaultDirectoryResponse {
  const opaque = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 512;
  if (!record(value) || !opaque(value.rootIdentity) || !opaque(value.directoryIdentity) || !isVaultDirectoryId(value.id) || JSON.stringify(value.id) !== JSON.stringify(id) || !Array.isArray(value.entries)) throw new Error('invalid');
  const entries: VaultDirectoryEntry[] = value.entries.map((item: unknown) => {
    if (!record(item) || !isVaultComponent(item.name) || !isVaultId(item.id) || JSON.stringify(item.id) !== JSON.stringify([...id, item.name]) || !opaque(item.identity) || !opaque(item.version) || !['directory', 'file', 'note'].includes(String(item.kind)) || item.kind === 'note' && !item.name.endsWith('.md')) throw new Error('invalid');
    const metadata = { name: item.name, id: item.id, identity: item.identity, version: item.version };
    if (item.kind === 'directory') return { kind: 'directory', ...metadata };
    if (item.kind === 'file' || item.kind === 'note') return { kind: item.kind, ...metadata };
    throw new Error('invalid');
  });
  return { rootIdentity: value.rootIdentity, directoryIdentity: value.directoryIdentity, id: value.id, entries };
}

/** Shared deadline for establishment and successive periods without upstream bytes. */
function contentDeadline(controller: AbortController) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expire: (error: Error) => void = () => {};
  const elapsed = new Promise<never>((_resolve, reject) => { expire = reject; });
  // The stream may be idle before its consumer requests the next chunk.
  void elapsed.catch(() => {});
  return {
    arm(ms: number) {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => { controller.abort(); expire(new Error('Content transfer timeout')); }, ms);
    },
    wait<T>(promise: Promise<T>): Promise<T> { return Promise.race([promise, elapsed]); },
    close() { if (timer !== undefined) clearTimeout(timer); timer = undefined; },
  };
}

async function attachmentRequest(request: Request, dependencies: BffDependencies): Promise<Response> {
  const { transport, log } = dependencies;
  const requestId = crypto.randomUUID();
  const operation = 'attachments';
  log('vault_bff_attempt', { requestId, operation });
  let result: Response;
  let diagnostic: ReturnType<typeof safeError> | undefined;
  let complete = false;
  let tooLarge = false;
  let empty = false;
  let dispatched = false;
  const controller = new AbortController();
  const deadline = contentDeadline(controller);
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  let source: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let accepting = true;
  const fetchOwned = (target: URL, init: RequestInit) => {
    const pending = dependencies.fetch(target, init);
    void pending.then(response => { if (!accepting && response.body && !response.body.locked) void response.body.cancel().catch(() => {}); }, () => {});
    return pending;
  };
  try {
    if (request.signal.aborted) throw new Error('Request aborted');
    const url = new URL(request.url);
    if (!allowsWebRequest(request)) result = failure('forbidden');
    else if (request.method !== 'GET' && request.method !== 'POST') result = failure('method_not_allowed');
    else {
      let name: string | undefined;
      let valid = true;
      try {
        decodeURIComponent(url.search.replace(/\+/g, ' '));
        const names = url.searchParams.getAll('name');
        if (request.method === 'GET') valid = !url.search;
        else {
          valid = names.length === 1 && [...url.searchParams.keys()].every(key => key === 'name') && isUploadName(names[0]);
          if (valid) name = names[0];
        }
      } catch { valid = false; }
      const length = request.headers.get('content-length');
      if (request.method === 'POST' && (request.headers.get('content-type')?.toLowerCase() !== 'application/octet-stream' || !request.body || (length !== null && /^0+$/.test(length)))) valid = false;
      if (length !== null && !/^\d+$/.test(length)) valid = false;
      if (!valid) result = failure('invalid_request');
      else if (!validDaemonOrigin(transport.config.daemonOrigin) || !/^[a-f0-9]{64}$/.test(transport.serviceToken)) result = failure('service_unavailable');
      else {
        const target = new URL('/api/vault/attachments', transport.config.daemonOrigin);
        deadline.arm(15_000);
        const initial = await deadline.wait(fetchOwned(target, { method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${transport.serviceToken}` }, cache: 'no-store', redirect: 'error', signal: controller.signal }));
        const value: unknown = await deadline.wait(initial.json());
        if (initial.status !== 200) result = failure(domainError(value, initial.status) ?? 'upload_unavailable');
        else if (!record(value) || typeof value.maxFileBytes !== 'number' || !Number.isSafeInteger(value.maxFileBytes) || value.maxFileBytes < 1 || value.maxFileBytes > hardUploadMaxBytes) result = failure('upload_unavailable');
        else if (request.method === 'GET') result = Response.json({ maxFileBytes: value.maxFileBytes }, { headers });
        else if (length !== null && BigInt(length) > BigInt(value.maxFileBytes)) result = failure('upload_too_large');
        else {
          if (!request.body || !name) throw new Error('Invalid upload');
          const limit = value.maxFileBytes;
          source = request.body.getReader();
          const reader = source;
          let size = 0;
          deadline.arm(60_000);
          const body = new ReadableStream<Uint8Array>({
            async pull(output) {
              try {
                const item = await deadline.wait(reader.read());
                if (item.done) {
                  if (size === 0) { empty = true; controller.abort(); output.error(new Error('Empty upload')); return; }
                  complete = true; output.close(); return;
                }
                size += item.value.byteLength;
                if (size > limit) { tooLarge = true; controller.abort(); void reader.cancel().catch(() => {}); output.error(new Error('Upload too large')); return; }
                if (item.value.byteLength) deadline.arm(60_000);
                output.enqueue(item.value);
              } catch (error) { output.error(error); }
            },
            cancel(reason) { return reader.cancel(reason); },
          }, { highWaterMark: 0 });
          target.searchParams.set('name', name);
          dispatched = true;
          const init: RequestInit & { duplex: 'half' } = { method: 'POST', body, duplex: 'half', headers: { accept: 'application/json', authorization: `Bearer ${transport.serviceToken}`, 'content-type': 'application/octet-stream' }, cache: 'no-store', redirect: 'error', signal: controller.signal };
          const upstream = await deadline.wait(fetchOwned(target, init));
          deadline.arm(60_000);
          const response: unknown = await deadline.wait(upstream.json());
          if (empty) result = failure('invalid_request');
          else if (tooLarge) result = failure('upload_too_large');
          else if (upstream.status !== 200) result = failure(domainError(response, upstream.status) ?? (complete ? 'upload_uncertain' : 'upload_unavailable'));
          else if (!complete || !record(response) || !isVaultId(response.id) || response.id.length !== 2 || response.id[0] !== '06_Attachments' || typeof response.name !== 'string' || response.id[1] !== response.name || !isUploadName(response.name) || typeof response.size !== 'number' || response.size !== size) result = failure(complete ? 'upload_uncertain' : 'upload_unavailable');
          else result = Response.json({ id: response.id, name: response.name, size: response.size }, { headers });
        }
      }
    }
  } catch (error) { diagnostic = safeError(error, 'upload_upstream_failure'); controller.abort(); result = failure(empty ? 'invalid_request' : tooLarge ? 'upload_too_large' : dispatched && complete ? 'upload_uncertain' : 'upload_unavailable'); }
  finally {
    accepting = false;
    deadline.close();
    request.signal.removeEventListener('abort', abort);
    if (source) {
      if (!complete) { controller.abort(); void source.cancel().catch(() => {}); }
      source.releaseLock();
    }
  }
  log('vault_bff_outcome', { requestId, operation, status: result.status, ...(result.status >= 500 ? diagnostic ?? { category: 'upload_upstream_response_failure' } : {}) });
  return result;
}

async function fileRequest(request: Request, dependencies: BffDependencies, operation: 'file' | 'content'): Promise<Response> {
  const { transport, log } = dependencies;
  const requestId = crypto.randomUUID();
  log('vault_bff_attempt', { requestId, operation });
  let response: Response;
  let diagnostic: ReturnType<typeof safeError> | undefined;
  try {
    const url = new URL(request.url);
    const content = operation === 'content';
    if (!allowsWebRequest(request)) response = failure('forbidden');
    else if (request.method !== 'GET' && !(content && request.method === 'HEAD')) response = failure('method_not_allowed');
    else {
      let id: VaultId | undefined;
      let valid = true;
      try {
        decodeURIComponent(url.search.replace(/\+/g, ' '));
        const values = url.searchParams.getAll('id');
        const parsed: unknown = values.length === 1 ? JSON.parse(values[0]) : undefined;
        if (isVaultId(parsed)) id = parsed;
        const downloads = url.searchParams.getAll('download');
        valid = ![...url.searchParams.keys()].some(key => key !== 'id' && (!content || key !== 'download')) && downloads.length <= 1 && (downloads.length === 0 || downloads[0] === '1');
      } catch { valid = false; }
      const range = content && request.method === 'GET' ? request.headers.get('range') : null;
      if (range !== null && (!/^bytes=(?:\d+-\d*|-\d+)$/.test(range) || range.length > 256)) valid = false;
      if (!valid || !id) response = failure('invalid_request');
      else if (!validDaemonOrigin(transport.config.daemonOrigin) || !/^[a-f0-9]{64}$/.test(transport.serviceToken)) response = failure('service_unavailable');
      else {
        const target = new URL(`/api/vault/${operation}`, transport.config.daemonOrigin);
        target.searchParams.set('id', JSON.stringify(id));
        if (url.searchParams.has('download')) target.searchParams.set('download', '1');
        const controller = new AbortController();
        const deadline = content ? contentDeadline(controller) : undefined;
        const abort = () => { deadline?.close(); controller.abort(); };
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) { request.signal.removeEventListener('abort', abort); throw new Error('Request aborted'); }
        let streaming = false;
        let upstream: Response | undefined;
        let upstreamDone = false;
        let streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let accepting = true;
        const timer = content ? undefined : setTimeout(() => controller.abort(), 5000);
        deadline?.arm(15_000);
        try {
          const fetch = dependencies.fetch(target, {
            method: request.method, headers: { accept: content ? '*/*' : 'application/json', authorization: `Bearer ${transport.serviceToken}`, ...(range ? { range } : {}) },
            redirect: 'error', cache: 'no-store', signal: controller.signal,
          });
          void fetch.then(late => {
            if (!accepting && late.body && !late.body.locked) void late.body.cancel().catch(() => {});
          }, () => {});
          upstream = await (deadline ? deadline.wait(fetch) : fetch);
          upstreamDone = upstream.body === null;
          deadline?.arm(60_000);
          if (content && (upstream.status === 200 || request.method === 'GET' && (upstream.status === 206 || upstream.status === 416))) {
            const forwarded = new Headers(headers);
            for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition']) {
              const value = upstream.headers.get(name);
              if (value !== null) forwarded.set(name, value);
            }
            forwarded.set('content-security-policy', 'sandbox');
            if (request.method === 'HEAD' || !upstream.body) {
              response = new Response(null, { status: upstream.status, headers: forwarded });
            } else {
              const reader = upstream.body.getReader();
              streamReader = reader;
              const cleanup = () => { deadline?.close(); request.signal.removeEventListener('abort', abort); };
              const stream = new ReadableStream<Uint8Array>({
                async pull(output) {
                  try {
                    const next = reader.read();
                    const result = await (deadline ? deadline.wait(next) : next);
                    if (result.done) { cleanup(); reader.releaseLock(); output.close(); }
                    else { if (result.value.byteLength) deadline?.arm(60_000); output.enqueue(result.value); }
                  } catch (error) { if (!request.signal.aborted) log('vault_bff_stream_outcome', { requestId, operation, status: 503, ...safeError(error, 'content_stream_failure') }); cleanup(); void reader.cancel(error).catch(() => {}).finally(() => reader.releaseLock()); output.error(error); }
                },
                async cancel(reason) {
                  cleanup();
                  const cancelled = reader.cancel(reason);
                  controller.abort();
                  try { await cancelled; } finally { reader.releaseLock(); }
                },
              }, { highWaterMark: 0 });
              response = new Response(stream, { status: upstream.status, headers: forwarded });
              streaming = true;
            }
          } else if (content && request.method === 'HEAD') {
            const status = upstream.status === 404 ? 404 : upstream.status === 400 ? 400 : 503;
            response = new Response(null, { status, headers });
          } else {
            if (!/^application\/json(?:\s*;|\s*$)/i.test(upstream.headers.get('content-type') ?? '')) throw new Error('invalid');
            if (!upstream.body) throw new Error('invalid');
            const reader = upstream.body.getReader();
            const chunks: Uint8Array[] = [];
            let total = 0;
            try {
              for (;;) {
                const read = reader.read();
                const item = await (deadline ? deadline.wait(read) : read);
                if (item.done) { upstreamDone = true; break; }
                if (item.value.byteLength) deadline?.arm(60_000);
                total += item.value.byteLength;
                if (total > 2 * 1024 * 1024 * 6 + 65536) throw new Error('invalid');
                chunks.push(item.value);
              }
            } catch (error) { void reader.cancel(error).catch(() => {}); throw error; }
            finally { reader.releaseLock(); }
            const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
            if (upstream.status !== 200) response = failure(domainError(value, upstream.status) ?? 'service_unavailable');
            else if (!content && record(value) && typeof value.name === 'string') {
              if (value.kind === 'text' && typeof value.text === 'string' && Buffer.byteLength(value.text, 'utf8') <= 2 * 1024 * 1024) response = Response.json({ name: value.name, kind: value.kind, text: value.text }, { headers });
              else if ((value.kind === 'image' || value.kind === 'video') && typeof value.contentType === 'string') response = Response.json({ name: value.name, kind: value.kind, contentType: value.contentType }, { headers });
              else if (value.kind === 'unsupported') response = Response.json({ name: value.name, kind: value.kind }, { headers });
              else throw new Error('invalid');
            } else throw new Error('invalid');
          }
        } finally {
          accepting = false;
          if (!streaming) {
            if (!upstreamDone) {
              if (streamReader) void streamReader.cancel().catch(() => {}).finally(() => streamReader?.releaseLock());
              if (upstream?.body && !upstream.body.locked) void upstream.body.cancel().catch(() => {});
              controller.abort();
            }
            deadline?.close();
            request.signal.removeEventListener('abort', abort);
          }
          if (timer !== undefined) clearTimeout(timer);
        }
      }
    }
  } catch (error) { diagnostic = safeError(error, 'file_upstream_failure'); response = failure('service_unavailable'); }
  log('vault_bff_outcome', { requestId, operation, status: response.status, ...(response.status >= 500 ? diagnostic ?? { category: 'file_upstream_response_failure' } : {}) });
  return response;
}
function project(value: unknown, operation: 'tree' | 'note') {
  if (!record(value)) throw new Error('invalid');
  if (operation === 'tree' && typeof value.rootIdentity === 'string' && value.rootIdentity && Array.isArray(value.entries)) return { rootIdentity: value.rootIdentity, entries: value.entries.map(entry) };
  if (operation === 'note' && typeof value.name === 'string' && typeof value.markdown === 'string' && typeof value.revision === 'string' && value.revision.length > 0 && typeof value.editable === 'boolean') return { name: value.name, markdown: value.markdown, revision: value.revision, editable: value.editable };
  throw new Error('invalid');
}

async function saveBody(request: Request, action: boolean): Promise<string> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') || !request.body) throw new Error('invalid');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > (action ? vaultActionBodyLimit : vaultSaveBodyLimit)) { void reader.cancel().catch(() => {}); throw new Error('invalid'); }
        chunks.push(value);
      }
      const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      const input = action ? parseVaultAction(raw) : parseVaultSaveRequest(raw);
      if (!input) throw new Error('invalid');
      return JSON.stringify(input);
    };
    return await Promise.race([read(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error('timeout')); }, 5000);
    })]);
  } finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
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
  if (isVaultErrorCode(code)) {
    if (errors[code].status === status) return code;
  }
}

export async function handleVaultRequest(request: Request, dependencies: BffDependencies): Promise<Response> {
  const { transport, log } = dependencies;
  const url = new URL(request.url);
  if (url.pathname === '/api/vault/search' || url.pathname === '/api/vault/search/context') return handleSearchRequest(request, dependencies);
  if (url.pathname === '/api/vault/attachments') return attachmentRequest(request, dependencies);
  if (url.pathname === '/api/vault/file') return fileRequest(request, dependencies, 'file');
  if (url.pathname === '/api/vault/content') return fileRequest(request, dependencies, 'content');
  const operation = url.pathname === '/api/vault/tree' ? 'tree' : url.pathname === '/api/vault/directory' ? 'directory' : url.pathname === '/api/vault/note' ? 'note' : url.pathname === '/api/vault/actions' ? 'actions' : 'other';
  const requestId = crypto.randomUUID();
  log('vault_bff_attempt', { requestId, operation });
  let response: Response;
  let dispatched = false;
  let diagnostic: ReturnType<typeof safeError> | undefined;
  const saving = operation === 'note' && request.method === 'POST';
  const acting = operation === 'actions' && request.method === 'POST';
  const mutating = saving || acting;
  try {
    if (!allowsWebRequest(request)) response = failure('forbidden');
    else if (operation === 'other') response = failure('not_found');
    else if (operation === 'actions' ? !acting : request.method !== 'GET' && !saving) response = failure('method_not_allowed');
    else {
      let id: VaultId | undefined;
      let body: string | undefined;
      if (mutating) {
        try { if (url.search) throw new Error('invalid'); body = await saveBody(request, acting); }
        catch { response = failure('invalid_request'); log('vault_bff_outcome', { requestId, operation, status: response.status }); return response; }
      }
      if (operation === 'note' && !saving) {
        try {
          decodeURIComponent(url.search.replace(/\+/g, ' '));
          const values = url.searchParams.getAll('id');
          const parsed: unknown = values.length === 1 ? JSON.parse(values[0]) : undefined;
          if (isVaultId(parsed)) id = parsed;
        } catch { /* A malformed identifier is a client error. */ }
      }
      if (operation === 'directory') {
        try {
          decodeURIComponent(url.search.replace(/\+/g, ' '));
          const values = url.searchParams.getAll('id');
          const parsed: unknown = values.length === 1 && [...url.searchParams.keys()].every(key => key === 'id') ? JSON.parse(values[0]) : undefined;
          if (isVaultDirectoryId(parsed)) id = parsed;
        } catch { /* Invalid client query. */ }
      }
      if ((operation === 'note' && !saving || operation === 'directory') && !id) response = failure('invalid_request');
      else if (!validDaemonOrigin(transport.config.daemonOrigin) || !/^[a-f0-9]{64}$/.test(transport.serviceToken)) response = failure('service_unavailable');
      else {
        const target = new URL(`/api/vault/${operation}`, transport.config.daemonOrigin);
        if (id) target.searchParams.set('id', JSON.stringify(id));
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); }, 5000);
          });
          const upstream = async () => {
            dispatched = mutating;
            const result = await dependencies.fetch(target, { ...(mutating ? { method: 'POST', body } : {}), headers: { Accept: 'application/json', Authorization: `Bearer ${transport.serviceToken}`, ...(mutating ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store', redirect: 'error', signal: controller.signal });
            if (!/^application\/json(?:\s*;|\s*$)/i.test(result.headers.get('content-type') ?? '')) throw new Error('invalid');
            const value: unknown = await result.json();
            if (result.status === 200) {
              if (saving) {
                if (!record(value) || typeof value.revision !== 'string' || !value.revision || value.revision.length > 128) throw new Error('invalid');
                return Response.json({ revision: value.revision }, { headers });
              }
              if (acting) {
                if (!record(value) || !isVaultId(value.id)) throw new Error('invalid');
                const sent = parseVaultAction(JSON.parse(body ?? 'null') as unknown);
                if (!sent) throw new Error('invalid');
                const expectedId = sent.action === 'create-note' || sent.action === 'create-directory' ? [...sent.parentId, sent.name]
                  : sent.action === 'move' ? [...sent.destinationParentId, sent.id[sent.id.length - 1]] : sent.id;
                if (value.id.length !== expectedId.length || value.id.some((part, i) => part !== expectedId[i])) throw new Error('invalid');
                if (sent.action === 'create-note') {
                  if (typeof value.revision !== 'string' || !value.revision || value.revision.length > 128) throw new Error('invalid');
                  return Response.json({ id: value.id, revision: value.revision }, { headers });
                }
                return Response.json({ id: value.id }, { headers });
              }
              if (operation === 'directory') {
                if (!id) throw new Error('invalid');
                return Response.json(directoryProjection(value, id), { headers });
              }
              return Response.json(project(value, operation === 'tree' ? 'tree' : 'note'), { headers });
            }
            const code = domainError(value, result.status);
            return code ? failure(code) : failure(acting ? 'file_action_uncertain' : saving ? 'note_save_uncertain' : 'service_unavailable');
          };
          response = await Promise.race([upstream(), timeout]);
        } finally { if (timer !== undefined) clearTimeout(timer); }
      }
    }
  } catch (error) { diagnostic = safeError(error, 'upstream_or_protocol_failure'); response = failure(dispatched ? acting ? 'file_action_uncertain' : 'note_save_uncertain' : 'service_unavailable'); }
  log('vault_bff_outcome', { requestId, operation, status: response.status, ...(response.status >= 500 ? diagnostic ?? { category: 'upstream_response_failure' } : {}) });
  return response;
}
