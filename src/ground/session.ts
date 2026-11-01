import { createGroundClient, type GroundKey, type GroundReads } from './client';
import { createGroundDeletion, type DeletionPermit, type GroundDeletion } from './deletion';
import type { RecentConversation } from '../../backend/think/contract';

export interface CardRead<T> { readonly read: T | null; readonly loading: boolean; readonly failed: boolean }
type GroundCards = { readonly [K in GroundKey]: CardRead<GroundReads[K]> };
export type GroundState = GroundCards & { readonly deletion: GroundDeletion };
export interface GroundSession {
  subscribe(listener: () => void): () => void;
  getSnapshot(): GroundState;
  setLocation(pathname: string): void;
  setView(token: string | null, change: number, settled: boolean): void;
  retry(key: GroundKey): void;
  requestDeletion(item: RecentConversation, onComplete?: () => void): void;
  cancelDeletion(): void;
  confirmDeletion(): Promise<void>;
  checkDeletion(onComplete?: () => void): Promise<void>;
  close(): void;
}
const initial = (): GroundState => ({
  quickActions: { read: null, loading: true, failed: false }, inspiration: { read: null, loading: true, failed: false },
  prompts: { read: null, loading: true, failed: false }, goals: { read: null, loading: true, failed: false }, captures: { read: null, loading: true, failed: false },
  conversations: { read: null, loading: true, failed: false },
  deletion: null,
});

/** One in-memory visit, with independent resource and conversation reads. */
export function createGroundSession(client = createGroundClient(), prepareDeletion: (id: string) => Promise<DeletionPermit | null> = async () => null): GroundSession {
  let state = initial();
  let active = false;
  let closed = false;
  let visit = 0;
  let viewToken: string | null = null;
  let viewKey = '';
  let viewSettled = false;
  let conversationsDirty = true;
  const requests = new Map<GroundKey, AbortController>();
  const listeners = new Set<() => void>();
  const publish = <K extends GroundKey>(key: K, value: CardRead<GroundReads[K]>) => {
    state = { ...state, [key]: value };
    for (const listener of listeners) listener();
  };
  async function load<K extends GroundKey>(key: K) {
    if (!active || closed || requests.has(key)) return;
    const controller = new AbortController();
    const owner = visit;
    requests.set(key, controller);
    const cards: GroundCards = state;
    const previous = cards[key].read;
    publish(key, { read: previous, loading: true, failed: false });
    const current = () => !closed && active && owner === visit && requests.get(key) === controller;
    try {
      const read = await client.read(key, controller.signal, key === 'conversations' ? viewToken : undefined);
      if (!current()) return;
      const stale = read.state === 'unavailable' && previous?.state === 'ready';
      publish(key, { read: stale ? previous : read, loading: false, failed: stale });
    } catch {
      if (current()) publish(key, { read: previous?.state === 'ready' ? previous : null, loading: false, failed: true });
    } finally { if (requests.get(key) === controller) requests.delete(key); }
  }
  function refreshConversations() {
    conversationsDirty = true;
    requests.get('conversations')?.abort(); requests.delete('conversations');
    if (active) { conversationsDirty = false; void load('conversations'); }
  }
  const deletion = createGroundDeletion(client, {
    prepare: prepareDeletion,
    allowed(id) {
      const card = state.conversations;
      return active && !closed && !card.loading && !card.failed && card.read?.state === 'ready' &&
        card.read.items.some(item => item.conversationId === id && item.state === 'ready' && item.delete.available);
    },
    publish(value) { state = { ...state, deletion: value }; for (const listener of listeners) listener(); },
    refresh: refreshConversations,
    remove(id) {
      const card = state.conversations;
      if (card.read?.state === 'ready') publish('conversations', { ...card, read: { ...card.read, items: card.read.items.filter(item => item.conversationId !== id) } });
    },
  });
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    setLocation(pathname) {
      const next = pathname.replace(/\/$/, '') === '/ground';
      if (closed || next === active) return;
      active = next;
      if (!active) deletion.leave();
      ++visit;
      for (const controller of requests.values()) controller.abort();
      requests.clear();
      if (active) {
        void load('quickActions'); void load('inspiration'); void load('prompts'); void load('goals'); void load('captures');
        conversationsDirty = !viewSettled;
        if (viewSettled) void load('conversations');
      }
    },
    setView(token, change, settled) {
      const key = JSON.stringify([token, change]);
      viewToken = token;
      viewSettled = settled;
      if (key !== viewKey) {
        viewKey = key;
        conversationsDirty = true;
        requests.get('conversations')?.abort();
        requests.delete('conversations');
      }
      if (active && settled && conversationsDirty) { conversationsDirty = false; void load('conversations'); }
    },
    retry(key) { void load(key); },
    requestDeletion: deletion.request, cancelDeletion: deletion.cancel, confirmDeletion: deletion.confirm, checkDeletion: deletion.check,
    close() { closed = true; deletion.close(); ++visit; for (const controller of requests.values()) controller.abort(); requests.clear(); listeners.clear(); },
  };
}
