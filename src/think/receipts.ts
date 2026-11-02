import type { CommandReceipt } from '../../backend/think/contract';
import { ThinkClientError } from './client';

/** Terminal command/control facts are immutable; a Stop acknowledgement is not a run terminal. */
export function finalReceipt(receipt: CommandReceipt): boolean {
  switch (receipt.kind) {
    case 'create': return receipt.state === 'ready' || receipt.state === 'rejected';
    case 'resume': return receipt.state === 'ready' || receipt.state === 'rejected';
    case 'delete': return receipt.state === 'completed';
    case 'send': return ['completed', 'failed', 'interrupted', 'cancelled-before-delivery', 'rejected'].includes(receipt.state);
    case 'stop': return receipt.state !== 'registered';
    case 'form-reply': return ['replied', 'stale', 'rejected'].includes(receipt.state);
  }
}
function progress(receipt: CommandReceipt): number {
  if (finalReceipt(receipt)) return 4;
  if (receipt.kind === 'send' && receipt.state === 'admitted') return 3;
  return receipt.state === 'registered' ? 1 : 2;
}

/** Local monotonic merge, not a new server version protocol or native-execution inference. */
export function mergeReceipt(previous: CommandReceipt | undefined, incoming: CommandReceipt): CommandReceipt {
  if (!previous) return incoming;
  if (previous.kind !== incoming.kind || previous.epoch !== incoming.epoch || previous.conversationId !== incoming.conversationId || previous.clientCommandId !== incoming.clientCommandId ||
      ('runId' in previous && (!('runId' in incoming) || previous.runId !== incoming.runId)) ||
      ('decisionId' in previous && (!('decisionId' in incoming) || previous.decisionId !== incoming.decisionId))) return previous;
  if (previous.kind === 'delete' && incoming.kind === 'delete') {
    // Pending is not completion or permission to retry. Preserve forward progress,
    // but allow a newer safe pending reason without freezing the first observation.
    if (previous.state === 'completed' || previous.state === 'pending' && incoming.state === 'accepted') return previous;
    return previous.state === incoming.state && previous.reason === incoming.reason ? previous : incoming;
  }
  if (finalReceipt(previous) || progress(incoming) < progress(previous) || previous.state === incoming.state) return previous;
  return incoming;
}

/** Only an explicit POST nonadmission is definitive. A GET 404 after a lost POST is not. */
export function rejectedPost(error: unknown): boolean {
  return error instanceof ThinkClientError && (error.kind === 'invalid-input' ||
    error.kind === 'api' && error.status !== undefined && error.status >= 400 && error.status < 500);
}
