import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { VaultSearchContextRequest, VaultSearchContextResponse, VaultSearchRequest, VaultSearchResponse } from '../../backend/contract';
import RecallView from '../../src/views/RecallView';
import { TestPresentation } from './fixtures/presentation';
import { alphaId, betaId, deferred, installVaultApi, installViewport, jsonResponse, noteLocation } from './fixtures/recall';

const coverage = { complete: true, filesSearched: 2, skippedFiles: { binary: 0, invalidEncoding: 0, unreadable: 0, changed: 0 }, skippedLines: 0, timedOut: false };
const filename: VaultSearchResponse = {
  mode: 'filename', counts: { matches: 1, files: 1 }, limited: false, coverage,
  hits: [{ id: alphaId, name: 'Alpha #1.md', path: 'Test shelf & café/Alpha #1.md', field: 'name', positions: [0, 1], score: 1 }],
};
const content: VaultSearchResponse = {
  mode: 'content', counts: { matches: 1, files: 1 }, limited: false, coverage,
  hits: [{ id: betaId, name: 'Beta.md', path: 'Test shelf & café/Beta.md', line: 4, version: 'fixture-version', score: 1,
    snippets: [{ text: '😀 <source> Beta', start: 0, end: 16, positions: [4, 12] }] }],
};
const excerpt: VaultSearchContextResponse = {
  id: betaId, name: 'Beta.md', version: 'fixture-version', targetLine: 4, startLine: 1, truncated: false,
  lines: [1, 2, 3, 4, 5, 6, 7].map(number => ({ number, text: number === 4 ? '😀 <source> Beta' : `neighbor ${number}`, positions: number === 4 ? [4, 12] : [] })),
};

let searches: VaultSearchRequest[];
let contexts: VaultSearchContextRequest[];
let search: (body: VaultSearchRequest, signal: AbortSignal | null | undefined) => Response | Promise<Response>;
let context: (body: VaultSearchContextRequest) => Response | Promise<Response>;

beforeEach(() => {
  installViewport(1440);
  searches = []; contexts = [];
  search = body => jsonResponse(body.mode === 'filename' ? filename : content);
  context = () => jsonResponse(excerpt);
  const api = installVaultApi({ note: id => jsonResponse({ name: id.at(-1), markdown: '# Original\n\nSaved source.', revision: 'a'.repeat(64), editable: true }) });
  const read = api.getMockImplementation();
  if (!read) throw new Error('Missing fixture fetch');
  api.mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin === window.location.origin && method === 'POST' && url.pathname === '/api/vault/search') {
      const body: VaultSearchRequest = JSON.parse(String(init?.body));
      searches.push(body);
      return search(body, init?.signal);
    }
    if (url.origin === window.location.origin && method === 'POST' && url.pathname === '/api/vault/search/context') {
      const body: VaultSearchContextRequest = JSON.parse(String(init?.body));
      contexts.push(body);
      return context(body);
    }
    return read(input, init);
  });
});

function mount(path = '/recall') {
  window.history.replaceState(null, '', path);
  return render(<TestPresentation><RecallView /></TestPresentation>);
}

async function input() {
  const files = await screen.findByRole('navigation', { name: 'Vault files' });
  return within(files).getByRole('searchbox');
}

async function contentSearch(user: ReturnType<typeof userEvent.setup>, query = 'sb') {
  const box = await input();
  await user.click(screen.getByText('Content', { exact: true }));
  await user.type(box, query);
  return within(await screen.findByRole('navigation', { name: 'Vault files' })).findByRole('link', { name: /Beta\.md/ });
}

