import { isVaultId, isVaultComponent, parseVaultSearchContextRequest } from '../../backend/contract';
import type { VaultSearchContextRequest, VaultSearchContextResponse, VaultSearchRequest, VaultSearchResponse, VaultSearchSnippet } from '../../backend/contract';
import { idKey, noteLocation } from './api';

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function token(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128; }
function positions(value: unknown, text: string): value is number[] {
  return Array.isArray(value) && value.every((offset, i) => count(offset) && offset < text.length && (i === 0 || offset > value[i - 1]));
}
function snippet(value: unknown): value is VaultSearchSnippet {
  return record(value) && typeof value.text === 'string' && count(value.start) && count(value.end) &&
    value.end - value.start === value.text.length && positions(value.positions, value.text);
}
function searchResponse(value: unknown): value is VaultSearchResponse {
  if (!record(value) || !['filename', 'content'].includes(String(value.mode)) || !Array.isArray(value.hits) ||
    !record(value.counts) || !count(value.counts.matches) || !count(value.counts.files) || typeof value.limited !== 'boolean' || !record(value.coverage)) return false;
  const coverage = value.coverage;
  if (typeof coverage.complete !== 'boolean' || typeof coverage.timedOut !== 'boolean' || !count(coverage.filesSearched) ||
    !count(coverage.skippedLines) || !record(coverage.skippedFiles) ||
    !['binary', 'invalidEncoding', 'unreadable', 'changed'].every(key => count(coverage.skippedFiles && record(coverage.skippedFiles) ? coverage.skippedFiles[key] : undefined))) return false;
  if (value.hits.length > (value.mode === 'filename' ? 50 : 100) || value.hits.length > value.counts.matches) return false;
  return value.hits.every(hit => {
    if (!record(hit) || !isVaultId(hit.id) || !isVaultComponent(hit.name) || typeof hit.path !== 'string' ||
      typeof hit.score !== 'number' || !Number.isFinite(hit.score)) return false;
    if (value.mode === 'filename') return (hit.field === 'name' || hit.field === 'path') && positions(hit.positions, hit.field === 'name' ? hit.name : hit.path);
    return count(hit.line) && hit.line > 0 && token(hit.version) && Array.isArray(hit.snippets) && hit.snippets.length > 0 &&
      hit.snippets.every((part, index, all) => snippet(part) && (index === 0 || (snippet(all[index - 1]) && part.start >= all[index - 1].end)));
  });
}
function contextResponse(value: unknown, request: VaultSearchContextRequest): value is VaultSearchContextResponse {
  if (!record(value) || !isVaultId(value.id) || idKey(value.id) !== idKey(request.id) || value.name !== request.id.at(-1) ||
    value.version !== request.version || value.targetLine !== request.line || !count(value.startLine) || value.startLine < 1 ||
    !Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 7 || typeof value.truncated !== 'boolean') return false;
  const start = value.startLine;
  return start >= Math.max(1, request.line - 3) && value.lines.every((line, index) => record(line) && line.number === start + index &&
    typeof line.text === 'string' && positions(line.positions, line.text) && (line.number === request.line || line.positions.length === 0)) &&
    value.lines.some(line => record(line) && line.number === request.line && Array.isArray(line.positions) && line.positions.length > 0) &&
    start + value.lines.length - 1 <= request.line + 3;
}
export class SearchApiError extends Error {
  constructor(readonly code: 'invalid_request' | 'search_context_changed' | 'search_unavailable') { super('Search request failed'); }
}
let sequence = 0;
async function post<T>(operation: 'search' | 'context', body: VaultSearchRequest | VaultSearchContextRequest, signal: AbortSignal, validate: (value: unknown) => value is T): Promise<T> {
  const requestId = ++sequence;
  console.info('recall_search_attempt', { operation, requestId, queryLength: body.query.length });
  let outcome = 'unavailable';
  try {
    const response = await fetch(operation === 'search' ? '/api/vault/search' : '/api/vault/search/context', {
      method: 'POST', cache: 'no-store', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new SearchApiError('search_unavailable');
    const value: unknown = await response.json();
    if (!response.ok) {
      const code = record(value) && record(value.error) ? value.error.code : null;
      if ((response.status === 400 && code === 'invalid_request') || (response.status === 409 && code === 'search_context_changed') ||
        (response.status === 503 && code === 'search_unavailable')) throw new SearchApiError(code);
      throw new SearchApiError('search_unavailable');
    }
    if (!validate(value)) throw new SearchApiError('search_unavailable');
    outcome = 'loaded'; return value;
  } catch (error) {
    if (error instanceof SearchApiError) { outcome = error.code; throw error; }
    throw new SearchApiError('search_unavailable');
  } finally { console.info('recall_search_outcome', { operation, requestId, outcome: signal.aborted ? 'abandoned' : outcome }); }
}
export function searchVault(request: VaultSearchRequest, signal: AbortSignal): Promise<VaultSearchResponse> {
  return post('search', request, signal, (value): value is VaultSearchResponse => searchResponse(value) && value.mode === request.mode);
}
export function readSearchContext(request: VaultSearchContextRequest, signal: AbortSignal): Promise<VaultSearchContextResponse> {
  return post('context', request, signal, (value): value is VaultSearchContextResponse => contextResponse(value, request));
}
export function contentLocation(request: VaultSearchContextRequest): string {
  return `${noteLocation(request.id)}&${new URLSearchParams({ line: String(request.line), version: request.version, query: request.query })}`;
}
export function parseContentLocation(search: string): { request: VaultSearchContextRequest | null; invalid: boolean } {
  const params = new URLSearchParams(search);
  if (!['line', 'version', 'query'].some(key => params.has(key))) return { request: null, invalid: false };
  if (!['file', 'line', 'version', 'query'].every(key => params.getAll(key).length === 1)) return { request: null, invalid: true };
  try {
    const request = parseVaultSearchContextRequest({ id: JSON.parse(params.get('file') ?? ''), line: Number(params.get('line')), version: params.get('version'), query: params.get('query') });
    return request ? { request, invalid: false } : { request: null, invalid: true };
  } catch { return { request: null, invalid: true }; }
}
