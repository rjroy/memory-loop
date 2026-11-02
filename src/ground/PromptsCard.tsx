'use client';

import { useRef } from 'react';
import { useGround } from './presentation';
import { CardContent } from './GroundCard';
import { useThinkSession } from '../think/presentation';
import HandoffNotice from './HandoffNotice';

export default function PromptsCard() {
  const { state, retry } = useGround();
  const { session, state: think } = useThinkSession();
  const trigger = useRef<HTMLButtonElement | null>(null);
  return <section className="ground-card ground-prompts" aria-labelledby="ground-prompts-heading" aria-busy={state.prompts.loading}>
    <h2 id="ground-prompts-heading" tabIndex={-1}>Prompts</h2>
    <CardContent name="Prompts" empty="No questions yet." card={state.prompts} retry={() => retry('prompts')}>
      {read => <button className="ground-question-action" type="button" aria-disabled={!!think.handoff || undefined} onClick={event => {
        if (think.handoff) return;
        trigger.current = event.currentTarget;
        session.requestHandoff({ kind: 'fresh-prefill', text: read.data.question.text, source: 'prompts', triggerId: read.data.question.id });
      }}><span>{read.data.question.text}</span><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 12h17m-6-6 6 6-6 6" /></svg></button>}
    </CardContent>
    <HandoffNotice source="prompts" trigger={trigger} />
  </section>;
}
