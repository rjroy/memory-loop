import { projectConversation, type ThinkSnapshot } from '../web/think-projection';
export type { ThinkManifestEntry, ThinkSnapshot } from '../web/think-projection';
import type { BodyRef } from '../../backend/think/body-store';
import type { CommandReceipt, ConversationState, CreateConversationCommand, FormReplyCommand, SendCommand, StopCommand } from '../../backend/think/contract';
import { isThinkErrorCode } from '../../backend/think/contract';
import type { ContentChunk } from '../../backend/think/content-transfer';

export type ThinkFieldValue = string | number | boolean | string[];
interface ThinkFormFieldBase {
  key: string;
  title?: string; description?: string; required?: boolean; hidden?: boolean;
  minimum?: number; maximum?: number; default?: ThinkFieldValue; format?: string;
  minLength?: number; maxLength?: number; pattern?: string; placeholder?: string;
  custom?: boolean; minItems?: number; maxItems?: number;
  options?: Array<{ value: string; label: string; description?: string }>;
  when?: Array<{ key: string; op: 'eq' | 'neq'; value: string | number | boolean }>;
}
export type ThinkFormField = ThinkFormFieldBase & (
  | { type: 'multiselect'; options: NonNullable<ThinkFormFieldBase['options']> }
  | { type: 'string' | 'number' | 'integer' | 'boolean' }
);
export interface ThinkDecision { conversationId: string; decisionId: string; kind: 'form'; title: string; fields: ThinkFormField[] }

export type ThinkClientErrorKind = 'invalid-input' | 'invalid-response' | 'api' | 'transport' | 'aborted';
export class ThinkClientError extends Error {
  constructor(readonly kind: ThinkClientErrorKind, readonly status?: number, readonly code?: string, readonly delivery?: 'unknown') {
    super('Think request failed');
    this.name = 'ThinkClientError';
  }
}

export interface ThinkWatchHandlers {
  snapshot(value: ThinkSnapshot): void;
  revision(value: ConversationState): void;
  heartbeat(): void;
  error(error: ThinkClientError): void;
}

export interface ThinkWatchSource {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  close(): void;
}

export interface ThinkClientOptions {
  fetch?: typeof globalThis.fetch;
  openWatch?: (url: string) => ThinkWatchSource;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const opaque = /^[A-Za-z0-9_-]{1,128}$/;
const cursorPattern = /^[A-Za-z0-9_-]{1,256}\.[a-f0-9]{64}$/;
const base = '/api/think/conversations';
const boundaryErrors = new Set(['forbidden', 'method_not_allowed', 'service_unavailable']);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: string) => { if (!uuid.test(value)) throw new ThinkClientError('invalid-input'); return value; };
const decision = (value: string) => { if (!opaque.test(value)) throw new ThinkClientError('invalid-input'); return value; };
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const has = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === 'string' && values.some(item => item === value);

function state(value: unknown, conversationId: string, snapshot: false): ConversationState;
function state(value: unknown, conversationId: string, snapshot: true): ThinkSnapshot;
function state(value: unknown, conversationId: string, snapshot: boolean): ConversationState | ThinkSnapshot {
  try {
    return projectConversation(value, conversationId, snapshot);
  } catch { throw new ThinkClientError('invalid-response'); }
}

function isReceipt(value: unknown): value is CommandReceipt {
  if (!object(value) || typeof value.conversationId !== 'string' || !uuid.test(value.conversationId) ||
      typeof value.clientCommandId !== 'string' || !uuid.test(value.clientCommandId) || typeof value.epoch !== 'string' || !uuid.test(value.epoch)) return false;
  if (value.kind === 'create') return has(value.state, ['registered', 'ready', 'upstream-unconfirmed']) ||
    value.state === 'rejected' && object(value.failure) && has(value.failure.code, ['upstream_rejected', 'ownership_mismatch', 'configuration_invalid', 'service_unavailable']);
  if (value.kind === 'send' || value.kind === 'stop') {
    if (typeof value.runId !== 'string' || !uuid.test(value.runId)) return false;
    if (value.kind === 'stop') return has(value.state, ['registered', 'requested', 'upstream-unconfirmed', 'cancelled-before-delivery']);
    return has(value.state, ['registered', 'admitted', 'upstream-unconfirmed', 'monitor-unavailable', 'cancelled-before-delivery', 'completed', 'failed', 'interrupted', 'rejected']) &&
      (value.failure === undefined || object(value.failure) && has(value.failure.code, ['execution_failed', 'resource_failure']));
  }
  return value.kind === 'form-reply' && typeof value.decisionId === 'string' && opaque.test(value.decisionId) &&
    has(value.state, ['registered', 'replied', 'upstream-unconfirmed', 'stale', 'rejected']) &&
    (value.failure === undefined || object(value.failure) && value.failure.code === 'resource_failure');
}

