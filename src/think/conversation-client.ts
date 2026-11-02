import { projectView, validConversationId } from '../web/ground-conversations-projection';
import type { ResumeReceipt, ViewRegistration, ViewSelection } from '../../backend/think/contract';
import { ThinkClientError } from './client';

/** Fixed public lifecycle endpoints. Tokens are body/header values only, never URLs or logs. */
export function createConversationClient(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
  async function request(path: string, method: 'GET' | 'POST', status: number, body?: object, token?: string): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = (async () => {
        const response = await fetcher(path, { method, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { Accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { 'X-Memory-Loop-View': token } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new ThinkClientError('invalid-response');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 65536) throw new ThinkClientError('invalid-response');
            chunks.push(part.value);
          }
        } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!response.ok) throw new ThinkClientError('api', response.status);
        if (response.status !== status) throw new ThinkClientError('invalid-response');
        return value;
      })();
      return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new ThinkClientError('transport', undefined, undefined, method === 'POST' ? 'unknown' : undefined));
      }, 5000); })]);
    } catch (error) {
      if (error instanceof ThinkClientError) throw error;
      throw new ThinkClientError('transport', undefined, undefined, method === 'POST' ? 'unknown' : undefined);
    } finally { if (timer) clearTimeout(timer); }
  }
  return {
    async register(): Promise<ViewRegistration> { return projectView(await request('/api/think/views', 'POST', 201, {}), true); },
    async inspect(viewToken: string): Promise<ViewSelection> { return projectView(await request('/api/think/selection', 'GET', 200, undefined, viewToken), false); },
    async select(viewToken: string, expectedRevision: number, conversationId: string | null): Promise<ViewSelection> {
      return projectView(await request('/api/think/selection', 'POST', 200, { viewToken, expectedRevision, conversationId }), false);
    },
    async resume(conversationId: string, clientCommandId: string): Promise<ResumeReceipt> {
      if (!validConversationId(conversationId) || !validConversationId(clientCommandId)) throw new ThinkClientError('invalid-input');
      const value = await request(`/api/think/conversations/${conversationId}/resume`, 'POST', 202, { clientCommandId });
      if (!value || typeof value !== 'object') throw new ThinkClientError('invalid-response');
      const receipt = value as Record<string, unknown>;
      if (receipt.kind !== 'resume' || receipt.conversationId !== conversationId || receipt.clientCommandId !== clientCommandId || !validConversationId(receipt.epoch)) throw new ThinkClientError('invalid-response');
      const base = { kind: 'resume' as const, conversationId, clientCommandId, epoch: receipt.epoch };
      if (receipt.state === 'ready' || receipt.state === 'registered' || receipt.state === 'upstream-unconfirmed') return { ...base, state: receipt.state };
      if (receipt.state === 'rejected' && receipt.failure && typeof receipt.failure === 'object' && 'code' in receipt.failure &&
        (receipt.failure.code === 'ownership_mismatch' || receipt.failure.code === 'service_unavailable')) return { ...base, state: 'rejected', failure: { code: receipt.failure.code } };
      throw new ThinkClientError('invalid-response');
    },
  };
}
