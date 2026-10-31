import type { LoadedTransport } from '../../backend/transport';
import { allowsWebRequest } from './request-policy';

type Method = 'GET' | 'POST';
export interface ThinkBffDependencies {
  transport: LoadedTransport;
  fetch: (target: URL, options: { method: Method; token: string; body?: Uint8Array; signal: AbortSignal }) => Promise<Response>;
  log: (event: string, details: Record<string, unknown>) => void;
}

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const base = '/api/think/conversations';
const decisionId = '[A-Za-z0-9_-]{1,128}';
const routes = [
  { method: 'POST', pattern: new RegExp(`^${base}$`) },
  { method: 'GET', pattern: new RegExp(`^${base}/${uuid}$`) },
  { method: 'GET', pattern: new RegExp(`^${base}/${uuid}/commands/${uuid}$`) },
  { method: 'POST', pattern: new RegExp(`^${base}/${uuid}/messages$`) },
  { method: 'POST', pattern: new RegExp(`^${base}/${uuid}/runs/${uuid}/stop$`) },
  { method: 'GET', pattern: new RegExp(`^${base}/${uuid}/decisions$`) },
  { method: 'GET', pattern: new RegExp(`^${base}/${uuid}/decisions/${decisionId}$`) },
  { method: 'POST', pattern: new RegExp(`^${base}/${uuid}/decisions/${decisionId}/reply$`) },
] as const;
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const errors = {
  forbidden: [403, 'Request is not permitted'], invalid_request: [400, 'Invalid Think request'],
  command_conflict: [409, 'Command conflicts with a previous request'], not_found: [404, 'Think resource not found'],
  method_not_allowed: [405, 'Method is not allowed'], think_unavailable: [503, 'Think service is unavailable'],
  think_config_missing: [503, 'Think setup is required'], think_config_invalid: [503, 'Think configuration is invalid'],
  service_unavailable: [503, 'Think service unavailable'],
  decision_unavailable: [503, 'Decision details are unavailable'],
} as const;
function failure(code: keyof typeof errors): Response {
  const [status, message] = errors[code];
  return Response.json({ error: { code, message } }, { status, headers });
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
async function boundedBytes(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = body.getReader();
  let bytes = new Uint8Array(Math.min(4096, limit));
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error('body timeout')); }, 5000); });
  try {
    const read = async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const next = size + value.length;
        if (next > limit) { void reader.cancel().catch(() => {}); throw new Error('body too large'); }
        if (next > bytes.length) {
          const expanded = new Uint8Array(Math.min(limit, Math.max(next, bytes.length * 2)));
          expanded.set(bytes); bytes = expanded;
        }
        bytes.set(value, size); size = next;
      }
      return bytes.slice(0, size);
    };
    return await Promise.race([read(), timeout]);
  } finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
}
async function bodyBytes(request: Request): Promise<Uint8Array> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') || !request.body) throw new Error('invalid body');
  return boundedBytes(request.body, 6 * 1024 * 1024 + 4096);
}

