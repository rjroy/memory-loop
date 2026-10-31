'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useThinkSession } from '../think/presentation';
import type { ThinkHandoffSource } from '../think/types';

export default function HandoffNotice({ source, trigger }: { source: ThinkHandoffSource; trigger: RefObject<HTMLButtonElement | null> }) {
  const { session, state } = useThinkSession();
  const cancel = useRef<HTMLButtonElement>(null);
  const handoff = state.handoff?.source === source ? state.handoff : null;
  useLayoutEffect(() => {
    if (handoff?.phase === 'confirm') cancel.current?.focus();
  }, [handoff?.phase]);
  if (!handoff) return null;
  const dismiss = () => {
    session.cancelHandoff();
    const target = trigger.current?.isConnected ? trigger.current : document.getElementById(source === 'quickActions' ? 'ground-actions-heading' : 'ground-prompts-heading');
    target?.focus();
  };
  const confirming = handoff.phase === 'confirm' || handoff.phase === 'stale';
  return <div className="ground-handoff" role="group" aria-label="Start new chat" onKeyDown={event => {
    if (event.key === 'Escape' && confirming) { event.preventDefault(); dismiss(); }
  }}>
    {confirming ? <>
      <p>{handoff.phase === 'stale' ? 'Chat prepared. Open it without changing your other draft?' : 'Start a new chat? Your draft stays in the current chat.'}</p>
      <div className="ground-confirmation-actions"><button ref={cancel} className="ground-button" type="button" onClick={dismiss}>Cancel</button>
        <button className="ground-button" type="button" onClick={() => session.confirmHandoff()}>{handoff.phase === 'stale' ? 'Open chat' : 'Start new chat'}</button></div>
    </> : <>
      <p role="status">{handoff.phase === 'starting' ? 'Starting chat…' : handoff.phase === 'checking' ? 'Checking chat…' : 'Chat couldn’t be started.'}</p>
      {handoff.canCheck && (handoff.phase === 'unavailable' || handoff.phase === 'rejected') && <button type="button" className="ground-button" onClick={() => session.checkHandoff()}>Check chat</button>}
      {handoff.phase === 'rejected' && <button type="button" className="ground-button" onClick={dismiss}>Cancel</button>}
    </>}
  </div>;
}
