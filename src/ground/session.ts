import { createGroundClient, type GroundKey, type GroundReads } from './client';

export interface CardRead<T> { readonly read: T | null; readonly loading: boolean; readonly failed: boolean }
export type GroundState = { readonly [K in GroundKey]: CardRead<GroundReads[K]> };
export interface GroundSession {
  subscribe(listener: () => void): () => void;
  getSnapshot(): GroundState;
  setLocation(pathname: string): void;
  retry(key: GroundKey): void;
  close(): void;
}
const initial = (): GroundState => ({
  quickActions: { read: null, loading: true, failed: false }, inspiration: { read: null, loading: true, failed: false },
  prompts: { read: null, loading: true, failed: false }, goals: { read: null, loading: true, failed: false }, captures: { read: null, loading: true, failed: false },
});

/** One in-memory visit, with separate request ownership for each of five real reads. */
export function createGroundSession(client = createGroundClient()): GroundSession {
  let state = initial();
  let active = false;
  let closed = false;
  let visit = 0;
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
    const previous = state[key].read;
    publish(key, { read: previous, loading: true, failed: false });
    const current = () => !closed && active && owner === visit && requests.get(key) === controller;
    try {
      const read = await client.read(key, controller.signal);
      if (!current()) return;
      const stale = read.state === 'unavailable' && previous?.state === 'ready';
      publish(key, { read: stale ? previous : read, loading: false, failed: stale });
    } catch {
      if (current()) publish(key, { read: previous?.state === 'ready' ? previous : null, loading: false, failed: true });
    } finally { if (requests.get(key) === controller) requests.delete(key); }
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => state,
    setLocation(pathname) {
      const next = pathname.replace(/\/$/, '') === '/ground';
      if (closed || next === active) return;
      active = next;
      ++visit;
      for (const controller of requests.values()) controller.abort();
      requests.clear();
      if (active) {
        void load('quickActions'); void load('inspiration'); void load('prompts'); void load('goals'); void load('captures');
      }
    },
    retry(key) { void load(key); },
    close() { closed = true; ++visit; for (const controller of requests.values()) controller.abort(); requests.clear(); listeners.clear(); },
  };
}
