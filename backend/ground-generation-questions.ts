import { createHash } from 'node:crypto';
import { parseGroundCollection } from './ground-parsers';

export const questionResourceLimit = 65536;
export const questionResponseLimit = 1024 * 1024;
export const questionDigest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const normalize = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
const comparisonKey = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const serialize = (texts: readonly string[]) => `# Questions\n\n${texts.map(text => `## Question\n${text}\n`).join('\n')}`;
function invalid(): never { throw new Error('invalid question candidate'); }

/** Validate the entire response, not a substring, repaired JSON or a truncated batch. */
export function questionCandidates(source: string, count: number): Array<{ text: string }> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 50 || Buffer.byteLength(source) > questionResponseLimit) return invalid();
  const value: unknown = JSON.parse(source);
  if (!Array.isArray(value) || value.length > count) return invalid();
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 1 || !('text' in item) || typeof item.text !== 'string' ||
        Buffer.byteLength(item.text) > 2048 || Buffer.from(item.text).toString('utf8') !== item.text) return invalid();
    const parsed = parseGroundCollection('prompts', `## Question\n${item.text}\n`);
    if (parsed.state !== 'ready' || parsed.items.length !== 1) return invalid();
    const text = normalize(parsed.items[0].text);
    const checked = parseGroundCollection('prompts', serialize([text]));
    if (checked.state !== 'ready' || checked.items.length !== 1 || checked.items[0].text !== text) return invalid();
    return { text };
  });
}

/** No new unique question means no canonicalization/rewrite of an otherwise valid file. */
export function mergeQuestions(source: string | null, candidates: readonly { text: string }[]): { output: string | null; writeRequired: boolean } {
  const parsed = parseGroundCollection('prompts', source ?? '');
  if (parsed.state === 'malformed') throw new Error('invalid question resource');
  const existing = parsed.state === 'ready' ? parsed.items.map(item => item.text) : [];
  const seen = new Set(existing.map(comparisonKey)); const added: string[] = [];
  for (const candidate of candidates) {
    const key = comparisonKey(candidate.text);
    if (!seen.has(key)) { seen.add(key); added.push(candidate.text); }
  }
  if (!added.length) return { output: source, writeRequired: false };
  const texts = [...existing, ...added].slice(-50);
  const output = serialize(texts);
  if (Buffer.byteLength(output) > questionResourceLimit) return invalid();
  const checked = parseGroundCollection('prompts', output);
  if (checked.state !== 'ready' || JSON.stringify(checked.items.map(item => item.text)) !== JSON.stringify(texts)) return invalid();
  return { output, writeRequired: output !== source };
}
