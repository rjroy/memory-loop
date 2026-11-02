'use client';

import { Component, type MouseEvent, type ReactNode } from 'react';
import type { GroundIssueCode } from '../../backend/ground-contract';
import type { CardRead } from './session';

export class CardBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { console.warn('ground_card_render_failure', { card: this.props.name }); }
  render() {
    return this.state.failed ? <section className="ground-card"><h2>{this.props.name}</h2><p>This card couldn’t be displayed.</p>
      <button type="button" className="ground-button" onClick={() => this.setState({ failed: false })}>Try again</button></section> : this.props.children;
  }
}

type ReadState = { state: string; noteId?: string[]; issue?: { code: GroundIssueCode | 'source_coverage'; line?: number } };
const guidance: Record<GroundIssueCode | 'source_coverage', string> = {
  invalid_utf8: 'Save the file as UTF-8.', too_large: 'The file exceeds the supported size.',
  invalid_format: 'Check the file’s entry format.', too_many_entries: 'Keep the collection to at most 50 entries.',
  source_coverage: 'Some capture sources couldn’t be read.',
};

export function CardContent<T extends ReadState>({ name, empty, card, retry, children, missing = `${name} file not found.` }: {
  name: string; empty: string; card: CardRead<T>; retry(): void; children(read: Extract<T, { state: 'ready' }>): ReactNode; missing?: string;
}) {
  const { read, loading, failed } = card;
  const recover = (event: MouseEvent<HTMLButtonElement>) => {
    // The recovery control can disappear during its read; keep keyboard context
    // on the stable named section rather than dropping focus to the document.
    event.currentTarget.closest('section')?.querySelector('h2')?.focus({ preventScroll: true });
    retry();
  };
  if (read?.state === 'ready') return <>
    {children(read as Extract<T, { state: 'ready' }>)}
    {failed && <div className="ground-local-state" role="status"><p>Couldn’t update. Showing the previous version.</p><button type="button" className="ground-button" onClick={recover}>Retry</button></div>}
  </>;
  if (loading) return <p>Loading…</p>;
  if (read?.state === 'empty') return <p>{empty}</p>;
  const invalid = read?.state === 'malformed';
  const absent = read?.state === 'missing';
  const message = absent ? missing : invalid ? `${name} couldn’t be read.` : `${name} couldn’t be loaded.`;
  return <div className="ground-local-state">
    <p>{message}</p>
    {(absent || invalid) && read?.noteId && <p className="ground-resource-path">{read.noteId.join('/')}</p>}
    {invalid && read?.issue && <p className="ground-guidance">{guidance[read.issue.code]}{read.issue.line ? ` Line ${read.issue.line}.` : ''}</p>}
    <button type="button" className="ground-button" onClick={recover}>{absent || invalid ? 'Check again' : 'Retry'}</button>
  </div>;
}
