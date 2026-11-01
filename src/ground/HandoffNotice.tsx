'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useThinkSession } from '../think/presentation';
import type { ThinkHandoffSource } from '../think/types';

export default function HandoffNotice({ source, trigger, conversationTitle }: { source: ThinkHandoffSource; trigger: RefObject<HTMLElement | null>; conversationTitle?: string }) {
  const { session, state } = useThinkSession();
  const cancel = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const handoff = state.handoff?.source === source ? state.handoff : null;
  useLayoutEffect(() => {
    if (handoff?.phase === 'confirm') cancel.current?.focus();
    // Keep row-local feedback visible at enlarged text without taking focus or
    // moving the page after the user has left this action's trigger/controls.
    if (source === 'conversations' && handoff && (document.activeElement === trigger.current || notice.current?.contains(document.activeElement))) {
      notice.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [handoff?.phase, source, trigger]);
  if (!handoff) return null;
  const dismiss = () => {
    session.cancelHandoff();
    const target = trigger.current?.isConnected ? trigger.current : document.getElementById(source === 'quickActions' ? 'ground-actions-heading' : source === 'prompts' ? 'ground-prompts-heading' : 'ground-conversations-heading');
    target?.focus();
  };
  const confirming = handoff.phase === 'confirm' || handoff.phase === 'stale';
  const resuming = handoff.kind === 'resume';
  const namedTarget = resuming && conversationTitle ? `“${conversationTitle}”` : null;
  const question = handoff.phase === 'stale' ? 'Chat prepared. Open it without changing your other draft?'
    : namedTarget ? `Open ${namedTarget}? Your other draft stays.`
    : resuming ? 'Open this conversation? Your draft stays in the current chat.' : 'Start a new chat? Your draft stays in the current chat.';
  const status = handoff.phase === 'starting'
    ? namedTarget ? `Opening ${namedTarget}…` : resuming ? 'Opening conversation…' : 'Starting chat…'
    : handoff.phase === 'checking' ? namedTarget ? `Checking ${namedTarget}…` : 'Checking chat…'
    : namedTarget ? `Couldn’t open ${namedTarget}.` : resuming ? 'Conversation couldn’t be opened.' : 'Chat couldn’t be started.';
  return <div ref={notice} className="ground-handoff" role="group" aria-label={resuming ? 'Open conversation' : 'Start new chat'} onKeyDown={event => {
    if (event.key === 'Escape' && confirming) { event.preventDefault(); dismiss(); }
  }}>
    {confirming ? <>
      {namedTarget && handoff.phase === 'stale' && <p>{namedTarget}</p>}
      <p>{question}</p>
      <div className="ground-confirmation-actions"><button ref={cancel} className="ground-button" type="button" onClick={dismiss}>Cancel</button>
        <button className="ground-button" type="button" onClick={() => session.confirmHandoff()}>{resuming ? 'Open conversation' : handoff.phase === 'stale' ? 'Open chat' : 'Start new chat'}</button></div>
    </> : <>
      <p role="status">{status}</p>
      {handoff.canCheck && (handoff.phase === 'unavailable' || handoff.phase === 'rejected') && <button type="button" className="ground-button" onClick={() => session.checkHandoff()}>Check chat</button>}
      {handoff.phase === 'rejected' && <button type="button" className="ground-button" onClick={dismiss}>Cancel</button>}
    </>}
  </div>;
}
