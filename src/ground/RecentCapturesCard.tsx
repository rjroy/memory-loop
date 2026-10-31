'use client';

import { useGround } from './presentation';
import { CardContent } from './GroundCard';
import AppLink from '../shell/AppLink';
import { noteLocation } from '../recall/api';

/** Render the recorded wall clock, without inventing an offset or shifting zones. */
export function captureTimestamp(value: string): string { return `${value.slice(0, 10)} · ${value.slice(11)}`; }

export default function RecentCapturesCard() {
  const { state, retry } = useGround();
  return <section className="ground-card ground-captures" aria-labelledby="ground-captures-heading" aria-busy={state.captures.loading}>
    <h2 id="ground-captures-heading" tabIndex={-1}>Recent captures</h2>
    <CardContent name="Recent captures" empty="No captures yet." missing="Capture folder not found." card={state.captures} retry={() => retry('captures')}>
      {read => <>
        {read.coverage === 'partial' && <p className="ground-coverage" role="status">Some captures couldn’t be read.</p>}
        <ol className="ground-capture-list">{read.items.map(item => <li key={item.id}>
          <AppLink className="ground-capture-link" href={noteLocation(item.noteId)}>
            <span className="ground-capture-excerpt">{item.excerpt || 'Capture'}</span>
            <time className="ground-capture-time" dateTime={item.localDateTime}>{captureTimestamp(item.localDateTime)}</time>
            <span className="ground-capture-path">{item.noteId.join('/')}</span>
          </AppLink>
        </li>)}</ol>
      </>}
    </CardContent>
  </section>;
}
