import { projectGround, type GroundRoute } from '../web/ground-projection';
import type { CapturesRead, GoalsData, InspirationData, PromptsData, QuickActionsData, ResourceRead } from '../../backend/ground-contract';
import type { DeleteBlockReason, DeleteReceipt, RecentConversations } from '../../backend/think/contract';
import { projectRecentConversations, validConversationId, validViewToken } from '../web/ground-conversations-projection';

export interface GroundReads {
  quickActions: ResourceRead<QuickActionsData>;
  inspiration: ResourceRead<InspirationData>;
  prompts: ResourceRead<PromptsData>;
  goals: ResourceRead<GoalsData>;
  captures: CapturesRead;
  conversations: RecentConversations | { state: 'unavailable' };
}
export type GroundKey = keyof GroundReads;
const routes: Record<GroundKey, GroundRoute | 'recent-conversations'> = {
  quickActions: 'quick-actions', inspiration: 'inspiration', prompts: 'prompts', goals: 'goals', captures: 'recent-captures',
  conversations: 'recent-conversations',
};
let sequence = 0;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export class GroundDeleteRefusal extends Error {
  constructor(readonly code: 'lease_unavailable' | 'selection_conflict' | 'delete_blocked', readonly reason?: DeleteBlockReason) {
    super('Conversation deletion refused');
  }
}
function deleteReceipt(value: unknown, conversationId: string, clientCommandId: string): DeleteReceipt {
  if (!record(value) || value.kind !== 'delete' || value.conversationId !== conversationId || value.clientCommandId !== clientCommandId ||
      !validConversationId(value.epoch) || value.state !== 'accepted' && value.state !== 'pending' && value.state !== 'completed' ||
      value.reason !== undefined && value.reason !== 'io_unavailable' && value.reason !== 'conflict' && value.reason !== 'status_unknown') throw new Error('Invalid deletion receipt');
  return { kind: 'delete', conversationId, clientCommandId, epoch: value.epoch, state: value.state, ...(value.reason === undefined ? {} : { reason: value.reason }) };
}

async function json(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new Error('Invalid Ground response');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new Error('Aborted');
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new Error('Ground response too large');
      parts.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Fixed same-origin targets and the shared public projection, never service credentials. */
export function createGroundClient(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
  async function deletionRequest(conversationId: string, clientCommandId: string, viewToken?: string): Promise<DeleteReceipt> {
    if (!validConversationId(conversationId) || !validConversationId(clientCommandId) || viewToken !== undefined && !validViewToken(viewToken)) throw new Error('Invalid deletion request');
    const controller = new AbortController();
    const posting = viewToken !== undefined;
    const operation = posting ? 'delete' : 'check';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome = 'unconfirmed';
    console.info('ground_delete_attempt', { operation });
    try {
      const request = (async () => {
        const response = await fetcher(`/api/think/conversations/${conversationId}/${posting ? 'delete' : `commands/${clientCommandId}`}`, {
          method: posting ? 'POST' : 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { Accept: 'application/json', ...(posting ? { 'content-type': 'application/json' } : {}) },
          ...(posting ? { body: JSON.stringify({ clientCommandId, viewToken }) } : {}),
        });
        const value = await json(response, 65536, controller.signal);
        if (posting && record(value) && record(value.error)) {
          const { code, reason } = value.error;
          if (response.status === 403 && code === 'lease_unavailable' || response.status === 409 && code === 'selection_conflict') throw new GroundDeleteRefusal(code);
          if (response.status === 409 && code === 'delete_blocked' && (reason === 'current' || reason === 'selected_elsewhere' || reason === 'running' || reason === 'status_unknown' || reason === 'deleting')) throw new GroundDeleteRefusal(code, reason);
        }
        if (response.status !== (posting ? 202 : 200)) throw new Error('Deletion unavailable');
        return deleteReceipt(value, conversationId, clientCommandId);
      })();
      const receipt = await Promise.race([request, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Deletion acknowledgement unavailable')); }, 5000);
      })]);
      outcome = receipt.state;
      return receipt;
    } catch (error) {
      if (error instanceof GroundDeleteRefusal) outcome = 'refused';
      throw error;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      console.info('ground_delete_outcome', { operation, state: outcome });
    }
  }
  return {
    deleteConversation: (conversationId: string, clientCommandId: string, viewToken: string) => deletionRequest(conversationId, clientCommandId, viewToken),
    deleteStatus: (conversationId: string, clientCommandId: string) => deletionRequest(conversationId, clientCommandId),
    async read<K extends GroundKey>(key: K, signal: AbortSignal, viewToken?: string | null): Promise<GroundReads[K]> {
      const requestId = ++sequence;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let outcome = 'unavailable';
      console.info('ground_read_attempt', { card: key, requestId });
      try {
        const operation = (async () => {
          if (controller.signal.aborted) throw new Error('Aborted');
          const response = await fetcher(`/api/ground/${routes[key]}`, {
            signal: controller.signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: {
              Accept: 'application/json', ...(key === 'conversations' && viewToken ? { 'X-Memory-Loop-View': viewToken } : {}),
            },
          });
          const value = await json(response, key === 'goals' || key === 'quickActions' ? 524288 : 65536, controller.signal);
          // The fixed key→route mapping binds this route-specific validated projection.
          const route = routes[key];
          return (route === 'recent-conversations' ? projectRecentConversations(value, response.status) : projectGround(value, route, response.status)) as GroundReads[K];
        })();
        const result = await Promise.race([operation, new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Ground read timed out')); }, 5000);
        })]);
        outcome = result.state;
        return result;
      } finally {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        console.info('ground_read_outcome', { card: key, requestId, status: signal.aborted ? 'abandoned' : outcome });
      }
    },
  };
}
