import type { OpenCodeClient, SessionInfo } from '@opencode/client';
import { ClientError, isConflictError, isServiceUnavailableError } from '@opencode/client';
import type { GenerationAttempt, GenerationSelection } from './ground-generation-state';
import { GroundGenerationError } from './ground-generation-error';
import { questionDigest, questionResponseLimit } from './ground-generation-questions';

export interface GenerationCandidate { messageId: string; sha256: string; text: string }

export interface GroundGenerationNative {
  validate(signal: AbortSignal): Promise<void>;
  create(attempt: GenerationAttempt, signal: AbortSignal): Promise<GenerationSelection>;
  prompt(attempt: GenerationAttempt, text: string, signal: AbortSignal): Promise<void>;
  observe(attempt: GenerationAttempt, signal: AbortSignal): Promise<{ admitted: boolean; complete: boolean; candidate?: GenerationCandidate }>;
}
const denied = [{ action: '*', resource: '*', effect: 'deny' }] as const;
const sameModel = (a: SessionInfo['model'], b: SessionInfo['model']) => a?.providerID === b?.providerID && a?.id === b?.id && a?.variant === b?.variant;

/** Separate from Think's permissive creator. Session rules are verified, not reset on reads.
 * The owned runtime proof establishes built-in read denial, not a sandbox for privileged hooks. */
