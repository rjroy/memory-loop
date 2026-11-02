'use client';

import { useGround } from './presentation';
import { CardContent } from './GroundCard';

export default function InspirationCard() {
  const { state, retry } = useGround();
  return <section className="ground-card ground-inspiration" aria-labelledby="ground-inspiration-heading" aria-busy={state.inspiration.loading}>
    <h2 id="ground-inspiration-heading" tabIndex={-1}>Inspiration</h2>
    <CardContent name="Inspiration" empty="No inspiration yet." card={state.inspiration} retry={() => retry('inspiration')}>
      {read => <figure className="ground-quotation"><blockquote><p>{read.data.quote.text}</p></blockquote>
        <figcaption><span>{read.data.quote.attribution}</span>{read.data.quote.source && <span className="ground-quote-source">{read.data.quote.source.url
          ? <a href={read.data.quote.source.url} target="_blank" rel="noopener noreferrer">{read.data.quote.source.title}<span className="visually-hidden"> (opens in a new tab)</span></a>
          : read.data.quote.source.title}</span>}</figcaption></figure>}
    </CardContent>
  </section>;
}
