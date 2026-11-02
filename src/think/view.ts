import type { ViewSelection } from '../../backend/think/contract';
import { ThinkClientError } from './client';
import { createConversationClient } from './conversation-client';

export interface ThinkViewState {
  readonly token: string | null;
  readonly selection: ViewSelection | null;
  readonly status: 'idle' | 'checking' | 'ready' | 'unavailable';
  /** Token/binding changes only; heartbeats must not reshuffle Ground. */
  readonly change: number;
}
interface ViewClock { setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>; clearTimeout(timer: ReturnType<typeof setTimeout>): void }
const defaultClock: ViewClock = { setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: timer => clearTimeout(timer) };

/** One serialized, memory-only view owner. Never confuses GET inspection with renewal. */
export function createThinkView(client = createConversationClient(), clock: ViewClock = defaultClock, now = () => performance.now()) {
  let state: ThinkViewState = { token: null, selection: null, status: 'idle', change: 0 };
  let desired: string | null = null;
  let desiredVersion = 0;
  let started = false;
  let closed = false;
  let queued = false;
  let validUntil = 0;
  let tail = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  function publish(status: ThinkViewState['status'], selection = state.selection, token = state.token) {
    if (closed) return;
    const changed = token !== state.token || selection?.conversationId !== state.selection?.conversationId || selection?.selectionRevision !== state.selection?.selectionRevision;
    state = { token, selection, status, change: state.change + (changed ? 1 : 0) };
    for (const listener of listeners) listener();
  }
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(() => {}, () => {});
    return result;
  }
  const canMutate = (id: string) => !closed && state.status === 'ready' && state.selection?.conversationId === id && now() < validUntil;
  function unavailable(error?: unknown) {
    validUntil = 0;
    const expired = error instanceof ThinkClientError && error.status === 403;
    publish('unavailable', expired ? null : state.selection, expired ? null : state.token);
  }
  async function inspectOrRegister(): Promise<ViewSelection> {
    if (closed) throw new Error('Closed view');
    if (state.token) {
      try {
        const selection = await client.inspect(state.token);
        if (closed) throw new Error('Closed view');
        publish('checking', selection);
        return selection;
      } catch (error) {
        if (!(error instanceof ThinkClientError) || error.status !== 403) throw error;
        publish('checking', null, null);
      }
    }
    console.info('think_view_register_attempt');
    try {
      const registration = await client.register();
      if (closed) throw new Error('Closed view');
      validUntil = now() + 90000;
      publish('checking', { selectionRevision: registration.selectionRevision, conversationId: registration.conversationId, expiresAt: registration.expiresAt }, registration.viewToken);
      console.info('think_view_register_outcome', { state: 'registered' });
      return state.selection!;
    } catch (error) { console.info('think_view_register_outcome', { state: 'unavailable' }); throw error; }
  }
  async function write(previous: ViewSelection, target: string | null): Promise<ViewSelection> {
    if (closed) throw new Error('Closed view');
    const token = state.token!;
    const revision = previous.selectionRevision + (previous.conversationId === target ? 0 : 1);
    console.info('think_view_selection_attempt');
    try {
      const next = await client.select(token, previous.selectionRevision, target);
      if (next.conversationId !== target || next.selectionRevision !== revision) throw new ThinkClientError('invalid-response');
      validUntil = now() + 90000; // Relative to an acknowledged two-minute grant, not the browser's wall clock.
      publish('ready', next);
      console.info('think_view_selection_outcome', { state: 'selected' });
      return next;
    } catch (error) {
      if (error instanceof ThinkClientError && error.status === 403) throw error;
      console.info('think_view_selection_outcome', { state: 'checking' });
      // A timed-out or stale CAS is inspected, never blindly replayed.
      const observed = await client.inspect(token);
      publish('checking', observed);
      if (observed.selectionRevision === revision && observed.conversationId === target) {
        if (target !== previous.conversationId || observed.expiresAt !== previous.expiresAt) validUntil = now() + 85000;
        publish(now() < validUntil ? 'ready' : 'unavailable', observed);
        return observed;
      }
      if (desired === previous.conversationId) { desired = observed.conversationId; desiredVersion++; }
      throw new ThinkClientError('api', 409, 'selection_conflict');
    }
  }
  function sync() {
    if (closed || queued) return;
    queued = true;
    publish('checking');
    void serialize(async () => {
      const version = desiredVersion;
      try {
        const previous = await inspectOrRegister();
        if (closed || version !== desiredVersion) return;
        await write(previous, desired);
      } catch (error) { unavailable(error); }
      finally { queued = false; if (!closed && version !== desiredVersion) sync(); }
    });
  }
  function schedule() {
    timer = clock.setTimeout(() => { timer = undefined; if (!closed) { sync(); schedule(); } }, 30000);
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    canMutate,
    setDesired(id: string | null, refresh = false) {
      const changed = desired !== id;
      if (changed) { desired = id; desiredVersion++; }
      if (!started) { started = true; schedule(); refresh = true; }
      if (changed || refresh) sync();
    },
    refresh() { sync(); },
    /** Native preparation requires a live registered view, but does not select an unverified target. */
    ensureRegistered(): Promise<boolean> {
      return serialize(async () => {
        try { const previous = await inspectOrRegister(); await write(previous, previous.conversationId); return true; }
        catch (error) { unavailable(error); return false; }
      });
    },
    transition(target: string, valid: () => boolean, commit: () => void): Promise<'committed' | 'stale' | 'unavailable'> {
      return serialize(async () => {
        const priorDesired = desired;
        try {
          const previous = await inspectOrRegister();
          if (!valid() || closed) return 'stale';
          const token = state.token;
          const owned = await write(previous, target);
          if (closed) return 'stale';
          if (valid() && now() < validUntil) {
            desired = target; desiredVersion++;
            commit();
            return 'committed';
          }
          // Only undo our exact acknowledged binding. A later revision belongs to
          // a newer selection and must never be overwritten by this completion.
          if (state.token === token) {
            const observed = await client.inspect(token!);
            publish('checking', observed);
            if (observed.selectionRevision === owned.selectionRevision && observed.conversationId === target && desired === priorDesired) {
              await write(observed, previous.conversationId);
            } else {
              if (desired === priorDesired) { desired = observed.conversationId; desiredVersion++; }
              publish(now() < validUntil ? 'ready' : 'unavailable', observed);
            }
          }
          return 'stale';
        } catch (error) { unavailable(error); return 'unavailable'; }
      });
    },
    close() { closed = true; if (timer !== undefined) clock.clearTimeout(timer); listeners.clear(); },
  };
}
