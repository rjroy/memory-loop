'use client';

import { useGround } from './presentation';
import { CardContent } from './GroundCard';
import MarkdownDocument from '../recall/MarkdownDocument';

export default function GoalsCard() {
  const { state, retry } = useGround();
  return <section className="ground-card ground-goals" aria-labelledby="ground-goals-heading" aria-busy={state.goals.loading}>
    <h2 id="ground-goals-heading" tabIndex={-1}>Current Goals</h2>
    <CardContent name="Current Goals" empty="No goals written yet." missing="Goals file not found." card={state.goals} retry={() => retry('goals')}>
      {read => <MarkdownDocument markdown={read.data.markdown} headingStart={3} />}
    </CardContent>
  </section>;
}
