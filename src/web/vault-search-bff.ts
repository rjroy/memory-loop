import { isVaultId, parseVaultSearchRequest, parseVaultSearchContextRequest, vaultSearchBodyLimit, vaultErrors, type VaultId } from '../../backend/contract';
import type { BffDependencies } from './vault-bff';
import { allowsWebRequest } from './request-policy';

const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const errors = {
  invalid_request: [vaultErrors.invalid_request.status, vaultErrors.invalid_request.message],
  forbidden: [403, 'Request is not permitted'],
  method_not_allowed: [405, 'Method is not allowed'],
  search_unavailable: [vaultErrors.search_unavailable.status, vaultErrors.search_unavailable.message],
  search_context_changed: [vaultErrors.search_context_changed.status, vaultErrors.search_context_changed.message],
} as const;
function failure(code: keyof typeof errors): Response {
  const [status, message] = errors[code];
  return Response.json({ error: { code, message } }, { status, headers });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}
function positions(value: unknown, text: string): number[] {
  if (!Array.isArray(value) || !value.every((n, i) => integer(n) && n < text.length && (i === 0 || n > value[i - 1]))) throw new Error('Invalid positions');
  return value;
}
function identity(value: Record<string, unknown>) {
  if (!isVaultId(value.id) || value.id.length > 64 || typeof value.name !== 'string' || value.name !== value.id[value.id.length - 1] || typeof value.path !== 'string' || value.path !== value.id.join('/')) throw new Error('Invalid identity');
  return { id: [...value.id], name: value.name, path: value.path };
}
function version(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128; }
function projectSearch(value: unknown, mode: 'filename' | 'content') {
  if (!record(value) || value.mode !== mode || !Array.isArray(value.hits) || value.hits.length > (mode === 'filename' ? 50 : 100) || !record(value.counts) || !integer(value.counts.matches) || !integer(value.counts.files) || typeof value.limited !== 'boolean' || !record(value.coverage)) throw new Error('Invalid search');
  const c = value.coverage;
  if (typeof c.complete !== 'boolean' || !integer(c.filesSearched) || !integer(c.skippedLines) || typeof c.timedOut !== 'boolean' || !record(c.skippedFiles)) throw new Error('Invalid coverage');
  const s = c.skippedFiles;
  if (!integer(s.binary) || !integer(s.invalidEncoding) || !integer(s.unreadable) || !integer(s.changed)) throw new Error('Invalid coverage');
  const hits = value.hits.map(hit => {
    if (!record(hit) || typeof hit.score !== 'number' || !Number.isFinite(hit.score)) throw new Error('Invalid hit');
    const base = identity(hit);
    if (mode === 'filename') {
      if (hit.field !== 'name' && hit.field !== 'path') throw new Error('Invalid field');
      return { ...base, field: hit.field, positions: positions(hit.positions, base[hit.field]), score: hit.score };
    }
    if (!integer(hit.line, 1) || !version(hit.version) || !Array.isArray(hit.snippets) || hit.snippets.length > 128) throw new Error('Invalid hit');
    const snippets = hit.snippets.map(snippet => {
      if (!record(snippet) || typeof snippet.text !== 'string' || !integer(snippet.start) || !integer(snippet.end, snippet.start) || snippet.end - snippet.start !== snippet.text.length) throw new Error('Invalid snippet');
      return { text: snippet.text, start: snippet.start, end: snippet.end, positions: positions(snippet.positions, snippet.text) };
    });
    return { ...base, line: hit.line, version: hit.version, score: hit.score, snippets };
  });
  return { mode, hits, counts: { matches: value.counts.matches, files: value.counts.files }, limited: value.limited, coverage: { complete: c.complete, filesSearched: c.filesSearched, skippedFiles: { binary: s.binary, invalidEncoding: s.invalidEncoding, unreadable: s.unreadable, changed: s.changed }, skippedLines: c.skippedLines, timedOut: c.timedOut } };
}
function projectContext(value: unknown, input: { id: VaultId; version: string; line: number }) {
  if (!record(value) || !isVaultId(value.id) || value.id.join('/') !== input.id.join('/') || typeof value.name !== 'string' || value.name !== input.id[input.id.length - 1] || value.version !== input.version || value.targetLine !== input.line || !integer(value.startLine, 1) || !Array.isArray(value.lines) || typeof value.truncated !== 'boolean') throw new Error('Invalid context');
  const start = value.startLine;
  const lines = value.lines.map((line, i) => {
    if (!record(line) || line.number !== start + i || typeof line.text !== 'string') throw new Error('Invalid line');
    const found = positions(line.positions, line.text);
    if (line.number !== input.line && found.length) throw new Error('Invalid line positions');
    return { number: line.number, text: line.text, positions: found };
  });
  if (!lines.some(line => line.number === input.line)) throw new Error('Missing target');
  return { id: [...value.id], name: value.name, version: input.version, targetLine: input.line, startLine: start, lines, truncated: value.truncated };
}
async function readBytes(body: ReadableStream<Uint8Array> | null, limit: number, signal?: AbortSignal): Promise<unknown> {
  if (!body) throw new Error('Missing body');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new Error('Aborted');
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) throw new Error('Body too large');
      chunks.push(item.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
  } catch (error) { void reader.cancel(error).catch(() => {}); throw error; }
  finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}
