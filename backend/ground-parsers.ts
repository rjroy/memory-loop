import { createHash, randomInt } from 'node:crypto';
import type { GroundIssueCode, GroundQuestion, GroundQuote, QuickAction } from './ground-contract';

type Parse<T> = { state: 'ready'; items: T[] } | { state: 'empty' } | { state: 'malformed'; issue: { code: GroundIssueCode; line?: number } };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validText = (value: string, max: number) => !!value.trim() && Buffer.byteLength(value) <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) && !/<!--|-->|<\/?[A-Za-z][^>]*>|```|~~~/.test(value);
const plainLine = (line: string) => !/^\s*(?:#{1,6}(?:\s|$)|>|[-*+]\s|\d+[.)]\s|```|~~~|<|---\s*$)/.test(line);

/** The caller controls the random draw in deterministic selection tests. */
export function weightedSelection<T>(items: readonly T[], draw: (max: number) => number = randomInt): T | undefined {
  if (!items.length) return;
  const total = items.length * (items.length + 1) / 2;
  const selected = draw(total);
  if (!Number.isInteger(selected) || selected < 0 || selected >= total) throw new Error('Invalid selection draw');
  let cumulative = 0;
  for (let index = 0; index < items.length; index++) {
    cumulative += index + 1;
    if (selected < cumulative) return items[index];
  }
}

export function parseGroundCollection(kind: 'quickActions', source: string): Parse<QuickAction>;
export function parseGroundCollection(kind: 'inspiration', source: string): Parse<GroundQuote>;
export function parseGroundCollection(kind: 'prompts', source: string): Parse<GroundQuestion>;
export function parseGroundCollection(kind: 'quickActions' | 'inspiration' | 'prompts', source: string): Parse<QuickAction | GroundQuote | GroundQuestion> {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const fail = (line: number): Parse<never> => ({ state: 'malformed', issue: { code: 'invalid_format', line: line + 1 } });
  let i = 0;
  const blanks = () => { while (i < lines.length && !lines[i].trim()) i++; };
  blanks();
  if (/^# [^\n]+$/.test(lines[i] ?? '')) { i++; blanks(); }
  const items: Array<QuickAction | GroundQuote | GroundQuestion> = [];
  const ids = new Set<string>();
  while (i < lines.length) {
    const headingLine = i;
    const heading = lines[i++];
    let item: QuickAction | GroundQuote | GroundQuestion;
    if (kind === 'inspiration') {
      if (heading !== '## Quote') return fail(headingLine);
      blanks();
      const quote: string[] = [];
      while (i < lines.length && (lines[i] === '>' || lines[i].startsWith('> '))) quote.push(lines[i++] === '>' ? '' : lines[i - 1].slice(2));
      const text = quote.join('\n');
      if (!validText(text, 4096)) return fail(i);
      blanks();
      const attributionLine = lines[i++] ?? '';
      if (!attributionLine.startsWith('Attribution: ')) return fail(i - 1);
      const attribution = attributionLine.slice(13);
      if (!validText(attribution, 256)) return fail(i - 1);
      blanks();
      let citation: GroundQuote['source'];
      if (lines[i]?.startsWith('Source: ')) {
        const sourceText = lines[i++].slice(8);
        const link = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(sourceText);
        if (link) {
          try {
            const url = new URL(link[2]);
            if (!validText(link[1], 512) || Buffer.byteLength(link[2]) > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\x00-\x20\x7f]/.test(link[2])) return fail(i - 1);
            citation = { title: link[1], url: link[2] };
          } catch { return fail(i - 1); }
        } else {
          if (!validText(sourceText, 512) || sourceText.startsWith('[')) return fail(i - 1);
          citation = { title: sourceText };
        }
      }
      const canonical = { text, attribution, ...(citation === undefined ? {} : { source: citation }) };
      item = { id: hash(canonical), ...canonical };
    } else {
      const skill = kind === 'quickActions' ? /^## (@[A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(heading)?.[1] : undefined;
      if (kind === 'quickActions' ? !skill : heading !== '## Question') return fail(headingLine);
      blanks();
      const paragraph: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        if (!plainLine(lines[i])) return fail(i);
        paragraph.push(lines[i++].trim());
      }
      const text = paragraph.join(' ');
      if (!validText(text, kind === 'quickActions' ? 1024 : 2048)) return fail(i);
      item = kind === 'quickActions' && skill ? { id: skill, skill, description: text } : { id: hash({ text }), text };
    }
    if (ids.has(item.id)) return fail(headingLine);
    ids.add(item.id); items.push(item);
    if (items.length > 50) return { state: 'malformed', issue: { code: 'too_many_entries' } };
    blanks();
  }
  return items.length ? { state: 'ready', items } : { state: 'empty' };
}
