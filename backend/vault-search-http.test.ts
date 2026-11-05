import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app';
import { openVault, type VaultOptions, type VaultReader } from './vault';

const authority = '127.0.0.1:3001';
const token = 'a'.repeat(64);
let fixture: string;
let root: string;
let vault: VaultReader;
let app: ReturnType<typeof createApp>;

type Hit = { id: string[]; name: string; path: string; field: 'name' | 'path'; positions: number[]; line: number; version: string; score: number; snippets: Array<{ text: string; start: number; end: number; positions: number[] }> };
type Search = { mode: string; hits: Hit[]; counts: { matches: number; files: number }; limited: boolean; coverage: { complete: boolean; filesSearched: number; skippedFiles: { binary: number; invalidEncoding: number; unreadable: number; changed: number }; skippedLines: number; timedOut: boolean } };

// Structural options keep these tests loadable before the production hook fields exist.
type SearchHooks = VaultOptions & {
  onSearchFileOpened?: (id: string[], handle: FileHandle) => Promise<void>;
  onSearchChunk?: (id: string[]) => Promise<void>;
  searchNow?: () => number;
};
async function reopen(hooks: SearchHooks) {
  await vault.close();
  vault = await openVault(root, hooks);
  app = createApp({ authority, serviceToken: token, vault: { reader: vault } });
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'recall-search-'));
  root = join(fixture, 'vault');
  await mkdir(root);
  vault = await openVault(root);
  app = createApp({ authority, serviceToken: token, vault: { reader: vault } });
});
afterEach(async () => { try { await vault?.close(); } finally { await rm(fixture, { recursive: true, force: true }); } });