function validOrigin(origin: string): boolean {
  try { const url = new URL(origin); return url.origin === origin && url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password; } catch { return false; }
}

export async function handleSearchRequest(request: Request, dependencies: BffDependencies): Promise<Response> {
  const context = new URL(request.url).pathname.endsWith('/context');
  const operation = context ? 'search_context' : 'search';
  const requestId = crypto.randomUUID();
  dependencies.log('vault_bff_attempt', { requestId, operation });
  let result: Response;
  try {
    if (!allowsWebRequest(request)) result = failure('forbidden');
    else if (request.method !== 'POST') result = failure('method_not_allowed');
    else if (new URL(request.url).search || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) result = failure('invalid_request');
    else {
      let input: unknown;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const inputController = new AbortController();
      try {
        input = await Promise.race([readBytes(request.body, vaultSearchBodyLimit, inputController.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { inputController.abort(); reject(new Error('timeout')); }, 5000); })]);
      } catch { input = undefined; }
      finally { if (timer !== undefined) clearTimeout(timer); }
      const validInput = context ? parseVaultSearchContextRequest(input) : parseVaultSearchRequest(input);
      if (!validInput) result = failure('invalid_request');
      else if (!validOrigin(dependencies.transport.config.daemonOrigin) || !/^[a-f0-9]{64}$/.test(dependencies.transport.serviceToken)) result = failure('search_unavailable');
      else {
        const controller = new AbortController();
        let accepting = true;
        let upstream: Response | undefined;
        let done = false;
        let rejectAbort: (error: Error) => void = () => {};
        const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
        const abort = () => { controller.abort(); rejectAbort(new Error('Aborted')); };
        request.signal.addEventListener('abort', abort, { once: true });
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 35_000); });
        try {
          if (request.signal.aborted) throw new Error('Aborted');
          const pending = dependencies.fetch(new URL(context ? '/api/vault/search/context' : '/api/vault/search', dependencies.transport.config.daemonOrigin), { method: 'POST', body: JSON.stringify(validInput), headers: { accept: 'application/json', authorization: `Bearer ${dependencies.transport.serviceToken}`, 'content-type': 'application/json' }, cache: 'no-store', redirect: 'error', signal: controller.signal });
          void pending.then(response => { if (!accepting && response.body && !response.body.locked) void response.body.cancel().catch(() => {}); }, () => {});
          const work = async () => {
            upstream = await pending;
            if (!/^application\/json(?:\s*;|\s*$)/i.test(upstream.headers.get('content-type') ?? '')) throw new Error('Invalid content type');
            const value = await readBytes(upstream.body, 4 * 1024 * 1024, controller.signal);
            if (upstream.status !== 200) {
              if (record(value) && record(value.error) && typeof value.error.message === 'string') {
                if (upstream.status === 400 && value.error.code === 'invalid_request') { done = true; return failure('invalid_request'); }
                if (upstream.status === 409 && value.error.code === 'search_context_changed' && context) { done = true; return failure('search_context_changed'); }
                if (upstream.status === 503 && value.error.code === 'search_unavailable') { done = true; return failure('search_unavailable'); }
              }
              return failure('search_unavailable');
            }
            if ('id' in validInput) { const projected = projectContext(value, validInput); done = true; return Response.json(projected, { headers }); }
            if ('mode' in validInput) { const projected = projectSearch(value, validInput.mode); done = true; return Response.json(projected, { headers }); }
            throw new Error('Invalid request');
          };
          result = await Promise.race([work(), timeout, aborted]);
        } catch { result = failure('search_unavailable'); }
        finally {
          accepting = false;
          if (!done) { controller.abort(); if (upstream?.body && !upstream.body.locked) void upstream.body.cancel().catch(() => {}); }
          if (timer !== undefined) clearTimeout(timer);
          request.signal.removeEventListener('abort', abort);
        }
      }
    }
  } catch { result = failure('search_unavailable'); }
  dependencies.log('vault_bff_outcome', { requestId, operation, status: result.status });
  return result;
}
