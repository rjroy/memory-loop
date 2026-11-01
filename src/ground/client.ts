import { projectGround, type GroundRoute } from '../web/ground-projection';
import type { CapturesRead, GoalsData, InspirationData, PromptsData, QuickActionsData, ResourceRead } from '../../backend/ground-contract';
import type { RecentConversations } from '../../backend/think/contract';
import { projectRecentConversations } from '../web/ground-conversations-projection';

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
  return {
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
