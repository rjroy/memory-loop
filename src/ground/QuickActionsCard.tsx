'use client';

import { useRef } from 'react';
import { useGround } from './presentation';
import { CardContent } from './GroundCard';
import { useThinkSession } from '../think/presentation';
import HandoffNotice from './HandoffNotice';

export default function QuickActionsCard() {
  const { state, retry } = useGround();
  const { session, state: think } = useThinkSession();
  const trigger = useRef<HTMLButtonElement | null>(null);
  return <section className="ground-card ground-quick-actions" aria-labelledby="ground-actions-heading" aria-busy={state.quickActions.loading}>
    <h2 id="ground-actions-heading" tabIndex={-1}>Quick Actions</h2>
    <CardContent name="Quick Actions" empty="No quick actions yet." card={state.quickActions} retry={() => retry('quickActions')}>
      {read => <div className="ground-action-strip">{read.data.actions.map(action => <button key={action.id} type="button" className="ground-skill-action"
        aria-disabled={!!think.handoff || undefined} onClick={event => {
          if (think.handoff) return;
          trigger.current = event.currentTarget;
          session.requestHandoff({ kind: 'fresh-prefill', text: action.skill, source: 'quickActions', triggerId: action.id });
        }}><span>{action.description}</span><span className="ground-skill-ref">{action.skill}</span></button>)}</div>}
    </CardContent>
    <HandoffNotice source="quickActions" trigger={trigger} />
  </section>;
}
