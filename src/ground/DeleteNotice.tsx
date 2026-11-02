'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useGround } from './presentation';

export default function DeleteNotice({ trigger, blocked, onComplete }: { trigger: RefObject<HTMLElement | null>; blocked: boolean; onComplete(): void }) {
  const { state, session } = useGround();
  const deletion = state.deletion;
  const notice = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (deletion?.phase === 'confirm') cancel.current?.focus();
    if (deletion && (document.activeElement === trigger.current || notice.current?.contains(document.activeElement))) notice.current?.scrollIntoView?.({ block: 'nearest' });
  }, [deletion?.phase, trigger]);
  if (!deletion || deletion.phase === 'completed') return null;
  const confirming = deletion.phase === 'confirm';
  const dismiss = () => {
    session.cancelDeletion();
    (trigger.current?.isConnected && !trigger.current.hasAttribute('disabled') ? trigger.current : document.getElementById('ground-conversations-heading'))?.focus();
  };
  const run = (action: () => Promise<void>) => {
    // Preserve a stable focus owner while the initiating button is replaced.
    notice.current?.focus({ preventScroll: true });
    void action();
  };
  let status = 'Deletion isn’t complete.';
  if (deletion.phase === 'preparing') status = 'Checking availability…';
  else if (deletion.phase === 'posting') status = 'Deleting…';
  else if (deletion.phase === 'checking') status = 'Checking status…';
  else if (deletion.phase === 'unconfirmed') status = 'Deletion unconfirmed.';
  else if (deletion.phase === 'refused') status = deletion.reason === 'running' ? 'Cannot delete now. Work in progress.'
    : deletion.reason === 'current' || deletion.reason === 'selected_elsewhere' ? 'Cannot delete a conversation open in Think.' : 'Cannot delete now. Availability is unknown.';
  else if (deletion.reason === 'conflict') status = 'Deletion isn’t complete. Transcript file changed.';
  else if (deletion.reason === 'io_unavailable') status = 'Deletion isn’t complete. File access unavailable.';
  return <div ref={notice} className="ground-delete-notice" role="group" aria-label={`Delete ${deletion.title}`} tabIndex={-1}
    onKeyDown={event => { if (event.key === 'Escape' && (confirming || deletion.phase === 'refused')) { event.preventDefault(); dismiss(); } }}>
    <p className="ground-delete-target">{confirming ? `Delete “${deletion.title}”?` : `“${deletion.title}”`}</p>
    <p role={confirming ? undefined : 'status'}>{confirming ? 'Chat and transcript file. No undo.' : status}</p>
    <div className="ground-confirmation-actions">
      {confirming ? <>
        <button ref={cancel} type="button" className="ground-button" onClick={dismiss}>Cancel</button>
        <button type="button" className="ground-button ground-delete-confirm" disabled={blocked} onClick={() => run(session.confirmDeletion)}>Delete conversation</button>
      </> : deletion.phase === 'refused' ? <button type="button" className="ground-button" onClick={dismiss}>Close</button>
        : (deletion.phase === 'pending' || deletion.phase === 'unconfirmed') && <button type="button" className="ground-button" onClick={() => run(() => session.checkDeletion(() => {
          if (notice.current?.isConnected && notice.current.contains(document.activeElement)) onComplete();
        }))}>Check status</button>}
    </div>
  </div>;
}
