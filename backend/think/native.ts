import { OpenCode } from '@opencode/client';
import type { EventSubscribeInput, MessageListInput, MessageListOutput, OpenCodeEvent, SessionActiveOutput, SessionCreateInput, SessionGetInput, SessionInfo, SessionPromptInput, SessionPromptOutput, SessionInboxListInput, SessionInboxListOutput, SessionInboxCancelInput, SessionInboxCancelOutput, SessionInterruptInput, SessionInterruptOutput } from '@opencode/client';
import type { OpenCodeClient, ServerInfo, SessionFormListInput, SessionFormListOutput, SessionFormGetInput, SessionFormGetOutput, SessionFormReplyInput, SessionFormReplyOutput, PermissionRequestListInput, PermissionRequestListOutput, SessionMessageGetInput, SessionMessageGetOutput } from '@opencode/client';
import type { SessionListInput, SessionListOutput, SessionRemoveInput } from '@opencode/client';

/** Keep DELETE out of Bun's transparent pooled-socket retries; other SDK requests stay unchanged. */
export function createNativeClient(options: Omit<OpenCode.ClientOptions, 'fetch'>): OpenCodeClient {
  const transport = globalThis.fetch;
  const sdkFetch = Object.assign(
    (input: Parameters<typeof transport>[0], init?: Parameters<typeof transport>[1]) =>
      transport(input, init?.method === 'DELETE' ? { ...init, keepalive: false, redirect: 'error' } : init),
    { preconnect: transport.preconnect },
  );
  return OpenCode.make({ ...options, fetch: sdkFetch });
}

/** Only the public session fields needed for ownership and creation readback. */
export type NativeSession = Pick<SessionInfo, 'id' | 'parentID' | 'metadata' | 'location' | 'permissions' | 'agent' | 'model'>;

export interface NativeSessions {
  createSession(input: SessionCreateInput, signal: AbortSignal): Promise<NativeSession>;
  getSession(input: SessionGetInput, signal: AbortSignal): Promise<NativeSession & Pick<SessionInfo, 'time' | 'outcome'>>;
  listSessions(input: SessionListInput, signal: AbortSignal): Promise<SessionListOutput>;
  removeSession(input: SessionRemoveInput, signal: AbortSignal): Promise<void>;
  subscribe(input: EventSubscribeInput, signal: AbortSignal): AsyncIterable<OpenCodeEvent>;
  prompt(input: SessionPromptInput, signal: AbortSignal): Promise<SessionPromptOutput>;
  listInbox(input: SessionInboxListInput, signal: AbortSignal): Promise<SessionInboxListOutput>;
  cancelInbox(input: SessionInboxCancelInput, signal: AbortSignal): Promise<SessionInboxCancelOutput>;
  interruptSession(input: SessionInterruptInput, signal: AbortSignal): Promise<SessionInterruptOutput>;
  activeSessions(signal: AbortSignal): Promise<SessionActiveOutput>;
  listMessages(input: MessageListInput, signal: AbortSignal): Promise<MessageListOutput>;
  getMessage(input: SessionMessageGetInput, signal: AbortSignal): Promise<SessionMessageGetOutput>;
  getServerInfo(signal: AbortSignal): Promise<ServerInfo>;
  listForms(input: SessionFormListInput, signal: AbortSignal): Promise<SessionFormListOutput>;
  getForm(input: SessionFormGetInput, signal: AbortSignal): Promise<SessionFormGetOutput>;
  replyForm(input: SessionFormReplyInput, signal: AbortSignal): Promise<SessionFormReplyOutput>;
  listPermissionRequests(input: PermissionRequestListInput, signal: AbortSignal): Promise<PermissionRequestListOutput>;
}

/** Adapt the public promise client; it already unwraps its RPC response envelopes. */
export function nativeSessions(client: OpenCodeClient): NativeSessions {
  return {
    createSession: (input, signal) => client.session.create(input, { signal }),
    getSession: (input, signal) => client.session.get(input, { signal }),
    listSessions: (input, signal) => client.session.list(input, { signal }),
    removeSession: (input, signal) => client.session.remove(input, { signal }),
    subscribe: (input, signal) => client.event.subscribe({ ...input, signal }),
    prompt: (input, signal) => client.session.prompt(input, { signal }),
    listInbox: (input, signal) => client.session.inbox.list(input, { signal }),
    cancelInbox: (input, signal) => client.session.inbox.cancel(input, { signal }),
    interruptSession: (input, signal) => client.session.interrupt(input, { signal }),
    activeSessions: signal => client.session.active({ signal }),
    listMessages: (input, signal) => client.message.list(input, { signal }),
    getMessage: (input, signal) => client.session.message.get(input, { signal }),
    getServerInfo: signal => client.server.info({ signal }),
    listForms: (input, signal) => client.session.form.list(input, { signal }),
    getForm: (input, signal) => client.session.form.get(input, { signal }),
    replyForm: (input, signal) => client.session.form.reply(input, { signal }),
    listPermissionRequests: (input, signal) => client.permission.request.list(input, { signal }),
  };
}