function post(path: string, body: unknown, signal?: AbortSignal) {
  return app(new Request(`http://${authority}${path}`, { method: 'POST', headers: { host: authority, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal }));
}
async function search(mode: 'filename' | 'content', query: string): Promise<Search> {
  const response = await post('/api/vault/search', { mode, query });
  expect(response.status).toBe(200);
  return response.json() as Promise<Search>;
}

describe('vault search daemon HTTP', () => {
  it('matches ordered characters per physical line, normalizes whitespace and retains UTF-16 positions', async () => {
    await writeFile(join(root, 'examples.md'), "software development kit\r\nI should know better\rI should've been there.\nKnowing what I know now I would've.\n😀 café sdk\nbar foo\nfoo bar");
    const result = await search('content', ' S d K ');
    expect(result.mode).toBe('content');
    expect(result.hits.map(hit => hit.line).sort((a, b) => a - b)).toEqual([1, 2, 5]);
    expect(result.counts).toEqual({ matches: 3, files: 1 });
    expect(result.coverage).toMatchObject({ complete: true, timedOut: false, skippedLines: 0 });
    const accent = await search('content', 'cafe');
    expect(accent.hits.map(hit => hit.line)).toEqual([5]);
    const ordered = await search('content', 'foo bar');
    expect(ordered.hits.map(hit => hit.line)).toEqual([7]);
    const hit = result.hits.find(item => item.line === 5);
    if (!hit) throw new Error('missing UTF-16 fixture hit');
    const source = '😀 café sdk';
    const offsets = hit.snippets.flatMap(snippet => {
      expect(snippet.text).toBe(source.slice(snippet.start, snippet.end));
      return snippet.positions.map(position => snippet.start + position);
    });
    expect(offsets.map(offset => source[offset]).join('').toLowerCase()).toBe('sdk');
    expect(hit?.version).toEqual(expect.any(String));
  });

  it('ranks basename before path-only hits and includes visible binary names, not symlinks or dot entries', async () => {
    await mkdir(join(root, 'sdk-folder'));
    await writeFile(join(root, 'sdk-folder', 'other.bin'), Buffer.from([0, 255, 1]));
    await writeFile(join(root, 'sdk.txt'), 'plain');
    await writeFile(join(root, '.sdk'), 'hidden');
    await symlink('sdk.txt', join(root, 'sdk-link'));
    const result = await search('filename', 'sdk');
    expect(result.hits.map(hit => [hit.path, hit.field])).toEqual([
      ['sdk.txt', 'name'], ['sdk-folder/other.bin', 'path'],
    ]);
    expect(result.hits.every(hit => hit.positions.length === 3 && Number.isFinite(hit.score))).toBe(true);
    expect(result.counts).toEqual({ matches: 2, files: 2 });
  });

  it('searches complete UTF-8 saved text independently of the preview limit and reports incomplete lines and invalid files', async () => {
    await writeFile(join(root, 'large.ts'), `${'ordinary line\n'.repeat(170_000)}needle`);
    await writeFile(join(root, 'LICENSE'), 'needle');
    await writeFile(join(root, 'data.json'), '{"value":"needle"}');
    await writeFile(join(root, 'long.txt'), `${'x'.repeat(256 * 1024 + 1)}needle\nneedle`);
    await writeFile(join(root, 'invalid.txt'), Buffer.concat([Buffer.from('needle\n'), Buffer.from([0xc3, 0x28])]));
    await writeFile(join(root, 'binary.bin'), Buffer.from([0, 255, 1]));
    const result = await search('content', 'needle');
    expect(result.hits.map(hit => hit.name).sort()).toEqual(['LICENSE', 'data.json', 'large.ts', 'long.txt']);
    expect(result.hits.find(hit => hit.name === 'long.txt')?.line).toBe(2);
    expect(result.coverage).toMatchObject({ complete: false, skippedLines: 1, timedOut: false });
    expect(result.coverage.skippedFiles).toEqual({ invalidEncoding: 1, binary: 1, unreadable: 0, changed: 0 });
    expect(result.counts).toEqual({ matches: 4, files: 4 });
  });

  it('reports full counts separately from bounded retained filename and content hits', async () => {
    await Promise.all(Array.from({ length: 55 }, (_, i) => writeFile(join(root, `match-${String(i).padStart(2, '0')}.txt`), 'needle\nneedle')));
    const filenames = await search('filename', 'match');
    expect(filenames.hits).toHaveLength(50);
    expect(filenames.counts).toEqual({ matches: 55, files: 55 });
    expect(filenames.limited).toBe(true);
    expect(filenames.coverage.complete).toBe(true);
    const content = await search('content', 'needle');
    expect(content.hits).toHaveLength(100);
    expect(content.counts).toEqual({ matches: 110, files: 55 });
    expect(content.limited).toBe(true);
    expect(content.coverage.complete).toBe(true);
  });

  it('breaks equal filename scores deterministically by relative path', async () => {
    for (const folder of ['z', 'a']) {
      await mkdir(join(root, folder));
      await writeFile(join(root, folder, 'needle.txt'), 'plain');
    }
    const first = await search('filename', 'needle');
    const second = await search('filename', 'needle');
    expect(first.hits.map(hit => hit.path)).toEqual(['a/needle.txt', 'z/needle.txt']);
    expect(second.hits.map(hit => hit.path)).toEqual(first.hits.map(hit => hit.path));
  });

  it('returns a version-fenced excerpt with no unrelated highlights and rejects replacements', async () => {
    const path = join(root, 'note.txt');
    const text = 'one\ntwo\nthree\nneedle\nfive\nsix\nseven\neight';
    await writeFile(path, text);
    const result = await search('content', 'needle');
    const hit = result.hits[0];
    const body = { id: hit.id, version: hit.version, line: hit.line, query: 'needle' };
    const response = await post('/api/vault/search/context', body);
    expect(response.status).toBe(200);
    const excerpt = await response.json() as { id: string[]; targetLine: number; startLine: number; lines: Array<{ number: number; text: string; positions: number[] }> };
    expect(excerpt).toMatchObject({ id: ['note.txt'], targetLine: 4, startLine: 1 });
    expect(excerpt.lines.map(line => line.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(excerpt.lines.find(line => line.number === 4)?.positions.length).toBeGreaterThan(0);
    expect(excerpt.lines.filter(line => line.number !== 4).every(line => line.positions.length === 0)).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(text);
    await rename(path, join(root, 'old.txt'));
    await writeFile(path, 'unrelated');
    const stale = await post('/api/vault/search/context', body);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: 'search_context_changed', message: 'This file changed. Search again.' } });
    await unlink(path);
    const disappeared = await post('/api/vault/search/context', body);
    expect(disappeared.status).toBe(409);
    expect(await disappeared.json()).toMatchObject({ error: { code: 'search_context_changed', message: 'This file changed. Search again.' } });
  });

  it('excludes known binary content without treating that exclusion as incomplete coverage', async () => {
    await writeFile(join(root, 'image.png'), Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex'));
    const result = await search('content', 'needle');
    expect(result.coverage).toMatchObject({ complete: true, skippedFiles: { binary: 1, invalidEncoding: 0, unreadable: 0, changed: 0 } });
  });

  it('observes saved changes on a fresh search', async () => {
    const path = join(root, 'note.txt');
    await writeFile(path, 'first needle');
    expect((await search('content', 'needle')).counts.matches).toBe(1);
    await writeFile(path, 'replacement');
    expect((await search('content', 'needle')).counts.matches).toBe(0);
  });

  it('cancels before and after opening a file and closes the request-owned handle', async () => {
    await writeFile(join(root, 'note.txt'), 'needle');
    const opened = deferred<FileHandle>();
    const release = deferred<void>();
    const state: { opens: number; handle?: FileHandle } = { opens: 0 };
    await reopen({ onSearchFileOpened: async (_id, handle) => {
      state.opens++;
      state.handle = handle;
      opened.resolve(handle);
      await release.promise;
    } });
    const alreadyAborted = new AbortController();
    alreadyAborted.abort();
    await post('/api/vault/search', { mode: 'content', query: 'needle' }, alreadyAborted.signal).catch(() => undefined);
    expect(state.opens).toBe(0);
    const controller = new AbortController();
    const pending = post('/api/vault/search', { mode: 'content', query: 'needle' }, controller.signal).catch(() => undefined);
    const first = await Promise.race([opened.promise.then(() => 'opened' as const), pending.then(() => 'finished' as const)]);
    try { expect(first).toBe('opened'); } finally { controller.abort(); release.resolve(); }
    await pending;
    expect(state.handle?.fd).toBe(-1);
  });

  it('discards provisional matches when a file changes during its scan', async () => {
    const path = join(root, 'note.txt');
    await writeFile(path, `needle\n${'filler\n'.repeat(20_000)}`);
    let changed = false;
    await reopen({ onSearchChunk: async id => {
      if (!changed && id.join('/') === 'note.txt') {
        changed = true;
        await writeFile(path, 'replacement, different size');
      }
    } });
    const result = await search('content', 'needle');
    expect(changed).toBe(true);
    expect(result.hits).toEqual([]);
    expect(result.counts).toEqual({ matches: 0, files: 0 });
    expect(result.coverage).toMatchObject({ complete: false, skippedFiles: { changed: 1 } });
  });

  it('expires a scan with honest partial coverage and never returns a timed-out context', async () => {
    await writeFile(join(root, 'note.txt'), 'needle\nmore text');
    let now = 0;
    let expire = false;
    await reopen({ searchNow: () => now, onSearchFileOpened: async () => { if (expire) now = 30_001; } });
    const hit = (await search('content', 'needle')).hits[0];
    expire = true;
    const result = await search('content', 'needle');
    expect(result).toMatchObject({ hits: [], counts: { matches: 0, files: 0 }, coverage: { complete: false, timedOut: true } });
    now = 0;
    const context = await post('/api/vault/search/context', { id: hit.id, version: hit.version, line: hit.line, query: 'needle' });
    expect(context.status).toBe(503);
    expect(await context.json()).toMatchObject({ error: { code: 'search_unavailable' } });
  });

  it('returns control to the event loop during a single large file scan', async () => {
    await writeFile(join(root, 'note.txt'), 'needle\n'.repeat(100_000));
    let batches = 0;
    let scheduled = false;
    let observedYield = false;
    await reopen({ onSearchChunk: async () => {
      batches++;
      if (batches === 1) setImmediate(() => { scheduled = true; });
      else if (scheduled) observedYield = true;
    } });
    const result = await search('content', 'needle');
    expect(result.counts.matches).toBe(100_000);
    expect(batches).toBeGreaterThan(1);
    expect(observedYield).toBe(true);
  });

  it('rejects a replaced root and unsafe context IDs', async () => {
    await writeFile(join(root, 'original.txt'), 'needle');
    await rename(root, join(fixture, 'original-root'));
    await mkdir(root);
    await writeFile(join(root, 'replacement.txt'), 'needle');
    const searchResponse = await post('/api/vault/search', { mode: 'content', query: 'needle' });
    expect(searchResponse.status).toBe(503);
    expect(await searchResponse.json()).toMatchObject({ error: { code: 'search_unavailable' } });
    expect(await readFile(join(fixture, 'original-root', 'original.txt'), 'utf8')).toBe('needle');
    expect(await readFile(join(root, 'replacement.txt'), 'utf8')).toBe('needle');
    const response = await post('/api/vault/search/context', { id: ['..', 'secret'], version: 'v', line: 1, query: 'needle' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('validates requests and treats an empty normalized query as an empty scan', async () => {
    const empty = await search('content', ' \n\t');
    expect(empty).toMatchObject({ hits: [], counts: { matches: 0, files: 0 }, limited: false, coverage: { complete: true, filesSearched: 0 } });
    for (const body of [{ mode: 'bad', query: 'x' }, { mode: 'content', query: 3 }, { mode: 'filename', query: 'x'.repeat(129) }]) {
      const response = await post('/api/vault/search', body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
    }
  });
});
