import type { GroundQuote } from './ground-contract';
import { parseGroundCollection } from './ground-parsers';
import { questionResourceLimit, questionResponseLimit } from './ground-generation-questions';

export interface QuoteCandidate { text: string; attribution: string }
const comparison = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const key = (quote: QuoteCandidate) => JSON.stringify([comparison(quote.text), comparison(quote.attribution)]);
const serialize = (quotes: readonly Pick<GroundQuote, 'text' | 'attribution' | 'source'>[]) => '# Inspiration\n\n' + quotes.map(quote =>
  `## Quote\n${quote.text.split('\n').map(line => line ? `> ${line}` : '>').join('\n')}\n\nAttribution: ${quote.attribution}\n` +
  (quote.source ? `Source: ${quote.source.url ? `[${quote.source.title}](${quote.source.url})` : quote.source.title}\n` : '')).join('\n');
function invalid(): never { throw new Error('invalid quote candidate'); }

/** Structural validation only: attribution is supplied by the configured model, not fact-checked. */
export function quoteCandidates(source: string, count: number): QuoteCandidate[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 50 || Buffer.byteLength(source) > questionResponseLimit) return invalid();
  const value: unknown = JSON.parse(source);
  if (!Array.isArray(value) || value.length > count) return invalid();
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'attribution,text' ||
        !('text' in item) || typeof item.text !== 'string' || !('attribution' in item) || typeof item.attribution !== 'string' ||
        !item.text.trim() || !item.attribution.trim() || Buffer.byteLength(item.text) > 4096 || Buffer.byteLength(item.attribution) > 256 ||
        /[\r\n]/.test(item.attribution) || Buffer.from(item.text).toString('utf8') !== item.text || Buffer.from(item.attribution).toString('utf8') !== item.attribution) return invalid();
    const candidate = { text: item.text.normalize('NFC').replace(/\r\n?/g, '\n').trim(),
      attribution: item.attribution.normalize('NFC').replace(/\s+/gu, ' ').trim() };
    const parsed = parseGroundCollection('inspiration', serialize([candidate]));
    if (parsed.state !== 'ready' || parsed.items.length !== 1 || parsed.items[0].text !== candidate.text || parsed.items[0].attribution !== candidate.attribution ||
        Buffer.byteLength(candidate.text) > 4096 || Buffer.byteLength(candidate.attribution) > 256) return invalid();
    return candidate;
  });
}

export function mergeQuotes(source: string | null, candidates: readonly QuoteCandidate[]): { output: string | null; writeRequired: boolean } {
  const parsed = parseGroundCollection('inspiration', source ?? '');
  if (parsed.state === 'malformed') throw new Error('invalid quote resource');
  const existing = parsed.state === 'ready' ? parsed.items : [];
  const seen = new Set(existing.map(key)); const added: QuoteCandidate[] = [];
  for (const candidate of candidates) {
    const identity = key(candidate);
    if (!seen.has(identity)) { seen.add(identity); added.push(candidate); }
  }
  if (!added.length) return { output: source, writeRequired: false };
  const quotes = [...existing, ...added].slice(-50);
  const output = serialize(quotes);
  if (Buffer.byteLength(output) > questionResourceLimit) return invalid();
  const checked = parseGroundCollection('inspiration', output);
  const content = (quote: Pick<GroundQuote, 'text' | 'attribution' | 'source'>) => ({ text: quote.text, attribution: quote.attribution, ...(quote.source ? { source: quote.source } : {}) });
  if (checked.state !== 'ready' || JSON.stringify(checked.items.map(content)) !== JSON.stringify(quotes.map(content))) return invalid();
  return { output, writeRequired: output !== source };
}