describe('Recall search', () => {
  it('uses a native search input, defaults to Filename, and clearing restores the expanded tree', async () => {
    const user = userEvent.setup(); mount();
    const box = await input();
    expect(box.tagName).toBe('INPUT');
    const files = screen.getByRole('navigation', { name: 'Vault files' });
    await user.click(within(files).getByRole('button', { name: 'Test shelf & café' }));
    await user.type(box, 'Al');
    await waitFor(() => expect(searches.at(-1)).toEqual({ mode: 'filename', query: 'Al' }));
    await within(files).findByRole('link', { name: /Alpha #1\.md/ });
    await user.clear(box);
    expect(within(files).getByRole('button', { name: 'Test shelf & café' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(files).getByRole('link', { name: 'Beta.md' })).toBeInTheDocument();
  });

  it('highlights literal filename and full-path positions, including UTF-16 offsets', async () => {
    search = () => jsonResponse({ ...filename, hits: [{ id: alphaId, name: '😀Alpha.md', path: '😀Folder/😀Alpha.md', field: 'path', positions: [2, 11], score: 1 }] } satisfies VaultSearchResponse);
    const user = userEvent.setup(); mount();
    await user.type(await input(), 'fa');
    const files = screen.getByRole('navigation', { name: 'Vault files' });
    const link = await within(files).findByRole('link', { name: /😀Alpha\.md/ });
    expect(link.textContent).toBe('😀Alpha.md😀Folder/😀Alpha.md');
    const marks = [...link.querySelectorAll('mark')].map(mark => mark.textContent).join('');
    expect(marks).toBe('FA');
    expect(files.querySelector('script, source, img')).toBeNull();
  });

  it('debounces and fences out-of-order replies even when fetch ignores abort', async () => {
    const old = deferred<Response>(); const current = deferred<Response>();
    let oldSignal: AbortSignal | null | undefined;
    search = (body, signal) => { if (body.query === 'a') { oldSignal = signal; return old.promise; } return current.promise; };
    const user = userEvent.setup(); mount(); const box = await input();
    await user.type(box, 'a'); await waitFor(() => expect(searches).toContainEqual({ mode: 'filename', query: 'a' }));
    await user.type(box, 'b'); await waitFor(() => expect(searches).toContainEqual({ mode: 'filename', query: 'ab' }));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => current.resolve(jsonResponse(filename)));
    await screen.findByRole('link', { name: /Alpha #1\.md/ });
    await act(async () => old.resolve(jsonResponse({ ...filename, hits: [{ ...filename.hits[0], name: 'Stale.md' }] })));
    expect(screen.queryByText('Stale.md')).not.toBeInTheDocument();
  });

  it('renders escaped content evidence and opens a version-fenced numbered source excerpt', async () => {
    const user = userEvent.setup(); mount();
    const hit = await contentSearch(user);
    expect(hit).toHaveAttribute('href');
    expect(hit).toHaveTextContent('😀 <source> Beta');
    expect(hit.querySelector('source')).toBeNull();
    expect([...hit.querySelectorAll('mark')].map(node => node.textContent).join('')).toBe('sB');
    await user.click(hit);
    await waitFor(() => expect(contexts).toEqual([{ id: betaId, version: 'fixture-version', line: 4, query: 'sb' }]));
    await screen.findByText(/Source excerpt/i);
    expect(screen.getByText('neighbor 1')).toBeInTheDocument();
    expect(screen.getByText('neighbor 7')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Read formatted|Open full file/i }));
    expect(await screen.findByRole('article', { name: 'Beta.md' })).toHaveTextContent('Saved source.');
  });

  it('reports stale context without showing an unrelated highlighted line', async () => {
    context = () => jsonResponse({ error: { code: 'search_context_changed', message: 'This file changed. Search again.' } }, 409);
    const user = userEvent.setup(); mount(); await user.click(await contentSearch(user));
    expect(await screen.findByText('This file changed. Search again.')).toBeInTheDocument();
    expect(screen.queryByText('neighbor 4')).not.toBeInTheDocument();
  });

  it('distinguishes a limited result list from an incomplete scan', async () => {
    search = () => jsonResponse({ ...content, counts: { matches: 123, files: 12 }, limited: true,
      coverage: { ...coverage, complete: false, skippedLines: 2 } } satisfies VaultSearchResponse);
    const user = userEvent.setup(); mount(); await contentSearch(user);
    const files = screen.getByRole('navigation', { name: 'Vault files' });
    expect(files).toHaveTextContent(/123/);
    expect(files).toHaveTextContent(/12/);
    expect(files).toHaveTextContent(/limit|showing/i);
    expect(files).toHaveTextContent(/incomplete|skipped|partial/i);
  });

  it('leaves a dirty draft untouched on modified click and provides a reusable context address', async () => {
    const user = userEvent.setup(); mount(noteLocation(alphaId));
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('textbox', { name: /markdown/i });
    fireEvent.change(editor, { target: { value: 'Keep this draft' } });
    const hit = await contentSearch(user);
    const href = hit.getAttribute('href');
    expect(href).toBeTruthy();
    const url = new URL(href ?? '', window.location.origin);
    expect(decodeURIComponent(url.href)).toContain('fixture-version');
    expect(decodeURIComponent(url.href)).toContain('4');
    expect(decodeURIComponent(url.href)).toContain('sb');
    fireEvent.click(hit, { ctrlKey: true, button: 0 });
    expect(editor).toHaveValue('Keep this draft');
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
    expect(contexts).toEqual([]);
  });

  it.each([['different file', betaId], ['same file', alphaId]] as const)('guards a dirty draft before context for a hit in the %s', async (_label, id) => {
    const hitResponse: VaultSearchResponse = { ...content, hits: [{ ...content.hits[0], id, name: id.at(-1) ?? '', path: id.join('/') }] };
    search = () => jsonResponse(hitResponse);
    const user = userEvent.setup(); mount(noteLocation(alphaId));
    await screen.findByRole('article', { name: 'Alpha #1.md' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('textbox', { name: /markdown/i });
    fireEvent.change(editor, { target: { value: 'Unfinished draft' } });
    const box = await input(); await user.click(screen.getByText('Content', { exact: true })); await user.type(box, 'sb');
    const files = screen.getByRole('navigation', { name: 'Vault files' });
    const hit = await within(files).findByRole('link', { name: new RegExp(id.at(-1)?.replace('.', '\\.') ?? '') });
    await user.click(hit);
    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(contexts).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(editor).toHaveValue('Unfinished draft');
    await user.click(hit); await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(contexts).toHaveLength(1));
  });

  it('clears search on Escape before applying the existing Files collapse behavior', async () => {
    const user = userEvent.setup(); mount(); const box = await input();
    await user.type(box, 'Al'); await waitFor(() => expect(searches.length).toBeGreaterThan(0));
    await user.keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(screen.getByRole('navigation', { name: 'Vault files' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Expand files sidebar' })).toBeInTheDocument();
  });

  it('retains content query and results when returning to Files on mobile', async () => {
    installViewport(390); const user = userEvent.setup(); mount();
    await user.click(await contentSearch(user)); await screen.findByText(/Source excerpt/i);
    await user.click(screen.getByRole('button', { name: 'Expand files sidebar' }));
    expect(await input()).toHaveValue('sb');
    expect(within(screen.getByRole('navigation', { name: 'Vault files' })).getByRole('link', { name: /Beta\.md/ })).toBeInTheDocument();
  });
});