function project(value: unknown, method: Method, path: string): Record<string, unknown> {
  const segments = path.slice(base.length).split('/').filter(Boolean);
  if (segments[1] === 'decisions' && method === 'GET') {
    const decision = (input: unknown): Record<string, unknown> => {
      if (!record(input) || input.conversationId !== segments[0] || typeof input.decisionId !== 'string' ||
          !new RegExp(`^${decisionId}$`).test(input.decisionId) || (segments[2] && input.decisionId !== segments[2]) ||
          input.kind !== 'form' || typeof input.title !== 'string' || !Array.isArray(input.fields)) throw new Error('invalid decision');
      const fields = input.fields.map(field => {
        if (!record(field) || typeof field.key !== 'string' || typeof field.type !== 'string' || !['string', 'number', 'integer', 'boolean', 'multiselect'].includes(field.type)) throw new Error('invalid field');
        const keys = ['key', 'type', 'title', 'description', 'required', 'hidden', 'minimum', 'maximum', 'default', 'format', 'minLength', 'maxLength', 'pattern', 'placeholder', 'custom', 'minItems', 'maxItems'];
        const result = Object.fromEntries(Object.entries(field).filter(([key, value]) => keys.includes(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value) && value.every(item => typeof item === 'string'))));
        if (Array.isArray(field.options)) result.options = field.options.map(option => {
          if (!record(option) || typeof option.value !== 'string' || typeof option.label !== 'string') throw new Error('invalid option');
          return { value: option.value, label: option.label, ...(typeof option.description === 'string' ? { description: option.description } : {}) };
        });
        if (Array.isArray(field.when)) result.when = field.when.map(rule => {
          if (!record(rule) || typeof rule.key !== 'string' || !['eq', 'neq'].includes(String(rule.op)) || !['string', 'number', 'boolean'].includes(typeof rule.value)) throw new Error('invalid condition');
          return { key: rule.key, op: rule.op, value: rule.value };
        });
        return result;
      });
      return { conversationId: input.conversationId, decisionId: input.decisionId, kind: 'form', title: input.title, fields };
    };
    if (!segments[2]) {
      if (!record(value) || !Array.isArray(value.decisions)) throw new Error('invalid decisions');
      return { decisions: value.decisions.map(decision) };
    }
    return decision(value);
  }
  if (!record(value) || typeof value.conversationId !== 'string' || !new RegExp(`^${uuid}$`).test(value.conversationId) ||
      typeof value.epoch !== 'string' || !new RegExp(`^${uuid}$`).test(value.epoch)) throw new Error('invalid response');
  if (segments.length && value.conversationId !== segments[0]) throw new Error('conversation mismatch');
  if (method === 'GET' && typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
      typeof value.creation === 'string' && ['registered', 'ready', 'upstream-unconfirmed', 'rejected'].includes(value.creation)) {
    if (value.permissionCompatibility !== undefined && value.permissionCompatibility !== 'incompatible' ||
        value.permissionPending !== undefined && typeof value.permissionPending !== 'boolean') throw new Error('invalid permission state');
    return { conversationId: value.conversationId, epoch: value.epoch, revision: value.revision, creation: value.creation,
      ...(value.permissionCompatibility === 'incompatible' ? { permissionCompatibility: 'incompatible' } : {}),
      ...(typeof value.permissionPending === 'boolean' ? { permissionPending: value.permissionPending } : {}) };
  }
  if (typeof value.clientCommandId !== 'string' || !new RegExp(`^${uuid}$`).test(value.clientCommandId) ||
      !['create', 'send', 'stop', 'form-reply'].includes(String(value.kind)) || typeof value.state !== 'string') throw new Error('invalid receipt');
  if ((segments[1] === 'commands' && value.clientCommandId !== segments[2]) ||
      (method === 'POST' && value.kind !== (segments.length === 0 ? 'create' : segments[1] === 'messages' ? 'send' : segments[1] === 'decisions' ? 'form-reply' : 'stop')) ||
      (segments[1] === 'decisions' && value.decisionId !== segments[2]) ||
      (segments[1] === 'runs' && value.runId !== segments[2])) throw new Error('receipt mismatch');
  const validStates = value.kind === 'create' ? ['registered', 'ready', 'upstream-unconfirmed', 'rejected'] : value.kind === 'send'
    ? ['registered', 'admitted', 'upstream-unconfirmed', 'monitor-unavailable', 'cancelled-before-delivery', 'completed', 'failed', 'interrupted', 'rejected']
    : value.kind === 'form-reply' ? ['registered', 'replied', 'upstream-unconfirmed', 'stale', 'rejected'] : ['registered', 'requested', 'upstream-unconfirmed', 'cancelled-before-delivery'];
  if (!validStates.includes(value.state)) throw new Error('invalid receipt state');
  if ((value.kind === 'send' || value.kind === 'stop') && (typeof value.runId !== 'string' || !new RegExp(`^${uuid}$`).test(value.runId))) throw new Error('invalid run');
  if (value.kind === 'form-reply' && (typeof value.decisionId !== 'string' || !new RegExp(`^${decisionId}$`).test(value.decisionId))) throw new Error('invalid decision');
  const failureCodes = value.kind === 'create' ? ['upstream_rejected', 'ownership_mismatch', 'configuration_invalid', 'service_unavailable'] : ['execution_failed', 'resource_failure'];
  let failureValue: { code: string } | undefined;
  if (value.failure !== undefined) {
    if (!record(value.failure) || typeof value.failure.code !== 'string' || !failureCodes.includes(value.failure.code)) throw new Error('invalid failure');
    failureValue = { code: value.failure.code };
  }
  return { kind: value.kind, conversationId: value.conversationId, clientCommandId: value.clientCommandId, epoch: value.epoch, state: value.state,
    ...(value.kind === 'send' || value.kind === 'stop' ? { runId: value.runId } : {}), ...(value.kind === 'form-reply' ? { decisionId: value.decisionId } : {}), ...(failureValue ? { failure: failureValue } : {}) };
}

export async function handleThinkRequest(request: Request, dependencies: ThinkBffDependencies): Promise<Response> {
  const requestId = crypto.randomUUID();
  dependencies.log('think_bff_attempt', { requestId });
  let response: Response;
  try {
    const url = new URL(request.url);
    const route = routes.find(item => item.pattern.test(url.pathname));
    if (!allowsWebRequest(request, dependencies.transport.config.web)) response = failure('forbidden');
    else if (!route || url.search || url.hash) response = failure('not_found');
    else if (request.method !== route.method) response = failure('method_not_allowed');
    else {
      let body: Uint8Array | undefined;
      try { if (route.method === 'POST') body = await bodyBytes(request); }
      catch { response = failure('invalid_request'); dependencies.log('think_bff_outcome', { requestId, status: response.status }); return response; }
      const origin = new URL(dependencies.transport.config.daemonOrigin);
      if (origin.origin !== dependencies.transport.config.daemonOrigin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.username || origin.password || !/^[a-f0-9]{64}$/.test(dependencies.transport.serviceToken)) throw new Error('invalid transport');
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const upstream = async () => {
          const result = await dependencies.fetch(new URL(url.pathname, origin), { method: route.method, token: dependencies.transport.serviceToken, body, signal: controller.signal });
          if (!/^application\/json(?:\s*;|\s*$)/i.test(result.headers.get('content-type') ?? '')) throw new Error('invalid content type');
          if (!result.body) throw new Error('missing response');
          const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await boundedBytes(result.body, 65536)));
          if (result.status === (route.method === 'POST' ? 202 : 200)) return Response.json(project(data, route.method, url.pathname), { status: result.status, headers });
          if (record(data) && record(data.error) && typeof data.error.code === 'string' && Object.hasOwn(errors, data.error.code)) {
            const code = data.error.code as keyof typeof errors;
            if (errors[code][0] === result.status) return failure(code);
          }
          return failure('service_unavailable');
        };
        response = await Promise.race([upstream(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, 5000); })]);
      } finally { if (timer) clearTimeout(timer); }
    }
  } catch { response = failure('service_unavailable'); }
  dependencies.log('think_bff_outcome', { requestId, status: response.status });
  return response;
}