function receipt(value: CommandReceipt): CommandReceipt {
  const base = { conversationId: value.conversationId, clientCommandId: value.clientCommandId, epoch: value.epoch };
  if (value.kind === 'create') return value.state === 'rejected' ? { ...base, kind: value.kind, state: value.state, failure: { code: value.failure.code } } : { ...base, kind: value.kind, state: value.state };
  if (value.kind === 'send') return { ...base, kind: value.kind, runId: value.runId, state: value.state, ...(value.failure ? { failure: { code: value.failure.code } } : {}) };
  if (value.kind === 'stop') return { ...base, kind: value.kind, runId: value.runId, state: value.state };
  return { ...base, kind: value.kind, decisionId: value.decisionId, state: value.state, ...(value.failure ? { failure: { code: value.failure.code } } : {}) };
}

async function readJSON(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new ThinkClientError('invalid-response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); throw new ThinkClientError('invalid-response'); }
      chunks.push(part.value);
    }
    const data = new Uint8Array(size);
    let position = 0;
    for (const chunk of chunks) { data.set(chunk, position); position += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) as unknown;
  } catch (error) {
    if (error instanceof ThinkClientError) throw error;
    throw new ThinkClientError('invalid-response');
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

function projectDecision(value: unknown, conversationId: string, expected?: string): ThinkDecision {
  if (!object(value) || value.conversationId !== conversationId || typeof value.decisionId !== 'string' || !opaque.test(value.decisionId) ||
      (expected !== undefined && value.decisionId !== expected) || value.kind !== 'form' || typeof value.title !== 'string' || !Array.isArray(value.fields)) throw new ThinkClientError('invalid-response');
  const fields: ThinkFormField[] = value.fields.map(field => {
    if (!object(field) || typeof field.key !== 'string' || !has(field.type, ['string', 'number', 'integer', 'boolean', 'multiselect'])) throw new ThinkClientError('invalid-response');
    const result: ThinkFormFieldBase = { key: field.key };
    for (const key of ['title', 'description', 'format', 'pattern', 'placeholder'] as const) {
      if (field[key] !== undefined) { if (typeof field[key] !== 'string') throw new ThinkClientError('invalid-response'); result[key] = field[key]; }
    }
    for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
      if (field[key] !== undefined) { if (typeof field[key] !== 'number' || !Number.isFinite(field[key])) throw new ThinkClientError('invalid-response'); result[key] = field[key]; }
    }
    for (const key of ['required', 'hidden', 'custom'] as const) {
      if (field[key] !== undefined) { if (typeof field[key] !== 'boolean') throw new ThinkClientError('invalid-response'); result[key] = field[key]; }
    }
    if (field.default !== undefined) {
      if (!(typeof field.default === 'string' || typeof field.default === 'boolean' || typeof field.default === 'number' && Number.isFinite(field.default) || Array.isArray(field.default) && field.default.every(item => typeof item === 'string'))) throw new ThinkClientError('invalid-response');
      result.default = field.default;
    }
    if (field.options !== undefined) {
      if (!Array.isArray(field.options)) throw new ThinkClientError('invalid-response');
      result.options = field.options.map(option => {
        if (!object(option) || typeof option.value !== 'string' || typeof option.label !== 'string' || (option.description !== undefined && typeof option.description !== 'string')) throw new ThinkClientError('invalid-response');
        return { value: option.value, label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) };
      });
    }
    if (field.when !== undefined) {
      if (!Array.isArray(field.when)) throw new ThinkClientError('invalid-response');
      result.when = field.when.map(rule => {
        if (!object(rule) || typeof rule.key !== 'string' || (rule.op !== 'eq' && rule.op !== 'neq') || !(typeof rule.value === 'string' || typeof rule.value === 'boolean' || typeof rule.value === 'number' && Number.isFinite(rule.value))) throw new ThinkClientError('invalid-response');
        return { key: rule.key, op: rule.op, value: rule.value };
      });
    }
    if (field.type === 'multiselect') {
      if (!result.options) throw new ThinkClientError('invalid-response');
      return { ...result, type: field.type, options: result.options };
    }
    return { ...result, type: field.type };
  });
  return { conversationId, decisionId: value.decisionId, kind: 'form', title: value.title, fields };
}

