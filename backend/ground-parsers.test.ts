import { describe, expect, it, vi } from 'vitest';
import { parseGroundCollection, weightedSelection } from './ground-parsers';

const question = (text: string) => `## Question\n${text}\n`;
const action = (skill: string, text: string) => `## @${skill}\n${text}\n`;
const quote = (text: string, source = 'Fixture publication') => `## Quote\n> ${text}\n\nAttribution: Fixture author\nSource: ${source}\n`;
const parse = (kind: 'quickActions' | 'inspiration' | 'prompts', source: string) => kind === 'quickActions'
  ? parseGroundCollection('quickActions', source) : kind === 'inspiration'
    ? parseGroundCollection('inspiration', source) : parseGroundCollection('prompts', source);

describe('weighted Ground selection', () => {
  it('covers both endpoints of every weight interval, including the fiftieth item', () => {
    const items = Array.from({ length: 50 }, (_, index) => `item-${index + 1}`);
    const total = 1275;
    let start = 0;
    for (let index = 0; index < items.length; index++) {
      const end = start + index;
      for (const choice of new Set([start, end])) {
        const draw = vi.fn(() => choice);
        expect(weightedSelection(items, draw)).toBe(items[index]);
        expect(draw).toHaveBeenCalledExactlyOnceWith(total);
      }
      start = end + 1;
    }
    expect(start).toBe(total);
  });
  it('does not draw for an empty collection and rejects out-of-range draws', () => {
    const draw = vi.fn(() => 0);
    expect(weightedSelection([], draw)).toBeUndefined();
    expect(draw).not.toHaveBeenCalled();
    for (const n of [-1, 1, 0.5, NaN]) expect(() => weightedSelection(['only'], () => n)).toThrow();
  });
});

describe('Ground collection formats', () => {
  it('normalizes BOM and CRLF, joins paragraphs, and preserves quote line breaks', () => {
    expect(parseGroundCollection('quickActions', '\uFEFF# Fixture\r\n\r\n## @a\r\nfirst\r\nsecond\r\n')).toEqual({ state: 'ready', items: [{ id: '@a', skill: '@a', description: 'first second' }] });
    expect(parseGroundCollection('inspiration', '\uFEFF# Fixture\r\n\r\n## Quote\r\n> first\r\n>\r\n> second\r\nAttribution: Fixture author\r\nSource: Fixture publication\r\n')).toMatchObject({ state: 'ready', items: [{ text: 'first\n\nsecond', attribution: 'Fixture author', source: { title: 'Fixture publication' } }] });
    expect(parseGroundCollection('prompts', '# Fixture\n\n')).toEqual({ state: 'empty' });
  });
  it.each([
    ['quickActions', (index: number) => action(`skill${index}`, 'description')],
    ['inspiration', (index: number) => quote(`Fictional fixture quote ${index}`)],
    ['prompts', (index: number) => question(`Fixture question ${index}`)],
  ] as const)('accepts 50 distinct %s entries and rejects a 51st', (kind, item) => {
    const fifty = Array.from({ length: 50 }, (_, index) => item(index)).join('\n');
    const parsed = parse(kind, fifty);
    if (parsed.state !== 'ready') throw new Error('Expected fixture collection');
    expect(parsed.items).toHaveLength(50);
    expect(parse(kind, `${fifty}\n${item(50)}`)).toMatchObject({ state: 'malformed', issue: { code: 'too_many_entries' } });
  });
  it.each([
    ['quickActions', `${action('same', 'one')}\n${action('same', 'two')}`],
    ['inspiration', `${quote('Fictional fixture quote')}\n${quote('Fictional fixture quote')}`],
    ['prompts', `${question('Fixture question')}\n${question('Fixture question')}`],
  ] as const)('rejects duplicate %s identities', (kind, source) => {
    expect(parse(kind, source)).toMatchObject({ state: 'malformed', issue: { code: 'invalid_format' } });
  });
  it('keeps canonical prompt and quote identities stable across collection reordering', () => {
    for (const [kind, first, second] of [
      ['prompts', question('First fixture'), question('Second fixture')],
      ['inspiration', quote('First fixture'), quote('Second fixture')],
    ] as const) {
      const a = parse(kind, `${first}\n${second}`);
      const b = parse(kind, `${second}\n${first}`);
      if (a.state !== 'ready' || b.state !== 'ready') throw new Error('Expected fixture collections');
      expect(a.items.map(item => item.id)).toEqual(b.items.map(item => item.id).reverse());
      expect(a.items[0].id).toMatch(/^[a-f0-9]{64}$/);
    }
  });
  it.each([
    '[fixture](javascript:alert)', '[fixture](ftp://example.test/path)', '[fixture](https://user:pass@example.test/path)',
    '[fixture](https://example.test/bad path)', '[fixture](https://example.test/\u0001)',
  ])('rejects unsafe or invalid source link %s', source => {
    expect(parseGroundCollection('inspiration', quote('Fictional fixture quote', source))).toMatchObject({ state: 'malformed', issue: { code: 'invalid_format' } });
  });
  it('accepts HTTP(S) and bibliographic sources without inventing a URL', () => {
    expect(parseGroundCollection('inspiration', quote('Fictional fixture quote', '[Fixture](https://example.test/entry)'))).toMatchObject({ state: 'ready', items: [{ source: { title: 'Fixture', url: 'https://example.test/entry' } }] });
    const bibliography = parseGroundCollection('inspiration', quote('Fictional fixture quote', 'Fixture publication (2026)'));
    expect(bibliography).toMatchObject({ state: 'ready', items: [{ source: { title: 'Fixture publication (2026)' } }] });
    if (bibliography.state === 'ready') expect(bibliography.items[0].source).not.toHaveProperty('url');
  });
  it.each([
    ['quickActions', (text: string) => action('fixture', text), 1024],
    ['prompts', (text: string) => question(text), 2048],
    ['inspiration', (text: string) => quote(text), 4096],
  ] as const)('bounds %s field lengths by UTF-8 bytes', (kind, wrap, limit) => {
    expect(parse(kind, wrap('é'.repeat(limit / 2)))).toMatchObject({ state: 'ready' });
    expect(parse(kind, wrap(`${'é'.repeat(limit / 2)}x`))).toMatchObject({ state: 'malformed', issue: { code: 'invalid_format' } });
  });
  it.each([
    ['quickActions', '## @fixture\nOne paragraph\n\nAnother paragraph'],
    ['prompts', '---\n## Question\nFixture'],
    ['prompts', '## Question\nFixture\n- nested item'],
    ['inspiration', '## Quote\n> fixture\nAttribution: Fixture\nSource: Fixture\n<!-- hidden -->'],
  ] as const)('rejects unexplained or nested %s content', (kind, source) => {
    expect(parse(kind, source)).toMatchObject({ state: 'malformed', issue: { code: 'invalid_format' } });
  });
});
