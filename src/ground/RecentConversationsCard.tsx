'use client';

import { useRef } from 'react';
import { useGround } from './presentation';
import { CardContent } from './GroundCard';
import { useThinkSession } from '../think/presentation';
import HandoffNotice from './HandoffNotice';
import DeleteNotice from './DeleteNotice';
import type { RecentConversation } from '../../backend/think/contract';

const unavailable = { recovering: 'Opening is temporarily unavailable.', unavailable: 'Conversation unavailable.', deleting: 'Conversation unavailable.' };
const deleteReasons = { current: 'Current in Think', selected_elsewhere: 'Open in Think elsewhere.', running: 'Work in progress.', status_unknown: 'Work status unavailable.', deleting: 'Deletion not complete.' };
export default function RecentConversationsCard() {
  const { state, retry, session: ground } = useGround();
  const { session, state: think } = useThinkSession();
  const trigger = useRef<HTMLAnchorElement | null>(null);
  const targetTitle = useRef('Untitled conversation');
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const deleting = state.deletion && state.deletion.phase !== 'completed' ? state.deletion : null;
  const current = (id: string) => think.identity?.conversationId === id || think.view.selection?.conversationId === id;
  const reason = (item: RecentConversation) => current(item.conversationId) ? 'current'
    : state.conversations.loading || state.conversations.failed || item.state !== 'ready' ? 'status_unknown'
    : !item.delete.available ? item.delete.reason ?? 'status_unknown'
    : think.view.status !== 'ready' || !think.view.token ? 'status_unknown' : undefined;
  const completionFocus = (row: HTMLElement) => () => {
    if (!row.isConnected || !row.contains(document.activeElement)) return;
    const next = row.nextElementSibling?.querySelector<HTMLElement>('.ground-resume-link:not([aria-disabled="true"])')
      ?? row.previousElementSibling?.querySelector<HTMLElement>('.ground-resume-link:not([aria-disabled="true"])')
      ?? document.getElementById('ground-conversations-heading');
    next?.focus();
  };
  return <section className="ground-card ground-conversations" aria-labelledby="ground-conversations-heading" aria-busy={state.conversations.loading}>
    <h2 id="ground-conversations-heading" tabIndex={-1}>Recent conversations</h2>
    {state.deletion?.phase === 'completed' && <p role="status">Conversation and transcript deleted.</p>}
    <CardContent name="Recent conversations" empty="No recent conversations yet." card={state.conversations} retry={() => retry('conversations')}>
      {read => read.items.length ? <ol className="ground-conversation-list">{read.items.map(item => {
        const blockedReason = reason(item);
        const activeDeletion = deleting?.conversationId === item.conversationId;
        const resumeBlocked = !!think.handoff || activeDeletion || deleting?.phase === 'confirm' || deleting?.phase === 'preparing';
        const deleteBusy = !!deleting && (!activeDeletion || deleting.phase !== 'confirm' && deleting.phase !== 'refused');
        return <li key={item.conversationId} id={`ground-conversation-${item.conversationId}`} className="ground-conversation-row">
        <div><p className="ground-conversation-title">{item.title ?? 'Untitled conversation'}</p>
          <time className="ground-conversation-time" dateTime={item.lastActivityAt}>{new Date(item.lastActivityAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          {(current(item.conversationId) || item.delete.reason === 'current') && <span id={`ground-delete-reason-${item.conversationId}`} className="ground-conversation-current">Current in Think</span>}
        </div>
        <div className="ground-conversation-actions">
        {item.resume.available ? <a className="ground-resume-link" href={`/think?${new URLSearchParams({ conversation: item.conversationId })}`}
          aria-label={`Resume ${item.title ?? 'Untitled conversation'}`} aria-disabled={resumeBlocked || undefined}
          onClick={event => {
            if (activeDeletion || deleting?.phase === 'confirm' || deleting?.phase === 'preparing') { event.preventDefault(); return; }
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (think.handoff) return;
            trigger.current = event.currentTarget;
            targetTitle.current = item.title ?? 'Untitled conversation';
            session.requestHandoff({ kind: 'resume', conversationId: item.conversationId, source: 'conversations', triggerId: item.conversationId });
          }}>Resume</a> : <span id={blockedReason === 'status_unknown' ? `ground-delete-reason-${item.conversationId}` : undefined} className="ground-conversation-unavailable">{unavailable[item.resume.reason ?? 'unavailable']}</span>}
          <button type="button" className="ground-delete-action" aria-label={`Delete ${item.title ?? 'Untitled conversation'}`}
            disabled={!!blockedReason || deleteBusy || !!think.handoff}
            aria-describedby={blockedReason ? `ground-delete-reason-${item.conversationId}` : undefined}
            onClick={event => {
              deleteTrigger.current = event.currentTarget;
              const row = event.currentTarget.closest('li');
              if (row) ground.requestDeletion(item, completionFocus(row));
            }}>Delete</button>
        </div>
        {blockedReason && blockedReason !== 'current' && (item.resume.available || blockedReason !== 'status_unknown') && <span id={`ground-delete-reason-${item.conversationId}`} className="ground-delete-reason">{deleteReasons[blockedReason]}</span>}
        {think.handoff?.source === 'conversations' && think.handoff.triggerId === item.conversationId && <HandoffNotice source="conversations" trigger={trigger} conversationTitle={targetTitle.current} />}
        {activeDeletion && <DeleteNotice trigger={deleteTrigger} blocked={!!blockedReason || !!think.handoff} onComplete={() => {
          const row = document.getElementById(`ground-conversation-${item.conversationId}`);
          if (row) completionFocus(row)();
        }} />}
      </li>; })}</ol> : <p>No recent conversations yet.</p>}
    </CardContent>
    {think.handoff?.source === 'conversations' && !(state.conversations.read?.state === 'ready' && state.conversations.read.items.some(item => item.conversationId === think.handoff?.triggerId)) && <HandoffNotice source="conversations" trigger={trigger} conversationTitle={targetTitle.current} />}
    {deleting && !(state.conversations.read?.state === 'ready' && state.conversations.read.items.some(item => item.conversationId === deleting.conversationId)) && <DeleteNotice trigger={deleteTrigger} blocked onComplete={() => document.getElementById('ground-conversations-heading')?.focus()} />}
  </section>;
}
