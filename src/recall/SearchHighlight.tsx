import type { ReactNode } from 'react';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export default function SearchHighlight({ text, positions }: { text: string; positions: readonly number[] }) {
  const ranges: { start: number; end: number }[] = [];
  let offset = 0;
  for (const part of graphemes.segment(text)) {
    const start = part.index, end = start + part.segment.length;
    while (offset < positions.length && positions[offset] < start) offset++;
    if (offset < positions.length && positions[offset] < end) {
      const last = ranges.at(-1);
      if (last?.end === start) last.end = end; else ranges.push({ start, end });
    }
  }
  const nodes: ReactNode[] = [];
  let start = 0;
  for (const range of ranges) {
    nodes.push(text.slice(start, range.start), <mark key={range.start}>{text.slice(range.start, range.end)}</mark>);
    start = range.end;
  }
  nodes.push(text.slice(start));
  return <>{nodes}</>;
}
