'use client';

import { useRef } from 'react';
import { useGround } from './presentation';
import { CardContent } from './GroundCard';
import { useThinkSession } from '../think/presentation';
import HandoffNotice from './HandoffNotice';

const unavailable = { recovering: 'Opening is temporarily unavailable.', unavailable: 'Conversation unavailable.', deleting: 'Conversation unavailable.' };
export default function RecentConversationsCard() {
  const { state, retry } = useGround();
  const { session, state: think } = useThinkSession();
  const trigger = useRef<HTMLAnchorElement | null>(null);
  const targetTitle = useRef('Untitled conversation');
  return <section className="ground-card ground-conversations" aria-labelledby="ground-conversations-heading" aria-busy={state.conversations.loading}>
    <h2 id="ground-conversations-heading" tabIndex={-1}>Recent conversations</h2>
    <CardContent name="Recent conversations" empty="No recent conversations yet." card={state.conversations} retry={() => retry('conversations')}>
      {read => read.items.length ? <ol className="ground-conversation-list">{read.items.map(item => <li key={item.conversationId} className="ground-conversation-row">
        <div><p className="ground-conversation-title">{item.title ?? 'Untitled conversation'}</p>
          <time className="ground-conversation-time" dateTime={item.lastActivityAt}>{new Date(item.lastActivityAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
          {item.delete.reason === 'current' && <span className="ground-conversation-current">Current in Think</span>}
        </div>
        {item.resume.available ? <a className="ground-resume-link" href={`/think?${new URLSearchParams({ conversation: item.conversationId })}`}
          aria-label={`Resume ${item.title ?? 'Untitled conversation'}`} aria-disabled={!!think.handoff || undefined}
          onClick={event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (think.handoff) return;
            trigger.current = event.currentTarget;
            targetTitle.current = item.title ?? 'Untitled conversation';
            session.requestHandoff({ kind: 'resume', conversationId: item.conversationId, source: 'conversations', triggerId: item.conversationId });
          }}>Resume</a> : <span className="ground-conversation-unavailable">{unavailable[item.resume.reason ?? 'unavailable']}</span>}
        {think.handoff?.source === 'conversations' && think.handoff.triggerId === item.conversationId && <HandoffNotice source="conversations" trigger={trigger} conversationTitle={targetTitle.current} />}
      </li>)}</ol> : <p>No recent conversations yet.</p>}
    </CardContent>
    {think.handoff?.source === 'conversations' && !(state.conversations.read?.state === 'ready' && state.conversations.read.items.some(item => item.conversationId === think.handoff?.triggerId)) && <HandoffNotice source="conversations" trigger={trigger} conversationTitle={targetTitle.current} />}
  </section>;
}