export function createThinkClient(options: ThinkClientOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const openWatch = options.openWatch ?? ((url: string) => new EventSource(url));
  async function request(path: string, method: 'GET' | 'POST', body?: object, signal?: AbortSignal, limit = 65536): Promise<unknown> {
    if (signal?.aborted) throw new ThinkClientError('aborted');
    const controller = new AbortController();
    let rejectAbort: ((error: ThinkClientError) => void) | undefined;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = () => { controller.abort(); rejectAbort?.(new ThinkClientError('aborted', undefined, undefined, method === 'POST' ? 'unknown' : undefined)); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => {
        const response = await fetcher(path, { method, signal: controller.signal, credentials: 'same-origin', redirect: 'error',
          headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const value = await readJSON(response, limit, controller.signal);
        if (!response.ok) {
          const code = object(value) && object(value.error) && typeof value.error.code === 'string' && (isThinkErrorCode(value.error.code) || boundaryErrors.has(value.error.code)) ? value.error.code : undefined;
          throw new ThinkClientError('api', response.status, code);
        }
        if (response.status !== (method === 'POST' ? 202 : 200)) throw new ThinkClientError('invalid-response');
        return value;
      })();
      return await Promise.race([operation, aborted, new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ThinkClientError('transport', undefined, undefined, method === 'POST' ? 'unknown' : undefined)); }, 5000); })]);
    } catch (error) {
      if (signal?.aborted) throw new ThinkClientError('aborted', undefined, undefined, method === 'POST' ? 'unknown' : undefined);
      if (error instanceof ThinkClientError) {
        if (method === 'POST' && error.kind === 'invalid-response') throw new ThinkClientError('invalid-response', undefined, undefined, 'unknown');
        throw error;
      }
      throw new ThinkClientError('transport', undefined, undefined, method === 'POST' ? 'unknown' : undefined);
    } finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  const path = (conversationId: string) => `${base}/${identifier(conversationId)}`;
  async function commandResult(url: string, command: { conversationId: string; clientCommandId: string }, body: object, kind: CommandReceipt['kind'], signal?: AbortSignal) {
    const conversationId = identifier(command.conversationId);
    const clientCommandId = identifier(command.clientCommandId);
    const runId = 'runId' in command ? command.runId : undefined;
    const decisionId = 'decisionId' in command ? command.decisionId : undefined;
    const result = await request(url, 'POST', body, signal);
    if (!isReceipt(result) || result.kind !== kind || result.conversationId !== conversationId || result.clientCommandId !== clientCommandId ||
        (kind === 'stop' && result.kind === 'stop' && result.runId !== runId) ||
        (kind === 'form-reply' && result.kind === 'form-reply' && result.decisionId !== decisionId)) throw new ThinkClientError('invalid-response', undefined, undefined, 'unknown');
    return receipt(result);
  }
  return {
    async snapshot(conversationId: string, cursor?: string, signal?: AbortSignal): Promise<ThinkSnapshot> {
      const target = path(conversationId);
      if (cursor !== undefined && !cursorPattern.test(cursor)) throw new ThinkClientError('invalid-input');
      return state(await request(`${target}${cursor === undefined ? '' : `?${new URLSearchParams({ cursor })}`}`, 'GET', undefined, signal), conversationId, true);
    },
    async receipt(conversationId: string, commandId: string, signal?: AbortSignal): Promise<CommandReceipt> {
      const value = await request(`${path(conversationId)}/commands/${identifier(commandId)}`, 'GET', undefined, signal);
      if (!isReceipt(value) || value.conversationId !== conversationId || value.clientCommandId !== commandId) throw new ThinkClientError('invalid-response');
      return receipt(value);
    },
    create(command: CreateConversationCommand, signal?: AbortSignal) { return commandResult(base, command, { conversationId: command.conversationId, clientCommandId: command.clientCommandId }, 'create', signal); },
    send(command: SendCommand, signal?: AbortSignal) {
      if (typeof command.text !== 'string' || !command.text.trim() || new TextEncoder().encode(command.text).length > 1024 * 1024) throw new ThinkClientError('invalid-input');
      return commandResult(`${path(command.conversationId)}/messages`, command, { clientCommandId: command.clientCommandId, text: command.text }, 'send', signal);
    },
    stop(command: StopCommand, signal?: AbortSignal) { return commandResult(`${path(command.conversationId)}/runs/${identifier(command.runId)}/stop`, command, { clientCommandId: command.clientCommandId }, 'stop', signal); },
    reply(command: FormReplyCommand, signal?: AbortSignal) {
      if (!object(command.answer) || Object.values(command.answer).some(item => !(typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || Array.isArray(item) && item.every(value => typeof value === 'string'))) ||
          new TextEncoder().encode(JSON.stringify({ clientCommandId: command.clientCommandId, answer: command.answer })).length > 256 * 1024) throw new ThinkClientError('invalid-input');
      return commandResult(`${path(command.conversationId)}/decisions/${decision(command.decisionId)}/reply`, command, { clientCommandId: command.clientCommandId, answer: command.answer }, 'form-reply', signal);
    },
    async decisions(conversationId: string, signal?: AbortSignal): Promise<ThinkDecision[]> {
      const result = await request(`${path(conversationId)}/decisions`, 'GET', undefined, signal);
      if (!object(result) || !Array.isArray(result.decisions)) throw new ThinkClientError('invalid-response');
      return result.decisions.map(value => projectDecision(value, conversationId));
    },
    async decision(conversationId: string, decisionId: string, signal?: AbortSignal): Promise<ThinkDecision> {
      return projectDecision(await request(`${path(conversationId)}/decisions/${decision(decisionId)}`, 'GET', undefined, signal), conversationId, decisionId);
    },
    async chunk(ref: BodyRef, offset: number, transfer?: string, signal?: AbortSignal): Promise<ContentChunk> {
      const conversationId = identifier(ref.key.conversationId);
      const epoch = identifier(ref.epoch);
      const contentId = identifier(ref.contentId);
      const generation = identifier(ref.generation);
      const through = ref.through;
      if (!integer(through) || !integer(offset) || offset > through || (transfer === undefined && offset !== 0)) throw new ThinkClientError('invalid-input');
      if (transfer !== undefined) identifier(transfer);
      const query = new URLSearchParams({ generation, through: String(through), offset: String(offset), ...(transfer === undefined ? {} : { transfer }) });
      const value = await request(`${path(conversationId)}/content/${contentId}?${query}`, 'GET', undefined, signal, 131072);
      if (!object(value) || value.conversationId !== conversationId || value.epoch !== epoch || value.contentId !== contentId || value.generation !== generation || value.through !== through || value.offset !== offset ||
          typeof value.transfer !== 'string' || !uuid.test(value.transfer) || (transfer !== undefined && transfer !== value.transfer) || typeof value.bytes !== 'string' || value.bytes.length > 87384 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.bytes) || !integer(value.nextOffset)) throw new ThinkClientError('invalid-response');
      let decoded: string;
      try { decoded = atob(value.bytes); } catch { throw new ThinkClientError('invalid-response'); }
      if (btoa(decoded) !== value.bytes || decoded.length > 65536 || value.nextOffset !== offset + decoded.length || value.nextOffset > through || (offset < through && value.nextOffset === offset)) throw new ThinkClientError('invalid-response');
      return { conversationId, epoch, contentId, generation, through, offset, bytes: value.bytes, nextOffset: value.nextOffset, transfer: value.transfer };
    },
    watch(conversationId: string, handlers: ThinkWatchHandlers, signal?: AbortSignal): () => void {
      const target = `${path(conversationId)}/events`;
      if (signal?.aborted) return () => {};
      const source = openWatch(target);
      let closed = false;
      let epoch: string | undefined;
      let revision = -1;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        for (const [name, listener] of listeners) source.removeEventListener(name, listener);
        signal?.removeEventListener('abort', cleanup);
        source.close();
      };
      const fail = (error: ThinkClientError) => { cleanup(); handlers.error(error); };
      const event = (name: 'snapshot' | 'revision' | 'heartbeat'): EventListener => (raw) => {
        if (closed) return;
        try {
          if (!(raw instanceof MessageEvent) || typeof raw.data !== 'string' || raw.data.length > 60 * 1024 || new TextEncoder().encode(raw.data).length > 60 * 1024) throw new ThinkClientError('invalid-response');
          const value: unknown = JSON.parse(raw.data);
          if (name === 'heartbeat') { if (!epoch || !object(value) || Object.keys(value).length) throw new ThinkClientError('invalid-response'); handlers.heartbeat(); return; }
          if (name === 'snapshot') {
            if (epoch) throw new ThinkClientError('invalid-response');
            const result = state(value, conversationId, true); epoch = result.epoch; revision = result.revision; handlers.snapshot(result); return;
          }
          if (!epoch) throw new ThinkClientError('invalid-response');
          const result = state(value, conversationId, false);
          if (result.epoch !== epoch || result.revision <= revision) throw new ThinkClientError('invalid-response');
          revision = result.revision; handlers.revision(result);
        } catch { fail(new ThinkClientError('invalid-response')); }
      };
      const listeners: Array<[string, EventListener]> = [['snapshot', event('snapshot')], ['revision', event('revision')], ['heartbeat', event('heartbeat')], ['error', () => fail(new ThinkClientError('transport'))]];
      for (const [name, listener] of listeners) source.addEventListener(name, listener);
      signal?.addEventListener('abort', cleanup, { once: true });
      if (signal?.aborted) cleanup();
      return cleanup;
    },
  };
}
