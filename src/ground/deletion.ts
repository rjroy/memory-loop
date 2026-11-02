import type { DeleteBlockReason, DeleteReceipt, RecentConversation } from '../../backend/think/contract';
import { GroundDeleteRefusal, type createGroundClient } from './client';
import { secureUuid } from '../browser-crypto';

export interface DeletionPermit { viewToken: string; valid(): boolean; invalidate(): void }
export type GroundDeletion = null | { phase: 'completed'; conversationId: string } | {
  phase: 'confirm' | 'preparing' | 'posting' | 'pending' | 'unconfirmed' | 'checking' | 'refused';
  conversationId: string; title: string; reason?: DeleteBlockReason | DeleteReceipt['reason'];
};
export interface DeletionOptions {
  prepare(conversationId: string): Promise<DeletionPermit | null>;
  allowed(conversationId: string): boolean;
  publish(state: GroundDeletion): void;
  refresh(): void;
  remove(conversationId: string): void;
}

/** One explicit destructive intent. Only a manual status action can read its
 * receipt; neither navigation nor an uncertain acknowledgement replays the POST. */
export function createGroundDeletion(client: Pick<ReturnType<typeof createGroundClient>, 'deleteConversation' | 'deleteStatus'>, options: DeletionOptions) {
  let state: GroundDeletion = null;
  let closed = false;
  let owner: { conversationId: string; title: string; commandId?: string; dispatched: boolean; busy: boolean; onComplete?(): void } | undefined;
  const publish = (next: GroundDeletion) => { state = next; if (!closed) options.publish(next); };
  const phase = (value: NonNullable<typeof owner>, next: Exclude<NonNullable<GroundDeletion>['phase'], 'completed'>, reason?: DeleteBlockReason | DeleteReceipt['reason']) => {
    if (!closed && owner === value) publish({ phase: next, conversationId: value.conversationId, title: value.title, ...(reason ? { reason } : {}) });
  };
  function accept(value: NonNullable<typeof owner>, receipt: DeleteReceipt) {
    if (closed || owner !== value) return;
    if (receipt.state === 'completed') {
      // Give the initiating UI a chance to move focus before the owned row goes.
      value.onComplete?.();
      publish({ phase: 'completed', conversationId: value.conversationId });
      options.remove(value.conversationId);
      options.refresh();
      owner = undefined;
    } else phase(value, 'pending', receipt.reason);
  }
  return {
    request(item: RecentConversation, onComplete?: () => void) {
      if (closed || owner || !options.allowed(item.conversationId)) return;
      const title = item.title ?? `Untitled conversation (${new Date(item.lastActivityAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })})`;
      owner = { conversationId: item.conversationId, title, dispatched: false, busy: false, onComplete };
      phase(owner, 'confirm');
    },
    cancel() {
      if (!owner || state?.phase !== 'confirm' && state?.phase !== 'refused') return;
      owner = undefined; publish(null);
    },
    leave() {
      if (owner && !owner.dispatched) { owner = undefined; publish(null); }
    },
    async confirm() {
      const value = owner;
      if (closed || !value || value.busy || state?.phase !== 'confirm') return;
      value.busy = true;
      phase(value, 'preparing');
      let permit: DeletionPermit | null = null;
      try {
        permit = await options.prepare(value.conversationId);
        if (closed || owner !== value) return;
        if (!permit || !permit.valid() || !options.allowed(value.conversationId)) {
          phase(value, 'refused', 'status_unknown'); options.refresh(); return;
        }
        value.commandId = secureUuid();
        phase(value, 'posting');
        if (closed || owner !== value) return;
        if (!permit.valid() || !options.allowed(value.conversationId)) {
          phase(value, 'refused', 'status_unknown'); options.refresh(); return;
        }
        value.dispatched = true;
        accept(value, await client.deleteConversation(value.conversationId, value.commandId, permit.viewToken));
      } catch (error) {
        if (closed || owner !== value) return;
        if (!value.dispatched || error instanceof GroundDeleteRefusal) {
          if (error instanceof GroundDeleteRefusal && error.code !== 'delete_blocked') permit?.invalidate();
          phase(value, 'refused', error instanceof GroundDeleteRefusal ? error.reason ?? 'status_unknown' : 'status_unknown');
          options.refresh();
        } else phase(value, 'unconfirmed');
      } finally { value.busy = false; }
    },
    async check(onComplete?: () => void) {
      const value = owner;
      if (closed || !value?.dispatched || !value.commandId || value.busy || state?.phase !== 'pending' && state?.phase !== 'unconfirmed') return;
      value.busy = true;
      value.onComplete = onComplete;
      phase(value, 'checking');
      try { accept(value, await client.deleteStatus(value.conversationId, value.commandId)); }
      catch { phase(value, 'unconfirmed'); }
      finally { value.busy = false; }
    },
    close() { closed = true; owner = undefined; },
  };
}