export function groundGenerationNative(options: {
  client: OpenCodeClient; directory: string; installationId: string; identity: { pid: number; version: string };
  validateSelection(signal: AbortSignal): Promise<void>;
}): GroundGenerationNative {
  const { client } = options;
  async function call<T>(operation: string, signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    console.info('ground_generation_native_attempt', { operation });
    try {
      if (signal.aborted) throw new Error('generation stopped');
      const result = await action(AbortSignal.any([signal, AbortSignal.timeout(10000)]));
      if (signal.aborted) throw new Error('generation stopped');
      console.info('ground_generation_native_outcome', { operation, status: 'ready' }); return result;
    } catch (error) {
      const failure = error instanceof GroundGenerationError ? error : new GroundGenerationError(
        isServiceUnavailableError(error) || error instanceof ClientError && error.reason === 'Transport' || error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)
          ? 'unavailable' : isConflictError(error) ? 'conflict' : 'configuration');
      console.info('ground_generation_native_outcome', { operation, status: failure.code }); throw failure;
    }
  }
  async function identity(signal: AbortSignal): Promise<void> {
    const info = await call('identity', signal, signal => client.server.info({ signal }));
    if (info.pid !== options.identity.pid || info.version !== options.identity.version) throw new GroundGenerationError('conflict');
  }
  function owner(attempt: GenerationAttempt) {
    return { owner: 'memory-loop', purpose: 'ground-generation', installationId: options.installationId, attemptId: attempt.attemptId };
  }
  function verify(attempt: GenerationAttempt, session: SessionInfo): void {
    const marker = session.metadata?.memoryLoop; const expected = owner(attempt); const selected = attempt.effective ?? attempt.requested;
    if (attempt.directory !== options.directory || session.id !== attempt.nativeSessionId || session.parentID != null || session.location.directory !== attempt.directory ||
        !marker || typeof marker !== 'object' || Array.isArray(marker) || Object.keys(marker).length !== Object.keys(expected).length ||
        !Object.entries(expected).every(([key, value]) => key in marker && marker[key] === value) ||
        session.permissions?.length !== 1 || session.permissions[0].action !== '*' || session.permissions[0].resource !== '*' || session.permissions[0].effect !== 'deny' ||
        (attempt.effective ? session.agent !== selected.agent || !sameModel(session.model, selected.model)
          // Native 2.2.2 defaults only an omitted requested variant; effective readback stays exact.
          : selected.agent !== undefined && session.agent !== selected.agent || selected.model !== undefined &&
            !sameModel(session.model, { ...selected.model, variant: selected.model.variant ?? 'default' }))) {
      throw new GroundGenerationError('conflict');
    }
  }
  async function session(attempt: GenerationAttempt, signal: AbortSignal): Promise<SessionInfo> {
    const value = await call('session-read', signal, signal => client.session.get({ sessionID: attempt.nativeSessionId }, { signal }));
    verify(attempt, value); return value;
  }
  return {
    async validate(signal) { await identity(signal); await call('selection', signal, signal => options.validateSelection(signal)); await identity(signal); },
    async create(attempt, signal) {
      await identity(signal);
      const created = await call('create', signal, signal => client.session.create({ id: attempt.nativeSessionId, location: { directory: attempt.directory },
        ...attempt.requested, permissions: denied, metadata: { memoryLoop: owner(attempt) } }, { signal }));
      verify(attempt, created);
      const readback = await session(attempt, signal); await identity(signal);
      return { ...(readback.agent ? { agent: readback.agent } : {}), ...(readback.model ? { model: { ...readback.model } } : {}) };
    },
    async prompt(attempt, text, signal) {
      await identity(signal); await session(attempt, signal);
      const admitted = await call('prompt', signal, signal => client.session.prompt({ sessionID: attempt.nativeSessionId, id: attempt.nativeMessageId, text }, { signal }));
      if (admitted.id !== attempt.nativeMessageId || admitted.sessionID !== attempt.nativeSessionId || admitted.type !== 'user') throw new Error('generation admission unconfirmed');
      await identity(signal);
    },
    async observe(attempt, signal) {
      await identity(signal); await session(attempt, signal);
      const inbox = await call('inbox', signal, signal => client.session.inbox.list({ sessionID: attempt.nativeSessionId }, { signal }));
      if (inbox.some(item => item.type === 'user' && (item.sessionID !== attempt.nativeSessionId || item.id !== attempt.nativeMessageId))) throw new GroundGenerationError('conflict');
      let admitted = inbox.some(item => item.type === 'user' && item.sessionID === attempt.nativeSessionId && item.id === attempt.nativeMessageId);
      let complete = false; let anchored = false; let cursor: string | undefined;
      let candidate: GenerationCandidate | undefined; let finalCount = 0;
      const seen = new Set<string>();
      for (let pages = 0; pages < 8; pages++) {
        const page = await call('history', signal, signal => client.message.list(cursor
          ? { sessionID: attempt.nativeSessionId, cursor, limit: 50 }
          : { sessionID: attempt.nativeSessionId, order: 'asc', limit: 50 }, { signal }));
        if (page.data.length > 50) throw new Error('generation history bound');
        for (const message of page.data) {
          if (seen.has(message.id)) throw new Error('generation repeated history'); seen.add(message.id);
          if (message.type === 'user') {
            if (message.id !== attempt.nativeMessageId || Buffer.byteLength(message.text) > questionResponseLimit || questionDigest(message.text) !== attempt.inputSha256 ||
                message.files?.length || message.agents?.length || message.skills?.length) throw new GroundGenerationError('conflict');
            admitted = true; anchored = true;
          } else if (anchored && message.type === 'assistant') {
            const selected = attempt.effective ?? attempt.requested;
            if (selected.agent !== undefined && message.agent !== selected.agent || selected.model !== undefined && !sameModel(message.model, selected.model)) throw new GroundGenerationError('conflict');
            complete = false; candidate = undefined;
            if (message.time.completed !== undefined && message.finish !== 'tool-calls') {
              complete = true; finalCount++;
              if (finalCount === 1 && message.finish === 'stop' && !message.error && message.content.length <= 256 &&
                  message.content.every(part => part.type === 'text' || part.type === 'reasoning')) {
                let text = ''; let size = 0;
                for (const part of message.content) if (part.type === 'text') {
                  size += Buffer.byteLength(part.text); if (size > questionResponseLimit) break; text += part.text;
                }
                if (size <= questionResponseLimit) candidate = { messageId: message.id, sha256: questionDigest(text), text };
              }
            }
          } else if (anchored && message.type === 'idle' && message.outcome !== 'succeeded') {
            complete = true; candidate = undefined;
          }
        }
        const next = page.cursor.next;
        if (!next) { cursor = undefined; break; }
        if (next === cursor) throw new Error('generation repeated cursor'); cursor = next;
      }
      if (cursor) throw new Error('generation history bound');
      await session(attempt, signal); await identity(signal);
      return { admitted, complete, ...(candidate ? { candidate } : {}) };
    },
  };
}
